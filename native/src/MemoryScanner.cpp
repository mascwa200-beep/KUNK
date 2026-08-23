#include "MemoryScanner.h"

#include "Logger.h"

#include <Psapi.h>

#include <cstdio>
#include <cstring>

namespace fpcam::mem {
namespace {

int HexDigit(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

// Raw copy behind a structured-exception guard. Kept in its own function with
// no C++ objects in scope, which is what MSVC requires of a __try block that
// coexists with unwindable types elsewhere in the translation unit.
bool GuardedCopy(void* destination, const void* source, size_t size) {
    __try {
        ::memcpy(destination, source, size);
        return true;
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
}

// Walks the page table across [address, address+size) and checks every region
// against `allowedProtect`.
bool CheckProtection(uintptr_t address, size_t size, DWORD allowedProtect) {
    if (address == 0 || size == 0) return false;

    uintptr_t cursor = address;
    const uintptr_t end = address + size;
    if (end < address) return false;  // overflow

    while (cursor < end) {
        MEMORY_BASIC_INFORMATION info = {};
        if (::VirtualQuery(reinterpret_cast<LPCVOID>(cursor), &info,
                           sizeof(info)) != sizeof(info)) {
            return false;
        }
        if (info.State != MEM_COMMIT) return false;
        if (info.Protect & PAGE_GUARD) return false;
        if (info.Protect & PAGE_NOACCESS) return false;
        if ((info.Protect & allowedProtect) == 0) return false;

        const uintptr_t regionEnd =
            reinterpret_cast<uintptr_t>(info.BaseAddress) + info.RegionSize;
        if (regionEnd <= cursor) return false;  // no forward progress
        cursor = regionEnd;
    }
    return true;
}

constexpr DWORD kReadable = PAGE_READONLY | PAGE_READWRITE | PAGE_WRITECOPY |
                            PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE |
                            PAGE_EXECUTE_WRITECOPY;

constexpr DWORD kWritable = PAGE_READWRITE | PAGE_WRITECOPY |
                            PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY;

}  // namespace

Region ModuleImage(const wchar_t* moduleName) {
    const HMODULE module = ::GetModuleHandleW(moduleName);
    if (module == nullptr) return {};

    MODULEINFO info = {};
    if (!::GetModuleInformation(::GetCurrentProcess(), module, &info,
                                sizeof(info))) {
        return {};
    }
    return Region{reinterpret_cast<uintptr_t>(info.lpBaseOfDll),
                  static_cast<size_t>(info.SizeOfImage)};
}

Region ModuleSection(const wchar_t* moduleName, std::string_view sectionName) {
    const Region image = ModuleImage(moduleName);
    if (!image.Valid()) return {};

    const auto* dos = reinterpret_cast<const IMAGE_DOS_HEADER*>(image.base);
    if (dos->e_magic != IMAGE_DOS_SIGNATURE) return image;

    const auto* nt = reinterpret_cast<const IMAGE_NT_HEADERS*>(
        image.base + static_cast<uintptr_t>(dos->e_lfanew));
    if (nt->Signature != IMAGE_NT_SIGNATURE) return image;

    const IMAGE_SECTION_HEADER* section = IMAGE_FIRST_SECTION(nt);
    for (WORD i = 0; i < nt->FileHeader.NumberOfSections; ++i, ++section) {
        // Section names are 8 bytes, not necessarily NUL-terminated.
        char name[9] = {};
        ::memcpy(name, section->Name, 8);
        if (sectionName == name) {
            const size_t size = section->Misc.VirtualSize != 0
                                    ? section->Misc.VirtualSize
                                    : section->SizeOfRawData;
            return Region{image.base + section->VirtualAddress, size};
        }
    }

    FPCAM_WARN("Section '{}' not found in module; scanning the full image "
               "instead (slower, more false positives).",
               std::string(sectionName));
    return image;
}

Pattern ParsePattern(std::string_view text) {
    Pattern pattern;

    size_t i = 0;
    while (i < text.size()) {
        const char c = text[i];
        if (c == ' ' || c == '\t' || c == '\r' || c == '\n') {
            ++i;
            continue;
        }

        if (c == '?') {
            // Accept both "?" and "??" for one wildcard byte.
            pattern.bytes.push_back(0);
            pattern.mask.push_back(0);
            ++i;
            if (i < text.size() && text[i] == '?') ++i;
            continue;
        }

        const int high = HexDigit(c);
        if (high < 0) {
            pattern.error = "unexpected character '" + std::string(1, c) +
                            "' at offset " + std::to_string(i);
            return pattern;
        }
        if (i + 1 >= text.size()) {
            pattern.error = "pattern ends with a single hex digit";
            return pattern;
        }
        const int low = HexDigit(text[i + 1]);
        if (low < 0) {
            pattern.error = "byte at offset " + std::to_string(i) +
                            " is not two hex digits";
            return pattern;
        }

        pattern.bytes.push_back(static_cast<uint8_t>((high << 4) | low));
        pattern.mask.push_back(1);
        i += 2;
    }

    if (pattern.bytes.empty()) {
        pattern.error = "pattern is empty";
        return pattern;
    }

    bool anyFixed = false;
    for (const uint8_t m : pattern.mask) {
        if (m) { anyFixed = true; break; }
    }
    if (!anyFixed) {
        pattern.error = "pattern is entirely wildcards";
    }
    return pattern;
}

std::vector<uintptr_t> Scan(const Region& region, const Pattern& pattern,
                            size_t maxHits) {
    std::vector<uintptr_t> hits;
    if (!region.Valid() || !pattern.Valid()) return hits;
    if (pattern.Size() > region.size) return hits;

    // Anchor on the first non-wildcard byte so the outer loop can skip with
    // memchr instead of testing every offset. Signatures usually start with a
    // fixed opcode, so in practice the anchor is at index 0.
    size_t anchor = 0;
    while (anchor < pattern.mask.size() && pattern.mask[anchor] == 0) ++anchor;
    const uint8_t anchorByte = pattern.bytes[anchor];

    const auto* const begin = reinterpret_cast<const uint8_t*>(region.base);
    const size_t lastStart = region.size - pattern.Size();

    size_t offset = 0;
    while (offset <= lastStart) {
        const size_t searchFrom = offset + anchor;
        const size_t searchLength = (lastStart + anchor) - searchFrom + 1;
        const auto* found = static_cast<const uint8_t*>(
            ::memchr(begin + searchFrom, anchorByte, searchLength));
        if (found == nullptr) break;

        const size_t candidate = static_cast<size_t>(found - begin) - anchor;

        bool matched = true;
        for (size_t k = 0; k < pattern.Size(); ++k) {
            if (pattern.mask[k] && begin[candidate + k] != pattern.bytes[k]) {
                matched = false;
                break;
            }
        }
        if (matched) {
            hits.push_back(region.base + candidate);
            if (hits.size() >= maxHits) break;
        }
        offset = candidate + 1;
    }

    return hits;
}

bool IsReadable(uintptr_t address, size_t size) {
    return CheckProtection(address, size, kReadable);
}

bool IsWritable(uintptr_t address, size_t size) {
    return CheckProtection(address, size, kWritable);
}

bool SafeRead(uintptr_t address, void* destination, size_t size) {
    if (!IsReadable(address, size)) return false;
    // Still guarded: the page can be unmapped between the query and the copy
    // by another thread, and this runs inside a live game.
    return GuardedCopy(destination, reinterpret_cast<const void*>(address), size);
}

bool SafeWrite(uintptr_t address, const void* source, size_t size) {
    if (address == 0 || size == 0) return false;
    if (!IsReadable(address, size)) return false;

    DWORD oldProtect = 0;
    const bool needsUnprotect = !IsWritable(address, size);
    if (needsUnprotect) {
        if (!::VirtualProtect(reinterpret_cast<LPVOID>(address), size,
                              PAGE_EXECUTE_READWRITE, &oldProtect)) {
            return false;
        }
    }

    const bool ok = GuardedCopy(reinterpret_cast<void*>(address), source, size);

    if (needsUnprotect) {
        DWORD ignored = 0;
        ::VirtualProtect(reinterpret_cast<LPVOID>(address), size, oldProtect,
                         &ignored);
    }
    if (ok) {
        ::FlushInstructionCache(::GetCurrentProcess(),
                                reinterpret_cast<LPCVOID>(address), size);
    }
    return ok;
}

bool NopRange(uintptr_t address, size_t size) {
    const std::vector<uint8_t> nops(size, 0x90);
    return SafeWrite(address, nops.data(), nops.size());
}

bool BytePatch::Apply(const std::vector<uint8_t>& replacement) {
    if (address == 0 || replacement.empty()) return false;
    if (Applied()) return false;  // already patched; Revert() first

    std::vector<uint8_t> backup(replacement.size());
    if (!SafeRead(address, backup.data(), backup.size())) {
        FPCAM_ERROR("BytePatch: cannot read {} bytes at {} to back up.",
                    backup.size(), DescribeAddress(address));
        return false;
    }
    if (!SafeWrite(address, replacement.data(), replacement.size())) {
        FPCAM_ERROR("BytePatch: write of {} bytes at {} failed.",
                    replacement.size(), DescribeAddress(address));
        return false;
    }
    original = std::move(backup);
    return true;
}

bool BytePatch::Revert() {
    if (!Applied()) return true;
    const bool ok = SafeWrite(address, original.data(), original.size());
    if (ok) original.clear();
    return ok;
}

std::string DescribeAddress(uintptr_t address) {
    if (address == 0) return "<null>";

    static const wchar_t* const kModules[] = {
        L"bg3_dx11.exe", L"bg3.exe", L"DWrite.dll", L"FPCamera.dll",
    };
    for (const wchar_t* name : kModules) {
        const Region image = ModuleImage(name);
        if (image.Valid() && address >= image.base && address < image.End()) {
            char buffer[96] = {};
            ::_snprintf_s(buffer, sizeof(buffer), _TRUNCATE, "%s+0x%llX",
                          WideToUtf8(name).c_str(),
                          static_cast<unsigned long long>(address - image.base));
            return buffer;
        }
    }

    char buffer[32] = {};
    ::_snprintf_s(buffer, sizeof(buffer), _TRUNCATE, "0x%016llX",
                  static_cast<unsigned long long>(address));
    return buffer;
}

}  // namespace fpcam::mem
