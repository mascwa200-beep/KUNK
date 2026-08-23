#include "CameraHook.h"

#include "Bridge.h"
#include "Config.h"
#include "Logger.h"
#include "MatrixProbe.h"
#include "MemoryScanner.h"
#include "core/Angles.h"
#include "core/EyePlacement.h"

#include <atomic>
#include <mutex>
#include <vector>

namespace fpcam::camera {
namespace {

std::mutex g_mutex;

std::atomic<bool> g_firstPerson{false};

// Desired orientation, in degrees. Written from the input thread, read on the
// render thread; atomics keep the pair from tearing relative to each other in
// any way that matters visually.
std::atomic<float> g_yaw{0.0f};
std::atomic<float> g_pitch{0.0f};

// Address of the global that holds the camera manager pointer, resolved from
// the CameraManagerInstance signature.
uintptr_t g_cameraRoot = 0;
bool g_cameraResolved = false;

std::vector<mem::BytePatch> g_clampPatches;

// Raises the viewpoint from the camera's own position to the character's eyes.
// Owns the guard against re-reading its own writes -- see core/EyePlacement.h.
core::EyePlacement g_eyePlacement;

// The camera object the placement state belongs to. When the engine swaps
// cameras (dialogue, cutscenes, a level load) the remembered base refers to a
// structure that no longer exists and must be discarded.
uintptr_t g_lastCameraObject = 0;
std::atomic<bool> g_eyePlacementActive{false};
std::atomic<float> g_eyeHeightInUse{0.0f};

std::atomic<uint64_t> g_framesWritten{0};
std::atomic<uint64_t> g_writeFailures{0};

// Rate-limits the "could not write" complaint: at 120 fps a broken offset
// would otherwise produce 7200 identical log lines per minute.
uint64_t g_lastFailureLogFrame = 0;

// Walks the configured pointer chain from the resolved root to the live camera
// object. Re-walked every frame on purpose -- the active camera changes when
// the game switches between the party camera, dialogue and cutscenes, and a
// cached pointer would be stale exactly when it matters.
uintptr_t ResolveCameraObject() {
    if (!g_cameraResolved || g_cameraRoot == 0) return 0;

    uintptr_t address = 0;
    if (!mem::Read(g_cameraRoot, &address) || address == 0) return 0;

    for (const int32_t offset : GetConfig().camera.pointerChain) {
        uintptr_t next = 0;
        if (!mem::Read(address + static_cast<uintptr_t>(offset), &next) ||
            next == 0) {
            return 0;
        }
        address = next;
    }
    return address;
}

// Writes one float field if its offset is configured. Returns true when the
// field was either written successfully or deliberately skipped.
bool WriteField(uintptr_t object, int32_t offset, float value,
                const char* fieldName) {
    if (offset < 0) return true;  // not configured: leave the game's value
    if (!mem::Write(object + static_cast<uintptr_t>(offset), value)) {
        FPCAM_TRACE("camera: write of {} at +0x{:X} failed.", fieldName, offset);
        return false;
    }
    return true;
}

void ApplyClampPatches(const SignatureRegistry& signatures) {
    const Config& config = GetConfig();
    if (config.camera.clampBypass != ClampBypass::PatchClamp) return;

    for (const CameraConfig::ClampPatch& spec : config.camera.clampPatches) {
        const auto address = signatures.Get(spec.signature);
        if (!address.has_value()) {
            FPCAM_WARN("camera: clamp patch '{}' skipped -- its signature did "
                       "not resolve. Falling back to per-frame overwriting for "
                       "this limit.", spec.signature);
            continue;
        }

        mem::BytePatch patch;
        patch.address = *address;
        const std::vector<uint8_t> nops(static_cast<size_t>(spec.nopLength), 0x90);
        if (!patch.Apply(nops)) {
            FPCAM_ERROR("camera: clamp patch '{}' at {} could not be applied.",
                        spec.signature, mem::DescribeAddress(*address));
            continue;
        }
        FPCAM_INFO("camera: clamp patch '{}' applied at {} ({} bytes NOPed).",
                   spec.signature, mem::DescribeAddress(*address),
                   spec.nopLength);
        g_clampPatches.push_back(std::move(patch));
    }
}

}  // namespace

bool Initialize(const SignatureRegistry& signatures) {
    std::scoped_lock lock(g_mutex);

    const auto root = signatures.Get("CameraManagerInstance");
    if (!root.has_value()) {
        g_cameraResolved = false;
        FPCAM_WARN("camera: 'CameraManagerInstance' did not resolve, so the "
                   "game's camera cannot be written to. Mouse-look tracking and "
                   "camera-relative movement will still work -- the view will "
                   "not switch to first person. See docs/SIGNATURES.md.");
        return false;
    }

    g_cameraRoot = *root;
    g_cameraResolved = true;
    FPCAM_INFO("camera: manager pointer at {}.", mem::DescribeAddress(g_cameraRoot));

    const uintptr_t object = ResolveCameraObject();
    if (object == 0) {
        FPCAM_WARN("camera: the pointer chain did not reach a readable object "
                   "yet. This is normal before the game finishes loading; it "
                   "will be retried every frame.");
    } else {
        FPCAM_INFO("camera: active camera object at {}.",
                   mem::DescribeAddress(object));
    }

    ApplyClampPatches(signatures);
    return true;
}

void Shutdown() {
    std::scoped_lock lock(g_mutex);
    for (mem::BytePatch& patch : g_clampPatches) {
        if (!patch.Revert()) {
            FPCAM_ERROR("camera: failed to revert the clamp patch at {}; the "
                        "game process is left modified until it exits.",
                        mem::DescribeAddress(patch.address));
        }
    }
    g_clampPatches.clear();
    g_cameraResolved = false;
    g_cameraRoot = 0;
    g_firstPerson.store(false);
    g_eyePlacement.Reset();
    g_lastCameraObject = 0;
    g_eyePlacementActive.store(false);
}

void Rebind(const SignatureRegistry& signatures) {
    Shutdown();
    Initialize(signatures);
}

void SetFirstPersonEnabled(bool enabled) {
    const bool previous = g_firstPerson.exchange(enabled);
    if (previous == enabled) return;
    {
        // Leaving first person hands the camera back to the engine; the
        // remembered base must not survive into the next session.
        std::scoped_lock lock(g_mutex);
        g_eyePlacement.Reset();
        g_lastCameraObject = 0;
        g_eyePlacementActive.store(false);
    }
    FPCAM_INFO("First-person mode {}.", enabled ? "ENABLED" : "disabled");
}

bool FirstPersonEnabled() { return g_firstPerson.load(); }

void ApplyMouseDelta(float deltaX, float deltaY) {
    if (!g_firstPerson.load()) return;

    const Config& config = GetConfig();
    const float sensitivity = config.mouse.sensitivity;

    const float yawDelta = deltaX * sensitivity * config.mouse.yawScale;
    float pitchDelta = deltaY * sensitivity * config.mouse.pitchScale;
    // Screen-space Y grows downward; moving the mouse away from you should
    // look up, so the raw delta is negated unless the player asks otherwise.
    pitchDelta = config.camera.invertPitch ? pitchDelta : -pitchDelta;

    g_yaw.store(WrapDegrees(g_yaw.load() + yawDelta));
    g_pitch.store(Clamp(g_pitch.load() + pitchDelta, config.camera.pitchMin,
                        config.camera.pitchMax));
}

void OnFrame(uint64_t frameIndex) {
    if (!g_firstPerson.load()) return;

    const Config& config = GetConfig();

    // Adopt the engine's own yaw/pitch the first time we see a decoded matrix,
    // so enabling first-person does not snap the view to an arbitrary heading.
    static bool adoptedInitialOrientation = false;
    if (!adoptedInitialOrientation) {
        const probe::ViewSample sample = probe::Latest();
        if (sample.valid) {
            g_yaw.store(sample.yawDegrees);
            g_pitch.store(Clamp(sample.pitchDegrees, config.camera.pitchMin,
                                config.camera.pitchMax));
            adoptedInitialOrientation = true;
            FPCAM_DEBUG("camera: adopted engine orientation yaw={:.2f} "
                        "pitch={:.2f}", sample.yawDegrees, sample.pitchDegrees);
        }
    }

    std::scoped_lock lock(g_mutex);

    const uintptr_t object = ResolveCameraObject();
    if (object == 0) {
        g_writeFailures.fetch_add(1);
        if (frameIndex - g_lastFailureLogFrame > 600) {
            g_lastFailureLogFrame = frameIndex;
            FPCAM_DEBUG("camera: no reachable camera object this frame "
                        "(cumulative failures: {}).", g_writeFailures.load());
        }
        return;
    }

    const CameraConfig& camera = config.camera;
    bool allOk = true;

    allOk &= WriteField(object, camera.offsets.yaw, g_yaw.load(), "yaw");
    allOk &= WriteField(object, camera.offsets.pitch, g_pitch.load(), "pitch");

    if (camera.forceZoom) {
        allOk &= WriteField(object, camera.offsets.distance, camera.zoomDistance,
                            "distance");
    }
    if (config.headHide.nearPlanePush) {
        allOk &= WriteField(object, camera.offsets.nearPlane, camera.nearPlane,
                            "nearPlane");
    }
    if (camera.fovOverride > 0.0f) {
        allOk &= WriteField(object, camera.offsets.fov, camera.fovOverride,
                            "fov");
    }

    // Raise the viewpoint to the character's eyes.
    //
    // This is a delta on the camera's own position, which the engine updates
    // and smooths every frame, rather than on the character position the Lua
    // bridge publishes -- that arrives at 10 Hz and would visibly stutter while
    // walking. The bridge supplies only the race, which selects the eye height
    // and changes about once a session.
    if (camera.offsets.positionX >= 0) {
        // A new camera object means the remembered base belongs to a structure
        // that is gone; comparing against it would be meaningless.
        if (object != g_lastCameraObject) {
            g_eyePlacement.Reset();
            g_lastCameraObject = object;
        }

        const uintptr_t positionAddress =
            object + static_cast<uintptr_t>(camera.offsets.positionX);

        float raw[3] = {0.0f, 0.0f, 0.0f};
        if (mem::SafeRead(positionAddress, raw, sizeof(raw))) {
            core::EyePlacementInput input;
            input.enginePosition = core::Vec3{raw[0], raw[1], raw[2]};
            input.forward = Forward();
            input.eyeHeight = config.EyeHeightFor(bridge::Current().race);
            input.forwardOffset = camera.forwardOffset;

            const core::EyePlacementOutput placement =
                g_eyePlacement.Solve(input);
            g_eyeHeightInUse.store(input.eyeHeight);

            if (placement.write) {
                const float out[3] = {placement.position.x,
                                      placement.position.y,
                                      placement.position.z};
                const bool written =
                    mem::SafeWrite(positionAddress, out, sizeof(out));
                allOk &= written;
                g_eyePlacementActive.store(written);
            } else {
                // Solve refused: the read was not a plausible position. Leaving
                // the game's own value alone is the correct response.
                g_eyePlacementActive.store(false);
            }
        } else {
            g_eyePlacementActive.store(false);
        }
    }

    if (allOk) {
        g_framesWritten.fetch_add(1);
    } else {
        g_writeFailures.fetch_add(1);
        if (frameIndex - g_lastFailureLogFrame > 600) {
            g_lastFailureLogFrame = frameIndex;
            FPCAM_WARN("camera: one or more field writes failed. The offsets in "
                       "camera.fieldOffsets are probably wrong for this game "
                       "build. Cumulative failures: {}.", g_writeFailures.load());
        }
    }
}

float Yaw() { return g_yaw.load(); }
float Pitch() { return g_pitch.load(); }

core::Vec3 Forward() {
    // The engine's own basis is authoritative when we have it: our yaw is an
    // intention, the decoded matrix is what the camera actually did with it.
    const probe::ViewSample sample = probe::Latest();
    if (sample.valid) return sample.forward;
    return core::ForwardFromYawPitch(g_yaw.load(), g_pitch.load());
}

core::Vec3 Right() {
    const probe::ViewSample sample = probe::Latest();
    if (sample.valid) return sample.right;
    // Derived from yaw alone, so strafing stays horizontal however far up or
    // down the player is looking.
    return core::RightFromYaw(g_yaw.load());
}

Status GetStatus() {
    Status status;
    status.firstPersonEnabled = g_firstPerson.load();
    status.yaw = g_yaw.load();
    status.pitch = g_pitch.load();
    status.framesWritten = g_framesWritten.load();
    status.writeFailures = g_writeFailures.load();
    status.usingProbeBasis = probe::Latest().valid;
    status.eyePlacementActive = g_eyePlacementActive.load();
    status.eyeHeight = g_eyeHeightInUse.load();

    std::scoped_lock lock(g_mutex);
    status.cameraObjectResolved = g_cameraResolved && ResolveCameraObject() != 0;
    status.clampPatchesApplied = !g_clampPatches.empty();
    return status;
}

}  // namespace fpcam::camera
