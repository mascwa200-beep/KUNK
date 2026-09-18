// InputHook.h -- raw mouse look and the screen-centre cursor lock.
//
// Two jobs, and the second one matters more than it looks.
//
// Mouse look: the plugin subclasses the game window and reads WM_INPUT raw
// mouse deltas. Because the deltas come from the device rather than from
// cursor position, looking around never runs out of screen, and no button
// needs to be held -- the middle-mouse requirement disappears because the
// game's rotate gate is simply not part of this path any more.
//
// Cursor lock: the OS cursor is pinned to the centre of the window. Baldur's
// Gate 3 casts its picking ray from the cursor, so pinning the cursor to the
// centre makes the engine's own ray a first-person reticle ray, for free. That
// is the whole fix for first-person targeting and interaction -- no engine
// internals, no signature, nothing to break on the next patch. It is also why
// the cursor doubles as the crosshair.
#pragma once

#include "Common.h"

namespace fpcam::input {

// Subclasses the game window and registers for raw mouse input. Safe to call
// before the window exists; it will be retried from OnFrame().
bool Install();
void Uninstall();

// Per-frame maintenance from the present callback: re-centres and re-confines
// the cursor, and picks up a window handle that was not available at startup.
void OnFrame();

void SetCursorLockEnabled(bool enabled);
bool CursorLockEnabled();

// Reported by the Lua side over the bridge. While true, the cursor lock is
// suspended so the player can use the inventory, dialogue and the map.
void SetUIOpen(bool open);
bool UIOpen();

// True when the lock is both enabled and not suspended -- i.e. the cursor is
// actually being held at the centre right now.
bool CursorCurrentlyLocked();

}  // namespace fpcam::input
