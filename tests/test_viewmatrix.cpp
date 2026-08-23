// test_viewmatrix.cpp -- the camera-matrix decoder.
//
// This is the decoder that decides which of the dozens of 4x4 float blocks a
// frame writes is the player's camera. A false positive is not cosmetic: the
// decoded basis drives movement direction, so locking on to a shadow cascade
// sends the player walking sideways. These tests therefore push as hard on what
// must be *rejected* as on what must be accepted.
#include "Harness.h"

#include "core/ViewMatrix.h"

#include <limits>
#include <random>

using namespace fpcam::core;

namespace {

// A projection matrix, the most common non-camera 4x4 in a frame.
void MakePerspective(float fovDegrees, float aspect, float nearZ, float farZ,
                     float m[16]) {
    const float f = 1.0f / std::tan(fovDegrees * kDegToRad * 0.5f);
    for (int i = 0; i < 16; ++i) m[i] = 0.0f;
    m[0] = f / aspect;
    m[5] = f;
    m[10] = farZ / (farZ - nearZ);
    m[11] = 1.0f;
    m[14] = -nearZ * farZ / (farZ - nearZ);
}

// A world matrix: rotation with scale. The single most dangerous near-miss,
// because it has the identity edge and only fails on orthonormality.
void MakeScaledWorld(float scale, float yaw, float m[16]) {
    ComposeViewMatrix(Vec3{1.0f, 2.0f, 3.0f}, yaw, 0.0f, m);
    for (int row = 0; row < 3; ++row) {
        for (int column = 0; column < 3; ++column) {
            m[row * 4 + column] *= scale;
        }
    }
}

}  // namespace

TEST(ViewMatrix, RoundTripsARowVectorMatrix) {
    const Vec3 eye{123.5f, 42.25f, -87.75f};
    float m[16];
    ComposeViewMatrix(eye, 37.0f, -12.0f, m);

    ViewSample sample;
    MatrixLayout layout = MatrixLayout::None;
    CHECK(DecodeViewMatrix(m, &sample, &layout) == DecodeResult::Ok);
    CHECK(layout == MatrixLayout::RowVector);

    CHECK_NEAR(sample.position.x, eye.x, 1e-2);
    CHECK_NEAR(sample.position.y, eye.y, 1e-2);
    CHECK_NEAR(sample.position.z, eye.z, 1e-2);
    CHECK_NEAR(sample.yawDegrees, 37.0f, 1e-2);
    CHECK_NEAR(sample.pitchDegrees, -12.0f, 1e-2);
}

TEST(ViewMatrix, RoundTripsATransposedMatrix) {
    // HLSL's default column-major packing uploads the transpose. Both must
    // decode to the same camera.
    const Vec3 eye{-500.0f, 12.0f, 900.0f};
    float m[16];
    ComposeViewMatrix(eye, -140.0f, 25.0f, m);
    TransposeMatrix(m);

    ViewSample sample;
    MatrixLayout layout = MatrixLayout::None;
    CHECK(DecodeViewMatrix(m, &sample, &layout) == DecodeResult::Ok);
    CHECK(layout == MatrixLayout::ColumnVector);
    CHECK_NEAR(sample.position.x, eye.x, 1e-1);
    CHECK_NEAR(sample.position.y, eye.y, 1e-1);
    CHECK_NEAR(sample.position.z, eye.z, 1e-1);
    CHECK_NEAR(sample.yawDegrees, -140.0f, 1e-2);
    CHECK_NEAR(sample.pitchDegrees, 25.0f, 1e-2);
}

TEST(ViewMatrix, RoundTripsAcrossAYawPitchGrid) {
    // The decoder and BasisFromYawPitch claim to be exact inverses. Check it
    // over the whole usable range rather than at a couple of convenient angles.
    // Pitch stops short of +-90 because yaw is undefined at the poles.
    int checked = 0;
    for (int yawStep = -175; yawStep <= 175; yawStep += 5) {
        for (int pitchStep = -85; pitchStep <= 85; pitchStep += 5) {
            const auto yaw = static_cast<float>(yawStep);
            const auto pitch = static_cast<float>(pitchStep);

            float m[16];
            ComposeViewMatrix(Vec3{10.0f, 20.0f, 30.0f}, yaw, pitch, m);

            ViewSample sample;
            if (DecodeViewMatrix(m, &sample) != DecodeResult::Ok) {
                CHECK_MSG(false, "failed to decode at yaw " +
                                     std::to_string(yawStep) + " pitch " +
                                     std::to_string(pitchStep));
                continue;
            }
            CHECK_NEAR(sample.yawDegrees, yaw, 0.05);
            CHECK_NEAR(sample.pitchDegrees, pitch, 0.05);
            CHECK_NEAR(sample.position.x, 10.0f, 0.05);
            CHECK_NEAR(sample.position.y, 20.0f, 0.05);
            CHECK_NEAR(sample.position.z, 30.0f, 0.05);
            ++checked;
        }
    }
    CHECK(checked == 71 * 35);
}

TEST(ViewMatrix, RejectsAProjectionMatrix) {
    float m[16];
    MakePerspective(70.0f, 16.0f / 9.0f, 0.1f, 1000.0f, m);
    ViewSample sample;
    // Rejected for the right reason: a projection matrix has 1 in m[11] and 0
    // in m[15], so neither edge is an identity edge.
    CHECK(DecodeViewMatrix(m, &sample) == DecodeResult::NoIdentityEdge);
}

TEST(ViewMatrix, RejectsScaledWorldMatrices) {
    // The dangerous near-miss: correct identity edge, wrong because scaled.
    for (const float scale : {0.5f, 0.9f, 1.05f, 1.5f, 3.0f, 100.0f}) {
        float m[16];
        MakeScaledWorld(scale, 20.0f, m);
        ViewSample sample;
        CHECK_MSG(DecodeViewMatrix(m, &sample) == DecodeResult::NotOrthonormal,
                  "scale " + std::to_string(scale) + " should be rejected");
    }
}

TEST(ViewMatrix, AcceptsScaleWithinTolerance) {
    // The flip side: float32 round-off in the game's own maths must not cause
    // the real camera to be rejected. 0.2% scale error is well inside what
    // accumulating float error produces and must still decode.
    float m[16];
    MakeScaledWorld(1.002f, 20.0f, m);
    ViewSample sample;
    CHECK(DecodeViewMatrix(m, &sample) == DecodeResult::Ok);
}

TEST(ViewMatrix, RejectsNonFiniteValues) {
    const float bad[] = {
        std::numeric_limits<float>::quiet_NaN(),
        std::numeric_limits<float>::infinity(),
        -std::numeric_limits<float>::infinity(),
    };
    for (const float poison : bad) {
        for (int slot = 0; slot < 16; ++slot) {
            float m[16];
            ComposeViewMatrix(Vec3{1.0f, 1.0f, 1.0f}, 10.0f, 5.0f, m);
            m[slot] = poison;
            ViewSample sample;
            const DecodeResult result = DecodeViewMatrix(m, &sample);
            CHECK_MSG(result != DecodeResult::Ok,
                      "poison in slot " + std::to_string(slot) +
                          " must not decode");
        }
    }
}

TEST(ViewMatrix, RejectsAbsurdMagnitudes) {
    float m[16];
    ComposeViewMatrix(Vec3{1.0f, 1.0f, 1.0f}, 0.0f, 0.0f, m);
    m[12] = 1.0e30f;
    ViewSample sample;
    CHECK(DecodeViewMatrix(m, &sample) == DecodeResult::NotFinite);
}

TEST(ViewMatrix, RejectsAPositionOutsideAnyRealLevel) {
    // Orthonormal rotation, identity edge, but the camera would be 500 km out.
    float m[16];
    ComposeViewMatrix(Vec3{0.0f, 0.0f, 0.0f}, 0.0f, 0.0f, m);
    m[12] = 500000.0f;
    ViewSample sample;
    CHECK(DecodeViewMatrix(m, &sample) == DecodeResult::ImplausiblePosition);
}

TEST(ViewMatrix, RejectsAllZeroAndIdentityLikeGarbage) {
    float zero[16] = {};
    ViewSample sample;
    CHECK(DecodeViewMatrix(zero, &sample) != DecodeResult::Ok);

    // A zeroed rotation with a valid corner: orthonormality must catch it.
    float degenerate[16] = {};
    degenerate[15] = 1.0f;
    CHECK(DecodeViewMatrix(degenerate, &sample) == DecodeResult::NotOrthonormal);
}

TEST(ViewMatrix, IdentityDecodesToTheOrigin) {
    // The genuinely ambiguous case, documented in the header: a camera at the
    // origin. It must decode without error and put the eye at zero.
    float identity[16] = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};
    ViewSample sample;
    CHECK(DecodeViewMatrix(identity, &sample) == DecodeResult::Ok);
    CHECK_NEAR(sample.position.x, 0.0f, 1e-5);
    CHECK_NEAR(sample.position.y, 0.0f, 1e-5);
    CHECK_NEAR(sample.position.z, 0.0f, 1e-5);
}

TEST(ViewMatrix, DecodedBasisIsOrthonormal) {
    for (int yaw = -180; yaw < 180; yaw += 17) {
        for (int pitch = -80; pitch <= 80; pitch += 13) {
            float m[16];
            ComposeViewMatrix(Vec3{5.0f, 6.0f, 7.0f},
                              static_cast<float>(yaw),
                              static_cast<float>(pitch), m);
            ViewSample sample;
            CHECK(DecodeViewMatrix(m, &sample) == DecodeResult::Ok);
            CHECK_NEAR(Length(sample.forward), 1.0f, 1e-3);
            CHECK_NEAR(Length(sample.right), 1.0f, 1e-3);
            CHECK_NEAR(Length(sample.up), 1.0f, 1e-3);
            CHECK_NEAR(Dot(sample.forward, sample.right), 0.0f, 1e-3);
            CHECK_NEAR(Dot(sample.forward, sample.up), 0.0f, 1e-3);
            CHECK_NEAR(Dot(sample.right, sample.up), 0.0f, 1e-3);
        }
    }
}

TEST(ViewMatrix, BasisDeltaScoresRotationAboveTranslation) {
    ViewSample still;
    ViewSample turned;
    ViewSample moved;

    float m[16];
    ComposeViewMatrix(Vec3{0, 0, 0}, 0.0f, 0.0f, m);
    DecodeViewMatrix(m, &still);
    ComposeViewMatrix(Vec3{0, 0, 0}, 30.0f, 0.0f, m);
    DecodeViewMatrix(m, &turned);
    ComposeViewMatrix(Vec3{10.0f, 0, 0}, 0.0f, 0.0f, m);
    DecodeViewMatrix(m, &moved);

    // A camera that turns 30 degrees must outscore one that slides 10 metres,
    // because that is what distinguishes the player's view from a shadow
    // cascade tracking them.
    CHECK(BasisDelta(still, turned) > BasisDelta(still, moved));
    CHECK_NEAR(BasisDelta(still, still), 0.0f, 1e-6);
}

TEST(ViewMatrix, FuzzNeverAcceptsRandomGarbage) {
    // Deterministic seed: a fuzz failure has to be reproducible to be useful.
    std::mt19937 rng(0xC0FFEEu);
    std::uniform_real_distribution<float> wide(-1000.0f, 1000.0f);

    int accepted = 0;
    constexpr int kIterations = 200000;
    for (int i = 0; i < kIterations; ++i) {
        float m[16];
        for (float& value : m) value = wide(rng);

        ViewSample sample;
        if (DecodeViewMatrix(m, &sample) == DecodeResult::Ok) {
            ++accepted;
            // If random noise ever does decode, it still must not produce
            // values that would poison the camera downstream.
            CHECK(AllFinite(sample.position));
            CHECK_NEAR(Length(sample.forward), 1.0f, 0.05);
        }
    }
    // Random 4x4 blocks are not rigid transforms. Anything above zero here
    // would mean the orthonormality gate is not doing its job.
    CHECK_MSG(accepted == 0,
              "random matrices accepted: " + std::to_string(accepted));
}

TEST(ViewMatrix, FuzzWithPlausibleStructureStillRejects) {
    // Harder fuzz: matrices that already have the identity edge, so only
    // orthonormality and the position bound can reject them.
    std::mt19937 rng(0xBADC0DEu);
    std::uniform_real_distribution<float> unit(-1.0f, 1.0f);
    std::uniform_real_distribution<float> position(-500.0f, 500.0f);

    int accepted = 0;
    for (int i = 0; i < 100000; ++i) {
        float m[16] = {};
        for (int row = 0; row < 3; ++row) {
            for (int column = 0; column < 3; ++column) {
                m[row * 4 + column] = unit(rng);
            }
        }
        m[12] = position(rng);
        m[13] = position(rng);
        m[14] = position(rng);
        m[15] = 1.0f;

        ViewSample sample;
        if (DecodeViewMatrix(m, &sample) == DecodeResult::Ok) {
            ++accepted;
            CHECK_NEAR(Length(sample.forward), 1.0f, 0.05);
            CHECK_NEAR(Dot(sample.forward, sample.right), 0.0f, 0.05);
        }
    }
    // A random 3x3 being orthonormal to within 1% has vanishing probability,
    // but if one slips through it must still be a genuine rotation -- which the
    // assertions above enforce.
    CHECK_MSG(accepted < 10,
              "too many structured-random matrices accepted: " +
                  std::to_string(accepted));
}
