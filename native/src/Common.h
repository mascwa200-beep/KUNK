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

#include <windows.h>

#include "core/Angles.h"
#include "core/KeyNames.h"

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

// Outcome of EnsureFileExists.
enum class EnsureResult {
    AlreadyPresent,  // the file was already there and was left untouched
    Created,         // it was missing and has been written
    Failed,          // it was missing and could not be written
};

// Writes `contents` to <plugin dir>/fileName, but only if that file does not
// already exist. This is what lets the plugin ship as a single DLL: the config
// files it wants appear next to it on first run.
//
// An existing file is never overwritten, and the check is not a separate
// existence test -- the file is opened CREATE_NEW so the decision is atomic.
// Somebody who has spent an evening filling in memory offsets must not lose
// them by dropping in a newer build.
EnsureResult EnsureFileExists(const std::wstring& fileName,
                              std::string_view contents);

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

// Key-name parsing lives in core/KeyNames.h so the config tests can reach it
// without Windows.h. Common.cpp static_asserts the table against the real VK_*
// macros, so the two cannot drift apart unnoticed.

// Clamp and WrapDegrees live in core/Angles.h alongside the rest of the camera
// angle conventions, and are re-exported here for the existing call sites.
using core::Clamp;
using core::NameFromVirtualKey;
using core::VirtualKeyFromName;
using core::WrapDegrees;

}  // namespace fpcam
