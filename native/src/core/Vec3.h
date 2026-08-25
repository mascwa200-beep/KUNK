// Vec3.h -- the small vector type shared by the portable core.
//
// Everything under core/ is deliberately free of Windows headers so it can be
// compiled and executed by the test suite on any host. Baldur's Gate 3 uses a
// Y-up world, so "horizontal" throughout means the XZ plane.
#pragma once

#include <cmath>

namespace fpcam::core {

struct Vec3 {
    float x = 0.0f;
    float y = 0.0f;
    float z = 0.0f;
};

constexpr Vec3 MakeVec3(float x, float y, float z) { return Vec3{x, y, z}; }

constexpr Vec3 operator+(const Vec3& a, const Vec3& b) {
    return Vec3{a.x + b.x, a.y + b.y, a.z + b.z};
}

constexpr Vec3 operator-(const Vec3& a, const Vec3& b) {
    return Vec3{a.x - b.x, a.y - b.y, a.z - b.z};
}

constexpr Vec3 operator*(const Vec3& v, float s) {
    return Vec3{v.x * s, v.y * s, v.z * s};
}

constexpr float Dot(const Vec3& a, const Vec3& b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

constexpr Vec3 Cross(const Vec3& a, const Vec3& b) {
    return Vec3{a.y * b.z - a.z * b.y,
                a.z * b.x - a.x * b.z,
                a.x * b.y - a.y * b.x};
}

inline float Length(const Vec3& v) { return std::sqrt(Dot(v, v)); }

inline Vec3 Normalize(const Vec3& v) {
    const float length = Length(v);
    if (!(length > 1e-6f)) return Vec3{0.0f, 0.0f, 0.0f};  // also catches NaN
    return v * (1.0f / length);
}

// Projects onto the horizontal plane and re-normalises. Used wherever looking
// up or down must not translate into vertical motion -- movement direction and
// the camera's forward eye offset both depend on this.
inline Vec3 Flatten(const Vec3& v) {
    return Normalize(Vec3{v.x, 0.0f, v.z});
}

inline bool AllFinite(const Vec3& v) {
    return std::isfinite(v.x) && std::isfinite(v.y) && std::isfinite(v.z);
}

// Component-wise equality within `epsilon`. Used by EyePlacement to decide
// whether the engine refreshed a field or left our own write sitting there.
inline bool NearlyEqual(const Vec3& a, const Vec3& b, float epsilon) {
    return std::fabs(a.x - b.x) <= epsilon &&
           std::fabs(a.y - b.y) <= epsilon &&
           std::fabs(a.z - b.z) <= epsilon;
}

}  // namespace fpcam::core
