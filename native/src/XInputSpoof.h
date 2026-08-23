// XInputSpoof.h -- continuous WASD movement, by way of the game's own gamepad
// support.
//
// Baldur's Gate 3 is click-to-move with a keyboard, but it already ships true
// analog, camera-relative free movement for controllers. Rather than fighting
// the pathfinder to approximate that, this module synthesises gamepad stick
// input from the WASD keys: the engine then does camera-relative continuous
// movement using its own, well-tested implementation.
//
// The cost, stated plainly because it is visible the moment you enable it: BG3
// switches its UI prompts to controller glyphs while a pad is reporting input.
// The `moveto` movement mode in FPCamera.json avoids that at the price of
// pathfinder stutter; neither option is free. See README.md.
//
// XInput is a documented, exported API, so this needs no signature scanning
// and does not break on a game patch.
#pragma once

#include "Common.h"

namespace fpcam::xinput {

// Detours XInputGetState and XInputGetCapabilities in whichever XInput DLL the
// game loaded. Returns false if none is loaded, which is not fatal -- movement
// simply stays on whatever mode the config selects.
bool Install();
void Uninstall();

// True when synthetic input is currently being injected, i.e. first-person is
// on, the movement mode is `xinput`, and no physical controller is driving.
bool Injecting();

// Diagnostic counters for the status hotkey.
struct Status {
    bool installed = false;
    bool injecting = false;
    bool physicalPadPresent = false;
    uint64_t statesServed = 0;
    float lastStickX = 0.0f;
    float lastStickY = 0.0f;
};
Status GetStatus();

}  // namespace fpcam::xinput
