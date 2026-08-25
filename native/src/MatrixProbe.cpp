#include "MatrixProbe.h"

#include "Config.h"
#include "D3D11Hook.h"
#include "Logger.h"

#include <MinHook.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <functional>
#include <initializer_list>
#include <mutex>
#include <unordered_map>
#include <vector>

namespace fpcam::probe {
namespace {

using MapFn = HRESULT(STDMETHODCALLTYPE*)(ID3D11DeviceContext*, ID3D11Resource*,
                                          UINT, D3D11_MAP, UINT,
                                          D3D11_MAPPED_SUBRESOURCE*);
using UnmapFn = void(STDMETHODCALLTYPE*)(ID3D11DeviceContext*, ID3D11Resource*,
                                         UINT);
using UpdateSubresourceFn = void(STDMETHODCALLTYPE*)(
    ID3D11DeviceContext*, ID3D11Resource*, UINT, const D3D11_BOX*, const void*,
    UINT, UINT);

MapFn g_originalMap = nullptr;
UnmapFn g_originalUnmap = nullptr;
UpdateSubresourceFn g_originalUpdateSubresource = nullptr;

bool g_installed = false;
bool g_discovery = false;
uint64_t g_frame = 0;

// --- Candidate tracking ---------------------------------------------------

struct CandidateKey {
    const void* resource = nullptr;
    uint32_t byteOffset = 0;

    bool operator==(const CandidateKey& other) const {
        return resource == other.resource && byteOffset == other.byteOffset;
    }
};

struct CandidateKeyHash {
    size_t operator()(const CandidateKey& key) const {
        return std::hash<const void*>{}(key.resource) ^
               (static_cast<size_t>(key.byteOffset) * 0x9E3779B97F4A7C15ull);
    }
};

struct Candidate {
    ViewSample sample;
    uint64_t firstSeenFrame = 0;
    uint64_t lastSeenFrame = 0;
    uint64_t hitCount = 0;
    // How much the camera basis has moved since first seen. A static matrix
    // (a shadow cascade, a UI transform) scores zero and is discarded; the
    // real view matrix moves whenever the player turns.
    float motion = 0.0f;
    bool reported = false;
};

std::mutex g_mutex;
std::unordered_map<CandidateKey, Candidate, CandidateKeyHash> g_candidates;

// The buffer we have decided is the view matrix, and the last sample from it.
CandidateKey g_locked;
bool g_hasLock = false;
ViewSample g_latest;

// Live Map() results, so Unmap() can inspect what was written.
struct MappedRange {
    void* data = nullptr;
    size_t size = 0;
};
std::unordered_map<const void*, MappedRange> g_mapped;

// Constant-buffer sizes, cached because GetDesc on every Unmap is measurable.
// Guarded by its own mutex: it is consulted from the Map and UpdateSubresource
// detours before g_mutex is taken, and g_mutex is not recursive.
std::mutex g_sizeMutex;
std::unordered_map<const void*, uint32_t> g_constantBufferSizes;

// Returns the byte size if `resource` is a constant buffer, else 0.
uint32_t ConstantBufferSize(ID3D11Resource* resource) {
    {
        std::scoped_lock lock(g_sizeMutex);
        const auto it = g_constantBufferSizes.find(resource);
        if (it != g_constantBufferSizes.end()) return it->second;
    }

    uint32_t size = 0;
    D3D11_RESOURCE_DIMENSION dimension = D3D11_RESOURCE_DIMENSION_UNKNOWN;
    resource->GetType(&dimension);
    if (dimension == D3D11_RESOURCE_DIMENSION_BUFFER) {
        auto* buffer = static_cast<ID3D11Buffer*>(resource);
        D3D11_BUFFER_DESC desc = {};
        buffer->GetDesc(&desc);
        if ((desc.BindFlags & D3D11_BIND_CONSTANT_BUFFER) != 0) {
            size = desc.ByteWidth;
        }
    }

    // Bounded: the game creates and destroys buffers over a session and this
    // cache must not grow without limit.
    std::scoped_lock lock(g_sizeMutex);
    if (g_constantBufferSizes.size() > 4096) g_constantBufferSizes.clear();
    g_constantBufferSizes[resource] = size;
    return size;
}

// Walks a written constant-buffer range looking for 4x4 float blocks that
// decode as a view matrix, and folds each hit into the candidate table.
void InspectBuffer(const void* resource, const void* data, size_t size) {
    if (data == nullptr || size < 64) return;

    const Config& config = GetConfig();
    const auto* bytes = static_cast<const uint8_t*>(data);

    // 16-byte stride: HLSL constant buffers pack in float4 registers, so a
    // matrix can only begin on a 16-byte boundary.
    for (size_t offset = 0; offset + 64 <= size; offset += 16) {
        float matrix[16];
        ::memcpy(matrix, bytes + offset, sizeof(matrix));

        ViewSample sample;
        if (core::DecodeViewMatrix(matrix, &sample) != core::DecodeResult::Ok) {
            continue;
        }
        sample.frame = g_frame;

        const CandidateKey key{resource, static_cast<uint32_t>(offset)};

        std::scoped_lock lock(g_mutex);

        auto it = g_candidates.find(key);
        if (it == g_candidates.end()) {
            if (g_candidates.size() >= config.discovery.maxCandidates) {
                // Table full: drop the least active entry rather than ignoring
                // a possibly-better new one.
                auto worst = std::min_element(
                    g_candidates.begin(), g_candidates.end(),
                    [](const auto& a, const auto& b) {
                        return a.second.motion < b.second.motion;
                    });
                if (worst != g_candidates.end()) g_candidates.erase(worst);
            }
            Candidate fresh;
            fresh.sample = sample;
            fresh.firstSeenFrame = g_frame;
            fresh.lastSeenFrame = g_frame;
            fresh.hitCount = 1;
            g_candidates.emplace(key, fresh);
            continue;
        }

        Candidate& candidate = it->second;
        candidate.motion += core::BasisDelta(candidate.sample, sample);
        candidate.sample = sample;
        candidate.lastSeenFrame = g_frame;
        ++candidate.hitCount;

        if (g_hasLock && key == g_locked) {
            g_latest = sample;
        }
    }
}

void TryLock() {
    std::scoped_lock lock(g_mutex);
    if (g_hasLock) {
        // Drop a lock that has gone stale, e.g. across a level load.
        const auto it = g_candidates.find(g_locked);
        if (it == g_candidates.end() || g_frame - it->second.lastSeenFrame > 120) {
            FPCAM_INFO("MatrixProbe: locked candidate went stale; re-identifying.");
            g_hasLock = false;
            g_latest.valid = false;
        } else {
            return;
        }
    }

    // Require a candidate that has been written for a while and has actually
    // moved -- a matrix that never changes is not the player's camera.
    const Candidate* best = nullptr;
    CandidateKey bestKey;
    for (const auto& [key, candidate] : g_candidates) {
        if (candidate.hitCount < 60) continue;
        if (candidate.motion < 0.05f) continue;
        if (best == nullptr || candidate.motion > best->motion) {
            best = &candidate;
            bestKey = key;
        }
    }
    if (best == nullptr) return;

    g_locked = bestKey;
    g_hasLock = true;
    g_latest = best->sample;

    FPCAM_INFO("MatrixProbe: locked on to the view matrix -- resource={} "
               "offset=0x{:X} after {} writes (motion score {:.2f}).",
               bestKey.resource, bestKey.byteOffset, best->hitCount,
               best->motion);
    FPCAM_INFO("MatrixProbe: camera basis is now available even with no "
               "signatures resolved; camera-relative movement will work.");
}

// --- Detours --------------------------------------------------------------

HRESULT STDMETHODCALLTYPE HookedMap(ID3D11DeviceContext* context,
                                    ID3D11Resource* resource, UINT subresource,
                                    D3D11_MAP mapType, UINT flags,
                                    D3D11_MAPPED_SUBRESOURCE* mapped) {
    const HRESULT hr =
        g_originalMap(context, resource, subresource, mapType, flags, mapped);
    if (FAILED(hr) || mapped == nullptr || subresource != 0) return hr;

    const uint32_t size = ConstantBufferSize(resource);
    if (size >= 64) {
        std::scoped_lock lock(g_mutex);
        if (g_mapped.size() > 512) g_mapped.clear();
        g_mapped[resource] = MappedRange{mapped->pData, size};
    }
    return hr;
}

void STDMETHODCALLTYPE HookedUnmap(ID3D11DeviceContext* context,
                                   ID3D11Resource* resource, UINT subresource) {
    // The mapped pointer is still valid until the original Unmap runs, so this
    // is the one place we get to see what the frame actually wrote.
    MappedRange range;
    {
        std::scoped_lock lock(g_mutex);
        const auto it = g_mapped.find(resource);
        if (it != g_mapped.end()) {
            range = it->second;
            g_mapped.erase(it);
        }
    }
    if (range.data != nullptr) {
        InspectBuffer(resource, range.data, range.size);
    }
    g_originalUnmap(context, resource, subresource);
}

void STDMETHODCALLTYPE HookedUpdateSubresource(
    ID3D11DeviceContext* context, ID3D11Resource* resource, UINT subresource,
    const D3D11_BOX* box, const void* data, UINT rowPitch, UINT depthPitch) {
    if (subresource == 0 && data != nullptr) {
        const uint32_t size = ConstantBufferSize(resource);
        if (size >= 64) {
            InspectBuffer(resource, data, size);
        }
    }
    g_originalUpdateSubresource(context, resource, subresource, box, data,
                                rowPitch, depthPitch);
}

}  // namespace

bool Install() {
    if (g_installed) return true;

    void** vtable = d3d11::ContextVTable();
    if (vtable == nullptr) {
        FPCAM_ERROR("MatrixProbe: no device-context vtable; D3D11Hook::Install "
                    "must succeed first.");
        return false;
    }

    struct HookSpec {
        int slot;
        LPVOID detour;
        LPVOID* original;
        const char* name;
    };
    const std::array<HookSpec, 3> hooks = {{
        {d3d11::slot::kContextMap, reinterpret_cast<LPVOID>(&HookedMap),
         reinterpret_cast<LPVOID*>(&g_originalMap), "Map"},
        {d3d11::slot::kContextUnmap, reinterpret_cast<LPVOID>(&HookedUnmap),
         reinterpret_cast<LPVOID*>(&g_originalUnmap), "Unmap"},
        {d3d11::slot::kContextUpdateSubresource,
         reinterpret_cast<LPVOID>(&HookedUpdateSubresource),
         reinterpret_cast<LPVOID*>(&g_originalUpdateSubresource),
         "UpdateSubresource"},
    }};

    size_t installed = 0;
    for (const HookSpec& hook : hooks) {
        MH_STATUS status =
            MH_CreateHook(vtable[hook.slot], hook.detour, hook.original);
        if (status != MH_OK) {
            FPCAM_ERROR("MatrixProbe: MH_CreateHook({}) failed: {}", hook.name,
                        MH_StatusToString(status));
            break;
        }
        status = MH_EnableHook(vtable[hook.slot]);
        if (status != MH_OK) {
            FPCAM_ERROR("MatrixProbe: MH_EnableHook({}) failed: {}", hook.name,
                        MH_StatusToString(status));
            MH_RemoveHook(vtable[hook.slot]);
            break;
        }
        ++installed;
    }

    if (installed != hooks.size()) {
        // Partial installation would leave Map recording ranges that Unmap
        // never consumes. Roll the whole thing back.
        for (size_t i = 0; i < installed; ++i) {
            MH_DisableHook(vtable[hooks[i].slot]);
            MH_RemoveHook(vtable[hooks[i].slot]);
        }
        return false;
    }

    g_installed = true;
    FPCAM_INFO("MatrixProbe: constant-buffer hooks installed.");
    return true;
}

void Uninstall() {
    if (!g_installed) return;
    void** vtable = d3d11::ContextVTable();
    if (vtable == nullptr) { g_installed = false; return; }
    for (const int slotIndex : {d3d11::slot::kContextMap,
                                d3d11::slot::kContextUnmap,
                                d3d11::slot::kContextUpdateSubresource}) {
        MH_DisableHook(vtable[slotIndex]);
        MH_RemoveHook(vtable[slotIndex]);
    }
    {
        std::scoped_lock sizeLock(g_sizeMutex);
        g_constantBufferSizes.clear();
    }
    std::scoped_lock lock(g_mutex);
    g_candidates.clear();
    g_mapped.clear();
    g_hasLock = false;
    g_latest.valid = false;
    g_installed = false;
    FPCAM_INFO("MatrixProbe: hooks removed.");
}

void SetDiscoveryEnabled(bool enabled) {
    if (g_discovery == enabled) return;
    g_discovery = enabled;
    FPCAM_INFO("MatrixProbe: discovery mode {}.", enabled ? "ON" : "off");
    if (enabled) {
        FPCAM_INFO("Rotate the camera in game for a few seconds, then read the "
                   "candidate table below: the entry whose position and facing "
                   "track your camera is the view matrix.");
    }
}

bool DiscoveryEnabled() { return g_discovery; }

void OnFrame(uint64_t frameIndex) {
    g_frame = frameIndex;

    TryLock();

    if (!g_discovery) return;
    const int interval = GetConfig().discovery.logEveryNFrames;
    if (interval > 0 && (frameIndex % static_cast<uint64_t>(interval)) == 0) {
        LogCandidates();
    }
}

ViewSample Latest() {
    std::scoped_lock lock(g_mutex);
    return g_latest;
}

void ResetLock() {
    std::scoped_lock lock(g_mutex);
    g_hasLock = false;
    g_latest.valid = false;
    g_candidates.clear();
    FPCAM_INFO("MatrixProbe: candidate table cleared, re-identifying.");
}

void LogCandidates() {
    std::vector<std::pair<CandidateKey, Candidate>> snapshot;
    bool hasLock = false;
    CandidateKey locked;
    {
        std::scoped_lock lock(g_mutex);
        snapshot.assign(g_candidates.begin(), g_candidates.end());
        hasLock = g_hasLock;
        locked = g_locked;
    }

    std::sort(snapshot.begin(), snapshot.end(),
              [](const auto& a, const auto& b) {
                  return a.second.motion > b.second.motion;
              });

    FPCAM_INFO("============ VIEW MATRIX CANDIDATES (frame {}) ============",
               g_frame);
    if (snapshot.empty()) {
        FPCAM_INFO("  none yet -- if this stays empty, the game is probably not "
                   "running in DirectX 11 mode.");
    }
    for (const auto& [key, candidate] : snapshot) {
        const ViewSample& s = candidate.sample;
        FPCAM_INFO("  {} res={} off=0x{:03X} hits={:<6} motion={:7.2f}  "
                   "pos=({:8.2f},{:8.2f},{:8.2f})  yaw={:7.2f} pitch={:6.2f}",
                   (hasLock && key == locked) ? "->" : "  ", key.resource,
                   key.byteOffset, candidate.hitCount, candidate.motion,
                   s.position.x, s.position.y, s.position.z, s.yawDegrees,
                   s.pitchDegrees);
    }
    FPCAM_INFO("  '->' marks the buffer currently used as the camera basis.");
    FPCAM_INFO("==========================================================");
}

}  // namespace fpcam::probe
