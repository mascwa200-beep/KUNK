#include "XInputSpoof.h"

#include "CameraHook.h"
#include "Config.h"
#include "D3D11Hook.h"
#include "Logger.h"

#include <Xinput.h>

#include <MinHook.h>

#include <atomic>
#include <cmath>
#include <cstdlib>

namespace fpcam::xinput {
namespace {

using GetStateFn = DWORD(WINAPI*)(DWORD, XINPUT_STATE*);
using GetCapabilitiesFn = DWORD(WINAPI*)(DWORD, DWORD, XINPUT_CAPABILITIES*);

GetStateFn g_originalGetState = nullptr;
GetCapabilitiesFn g_originalGetCapabilities = nullptr;

void* g_getStateTarget = nullptr;
void* g_getCapabilitiesTarget = nullptr;

bool g_installed = false;

std::atomic<bool> g_injecting{false};
std::atomic<bool> g_physicalPad{false};
std::atomic<uint64_t> g_statesServed{0};
std::atomic<float> g_lastStickX{0.0f};
std::atomic<float> g_lastStickY{0.0f};

DWORD g_packetNumber = 1;
SHORT g_lastThumbLX = 0;
SHORT g_lastThumbLY = 0;

// Only inject while the game window is the one the player is actually typing
// into -- otherwise alt-tabbing away leaves the character walking into a wall.
bool GameHasFocus() {
    const HWND window = d3d11::Window();
    if (window == nullptr) return false;
    return ::GetForegroundWindow() == window;
}

bool ShouldInject() {
    const Config& config = GetConfig();
    if (!config.enabled) return false;
    if (config.movement.mode != MovementMode::XInput) return false;
    if (!camera::FirstPersonEnabled()) return false;
    if (!GameHasFocus()) return false;
    return true;
}

bool KeyDown(int virtualKey) {
    if (virtualKey == 0) return false;
    return (::GetAsyncKeyState(virtualKey) & 0x8000) != 0;
}

// Builds the left-stick deflection from WASD.
//
// Note what is deliberately absent: any transform into world space. BG3's
// controller path already interprets the left stick relative to the current
// camera, so "W" means "the direction the camera is facing" without this code
// knowing anything about the camera at all. That is the entire reason this
// mode exists.
void BuildStick(SHORT* thumbLX, SHORT* thumbLY) {
    const MovementConfig& movement = GetConfig().movement;

    float x = 0.0f;
    float y = 0.0f;
    if (KeyDown(movement.keyForward)) y += 1.0f;
    if (KeyDown(movement.keyBack))    y -= 1.0f;
    if (KeyDown(movement.keyRight))   x += 1.0f;
    if (KeyDown(movement.keyLeft))    x -= 1.0f;

    // Normalise so diagonals are not faster than the cardinals, which is what
    // a real stick would do at full deflection.
    const float length = std::sqrt(x * x + y * y);
    if (length > 1.0f) {
        x /= length;
        y /= length;
    }

    float magnitude = KeyDown(movement.keyWalk) ? movement.walkMultiplier : 1.0f;

    // Push past the engine's own stick deadzone: a real thumbstick rests near
    // zero and BG3 discards small deflections, so a keyboard "half press" has
    // to start above that threshold to register at all.
    if (length > 0.0f) {
        const float floorValue = movement.deadzone + 0.05f;
        magnitude = floorValue + magnitude * (1.0f - floorValue);
    } else {
        magnitude = 0.0f;
    }

    x *= magnitude;
    y *= magnitude;

    g_lastStickX.store(x);
    g_lastStickY.store(y);

    constexpr float kMaxDeflection = 32767.0f;
    *thumbLX = static_cast<SHORT>(Clamp(x, -1.0f, 1.0f) * kMaxDeflection);
    *thumbLY = static_cast<SHORT>(Clamp(y, -1.0f, 1.0f) * kMaxDeflection);
}

bool StickOutsideDeadzone(const XINPUT_GAMEPAD& pad) {
    const int deadzone = XINPUT_GAMEPAD_LEFT_THUMB_DEADZONE;
    return std::abs(static_cast<int>(pad.sThumbLX)) > deadzone ||
           std::abs(static_cast<int>(pad.sThumbLY)) > deadzone ||
           pad.wButtons != 0;
}

DWORD WINAPI HookedGetState(DWORD userIndex, XINPUT_STATE* state) {
    const DWORD originalResult =
        g_originalGetState != nullptr
            ? g_originalGetState(userIndex, state)
            : static_cast<DWORD>(ERROR_DEVICE_NOT_CONNECTED);

    if (userIndex != 0 || state == nullptr) return originalResult;

    const bool physicalConnected = (originalResult == ERROR_SUCCESS);
    g_physicalPad.store(physicalConnected);

    if (!ShouldInject()) {
        g_injecting.store(false);
        return originalResult;
    }

    // A real controller in the player's hands always wins. Someone who plugs a
    // pad in mid-session should not have it silently overridden by this mod.
    if (physicalConnected && StickOutsideDeadzone(state->Gamepad)) {
        g_injecting.store(false);
        return originalResult;
    }

    SHORT thumbLX = 0;
    SHORT thumbLY = 0;
    BuildStick(&thumbLX, &thumbLY);

    // Preserve everything the physical pad reported (buttons, triggers, right
    // stick) and override only the left stick, so a connected controller keeps
    // working for everything except movement.
    if (!physicalConnected) {
        *state = XINPUT_STATE{};
    }
    state->Gamepad.sThumbLX = thumbLX;
    state->Gamepad.sThumbLY = thumbLY;

    // The packet number must advance whenever the state changes, or callers
    // that poll for changes will conclude nothing happened.
    if (thumbLX != g_lastThumbLX || thumbLY != g_lastThumbLY) {
        g_lastThumbLX = thumbLX;
        g_lastThumbLY = thumbLY;
        ++g_packetNumber;
    }
    state->dwPacketNumber = g_packetNumber;

    g_injecting.store(true);
    g_statesServed.fetch_add(1);
    return ERROR_SUCCESS;
}

DWORD WINAPI HookedGetCapabilities(DWORD userIndex, DWORD flags,
                                   XINPUT_CAPABILITIES* capabilities) {
    const DWORD originalResult =
        g_originalGetCapabilities != nullptr
            ? g_originalGetCapabilities(userIndex, flags, capabilities)
            : static_cast<DWORD>(ERROR_DEVICE_NOT_CONNECTED);

    if (originalResult == ERROR_SUCCESS) return originalResult;
    if (userIndex != 0 || capabilities == nullptr) return originalResult;
    if (!GetConfig().movement.reportControllerConnected) return originalResult;
    if (!ShouldInject()) return originalResult;

    // Claim a standard pad. Without this the game never polls XInputGetState
    // for slot 0, so the synthetic stick would never be read.
    *capabilities = XINPUT_CAPABILITIES{};
    capabilities->Type = XINPUT_DEVTYPE_GAMEPAD;
    capabilities->SubType = XINPUT_DEVSUBTYPE_GAMEPAD;
    capabilities->Flags = 0;
    capabilities->Gamepad.wButtons = 0xFFFF;
    capabilities->Gamepad.bLeftTrigger = 0xFF;
    capabilities->Gamepad.bRightTrigger = 0xFF;
    capabilities->Gamepad.sThumbLX = static_cast<SHORT>(0xFFC0);
    capabilities->Gamepad.sThumbLY = static_cast<SHORT>(0xFFC0);
    capabilities->Gamepad.sThumbRX = static_cast<SHORT>(0xFFC0);
    capabilities->Gamepad.sThumbRY = static_cast<SHORT>(0xFFC0);
    return ERROR_SUCCESS;
}

HMODULE FindLoadedXInput(const wchar_t** nameOut) {
    // Newest first: the game loads exactly one of these, and hooking the one
    // it is actually calling is the only version that matters.
    static const wchar_t* const kCandidates[] = {
        L"XINPUT1_4.dll",  L"XINPUT1_3.dll", L"xinput9_1_0.dll",
        L"XINPUT1_2.dll",  L"XINPUT1_1.dll",
    };
    for (const wchar_t* name : kCandidates) {
        if (HMODULE module = ::GetModuleHandleW(name); module != nullptr) {
            *nameOut = name;
            return module;
        }
    }
    *nameOut = nullptr;
    return nullptr;
}

}  // namespace

bool Install() {
    if (g_installed) return true;

    const wchar_t* moduleName = nullptr;
    HMODULE module = FindLoadedXInput(&moduleName);
    if (module == nullptr) {
        FPCAM_WARN("xinput: no XInput DLL is loaded yet. Synthetic gamepad "
                   "movement is unavailable; install will be retried once the "
                   "game has finished starting.");
        return false;
    }

    g_getStateTarget =
        reinterpret_cast<void*>(::GetProcAddress(module, "XInputGetState"));
    g_getCapabilitiesTarget = reinterpret_cast<void*>(
        ::GetProcAddress(module, "XInputGetCapabilities"));

    if (g_getStateTarget == nullptr) {
        FPCAM_ERROR("xinput: {} exports no XInputGetState.",
                    WideToUtf8(moduleName));
        return false;
    }

    MH_STATUS status = MH_CreateHook(
        g_getStateTarget, reinterpret_cast<LPVOID>(&HookedGetState),
        reinterpret_cast<LPVOID*>(&g_originalGetState));
    if (status != MH_OK) {
        FPCAM_ERROR("xinput: MH_CreateHook(XInputGetState) failed: {}",
                    MH_StatusToString(status));
        return false;
    }
    if (MH_EnableHook(g_getStateTarget) != MH_OK) {
        MH_RemoveHook(g_getStateTarget);
        FPCAM_ERROR("xinput: MH_EnableHook(XInputGetState) failed.");
        return false;
    }

    if (g_getCapabilitiesTarget != nullptr) {
        status = MH_CreateHook(
            g_getCapabilitiesTarget,
            reinterpret_cast<LPVOID>(&HookedGetCapabilities),
            reinterpret_cast<LPVOID*>(&g_originalGetCapabilities));
        if (status == MH_OK && MH_EnableHook(g_getCapabilitiesTarget) == MH_OK) {
            // Fine.
        } else {
            FPCAM_WARN("xinput: XInputGetCapabilities could not be hooked ({}). "
                       "If the game never polls for a pad, switch "
                       "movement.mode to \"moveto\".",
                       MH_StatusToString(status));
            MH_RemoveHook(g_getCapabilitiesTarget);
            g_getCapabilitiesTarget = nullptr;
        }
    }

    g_installed = true;
    FPCAM_INFO("xinput: hooked {} -- WASD will drive the left stick.",
               WideToUtf8(moduleName));
    return true;
}

void Uninstall() {
    if (!g_installed) return;
    if (g_getStateTarget != nullptr) {
        MH_DisableHook(g_getStateTarget);
        MH_RemoveHook(g_getStateTarget);
        g_getStateTarget = nullptr;
    }
    if (g_getCapabilitiesTarget != nullptr) {
        MH_DisableHook(g_getCapabilitiesTarget);
        MH_RemoveHook(g_getCapabilitiesTarget);
        g_getCapabilitiesTarget = nullptr;
    }
    g_installed = false;
    g_injecting.store(false);
    FPCAM_INFO("xinput: hooks removed.");
}

bool Injecting() { return g_injecting.load(); }

Status GetStatus() {
    Status status;
    status.installed = g_installed;
    status.injecting = g_injecting.load();
    status.physicalPadPresent = g_physicalPad.load();
    status.statesServed = g_statesServed.load();
    status.lastStickX = g_lastStickX.load();
    status.lastStickY = g_lastStickY.load();
    return status;
}

}  // namespace fpcam::xinput
