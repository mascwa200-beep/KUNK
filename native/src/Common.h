// Common.h -- shared Windows includes and small helpers.
//
// Every translation unit in this project includes this first so that the
// WIN32_LEAN_AND_MEAN / NOMINMAX contract set in CMake is honoured before any
// system header is pulled in.
#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif

#include <Windows.h>

#include <cstdint>
#include <string>
#include <string_view>

#ifndef FPCAM_VERSION
#define FPCAM_VERSION "0.0.0-dev"
#endif

namespace fpcam {

// Narrow/wide conversions. BG3 paths come out of the shell API as wide
// strings; the log and the JSON config are UTF-8.
std::string WideToUtf8(std::wstring_view wide);
std::wstring Utf8ToWide(std::string_view utf8);

// Records the HMODULE handed to DllMain so PluginDirectory() can resolve paths
// relative to the DLL rather than to the game executable. Called exactly once,
// from DllMain, before any other function here.
void SetPluginModule(HMODULE module);

// Directory containing FPCamera.dll itself. All config and log files are
// resolved relative to this so the plugin works regardless of the process
// working directory (which BG3 does not set to bin/).
const std::wstring& PluginDirectory();

// "%LOCALAPPDATA%\Larian Studios\Baldur's Gate 3\Script Extender\", the only
// directory Script Extender's Ext.IO API is permitted to write to. Returns an
// empty string if the folder cannot be resolved. Used by the Lua bridge.
std::wstring ScriptExtenderDataDirectory();

// Maps a key name from the config ("W", "VK_F1", "0x70") onto a virtual-key
// code. Returns 0 when the name is not recognised, which callers treat as
// "binding disabled" rather than as an error.
int VirtualKeyFromName(std::string_view name);

// Human-readable name for a virtual-key code, for echoing bindings into the
// log so the user can confirm what was actually parsed.
std::string NameFromVirtualKey(int vk);

// Clamps to [lo, hi]. std::clamp needs <algorithm> in every TU and we use this
// in hot per-frame paths.
template <typename T>
constexpr T Clamp(T v, T lo, T hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

// Wraps an angle in degrees into [-180, 180). Camera yaw accumulates without
// bound as the mouse turns, and some camera structures reject out-of-range
// values, so every write is normalised first.
float WrapDegrees(float degrees);

}  // namespace fpcam
