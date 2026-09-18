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
    # C as well as C++: MinHook is a C library and is compiled from
    # source here, because upstream ships no CMake support.
    LANGUAGES CXX C)

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

# --- default configs, embedded into the DLL --------------------------------
#
# The plugin writes FPCamera.json and FPCamera.signatures.json next to itself
# when they are absent, so installing is a single-file drop. The contents are
# generated from the files in config/ rather than pasted into a header, because
# a pasted copy is a second source of truth and drifts the first time either
# side is edited.
set(FPCAM_CONFIG_JSON     "${CMAKE_CURRENT_SOURCE_DIR}/config/FPCamera.json")
set(FPCAM_SIGNATURES_JSON "${CMAKE_CURRENT_SOURCE_DIR}/config/FPCamera.signatures.json")

foreach(_required "${FPCAM_CONFIG_JSON}" "${FPCAM_SIGNATURES_JSON}")
    if(NOT EXISTS "${_required}")
        message(FATAL_ERROR "Missing shipped config file: ${_required}")
    endif()
endforeach()

file(READ "${FPCAM_CONFIG_JSON}"     FPCAM_DEFAULT_CONFIG)
file(READ "${FPCAM_SIGNATURES_JSON}" FPCAM_DEFAULT_SIGNATURES)

# The generated header wraps both in a raw string literal. If the terminator
# ever appears inside the content the file silently stops compiling in a
# baffling way, so check for it here and say exactly what happened.
foreach(_content "${FPCAM_DEFAULT_CONFIG}" "${FPCAM_DEFAULT_SIGNATURES}")
    string(FIND "${_content}" ")FPCAMDEFAULT\"" _delimiter_hit)
    if(NOT _delimiter_hit EQUAL -1)
        message(FATAL_ERROR
            "A config file contains the raw-string terminator )FPCAMDEFAULT\" "
            "used by native/src/DefaultConfig.h.in. Change the delimiter there.")
    endif()
endforeach()

configure_file(
    "${CMAKE_CURRENT_SOURCE_DIR}/native/src/DefaultConfig.h.in"
    "${CMAKE_BINARY_DIR}/generated/DefaultConfig.h"
    @ONLY)

# Editing either JSON must re-run the generation above.
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS
    "${FPCAM_CONFIG_JSON}" "${FPCAM_SIGNATURES_JSON}")

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
target_include_directories(fpcam_config PUBLIC "${CMAKE_BINARY_DIR}/generated")

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
