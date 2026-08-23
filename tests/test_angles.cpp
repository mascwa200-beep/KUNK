// test_angles.cpp -- the angle conventions the camera, movement and matrix
// decoder all share.
//
// These are three lines of trigonometry each, which is exactly why they are
// worth pinning: they are shared by three subsystems, and a sign flip here
// would show up as "strafing goes the wrong way" somewhere far from the cause.
#include "Harness.h"

#include "core/Angles.h"

#include <limits>

using namespace fpcam::core;

TEST(Angles, WrapsIntoTheHalfOpenRange) {
    CHECK_NEAR(WrapDegrees(0.0f), 0.0f, 1e-4);
    CHECK_NEAR(WrapDegrees(90.0f), 90.0f, 1e-4);
    CHECK_NEAR(WrapDegrees(-90.0f), -90.0f, 1e-4);
    CHECK_NEAR(WrapDegrees(180.0f), -180.0f, 1e-4);   // half-open at +180
    CHECK_NEAR(WrapDegrees(-180.0f), -180.0f, 1e-4);
    CHECK_NEAR(WrapDegrees(360.0f), 0.0f, 1e-4);
    CHECK_NEAR(WrapDegrees(450.0f), 90.0f, 1e-4);
    CHECK_NEAR(WrapDegrees(-450.0f), -90.0f, 1e-4);
    CHECK_NEAR(WrapDegrees(-270.0f), 90.0f, 1e-4);
}

TEST(Angles, WrapsLargeAccumulatedYaw) {
    // Yaw accumulates without bound while the player spins the mouse. The
    // result must stay in range no matter how far it has run.
    for (const float input : {3600.0f, -3600.0f, 100000.0f, -100000.0f,
                              1.0e7f, -1.0e7f}) {
        const float wrapped = WrapDegrees(input);
        CHECK_MSG(wrapped >= -180.0f && wrapped < 180.0f,
                  "wrap(" + std::to_string(input) + ") = " +
                      std::to_string(wrapped));
    }
}

TEST(Angles, WrapNeutralisesNonFiniteInput) {
    // A NaN written into the game's camera yaw is a crash a frame later, not a
    // visual glitch.
    CHECK_NEAR(WrapDegrees(std::numeric_limits<float>::quiet_NaN()), 0.0f, 1e-6);
    CHECK_NEAR(WrapDegrees(std::numeric_limits<float>::infinity()), 0.0f, 1e-6);
    CHECK_NEAR(WrapDegrees(-std::numeric_limits<float>::infinity()), 0.0f, 1e-6);
}

TEST(Angles, ClampBoundsValues) {
    CHECK_NEAR(Clamp(5.0f, 0.0f, 10.0f), 5.0f, 1e-6);
    CHECK_NEAR(Clamp(-5.0f, 0.0f, 10.0f), 0.0f, 1e-6);
    CHECK_NEAR(Clamp(50.0f, 0.0f, 10.0f), 10.0f, 1e-6);
    CHECK_EQ(Clamp(5, 1, 3), 3);
}

TEST(Angles, ForwardAndYawPitchAreInverses) {
    for (int yaw = -175; yaw <= 175; yaw += 5) {
        for (int pitch = -85; pitch <= 85; pitch += 5) {
            const auto y = static_cast<float>(yaw);
            const auto p = static_cast<float>(pitch);
            const Vec3 forward = ForwardFromYawPitch(y, p);
            CHECK_NEAR(Length(forward), 1.0f, 1e-4);
            CHECK_NEAR(WrapDegrees(YawFromForward(forward)), y, 0.01);
            CHECK_NEAR(PitchFromForward(forward), p, 0.01);
        }
    }
}

TEST(Angles, BasisIsOrthonormalAndRightHandsCorrectly) {
    for (int yaw = -180; yaw < 180; yaw += 11) {
        for (int pitch = -80; pitch <= 80; pitch += 11) {
            const Basis basis = BasisFromYawPitch(static_cast<float>(yaw),
                                                  static_cast<float>(pitch));
            CHECK_NEAR(Length(basis.forward), 1.0f, 1e-4);
            CHECK_NEAR(Length(basis.right), 1.0f, 1e-4);
            CHECK_NEAR(Length(basis.up), 1.0f, 1e-4);
            CHECK_NEAR(Dot(basis.forward, basis.right), 0.0f, 1e-4);
            CHECK_NEAR(Dot(basis.forward, basis.up), 0.0f, 1e-4);
            CHECK_NEAR(Dot(basis.right, basis.up), 0.0f, 1e-4);
        }
    }
}

TEST(Angles, RightStaysHorizontalAtEveryPitch) {
    // Strafing must not gain a vertical component when looking up or down --
    // otherwise pressing A while looking at the sky walks you into the air.
    for (int pitch = -89; pitch <= 89; pitch += 7) {
        const Basis basis = BasisFromYawPitch(42.0f, static_cast<float>(pitch));
        CHECK_NEAR(basis.right.y, 0.0f, 1e-6);
    }
}

TEST(Angles, FacingDirectionsAreWhereExpected) {
    // Pin the convention itself, so a future refactor cannot quietly rotate the
    // world by 90 degrees.
    const Vec3 north = ForwardFromYawPitch(0.0f, 0.0f);
    CHECK_NEAR(north.x, 0.0f, 1e-5);
    CHECK_NEAR(north.z, 1.0f, 1e-5);

    const Vec3 east = ForwardFromYawPitch(90.0f, 0.0f);
    CHECK_NEAR(east.x, 1.0f, 1e-5);
    CHECK_NEAR(east.z, 0.0f, 1e-5);

    const Vec3 up = ForwardFromYawPitch(0.0f, 90.0f);
    CHECK_NEAR(up.y, 1.0f, 1e-5);
}

TEST(Vec3, FlattenDropsHeightAndNormalises) {
    const Vec3 flat = Flatten(Vec3{3.0f, 99.0f, 4.0f});
    CHECK_NEAR(flat.y, 0.0f, 1e-6);
    CHECK_NEAR(Length(flat), 1.0f, 1e-5);
    CHECK_NEAR(flat.x, 0.6f, 1e-5);
    CHECK_NEAR(flat.z, 0.8f, 1e-5);
}

TEST(Vec3, NormalizeHandlesDegenerateInput) {
    // Straight up has no horizontal component; the result must be zero rather
    // than a NaN that then propagates into a movement vector.
    const Vec3 flat = Flatten(Vec3{0.0f, 1.0f, 0.0f});
    CHECK(AllFinite(flat));
    CHECK_NEAR(Length(flat), 0.0f, 1e-6);

    const Vec3 zero = Normalize(Vec3{0.0f, 0.0f, 0.0f});
    CHECK(AllFinite(zero));

    const Vec3 nan = Normalize(
        Vec3{std::numeric_limits<float>::quiet_NaN(), 0.0f, 0.0f});
    CHECK(AllFinite(nan));
}

TEST(Vec3, NearlyEqualComparesComponentwise) {
    CHECK(NearlyEqual(Vec3{1, 2, 3}, Vec3{1, 2, 3}, 1e-6f));
    CHECK(NearlyEqual(Vec3{1, 2, 3}, Vec3{1.0000001f, 2, 3}, 1e-5f));
    CHECK(!NearlyEqual(Vec3{1, 2, 3}, Vec3{1, 2, 3.1f}, 1e-3f));
}
