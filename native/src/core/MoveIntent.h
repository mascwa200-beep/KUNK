// MoveIntent.h -- turning WASD into a thumbstick deflection.
//
// The synthetic-gamepad movement mode works because BG3 already interprets the
// left stick relative to the camera. Nothing here needs to know where the
// camera is pointing; that is the whole reason the mode exists. What it does
// need to get right is the shape of the deflection:
//
//   * diagonals must not be faster than the cardinals, which is what a real
//     stick gives you at full deflection;
//   * opposing keys cancel;
//   * a key press has to land above the engine's own stick deadzone
//     immediately, because a keyboard has no analog ramp and BG3 discards
//     small deflections outright.
//
// The same intent is published over the bridge so the pathfinding movement mode
// honours identical bindings and feel.
#pragma once

#include "Angles.h"

#include <cstdint>

namespace fpcam::core {

struct MoveIntentInput {
    bool forward = false;
    bool back = false;
    bool left = false;
    bool right = false;
    bool walk = false;
    // Movement is suppressed when the game does not have focus, so alt-tabbing
    // away does not leave the character walking into a wall.
    bool focused = true;

    float deadzone = 0.15f;
    float walkMultiplier = 0.45f;
};

struct MoveIntentOutput {
    // Direction only, jointly normalised to at most unit length.
    float x = 0.0f;
    float y = 0.0f;
    // After the deadzone floor and the walk multiplier: what the stick reports.
    float stickX = 0.0f;
    float stickY = 0.0f;
    bool moving = false;
};

MoveIntentOutput ComputeMoveIntent(const MoveIntentInput& input);

// Converts a normalised axis value to the SHORT range XInput reports.
// Separate so it can be tested without pulling in the Windows types.
int16_t ToStickAxis(float normalized);

}  // namespace fpcam::core
