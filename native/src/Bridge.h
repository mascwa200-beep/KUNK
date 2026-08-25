// Bridge.h -- the low-rate link between this DLL and the Script Extender Lua
// mod.
//
// Script Extender's Lua has no FFI and no shared memory, so the only channel
// available between the two halves of this mod is the one directory SE's
// Ext.IO API is allowed to touch. Two small JSON files are exchanged there,
// each rewritten a few times a second.
//
// This is deliberately NOT on the per-frame path. Mouse deltas, camera angles
// and the synthetic stick all stay entirely inside the native side, where they
// belong; the bridge carries only state that changes at human speed -- whether
// a UI panel is open, which character is controlled, and the camera heading the
// `moveto` movement mode needs. At 10 Hz the file IO is invisible, and it runs
// on its own thread so it can never stall a frame.
#pragma once

#include "Common.h"

#include <string>

namespace fpcam::bridge {

// State the Lua side reports to us.
struct LuaState {
    bool valid = false;

    bool uiOpen = false;     // inventory, character sheet, map, journal...
    bool inDialog = false;
    bool inCombat = false;

    std::string controlledCharacter;  // entity UUID, informational
    std::string race;                 // drives the per-race eye height

    float characterPosition[3] = {0.0f, 0.0f, 0.0f};

    uint64_t sequence = 0;  // increments on the Lua side; detects a stale file
};

// Starts the exchange thread. Returns false if the target directory cannot be
// resolved, in which case the mod still works -- the Lua half just runs
// without camera heading, and the cursor lock relies on its hotkey alone.
bool Start();
void Stop();

// Most recent state read from the Lua side.
LuaState Current();

// Directory the two files live in, for logging and troubleshooting.
const std::wstring& Directory();

}  // namespace fpcam::bridge
