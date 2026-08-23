// ConfigParse.cpp -- the portable half of the configuration layer.
//
// No Windows headers, no filesystem, no logger: this takes the config document
// as a string and produces a Config, collecting human-readable warnings along
// the way. That is what makes it testable, and the config parser is worth
// testing because it is the one component that consumes untrusted input --
// a hand-edited file, often edited wrongly, feeding values that end up being
// written into a live game process.
//
// The contract every field follows: an absent key keeps the default, a
// wrong-typed key keeps the default, and an out-of-range value is clamped with
// a warning. Nothing here throws, and nothing leaves the Config half-updated --
// parsing fills a scratch copy that is only committed on success.
#include "Config.h"

#include <nlohmann/json.hpp>

#include <cstdlib>

namespace fpcam {
namespace {

using json = nlohmann::json;

const json* FindObject(const json& parent, const char* key) {
    const auto it = parent.find(key);
    if (it == parent.end() || !it->is_object()) return nullptr;
    return &(*it);
}

// Reads a key binding, recording a warning when the name is not recognised so
// the user finds out from the log rather than from a hotkey that does nothing.
int ReadKey(const json& object, const char* field, int fallback,
            std::vector<std::string>& warnings) {
    const auto it = object.find(field);
    if (it == object.end() || !it->is_string()) return fallback;

    const std::string name = it->get<std::string>();
    const int virtualKey = core::VirtualKeyFromName(name);
    if (virtualKey == 0) {
        warnings.push_back(std::string("hotkey '") + field +
                           "': unrecognised key name '" + name +
                           "'; keeping the default " +
                           core::NameFromVirtualKey(fallback));
        return fallback;
    }
    return virtualKey;
}

// Offsets are accepted as either a hex string ("0x120") or an integer, because
// every tool that reports them -- Cheat Engine, Ghidra, IDA -- shows hex.
void ReadOffset(const json& object, const char* key, int32_t* target) {
    const auto it = object.find(key);
    if (it == object.end()) return;
    if (it->is_string()) {
        const std::string text = it->get<std::string>();
        if (text.empty()) return;
        *target = static_cast<int32_t>(std::strtol(text.c_str(), nullptr, 0));
    } else if (it->is_number_integer()) {
        *target = it->get<int32_t>();
    }
}

float ReadFloat(const json& object, const char* key, float fallback) {
    const auto it = object.find(key);
    if (it == object.end() || !it->is_number()) return fallback;
    const double value = it->get<double>();
    if (!std::isfinite(value)) return fallback;

    // Check finiteness *after* narrowing, not before. A value like 1e39 is a
    // perfectly finite double and parses without complaint, but overflows to
    // infinity the moment it becomes a float -- and an infinity written into
    // the game's camera is a crash, not a visual glitch. Testing the double
    // alone let that straight through.
    const float narrowed = static_cast<float>(value);
    if (!std::isfinite(narrowed)) return fallback;
    return narrowed;
}

// Clamps with a warning, so a silently corrected value is still visible.
float ClampWarn(float value, float low, float high, const char* what,
                std::vector<std::string>& warnings) {
    const float clamped = core::Clamp(value, low, high);
    if (clamped != value) {
        warnings.push_back(std::string(what) + ": " + std::to_string(value) +
                           " is out of range [" + std::to_string(low) + ", " +
                           std::to_string(high) + "]; using " +
                           std::to_string(clamped));
    }
    return clamped;
}

}  // namespace

bool Config::ParseFromString(const std::string& text, std::string* error) {
    if (error != nullptr) error->clear();

    std::string content = text;
    // Strip a UTF-8 BOM. Users editing these files in Notepad add one, and a
    // strict JSON parser rejects it -- which reads as "your config is broken"
    // when nothing about it is.
    if (content.size() >= 3 &&
        static_cast<unsigned char>(content[0]) == 0xEF &&
        static_cast<unsigned char>(content[1]) == 0xBB &&
        static_cast<unsigned char>(content[2]) == 0xBF) {
        content.erase(0, 3);
    }

    json root;
    try {
        root = json::parse(content, nullptr, true, /*ignore_comments=*/true);
    } catch (const json::exception& e) {
        if (error != nullptr) *error = e.what();
        return false;
    }
    if (!root.is_object()) {
        if (error != nullptr) *error = "top level of the config is not an object";
        return false;
    }

    // Parse into a scratch copy: a partially applied config after a bad edit is
    // worse than no reload at all.
    Config parsed;
    parsed.enabled = root.value("enabled", true);

    if (const json* logging = FindObject(root, "logging")) {
        parsed.logging.level = logging->value("level", std::string("info"));
        parsed.logging.file = logging->value("file", std::string("FPCamera.log"));
        parsed.logging.console = logging->value("console", false);
    }

    if (const json* hotkeys = FindObject(root, "hotkeys")) {
        parsed.hotkeys.toggleFirstPerson = ReadKey(
            *hotkeys, "toggleFirstPerson", core::vk::kF1, parsed.warnings);
        parsed.hotkeys.toggleCursorLock = ReadKey(
            *hotkeys, "toggleCursorLock", core::vk::kF2, parsed.warnings);
        parsed.hotkeys.toggleDiscovery = ReadKey(
            *hotkeys, "toggleDiscovery", core::vk::kF3, parsed.warnings);
        parsed.hotkeys.reloadConfig = ReadKey(
            *hotkeys, "reloadConfig", core::vk::kF4, parsed.warnings);
        parsed.hotkeys.runSelfTest = ReadKey(
            *hotkeys, "runSelfTest", core::vk::kF7, parsed.warnings);
        parsed.hotkeys.panicDisable = ReadKey(
            *hotkeys, "panicDisable", core::vk::kF8, parsed.warnings);
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

        parsed.camera.forceZoom = camera->value("forceZoom", true);
        parsed.camera.zoomDistance = ClampWarn(
            ReadFloat(*camera, "zoomDistance", 0.0f), -50.0f, 50.0f,
            "camera.zoomDistance", parsed.warnings);
        parsed.camera.invertPitch  = camera->value("invertPitch", false);

        parsed.camera.eyeHeight = ClampWarn(
            ReadFloat(*camera, "eyeHeight", 1.62f), 0.0f, 5.0f,
            "camera.eyeHeight", parsed.warnings);
        parsed.camera.forwardOffset = ClampWarn(
            ReadFloat(*camera, "forwardOffset", 0.12f), -2.0f, 2.0f,
            "camera.forwardOffset", parsed.warnings);
        parsed.camera.nearPlane = ClampWarn(
            ReadFloat(*camera, "nearPlane", 0.15f), 0.001f, 10.0f,
            "camera.nearPlane", parsed.warnings);
        parsed.camera.fovOverride = ClampWarn(
            ReadFloat(*camera, "fovOverride", 0.0f), 0.0f, 179.0f,
            "camera.fovOverride", parsed.warnings);

        if (const json* limits = FindObject(*camera, "pitchLimits")) {
            parsed.camera.pitchMin = ReadFloat(*limits, "min", -89.0f);
            parsed.camera.pitchMax = ReadFloat(*limits, "max", 89.0f);
        }
        if (!(parsed.camera.pitchMin < parsed.camera.pitchMax)) {
            parsed.warnings.push_back(
                "camera.pitchLimits: min must be below max; reverting to "
                "-89/89");
            parsed.camera.pitchMin = -89.0f;
            parsed.camera.pitchMax = 89.0f;
        }
        parsed.camera.pitchMin =
            core::Clamp(parsed.camera.pitchMin, -89.9f, 89.9f);
        parsed.camera.pitchMax =
            core::Clamp(parsed.camera.pitchMax, -89.9f, 89.9f);

        if (const json* races = FindObject(*camera, "eyeHeightByRace")) {
            for (const auto& [race, height] : races->items()) {
                if (!height.is_number()) continue;
                const double value = height.get<double>();
                if (!std::isfinite(value) || value < 0.0 || value > 5.0) {
                    parsed.warnings.push_back(
                        "camera.eyeHeightByRace['" + race +
                        "']: out of range; ignored");
                    continue;
                }
                parsed.camera.eyeHeightByRace[race] =
                    static_cast<float>(value);
            }
        }

        if (const json* offsets = FindObject(*camera, "fieldOffsets")) {
            ReadOffset(*offsets, "pitch",     &parsed.camera.offsets.pitch);
            ReadOffset(*offsets, "yaw",       &parsed.camera.offsets.yaw);
            ReadOffset(*offsets, "distance",  &parsed.camera.offsets.distance);
            ReadOffset(*offsets, "fov",       &parsed.camera.offsets.fov);
            ReadOffset(*offsets, "nearPlane", &parsed.camera.offsets.nearPlane);
            ReadOffset(*offsets, "positionX", &parsed.camera.offsets.positionX);
        }

        if (const auto it = camera->find("pointerChain");
            it != camera->end() && it->is_array()) {
            for (const json& step : *it) {
                if (step.is_string()) {
                    parsed.camera.pointerChain.push_back(static_cast<int32_t>(
                        std::strtol(step.get<std::string>().c_str(), nullptr,
                                    0)));
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
        parsed.mouse.sensitivity = ClampWarn(
            ReadFloat(*mouse, "sensitivity", 0.12f), 0.001f, 10.0f,
            "mouse.sensitivity", parsed.warnings);
        parsed.mouse.yawScale = ClampWarn(
            ReadFloat(*mouse, "yawScale", 1.0f), -10.0f, 10.0f,
            "mouse.yawScale", parsed.warnings);
        parsed.mouse.pitchScale = ClampWarn(
            ReadFloat(*mouse, "pitchScale", 1.0f), -10.0f, 10.0f,
            "mouse.pitchScale", parsed.warnings);
        parsed.mouse.suppressGameCameraRotate =
            mouse->value("suppressGameCameraRotate", true);
        parsed.mouse.cursorLock = mouse->value("cursorLock", true);
        parsed.mouse.autoReleaseOnUI = mouse->value("autoReleaseOnUI", true);
    }

    if (const json* movement = FindObject(root, "movement")) {
        const std::string mode = movement->value("mode", std::string("xinput"));
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
                ReadKey(*keys, "walk", core::vk::kLShift, parsed.warnings);
        }

        parsed.movement.deadzone = ClampWarn(
            ReadFloat(*movement, "deadzone", 0.15f), 0.0f, 0.9f,
            "movement.deadzone", parsed.warnings);
        parsed.movement.walkMultiplier = ClampWarn(
            ReadFloat(*movement, "walkMultiplier", 0.45f), 0.05f, 1.0f,
            "movement.walkMultiplier", parsed.warnings);
        parsed.movement.moveToRateHz = ClampWarn(
            ReadFloat(*movement, "moveToRateHz", 10.0f), 1.0f, 60.0f,
            "movement.moveToRateHz", parsed.warnings);
        parsed.movement.moveToDistance = ClampWarn(
            ReadFloat(*movement, "moveToDistance", 6.0f), 0.5f, 30.0f,
            "movement.moveToDistance", parsed.warnings);
        parsed.movement.reportControllerConnected =
            movement->value("reportControllerConnected", true);
    }

    if (const json* headHide = FindObject(root, "headHide")) {
        parsed.headHide.nearPlanePush = headHide->value("nearPlanePush", true);
        if (headHide->contains("luaHeadHide")) {
            parsed.warnings.push_back(
                "headHide.luaHeadHide has moved to headHide.enabled in "
                "fpcamera_gameplay.json (the Lua side owns it); the key here "
                "is ignored");
        }
    }

    if (const json* bridge = FindObject(root, "bridge")) {
        parsed.bridge.enabled = bridge->value("enabled", true);
        parsed.bridge.rateHz = ClampWarn(
            ReadFloat(*bridge, "rateHz", 10.0f), 1.0f, 60.0f, "bridge.rateHz",
            parsed.warnings);
        parsed.bridge.directory = bridge->value("directory", std::string());
    }

    if (const json* discovery = FindObject(root, "discovery")) {
        parsed.discovery.enabled = discovery->value("enabled", false);
        parsed.discovery.verbose = discovery->value("verbose", false);

        const auto maxCandidates =
            discovery->value("maxCandidates", int64_t{32});
        parsed.discovery.maxCandidates = static_cast<size_t>(
            core::Clamp<int64_t>(maxCandidates, 1, 4096));

        const auto everyN = discovery->value("logEveryNFrames", int64_t{120});
        parsed.discovery.logEveryNFrames = static_cast<int>(
            core::Clamp<int64_t>(everyN, 1, 100000));
    }

    *this = std::move(parsed);
    return true;
}

float Config::EyeHeightFor(std::string_view race) const {
    if (race.empty()) return camera.eyeHeight;
    const auto it = camera.eyeHeightByRace.find(std::string(race));
    return it == camera.eyeHeightByRace.end() ? camera.eyeHeight : it->second;
}

}  // namespace fpcam
