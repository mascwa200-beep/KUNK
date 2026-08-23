// CameraHook.h -- the first-person camera state machine.
//
// Owns the desired yaw/pitch (accumulated from raw mouse input), and each
// frame pushes that, plus a zero zoom distance and an eye-height position,
// into the game's camera structure.
//
// Every field written here is located through a user-supplied offset in
// FPCamera.json, walked from a pointer resolved by a signature. Nothing is
// hardcoded, and every step is validated: if the camera object cannot be
// reached, first-person mode reports itself as degraded and writes nothing,
// rather than scribbling into whatever happens to be at that address.
#pragma once

#include "Common.h"
#include "Signatures.h"

namespace fpcam::camera {

struct Status {
    bool firstPersonEnabled = false;
    bool cameraObjectResolved = false;
    bool clampPatchesApplied = false;
    bool usingProbeBasis = false;   // camera basis is coming from MatrixProbe
    float yaw = 0.0f;
    float pitch = 0.0f;
    uint64_t framesWritten = 0;
    uint64_t writeFailures = 0;
};

// Resolves the camera pointer chain and, if configured, applies the clamp
// patches. Returns false when the camera object could not be reached -- which
// is not fatal: mouse-look bookkeeping and camera-relative movement still run,
// they just cannot move the game's camera until signatures are supplied.
bool Initialize(const SignatureRegistry& signatures);

// Reverts any applied byte patches and clears state. Must run before MinHook
// is uninitialised.
void Shutdown();

void SetFirstPersonEnabled(bool enabled);
bool FirstPersonEnabled();

// Accumulates a raw mouse delta into the desired orientation. Called from the
// input thread; the values are read on the render thread.
void ApplyMouseDelta(float deltaX, float deltaY);

// Per-frame update, called from the D3D11 present callback.
void OnFrame(uint64_t frameIndex);

// Current desired orientation, in degrees.
float Yaw();
float Pitch();

// Camera basis in world space. Prefers the matrix decoded by MatrixProbe,
// because that is the engine's actual camera rather than our intention for it;
// falls back to deriving vectors from our own yaw/pitch when no matrix has
// been identified. Movement code uses this, which is why WASD works before any
// signature has been resolved.
void GetForward(float out[3]);
void GetRight(float out[3]);

Status GetStatus();

// Re-runs the pointer chain. Bound to the config-reload hotkey, since changing
// an offset is the main reason to reload.
void Rebind(const SignatureRegistry& signatures);

}  // namespace fpcam::camera
