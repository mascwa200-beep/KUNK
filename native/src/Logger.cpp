#include "Logger.h"

#include <cstdio>

namespace fpcam {

std::mutex Logger::mutex_;
HANDLE Logger::file_ = INVALID_HANDLE_VALUE;
LogLevel Logger::level_ = LogLevel::Info;
bool Logger::consoleAllocated_ = false;

namespace {

const char* LevelTag(LogLevel level) {
    switch (level) {
        case LogLevel::Trace: return "TRACE";
        case LogLevel::Debug: return "DEBUG";
        case LogLevel::Info:  return "INFO ";
        case LogLevel::Warn:  return "WARN ";
        case LogLevel::Error: return "ERROR";
        default:              return "?????";
    }
}

}  // namespace

LogLevel LogLevelFromName(std::string_view name) {
    if (name == "trace") return LogLevel::Trace;
    if (name == "debug") return LogLevel::Debug;
    if (name == "info")  return LogLevel::Info;
    if (name == "warn" || name == "warning") return LogLevel::Warn;
    if (name == "error") return LogLevel::Error;
    if (name == "off" || name == "none") return LogLevel::Off;
    return LogLevel::Info;
}

void Logger::Init(const std::wstring& fileName, LogLevel level, bool console) {
    std::scoped_lock lock(mutex_);

    if (file_ != INVALID_HANDLE_VALUE) {
        ::CloseHandle(file_);
        file_ = INVALID_HANDLE_VALUE;
    }

    level_ = level;

    const std::wstring path = PluginDirectory() + fileName;
    // FILE_SHARE_READ so the user can tail the log while the game runs -- the
    // signature scan report is meant to be read live during a session.
    file_ = ::CreateFileW(path.c_str(), GENERIC_WRITE, FILE_SHARE_READ, nullptr,
                          CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);

    if (file_ != INVALID_HANDLE_VALUE) {
        // UTF-8 BOM, so Notepad renders any non-ASCII path correctly.
        const unsigned char bom[] = {0xEF, 0xBB, 0xBF};
        DWORD written = 0;
        ::WriteFile(file_, bom, sizeof(bom), &written, nullptr);
    }

#ifdef FPCAM_ENABLE_CONSOLE
    if (console && !consoleAllocated_) {
        if (::AllocConsole()) {
            consoleAllocated_ = true;
            FILE* stream = nullptr;
            ::freopen_s(&stream, "CONOUT$", "w", stdout);
            ::SetConsoleTitleW(L"FPCamera");
        }
    }
#else
    (void)console;
#endif
}

void Logger::Shutdown() {
    std::scoped_lock lock(mutex_);
    if (file_ != INVALID_HANDLE_VALUE) {
        ::CloseHandle(file_);
        file_ = INVALID_HANDLE_VALUE;
    }
#ifdef FPCAM_ENABLE_CONSOLE
    if (consoleAllocated_) {
        ::FreeConsole();
        consoleAllocated_ = false;
    }
#endif
}

void Logger::SetLevel(LogLevel level) {
    std::scoped_lock lock(mutex_);
    level_ = level;
}

LogLevel Logger::Level() { return level_; }

void Logger::Write(LogLevel level, std::string_view message) {
    SYSTEMTIME now = {};
    ::GetLocalTime(&now);

    char header[64] = {};
    const int headerLength = ::_snprintf_s(
        header, sizeof(header), _TRUNCATE, "[%02u:%02u:%02u.%03u][%s][%05lu] ",
        static_cast<unsigned>(now.wHour), static_cast<unsigned>(now.wMinute),
        static_cast<unsigned>(now.wSecond),
        static_cast<unsigned>(now.wMilliseconds), LevelTag(level),
        ::GetCurrentThreadId());

    std::string line;
    line.reserve(static_cast<size_t>(headerLength) + message.size() + 2);
    line.append(header, static_cast<size_t>(headerLength < 0 ? 0 : headerLength));
    line.append(message);
    line.append("\r\n");

    std::scoped_lock lock(mutex_);
    if (file_ != INVALID_HANDLE_VALUE) {
        DWORD written = 0;
        ::WriteFile(file_, line.data(), static_cast<DWORD>(line.size()), &written,
                    nullptr);
        // The plugin can be terminated at any moment by a game crash we are
        // trying to diagnose, so never buffer.
        ::FlushFileBuffers(file_);
    }
#ifdef FPCAM_ENABLE_CONSOLE
    if (consoleAllocated_) {
        ::fputs(line.c_str(), stdout);
        ::fflush(stdout);
    }
#endif
    ::OutputDebugStringA(line.c_str());
}

}  // namespace fpcam
