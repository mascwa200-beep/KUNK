// KeyNames.h -- virtual-key names, without Windows.h.
//
// Key codes are fixed by the Win32 API and are just small integers, so the
// table lives here where the config parser and its tests can reach it on any
// host. Common.cpp static_asserts a sample of these against the real VK_*
// macros when built on Windows, so the two can never silently drift apart.
#pragma once

#include <cstdint>
#include <string>
#include <string_view>

namespace fpcam::core {

// The subset the config actually needs, with their Win32 values.
namespace vk {
inline constexpr int kLButton  = 0x01;
inline constexpr int kRButton  = 0x02;
inline constexpr int kMButton  = 0x04;
inline constexpr int kBack     = 0x08;
inline constexpr int kTab      = 0x09;
inline constexpr int kReturn   = 0x0D;
inline constexpr int kShift    = 0x10;
inline constexpr int kControl  = 0x11;
inline constexpr int kMenu     = 0x12;
inline constexpr int kEscape   = 0x1B;
inline constexpr int kSpace    = 0x20;
inline constexpr int kEnd      = 0x23;
inline constexpr int kHome     = 0x24;
inline constexpr int kLeft     = 0x25;
inline constexpr int kUp       = 0x26;
inline constexpr int kRight    = 0x27;
inline constexpr int kDown     = 0x28;
inline constexpr int kInsert   = 0x2D;
inline constexpr int kDelete   = 0x2E;
inline constexpr int kF1       = 0x70;
inline constexpr int kF2       = 0x71;
inline constexpr int kF3       = 0x72;
inline constexpr int kF4       = 0x73;
inline constexpr int kF5       = 0x74;
inline constexpr int kF6       = 0x75;
inline constexpr int kF7       = 0x76;
inline constexpr int kF8       = 0x77;
inline constexpr int kF9       = 0x78;
inline constexpr int kF10      = 0x79;
inline constexpr int kF11      = 0x7A;
inline constexpr int kF12      = 0x7B;
inline constexpr int kLShift   = 0xA0;
inline constexpr int kRShift   = 0xA1;
inline constexpr int kLControl = 0xA2;
inline constexpr int kRControl = 0xA3;
inline constexpr int kLMenu    = 0xA4;
inline constexpr int kRMenu    = 0xA5;
}  // namespace vk

// Accepts "W", "w", "4", "VK_F1", "vk_f1" and raw hex like "0x70".
// Returns 0 when the name is not recognised; callers treat that as "binding
// disabled" and say so in the log rather than failing to start.
int VirtualKeyFromName(std::string_view name);

// Best-effort reverse lookup, for echoing what a binding actually parsed to.
std::string NameFromVirtualKey(int virtualKey);

}  // namespace fpcam::core
