// MemoryScanner.h -- array-of-bytes signature scanning and guarded memory
// access.
//
// Why this exists: BG3's executable is stripped and re-linked every patch, so
// no camera address is stable between builds. Nothing in this plugin hardcodes
// an address; everything is either resolved from a pattern declared in
// FPCamera.signatures.json or supplied directly by the user. See docs/SIGNATURES.md.
//
// Every read and write of game memory goes through the guarded helpers here.
// A wrong offset in a user-edited config must produce a logged error, never a
// crash in someone's 40-hour save.
#pragma once

#include "Common.h"

#include <vector>

namespace fpcam::mem {

// A contiguous span of the target process's address space.
struct Region {
    uintptr_t base = 0;
    size_t size = 0;

    bool Valid() const { return base != 0 && size != 0; }
    uintptr_t End() const { return base + size; }
};

// Whole mapped image of a loaded module, e.g. L"bg3_dx11.exe".
// Returns an invalid Region if the module is not loaded.
Region ModuleImage(const wchar_t* moduleName);

// A named PE section within a module, e.g. ".text". Scanning only the code
// section rather than the whole image is roughly an order of magnitude faster
// and eliminates false positives from string and resource data.
// Falls back to the full image if the section name is not found.
Region ModuleSection(const wchar_t* moduleName, std::string_view sectionName);

// A parsed byte pattern. Wildcards are per-byte: "??" or "?" match anything.
// Accepts IDA-style ("48 8B 05 ?? ?? ?? ??") input; whitespace is free-form.
struct Pattern {
    std::vector<uint8_t> bytes;
    std::vector<uint8_t> mask;  // 1 = byte must match, 0 = wildcard
    std::string error;          // empty when parsing succeeded

    bool Valid() const { return error.empty() && !bytes.empty(); }
    size_t Size() const { return bytes.size(); }
};

Pattern ParsePattern(std::string_view text);

// Scans `region` and returns every match, stopping once `maxHits` are found.
//
// The caller is expected to treat "more than one hit" as a failed signature
// rather than silently taking the first: an ambiguous pattern that happens to
// match two sites will resolve to the wrong one on some future patch, and a
// wrong camera pointer is far worse than no camera pointer.
std::vector<uintptr_t> Scan(const Region& region, const Pattern& pattern,
                            size_t maxHits = 8);

// --- Guarded access -------------------------------------------------------

// True when every page in [address, address+size) is committed and readable.
bool IsReadable(uintptr_t address, size_t size);
bool IsWritable(uintptr_t address, size_t size);

// Copies `size` bytes, returning false instead of raising if the source is not
// mapped. Used for every dereference of a game pointer.
bool SafeRead(uintptr_t address, void* destination, size_t size);

// Copies into game memory, temporarily lifting page protection if required.
bool SafeWrite(uintptr_t address, const void* source, size_t size);

template <typename T>
bool Read(uintptr_t address, T* out) {
    return SafeRead(address, out, sizeof(T));
}

template <typename T>
bool Write(uintptr_t address, const T& value) {
    return SafeWrite(address, &value, sizeof(T));
}

// Overwrites `size` bytes with 0x90. Used by the `patchClamp` camera strategy
// to neutralise the engine's pitch/zoom limit instructions.
bool NopRange(uintptr_t address, size_t size);

// Reads back and stores the original bytes so a patch can be reverted when the
// user toggles first-person off or unloads the plugin.
struct BytePatch {
    uintptr_t address = 0;
    std::vector<uint8_t> original;

    bool Apply(const std::vector<uint8_t>& replacement);
    bool Revert();
    bool Applied() const { return !original.empty(); }
};

// Formats an address as "bg3_dx11.exe+0x1234ABC" when it falls inside a known
// module, otherwise as a bare address. Log lines that survive a patch bump are
// far more useful in module-relative form.
std::string DescribeAddress(uintptr_t address);

}  // namespace fpcam::mem
