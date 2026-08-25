// Harness.h -- a minimal self-registering test framework.
//
// Deliberately hand-rolled rather than gtest or Catch2. The test suite has to
// run in CI on both Windows and Linux, and pulling a framework in via
// FetchContent means every CI run depends on a network fetch succeeding. A
// hundred lines of macros costs less than that dependency.
//
// Failures report the file, line, expression and both values, and a failing
// check does not abort the suite -- the point of a run is to learn everything
// that is broken, not the first thing.
#pragma once

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace harness {

struct TestCase {
    const char* suite;
    const char* name;
    void (*fn)();
};

inline std::vector<TestCase>& Registry() {
    static std::vector<TestCase> registry;
    return registry;
}

struct Registrar {
    Registrar(const char* suite, const char* name, void (*fn)()) {
        Registry().push_back(TestCase{suite, name, fn});
    }
};

inline int& FailureCount() {
    static int count = 0;
    return count;
}

inline int& CheckCount() {
    static int count = 0;
    return count;
}

inline void ReportFailure(const char* file, int line, const std::string& what) {
    ++FailureCount();
    std::printf("    FAIL %s:%d\n         %s\n", file, line, what.c_str());
}

// Formatting helpers so the failure text shows actual values.
inline std::string Show(bool v)         { return v ? "true" : "false"; }
inline std::string Show(int v)          { return std::to_string(v); }
inline std::string Show(long v)         { return std::to_string(v); }
inline std::string Show(long long v)    { return std::to_string(v); }
inline std::string Show(unsigned v)     { return std::to_string(v); }
inline std::string Show(unsigned long v){ return std::to_string(v); }
inline std::string Show(unsigned long long v) { return std::to_string(v); }
inline std::string Show(float v)        { return std::to_string(v); }
inline std::string Show(double v)       { return std::to_string(v); }
inline std::string Show(const std::string& v) { return "\"" + v + "\""; }
inline std::string Show(const char* v)  { return v == nullptr ? "<null>" : std::string("\"") + v + "\""; }

}  // namespace harness

#define TEST(suite_name, test_name)                                            \
    static void suite_name##_##test_name();                                    \
    static ::harness::Registrar registrar_##suite_name##_##test_name(          \
        #suite_name, #test_name, &suite_name##_##test_name);                   \
    static void suite_name##_##test_name()

#define CHECK(expr)                                                            \
    do {                                                                       \
        ++::harness::CheckCount();                                             \
        if (!(expr)) {                                                         \
            ::harness::ReportFailure(__FILE__, __LINE__,                       \
                                     std::string("expected: ") + #expr);       \
        }                                                                      \
    } while (false)

#define CHECK_MSG(expr, msg)                                                   \
    do {                                                                       \
        ++::harness::CheckCount();                                             \
        if (!(expr)) {                                                         \
            ::harness::ReportFailure(__FILE__, __LINE__,                       \
                std::string("expected: ") + #expr + "  -- " + (msg));          \
        }                                                                      \
    } while (false)

#define CHECK_EQ(actual, expected)                                             \
    do {                                                                       \
        ++::harness::CheckCount();                                             \
        const auto actual_value_ = (actual);                                   \
        const auto expected_value_ = (expected);                               \
        if (!(actual_value_ == expected_value_)) {                             \
            ::harness::ReportFailure(__FILE__, __LINE__,                       \
                std::string(#actual) + " == " + #expected +                    \
                "\n         actual:   " + ::harness::Show(actual_value_) +     \
                "\n         expected: " + ::harness::Show(expected_value_));   \
        }                                                                      \
    } while (false)

#define CHECK_NEAR(actual, expected, tolerance)                                \
    do {                                                                       \
        ++::harness::CheckCount();                                             \
        const double actual_value_ = static_cast<double>(actual);              \
        const double expected_value_ = static_cast<double>(expected);          \
        const double tolerance_ = static_cast<double>(tolerance);              \
        if (!(std::fabs(actual_value_ - expected_value_) <= tolerance_)) {     \
            ::harness::ReportFailure(__FILE__, __LINE__,                       \
                std::string(#actual) + " ~= " + #expected +                    \
                "\n         actual:   " + ::harness::Show(actual_value_) +     \
                "\n         expected: " + ::harness::Show(expected_value_) +   \
                "\n         tolerance:" + ::harness::Show(tolerance_));        \
        }                                                                      \
    } while (false)

#define CHECK_CONTAINS(haystack, needle)                                       \
    do {                                                                       \
        ++::harness::CheckCount();                                             \
        const std::string haystack_ = (haystack);                              \
        const std::string needle_ = (needle);                                  \
        if (haystack_.find(needle_) == std::string::npos) {                    \
            ::harness::ReportFailure(__FILE__, __LINE__,                       \
                std::string(#haystack) + " should contain " +                  \
                ::harness::Show(needle_) +                                     \
                "\n         actual: " + ::harness::Show(haystack_));           \
        }                                                                      \
    } while (false)
