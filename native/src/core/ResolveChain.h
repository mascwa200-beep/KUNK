// ResolveChain.h -- turning a matched instruction into the address a feature
// wants.
//
// A signature matches an instruction; what the plugin needs is whatever that
// instruction refers to. On x86-64 that is almost never a literal address --
// globals are reached through a RIP-relative displacement encoded relative to
// the *end* of the instruction. Getting that arithmetic wrong lands somewhere
// plausible-looking but incorrect, which is the worst possible failure mode
// because it looks like success.
//
// The displacement is a signed 32-bit value and is very often negative, since
// data frequently sits below the code that references it. Sign extension is
// therefore not an edge case here, it is the common path -- and it is the thing
// this unit exists to get right and to prove with a test.
//
// Memory access goes through a caller-supplied reader so a fake address space
// can be injected under test; the Windows build passes its guarded reader.
#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace fpcam::core {

enum class ResolveOp {
    Add,    // address += value
    Sub,    // address -= value
    Deref,  // address = *(uintptr_t*)address
    Rip32,  // read int32 at address+value, then += instructionLength + it
    Rel32,  // read int32 at address+value, then += it
};

struct ResolveStep {
    ResolveOp op = ResolveOp::Add;
    int64_t value = 0;             // byte offset within the matched instruction
    int32_t instructionLength = 0;  // total length, required by Rip32
};

// Reads `size` bytes at `address`, returning false if that is not readable.
using MemoryReader =
    std::function<bool(uintptr_t address, void* destination, size_t size)>;

struct ResolveOutcome {
    bool ok = false;
    uintptr_t address = 0;
    std::string error;       // human-readable, empty on success
    size_t failedStep = 0;   // index of the step that failed
};

// Applies `steps` in order to `start`.
//
// Fails, rather than returning a wrong answer, when: a Rip32 step has a
// non-positive instructionLength; any read is unmapped; or the result is null.
// Whether the final address is *usable* is the caller's business -- this only
// guarantees the arithmetic.
ResolveOutcome ApplyResolveChain(uintptr_t start,
                                 const std::vector<ResolveStep>& steps,
                                 const MemoryReader& reader);

// Maps the JSON spellings onto the enum. Returns false for an unknown name
// rather than silently defaulting to Add, which would resolve to a wrong
// address instead of reporting a bad config.
bool ResolveOpFromName(std::string_view name, ResolveOp* out);
const char* ResolveOpName(ResolveOp op);

}  // namespace fpcam::core
