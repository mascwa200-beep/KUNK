// PatternScan.h -- array-of-bytes matching, with no platform dependency.
//
// The Windows side (MemoryScanner.cpp) owns finding a module's .text section
// and validating page protection. What it delegates here is the part worth
// testing: parsing an IDA-style pattern, and finding every occurrence in a
// buffer.
//
// The critical behaviour is that this reports *all* matches up to a cap rather
// than stopping at the first. A pattern that happens to match two sites will
// resolve to the wrong one on some future game build, and the caller treats
// more than one hit as a failed signature. Returning early would quietly
// destroy that guarantee.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace fpcam::core {

// A parsed byte pattern. Wildcards are per byte: "??" or "?" match anything.
struct Pattern {
    std::vector<uint8_t> bytes;
    std::vector<uint8_t> mask;  // 1 = must match, 0 = wildcard
    std::string error;          // empty when parsing succeeded

    bool Valid() const { return error.empty() && !bytes.empty(); }
    size_t Size() const { return bytes.size(); }
};

// Parses free-form IDA-style text, e.g. "48 8B 05 ?? ?? ?? ?? 48 85 C0".
//
// Rejected, each with a distinct message: an empty pattern, a stray hex digit,
// a non-hex character, and a pattern consisting only of wildcards (which would
// match at every offset and is never what anyone means).
Pattern ParsePattern(std::string_view text);

// Returns the offsets of every match within [data, data + size), stopping once
// `maxHits` have been found.
//
// Matches may overlap: scanning "AAA" for "AA" yields offsets 0 and 1. That is
// deliberate -- a caller counting hits to detect ambiguity must see both.
std::vector<size_t> ScanBuffer(const uint8_t* data, size_t size,
                               const Pattern& pattern, size_t maxHits = 8);

}  // namespace fpcam::core
