# ---------------------------------------------------------------------------
# FPCamera.dll -- the native first-person camera plugin.
#
# Loaded by BG3 Script Extender's native-mod loader from "<BG3>/bin/NativeMods/".
# ---------------------------------------------------------------------------
include(FetchContent)

# MinHook -- the trampoline hooking library used for every function detour.
FetchContent_Declare(minhook
    GIT_REPOSITORY https://github.com/TsudaKageyu/minhook.git
    GIT_TAG        v1.3.3
    GIT_SHALLOW    TRUE)

FetchContent_MakeAvailable(minhook)

# MinHook's own CMakeLists does not export its include directory on the
# `minhook` target, so linking it is not enough to find MinHook.h. Add the
# path explicitly rather than depending on that upstream detail.
if(NOT TARGET minhook)
    message(FATAL_ERROR "MinHook did not provide the expected 'minhook' target.")
endif()
if(NOT EXISTS "${minhook_SOURCE_DIR}/include/MinHook.h")
    message(FATAL_ERROR
        "MinHook.h was not found under ${minhook_SOURCE_DIR}/include. The "
        "MinHook checkout is incomplete or has been reorganised upstream.")
endif()

add_library(FPCamera SHARED
    src/main.cpp
    src/Common.cpp
    src/Logger.cpp
    src/Config.cpp
    src/MemoryScanner.cpp
    src/Signatures.cpp
    src/D3D11Hook.cpp
    src/MatrixProbe.cpp
    src/CameraHook.cpp
    src/InputHook.cpp
    src/XInputSpoof.cpp
    src/Bridge.cpp
    src/SelfTest.cpp)

target_include_directories(FPCamera PRIVATE
    src
    "${minhook_SOURCE_DIR}/include")

target_link_libraries(FPCamera PRIVATE
    minhook
    # fpcam_core and fpcam_config are the same sources the host test suite
    # links, so what is tested is what ships.
    fpcam_core
    fpcam_config
    d3d11
    dxgi
    dxguid
    psapi
    shlwapi
    shell32
    user32
    version
    # SHGetKnownFolderPath's FOLDERID_* GUIDs live in uuid, and the call itself
    # needs the COM allocator from ole32. CMake's default MSVC library set
    # happens to include both, but relying on that is how a link breaks the
    # first time somebody changes generators.
    uuid
    ole32)

target_compile_definitions(FPCamera PRIVATE
    WIN32_LEAN_AND_MEAN
    NOMINMAX
    UNICODE
    _UNICODE
    FPCAM_VERSION="${PROJECT_VERSION}"
    $<$<BOOL:${FPCAM_CONSOLE}>:FPCAM_ENABLE_CONSOLE>)

if(MSVC)
    target_compile_options(FPCamera PRIVATE
        /W4                 # high warning level; we do not use /WX because
                            # MinHook and nlohmann headers emit their own
        /permissive-
        /Zc:__cplusplus
        /MP
        /EHa)               # /EHa: the memory probes rely on SEH interop
    target_link_options(FPCamera PRIVATE /DEBUG /OPT:REF /OPT:ICF)
endif()

# The loader looks for exactly "FPCamera.dll" -- keep the name stable across
# configurations so a Debug build can be dropped in without renaming.
set_target_properties(FPCamera PROPERTIES
    OUTPUT_NAME "FPCamera"
    PREFIX ""
    SUFFIX ".dll")

# Convenience: stage the DLL next to its two JSON files so the whole payload
# can be copied into bin/NativeMods/ in one go.
add_custom_command(TARGET FPCamera POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "$<TARGET_FILE_DIR:FPCamera>/NativeMods"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "$<TARGET_FILE:FPCamera>" "$<TARGET_FILE_DIR:FPCamera>/NativeMods/"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${CMAKE_SOURCE_DIR}/config/FPCamera.json" "$<TARGET_FILE_DIR:FPCamera>/NativeMods/"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${CMAKE_SOURCE_DIR}/config/FPCamera.signatures.json" "$<TARGET_FILE_DIR:FPCamera>/NativeMods/"
    COMMENT "Staging FPCamera.dll + config into $<TARGET_FILE_DIR:FPCamera>/NativeMods")
