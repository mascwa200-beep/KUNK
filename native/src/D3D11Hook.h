// D3D11Hook.h -- entry into the game's render loop.
//
// This is the one part of the plugin that needs no signature scanning at all.
// COM vtable layouts are fixed by the Direct3D 11 ABI and cannot change
// between game patches, so creating a throwaway device, reading its vtable and
// detouring IDXGISwapChain::Present gives a reliable per-frame callback on any
// build of the game -- present and future.
//
// IMPORTANT: this requires the DirectX 11 executable. Launching BG3 in Vulkan
// mode (bg3.exe) produces no swapchain to hook and the plugin will log that it
// is idle. See INSTALL.md.
#pragma once

#include "Common.h"

#include <d3d11.h>
#include <dxgi.h>

namespace fpcam::d3d11 {

// Called once per presented frame, on the render thread, before the frame is
// handed to the driver. Keep the work short: anything blocking here stalls the
// game's frame pacing directly.
using FrameCallback = void (*)(IDXGISwapChain* swapChain);

// Creates a temporary device to harvest vtables, then detours Present and
// ResizeBuffers. Returns false if the device could not be created (which is
// the expected outcome under Vulkan) or if MinHook rejected the detour.
bool Install();

// Removes the detours. Safe to call when Install() failed.
void Uninstall();

void SetFrameCallback(FrameCallback callback);

// Populated from the first real Present call, not from the dummy device.
// All three are null until the game has presented at least one frame.
ID3D11Device* Device();
ID3D11DeviceContext* Context();
HWND Window();

// Raw vtables harvested from the dummy device, available immediately after a
// successful Install(). MatrixProbe installs its own detours into the context
// vtable rather than routing every constant-buffer call through this module.
void** SwapChainVTable();
void** ContextVTable();

// Direct3D 11 vtable slots used by this plugin. Fixed by the ABI; named here
// so the call sites read as something other than magic numbers.
namespace slot {
inline constexpr int kSwapChainPresent       = 8;
inline constexpr int kSwapChainResizeBuffers = 13;

inline constexpr int kContextVSSetConstantBuffers = 7;
inline constexpr int kContextMap                  = 14;
inline constexpr int kContextUnmap                = 15;
inline constexpr int kContextUpdateSubresource    = 48;
}  // namespace slot

// True once the first real frame has been presented. Several subsystems defer
// their setup until this point, because the game finishes loading its own
// modules well after our DLL is injected.
bool HasPresented();

}  // namespace fpcam::d3d11
