#include "KeyNames.h"

#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <utility>
#include <vector>

namespace fpcam::core {
namespace {

struct NamedKey {
    const char* name;
    int code;
};

const std::vector<NamedKey>& Table() {
    static const std::vector<NamedKey> table = {
        {"VK_LBUTTON", vk::kLButton},   {"VK_RBUTTON", vk::kRButton},
        {"VK_MBUTTON", vk::kMButton},   {"VK_BACK", vk::kBack},
        {"VK_TAB", vk::kTab},           {"VK_RETURN", vk::kReturn},
        {"VK_SHIFT", vk::kShift},       {"VK_CONTROL", vk::kControl},
        {"VK_MENU", vk::kMenu},         {"VK_ESCAPE", vk::kEscape},
        {"VK_SPACE", vk::kSpace},       {"VK_END", vk::kEnd},
        {"VK_HOME", vk::kHome},         {"VK_LEFT", vk::kLeft},
        {"VK_UP", vk::kUp},             {"VK_RIGHT", vk::kRight},
        {"VK_DOWN", vk::kDown},         {"VK_INSERT", vk::kInsert},
        {"VK_DELETE", vk::kDelete},     {"VK_F1", vk::kF1},
        {"VK_F2", vk::kF2},             {"VK_F3", vk::kF3},
        {"VK_F4", vk::kF4},             {"VK_F5", vk::kF5},
        {"VK_F6", vk::kF6},             {"VK_F7", vk::kF7},
        {"VK_F8", vk::kF8},             {"VK_F9", vk::kF9},
        {"VK_F10", vk::kF10},           {"VK_F11", vk::kF11},
        {"VK_F12", vk::kF12},           {"VK_LSHIFT", vk::kLShift},
        {"VK_RSHIFT", vk::kRShift},     {"VK_LCONTROL", vk::kLControl},
        {"VK_RCONTROL", vk::kRControl}, {"VK_LMENU", vk::kLMenu},
        {"VK_RMENU", vk::kRMenu},
    };
    return table;
}

}  // namespace

int VirtualKeyFromName(std::string_view name) {
    if (name.empty()) return 0;

    // Raw hex, e.g. "0x70" for F1.
    if (name.size() > 2 && name[0] == '0' && (name[1] == 'x' || name[1] == 'X')) {
        const std::string owned(name);
        char* end = nullptr;
        const long value = std::strtol(owned.c_str() + 2, &end, 16);
        if (end != nullptr && *end == '\0' && value > 0 && value <= 0xFF) {
            return static_cast<int>(value);
        }
        return 0;
    }

    // A single alphanumeric character: the virtual-key code equals the
    // uppercase ASCII value.
    if (name.size() == 1) {
        const char c = name[0];
        if (c >= 'a' && c <= 'z') return c - 'a' + 'A';
        if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) return c;
        return 0;
    }

    std::string upper(name);
    for (char& c : upper) {
        c = static_cast<char>(
            std::toupper(static_cast<unsigned char>(c)));
    }
    for (const NamedKey& entry : Table()) {
        if (upper == entry.name) return entry.code;
    }
    return 0;
}

std::string NameFromVirtualKey(int virtualKey) {
    if (virtualKey == 0) return "<unbound>";
    for (const NamedKey& entry : Table()) {
        if (entry.code == virtualKey) return entry.name;
    }
    if ((virtualKey >= 'A' && virtualKey <= 'Z') ||
        (virtualKey >= '0' && virtualKey <= '9')) {
        return std::string(1, static_cast<char>(virtualKey));
    }
    char buffer[16] = {};
    std::snprintf(buffer, sizeof(buffer), "0x%02X", virtualKey);
    return buffer;
}

}  // namespace fpcam::core
