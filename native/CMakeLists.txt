# ---------------------------------------------------------------------------
# FPCamera.dll -- the native first-person camera plugin.
#
# Loaded by BG3 Script Extender's native-mod loader from "<BG3>/bin/NativeMods/".
# ---------------------------------------------------------------------------
include(FetchContent)

set(FETCHCONTENT_QUIET OFF)

# MinHook -- the trampoline hooking library used for every function detour.
FetchContent_Declare(minhook
    GIT_REPOSITORY https://github.com/TsudaKageyu/minhook.git
    GIT_TAG        v1.3.3
    GIT_SHALLOW    TRUE)

# nlohmann/json -- parses FPCamera.json and FPCamera.signatures.json, and
# serialises the Lua bridge files.
set(JSON_BuildTests OFF CACHE INTERNAL "")
set(JSON_Install OFF CACHE INTERNAL "")
FetchContent_Declare(nlohmann_json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG        v3.11.3
    GIT_SHALLOW    TRUE)

FetchContent_MakeAvailable(minhook nlohmann_json)

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
    src/Bridge.cpp)

target_include_directories(FPCamera PRIVATE src)

target_link_libraries(FPCamera PRIVATE
    minhook
    nlohmann_json::nlohmann_json
    d3d11
    dxgi
    dxguid
    psapi
    shlwapi
    shell32
    user32
    version)

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
