# ---------------------------------------------------------------------------
# BG3 First-Person Camera Mod -- root build script
#
# Target toolchain: Visual Studio 2022 (MSVC), x64, C++20.
# Dependencies (MinHook, nlohmann/json) are fetched automatically by
# native/CMakeLists.txt via FetchContent -- nothing to vendor or install.
#
#   cmake -S . -B build -G "Visual Studio 17 2022" -A x64
#   cmake --build build --config Release
#
# The compiled artifact lands in build/native/Release/FPCamera.dll and is
# installed by copying it into "<BG3>/bin/NativeMods/". See INSTALL.md.
# ---------------------------------------------------------------------------
cmake_minimum_required(VERSION 3.21)

project(BG3FPCamera
    VERSION 1.0.0
    DESCRIPTION "First-person camera and movement overhaul for Baldur's Gate 3"
    LANGUAGES CXX)

option(FPCAM_LINT_ONLY
    "Parse the build scripts without defining any Windows-only targets. \
Used to syntax-check CMake on non-Windows hosts; produces no artifacts."
    OFF)

option(FPCAM_CONSOLE
    "Compile in support for an allocated debug console alongside the log file."
    ON)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Static CRT: the DLL is loaded into a process we do not control, so it must
# not depend on a VC++ redistributable being present on the user's machine.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

if(NOT WIN32)
    if(FPCAM_LINT_ONLY)
        message(STATUS "FPCamera: non-Windows host, FPCAM_LINT_ONLY=ON -- targets skipped.")
    else()
        message(FATAL_ERROR
            "FPCamera targets Windows/MSVC only: it links against DXGI, Direct3D 11, "
            "XInput and the Win32 API, and is loaded into a Windows game process. "
            "Configure this on Windows with Visual Studio 2022. To merely syntax-check "
            "the build scripts elsewhere, re-run with -DFPCAM_LINT_ONLY=ON.")
    endif()
endif()

if(WIN32)
    if(NOT MSVC)
        message(WARNING
            "FPCamera is developed and tested against MSVC. Other Windows toolchains "
            "may mis-handle the SEH-guarded memory probes in MemoryScanner.cpp and the "
            "COM vtable layouts assumed by D3D11Hook.cpp.")
    endif()
    if(CMAKE_SIZEOF_VOID_P EQUAL 4)
        message(FATAL_ERROR
            "FPCamera must be built for x64 -- Baldur's Gate 3 is a 64-bit process and "
            "will refuse to load a 32-bit DLL. Re-run cmake with -A x64.")
    endif()

    add_subdirectory(native)
endif()
