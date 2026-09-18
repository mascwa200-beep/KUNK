// Config.cpp -- the Windows half of the configuration layer.
//
// Only two things live here: reading the file off disk, and reporting the
// effective settings to the log. All the parsing, validation and clamping is in
// ConfigParse.cpp, which has no platform dependency and is driven directly by
// the test suite.
#include "Config.h"

#include "Common.h"
#include "Logger.h"

#include <fstream>
#include <sstream>

namespace fpcam {
namespace {

Config g_config;

std::string ReadWholeFile(const std::wstring& path, bool* ok) {
    *ok = false;
    std::ifstream stream(path.c_str(), std::ios::binary);
    if (!stream) return {};
    std::ostringstream buffer;
    buffer << stream.rdbuf();
    *ok = true;
    return buffer.str();
}

const char* MovementModeName(MovementMode mode) {
    switch (mode) {
        case MovementMode::XInput: return "xinput";
        case MovementMode::MoveTo: return "moveto";
        case MovementMode::None:   return "none";
    }
    return "?";
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

    std::string error;
    if (!ParseFromString(content, &error)) {
        FPCAM_ERROR("Config file {} could not be parsed: {}. Previous settings "
                    "kept.", WideToUtf8(path), error);
        return false;
    }
    return true;
}

void Config::LogEffective() const {
    for (const std::string& warning : warnings) {
        FPCAM_WARN("config: {}", warning);
    }

    FPCAM_INFO("---------------- EFFECTIVE CONFIG ----------------");
    FPCAM_INFO("enabled            : {}", enabled);
    FPCAM_INFO("hotkeys            : FP={} cursor={} discovery={} reload={} "
               "selftest={} panic={}",
               core::NameFromVirtualKey(hotkeys.toggleFirstPerson),
               core::NameFromVirtualKey(hotkeys.toggleCursorLock),
               core::NameFromVirtualKey(hotkeys.toggleDiscovery),
               core::NameFromVirtualKey(hotkeys.reloadConfig),
               core::NameFromVirtualKey(hotkeys.runSelfTest),
               core::NameFromVirtualKey(hotkeys.panicDisable));
    FPCAM_INFO("camera.clampBypass : {}",
               camera.clampBypass == ClampBypass::PatchClamp ? "patchClamp"
                                                             : "postWrite");
    FPCAM_INFO("camera.eye         : height={:.3f}m forward={:.3f}m "
               "({} race override(s))",
               camera.eyeHeight, camera.forwardOffset,
               camera.eyeHeightByRace.size());
    FPCAM_INFO("camera.zoom/near   : zoom={:.3f} near={:.3f} fov={:.1f}",
               camera.zoomDistance, camera.nearPlane, camera.fovOverride);
    FPCAM_INFO("camera.pitchLimits : [{:.1f}, {:.1f}] inverted={}",
               camera.pitchMin, camera.pitchMax, camera.invertPitch);
    FPCAM_INFO("camera.fieldOffsets: pitch={} yaw={} dist={} fov={} near={} "
               "posX={}  (-1 = unset, field is not written)",
               camera.offsets.pitch, camera.offsets.yaw,
               camera.offsets.distance, camera.offsets.fov,
               camera.offsets.nearPlane, camera.offsets.positionX);
    FPCAM_INFO("camera.pointerChain: {} step(s); {} clamp patch site(s)",
               camera.pointerChain.size(), camera.clampPatches.size());
    FPCAM_INFO("mouse              : sens={:.3f} yaw={:.2f} pitch={:.2f} "
               "lock={} autoRelease={} suppressGameRotate={}",
               mouse.sensitivity, mouse.yawScale, mouse.pitchScale,
               mouse.cursorLock, mouse.autoReleaseOnUI,
               mouse.suppressGameCameraRotate);
    FPCAM_INFO("movement.mode      : {}", MovementModeName(movement.mode));
    FPCAM_INFO("movement.keys      : fwd={} back={} left={} right={} walk={}",
               core::NameFromVirtualKey(movement.keyForward),
               core::NameFromVirtualKey(movement.keyBack),
               core::NameFromVirtualKey(movement.keyLeft),
               core::NameFromVirtualKey(movement.keyRight),
               core::NameFromVirtualKey(movement.keyWalk));
    FPCAM_INFO("headHide           : nearPlanePush={}", headHide.nearPlanePush);
    FPCAM_INFO("bridge             : enabled={} rate={:.1f}Hz",
               bridge.enabled, bridge.rateHz);
    FPCAM_INFO("discovery          : enabled={} maxCandidates={} everyNFrames={}",
               discovery.enabled, discovery.maxCandidates,
               discovery.logEveryNFrames);
    FPCAM_INFO("-------------------------------------------------");
}

}  // namespace fpcam
