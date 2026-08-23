// test_config.cpp -- the configuration parser.
//
// This is the only component that consumes untrusted input: a hand-edited file,
// frequently edited wrongly, supplying values that end up written into a live
// game process. The contract it must keep is that an absent key keeps the
// default, a wrong-typed key keeps the default, an out-of-range value is
// clamped with a warning, and a broken document leaves the previous config
// completely untouched rather than half-applied.
#include "Harness.h"

#include "Config.h"

#include <random>

using namespace fpcam;

namespace {

Config Parse(const std::string& text, bool* ok = nullptr) {
    Config config;
    std::string error;
    const bool parsed = config.ParseFromString(text, &error);
    if (ok != nullptr) *ok = parsed;
    return config;
}

bool HasWarningContaining(const Config& config, const std::string& needle) {
    for (const std::string& warning : config.warnings) {
        if (warning.find(needle) != std::string::npos) return true;
    }
    return false;
}

}  // namespace

TEST(Config, ParsesAMinimalDocument) {
    bool ok = false;
    const Config config = Parse("{}", &ok);
    CHECK(ok);
    CHECK(config.enabled);
    CHECK_NEAR(config.camera.eyeHeight, 1.62f, 1e-4);
    CHECK(config.movement.mode == MovementMode::XInput);
}

TEST(Config, ParsesTheShippedDefaults) {
    // The real file carries // comments, which the parser must accept.
    bool ok = false;
    const Config config = Parse(R"({
        // a comment
        "enabled": true,
        "camera": { "eyeHeight": 1.75 },  /* and a block comment */
        "movement": { "mode": "moveto" }
    })", &ok);
    CHECK(ok);
    CHECK_NEAR(config.camera.eyeHeight, 1.75f, 1e-4);
    CHECK(config.movement.mode == MovementMode::MoveTo);
}

TEST(Config, AcceptsAUtf8ByteOrderMark) {
    // Notepad adds one, and a strict parser rejecting it reads as "your config
    // is broken" when nothing about it is.
    bool ok = false;
    const Config config = Parse("\xEF\xBB\xBF{\"enabled\": false}", &ok);
    CHECK(ok);
    CHECK(!config.enabled);
}

TEST(Config, RejectsBrokenDocumentsWithoutMutating) {
    for (const char* broken : {"", "{", "not json", "[1,2,3]", "\"a string\"",
                               "{\"enabled\":}", "{,}", "null"}) {
        Config config;
        config.camera.eyeHeight = 9.99f;   // a sentinel that must survive
        std::string error;
        const bool ok = config.ParseFromString(broken, &error);
        CHECK_MSG(!ok, std::string("should have rejected: ") + broken);
        CHECK(!error.empty());
        CHECK_MSG(std::fabs(config.camera.eyeHeight - 9.99f) < 1e-4,
                  std::string("config was mutated by a failed parse of: ") +
                      broken);
    }
}

TEST(Config, WrongTypesFallBackToDefaults) {
    // A string where a number belongs must not become zero.
    bool ok = false;
    const Config config = Parse(R"({
        "camera": { "eyeHeight": "tall", "forwardOffset": [1,2] },
        "mouse":  { "sensitivity": null },
        "movement": { "deadzone": {} }
    })", &ok);
    CHECK(ok);
    CHECK_NEAR(config.camera.eyeHeight, 1.62f, 1e-4);
    CHECK_NEAR(config.camera.forwardOffset, 0.12f, 1e-4);
    CHECK_NEAR(config.mouse.sensitivity, 0.12f, 1e-4);
    CHECK_NEAR(config.movement.deadzone, 0.15f, 1e-4);
}

TEST(Config, ClampsOutOfRangeValuesAndWarns) {
    bool ok = false;
    const Config config = Parse(R"({
        "camera": { "eyeHeight": 500.0, "nearPlane": -3.0, "fovOverride": 400.0 },
        "mouse":  { "sensitivity": 1000.0 },
        "movement": { "deadzone": 5.0, "moveToRateHz": 9999.0 }
    })", &ok);
    CHECK(ok);
    CHECK(config.camera.eyeHeight <= 5.0f);
    CHECK(config.camera.nearPlane > 0.0f);
    CHECK(config.camera.fovOverride <= 179.0f);
    CHECK(config.mouse.sensitivity <= 10.0f);
    CHECK(config.movement.deadzone <= 0.9f);
    CHECK(config.movement.moveToRateHz <= 60.0f);
    // Silent correction is worse than none: the user has to be able to find out.
    CHECK(HasWarningContaining(config, "camera.eyeHeight"));
    CHECK(HasWarningContaining(config, "movement.deadzone"));
}

TEST(Config, RejectsNumbersThatOverflowAFloat) {
    // Two distinct hazards, and the second is the one that actually bites.
    //
    // 1e400 overflows a double, so the JSON parser refuses the whole document
    // and the previous config is kept -- safe, if blunt.
    {
        Config config;
        std::string error;
        CHECK(!config.ParseFromString(R"({"camera": {"eyeHeight": 1e400}})",
                                      &error));
        CHECK_CONTAINS(error, "overflow");
    }

    // 1e39 is a perfectly finite double and parses without complaint, then
    // becomes infinity the instant it is narrowed to a float. Checking
    // finiteness before the cast let it straight through, and an infinity in
    // the camera is a crash rather than a glitch.
    for (const char* text : {R"({"camera": {"eyeHeight": 1e39}})",
                             R"({"camera": {"zoomDistance": 1e39}})",
                             R"({"camera": {"nearPlane": -1e39}})",
                             R"({"mouse": {"sensitivity": 1e300}})"}) {
        bool ok = false;
        const Config config = Parse(text, &ok);
        CHECK_MSG(ok, std::string("should have parsed: ") + text);
        CHECK(std::isfinite(config.camera.eyeHeight));
        CHECK(std::isfinite(config.camera.zoomDistance));
        CHECK(std::isfinite(config.camera.nearPlane));
        CHECK(std::isfinite(config.mouse.sensitivity));
    }

    // Defaults must be intact, not silently zeroed.
    bool ok = false;
    const Config config = Parse(R"({"camera": {"eyeHeight": 1e39}})", &ok);
    CHECK_NEAR(config.camera.eyeHeight, 1.62f, 1e-4);
}

TEST(Config, InvertedPitchLimitsAreRepaired) {
    bool ok = false;
    const Config config =
        Parse(R"({"camera": {"pitchLimits": {"min": 80.0, "max": -80.0}}})", &ok);
    CHECK(ok);
    CHECK(config.camera.pitchMin < config.camera.pitchMax);
    CHECK(HasWarningContaining(config, "pitchLimits"));
}

TEST(Config, ParsesHotkeysAndReportsUnknownNames) {
    bool ok = false;
    const Config config = Parse(R"({
        "hotkeys": {
            "toggleFirstPerson": "VK_F5",
            "toggleCursorLock": "0x71",
            "runSelfTest": "Q",
            "panicDisable": "NOT_A_KEY"
        }
    })", &ok);
    CHECK(ok);
    CHECK_EQ(config.hotkeys.toggleFirstPerson, core::vk::kF5);
    CHECK_EQ(config.hotkeys.toggleCursorLock, core::vk::kF2);  // 0x71
    CHECK_EQ(config.hotkeys.runSelfTest, int('Q'));
    // An unrecognised name keeps the default and says so, rather than silently
    // unbinding the panic key.
    CHECK_EQ(config.hotkeys.panicDisable, core::vk::kF8);
    CHECK(HasWarningContaining(config, "panicDisable"));
}

TEST(Config, ParsesFieldOffsetsAsHexOrInteger) {
    bool ok = false;
    const Config config = Parse(R"({
        "camera": {
            "fieldOffsets": { "pitch": "0x120", "yaw": 292, "distance": "0X128" },
            "pointerChain": [ "0x18", 64 ]
        }
    })", &ok);
    CHECK(ok);
    CHECK_EQ(config.camera.offsets.pitch, 0x120);
    CHECK_EQ(config.camera.offsets.yaw, 292);
    CHECK_EQ(config.camera.offsets.distance, 0x128);
    // Unset offsets stay at -1 so the field is simply not written.
    CHECK_EQ(config.camera.offsets.positionX, -1);
    CHECK_EQ(config.camera.pointerChain.size(), size_t{2});
    CHECK_EQ(config.camera.pointerChain[0], 0x18);
    CHECK_EQ(config.camera.pointerChain[1], 64);
}

TEST(Config, RejectsDangerousClampPatchLengths) {
    // A wrong nopLength corrupts the instruction stream and crashes the game,
    // so anything outside 1..16 must be dropped rather than attempted.
    bool ok = false;
    const Config config = Parse(R"({
        "camera": { "clampPatches": [
            { "signature": "Good", "nopLength": 8 },
            { "signature": "TooLong", "nopLength": 900 },
            { "signature": "Zero", "nopLength": 0 },
            { "signature": "Negative", "nopLength": -4 },
            { "nopLength": 8 }
        ]}
    })", &ok);
    CHECK(ok);
    CHECK_EQ(config.camera.clampPatches.size(), size_t{1});
    CHECK_EQ(config.camera.clampPatches[0].signature, std::string("Good"));
    CHECK(HasWarningContaining(config, "TooLong"));
}

TEST(Config, EyeHeightByRaceSelectsAndFallsBack) {
    bool ok = false;
    const Config config = Parse(R"({
        "camera": {
            "eyeHeight": 1.62,
            "eyeHeightByRace": { "Dwarf": 1.15, "Gnome": 1.02, "Bad": 99.0 }
        }
    })", &ok);
    CHECK(ok);
    CHECK_NEAR(config.EyeHeightFor("Dwarf"), 1.15f, 1e-4);
    CHECK_NEAR(config.EyeHeightFor("Gnome"), 1.02f, 1e-4);
    // An unknown race, and an absent one, both fall back to the global value.
    CHECK_NEAR(config.EyeHeightFor("Githyanki"), 1.62f, 1e-4);
    CHECK_NEAR(config.EyeHeightFor(""), 1.62f, 1e-4);
    // An out-of-range override is dropped rather than applied.
    CHECK_NEAR(config.EyeHeightFor("Bad"), 1.62f, 1e-4);
    CHECK(HasWarningContaining(config, "Bad"));
}

TEST(Config, UnknownEnumValuesFallBackAndWarn) {
    bool ok = false;
    const Config config = Parse(R"({
        "camera": { "clampBypass": "explode" },
        "movement": { "mode": "teleport" }
    })", &ok);
    CHECK(ok);
    CHECK(config.camera.clampBypass == ClampBypass::PostWrite);
    CHECK(config.movement.mode == MovementMode::XInput);
    CHECK(HasWarningContaining(config, "clampBypass"));
    CHECK(HasWarningContaining(config, "movement.mode"));
}

TEST(Config, ReportsTheRetiredHeadHideKey) {
    // The key used to exist here and is now owned by the Lua side. Users with
    // an old config deserve to be told, not silently ignored.
    bool ok = false;
    const Config config =
        Parse(R"({"headHide": {"luaHeadHide": true}})", &ok);
    CHECK(ok);
    CHECK(HasWarningContaining(config, "luaHeadHide"));
}

TEST(Config, DiscoveryCountsAreBounded) {
    bool ok = false;
    const Config config = Parse(R"({
        "discovery": { "maxCandidates": 99999999, "logEveryNFrames": -5 }
    })", &ok);
    CHECK(ok);
    CHECK(config.discovery.maxCandidates <= 4096);
    CHECK(config.discovery.logEveryNFrames >= 1);
}

TEST(Config, SurvivesDeeplyNestedAndOversizedInput) {
    // Hostile shapes that should be refused or ignored, never crash.
    std::string deep;
    for (int i = 0; i < 5000; ++i) deep += "[";
    for (int i = 0; i < 5000; ++i) deep += "]";
    Config config;
    std::string error;
    config.ParseFromString(deep, &error);  // must simply return

    std::string wide = "{";
    for (int i = 0; i < 20000; ++i) {
        wide += "\"k" + std::to_string(i) + "\":" + std::to_string(i) + ",";
    }
    wide += "\"enabled\":false}";
    bool ok = false;
    const Config parsed = Parse(wide, &ok);
    CHECK(ok);
    CHECK(!parsed.enabled);
}

TEST(Config, FuzzNeverCrashesAndNeverLeavesBadValues) {
    // Random mutations of a valid document. The invariant is that a successful
    // parse always yields values safe to hand to the game.
    const std::string seedText = R"({
        "enabled": true,
        "camera": { "eyeHeight": 1.62, "nearPlane": 0.15,
                    "pitchLimits": {"min": -89, "max": 89},
                    "fieldOffsets": {"pitch": "0x120"} },
        "mouse": { "sensitivity": 0.12 },
        "movement": { "mode": "xinput", "deadzone": 0.15 }
    })";

    std::mt19937 rng(0xD15EA5Eu);
    std::uniform_int_distribution<size_t> position(0, seedText.size() - 1);
    std::uniform_int_distribution<int> character(32, 126);

    int accepted = 0;
    for (int i = 0; i < 20000; ++i) {
        std::string mutated = seedText;
        const int edits = 1 + (i % 4);
        for (int e = 0; e < edits; ++e) {
            mutated[position(rng)] = static_cast<char>(character(rng));
        }

        Config config;
        std::string error;
        if (!config.ParseFromString(mutated, &error)) continue;
        ++accepted;

        CHECK(std::isfinite(config.camera.eyeHeight));
        CHECK(config.camera.eyeHeight >= 0.0f && config.camera.eyeHeight <= 5.0f);
        CHECK(std::isfinite(config.camera.nearPlane));
        CHECK(config.camera.nearPlane > 0.0f);
        CHECK(std::isfinite(config.camera.zoomDistance));
        CHECK(config.camera.pitchMin < config.camera.pitchMax);
        CHECK(config.mouse.sensitivity > 0.0f);
        CHECK(config.movement.deadzone >= 0.0f &&
              config.movement.deadzone <= 0.9f);
    }
    // Sanity on the fuzzer itself: if nothing parsed, the loop proved nothing.
    CHECK_MSG(accepted > 100,
              "only " + std::to_string(accepted) + " mutations parsed");
}
