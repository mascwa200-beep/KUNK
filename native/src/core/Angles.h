// Angles.h -- angle normalisation and the camera basis.
//
// The conventions here are the contract between the camera, the movement code
// and the view-matrix decoder, so they are stated once and shared rather than
// re-derived in three places:
//
//   * Y is up.
//   * yaw  = atan2(forward.x, forward.z), degrees, wrapped to [-180, 180).
//   * pitch = asin(forward.y), degrees, positive looking up.
//
// BasisFromYawPitch and the decoder in ViewMatrix.h are exact inverses of each
// other, which the test suite checks over a grid rather than taking on trust.
#pragma once

#include "Vec3.h"

namespace fpcam::core {

inline constexpr float kPi = 3.14159265358979323846f;
inline constexpr float kDegToRad = kPi / 180.0f;
inline constexpr float kRadToDeg = 180.0f / kPi;

template <typename T>
constexpr T Clamp(T value, T low, T high) {
    return value < low ? low : (value > high ? high : value);
}

// Wraps to [-180, 180). Camera yaw accumulates without bound as the mouse
// turns, and some camera structures reject out-of-range values, so every write
// is normalised first. Returns 0 for non-finite input rather than propagating
// NaN into the game's camera.
inline float WrapDegrees(float degrees) {
    if (!std::isfinite(degrees)) return 0.0f;
    degrees = std::fmod(degrees + 180.0f, 360.0f);
    if (degrees < 0.0f) degrees += 360.0f;
    return degrees - 180.0f;
}

struct Basis {
    Vec3 right;
    Vec3 up;
    Vec3 forward;
};

inline Vec3 ForwardFromYawPitch(float yawDegrees, float pitchDegrees) {
    const float yaw = yawDegrees * kDegToRad;
    const float pitch = pitchDegrees * kDegToRad;
    const float cosPitch = std::cos(pitch);
    return Vec3{std::sin(yaw) * cosPitch, std::sin(pitch),
                std::cos(yaw) * cosPitch};
}

// Right is derived from yaw alone so that strafing stays horizontal however far
// up or down the player is looking.
inline Vec3 RightFromYaw(float yawDegrees) {
    const float yaw = yawDegrees * kDegToRad;
    return Vec3{std::cos(yaw), 0.0f, -std::sin(yaw)};
}

inline Basis BasisFromYawPitch(float yawDegrees, float pitchDegrees) {
    Basis basis;
    basis.forward = ForwardFromYawPitch(yawDegrees, pitchDegrees);
    basis.right = RightFromYaw(yawDegrees);
    basis.up = Cross(basis.forward, basis.right);
    return basis;
}

inline float YawFromForward(const Vec3& forward) {
    return std::atan2(forward.x, forward.z) * kRadToDeg;
}

inline float PitchFromForward(const Vec3& forward) {
    return std::asin(Clamp(forward.y, -1.0f, 1.0f)) * kRadToDeg;
}

}  // namespace fpcam::core
