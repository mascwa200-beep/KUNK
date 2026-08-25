// main.cpp -- the test runner.
//
// Runs every registered case, grouped by suite, and exits non-zero if anything
// failed so CI can gate on it. Pass a substring as argv[1] to run a subset.
#include "Harness.h"

#include <cstring>
#include <string>

int main(int argc, char** argv) {
    const std::string filter = argc > 1 ? argv[1] : std::string();

    auto& registry = harness::Registry();
    std::printf("Running %zu test case(s)%s\n\n", registry.size(),
                filter.empty() ? "" : (" matching '" + filter + "'").c_str());

    const char* currentSuite = nullptr;
    int ran = 0;
    int failuresBefore = 0;
    int suiteFailures = 0;

    for (const harness::TestCase& test : registry) {
        const std::string full = std::string(test.suite) + "." + test.name;
        if (!filter.empty() && full.find(filter) == std::string::npos) continue;

        if (currentSuite == nullptr ||
            std::strcmp(currentSuite, test.suite) != 0) {
            if (currentSuite != nullptr) {
                std::printf("\n");
            }
            currentSuite = test.suite;
            std::printf("[%s]\n", currentSuite);
        }

        failuresBefore = harness::FailureCount();
        test.fn();
        suiteFailures = harness::FailureCount() - failuresBefore;
        std::printf("  %-4s %s\n", suiteFailures == 0 ? "ok" : "FAIL",
                    test.name);
        ++ran;
    }

    std::printf("\n----------------------------------------\n");
    std::printf("%d case(s), %d assertion(s), %d failure(s)\n", ran,
                harness::CheckCount(), harness::FailureCount());
    if (harness::FailureCount() == 0) {
        std::printf("PASS\n");
        return 0;
    }
    std::printf("FAIL\n");
    return 1;
}
