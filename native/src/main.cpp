// main.cpp -- plugin lifecycle.
//
// FPCamera.dll is loaded by BG3 Script Extender's native-mod loader from
// <BG3>/bin/NativeMods/. SE simply LoadLibrary's every DLL in that folder, so
// DllMain is the entry point; no exported hook function is required.
//
// DllMain itself does almost nothing: it spawns a bootstrap thread and
// returns. Everything else -- file IO, MinHook initialisation, creating a D3D11
// device -- would deadlock if run under the loader lock.
#include "Common.h"

#include "Bridge.h"
#include "CameraHook.h"
#include "Config.h"
#include "D3D11Hook.h"
#include "InputHook.h"
#include "Logger.h"
#include "MatrixProbe.h"
#include "MemoryScanner.h"
#include "Signatures.h"
#include "XInputSpoof.h"

#include <MinHook.h>

#include <atomic>
#include <chrono>
#include <thread>

namespace fpcam {
namespace {

constexpr wchar_t kConfigFile[] = L"FPCamera.json";
constexpr wchar_t kSignatureFile[] = L"FPCamera.signatures.json";

SignatureRegistry g_signatures;

std::atomic<bool> g_shuttingDown{false};
std::atomic<bool> g_started{false};
std::atomic<uint64_t> g_frameIndex{0};

std::thread g_bootstrapThread;
std::thread g_hotkeyThread;

// --- Per-frame ------------------------------------------------------------

void OnPresent(IDXGISwapChain* /*swapChain*/) {
    const uint64_t frame = g_frameIndex.fetch_add(1) + 1;

    // Ordering matters: the probe decodes this frame's view matrix first, so
    // the camera and movement code below read a basis from the current frame
    // rather than the previous one.
    probe::OnFrame(frame);
    camera::OnFrame(frame);
    input::OnFrame();
}

// --- Hotkeys --------------------------------------------------------------

// Edge-triggered: returns true only on the transition from up to down.
bool KeyPressed(int virtualKey, bool* previousState) {
    if (virtualKey == 0) return false;
    const bool down = (::GetAsyncKeyState(virtualKey) & 0x8000) != 0;
    const bool pressed = down && !*previousState;
    *previousState = down;
    return pressed;
}

void LogStatus() {
    const camera::Status cameraStatus = camera::GetStatus();
    const xinput::Status padStatus = xinput::GetStatus();
    const bridge::LuaState luaState = bridge::Current();

    FPCAM_INFO("------------------- STATUS -------------------");
    FPCAM_INFO("first person    : {}", cameraStatus.firstPersonEnabled);
    FPCAM_INFO("camera object   : {}  (writes ok: {}, failures: {})",
               cameraStatus.cameraObjectResolved ? "resolved" : "NOT RESOLVED",
               cameraStatus.framesWritten, cameraStatus.writeFailures);
    FPCAM_INFO("camera basis    : {}",
               cameraStatus.usingProbeBasis ? "decoded from the view matrix"
                                            : "derived from our own yaw/pitch");
    FPCAM_INFO("orientation     : yaw={:.2f} pitch={:.2f}", cameraStatus.yaw,
               cameraStatus.pitch);
    FPCAM_INFO("cursor lock     : enabled={} active={} uiOpen={}",
               input::CursorLockEnabled(), input::CursorCurrentlyLocked(),
               input::UIOpen());
    FPCAM_INFO("xinput          : installed={} injecting={} physicalPad={} "
               "served={} stick=({:.2f},{:.2f})",
               padStatus.installed, padStatus.injecting,
               padStatus.physicalPadPresent, padStatus.statesServed,
               padStatus.lastStickX, padStatus.lastStickY);
    FPCAM_INFO("lua bridge      : {} (seq={}, race='{}', combat={})",
               luaState.valid ? "connected" : "no data yet", luaState.sequence,
               luaState.race, luaState.inCombat);
    FPCAM_INFO("frames presented: {}", g_frameIndex.load());
    FPCAM_INFO("----------------------------------------------");
}

void ReloadConfiguration() {
    Config& config = GetConfig();
    if (!config.Load(kConfigFile)) {
        FPCAM_WARN("Reload failed; the previous configuration is still active.");
        return;
    }

    Logger::Init(config.logging.file, LogLevelFromName(config.logging.level),
                 config.logging.console);
    FPCAM_INFO("Configuration reloaded.");
    config.LogEffective();

    // Offsets are the usual reason for a reload, so re-resolve everything that
    // depends on them.
    g_signatures.Load(kSignatureFile);
    g_signatures.ResolveAll();
    g_signatures.LogReport();
    camera::Rebind(g_signatures);
    probe::ResetLock();
}

void HotkeyLoop() {
    bool previousFirstPerson = false;
    bool previousCursorLock = false;
    bool previousDiscovery = false;
    bool previousReload = false;
    bool previousPanic = false;

    while (!g_shuttingDown.load()) {
        const HotkeyConfig& keys = GetConfig().hotkeys;

        if (KeyPressed(keys.toggleFirstPerson, &previousFirstPerson)) {
            const bool enable = !camera::FirstPersonEnabled();
            camera::SetFirstPersonEnabled(enable);
            if (!enable) {
                ::ClipCursor(nullptr);
            }
            LogStatus();
        }

        if (KeyPressed(keys.toggleCursorLock, &previousCursorLock)) {
            input::SetCursorLockEnabled(!input::CursorLockEnabled());
        }

        if (KeyPressed(keys.toggleDiscovery, &previousDiscovery)) {
            const bool enable = !probe::DiscoveryEnabled();
            probe::SetDiscoveryEnabled(enable);
            probe::LogCandidates();
        }

        if (KeyPressed(keys.reloadConfig, &previousReload)) {
            ReloadConfiguration();
        }

        if (KeyPressed(keys.panicDisable, &previousPanic)) {
            FPCAM_WARN("Panic hotkey pressed: disabling first person, releasing "
                       "the cursor and stopping synthetic input.");
            camera::SetFirstPersonEnabled(false);
            input::SetCursorLockEnabled(false);
            ::ClipCursor(nullptr);
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(25));
    }
}

// --- Startup / shutdown ---------------------------------------------------

void Shutdown() {
    if (g_shuttingDown.exchange(true)) return;

    FPCAM_INFO("Shutting down.");

    if (g_hotkeyThread.joinable()) g_hotkeyThread.join();
    bridge::Stop();

    input::Uninstall();
    xinput::Uninstall();
    camera::Shutdown();   // reverts byte patches before MinHook goes away
    probe::Uninstall();
    d3d11::Uninstall();

    MH_Uninitialize();
    ::ClipCursor(nullptr);

    FPCAM_INFO("Shutdown complete.");
    Logger::Shutdown();
}

void Bootstrap() {
    Config& config = GetConfig();

    // Log first with defaults so that a failure to read the config is itself
    // recorded somewhere the user can find.
    Logger::Init(L"FPCamera.log", LogLevel::Info, false);
    FPCAM_INFO("FPCamera {} starting. Plugin directory: {}", FPCAM_VERSION,
               WideToUtf8(PluginDirectory()));
    FPCAM_INFO("Game executable version: {}", RunningGameVersion());

    if (config.Load(kConfigFile)) {
        Logger::Init(config.logging.file, LogLevelFromName(config.logging.level),
                     config.logging.console);
    }
    config.LogEffective();

    if (!config.enabled) {
        FPCAM_WARN("FPCamera is disabled in FPCamera.json (\"enabled\": false). "
                   "Nothing will be hooked.");
        return;
    }

    MH_STATUS status = MH_Initialize();
    if (status != MH_OK && status != MH_ERROR_ALREADY_INITIALIZED) {
        FPCAM_ERROR("MH_Initialize failed: {}. FPCamera cannot start.",
                    MH_StatusToString(status));
        return;
    }

    if (!d3d11::Install()) {
        FPCAM_ERROR("The Direct3D 11 hook could not be installed. If Baldur's "
                    "Gate 3 was launched in Vulkan mode, quit and launch "
                    "bg3_dx11.exe instead -- this plugin requires DirectX 11.");
        return;
    }
    d3d11::SetFrameCallback(&OnPresent);
    probe::Install();
    probe::SetDiscoveryEnabled(config.discovery.enabled);

    // Wait for the game to render. Signature scanning before the executable's
    // own startup has finished can resolve pointers that are still null, and
    // the game window does not exist until the first present either.
    FPCAM_INFO("Waiting for the first rendered frame before scanning...");
    for (int attempt = 0; attempt < 600 && !d3d11::HasPresented(); ++attempt) {
        if (g_shuttingDown.load()) return;
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    if (!d3d11::HasPresented()) {
        FPCAM_WARN("No frame was presented within 60 seconds. Continuing "
                   "anyway; results may be unreliable.");
    }

    if (g_signatures.Load(kSignatureFile)) {
        g_signatures.ResolveAll();
        g_signatures.LogReport();
        camera::Initialize(g_signatures);
    } else {
        FPCAM_WARN("No usable signature file. Camera writing is disabled, but "
                   "mouse look, the cursor lock and WASD movement will still "
                   "work -- those need no signatures at all.");
    }

    input::Install();

    // The game can load its XInput DLL lazily, after the first frame.
    for (int attempt = 0; attempt < 20 && !xinput::Install(); ++attempt) {
        if (g_shuttingDown.load()) return;
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
    }

    bridge::Start();

    g_hotkeyThread = std::thread(&HotkeyLoop);
    g_started.store(true);

    FPCAM_INFO("FPCamera ready. Press {} to toggle first person.",
               NameFromVirtualKey(config.hotkeys.toggleFirstPerson));
    LogStatus();
}

}  // namespace
}  // namespace fpcam

// Some native-mod loaders look for a named export before loading a DLL. This
// one exists purely to satisfy that check; all real work happens in DllMain.
extern "C" __declspec(dllexport) void FPCameraEntry() {}

BOOL APIENTRY DllMain(HMODULE module, DWORD reason, LPVOID reserved) {
    switch (reason) {
        case DLL_PROCESS_ATTACH: {
            ::DisableThreadLibraryCalls(module);
            fpcam::SetPluginModule(module);
            // Detached rather than joined: DllMain must return promptly, and
            // the thread outlives this call by design.
            fpcam::g_bootstrapThread = std::thread(&fpcam::Bootstrap);
            fpcam::g_bootstrapThread.detach();
            break;
        }

        case DLL_PROCESS_DETACH:
            // reserved != nullptr means the whole process is exiting. Touching
            // MinHook or joining threads at that point runs under a loader lock
            // with other DLLs already unloaded, which is a reliable way to turn
            // a clean exit into a crash report. Let the OS reclaim everything.
            if (reserved == nullptr) {
                fpcam::Shutdown();
            }
            break;

        default:
            break;
    }
    return TRUE;
}
