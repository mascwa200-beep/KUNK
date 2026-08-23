// test_moveintent.cpp -- WASD to thumbstick deflection.
//
// The subtle requirement is the deadzone floor. BG3 discards small stick
// deflections, and a keyboard has no analog ramp, so a key press has to land
// above that threshold immediately or movement simply does not start. Getting
// this wrong produces "WASD does nothing" with no error anywhere.
#include "Harness.h"

#include "core/MoveIntent.h"

using namespace fpcam::core;

namespace {

MoveIntentInput Keys(bool forward, bool back, bool left, bool right) {
    MoveIntentInput input;
    input.forward = forward;
    input.back = back;
    input.left = left;
    input.right = right;
    return input;
}

}  // namespace

TEST(MoveIntent, CardinalsAreFullDeflection) {
    const auto forward = ComputeMoveIntent(Keys(true, false, false, false));
    CHECK(forward.moving);
    CHECK_NEAR(forward.y, 1.0f, 1e-5);
    CHECK_NEAR(forward.x, 0.0f, 1e-5);

    const auto back = ComputeMoveIntent(Keys(false, true, false, false));
    CHECK_NEAR(back.y, -1.0f, 1e-5);

    const auto right = ComputeMoveIntent(Keys(false, false, false, true));
    CHECK_NEAR(right.x, 1.0f, 1e-5);

    const auto left = ComputeMoveIntent(Keys(false, false, true, false));
    CHECK_NEAR(left.x, -1.0f, 1e-5);
}

TEST(MoveIntent, DiagonalsAreNotFasterThanCardinals) {
    // Without normalisation, W+D would move sqrt(2) times faster than W --
    // the classic "diagonal speed boost" bug.
    const auto diagonal = ComputeMoveIntent(Keys(true, false, false, true));
    CHECK(diagonal.moving);
    const float magnitude = std::sqrt(diagonal.x * diagonal.x +
                                      diagonal.y * diagonal.y);
    CHECK_NEAR(magnitude, 1.0f, 1e-4);
    CHECK_NEAR(diagonal.x, 0.70710678f, 1e-4);
    CHECK_NEAR(diagonal.y, 0.70710678f, 1e-4);
}

TEST(MoveIntent, OpposingKeysCancel) {
    const auto both = ComputeMoveIntent(Keys(true, true, false, false));
    CHECK(!both.moving);
    CHECK_NEAR(both.stickX, 0.0f, 1e-6);
    CHECK_NEAR(both.stickY, 0.0f, 1e-6);

    const auto all = ComputeMoveIntent(Keys(true, true, true, true));
    CHECK(!all.moving);
}

TEST(MoveIntent, NothingHeldMeansNoDeflection) {
    const auto idle = ComputeMoveIntent(Keys(false, false, false, false));
    CHECK(!idle.moving);
    CHECK_NEAR(idle.stickX, 0.0f, 1e-6);
    CHECK_NEAR(idle.stickY, 0.0f, 1e-6);
}

TEST(MoveIntent, LosingFocusStopsMovement) {
    // Alt-tabbing away must not leave the character walking into a wall.
    auto input = Keys(true, false, false, false);
    input.focused = false;
    const auto output = ComputeMoveIntent(input);
    CHECK(!output.moving);
    CHECK_NEAR(output.stickY, 0.0f, 1e-6);
}

TEST(MoveIntent, RunningIsFullDeflection) {
    auto input = Keys(true, false, false, false);
    input.walk = false;
    const auto output = ComputeMoveIntent(input);
    CHECK_NEAR(output.stickY, 1.0f, 1e-5);
}

TEST(MoveIntent, WalkingStaysAboveTheEngineDeadzone) {
    // The requirement that makes this worth testing: even the slowest walk must
    // clear the deadzone, or the engine discards it and nothing moves.
    for (const float deadzone : {0.0f, 0.15f, 0.3f, 0.5f, 0.9f}) {
        for (const float multiplier : {0.05f, 0.2f, 0.45f, 1.0f}) {
            auto input = Keys(true, false, false, false);
            input.walk = true;
            input.deadzone = deadzone;
            input.walkMultiplier = multiplier;

            const auto output = ComputeMoveIntent(input);
            CHECK_MSG(output.stickY > deadzone,
                      "deadzone " + std::to_string(deadzone) + " multiplier " +
                          std::to_string(multiplier) + " gave stickY " +
                          std::to_string(output.stickY));
            CHECK(output.stickY <= 1.0f);
        }
    }
}

TEST(MoveIntent, WalkingIsSlowerThanRunning) {
    auto walking = Keys(true, false, false, false);
    walking.walk = true;
    walking.walkMultiplier = 0.45f;

    auto running = Keys(true, false, false, false);
    running.walk = false;

    CHECK(ComputeMoveIntent(walking).stickY <
          ComputeMoveIntent(running).stickY);
}

TEST(MoveIntent, StickValuesStayInRange) {
    // Hostile config values must not produce a deflection outside [-1, 1],
    // which would overflow the SHORT conversion.
    for (const float deadzone : {-5.0f, 0.0f, 0.5f, 5.0f}) {
        for (const float multiplier : {-5.0f, 0.0f, 1.0f, 100.0f}) {
            auto input = Keys(true, false, true, false);
            input.walk = true;
            input.deadzone = deadzone;
            input.walkMultiplier = multiplier;
            const auto output = ComputeMoveIntent(input);
            CHECK(output.stickX >= -1.0f && output.stickX <= 1.0f);
            CHECK(output.stickY >= -1.0f && output.stickY <= 1.0f);
        }
    }
}

TEST(MoveIntent, StickAxisConversionIsSymmetricAndBounded) {
    CHECK_EQ(int(ToStickAxis(0.0f)), 0);
    CHECK_EQ(int(ToStickAxis(1.0f)), 32767);
    CHECK_EQ(int(ToStickAxis(-1.0f)), -32767);
    // Out-of-range input must clamp rather than wrap to the opposite extreme.
    CHECK_EQ(int(ToStickAxis(5.0f)), 32767);
    CHECK_EQ(int(ToStickAxis(-5.0f)), -32767);
}
