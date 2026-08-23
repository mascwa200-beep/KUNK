// MatrixProbe.h -- runtime discovery of the camera matrix, and a
// zero-signature source of the current camera basis.
//
// This solves the problem that makes BG3 camera modding awkward: the camera
// structure moves every patch, but the view matrix must be uploaded to the GPU
// every single frame, through an ABI that never changes. By watching constant
// buffer writes we can find and decode that matrix without knowing anything
// about the game's internals.
//
// Two distinct uses:
//
//  1. Discovery. With discovery mode on, every candidate matrix is scored,
//     decoded into a camera position and facing, and written to the log. The
//     user rotates the camera in game, watches which candidate tracks it, and
//     now knows exactly which buffer holds the view matrix -- which is the
//     hard half of writing a signature for the camera object itself.
//
//  2. A read-only camera basis, always. Even with no signatures resolved at
//     all, the decoded matrix tells us where the camera is looking. That is
//     enough to drive camera-relative WASD movement, so the movement half of
//     this mod works on a fresh install before any signature work is done.
//
// What this deliberately does NOT do is write to the constant buffer to force
// a first-person view. That would move the rendered image while leaving the
// game's own camera untouched, so targeting, culling and occlusion would all
// still be computed from the isometric camera. Changing what you see without
// changing what the game thinks you see is a trap, not a shortcut.
#pragma once

#include "Common.h"

#include <cstdint>

namespace fpcam::probe {

// A decoded view matrix: the camera's world-space position and orthonormal
// basis, plus the Euler angles derived from it.
struct ViewSample {
    bool valid = false;

    float position[3] = {0.0f, 0.0f, 0.0f};
    float right[3]    = {1.0f, 0.0f, 0.0f};
    float up[3]       = {0.0f, 1.0f, 0.0f};
    float forward[3]  = {0.0f, 0.0f, 1.0f};

    float yawDegrees   = 0.0f;
    float pitchDegrees = 0.0f;

    uint64_t frame = 0;  // frame index the sample was taken on
};

// Detours ID3D11DeviceContext::Map/Unmap/UpdateSubresource on the vtable
// harvested by D3D11Hook. Must be called after d3d11::Install().
bool Install();
void Uninstall();

// Verbose candidate logging. The per-frame decode of an already-locked buffer
// keeps running when this is off -- it costs a handful of floating point
// operations and is what the movement code reads.
void SetDiscoveryEnabled(bool enabled);
bool DiscoveryEnabled();

// Advances the frame counter and flushes any pending candidate report. Called
// from the Present callback.
void OnFrame(uint64_t frameIndex);

// The most recent successfully decoded view matrix. `valid` is false until a
// candidate has been locked on to.
ViewSample Latest();

// Forgets the locked candidate and re-runs identification. Exposed because a
// level transition or a cutscene can legitimately move the view matrix to a
// different buffer.
void ResetLock();

// Writes the current candidate table to the log, whether or not discovery mode
// is enabled. Bound to the discovery hotkey.
void LogCandidates();

}  // namespace fpcam::probe
