#include "Common.h"

#include <shlobj.h>

#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdlib>

namespace fpcam {

// The key table in core/KeyNames.h has to compile without Windows.h, so it
// spells the virtual-key codes out as literals. These assertions are the reason
// that is safe: on Windows the two definitions must agree exactly, and the
// build fails here if a value is ever mistyped.
static_assert(core::vk::kF1 == VK_F1, "core::vk::kF1 disagrees with VK_F1");
static_assert(core::vk::kF2 == VK_F2, "core::vk::kF2 disagrees with VK_F2");
static_assert(core::vk::kF3 == VK_F3, "core::vk::kF3 disagrees with VK_F3");
static_assert(core::vk::kF4 == VK_F4, "core::vk::kF4 disagrees with VK_F4");
static_assert(core::vk::kF7 == VK_F7, "core::vk::kF7 disagrees with VK_F7");
static_assert(core::vk::kF8 == VK_F8, "core::vk::kF8 disagrees with VK_F8");
static_assert(core::vk::kLShift == VK_LSHIFT, "kLShift disagrees with VK_LSHIFT");
static_assert(core::vk::kControl == VK_CONTROL, "kControl disagrees with VK_CONTROL");
static_assert(core::vk::kSpace == VK_SPACE, "kSpace disagrees with VK_SPACE");
static_assert(core::vk::kEscape == VK_ESCAPE, "kEscape disagrees with VK_ESCAPE");
static_assert(core::vk::kMButton == VK_MBUTTON, "kMButton disagrees with VK_MBUTTON");

namespace {

// Populated once on first use from the HMODULE captured in DllMain.
HMODULE g_pluginModule = nullptr;

std::wstring ComputePluginDirectory() {
    wchar_t buffer[MAX_PATH] = {};
    const DWORD length = ::GetModuleFileNameW(g_pluginModule, buffer, MAX_PATH);
    if (length == 0 || length == MAX_PATH) {
        // Fall back to the process directory. Worse, but still better than a
        // relative path against an unknown working directory.
        if (::GetModuleFileNameW(nullptr, buffer, MAX_PATH) == 0) {
            return L".\\";
        }
    }
    std::wstring path(buffer);
    const size_t slash = path.find_last_of(L"\\/");
    return slash == std::wstring::npos ? std::wstring(L".\\")
                                       : path.substr(0, slash + 1);
}

}  // namespace

void SetPluginModule(HMODULE module) { g_pluginModule = module; }

EnsureResult EnsureFileExists(const std::wstring& fileName,
                              std::string_view contents) {
    const std::wstring path = PluginDirectory() + fileName;

    // CREATE_NEW fails with ERROR_FILE_EXISTS rather than truncating, so the
    // "only if missing" decision is made by the filesystem in one step. A
    // separate GetFileAttributes check would leave a window in which a
    // concurrently created file gets clobbered.
    const HANDLE file = ::CreateFileW(path.c_str(), GENERIC_WRITE, FILE_SHARE_READ,
                                      nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL,
                                      nullptr);
    if (file == INVALID_HANDLE_VALUE) {
        return ::GetLastError() == ERROR_FILE_EXISTS ? EnsureResult::AlreadyPresent
                                                     : EnsureResult::Failed;
    }

    bool ok = contents.empty();
    if (!contents.empty()) {
        DWORD written = 0;
        ok = ::WriteFile(file, contents.data(),
                         static_cast<DWORD>(contents.size()), &written,
                         nullptr) != 0 &&
             written == contents.size();
    }
    ::CloseHandle(file);

    if (!ok) {
        // A half-written config is worse than none: it would parse as garbage
        // and the plugin would report the user's install as broken.
        ::DeleteFileW(path.c_str());
        return EnsureResult::Failed;
    }
    return EnsureResult::Created;
}

const std::wstring& PluginDirectory() {
    static const std::wstring directory = ComputePluginDirectory();
    return directory;
}

std::string WideToUtf8(std::wstring_view wide) {
    if (wide.empty()) return {};
    const int needed = ::WideCharToMultiByte(
        CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()),
        nullptr, 0, nullptr, nullptr);
    if (needed <= 0) return {};
    std::string out(static_cast<size_t>(needed), '\0');
    ::WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()),
                          out.data(), needed, nullptr, nullptr);
    return out;
}

std::wstring Utf8ToWide(std::string_view utf8) {
    if (utf8.empty()) return {};
    const int needed = ::MultiByteToWideChar(
        CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()), nullptr, 0);
    if (needed <= 0) return {};
    std::wstring out(static_cast<size_t>(needed), L'\0');
    ::MultiByteToWideChar(CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()),
                          out.data(), needed);
    return out;
}

std::wstring ScriptExtenderDataDirectory() {
    PWSTR localAppData = nullptr;
    if (FAILED(::SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr,
                                      &localAppData))) {
        return {};
    }
    std::wstring path(localAppData);
    ::CoTaskMemFree(localAppData);
    path += L"\\Larian Studios\\Baldur's Gate 3\\Script Extender\\";
    return path;
}




}  // namespace fpcam
