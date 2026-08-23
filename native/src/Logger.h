// Logger.h -- timestamped, level-filtered logging to a file and, optionally, a
// console allocated for the game process.
//
// Logging is the only diagnostic channel this plugin has: it runs inside a
// shipped game with no debugger attached, and the signature scan report in
// particular is the user's primary tool for adapting the mod to a new patch.
// Every call is safe from any thread, including the D3D11 render thread.
#pragma once

#include "Common.h"

#include <format>
#include <mutex>

namespace fpcam {

enum class LogLevel : int {
    Trace = 0,
    Debug = 1,
    Info  = 2,
    Warn  = 3,
    Error = 4,
    Off   = 5,
};

LogLevel LogLevelFromName(std::string_view name);

class Logger {
public:
    // Opens <plugin dir>/<fileName>, truncating any previous run's log.
    // Safe to call more than once; a re-init reopens the file, which is how
    // the reload-config hotkey applies a changed log path.
    static void Init(const std::wstring& fileName, LogLevel level, bool console);
    static void Shutdown();

    static void SetLevel(LogLevel level);
    static LogLevel Level();

    // Writes one already-formatted line. Prefer the FPCAM_LOG_* macros.
    static void Write(LogLevel level, std::string_view message);

private:
    static std::mutex mutex_;
    static HANDLE file_;
    static LogLevel level_;
    static bool consoleAllocated_;
};

// Formatting happens only when the level passes, so trace-level logging in the
// per-frame path costs a single integer comparison when disabled.
#define FPCAM_LOG(lvl, ...)                                              \
    do {                                                                 \
        if (static_cast<int>(lvl) >= static_cast<int>(                   \
                ::fpcam::Logger::Level())) {                             \
            ::fpcam::Logger::Write((lvl), std::format(__VA_ARGS__));     \
        }                                                                \
    } while (false)

#define FPCAM_TRACE(...) FPCAM_LOG(::fpcam::LogLevel::Trace, __VA_ARGS__)
#define FPCAM_DEBUG(...) FPCAM_LOG(::fpcam::LogLevel::Debug, __VA_ARGS__)
#define FPCAM_INFO(...)  FPCAM_LOG(::fpcam::LogLevel::Info,  __VA_ARGS__)
#define FPCAM_WARN(...)  FPCAM_LOG(::fpcam::LogLevel::Warn,  __VA_ARGS__)
#define FPCAM_ERROR(...) FPCAM_LOG(::fpcam::LogLevel::Error, __VA_ARGS__)

}  // namespace fpcam
