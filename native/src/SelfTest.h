// SelfTest.h -- assertions that can only be checked inside the running game.
//
// The host test suite covers the algorithms; CI covers whether the code
// compiles. Neither can tell you that the hooks actually installed in Baldur's
// Gate 3, that the scanner finds a pattern in a real mapped module, or that the
// configured pointer chain reaches a readable object on this particular build.
// Those are exactly the things that go wrong on a first install.
//
// Bound to a hotkey (F7 by default). Writes FPCamera.selftest.log as one line
// per check, so a first run produces something specific to paste back rather
// than an impression that "it didn't work".
//
// Every check is read-only with one exception, which writes and then restores
// a buffer this DLL owns. Nothing here touches the game's own state.
#pragma once

#include "Common.h"
#include "Signatures.h"

#include <string>
#include <vector>

namespace fpcam::selftest {

enum class Outcome {
    Pass,
    Fail,
    // The check could not run -- a feature is off, or a signature the check
    // depends on was never resolved. Distinct from Fail on purpose: "not
    // configured" and "configured and broken" call for different responses.
    Skip,
};

struct CheckResult {
    Outcome outcome = Outcome::Skip;
    std::string name;
    std::string detail;
};

struct Report {
    std::vector<CheckResult> checks;
    size_t passed = 0;
    size_t failed = 0;
    size_t skipped = 0;

    bool Ok() const { return failed == 0; }
};

struct Context {
    const SignatureRegistry* signatures = nullptr;
    uint64_t framesPresented = 0;
};

// Runs every check and writes the report to <plugin dir>/FPCamera.selftest.log,
// as well as to the main log. Safe to call at any time from the hotkey thread.
Report Run(const Context& context);

}  // namespace fpcam::selftest
