#include "MoveIntent.h"

namespace fpcam::core {

MoveIntentOutput ComputeMoveIntent(const MoveIntentInput& input) {
    MoveIntentOutput output;
    if (!input.focused) return output;

    float x = 0.0f;
    float y = 0.0f;
    if (input.forward) y += 1.0f;
    if (input.back)    y -= 1.0f;
    if (input.right)   x += 1.0f;
    if (input.left)    x -= 1.0f;

    const float length = std::sqrt(x * x + y * y);
    if (!(length > 0.0f)) return output;  // nothing held, or opposing keys

    if (length > 1.0f) {
        x /= length;
        y /= length;
    }

    output.x = x;
    output.y = y;
    output.moving = true;

    // Start just above the engine's deadzone and scale the remaining range, so
    // the lightest tap already registers and the walk multiplier still spans
    // everything above that threshold.
    const float floorValue = Clamp(input.deadzone, 0.0f, 0.9f) + 0.05f;
    const float requested = Clamp(input.walkMultiplier, 0.0f, 1.0f);
    const float magnitude =
        input.walk ? floorValue + requested * (1.0f - floorValue)
                   : 1.0f;

    output.stickX = Clamp(x * magnitude, -1.0f, 1.0f);
    output.stickY = Clamp(y * magnitude, -1.0f, 1.0f);
    return output;
}

int16_t ToStickAxis(float normalized) {
    // 32767 rather than 32768: the positive and negative extremes must both be
    // representable, and -32768 has no positive counterpart.
    const float scaled = Clamp(normalized, -1.0f, 1.0f) * 32767.0f;
    return static_cast<int16_t>(scaled);
}

}  // namespace fpcam::core
