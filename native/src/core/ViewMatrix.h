// ViewMatrix.h -- recognising and decoding the game's camera matrix.
//
// Every frame the game must upload a view matrix to the GPU. That gives us a
// way to find the camera that needs no signature scanning and cannot break on a
// patch, because the Direct3D ABI is fixed. The catch is telling the camera's
// matrix apart from the dozens of other 4x4 float blocks a frame writes --
// shadow cascades, UI transforms, skinning palettes, model matrices.
//
// The discriminator is that a view matrix is a *rigid* transform: its rotation
// part is orthonormal. Model and world matrices carry scale, which breaks
// orthonormality; projection matrices have a zero in the corner. Combined with
// a plausibility bound on the decoded eye position this rejects essentially
// everything that is not a camera.
//
// A false positive here is not cosmetic: the decoded basis drives movement
// direction and the camera's initial orientation, so locking on to a shadow
// cascade would send the player walking sideways. Hence the tolerances are
// tight and every rejection reason is a separate testable branch.
#pragma once

#include "Angles.h"
#include "Vec3.h"

#include <cstdint>

namespace fpcam::core {

// A decoded view matrix: where the camera is and which way it faces.
struct ViewSample {
    bool valid = false;

    Vec3 position;
    Vec3 right{1.0f, 0.0f, 0.0f};
    Vec3 up{0.0f, 1.0f, 0.0f};
    Vec3 forward{0.0f, 0.0f, 1.0f};

    float yawDegrees = 0.0f;
    float pitchDegrees = 0.0f;

    uint64_t frame = 0;
};

// Which storage convention a candidate matched.
enum class MatrixLayout {
    None,
    // Row-vector world-to-view (v' = v * M), what DirectXMath produces:
    // basis vectors run down the columns, translation is the last row.
    RowVector,
    // The transpose, which is what HLSL's default column-major packing wants:
    // translation is the last column.
    ColumnVector,
};

// Why a candidate was rejected. Exposed so tests can assert the *reason*, not
// merely that something was refused -- a decoder that rejects everything for
// the wrong reason would otherwise look correct.
enum class DecodeResult {
    Ok,
    NotFinite,        // NaN, infinity, or absurd magnitude
    NoIdentityEdge,   // neither last row nor last column looks like (0,0,0,1)
    NotOrthonormal,   // the rotation part carries scale, shear or projection
    ImplausiblePosition,
};

struct DecodeOptions {
    // How far from perfectly orthonormal a rotation may be. Tight enough to
    // reject a matrix with even a few percent of scale; loose enough to absorb
    // float32 round-off from the game's own maths.
    float orthonormalTolerance = 0.01f;
    // Largest |component| tolerated anywhere in the matrix.
    float maxComponent = 1.0e6f;
    // Largest |component| tolerated in the decoded eye position. BG3 levels are
    // a few thousand units across; 200 km means a decoding error.
    float maxPosition = 200000.0f;
};

// True when the three vectors form an orthonormal set within `tolerance`.
inline bool IsOrthonormal(const Vec3& a, const Vec3& b, const Vec3& c,
                          float tolerance) {
    if (std::fabs(Length(a) - 1.0f) > tolerance) return false;
    if (std::fabs(Length(b) - 1.0f) > tolerance) return false;
    if (std::fabs(Length(c) - 1.0f) > tolerance) return false;
    if (std::fabs(Dot(a, b)) > tolerance) return false;
    if (std::fabs(Dot(a, c)) > tolerance) return false;
    if (std::fabs(Dot(b, c)) > tolerance) return false;
    return true;
}

// Attempts to decode 16 floats as a view matrix.
//
// `matrix` is in row-major storage: matrix[row * 4 + column]. Both layouts
// above are tried. `layout` and the return value report what happened; `out` is
// only written when the return value is Ok.
DecodeResult DecodeViewMatrix(const float matrix[16], ViewSample* out,
                              MatrixLayout* layout = nullptr,
                              const DecodeOptions& options = {});

// Builds a row-vector view matrix looking from `eye` along the given angles --
// the exact inverse of DecodeViewMatrix for that layout. Used by the tests and
// by the in-game self-test to generate known-good input.
void ComposeViewMatrix(const Vec3& eye, float yawDegrees, float pitchDegrees,
                       float matrix[16]);

// Transposes in place, to produce a ColumnVector-layout matrix from a
// RowVector one.
void TransposeMatrix(float matrix[16]);

// How much two samples differ, used to score which candidate is actually
// tracking the player's camera. A matrix that never moves is not a camera.
float BasisDelta(const ViewSample& a, const ViewSample& b);

}  // namespace fpcam::core
