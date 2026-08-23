#include "Common.h"

#include <ShlObj.h>

#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <unordered_map>

namespace fpcam {
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

const std::unordered_map<std::string, int>& NamedVirtualKeys() {
    static const std::unordered_map<std::string, int> table = {
        {"VK_LBUTTON", VK_LBUTTON},   {"VK_RBUTTON", VK_RBUTTON},
        {"VK_MBUTTON", VK_MBUTTON},   {"VK_XBUTTON1", VK_XBUTTON1},
        {"VK_XBUTTON2", VK_XBUTTON2}, {"VK_BACK", VK_BACK},
        {"VK_TAB", VK_TAB},           {"VK_RETURN", VK_RETURN},
        {"VK_SHIFT", VK_SHIFT},       {"VK_CONTROL", VK_CONTROL},
        {"VK_MENU", VK_MENU},         {"VK_PAUSE", VK_PAUSE},
        {"VK_CAPITAL", VK_CAPITAL},   {"VK_ESCAPE", VK_ESCAPE},
        {"VK_SPACE", VK_SPACE},       {"VK_PRIOR", VK_PRIOR},
        {"VK_NEXT", VK_NEXT},         {"VK_END", VK_END},
        {"VK_HOME", VK_HOME},         {"VK_LEFT", VK_LEFT},
        {"VK_UP", VK_UP},             {"VK_RIGHT", VK_RIGHT},
        {"VK_DOWN", VK_DOWN},         {"VK_INSERT", VK_INSERT},
        {"VK_DELETE", VK_DELETE},     {"VK_LWIN", VK_LWIN},
        {"VK_RWIN", VK_RWIN},         {"VK_NUMPAD0", VK_NUMPAD0},
        {"VK_NUMPAD1", VK_NUMPAD1},   {"VK_NUMPAD2", VK_NUMPAD2},
        {"VK_NUMPAD3", VK_NUMPAD3},   {"VK_NUMPAD4", VK_NUMPAD4},
        {"VK_NUMPAD5", VK_NUMPAD5},   {"VK_NUMPAD6", VK_NUMPAD6},
        {"VK_NUMPAD7", VK_NUMPAD7},   {"VK_NUMPAD8", VK_NUMPAD8},
        {"VK_NUMPAD9", VK_NUMPAD9},   {"VK_MULTIPLY", VK_MULTIPLY},
        {"VK_ADD", VK_ADD},           {"VK_SUBTRACT", VK_SUBTRACT},
        {"VK_DECIMAL", VK_DECIMAL},   {"VK_DIVIDE", VK_DIVIDE},
        {"VK_F1", VK_F1},             {"VK_F2", VK_F2},
        {"VK_F3", VK_F3},             {"VK_F4", VK_F4},
        {"VK_F5", VK_F5},             {"VK_F6", VK_F6},
        {"VK_F7", VK_F7},             {"VK_F8", VK_F8},
        {"VK_F9", VK_F9},             {"VK_F10", VK_F10},
        {"VK_F11", VK_F11},           {"VK_F12", VK_F12},
        {"VK_NUMLOCK", VK_NUMLOCK},   {"VK_SCROLL", VK_SCROLL},
        {"VK_LSHIFT", VK_LSHIFT},     {"VK_RSHIFT", VK_RSHIFT},
        {"VK_LCONTROL", VK_LCONTROL}, {"VK_RCONTROL", VK_RCONTROL},
        {"VK_LMENU", VK_LMENU},       {"VK_RMENU", VK_RMENU},
        {"VK_OEM_1", VK_OEM_1},       {"VK_OEM_PLUS", VK_OEM_PLUS},
        {"VK_OEM_COMMA", VK_OEM_COMMA},
        {"VK_OEM_MINUS", VK_OEM_MINUS},
        {"VK_OEM_PERIOD", VK_OEM_PERIOD},
        {"VK_OEM_2", VK_OEM_2},       {"VK_OEM_3", VK_OEM_3},
        {"VK_OEM_4", VK_OEM_4},       {"VK_OEM_5", VK_OEM_5},
        {"VK_OEM_6", VK_OEM_6},       {"VK_OEM_7", VK_OEM_7},
    };
    return table;
}

}  // namespace

void SetPluginModule(HMODULE module) { g_pluginModule = module; }

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

int VirtualKeyFromName(std::string_view name) {
    if (name.empty()) return 0;

    // Raw hex, e.g. "0x70" for F1.
    if (name.size() > 2 && name[0] == '0' && (name[1] == 'x' || name[1] == 'X')) {
        const std::string owned(name);
        char* end = nullptr;
        const long value = std::strtol(owned.c_str() + 2, &end, 16);
        if (end && *end == '\0' && value > 0 && value <= 0xFF) {
            return static_cast<int>(value);
        }
        return 0;
    }

    // Single alphanumeric character: 'W', 'D', '4'. The Win32 virtual-key code
    // for these matches the uppercase ASCII value.
    if (name.size() == 1) {
        const char c = name[0];
        if (c >= 'a' && c <= 'z') return c - 'a' + 'A';
        if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) return c;
        return 0;
    }

    std::string upper(name);
    for (char& c : upper) {
        c = static_cast<char>(::toupper(static_cast<unsigned char>(c)));
    }
    const auto& table = NamedVirtualKeys();
    const auto it = table.find(upper);
    return it == table.end() ? 0 : it->second;
}

std::string NameFromVirtualKey(int vk) {
    if (vk == 0) return "<unbound>";
    for (const auto& [name, code] : NamedVirtualKeys()) {
        if (code == vk) return name;
    }
    if ((vk >= 'A' && vk <= 'Z') || (vk >= '0' && vk <= '9')) {
        return std::string(1, static_cast<char>(vk));
    }
    char buffer[16] = {};
    ::_snprintf_s(buffer, sizeof(buffer), _TRUNCATE, "0x%02X", vk);
    return buffer;
}

float WrapDegrees(float degrees) {
    degrees = std::fmod(degrees + 180.0f, 360.0f);
    if (degrees < 0.0f) degrees += 360.0f;
    return degrees - 180.0f;
}

}  // namespace fpcam
