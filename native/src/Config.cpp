#include "Config.h"

#include "Logger.h"

#include <nlohmann/json.hpp>

#include <cstdlib>
#include <fstream>
#include <sstream>

namespace fpcam {
namespace {

using json = nlohmann::json;

Config g_config;

std::string ReadWholeFile(const std::wstring& path, bool* ok) {
    *ok = false;
    std::ifstream stream(path, std::ios::binary);
    if (!stream) return {};
    std::ostringstream buffer;
    buffer << stream.rdbuf();
    *ok = true;
    std::string content = buffer.str();
    if (content.size() >= 3 && static_cast<unsigned char>(content[0]) == 0xEF &&
        static_cast<unsigned char>(content[1]) == 0xBB &&
        static_cast<unsigned char>(content[2]) == 0xBF) {
        content.erase(0, 3);
    }
    return content;
}

// Reads a key binding, recording a warning if the name is not recognised so
// the user finds out from the log rather than from a hotkey that does nothing.
int ReadKey(const json& object, const char* field, int fallback,
            std::vector<std::string>& warnings) {
    const auto it = object.find(field);
    if (it == object.end() || !it->is_string()) return fallback;

    const std::string name = it->get<std::string>();
    const int vk = VirtualKeyFromName(name);
    if (vk == 0) {
        warnings.push_back(std::string("hotkey '") + field + "': unrecognised key name '" +
                           name + "'; keeping the default " +
                           NameFromVirtualKey(fallback));
        return fallback;
    }
    return vk;
}

const json* FindObject(const json& parent, const char* key) {
    const auto it = parent.find(key);
    if (it == parent.end() || !it->is_object()) return nullptr;
    return &(*it);
}

}  // namespace

Config& GetConfig() { return g_config; }

bool Config::Load(const std::wstring& fileName) {
    const std::wstring path = PluginDirectory() + fileName;

    bool readOk = false;
    const std::string content = ReadWholeFile(path, &readOk);
    if (!readOk) {
        FPCAM_ERROR("Config file not found: {}. Falling back to built-in "
                    "defaults, which will not have correct field offsets for "
                    "your game build.", WideToUtf8(path));
        return false;
    }

    json root;
    try {
        root = json::parse(content, nullptr, true, /*ignore_comments=*/true);
    } catch (const json::exception& e) {
        FPCAM_ERROR("Config file {} is not valid JSON: {}. Previous settings "
                    "kept.", WideToUtf8(path), e.what());
        return false;
    }

    // Parse into a scratch copy first: a partially-applied config after a bad
    // edit is worse than no reload at all.
    Config parsed;
    parsed.warnings.clear();

    parsed.enabled = root.value("enabled", true);

    if (const json* logging = FindObject(root, "logging")) {
        parsed.logging.level = logging->value("level", std::string("info"));
        parsed.logging.file =
            Utf8ToWide(logging->value("file", std::string("FPCamera.log")));
        parsed.logging.console = logging->value("console", false);
    }

    if (const json* hotkeys = FindObject(root, "hotkeys")) {
        parsed.hotkeys.toggleFirstPerson =
            ReadKey(*hotkeys, "toggleFirstPerson", VK_F1, parsed.warnings);
        parsed.hotkeys.toggleCursorLock =
            ReadKey(*hotkeys, "toggleCursorLock", VK_F2, parsed.warnings);
        parsed.hotkeys.toggleDiscovery =
            ReadKey(*hotkeys, "toggleDiscovery", VK_F3, parsed.warnings);
        parsed.hotkeys.reloadConfig =
            ReadKey(*hotkeys, "reloadConfig", VK_F4, parsed.warnings);
        parsed.hotkeys.panicDisable =
            ReadKey(*hotkeys, "panicDisable", VK_F8, parsed.warnings);
    }

    if (const json* camera = FindObject(root, "camera")) {
        const std::string bypass =
            camera->value("clampBypass", std::string("postWrite"));
        if (bypass == "patchClamp") {
            parsed.camera.clampBypass = ClampBypass::PatchClamp;
        } else if (bypass == "postWrite") {
            parsed.camera.clampBypass = ClampBypass::PostWrite;
        } else {
            parsed.warnings.push_back("camera.clampBypass: unknown value '" +
                                      bypass + "'; using postWrite");
        }

        parsed.camera.forceZoom     = camera->value("forceZoom", true);
        parsed.camera.zoomDistance  = camera->value("zoomDistance", 0.0f);
        parsed.camera.eyeHeight     = camera->value("eyeHeight", 1.62f);
        parsed.camera.forwardOffset = camera->value("forwardOffset", 0.12f);
        parsed.camera.nearPlane     = camera->value("nearPlane", 0.15f);
        parsed.camera.fovOverride   = camera->value("fovOverride", 0.0f);
        parsed.camera.invertPitch   = camera->value("invertPitch", false);

        if (const json* limits = FindObject(*camera, "pitchLimits")) {
            parsed.camera.pitchMin = limits->value("min", -89.0f);
            parsed.camera.pitchMax = limits->value("max",  89.0f);
        }
        if (parsed.camera.pitchMin >= parsed.camera.pitchMax) {
            parsed.warnings.push_back(
                "camera.pitchLimits: min >= max; reverting to -89/89");
            parsed.camera.pitchMin = -89.0f;
            parsed.camera.pitchMax = 89.0f;
        }

        if (const json* races = FindObject(*camera, "eyeHeightByRace")) {
            for (const auto& [race, height] : races->items()) {
                if (height.is_number()) {
                    parsed.camera.eyeHeightByRace[race] = height.get<float>();
                }
            }
        }

        if (const json* offsets = FindObject(*camera, "fieldOffsets")) {
            auto readOffset = [&](const char* key, int32_t& target) {
                const auto it = offsets->find(key);
                if (it == offsets->end()) return;
                if (it->is_string()) {
                    const std::string text = it->get<std::string>();
                    target = static_cast<int32_t>(
                        std::strtol(text.c_str(), nullptr, 0));
                } else if (it->is_number_integer()) {
                    target = it->get<int32_t>();
                }
            };
            readOffset("pitch",     parsed.camera.offsets.pitch);
            readOffset("yaw",       parsed.camera.offsets.yaw);
            readOffset("distance",  parsed.camera.offsets.distance);
            readOffset("fov",       parsed.camera.offsets.fov);
            readOffset("nearPlane", parsed.camera.offsets.nearPlane);
            readOffset("positionX", parsed.camera.offsets.positionX);
        }

        if (const auto it = camera->find("pointerChain");
            it != camera->end() && it->is_array()) {
            for (const json& step : *it) {
                if (step.is_string()) {
                    parsed.camera.pointerChain.push_back(static_cast<int32_t>(
                        std::strtol(step.get<std::string>().c_str(), nullptr, 0)));
                } else if (step.is_number_integer()) {
                    parsed.camera.pointerChain.push_back(step.get<int32_t>());
                }
            }
        }

        if (const auto it = camera->find("clampPatches");
            it != camera->end() && it->is_array()) {
            for (const json& entry : *it) {
                if (!entry.is_object()) continue;
                CameraConfig::ClampPatch patch;
                patch.signature = entry.value("signature", std::string());
                patch.nopLength = entry.value("nopLength", int32_t{0});
                if (patch.signature.empty()) continue;
                if (patch.nopLength < 1 || patch.nopLength > 16) {
                    parsed.warnings.push_back(
                        "camera.clampPatches['" + patch.signature +
                        "']: nopLength must be between 1 and 16; entry ignored");
                    continue;
                }
                parsed.camera.clampPatches.push_back(std::move(patch));
            }
        }
    }

    if (const json* mouse = FindObject(root, "mouse")) {
        parsed.mouse.sensitivity = mouse->value("sensitivity", 0.12f);
        parsed.mouse.yawScale    = mouse->value("yawScale", 1.0f);
        parsed.mouse.pitchScale  = mouse->value("pitchScale", 1.0f);
        parsed.mouse.suppressGameCameraRotate =
            mouse->value("suppressGameCameraRotate", true);
        parsed.mouse.cursorLock = mouse->value("cursorLock", true);
        parsed.mouse.autoReleaseOnUI = mouse->value("autoReleaseOnUI", true);

        if (parsed.mouse.sensitivity <= 0.0f) {
            parsed.warnings.push_back(
                "mouse.sensitivity must be positive; using 0.12");
            parsed.mouse.sensitivity = 0.12f;
        }
    }

    if (const json* movement = FindObject(root, "movement")) {
        const std::string mode =
            movement->value("mode", std::string("xinput"));
        if (mode == "xinput") {
            parsed.movement.mode = MovementMode::XInput;
        } else if (mode == "moveto") {
            parsed.movement.mode = MovementMode::MoveTo;
        } else if (mode == "none") {
            parsed.movement.mode = MovementMode::None;
        } else {
            parsed.warnings.push_back("movement.mode: unknown value '" + mode +
                                      "'; using xinput");
        }

        if (const json* keys = FindObject(*movement, "keys")) {
            parsed.movement.keyForward =
                ReadKey(*keys, "forward", 'W', parsed.warnings);
            parsed.movement.keyBack =
                ReadKey(*keys, "back", 'S', parsed.warnings);
            parsed.movement.keyLeft =
                ReadKey(*keys, "left", 'A', parsed.warnings);
            parsed.movement.keyRight =
                ReadKey(*keys, "right", 'D', parsed.warnings);
            parsed.movement.keyWalk =
                ReadKey(*keys, "walk", VK_LSHIFT, parsed.warnings);
        }

        parsed.movement.deadzone = Clamp(
            movement->value("deadzone", 0.15f), 0.0f, 0.9f);
        parsed.movement.walkMultiplier = Clamp(
            movement->value("walkMultiplier", 0.45f), 0.05f, 1.0f);
        parsed.movement.moveToRateHz = Clamp(
            movement->value("moveToRateHz", 10.0f), 1.0f, 60.0f);
        parsed.movement.moveToDistance = Clamp(
            movement->value("moveToDistance", 6.0f), 0.5f, 30.0f);
        parsed.movement.reportControllerConnected =
            movement->value("reportControllerConnected", true);
    }

    if (const json* headHide = FindObject(root, "headHide")) {
        parsed.headHide.nearPlanePush = headHide->value("nearPlanePush", true);
        parsed.headHide.luaHeadHide   = headHide->value("luaHeadHide", false);
    }

    if (const json* bridge = FindObject(root, "bridge")) {
        parsed.bridge.enabled = bridge->value("enabled", true);
        parsed.bridge.rateHz =
            Clamp(bridge->value("rateHz", 10.0f), 1.0f, 60.0f);
        parsed.bridge.directory =
            Utf8ToWide(bridge->value("directory", std::string()));
    }

    if (const json* discovery = FindObject(root, "discovery")) {
        parsed.discovery.enabled = discovery->value("enabled", false);
        parsed.discovery.maxCandidates =
            discovery->value("maxCandidates", size_t{32});
        parsed.discovery.logEveryNFrames =
            discovery->value("logEveryNFrames", 120);
        parsed.discovery.verbose = discovery->value("verbose", false);
        if (parsed.discovery.logEveryNFrames < 1) {
            parsed.discovery.logEveryNFrames = 1;
        }
    }

    *this = std::move(parsed);
    return true;
}

float Config::EyeHeightFor(std::string_view race) const {
    if (race.empty()) return camera.eyeHeight;
    const auto it = camera.eyeHeightByRace.find(std::string(race));
    return it == camera.eyeHeightByRace.end() ? camera.eyeHeight : it->second;
}

void Config::LogEffective() const {
    for (const std::string& warning : warnings) {
        FPCAM_WARN("config: {}", warning);
    }

    FPCAM_INFO("---------------- EFFECTIVE CONFIG ----------------");
    FPCAM_INFO("enabled            : {}", enabled);
    FPCAM_INFO("hotkeys            : FP={} cursor={} discovery={} reload={} panic={}",
               NameFromVirtualKey(hotkeys.toggleFirstPerson),
               NameFromVirtualKey(hotkeys.toggleCursorLock),
               NameFromVirtualKey(hotkeys.toggleDiscovery),
               NameFromVirtualKey(hotkeys.reloadConfig),
               NameFromVirtualKey(hotkeys.panicDisable));
    FPCAM_INFO("camera.clampBypass : {}",
               camera.clampBypass == ClampBypass::PatchClamp ? "patchClamp"
                                                             : "postWrite");
    FPCAM_INFO("camera.eyeHeight   : {:.3f} m (+{} race override(s))",
               camera.eyeHeight, camera.eyeHeightByRace.size());
    FPCAM_INFO("camera.zoom/near   : zoom={:.3f} forward={:.3f} near={:.3f} fov={:.1f}",
               camera.zoomDistance, camera.forwardOffset, camera.nearPlane,
               camera.fovOverride);
    FPCAM_INFO("camera.pitchLimits : [{:.1f}, {:.1f}] inverted={}",
               camera.pitchMin, camera.pitchMax, camera.invertPitch);
    FPCAM_INFO("camera.fieldOffsets: pitch={:#x} yaw={:#x} dist={:#x} fov={:#x} "
               "near={:#x} posX={:#x}  (-1 = unset, field will not be written)",
               camera.offsets.pitch, camera.offsets.yaw, camera.offsets.distance,
               camera.offsets.fov, camera.offsets.nearPlane,
               camera.offsets.positionX);
    FPCAM_INFO("camera.pointerChain: {} step(s); {} clamp patch site(s)",
               camera.pointerChain.size(), camera.clampPatches.size());
    FPCAM_INFO("mouse              : sens={:.3f} yaw={:.2f} pitch={:.2f} "
               "lock={} autoRelease={} suppressGameRotate={}",
               mouse.sensitivity, mouse.yawScale, mouse.pitchScale,
               mouse.cursorLock, mouse.autoReleaseOnUI,
               mouse.suppressGameCameraRotate);
    FPCAM_INFO("movement.mode      : {}",
               movement.mode == MovementMode::XInput  ? "xinput"
               : movement.mode == MovementMode::MoveTo ? "moveto"
                                                       : "none");
    FPCAM_INFO("movement.keys      : fwd={} back={} left={} right={} walk={}",
               NameFromVirtualKey(movement.keyForward),
               NameFromVirtualKey(movement.keyBack),
               NameFromVirtualKey(movement.keyLeft),
               NameFromVirtualKey(movement.keyRight),
               NameFromVirtualKey(movement.keyWalk));
    FPCAM_INFO("bridge             : enabled={} rate={:.1f}Hz",
               bridge.enabled, bridge.rateHz);
    FPCAM_INFO("discovery          : enabled={} maxCandidates={} everyNFrames={}",
               discovery.enabled, discovery.maxCandidates,
               discovery.logEveryNFrames);
    FPCAM_INFO("-------------------------------------------------");
}

}  // namespace fpcam
