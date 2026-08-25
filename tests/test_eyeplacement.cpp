// test_eyeplacement.cpp -- the read-modify-write feedback guard.
//
// Raising the camera to eye height means reading the engine's position, adding
// an offset, and writing it back. If the engine does not refresh that field
// between our writes -- a paused frame, a loading screen, a cutscene -- we read
// our own output and add the offset again, every frame, and the camera flies
// into the sky.
//
// The tests below run thousands of frames in each regime and assert the eye
// position is exactly where it should be, because this is a bug that would look
// fine in a five-second check and only show up when the game pauses.
#include "Harness.h"

#include "core/EyePlacement.h"

#include <cmath>
#include <limits>
#include <random>

using namespace fpcam::core;

namespace {

EyePlacementInput MakeInput(const Vec3& enginePosition) {
    EyePlacementInput input;
    input.enginePosition = enginePosition;
    input.forward = Vec3{0.0f, 0.0f, 1.0f};
    input.eyeHeight = 1.62f;
    input.forwardOffset = 0.12f;
    return input;
}

}  // namespace

TEST(EyePlacement, RaisesToEyeHeightAndNudgesForward) {
    EyePlacement placement;
    const auto output = placement.Solve(MakeInput(Vec3{10.0f, 5.0f, 20.0f}));
    CHECK(output.write);
    CHECK(!output.reusedBase);
    CHECK_NEAR(output.position.x, 10.0f, 1e-4);
    CHECK_NEAR(output.position.y, 5.0f + 1.62f, 1e-4);
    CHECK_NEAR(output.position.z, 20.0f + 0.12f, 1e-4);
}

TEST(EyePlacement, ForwardOffsetIsHorizontalOnly) {
    // Looking straight up must not lift the camera by the forward offset as
    // well as by eye height -- that would push it through a low ceiling.
    EyePlacement placement;
    auto input = MakeInput(Vec3{0.0f, 0.0f, 0.0f});
    input.forward = Vec3{0.0f, 1.0f, 0.0f};
    const auto output = placement.Solve(input);
    CHECK(output.write);
    CHECK_NEAR(output.position.y, 1.62f, 1e-4);
    CHECK_NEAR(output.position.x, 0.0f, 1e-4);
    CHECK_NEAR(output.position.z, 0.0f, 1e-4);
}

TEST(EyePlacement, DoesNotDriftWhenTheEngineKeepsRefreshing) {
    // The normal case: the engine overwrites the field every frame.
    EyePlacement placement;
    const Vec3 standing{100.0f, 30.0f, -50.0f};
    for (int frame = 0; frame < 10000; ++frame) {
        const auto output = placement.Solve(MakeInput(standing));
        CHECK(output.write);
        if (std::fabs(output.position.y - (30.0f + 1.62f)) > 1e-3f) {
            CHECK_MSG(false, "drifted on frame " + std::to_string(frame) +
                                 " to y=" + std::to_string(output.position.y));
            break;
        }
    }
}

TEST(EyePlacement, DoesNotDriftWhenTheEngineNeverRefreshes) {
    // The bug case. Feed back exactly what was written, forever.
    EyePlacement placement;
    Vec3 field{100.0f, 30.0f, -50.0f};
    const float expectedY = 30.0f + 1.62f;

    for (int frame = 0; frame < 10000; ++frame) {
        const auto output = placement.Solve(MakeInput(field));
        CHECK(output.write);
        if (frame > 0) {
            CHECK_MSG(output.reusedBase,
                      "frame " + std::to_string(frame) +
                          " should have reused the remembered base");
        }
        if (std::fabs(output.position.y - expectedY) > 1e-3f) {
            CHECK_MSG(false, "drifted on frame " + std::to_string(frame) +
                                 " to y=" + std::to_string(output.position.y));
            break;
        }
        field = output.position;  // engine left our write in place
    }
}

TEST(EyePlacement, DoesNotDriftWhenTheEngineRefreshesIntermittently) {
    // The realistic case: mostly refreshed, occasionally not.
    std::mt19937 rng(0xEEEEu);
    std::bernoulli_distribution engineUpdates(0.7);

    EyePlacement placement;
    const Vec3 truth{5.0f, 2.0f, 7.0f};
    Vec3 field = truth;

    for (int frame = 0; frame < 10000; ++frame) {
        const auto output = placement.Solve(MakeInput(field));
        CHECK(output.write);
        if (std::fabs(output.position.y - (truth.y + 1.62f)) > 1e-3f) {
            CHECK_MSG(false, "drifted on frame " + std::to_string(frame));
            break;
        }
        field = engineUpdates(rng) ? truth : output.position;
    }
}

TEST(EyePlacement, FollowsTheCharacterWhileWalking) {
    // Drift protection must not turn into a camera that refuses to move.
    EyePlacement placement;
    for (int frame = 0; frame < 1000; ++frame) {
        const float z = static_cast<float>(frame) * 0.1f;
        const auto output = placement.Solve(MakeInput(Vec3{0.0f, 10.0f, z}));
        CHECK(output.write);
        CHECK_NEAR(output.position.z, z + 0.12f, 1e-2);
        CHECK_NEAR(output.position.y, 10.0f + 1.62f, 1e-3);
    }
}

TEST(EyePlacement, HandlesATeleport) {
    EyePlacement placement;
    placement.Solve(MakeInput(Vec3{0.0f, 0.0f, 0.0f}));
    const auto output = placement.Solve(MakeInput(Vec3{900.0f, 40.0f, -300.0f}));
    CHECK(output.write);
    CHECK(!output.reusedBase);
    CHECK_NEAR(output.position.x, 900.0f, 1e-3);
    CHECK_NEAR(output.position.y, 40.0f + 1.62f, 1e-3);
}

TEST(EyePlacement, RefusesToWriteNonFiniteOrAbsurdInput) {
    EyePlacement placement;

    auto nan = MakeInput(Vec3{std::numeric_limits<float>::quiet_NaN(), 0, 0});
    CHECK(!placement.Solve(nan).write);

    auto infinity = MakeInput(Vec3{0, std::numeric_limits<float>::infinity(), 0});
    CHECK(!placement.Solve(infinity).write);

    // A position far outside any real level means the offset is pointing at
    // something that is not a position.
    auto absurd = MakeInput(Vec3{1.0e9f, 0, 0});
    CHECK(!placement.Solve(absurd).write);

    // A non-finite eye height must not reach the game either.
    auto badHeight = MakeInput(Vec3{0, 0, 0});
    badHeight.eyeHeight = std::numeric_limits<float>::quiet_NaN();
    CHECK(!placement.Solve(badHeight).write);
}

TEST(EyePlacement, ResetForgetsTheRememberedBase) {
    EyePlacement placement;
    const auto first = placement.Solve(MakeInput(Vec3{1.0f, 1.0f, 1.0f}));
    CHECK(placement.HasBase());

    // Without a reset, feeding the written value back reuses the base.
    CHECK(placement.Solve(MakeInput(first.position)).reusedBase);

    // After a reset -- a level change, or the camera pointer moving -- the
    // remembered base must not be compared against an unrelated structure.
    placement.Reset();
    CHECK(!placement.HasBase());
    CHECK(!placement.Solve(MakeInput(first.position)).reusedBase);
}

TEST(EyePlacement, ZeroOffsetsAreStableEvenThoughTheGuardCannotDistinguish) {
    // With both offsets at zero our write equals the base, so "did the engine
    // refresh?" is unanswerable. It is also irrelevant: either answer gives the
    // same result. Documented in the header; pinned here.
    EyePlacement placement;
    auto input = MakeInput(Vec3{3.0f, 4.0f, 5.0f});
    input.eyeHeight = 0.0f;
    input.forwardOffset = 0.0f;

    for (int frame = 0; frame < 500; ++frame) {
        const auto output = placement.Solve(input);
        CHECK(output.write);
        CHECK_NEAR(output.position.y, 4.0f, 1e-5);
        input.enginePosition = output.position;
    }
}
