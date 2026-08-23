// Config.h -- runtime configuration loaded from FPCamera.json.
//
// This header is deliberately free of Windows headers: the parsing lives in
// ConfigParse.cpp and is compiled into the test suite, so hostile and
// malformed configs can be exercised on any host. Only Load() and
// LogEffective(), in Config.cpp, touch the filesystem and the logger.
//
// Everything tunable lives here rather than in the source, for two reasons:
// the correct values differ per game build (field offsets), and the
// comfortable values differ per player (sensitivity, eye height). The file is
// re-readable at runtime via the reload hotkey so the user can tune the camera
// without restarting a two-minute game launch.
#pragma once

#include "core/Angles.h"
#include "core/KeyNames.h"

#include <cstdint>
#include <string>
#include <string_view>

#include <unordered_map>
#include <vector>

namespace fpcam {

// How the plugin defeats the engine's own pitch/zoom limits.
enum class ClampBypass {
    // Write the desired values every frame, after the game's camera update has
    // already clamped them. Simple, needs no extra signatures, and is the
    // default. Can fight the engine visibly if the game re-clamps between our
    // write and the render.
    PostWrite,
    // Neutralise the clamp instructions themselves. Cleaner result, but needs
    // verified signatures for the clamp sites, so it is opt-in.
    PatchClamp,
};

enum class MovementMode {
    // Synthesise gamepad stick input. BG3's controller path already does true
    // analog, camera-relative free movement, so this reuses the engine's own
    // implementation instead of fighting the click-to-move controller.
    XInput,
    // Re-issue a move order towards a point projected ahead of the camera,
    // driven from the Lua side. Keeps the keyboard/mouse UI, but is
    // pathfinder-driven and will stutter on stairs and ledges.
    MoveTo,
    // No movement assistance; camera changes only.
    None,
};

struct HotkeyConfig {
    int toggleFirstPerson = core::vk::kF1;
    int toggleCursorLock  = core::vk::kF2;
    int toggleDiscovery   = core::vk::kF3;
    int reloadConfig      = core::vk::kF4;
    // Runs the in-process self-test and writes FPCamera.selftest.log.
    int runSelfTest       = core::vk::kF7;
    int panicDisable      = core::vk::kF8;
};

struct CameraConfig {
    ClampBypass clampBypass = ClampBypass::PostWrite;

    bool  forceZoom     = true;
    float zoomDistance  = 0.0f;   // metres from the eye point

    // Height of the eye above the character's root/feet position. BG3 has no
    // single "head bone offset" we can read without resolving the skeleton, so
    // this is a per-race approximation, overridable by the player.
    float eyeHeight = 1.62f;
    std::unordered_map<std::string, float> eyeHeightByRace;

    // Pushes the camera forward along its own facing, out of the head mesh.
    float forwardOffset = 0.12f;

    // Near clip plane. Combined with forwardOffset this is the primary fix for
    // the player's own head geometry intersecting the view frustum.
    float nearPlane = 0.15f;

    // 0 leaves the game's field of view alone. A wider FOV is usually wanted
    // in first person than the isometric default.
    float fovOverride = 0.0f;

    float pitchMin = -89.0f;
    float pitchMax =  89.0f;
    bool  invertPitch = false;

    // Byte offsets into the camera structure. These are build-specific and
    // MUST be confirmed against the user's own game; see docs/SIGNATURES.md.
    // A negative value means "this field is unknown, skip writing it".
    // Offsets to dereference in turn, starting from the pointer the
    // CameraManagerInstance signature resolves to, in order to reach the
    // active camera object. Empty means "the signature already points at the
    // camera". Build-specific; see docs/SIGNATURES.md.
    std::vector<int32_t> pointerChain;

    struct FieldOffsets {
        int32_t pitch     = -1;
        int32_t yaw       = -1;
        int32_t distance  = -1;
        int32_t fov       = -1;
        int32_t nearPlane = -1;
        int32_t positionX = -1;  // positionY/Z assumed to follow contiguously
    } offsets;

    // Clamp instruction sites to neutralise when clampBypass is patchClamp.
    // Each names a signature from FPCamera.signatures.json and how many bytes
    // to replace with NOPs. Getting the length wrong corrupts the instruction
    // stream, so this is opt-in and the plugin refuses lengths outside 1..16.
    struct ClampPatch {
        std::string signature;
        int32_t nopLength = 0;
    };
    std::vector<ClampPatch> clampPatches;
};

struct MouseConfig {
    float sensitivity = 0.12f;   // degrees per raw mouse count
    float yawScale    = 1.0f;
    float pitchScale  = 1.0f;

    // Suppresses the game's own camera-rotation handling so it does not fight
    // our per-frame writes. The middle-mouse requirement disappears as a
    // consequence of driving yaw/pitch ourselves, not through a separate patch.
    bool suppressGameCameraRotate = true;

    // Confines and re-centres the OS cursor every frame. This is also what
    // makes the engine's own picking ray originate from the screen centre,
    // which is what fixes first-person targeting -- see Phase 3 in the README.
    bool cursorLock = true;

    // Automatically releases the cursor while a UI panel, dialog or the map is
    // open, using state reported by the Lua side over the bridge.
    bool autoReleaseOnUI = true;
};

struct MovementConfig {
    MovementMode mode = MovementMode::XInput;

    int keyForward = 'W';
    int keyBack    = 'S';
    int keyLeft    = 'A';
    int keyRight   = 'D';
    int keyWalk    = core::vk::kLShift;

    float deadzone        = 0.15f;  // fraction of full stick deflection
    float walkMultiplier  = 0.45f;  // stick magnitude while the walk key is held
    float moveToRateHz    = 10.0f;  // MoveTo mode: move orders per second
    float moveToDistance  = 6.0f;   // MoveTo mode: metres ahead of the camera

    // Report a connected pad from XInputGetCapabilities. Required for BG3 to
    // accept the synthetic stick input at all; the visible cost is that the
    // game switches its prompts to controller glyphs.
    bool reportControllerConnected = true;
};

struct HeadHideConfig {
    // Writes the near clip plane, which together with camera.forwardOffset is
    // what actually keeps the player's own head out of the frame.
    //
    // The experimental head-visual hiding is NOT configured here: it is a Lua
    // client-side concern and is switched on in fpcamera_gameplay.json. Having
    // the same switch in two files meant one of them was always a lie.
    bool nearPlanePush = true;
};

struct BridgeConfig {
    bool  enabled = true;
    float rateHz  = 10.0f;
    // Empty means "use the Script Extender data directory", which is the only
    // place SE's Lua IO is permitted to write. UTF-8.
    std::string directory;
};

struct DiscoveryConfig {
    bool   enabled = false;
    size_t maxCandidates = 32;
    int    logEveryNFrames = 120;
    // Writes every candidate matrix, not just newly-seen ones. Extremely
    // verbose; only useful when hunting a specific constant buffer.
    bool   verbose = false;
};

struct LoggingConfig {
    std::string level = "info";
    // UTF-8; the logger widens it when opening the file.
    std::string file = "FPCamera.log";
    bool console = false;
};

struct Config {
    bool enabled = true;

    LoggingConfig   logging;
    HotkeyConfig    hotkeys;
    CameraConfig    camera;
    MouseConfig     mouse;
    MovementConfig  movement;
    HeadHideConfig  headHide;
    BridgeConfig    bridge;
    DiscoveryConfig discovery;

    // Parse warnings collected during Load(), emitted once the logger exists.
    std::vector<std::string> warnings;

    // Parses `text` as the config document. On any failure the existing values
    // are left untouched and false is returned with a reason in `error`, so a
    // typo in a hot-reloaded config cannot leave the plugin half-configured.
    //
    // Portable and free of file IO -- this is the entry point the tests drive.
    bool ParseFromString(const std::string& text, std::string* error);

    // Reads <plugin dir>/fileName and hands it to ParseFromString.
    bool Load(const std::wstring& fileName);

    // Writes the effective configuration to the log, including which key names
    // were actually recognised. Users mistype hotkeys constantly.
    void LogEffective() const;

    // Eye height for a race name reported by the Lua side, falling back to the
    // global default when the race is unknown.
    float EyeHeightFor(std::string_view race) const;
};

// The process-wide configuration. Guarded only by the fact that writes happen
// on the hotkey thread between frames; readers on the render thread see a
// consistent-enough snapshot for tuning values.
Config& GetConfig();

}  // namespace fpcam
