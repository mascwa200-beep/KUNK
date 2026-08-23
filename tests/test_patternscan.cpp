// test_patternscan.cpp -- AOB parsing and matching.
//
// The behaviour that matters most here is counting *all* matches rather than
// returning the first. The signature layer treats more than one hit as a failed
// signature, because a pattern matching two sites will resolve to the wrong one
// on some future game build and write floats into an unrelated structure. If
// the scanner ever stopped early, that safety property would vanish silently.
#include "Harness.h"

#include "core/PatternScan.h"

#include <random>
#include <vector>

using namespace fpcam::core;

namespace {

std::vector<uint8_t> Bytes(std::initializer_list<int> values) {
    std::vector<uint8_t> out;
    out.reserve(values.size());
    for (const int v : values) out.push_back(static_cast<uint8_t>(v));
    return out;
}

std::vector<size_t> Scan(const std::vector<uint8_t>& buffer,
                         const char* patternText, size_t maxHits = 8) {
    const Pattern pattern = ParsePattern(patternText);
    return ScanBuffer(buffer.data(), buffer.size(), pattern, maxHits);
}

}  // namespace

TEST(ParsePattern, AcceptsPlainBytes) {
    const Pattern p = ParsePattern("48 8B 05");
    CHECK(p.Valid());
    CHECK_EQ(p.Size(), size_t{3});
    CHECK_EQ(int(p.bytes[0]), 0x48);
    CHECK_EQ(int(p.bytes[2]), 0x05);
    CHECK_EQ(int(p.mask[0]), 1);
}

TEST(ParsePattern, AcceptsBothWildcardSpellings) {
    const Pattern doubled = ParsePattern("48 ?? 05");
    const Pattern single = ParsePattern("48 ? 05");
    CHECK(doubled.Valid());
    CHECK(single.Valid());
    CHECK_EQ(doubled.Size(), size_t{3});
    CHECK_EQ(single.Size(), size_t{3});
    CHECK_EQ(int(doubled.mask[1]), 0);
    CHECK_EQ(int(single.mask[1]), 0);
}

TEST(ParsePattern, IsInsensitiveToWhitespaceAndCase) {
    const Pattern spaced = ParsePattern("  48\t8b\n05  ");
    const Pattern tight = ParsePattern("488B05");
    CHECK(spaced.Valid());
    CHECK(tight.Valid());
    CHECK_EQ(spaced.Size(), size_t{3});
    CHECK_EQ(tight.Size(), size_t{3});
    CHECK_EQ(int(spaced.bytes[1]), 0x8B);
}

TEST(ParsePattern, RejectsEmptyAndAllWildcards) {
    CHECK_CONTAINS(ParsePattern("").error, "empty");
    CHECK_CONTAINS(ParsePattern("   ").error, "empty");
    // An all-wildcard pattern matches at every offset. Never what anyone means,
    // and it would report the first hit as if it were meaningful.
    CHECK_CONTAINS(ParsePattern("?? ?? ??").error, "wildcards");
}

TEST(ParsePattern, RejectsMalformedBytes) {
    CHECK_CONTAINS(ParsePattern("4").error, "one hex digit");
    CHECK_CONTAINS(ParsePattern("48 8").error, "one hex digit");
    CHECK_CONTAINS(ParsePattern("48 ZZ").error, "unexpected character");
    CHECK_CONTAINS(ParsePattern("48 4G").error, "two hex digits");
    CHECK(!ParsePattern("48 8").Valid());
}

TEST(ScanBuffer, FindsASingleMatch) {
    const auto buffer = Bytes({0x00, 0x11, 0x48, 0x8B, 0x05, 0x99});
    const auto hits = Scan(buffer, "48 8B 05");
    CHECK_EQ(hits.size(), size_t{1});
    CHECK_EQ(hits[0], size_t{2});
}

TEST(ScanBuffer, FindsMatchesAtBothEdges) {
    // Off-by-one at either end is the classic scanner bug.
    const auto atStart = Bytes({0xAA, 0xBB, 0x00, 0x00});
    CHECK_EQ(Scan(atStart, "AA BB").size(), size_t{1});
    CHECK_EQ(Scan(atStart, "AA BB")[0], size_t{0});

    const auto atEnd = Bytes({0x00, 0x00, 0xAA, 0xBB});
    CHECK_EQ(Scan(atEnd, "AA BB").size(), size_t{1});
    CHECK_EQ(Scan(atEnd, "AA BB")[0], size_t{2});

    const auto exact = Bytes({0xAA, 0xBB});
    CHECK_EQ(Scan(exact, "AA BB").size(), size_t{1});
}

TEST(ScanBuffer, ReportsEveryMatchNotJustTheFirst) {
    // The ambiguity guarantee: three occurrences must all be reported.
    const auto buffer = Bytes({0xAA, 0xBB, 0x00, 0xAA, 0xBB, 0x00, 0xAA, 0xBB});
    const auto hits = Scan(buffer, "AA BB");
    CHECK_EQ(hits.size(), size_t{3});
    CHECK_EQ(hits[0], size_t{0});
    CHECK_EQ(hits[1], size_t{3});
    CHECK_EQ(hits[2], size_t{6});
}

TEST(ScanBuffer, ReportsOverlappingMatches) {
    // "AAA" contains "AA" twice. A scanner that advanced by the pattern length
    // would report one, and the ambiguity check would wrongly pass.
    const auto buffer = Bytes({0xAA, 0xAA, 0xAA});
    const auto hits = Scan(buffer, "AA AA");
    CHECK_EQ(hits.size(), size_t{2});
    CHECK_EQ(hits[0], size_t{0});
    CHECK_EQ(hits[1], size_t{1});
}

TEST(ScanBuffer, HonoursWildcards) {
    const auto buffer = Bytes({0x48, 0x11, 0x05, 0x48, 0x22, 0x05});
    const auto hits = Scan(buffer, "48 ?? 05");
    CHECK_EQ(hits.size(), size_t{2});
    CHECK_EQ(hits[0], size_t{0});
    CHECK_EQ(hits[1], size_t{3});
}

TEST(ScanBuffer, HandlesAPatternStartingWithAWildcard) {
    // The memchr fast path anchors on the first fixed byte. When that is not at
    // index 0 the offset arithmetic has to compensate, and getting it wrong
    // shifts every reported hit.
    const auto buffer = Bytes({0x00, 0x99, 0x48, 0x8B, 0x77, 0x99, 0x48, 0x8B});
    const auto hits = Scan(buffer, "?? 48 8B");
    CHECK_EQ(hits.size(), size_t{2});
    CHECK_EQ(hits[0], size_t{1});
    CHECK_EQ(hits[1], size_t{5});
}

TEST(ScanBuffer, HandlesTwoLeadingWildcards) {
    const auto buffer = Bytes({0x01, 0x02, 0xCC, 0xDD, 0xEE});
    const auto hits = Scan(buffer, "?? ?? CC DD");
    CHECK_EQ(hits.size(), size_t{1});
    CHECK_EQ(hits[0], size_t{0});
}

TEST(ScanBuffer, StopsAtMaxHits) {
    std::vector<uint8_t> buffer(1000, 0xAA);
    const auto hits = Scan(buffer, "AA AA", 5);
    CHECK_EQ(hits.size(), size_t{5});
}

TEST(ScanBuffer, HandlesDegenerateInputs) {
    const auto buffer = Bytes({0x48, 0x8B});
    // Pattern longer than the buffer.
    CHECK_EQ(Scan(buffer, "48 8B 05 11 22").size(), size_t{0});
    // Invalid pattern yields nothing rather than matching wildly.
    CHECK_EQ(Scan(buffer, "").size(), size_t{0});
    CHECK_EQ(Scan(buffer, "?? ??").size(), size_t{0});
    // Empty buffer, and a null pointer.
    const Pattern good = ParsePattern("48 8B");
    CHECK_EQ(ScanBuffer(nullptr, 0, good).size(), size_t{0});
    CHECK_EQ(ScanBuffer(buffer.data(), 0, good).size(), size_t{0});
    // maxHits of zero must return nothing rather than looping forever.
    CHECK_EQ(ScanBuffer(buffer.data(), buffer.size(), good, 0).size(),
             size_t{0});
}

TEST(ScanBuffer, FindsNothingWhenAbsent) {
    const auto buffer = Bytes({0x01, 0x02, 0x03, 0x04});
    CHECK_EQ(Scan(buffer, "AA BB").size(), size_t{0});
}

TEST(ScanBuffer, AgreesWithABruteForceReferenceOnRandomData) {
    // The fast path uses memchr skipping. Check it against the obvious
    // quadratic implementation over random data, which is the only way to be
    // confident the skipping never steps over a match.
    std::mt19937 rng(0x5EEDu);
    // A tiny alphabet makes collisions -- and therefore overlapping and
    // adjacent matches -- common rather than rare.
    std::uniform_int_distribution<int> byte(0, 3);

    for (int trial = 0; trial < 500; ++trial) {
        std::vector<uint8_t> buffer(200);
        for (uint8_t& b : buffer) b = static_cast<uint8_t>(byte(rng));

        // Build a random 3-byte pattern with a random wildcard position.
        std::uniform_int_distribution<int> slot(0, 2);
        const int wildcardAt = slot(rng);
        std::string text;
        for (int i = 0; i < 3; ++i) {
            if (i > 0) text += ' ';
            if (i == wildcardAt) {
                text += "??";
            } else {
                char hex[3];
                std::snprintf(hex, sizeof(hex), "%02X", byte(rng));
                text += hex;
            }
        }

        const Pattern pattern = ParsePattern(text);
        CHECK(pattern.Valid());

        std::vector<size_t> expected;
        for (size_t i = 0; i + 3 <= buffer.size(); ++i) {
            bool matched = true;
            for (size_t k = 0; k < 3; ++k) {
                if (pattern.mask[k] != 0 && buffer[i + k] != pattern.bytes[k]) {
                    matched = false;
                    break;
                }
            }
            if (matched) expected.push_back(i);
        }

        const auto actual =
            ScanBuffer(buffer.data(), buffer.size(), pattern, 100000);
        CHECK_MSG(actual == expected,
                  "scanner disagreed with brute force for pattern '" + text +
                      "' (got " + std::to_string(actual.size()) + ", expected " +
                      std::to_string(expected.size()) + ")");
    }
}

TEST(ParsePattern, FuzzNeverCrashesOnArbitraryText) {
    std::mt19937 rng(0xFACADEu);
    std::uniform_int_distribution<int> length(0, 40);
    std::uniform_int_distribution<int> character(32, 126);

    for (int i = 0; i < 50000; ++i) {
        std::string text;
        const int n = length(rng);
        for (int k = 0; k < n; ++k) {
            text += static_cast<char>(character(rng));
        }
        const Pattern pattern = ParsePattern(text);
        // The invariant: valid implies internally consistent, so a scan over
        // whatever came out cannot read out of bounds.
        if (pattern.Valid()) {
            CHECK(pattern.bytes.size() == pattern.mask.size());
            CHECK(!pattern.bytes.empty());
            std::vector<uint8_t> buffer(64, 0x42);
            ScanBuffer(buffer.data(), buffer.size(), pattern, 4);
        } else {
            CHECK(!pattern.error.empty());
        }
    }
}
