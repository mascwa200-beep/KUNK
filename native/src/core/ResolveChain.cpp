#include "ResolveChain.h"

namespace fpcam::core {

bool ResolveOpFromName(std::string_view name, ResolveOp* out) {
    if (name == "add")   { *out = ResolveOp::Add;   return true; }
    if (name == "sub")   { *out = ResolveOp::Sub;   return true; }
    if (name == "deref") { *out = ResolveOp::Deref; return true; }
    if (name == "rip32") { *out = ResolveOp::Rip32; return true; }
    if (name == "rel32") { *out = ResolveOp::Rel32; return true; }
    return false;
}

const char* ResolveOpName(ResolveOp op) {
    switch (op) {
        case ResolveOp::Add:   return "add";
        case ResolveOp::Sub:   return "sub";
        case ResolveOp::Deref: return "deref";
        case ResolveOp::Rip32: return "rip32";
        case ResolveOp::Rel32: return "rel32";
    }
    return "?";
}

ResolveOutcome ApplyResolveChain(uintptr_t start,
                                 const std::vector<ResolveStep>& steps,
                                 const MemoryReader& reader) {
    ResolveOutcome outcome;
    outcome.address = start;

    if (!reader) {
        outcome.error = "no memory reader supplied";
        return outcome;
    }

    uintptr_t address = start;

    for (size_t i = 0; i < steps.size(); ++i) {
        const ResolveStep& step = steps[i];
        outcome.failedStep = i;

        switch (step.op) {
            case ResolveOp::Add:
                address += static_cast<uintptr_t>(step.value);
                break;

            case ResolveOp::Sub:
                address -= static_cast<uintptr_t>(step.value);
                break;

            case ResolveOp::Deref: {
                uintptr_t pointer = 0;
                if (!reader(address, &pointer, sizeof(pointer))) {
                    outcome.error = "step " + std::to_string(i) +
                                    " (deref): unreadable memory";
                    return outcome;
                }
                address = pointer;
                break;
            }

            case ResolveOp::Rip32: {
                if (step.instructionLength <= 0) {
                    outcome.error = "step " + std::to_string(i) +
                                    " (rip32): instructionLength must be "
                                    "positive";
                    return outcome;
                }
                int32_t displacement = 0;
                const uintptr_t site =
                    address + static_cast<uintptr_t>(step.value);
                if (!reader(site, &displacement, sizeof(displacement))) {
                    outcome.error = "step " + std::to_string(i) +
                                    " (rip32): unreadable memory";
                    return outcome;
                }
                // Widen through int64_t first so a negative displacement sign
                // extends across all 64 bits before the wrap-around add. Going
                // straight to uintptr_t would zero-extend and land ~4 GB away.
                address += static_cast<uintptr_t>(step.instructionLength);
                address += static_cast<uintptr_t>(
                    static_cast<int64_t>(displacement));
                break;
            }

            case ResolveOp::Rel32: {
                int32_t offset = 0;
                const uintptr_t site =
                    address + static_cast<uintptr_t>(step.value);
                if (!reader(site, &offset, sizeof(offset))) {
                    outcome.error = "step " + std::to_string(i) +
                                    " (rel32): unreadable memory";
                    return outcome;
                }
                address += static_cast<uintptr_t>(static_cast<int64_t>(offset));
                break;
            }
        }
    }

    if (address == 0) {
        outcome.error = "resolved to a null address";
        return outcome;
    }

    outcome.ok = true;
    outcome.address = address;
    return outcome;
}

}  // namespace fpcam::core
