# ---------------------------------------------------------------------------
# BG3 First-Person Camera Mod -- root build script
#
#   cmake -S . -B build -G "Visual Studio 17 2022" -A x64
#   cmake --build build --config Release
#
# Two things get built:
#
#   native/  FPCamera.dll, the plugin itself. Windows and MSVC only: it links
#            against DXGI, Direct3D 11, XInput and the Win32 API and is loaded
#            into a Windows game process.
#
#   tests/   The host test suite. Portable, and built on every platform,
#            because the logic worth testing -- the camera-matrix decoder, the
#            signature scanner, the resolve arithmetic, the eye-placement drift
#            guard -- lives in native/src/core/ and has no Windows dependency.
#            The same source files are compiled into both, so the tests
#            exercise exactly what ships.
#
# On a non-Windows host this configures and builds the tests alone, which is a
# useful pre-flight check but proves nothing about the DLL.
# ---------------------------------------------------------------------------
cmake_minimum_required(VERSION 3.21)

project(BG3FPCamera
    VERSION 1.0.0
    DESCRIPTION "First-person camera and movement overhaul for Baldur's Gate 3"
    LANGUAGES CXX)

option(FPCAM_BUILD_TESTS "Build the host test suite." ON)
option(FPCAM_CONSOLE
    "Compile in support for an allocated debug console alongside the log file."
    ON)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Static CRT: the DLL is loaded into a process we do not control, so it must
# not depend on a VC++ redistributable being present on the user's machine.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

include(FetchContent)
set(FETCHCONTENT_QUIET OFF)

# --- nlohmann/json, shared by the plugin and the tests ---------------------
#
# A vendored copy under third_party/ is used when present, so the build works
# with no network. Otherwise it is fetched.
if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/third_party/nlohmann/json.hpp")
    message(STATUS "FPCamera: using the vendored nlohmann/json header.")
    add_library(fpcam_json INTERFACE)
    target_include_directories(fpcam_json INTERFACE
        "${CMAKE_CURRENT_SOURCE_DIR}/third_party")
else()
    set(JSON_BuildTests OFF CACHE INTERNAL "")
    set(JSON_Install OFF CACHE INTERNAL "")
    FetchContent_Declare(nlohmann_json
        GIT_REPOSITORY https://github.com/nlohmann/json.git
        GIT_TAG        v3.11.3
        GIT_SHALLOW    TRUE)
    FetchContent_MakeAvailable(nlohmann_json)
    add_library(fpcam_json INTERFACE)
    target_link_libraries(fpcam_json INTERFACE nlohmann_json::nlohmann_json)
endif()

# --- the portable core, compiled into both the plugin and the tests --------
add_library(fpcam_core STATIC
    native/src/core/ViewMatrix.cpp
    native/src/core/PatternScan.cpp
    native/src/core/ResolveChain.cpp
    native/src/core/EyePlacement.cpp
    native/src/core/MoveIntent.cpp
    native/src/core/KeyNames.cpp)

target_include_directories(fpcam_core PUBLIC native/src)

if(MSVC)
    target_compile_options(fpcam_core PRIVATE /W4 /permissive- /Zc:__cplusplus)
else()
    target_compile_options(fpcam_core PRIVATE -Wall -Wextra)
endif()

# The configuration parser is portable too, but needs JSON.
add_library(fpcam_config STATIC native/src/ConfigParse.cpp)
target_link_libraries(fpcam_config PUBLIC fpcam_core fpcam_json)

if(FPCAM_BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()

if(WIN32)
    if(NOT MSVC)
        message(WARNING
            "FPCamera is developed and shipped with MSVC. Other Windows "
            "toolchains are useful for checking that the code compiles, but "
            "the structured-exception guard in MemoryScanner.cpp degrades to "
            "an unguarded copy outside MSVC -- do not ship such a build.")
    endif()
    if(CMAKE_SIZEOF_VOID_P EQUAL 4)
        message(FATAL_ERROR
            "FPCamera must be built for x64 -- Baldur's Gate 3 is a 64-bit "
            "process and will refuse to load a 32-bit DLL. Re-run cmake with "
            "-A x64.")
    endif()
    add_subdirectory(native)
else()
    message(STATUS
        "FPCamera: non-Windows host -- building the test suite only. "
        "FPCamera.dll requires Windows and MSVC.")
endif()
