#include "SelfTest.h"

#include "Bridge.h"
#include "CameraHook.h"
#include "Config.h"
#include "D3D11Hook.h"
#include "InputHook.h"
#include "Logger.h"
#include "MatrixProbe.h"
#include "MemoryScanner.h"
#include "XInputSpoof.h"
#include "core/EyePlacement.h"
#include "core/MoveIntent.h"
#include "core/PatternScan.h"
#include "core/ResolveChain.h"
#include "core/ViewMatrix.h"

#include <cmath>
#include <cstdio>
#include <fstream>

namespace fpcam::selftest {
namespace {

// A byte sequence with no reason to occur anywhere else, compiled into this
// DLL so the scanner can be pointed at a known needle in a real mapped module.
// volatile so the optimiser cannot decide it is unused and drop it.
volatile const uint8_t kScannerNeedle[] = {
    0xF3, 0x0A, 0x1C, 0x9E, 0x44, 0xB7, 0x2D, 0x61,
    0x8C, 0x05, 0xE9, 0x37, 0xA0, 0x5B, 0xC4, 0x12,
};

class Recorder {
public:
    void Pass(std::string name, std::string detail = {}) {
        report_.checks.push_back({Outcome::Pass, std::move(name),
                                  std::move(detail)});
        ++report_.passed;
    }
    void Fail(std::string name, std::string detail) {
        report_.checks.push_back({Outcome::Fail, std::move(name),
                                  std::move(detail)});
        ++report_.failed;
    }
    void Skip(std::string name, std::string reason) {
        report_.checks.push_back({Outcome::Skip, std::move(name),
                                  std::move(reason)});
        ++report_.skipped;
    }
    void Check(bool condition, std::string name, std::string detail) {
        if (condition) {
            Pass(std::move(name), std::move(detail));
        } else {
            Fail(std::move(name), std::move(detail));
        }
    }
    Report Take() { return std::move(report_); }

private:
    Report report_;
};

// --- Algorithms, re-checked inside the shipping build ---------------------
//
// The host suite already proves these. Running an abbreviated version here
// proves it again for the binary that is actually loaded into the game, which
// is a different compiler, different flags and different floating-point
// settings.

void CheckMatrixDecoder(Recorder& recorder) {
    float matrix[16];
    const core::Vec3 eye{123.0f, 45.0f, -67.0f};
    core::ComposeViewMatrix(eye, 42.0f, -15.0f, matrix);

    core::ViewSample sample;
    if (core::DecodeViewMatrix(matrix, &sample) != core::DecodeResult::Ok) {
        recorder.Fail("core/view-matrix round trip",
                      "a composed view matrix failed to decode");
        return;
    }

    const bool positionOk = std::fabs(sample.position.x - eye.x) < 0.05f &&
                            std::fabs(sample.position.y - eye.y) < 0.05f &&
                            std::fabs(sample.position.z - eye.z) < 0.05f;
    const bool anglesOk = std::fabs(sample.yawDegrees - 42.0f) < 0.05f &&
                          std::fabs(sample.pitchDegrees + 15.0f) < 0.05f;

    char detail[160];
    std::snprintf(detail, sizeof(detail),
                  "decoded pos=(%.2f, %.2f, %.2f) yaw=%.2f pitch=%.2f",
                  sample.position.x, sample.position.y, sample.position.z,
                  sample.yawDegrees, sample.pitchDegrees);
    recorder.Check(positionOk && anglesOk, "core/view-matrix round trip",
                   detail);

    // And that it still rejects the dangerous near-miss: a scaled world matrix.
    for (int row = 0; row < 3; ++row) {
        for (int column = 0; column < 3; ++column) {
            matrix[row * 4 + column] *= 1.5f;
        }
    }
    recorder.Check(
        core::DecodeViewMatrix(matrix, &sample) ==
            core::DecodeResult::NotOrthonormal,
        "core/view-matrix rejects scaled matrices",
        "a 1.5x scaled world matrix must not be mistaken for a camera");
}

void CheckEyePlacement(Recorder& recorder) {
    // The drift guard, exercised in the regime that breaks it: the engine never
    // refreshes the field, so every frame reads back our own last write.
    core::EyePlacement placement;
    core::Vec3 field{10.0f, 20.0f, 30.0f};
    const float expected = 20.0f + 1.62f;
    bool drifted = false;

    for (int frame = 0; frame < 2000; ++frame) {
        core::EyePlacementInput input;
        input.enginePosition = field;
        input.forward = core::Vec3{0.0f, 0.0f, 1.0f};
        input.eyeHeight = 1.62f;
        input.forwardOffset = 0.12f;

        const core::EyePlacementOutput output = placement.Solve(input);
        if (!output.write || std::fabs(output.position.y - expected) > 1e-3f) {
            char detail[160];
            std::snprintf(detail, sizeof(detail),
                          "drifted on frame %d: y=%.4f, expected %.4f", frame,
                          output.position.y, expected);
            recorder.Fail("core/eye placement does not drift", detail);
            drifted = true;
            break;
        }
        field = output.position;
    }
    if (!drifted) {
        recorder.Pass("core/eye placement does not drift",
                      "2000 frames with the engine never refreshing");
    }
}

void CheckMoveIntent(Recorder& recorder) {
    core::MoveIntentInput input;
    input.forward = true;
    input.right = true;
    const core::MoveIntentOutput diagonal = core::ComputeMoveIntent(input);
    const float magnitude = std::sqrt(diagonal.x * diagonal.x +
                                      diagonal.y * diagonal.y);
    recorder.Check(std::fabs(magnitude - 1.0f) < 1e-3f,
                   "core/diagonal movement is not faster",
                   "W+D magnitude " + std::to_string(magnitude));
}

// --- Live process checks --------------------------------------------------

void CheckRenderHook(Recorder& recorder, const Context& context) {
    if (!d3d11::HasPresented()) {
        recorder.Fail("render/present hook",
                      "no frame has been presented. If the game is running in "
                      "Vulkan mode, relaunch bg3_dx11.exe.");
        return;
    }
    recorder.Check(context.framesPresented > 0, "render/present hook",
                   std::to_string(context.framesPresented) +
                       " frames presented");
    recorder.Check(d3d11::Device() != nullptr && d3d11::Context() != nullptr,
                   "render/device captured",
                   "the swapchain yielded a device and immediate context");
    recorder.Check(d3d11::Window() != nullptr, "render/game window",
                   "the swapchain reported an output window");
}

void CheckScannerAgainstRealMemory(Recorder& recorder) {
    // Point the scanner at a needle compiled into this DLL. This exercises the
    // whole path the signature layer uses -- module enumeration, image bounds,
    // matching against genuinely mapped memory -- with a known answer.
    const mem::Region image = mem::ModuleImage(L"FPCamera.dll");
    if (!image.Valid()) {
        recorder.Skip("scanner/finds a known needle",
                      "FPCamera.dll is not enumerable; if the loader renamed "
                      "the DLL this check cannot run");
        return;
    }

    char text[64] = {};
    int written = 0;
    for (size_t i = 0; i < sizeof(kScannerNeedle); ++i) {
        written += std::snprintf(text + written,
                                 sizeof(text) - static_cast<size_t>(written),
                                 i == 0 ? "%02X" : " %02X",
                                 kScannerNeedle[i]);
    }

    const core::Pattern pattern = core::ParsePattern(text);
    if (!pattern.Valid()) {
        recorder.Fail("scanner/finds a known needle",
                      "could not parse the generated pattern: " + pattern.error);
        return;
    }

    const std::vector<uintptr_t> hits = mem::Scan(image, pattern, 8);
    recorder.Check(!hits.empty(), "scanner/finds a known needle",
                   std::to_string(hits.size()) +
                       " hit(s) for a needle planted in this DLL");

    // And that a pattern which is definitely absent finds nothing -- a scanner
    // that matched everything would pass the check above.
    const core::Pattern absent =
        core::ParsePattern("DE AD BE EF DE AD BE EF DE AD BE EF DE AD BE EF");
    recorder.Check(mem::Scan(image, absent, 4).empty(),
                   "scanner/rejects an absent pattern",
                   "a pattern that is not present must find nothing");
}

void CheckGuardedMemoryAccess(Recorder& recorder) {
    // Reading address zero must fail cleanly rather than raise.
    uint8_t scratch[8] = {};
    recorder.Check(!mem::SafeRead(0, scratch, sizeof(scratch)),
                   "memory/rejects a null read",
                   "SafeRead(0) must return false, not crash");

    // A deliberately unmapped high address.
    recorder.Check(!mem::SafeRead(0x0000'7FFF'FFFF'F000ull, scratch,
                                  sizeof(scratch)),
                   "memory/rejects an unmapped read",
                   "SafeRead of an unmapped page must return false");

    // A read of memory we own must succeed and return the right bytes.
    const uint64_t marker = 0x0123456789ABCDEFull;
    uint64_t readBack = 0;
    const bool readOk =
        mem::SafeRead(reinterpret_cast<uintptr_t>(&marker), &readBack,
                      sizeof(readBack));
    recorder.Check(readOk && readBack == marker, "memory/reads mapped memory",
                   "round-tripped a known value through SafeRead");

    // A write round-trip, on a buffer this DLL owns. The only write in the
    // whole self-test, and it restores itself.
    uint32_t target = 0xAAAAAAAAu;
    const uintptr_t address = reinterpret_cast<uintptr_t>(&target);
    const uint32_t replacement = 0x55555555u;
    const bool writeOk = mem::SafeWrite(address, &replacement,
                                        sizeof(replacement));
    const bool valueOk = target == replacement;
    const uint32_t original = 0xAAAAAAAAu;
    mem::SafeWrite(address, &original, sizeof(original));
    recorder.Check(writeOk && valueOk && target == original,
                   "memory/write round trip",
                   "SafeWrite modified and restored a local buffer");
}

void CheckSignatures(Recorder& recorder, const Context& context) {
    if (context.signatures == nullptr) {
        recorder.Skip("signatures/registry", "no signature registry loaded");
        return;
    }
    const size_t resolved = context.signatures->ResolvedCount();
    const size_t missing = context.signatures->RequiredFailureCount();

    if (missing > 0) {
        // Not a failure of the plugin: the shipped patterns are unverified
        // templates and are expected not to match. Saying so here stops it
        // reading as a broken install.
        recorder.Skip("signatures/required resolved",
                      std::to_string(missing) +
                          " required signature(s) unresolved. Expected on a "
                          "fresh install -- see docs/SIGNATURES.md. Everything "
                          "that does not need a signature still works.");
    } else {
        recorder.Pass("signatures/required resolved",
                      std::to_string(resolved) + " signature(s) resolved");
    }
}

void CheckCameraState(Recorder& recorder) {
    const camera::Status status = camera::GetStatus();

    if (!status.cameraObjectResolved) {
        recorder.Skip("camera/pointer chain",
                      "the camera object is not reachable; fill in "
                      "camera.pointerChain and camera.fieldOffsets for your "
                      "game build");
    } else {
        recorder.Pass("camera/pointer chain",
                      "resolved; " + std::to_string(status.framesWritten) +
                          " successful frame writes, " +
                          std::to_string(status.writeFailures) + " failures");
    }

    if (!status.firstPersonEnabled) {
        recorder.Skip("camera/eye placement",
                      "first person is off; press the toggle and run this "
                      "again to check the eye placement path");
    } else if (status.eyePlacementActive) {
        char detail[96];
        std::snprintf(detail, sizeof(detail), "active at %.3f m eye height",
                      status.eyeHeight);
        recorder.Pass("camera/eye placement", detail);
    } else {
        recorder.Skip("camera/eye placement",
                      "not active: camera.fieldOffsets.positionX is unset, or "
                      "the value read there is not a plausible position");
    }

    recorder.Check(status.usingProbeBasis, "camera/basis source",
                   status.usingProbeBasis
                       ? "decoded from the game's own view matrix"
                       : "no view matrix identified yet -- press the discovery "
                         "hotkey, rotate the camera, and try again");
}

void CheckInputAndMovement(Recorder& recorder) {
    const Config& config = GetConfig();

    recorder.Check(input::CursorLockEnabled() || !config.mouse.cursorLock,
                   "input/cursor lock",
                   input::CursorLockEnabled()
                       ? "enabled"
                       : "released (config has it off, or it was toggled)");

    const xinput::Status pad = xinput::GetStatus();
    if (config.movement.mode != MovementMode::XInput) {
        recorder.Skip("movement/xinput hook",
                      "movement.mode is not \"xinput\"");
    } else if (!pad.installed) {
        recorder.Fail("movement/xinput hook",
                      "no XInput DLL was hooked, so WASD cannot drive the "
                      "stick. Plug a controller in once, or switch "
                      "movement.mode to \"moveto\".");
    } else {
        recorder.Pass("movement/xinput hook",
                      std::to_string(pad.statesServed) +
                          " states served, physical pad present: " +
                          (pad.physicalPadPresent ? "yes" : "no"));
    }
}

void CheckBridge(Recorder& recorder) {
    const Config& config = GetConfig();
    if (!config.bridge.enabled) {
        recorder.Skip("bridge/lua link", "the bridge is disabled in config");
        return;
    }
    if (bridge::Directory().empty()) {
        recorder.Fail("bridge/lua link",
                      "the Script Extender data directory could not be "
                      "resolved; set bridge.directory in FPCamera.json");
        return;
    }

    const bridge::LuaState state = bridge::Current();
    if (!state.valid) {
        recorder.Skip("bridge/lua link",
                      "no data from the Lua side yet. Load a save; if it stays "
                      "empty, the Script Extender mod is not loading -- see "
                      "INSTALL.md steps 4 and 5.");
        return;
    }
    recorder.Pass("bridge/lua link",
                  "sequence " + std::to_string(state.sequence) + ", race '" +
                      (state.race.empty() ? "<unknown>" : state.race) +
                      "', combat: " + (state.inCombat ? "yes" : "no"));
}

void WriteReport(const Report& report) {
    const std::wstring path = PluginDirectory() + L"FPCamera.selftest.log";
    std::ofstream stream(path.c_str(), std::ios::binary | std::ios::trunc);

    auto emit = [&](const std::string& line) {
        FPCAM_INFO("{}", line);
        if (stream) stream << line << "\r\n";
    };

    emit("=================== FPCamera SELF-TEST ===================");
    emit("plugin version : " FPCAM_VERSION);
    emit("game build     : " + RunningGameVersion());
    emit("----------------------------------------------------------");

    for (const CheckResult& check : report.checks) {
        const char* tag = check.outcome == Outcome::Pass   ? "PASS"
                          : check.outcome == Outcome::Fail ? "FAIL"
                                                           : "SKIP";
        emit(std::string("[") + tag + "] " + check.name);
        if (!check.detail.empty()) {
            emit("       " + check.detail);
        }
    }

    emit("----------------------------------------------------------");
    emit(std::to_string(report.passed) + " passed, " +
         std::to_string(report.failed) + " failed, " +
         std::to_string(report.skipped) + " skipped");
    if (report.failed == 0) {
        emit("RESULT: OK. Skipped checks are features that are not configured "
             "yet, not faults.");
    } else {
        emit("RESULT: FAILURES PRESENT. See docs/TROUBLESHOOTING.md, and "
             "include this file when reporting a problem.");
    }
    emit("==========================================================");
}

}  // namespace

Report Run(const Context& context) {
    Recorder recorder;

    CheckMatrixDecoder(recorder);
    CheckEyePlacement(recorder);
    CheckMoveIntent(recorder);

    CheckRenderHook(recorder, context);
    CheckScannerAgainstRealMemory(recorder);
    CheckGuardedMemoryAccess(recorder);
    CheckSignatures(recorder, context);
    CheckCameraState(recorder);
    CheckInputAndMovement(recorder);
    CheckBridge(recorder);

    Report report = recorder.Take();
    WriteReport(report);
    return report;
}

}  // namespace fpcam::selftest
