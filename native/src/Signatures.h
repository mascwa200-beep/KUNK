// Signatures.h -- the config-driven signature registry.
//
// Design note, and the single most important thing to understand about this
// mod: no byte pattern shipped with this repository has been verified against
// a real Baldur's Gate 3 binary. The patterns in FPCamera.signatures.json are
// TEMPLATES showing the shape of the instruction sequences to look for. They
// are expected to be replaced by the user with patterns derived from their own
// installed build. docs/SIGNATURES.md explains how.
//
// Everything here is therefore built around failing loudly and safely:
//   * a signature that matches nothing disables the feature that needs it,
//     rather than falling back to a guessed address;
//   * a signature that matches more than once is treated as a failure, because
//     silently taking the first of several hits is how a mod ends up writing
//     into an unrelated structure;
//   * every outcome, good or bad, is written to the log as a scan report.
#pragma once

#include "Common.h"
#include "MemoryScanner.h"
#include "core/ResolveChain.h"

#include <optional>
#include <unordered_map>
#include <vector>

namespace fpcam {

// The resolve op-chain -- the arithmetic that turns a matched instruction into
// the address a feature wants -- lives in core/ResolveChain.h, where the test
// suite drives it against a fake address space. RIP-relative sign extension in
// particular is easy to get wrong in a way that still produces a plausible
// address, so it is pinned there rather than trusted here.
using core::ResolveOp;
using core::ResolveStep;

struct SignatureDef {
    std::string name;
    std::string pattern;
    std::wstring moduleName = L"bg3_dx11.exe";
    std::string sectionName = ".text";
    std::vector<ResolveStep> resolve;

    // When non-zero, scanning is skipped entirely and this address is used.
    // Either an absolute address or, if `manualIsRelative`, an offset from the
    // module base -- the latter is what Cheat Engine and Ghidra report, and is
    // what survives ASLR between launches.
    uintptr_t manualAddress = 0;
    bool manualIsRelative = true;

    // Purely informational, echoed in the scan report so the user can see at a
    // glance which patterns they have replaced with verified ones.
    bool verified = false;
    std::string notes;

    // When false, a failure to resolve is logged at INFO rather than WARN and
    // does not count towards "the mod could not start". Used for optional
    // features such as the clamp-instruction patch sites.
    bool required = false;
};

struct SignatureResult {
    bool ok = false;
    uintptr_t address = 0;
    size_t hitCount = 0;
    std::string error;
};

class SignatureRegistry {
public:
    // Loads definitions from <plugin dir>/FPCamera.signatures.json.
    // Returns false only if the file is missing or malformed -- individual
    // signatures that fail to parse are reported and skipped.
    bool Load(const std::wstring& fileName);

    // Scans for every definition. Safe to call again after the game has fully
    // initialised, which is sometimes necessary because BG3 loads additional
    // modules after the plugin's own startup.
    void ResolveAll();

    // Address for a named signature, or nullopt if it did not resolve.
    std::optional<uintptr_t> Get(std::string_view name) const;

    // Writes the full outcome table to the log. This is the user's primary
    // diagnostic and is emitted on every startup, not just on failure.
    void LogReport() const;

    const std::string& GameVersion() const { return gameVersion_; }
    size_t ResolvedCount() const;
    size_t RequiredFailureCount() const;

private:
    SignatureResult ResolveOne(const SignatureDef& def) const;

    std::vector<SignatureDef> definitions_;
    std::unordered_map<std::string, SignatureResult> results_;
    std::string gameVersion_;   // "gameBuild" field, informational
    std::string sourceFile_;
};

// Reads the file version resource of the running game executable, so the scan
// report records which build the signatures were tried against. This is what
// lets a user tell at a glance that their signatures are stale after a patch.
std::string RunningGameVersion();

}  // namespace fpcam
