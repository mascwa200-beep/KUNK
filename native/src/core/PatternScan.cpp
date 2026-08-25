#include "PatternScan.h"

#include <cstring>

namespace fpcam::core {
namespace {

int HexDigit(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

bool IsSpace(char c) {
    return c == ' ' || c == '\t' || c == '\r' || c == '\n';
}

}  // namespace

Pattern ParsePattern(std::string_view text) {
    Pattern pattern;

    size_t i = 0;
    while (i < text.size()) {
        const char c = text[i];
        if (IsSpace(c)) {
            ++i;
            continue;
        }

        if (c == '?') {
            // Accept both "?" and "??" as one wildcard byte.
            pattern.bytes.push_back(0);
            pattern.mask.push_back(0);
            ++i;
            if (i < text.size() && text[i] == '?') ++i;
            continue;
        }

        const int high = HexDigit(c);
        if (high < 0) {
            pattern.error = "unexpected character '" + std::string(1, c) +
                            "' at offset " + std::to_string(i);
            return pattern;
        }
        if (i + 1 >= text.size() || IsSpace(text[i + 1])) {
            pattern.error = "byte at offset " + std::to_string(i) +
                            " has only one hex digit";
            return pattern;
        }
        const int low = HexDigit(text[i + 1]);
        if (low < 0) {
            pattern.error = "byte at offset " + std::to_string(i) +
                            " is not two hex digits";
            return pattern;
        }

        pattern.bytes.push_back(static_cast<uint8_t>((high << 4) | low));
        pattern.mask.push_back(1);
        i += 2;
    }

    if (pattern.bytes.empty()) {
        pattern.error = "pattern is empty";
        return pattern;
    }

    bool anyFixed = false;
    for (const uint8_t m : pattern.mask) {
        if (m != 0) {
            anyFixed = true;
            break;
        }
    }
    if (!anyFixed) {
        pattern.error = "pattern is entirely wildcards";
    }
    return pattern;
}

std::vector<size_t> ScanBuffer(const uint8_t* data, size_t size,
                               const Pattern& pattern, size_t maxHits) {
    std::vector<size_t> hits;
    if (data == nullptr || size == 0) return hits;
    if (!pattern.Valid()) return hits;
    if (pattern.Size() > size) return hits;
    if (maxHits == 0) return hits;

    // Anchor on the first non-wildcard byte so the outer loop can skip with
    // memchr instead of testing every offset. Signatures usually begin with a
    // fixed opcode, so in practice the anchor sits at index 0 -- but a pattern
    // may legitimately start with a wildcard, and this must still be correct
    // when it does.
    size_t anchor = 0;
    while (anchor < pattern.mask.size() && pattern.mask[anchor] == 0) ++anchor;
    const uint8_t anchorByte = pattern.bytes[anchor];

    const size_t lastStart = size - pattern.Size();

    size_t candidate = 0;
    while (candidate <= lastStart) {
        const size_t searchFrom = candidate + anchor;
        const size_t searchLength = (lastStart + anchor) - searchFrom + 1;
        const auto* found = static_cast<const uint8_t*>(
            std::memchr(data + searchFrom, anchorByte, searchLength));
        if (found == nullptr) break;

        const size_t start = static_cast<size_t>(found - data) - anchor;

        bool matched = true;
        for (size_t k = 0; k < pattern.Size(); ++k) {
            if (pattern.mask[k] != 0 && data[start + k] != pattern.bytes[k]) {
                matched = false;
                break;
            }
        }
        if (matched) {
            hits.push_back(start);
            if (hits.size() >= maxHits) break;
        }
        // Advance by one, not by the pattern length: overlapping matches must
        // both be reported so the caller's ambiguity check is honest.
        candidate = start + 1;
    }

    return hits;
}

}  // namespace fpcam::core
