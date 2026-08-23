#include "Bridge.h"

#include "CameraHook.h"
#include "Config.h"
#include "InputHook.h"
#include "Logger.h"
#include "XInputSpoof.h"

#include <nlohmann/json.hpp>

#include <atomic>
#include <chrono>
#include <fstream>
#include <mutex>
#include <sstream>
#include <thread>

namespace fpcam::bridge {
namespace {

using json = nlohmann::json;

constexpr wchar_t kNativeToLuaFile[] = L"fpcamera_native.json";
constexpr wchar_t kLuaToNativeFile[] = L"fpcamera_lua.json";

std::wstring g_directory;
std::thread g_thread;
std::atomic<bool> g_running{false};

std::mutex g_stateMutex;
LuaState g_luaState;

// Rewrites `path` atomically: SE's Lua can read this file at any moment, and a
// half-written file parses as a Lua error rather than as stale data.
bool WriteFileAtomic(const std::wstring& path, const std::string& content) {
    const std::wstring temporary = path + L".tmp";
    {
        std::ofstream stream(temporary, std::ios::binary | std::ios::trunc);
        if (!stream) return false;
        stream.write(content.data(),
                     static_cast<std::streamsize>(content.size()));
        if (!stream) return false;
    }
    return ::MoveFileExW(temporary.c_str(), path.c_str(),
                         MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) != 0;
}

bool ReadFileText(const std::wstring& path, std::string* out) {
    std::ifstream stream(path, std::ios::binary);
    if (!stream) return false;
    std::ostringstream buffer;
    buffer << stream.rdbuf();
    *out = buffer.str();
    return true;
}

void PublishNativeState() {
    const camera::Status cameraStatus = camera::GetStatus();
    const xinput::Status padStatus = xinput::GetStatus();
    const Config& config = GetConfig();

    float forward[3] = {0.0f, 0.0f, 1.0f};
    float right[3] = {1.0f, 0.0f, 0.0f};
    camera::GetForward(forward);
    camera::GetRight(right);

    const json document = {
        {"schemaVersion", 1},
        {"firstPerson", cameraStatus.firstPersonEnabled},
        {"cameraObjectResolved", cameraStatus.cameraObjectResolved},
        {"usingProbeBasis", cameraStatus.usingProbeBasis},
        {"cursorLocked", input::CursorCurrentlyLocked()},
        {"yaw", cameraStatus.yaw},
        {"pitch", cameraStatus.pitch},
        {"forward", {forward[0], forward[1], forward[2]}},
        {"right", {right[0], right[1], right[2]}},
        {"movementMode",
         config.movement.mode == MovementMode::XInput  ? "xinput"
         : config.movement.mode == MovementMode::MoveTo ? "moveto"
                                                        : "none"},
        {"xinputInjecting", padStatus.injecting},
        {"moveToDistance", config.movement.moveToDistance},
        {"moveToRateHz", config.movement.moveToRateHz},
        {"interactAssist", true},
    };

    const std::wstring path = g_directory + kNativeToLuaFile;
    if (!WriteFileAtomic(path, document.dump())) {
        static bool complained = false;
        if (!complained) {
            complained = true;
            FPCAM_WARN("bridge: could not write {}. The Lua side will run "
                       "without camera heading; `moveto` movement and the "
                       "automatic cursor release will not work.",
                       WideToUtf8(path));
        }
    }
}

void ConsumeLuaState() {
    std::string content;
    if (!ReadFileText(g_directory + kLuaToNativeFile, &content)) return;
    if (content.empty()) return;

    json document;
    try {
        document = json::parse(content);
    } catch (const json::exception&) {
        // A torn read is normal if the Lua side is mid-write; the next tick
        // picks it up. Not worth logging at 10 Hz.
        return;
    }

    LuaState state;
    state.valid = true;
    state.uiOpen = document.value("uiOpen", false);
    state.inDialog = document.value("inDialog", false);
    state.inCombat = document.value("inCombat", false);
    state.controlledCharacter =
        document.value("controlledCharacter", std::string());
    state.race = document.value("race", std::string());
    state.sequence = document.value("sequence", uint64_t{0});

    if (const auto it = document.find("position");
        it != document.end() && it->is_array() && it->size() == 3) {
        for (size_t i = 0; i < 3; ++i) {
            state.characterPosition[i] = (*it)[i].get<float>();
        }
    }

    {
        std::scoped_lock lock(g_stateMutex);
        g_luaState = state;
    }

    // The cursor must be released while the player is in a menu or a dialogue,
    // or the game becomes unusable the first time an inventory opens.
    input::SetUIOpen(state.uiOpen || state.inDialog);
}

void ExchangeLoop() {
    FPCAM_INFO("bridge: exchange thread started in {}.", WideToUtf8(g_directory));

    while (g_running.load()) {
        const float rate = Clamp(GetConfig().bridge.rateHz, 1.0f, 60.0f);
        const auto period =
            std::chrono::milliseconds(static_cast<int>(1000.0f / rate));

        PublishNativeState();
        ConsumeLuaState();

        std::this_thread::sleep_for(period);
    }

    FPCAM_INFO("bridge: exchange thread stopped.");
}

}  // namespace

bool Start() {
    if (g_running.load()) return true;

    const BridgeConfig& config = GetConfig().bridge;
    if (!config.enabled) {
        FPCAM_INFO("bridge: disabled in config.");
        return false;
    }

    g_directory = config.directory.empty() ? ScriptExtenderDataDirectory()
                                           : config.directory;
    if (g_directory.empty()) {
        FPCAM_ERROR("bridge: could not resolve the Script Extender data "
                    "directory. Set bridge.directory in FPCamera.json to point "
                    "at it manually.");
        return false;
    }
    if (g_directory.back() != L'\\' && g_directory.back() != L'/') {
        g_directory += L'\\';
    }

    // SE creates this directory itself, but the plugin can start first.
    ::CreateDirectoryW(g_directory.c_str(), nullptr);

    g_running.store(true);
    g_thread = std::thread(&ExchangeLoop);
    return true;
}

void Stop() {
    if (!g_running.exchange(false)) return;
    if (g_thread.joinable()) g_thread.join();
}

LuaState Current() {
    std::scoped_lock lock(g_stateMutex);
    return g_luaState;
}

const std::wstring& Directory() { return g_directory; }

}  // namespace fpcam::bridge
