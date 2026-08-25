// test_resolvechain.cpp -- instruction address to target address.
//
// The failure this guards against is the nastiest kind: arithmetic that is
// wrong but produces a plausible-looking address, so the plugin resolves
// "successfully" and then reads or writes the wrong structure. Negative
// RIP-relative displacements are the common case in real binaries (data
// frequently sits below the code referencing it), so sign extension is the
// main event here, not an edge case.
#include "Harness.h"

#include "core/ResolveChain.h"

#include <cstring>
#include <map>

using namespace fpcam::core;

namespace {

// A fake address space: only what is explicitly placed is readable, so an
// unmapped read is a real, testable outcome rather than a segfault.
class FakeMemory {
public:
    void Place(uintptr_t address, const void* data, size_t size) {
        const auto* bytes = static_cast<const uint8_t*>(data);
        for (size_t i = 0; i < size; ++i) {
            cells_[address + i] = bytes[i];
        }
    }

    void PlaceInt32(uintptr_t address, int32_t value) {
        Place(address, &value, sizeof(value));
    }

    void PlacePointer(uintptr_t address, uintptr_t value) {
        Place(address, &value, sizeof(value));
    }

    MemoryReader Reader() {
        return [this](uintptr_t address, void* destination, size_t size) {
            auto* out = static_cast<uint8_t*>(destination);
            for (size_t i = 0; i < size; ++i) {
                const auto it = cells_.find(address + i);
                if (it == cells_.end()) return false;
                out[i] = it->second;
            }
            return true;
        };
    }

private:
    std::map<uintptr_t, uint8_t> cells_;
};

}  // namespace

TEST(ResolveChain, AddAndSubShiftTheAddress) {
    FakeMemory memory;
    const auto outcome = ApplyResolveChain(
        0x1000, {{ResolveOp::Add, 0x40, 0}, {ResolveOp::Sub, 0x10, 0}},
        memory.Reader());
    CHECK(outcome.ok);
    CHECK_EQ(outcome.address, uintptr_t{0x1030});
}

TEST(ResolveChain, DerefFollowsAPointer) {
    FakeMemory memory;
    memory.PlacePointer(0x2000, 0xDEADBEEF);
    const auto outcome =
        ApplyResolveChain(0x2000, {{ResolveOp::Deref, 0, 0}}, memory.Reader());
    CHECK(outcome.ok);
    CHECK_EQ(outcome.address, uintptr_t{0xDEADBEEF});
}

TEST(ResolveChain, Rip32ResolvesAPositiveDisplacement) {
    // mov rax, [rip+0x100] encoded as 48 8B 05 <disp32>: the displacement sits
    // 3 bytes in and is relative to the end of the 7-byte instruction.
    FakeMemory memory;
    memory.PlaceInt32(0x1000 + 3, 0x100);
    const auto outcome = ApplyResolveChain(
        0x1000, {{ResolveOp::Rip32, 3, 7}}, memory.Reader());
    CHECK(outcome.ok);
    CHECK_EQ(outcome.address, uintptr_t{0x1000 + 7 + 0x100});
}

TEST(ResolveChain, Rip32SignExtendsANegativeDisplacement) {
    // The case that matters. Zero-extending instead of sign-extending would
    // land roughly 4 GB away -- still a mapped-looking address on x64, so the
    // mistake would not announce itself.
    FakeMemory memory;
    memory.PlaceInt32(0x100000 + 3, -0x2000);
    const auto outcome = ApplyResolveChain(
        0x100000, {{ResolveOp::Rip32, 3, 7}}, memory.Reader());
    CHECK(outcome.ok);
    CHECK_EQ(outcome.address, uintptr_t{0x100000 + 7 - 0x2000});
    // Explicitly assert the bug did not happen.
    CHECK(outcome.address < 0x100000);
}

TEST(ResolveChain, Rip32HandlesTheMostNegativeDisplacement) {
    FakeMemory memory;
    const int32_t extreme = -2147483647 - 1;  // INT32_MIN without the macro
    memory.PlaceInt32(0x80000000 + 3, extreme);
    const auto outcome = ApplyResolveChain(
        0x80000000, {{ResolveOp::Rip32, 3, 7}}, memory.Reader());
    CHECK(outcome.ok);
    CHECK_EQ(outcome.address,
             uintptr_t{0x80000000} + 7 + static_cast<uintptr_t>(
                                             static_cast<int64_t>(extreme)));
}

TEST(ResolveChain, Rel32AddsWithoutTheInstructionLength) {
    FakeMemory memory;
    memory.PlaceInt32(0x3000 + 1, -0x40);
    const auto outcome =
        ApplyResolveChain(0x3000, {{ResolveOp::Rel32, 1, 0}}, memory.Reader());
    CHECK(outcome.ok);
    CHECK_EQ(outcome.address, uintptr_t{0x3000 - 0x40});
}

TEST(ResolveChain, ChainsStepsInOrder) {
    // The realistic shape: find a RIP-relative global, then walk one field
    // offset into the object it points at.
    FakeMemory memory;
    // 0x1000 + 7 (instruction length) + 0x500 = 0x1507.
    memory.PlaceInt32(0x1000 + 3, 0x500);          // -> global at 0x1507
    memory.PlacePointer(0x1507, 0x9000);           // -> object at 0x9000
    const auto outcome = ApplyResolveChain(
        0x1000,
        {{ResolveOp::Rip32, 3, 7}, {ResolveOp::Deref, 0, 0},
         {ResolveOp::Add, 0x18, 0}},
        memory.Reader());
    CHECK(outcome.ok);
    CHECK_EQ(outcome.address, uintptr_t{0x9018});
}

TEST(ResolveChain, FailsOnUnmappedReads) {
    FakeMemory memory;  // nothing placed
    const auto deref =
        ApplyResolveChain(0x1000, {{ResolveOp::Deref, 0, 0}}, memory.Reader());
    CHECK(!deref.ok);
    CHECK_CONTAINS(deref.error, "unreadable");
    CHECK_EQ(deref.failedStep, size_t{0});

    const auto rip = ApplyResolveChain(
        0x1000, {{ResolveOp::Add, 0, 0}, {ResolveOp::Rip32, 3, 7}},
        memory.Reader());
    CHECK(!rip.ok);
    CHECK_EQ(rip.failedStep, size_t{1});
}

TEST(ResolveChain, RejectsRip32WithoutAnInstructionLength) {
    // Silently treating a missing length as zero would resolve to an address
    // that is wrong by exactly the instruction size -- close enough to look
    // like a near miss and waste hours.
    FakeMemory memory;
    memory.PlaceInt32(0x1000 + 3, 0x10);
    for (const int32_t length : {0, -1, -7}) {
        const auto outcome = ApplyResolveChain(
            0x1000, {{ResolveOp::Rip32, 3, length}}, memory.Reader());
        CHECK(!outcome.ok);
        CHECK_CONTAINS(outcome.error, "instructionLength");
    }
}

TEST(ResolveChain, RejectsANullResult) {
    FakeMemory memory;
    memory.PlacePointer(0x2000, 0);
    const auto outcome =
        ApplyResolveChain(0x2000, {{ResolveOp::Deref, 0, 0}}, memory.Reader());
    CHECK(!outcome.ok);
    CHECK_CONTAINS(outcome.error, "null");
}

TEST(ResolveChain, RejectsAMissingReader) {
    const auto outcome =
        ApplyResolveChain(0x1000, {{ResolveOp::Deref, 0, 0}}, MemoryReader{});
    CHECK(!outcome.ok);
    CHECK_CONTAINS(outcome.error, "reader");
}

TEST(ResolveChain, AnEmptyChainReturnsTheStartAddress) {
    FakeMemory memory;
    const auto outcome = ApplyResolveChain(0x1234, {}, memory.Reader());
    CHECK(outcome.ok);
    CHECK_EQ(outcome.address, uintptr_t{0x1234});
}

TEST(ResolveChain, OpNamesRoundTrip) {
    for (const ResolveOp op : {ResolveOp::Add, ResolveOp::Sub, ResolveOp::Deref,
                               ResolveOp::Rip32, ResolveOp::Rel32}) {
        ResolveOp parsed = ResolveOp::Add;
        CHECK(ResolveOpFromName(ResolveOpName(op), &parsed));
        CHECK(parsed == op);
    }
    ResolveOp ignored = ResolveOp::Add;
    // An unknown op must be reported, not defaulted -- defaulting to Add would
    // resolve to a wrong address instead of flagging a bad config.
    CHECK(!ResolveOpFromName("multiply", &ignored));
    CHECK(!ResolveOpFromName("", &ignored));
    CHECK(!ResolveOpFromName("ADD", &ignored));
}
