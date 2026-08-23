#include "EyePlacement.h"

namespace fpcam::core {
namespace {

// The value read back is the exact float we wrote, so this only needs to
// absorb conversion noise, not real motion. Kept far below any plausible
// per-frame camera movement.
constexpr float kSameValueEpsilon = 1.0e-6f;

}  // namespace

EyePlacementOutput EyePlacement::Solve(const EyePlacementInput& input) {
    EyePlacementOutput output;

    // Refuse to derive anything from garbage. Writing a NaN into the camera's
    // position is not a visual glitch, it is a hard crash a frame later.
    if (!AllFinite(input.enginePosition)) return output;
    if (!std::isfinite(input.eyeHeight)) return output;
    if (!std::isfinite(input.forwardOffset)) return output;

    Vec3 base = input.enginePosition;

    // If what we just read is bit-for-bit what we wrote last frame, the engine
    // did not refresh the field. Building on it would add the eye offset a
    // second time, and again every frame after that.
    if (hasBase_ && NearlyEqual(input.enginePosition, lastWritten_,
                                kSameValueEpsilon)) {
        base = base_;
        output.reusedBase = true;
    }

    const float radius = input.sanityRadius;
    if (std::fabs(base.x) > radius || std::fabs(base.y) > radius ||
        std::fabs(base.z) > radius) {
        // Far outside any real level: the offset is probably wrong and points
        // at something that is not a position at all.
        return output;
    }

    const Vec3 flatForward = Flatten(input.forward);
    const Vec3 eye = base + Vec3{0.0f, input.eyeHeight, 0.0f} +
                     flatForward * input.forwardOffset;

    if (!AllFinite(eye)) return output;

    base_ = base;
    lastWritten_ = eye;
    hasBase_ = true;

    output.write = true;
    output.position = eye;
    return output;
}

void EyePlacement::Reset() {
    hasBase_ = false;
    base_ = Vec3{};
    lastWritten_ = Vec3{};
}

}  // namespace fpcam::core
