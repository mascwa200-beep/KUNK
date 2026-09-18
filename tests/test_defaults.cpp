// test_defaults.cpp -- the config files the plugin writes on first run.
//
// Installing this mod is meant to be "copy one DLL into bin\NativeMods". That
// works because the DLL carries the default FPCamera.json and
// FPCamera.signatures.json and writes them beside itself when they are absent.
//
// Two things can go wrong with an embedded copy, and neither announces itself:
// the raw-string literal that carries the JSON can be terminated early by its
// own content, and a shipped default can drift out of the range the parser
// accepts. Both would ship a config that the plugin then complains about on the
// user's first run. So the embedded text goes through the real parser here.
#include "Harness.h"

#include "Config.h"
#include "DefaultConfig.h"

#include <nlohmann/json.hpp>

#include <string>

using namespace fpcam;

TEST(Defaults, TheEmbeddedConfigIsNotTruncated) {
    // A raw-string terminator appearing inside the JSON would cut the literal
    // short and usually still leave something that looks plausible.
    const std::string text = kDefaultConfigJson;
    CHECK(text.size() > 2000);
    CHECK_CONTAINS(text, "\"schemaVersion\"");
    CHECK_CONTAINS(text, "\"hotkeys\"");
    CHECK_CONTAINS(text, "\"movement\"");
    // The closing brace of the document must survive.
    CHECK(text.find_last_of('}') != std::string::npos);
}

TEST(Defaults, TheEmbeddedConfigParsesWithNoComplaints) {
    Config config;
    std::string error;
    const bool ok = config.ParseFromString(kDefaultConfigJson, &error);
    CHECK_MSG(ok, "the shipped default config failed to parse: " + error);

    // The stronger claim, and the one worth having: parsing it produces no
    // warnings at all. A warning here would mean the file we hand the user is
    // one the plugin itself considers out of range -- clamped hotkeys,
    // out-of-bounds eye height, an unknown enum. The user would meet that as a
    // yellow line in the log on a completely fresh install.
    for (const std::string& warning : config.warnings) {
        CHECK_MSG(false, "shipped default produced a warning: " + warning);
    }
}

TEST(Defaults, TheEmbeddedConfigCarriesUsableValues) {
    Config config;
    std::string error;
    CHECK(config.ParseFromString(kDefaultConfigJson, &error));

    CHECK(config.enabled);
    CHECK(config.camera.eyeHeight > 1.0f && config.camera.eyeHeight < 2.0f);
    CHECK(config.camera.nearPlane > 0.0f);
    CHECK(config.camera.pitchMin < config.camera.pitchMax);
    CHECK(config.mouse.sensitivity > 0.0f);
    CHECK(config.mouse.cursorLock);
    CHECK(config.movement.mode == MovementMode::XInput);

    // Every hotkey the plugin advertises must actually be bound, or a fresh
    // install ships with a dead key.
    CHECK(config.hotkeys.toggleFirstPerson != 0);
    CHECK(config.hotkeys.toggleCursorLock != 0);
    CHECK(config.hotkeys.toggleDiscovery != 0);
    CHECK(config.hotkeys.reloadConfig != 0);
    CHECK(config.hotkeys.runSelfTest != 0);
    CHECK(config.hotkeys.panicDisable != 0);

    // Offsets must ship unset. A shipped guess would be written into a live
    // camera on somebody's build where it means something else entirely.
    CHECK_EQ(config.camera.offsets.positionX, -1);
    CHECK_EQ(config.camera.offsets.pitch, -1);
    CHECK(config.camera.pointerChain.empty());
}

TEST(Defaults, TheEmbeddedSignatureFileParses) {
    const std::string text = kDefaultSignaturesJson;
    CHECK(text.size() > 2000);

    nlohmann::json root;
    bool parsed = true;
    try {
        root = nlohmann::json::parse(text, nullptr, true,
                                     /*ignore_comments=*/true);
    } catch (const nlohmann::json::exception& e) {
        parsed = false;
        CHECK_MSG(false, std::string("shipped signature file is not valid "
                                     "JSON: ") + e.what());
    }
    if (!parsed) return;

    CHECK(root.contains("signatures"));
    CHECK(root["signatures"].is_array());

    // CameraHook looks this name up as a string. If the shipped file ever stops
    // carrying it, the camera silently never binds and the failure appears far
    // from the cause.
    bool hasCameraManager = false;
    for (const auto& entry : root["signatures"]) {
        if (entry.value("name", std::string()) == "CameraManagerInstance") {
            hasCameraManager = true;
            // It must be marked unverified: the shipped patterns are templates,
            // and claiming otherwise in the scan report would mislead.
            CHECK(!entry.value("verified", false));
            CHECK(entry.value("required", false));
        }
    }
    CHECK_MSG(hasCameraManager,
              "the shipped signature file has no CameraManagerInstance entry, "
              "which CameraHook resolves by name");
}
