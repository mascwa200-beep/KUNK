#include "D3D11Hook.h"

#include "Logger.h"

#include <MinHook.h>

#include <initializer_list>

namespace fpcam::d3d11 {
namespace {

using PresentFn = HRESULT(STDMETHODCALLTYPE*)(IDXGISwapChain*, UINT, UINT);
using ResizeBuffersFn = HRESULT(STDMETHODCALLTYPE*)(IDXGISwapChain*, UINT, UINT,
                                                    UINT, DXGI_FORMAT, UINT);

PresentFn g_originalPresent = nullptr;
ResizeBuffersFn g_originalResizeBuffers = nullptr;

void** g_swapChainVTable = nullptr;
void** g_contextVTable = nullptr;

ID3D11Device* g_device = nullptr;
ID3D11DeviceContext* g_context = nullptr;
HWND g_window = nullptr;

FrameCallback g_frameCallback = nullptr;
bool g_installed = false;
volatile LONG g_hasPresented = 0;

constexpr wchar_t kDummyWindowClass[] = L"FPCameraDummyWindowClass";

// Binds the device, context and window from the live swapchain. Done lazily on
// the first Present because the dummy device we harvested vtables from is not
// the device the game actually renders with.
void CaptureFromSwapChain(IDXGISwapChain* swapChain) {
    if (g_device != nullptr) return;

    if (FAILED(swapChain->GetDevice(__uuidof(ID3D11Device),
                                    reinterpret_cast<void**>(&g_device)))) {
        FPCAM_ERROR("Present: IDXGISwapChain::GetDevice failed; the render-side "
                    "features will stay disabled.");
        return;
    }
    g_device->GetImmediateContext(&g_context);

    DXGI_SWAP_CHAIN_DESC desc = {};
    if (SUCCEEDED(swapChain->GetDesc(&desc))) {
        g_window = desc.OutputWindow;
    }

    FPCAM_INFO("Render device captured: device={} context={} hwnd={}",
               static_cast<void*>(g_device), static_cast<void*>(g_context),
               static_cast<void*>(g_window));
}

HRESULT STDMETHODCALLTYPE HookedPresent(IDXGISwapChain* swapChain,
                                        UINT syncInterval, UINT flags) {
    // Overlays and other plugins can drive nested presents. Our per-frame work
    // must run exactly once per frame and must never recurse.
    static thread_local bool inPresent = false;

    if (!inPresent) {
        inPresent = true;

        CaptureFromSwapChain(swapChain);
        ::InterlockedExchange(&g_hasPresented, 1);

        if (g_frameCallback != nullptr) {
            g_frameCallback(swapChain);
        }

        inPresent = false;
    }

    return g_originalPresent(swapChain, syncInterval, flags);
}

HRESULT STDMETHODCALLTYPE HookedResizeBuffers(IDXGISwapChain* swapChain,
                                              UINT bufferCount, UINT width,
                                              UINT height, DXGI_FORMAT format,
                                              UINT flags) {
    // A resize invalidates the captured device/context; drop them and let the
    // next Present re-capture. Also the moment the window size changes, which
    // the cursor-lock code needs to know about.
    if (g_context != nullptr) {
        g_context->Release();
        g_context = nullptr;
    }
    if (g_device != nullptr) {
        g_device->Release();
        g_device = nullptr;
    }
    FPCAM_DEBUG("ResizeBuffers: {}x{}, device references dropped.", width, height);

    return g_originalResizeBuffers(swapChain, bufferCount, width, height, format,
                                   flags);
}

// Creates a 1x1 offscreen device purely to read the two vtables, then throws it
// away. Nothing is rendered with it.
bool HarvestVTables() {
    WNDCLASSEXW windowClass = {};
    windowClass.cbSize = sizeof(windowClass);
    windowClass.lpfnWndProc = ::DefWindowProcW;
    windowClass.hInstance = ::GetModuleHandleW(nullptr);
    windowClass.lpszClassName = kDummyWindowClass;

    const ATOM atom = ::RegisterClassExW(&windowClass);
    if (atom == 0 && ::GetLastError() != ERROR_CLASS_ALREADY_EXISTS) {
        FPCAM_ERROR("RegisterClassExW for the dummy window failed: {}",
                    ::GetLastError());
        return false;
    }

    HWND dummyWindow = ::CreateWindowExW(0, kDummyWindowClass, L"FPCamera", 0, 0,
                                         0, 1, 1, nullptr, nullptr,
                                         windowClass.hInstance, nullptr);
    if (dummyWindow == nullptr) {
        FPCAM_ERROR("CreateWindowExW for the dummy window failed: {}",
                    ::GetLastError());
        return false;
    }

    DXGI_SWAP_CHAIN_DESC desc = {};
    desc.BufferCount = 1;
    desc.BufferDesc.Width = 1;
    desc.BufferDesc.Height = 1;
    desc.BufferDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
    desc.BufferDesc.RefreshRate.Numerator = 60;
    desc.BufferDesc.RefreshRate.Denominator = 1;
    desc.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    desc.OutputWindow = dummyWindow;
    desc.SampleDesc.Count = 1;
    desc.SampleDesc.Quality = 0;
    desc.Windowed = TRUE;
    desc.SwapEffect = DXGI_SWAP_EFFECT_DISCARD;

    const D3D_FEATURE_LEVEL requested[] = {D3D_FEATURE_LEVEL_11_0,
                                           D3D_FEATURE_LEVEL_10_1,
                                           D3D_FEATURE_LEVEL_10_0};

    IDXGISwapChain* swapChain = nullptr;
    ID3D11Device* device = nullptr;
    ID3D11DeviceContext* context = nullptr;
    D3D_FEATURE_LEVEL obtained = {};

    HRESULT hr = ::D3D11CreateDeviceAndSwapChain(
        nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, 0, requested,
        static_cast<UINT>(ARRAYSIZE(requested)), D3D11_SDK_VERSION, &desc,
        &swapChain, &device, &obtained, &context);

    if (FAILED(hr)) {
        // WARP costs nothing here: the device is discarded immediately and only
        // its vtable layout matters, which is identical across drivers.
        FPCAM_WARN("Hardware dummy device failed (hr=0x{:08X}); retrying with "
                   "the WARP software adapter.", static_cast<uint32_t>(hr));
        hr = ::D3D11CreateDeviceAndSwapChain(
            nullptr, D3D_DRIVER_TYPE_WARP, nullptr, 0, requested,
            static_cast<UINT>(ARRAYSIZE(requested)), D3D11_SDK_VERSION, &desc,
            &swapChain, &device, &obtained, &context);
    }

    if (FAILED(hr)) {
        FPCAM_ERROR("Could not create a dummy D3D11 device (hr=0x{:08X}). If "
                    "the game was launched in Vulkan mode this is expected -- "
                    "relaunch bg3_dx11.exe. Camera hooks are disabled.",
                    static_cast<uint32_t>(hr));
        ::DestroyWindow(dummyWindow);
        return false;
    }

    g_swapChainVTable = *reinterpret_cast<void***>(swapChain);
    g_contextVTable = *reinterpret_cast<void***>(context);

    FPCAM_INFO("Harvested vtables: swapchain={} context={}",
               static_cast<void*>(g_swapChainVTable),
               static_cast<void*>(g_contextVTable));

    context->Release();
    device->Release();
    swapChain->Release();
    ::DestroyWindow(dummyWindow);
    ::UnregisterClassW(kDummyWindowClass, windowClass.hInstance);
    return true;
}

}  // namespace

bool Install() {
    if (g_installed) return true;

    if (!HarvestVTables()) return false;

    MH_STATUS status = MH_CreateHook(
        g_swapChainVTable[slot::kSwapChainPresent],
        reinterpret_cast<LPVOID>(&HookedPresent),
        reinterpret_cast<LPVOID*>(&g_originalPresent));
    if (status != MH_OK) {
        FPCAM_ERROR("MH_CreateHook(Present) failed: {}",
                    MH_StatusToString(status));
        return false;
    }

    status = MH_CreateHook(
        g_swapChainVTable[slot::kSwapChainResizeBuffers],
        reinterpret_cast<LPVOID>(&HookedResizeBuffers),
        reinterpret_cast<LPVOID*>(&g_originalResizeBuffers));
    if (status != MH_OK) {
        FPCAM_ERROR("MH_CreateHook(ResizeBuffers) failed: {}",
                    MH_StatusToString(status));
        MH_RemoveHook(g_swapChainVTable[slot::kSwapChainPresent]);
        return false;
    }

    // Enable exactly our two hooks rather than MH_ALL_HOOKS: other subsystems
    // (and Script Extender itself) create hooks of their own, and enabling
    // theirs on our behalf at an arbitrary moment is not ours to do.
    for (const int index : {slot::kSwapChainPresent, slot::kSwapChainResizeBuffers}) {
        status = MH_EnableHook(g_swapChainVTable[index]);
        if (status != MH_OK) {
            FPCAM_ERROR("MH_EnableHook(vtable slot {}) failed: {}", index,
                        MH_StatusToString(status));
            MH_RemoveHook(g_swapChainVTable[slot::kSwapChainPresent]);
            MH_RemoveHook(g_swapChainVTable[slot::kSwapChainResizeBuffers]);
            return false;
        }
    }

    g_installed = true;
    FPCAM_INFO("D3D11 present hook installed.");
    return true;
}

void Uninstall() {
    if (!g_installed) return;

    MH_DisableHook(g_swapChainVTable[slot::kSwapChainPresent]);
    MH_DisableHook(g_swapChainVTable[slot::kSwapChainResizeBuffers]);
    MH_RemoveHook(g_swapChainVTable[slot::kSwapChainPresent]);
    MH_RemoveHook(g_swapChainVTable[slot::kSwapChainResizeBuffers]);

    if (g_context != nullptr) {
        g_context->Release();
        g_context = nullptr;
    }
    if (g_device != nullptr) {
        g_device->Release();
        g_device = nullptr;
    }

    g_installed = false;
    FPCAM_INFO("D3D11 present hook removed.");
}

void SetFrameCallback(FrameCallback callback) { g_frameCallback = callback; }

ID3D11Device* Device() { return g_device; }
ID3D11DeviceContext* Context() { return g_context; }
HWND Window() { return g_window; }
void** SwapChainVTable() { return g_swapChainVTable; }
void** ContextVTable() { return g_contextVTable; }
bool HasPresented() { return ::InterlockedCompareExchange(&g_hasPresented, 0, 0) != 0; }

}  // namespace fpcam::d3d11
