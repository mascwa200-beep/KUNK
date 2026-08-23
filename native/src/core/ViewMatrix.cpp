#include "ViewMatrix.h"

#include <cmath>

namespace fpcam::core {
namespace {

bool AllComponentsSane(const float matrix[16], float maxComponent) {
    for (int i = 0; i < 16; ++i) {
        if (!std::isfinite(matrix[i])) return false;
        if (std::fabs(matrix[i]) > maxComponent) return false;
    }
    return true;
}

}  // namespace

DecodeResult DecodeViewMatrix(const float matrix[16], ViewSample* out,
                              MatrixLayout* layout,
                              const DecodeOptions& options) {
    if (layout != nullptr) *layout = MatrixLayout::None;

    if (!AllComponentsSane(matrix, options.maxComponent)) {
        return DecodeResult::NotFinite;
    }

    const float tolerance = options.orthonormalTolerance;

    // A rigid transform leaves one edge of the matrix as (0, 0, 0, 1). Which
    // edge tells us the storage convention.
    const bool lastColumnIsIdentity =
        std::fabs(matrix[3]) < tolerance && std::fabs(matrix[7]) < tolerance &&
        std::fabs(matrix[11]) < tolerance &&
        std::fabs(matrix[15] - 1.0f) < tolerance;

    const bool lastRowIsIdentity =
        std::fabs(matrix[12]) < tolerance && std::fabs(matrix[13]) < tolerance &&
        std::fabs(matrix[14]) < tolerance &&
        std::fabs(matrix[15] - 1.0f) < tolerance;

    if (!lastColumnIsIdentity && !lastRowIsIdentity) {
        // Projection matrices land here: they carry a -1 or 1 in the corner
        // and a 0 in matrix[15].
        return DecodeResult::NoIdentityEdge;
    }

    Vec3 right, up, forward, translation;
    MatrixLayout chosen;

    // When both edges look like an identity edge the translation is zero -- the
    // camera sits at the world origin -- and the two layouts are genuinely
    // indistinguishable, differing only by transposing the rotation. We prefer
    // RowVector, which is what DirectXMath emits. The decoded position is
    // correct either way; only the basis handedness could be flipped, and a
    // camera exactly at the origin is not a real gameplay state.
    if (lastColumnIsIdentity) {
        chosen = MatrixLayout::RowVector;
        right       = Vec3{matrix[0], matrix[4], matrix[8]};
        up          = Vec3{matrix[1], matrix[5], matrix[9]};
        forward     = Vec3{matrix[2], matrix[6], matrix[10]};
        translation = Vec3{matrix[12], matrix[13], matrix[14]};
    } else {
        chosen = MatrixLayout::ColumnVector;
        right       = Vec3{matrix[0], matrix[1], matrix[2]};
        up          = Vec3{matrix[4], matrix[5], matrix[6]};
        forward     = Vec3{matrix[8], matrix[9], matrix[10]};
        translation = Vec3{matrix[3], matrix[7], matrix[11]};
    }

    if (!IsOrthonormal(right, up, forward, tolerance)) {
        return DecodeResult::NotOrthonormal;
    }

    // The view matrix maps world space into camera space, so the eye position
    // is the negated translation expressed back along the camera axes.
    const Vec3 eye = (right * translation.x + up * translation.y +
                      forward * translation.z) * -1.0f;

    if (!AllFinite(eye) || std::fabs(eye.x) > options.maxPosition ||
        std::fabs(eye.y) > options.maxPosition ||
        std::fabs(eye.z) > options.maxPosition) {
        return DecodeResult::ImplausiblePosition;
    }

    if (out != nullptr) {
        out->valid = true;
        out->position = eye;
        out->right = right;
        out->up = up;
        out->forward = forward;
        out->yawDegrees = WrapDegrees(YawFromForward(forward));
        out->pitchDegrees = PitchFromForward(forward);
    }
    if (layout != nullptr) *layout = chosen;
    return DecodeResult::Ok;
}

void ComposeViewMatrix(const Vec3& eye, float yawDegrees, float pitchDegrees,
                       float matrix[16]) {
    const Basis basis = BasisFromYawPitch(yawDegrees, pitchDegrees);

    matrix[0]  = basis.right.x;
    matrix[1]  = basis.up.x;
    matrix[2]  = basis.forward.x;
    matrix[3]  = 0.0f;

    matrix[4]  = basis.right.y;
    matrix[5]  = basis.up.y;
    matrix[6]  = basis.forward.y;
    matrix[7]  = 0.0f;

    matrix[8]  = basis.right.z;
    matrix[9]  = basis.up.z;
    matrix[10] = basis.forward.z;
    matrix[11] = 0.0f;

    matrix[12] = -Dot(basis.right, eye);
    matrix[13] = -Dot(basis.up, eye);
    matrix[14] = -Dot(basis.forward, eye);
    matrix[15] = 1.0f;
}

void TransposeMatrix(float matrix[16]) {
    for (int row = 0; row < 4; ++row) {
        for (int column = row + 1; column < 4; ++column) {
            const float temporary = matrix[row * 4 + column];
            matrix[row * 4 + column] = matrix[column * 4 + row];
            matrix[column * 4 + row] = temporary;
        }
    }
}

float BasisDelta(const ViewSample& a, const ViewSample& b) {
    // Rotation dominates: turning the camera is the strongest signal that a
    // candidate is the player's view. Translation still counts, scaled down so
    // that a matrix which only ever pans (a cutscene rail, a shadow cascade
    // following the player) does not outscore one that actually looks around.
    return std::fabs(a.forward.x - b.forward.x) +
           std::fabs(a.forward.y - b.forward.y) +
           std::fabs(a.forward.z - b.forward.z) +
           (std::fabs(a.position.x - b.position.x) +
            std::fabs(a.position.y - b.position.y) +
            std::fabs(a.position.z - b.position.z)) * 0.01f;
}

}  // namespace fpcam::core
