#include "Signatures.h"

#include "Logger.h"

#include <nlohmann/json.hpp>

// winver.h is not pulled in by Windows.h under WIN32_LEAN_AND_MEAN, and
// RunningGameVersion() needs the file-version resource API.
#include <winver.h>

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>

namespace fpcam {
namespace {

using json = nlohmann::json;

std::string ReadWholeFile(const std::wstring& path, bool* ok) {
    *ok = false;
    std::ifstream stream(path.c_str(), std::ios::binary);
    if (!stream) return {};
    std::ostringstream buffer;
    buffer << stream.rdbuf();
    *ok = true;
    std::string content = buffer.str();
    // Strip a UTF-8 BOM; users editing these files in Notepad will add one and
    // nlohmann rejects it.
    if (content.size() >= 3 && static_cast<unsigned char>(content[0]) == 0xEF &&
        static_cast<unsigned char>(content[1]) == 0xBB &&
        static_cast<unsigned char>(content[2]) == 0xBF) {
        content.erase(0, 3);
    }
    return content;
}

}  // namespace

bool SignatureRegistry::Load(const std::wstring& fileName) {
    definitions_.clear();
    results_.clear();
    gameVersion_.clear();

    const std::wstring path = PluginDirectory() + fileName;
    sourceFile_ = WideToUtf8(path);

    bool readOk = false;
    const std::string content = ReadWholeFile(path, &readOk);
    if (!readOk) {
        FPCAM_ERROR("Signature file not found: {}. The camera features cannot "
                    "start without it.", sourceFile_);
        return false;
    }

    json root;
    try {
        root = json::parse(content, nullptr, true, /*ignore_comments=*/true);
    } catch (const json::exception& e) {
        FPCAM_ERROR("Signature file {} is not valid JSON: {}", sourceFile_,
                    e.what());
        return false;
    }

    gameVersion_ = root.value("gameBuild", std::string("<unspecified>"));

    const auto signaturesIt = root.find("signatures");
    if (signaturesIt == root.end() || !signaturesIt->is_array()) {
        FPCAM_ERROR("Signature file {} has no 'signatures' array.", sourceFile_);
        return false;
    }

    for (const json& entry : *signaturesIt) {
        if (!entry.is_object()) {
            FPCAM_WARN("Skipping a non-object element in 'signatures'.");
            continue;
        }

        SignatureDef def;
        def.name = entry.value("name", std::string());
        if (def.name.empty()) {
            FPCAM_WARN("Skipping a signature with no 'name'.");
            continue;
        }
        def.pattern = entry.value("pattern", std::string());
        def.moduleName = Utf8ToWide(entry.value("module", std::string("bg3_dx11.exe")));
        def.sectionName = entry.value("section", std::string(".text"));
        def.verified = entry.value("verified", false);
        def.required = entry.value("required", false);
        def.notes = entry.value("notes", std::string());
        def.manualIsRelative = entry.value("manualIsRelative", true);

        // manualAddress accepts a hex string ("0x1A2B3C4") because that is how
        // Cheat Engine and Ghidra present addresses, and JSON numbers lose
        // precision above 2^53.
        if (const auto it = entry.find("manualAddress"); it != entry.end()) {
            if (it->is_string()) {
                const std::string text = it->get<std::string>();
                if (!text.empty()) {
                    def.manualAddress = static_cast<uintptr_t>(
                        std::strtoull(text.c_str(), nullptr, 0));
                }
            } else if (it->is_number_unsigned()) {
                def.manualAddress = it->get<uintptr_t>();
            }
        }

        if (const auto it = entry.find("resolve");
            it != entry.end() && it->is_array()) {
            for (const json& stepJson : *it) {
                ResolveStep step;
                const bool opOk = core::ResolveOpFromName(
                    stepJson.value("op", std::string()), &step.op);
                if (!opOk) {
                    FPCAM_WARN("Signature '{}': unknown resolve op '{}'; the "
                               "signature will be skipped.",
                               def.name, stepJson.value("op", std::string()));
                    def.resolve.clear();
                    def.pattern.clear();  // force a parse failure below
                    break;
                }
                step.value = stepJson.value("value", int64_t{0});
                step.instructionLength =
                    stepJson.value("instructionLength", int32_t{0});
                def.resolve.push_back(step);
            }
        }

        definitions_.push_back(std::move(def));
    }

    FPCAM_INFO("Loaded {} signature definition(s) from {} (declared build: {}).",
               definitions_.size(), sourceFile_, gameVersion_);
    return true;
}

SignatureResult SignatureRegistry::ResolveOne(const SignatureDef& def) const {
    SignatureResult result;

    const mem::Region image = mem::ModuleImage(def.moduleName.c_str());
    if (!image.Valid()) {
        result.error = "module '" + WideToUtf8(def.moduleName) +
                       "' is not loaded in this process";
        return result;
    }

    uintptr_t address = 0;

    if (def.manualAddress != 0) {
        address = def.manualIsRelative ? image.base + def.manualAddress
                                       : def.manualAddress;
        result.hitCount = 1;
    } else {
        if (def.pattern.empty()) {
            result.error = "no pattern and no manualAddress";
            return result;
        }
        const mem::Pattern pattern = mem::ParsePattern(def.pattern);
        if (!pattern.Valid()) {
            result.error = "bad pattern: " + pattern.error;
            return result;
        }

        const mem::Region region =
            mem::ModuleSection(def.moduleName.c_str(), def.sectionName);
        const std::vector<uintptr_t> hits = mem::Scan(region, pattern, 8);
        result.hitCount = hits.size();

        if (hits.empty()) {
            result.error = "no match (pattern is stale for this game build)";
            return result;
        }
        if (hits.size() > 1) {
            // Deliberately a failure. See the header comment.
            result.error = "ambiguous: " + std::to_string(hits.size()) +
                           " matches; make the pattern longer or more specific";
            return result;
        }
        address = hits.front();
    }

    // Apply the resolve chain. The arithmetic is core::ApplyResolveChain; this
    // layer only supplies the guarded reader and turns a failure into a message
    // the scan report can show.
    const core::ResolveOutcome outcome = core::ApplyResolveChain(
        address, def.resolve,
        [](uintptr_t from, void* destination, size_t size) {
            return mem::SafeRead(from, destination, size);
        });

    if (!outcome.ok) {
        result.error = outcome.error;
        return result;
    }
    address = outcome.address;

    if (address == 0) {
        result.error = "resolved to a null address";
        return result;
    }
    if (!mem::IsReadable(address, sizeof(uintptr_t))) {
        result.error = "resolved to unreadable memory at " +
                       mem::DescribeAddress(address);
        return result;
    }

    result.ok = true;
    result.address = address;
    return result;
}

void SignatureRegistry::ResolveAll() {
    results_.clear();
    for (const SignatureDef& def : definitions_) {
        results_[def.name] = ResolveOne(def);
    }
}

std::optional<uintptr_t> SignatureRegistry::Get(std::string_view name) const {
    const auto it = results_.find(std::string(name));
    if (it == results_.end() || !it->second.ok) return std::nullopt;
    return it->second.address;
}

size_t SignatureRegistry::ResolvedCount() const {
    size_t count = 0;
    for (const auto& [name, result] : results_) {
        if (result.ok) ++count;
    }
    return count;
}

size_t SignatureRegistry::RequiredFailureCount() const {
    size_t count = 0;
    for (const SignatureDef& def : definitions_) {
        if (!def.required) continue;
        const auto it = results_.find(def.name);
        if (it == results_.end() || !it->second.ok) ++count;
    }
    return count;
}

void SignatureRegistry::LogReport() const {
    FPCAM_INFO("================ SIGNATURE SCAN REPORT ================");
    FPCAM_INFO("Signature file : {}", sourceFile_);
    FPCAM_INFO("Declared build : {}", gameVersion_);
    FPCAM_INFO("Running build  : {}", RunningGameVersion());
    FPCAM_INFO("-------------------------------------------------------");

    for (const SignatureDef& def : definitions_) {
        const auto it = results_.find(def.name);
        const SignatureResult& result =
            it != results_.end() ? it->second : SignatureResult{};

        std::string chain;
        for (const ResolveStep& step : def.resolve) {
            if (!chain.empty()) chain += " -> ";
            chain += core::ResolveOpName(step.op);
            chain += "(" + std::to_string(step.value);
            if (step.op == ResolveOp::Rip32) {
                chain += ", len=" + std::to_string(step.instructionLength);
            }
            chain += ")";
        }
        if (chain.empty()) chain = "<none>";

        if (result.ok) {
            FPCAM_INFO("  [ OK ] {:<28} {}  via {}{}", def.name,
                       mem::DescribeAddress(result.address), chain,
                       def.verified ? "" : "  (pattern NOT verified)");
        } else {
            const LogLevel level = def.required ? LogLevel::Warn : LogLevel::Info;
            FPCAM_LOG(level, "  [FAIL] {:<28} {}{}", def.name, result.error,
                      def.required ? "  (REQUIRED)" : "  (optional)");
            if (!def.notes.empty()) {
                FPCAM_LOG(level, "         note: {}", def.notes);
            }
        }
    }

    FPCAM_INFO("-------------------------------------------------------");
    FPCAM_INFO("{} of {} resolved; {} required signature(s) missing.",
               ResolvedCount(), definitions_.size(), RequiredFailureCount());
    if (RequiredFailureCount() > 0) {
        FPCAM_WARN("Camera control is DISABLED until the required signatures "
                   "resolve. This is expected on a fresh install: the shipped "
                   "patterns are unverified templates. See docs/SIGNATURES.md "
                   "for how to derive patterns for your game build, or enable "
                   "discovery mode to have the plugin help you find them.");
    }
    FPCAM_INFO("=======================================================");
}

std::string RunningGameVersion() {
    wchar_t exePath[MAX_PATH] = {};
    if (::GetModuleFileNameW(nullptr, exePath, MAX_PATH) == 0) {
        return "<unknown>";
    }

    DWORD ignored = 0;
    const DWORD infoSize = ::GetFileVersionInfoSizeW(exePath, &ignored);
    if (infoSize == 0) return "<unknown>";

    std::vector<uint8_t> buffer(infoSize);
    if (!::GetFileVersionInfoW(exePath, 0, infoSize, buffer.data())) {
        return "<unknown>";
    }

    VS_FIXEDFILEINFO* fixed = nullptr;
    UINT fixedLength = 0;
    if (!::VerQueryValueW(buffer.data(), L"\\",
                          reinterpret_cast<LPVOID*>(&fixed), &fixedLength) ||
        fixed == nullptr) {
        return "<unknown>";
    }

    char text[64] = {};
    ::_snprintf_s(text, sizeof(text), _TRUNCATE, "%u.%u.%u.%u",
                  HIWORD(fixed->dwFileVersionMS), LOWORD(fixed->dwFileVersionMS),
                  HIWORD(fixed->dwFileVersionLS), LOWORD(fixed->dwFileVersionLS));
    return text;
}

}  // namespace fpcam
