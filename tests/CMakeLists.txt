# The host test suite. Portable by construction: it links only against
# fpcam_core and fpcam_config, which contain no Windows headers.
add_executable(fpcam_tests
    main.cpp
    test_viewmatrix.cpp
    test_patternscan.cpp
    test_resolvechain.cpp
    test_eyeplacement.cpp
    test_angles.cpp
    test_moveintent.cpp
    test_config.cpp
    test_defaults.cpp)

target_include_directories(fpcam_tests PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}"
    "${CMAKE_SOURCE_DIR}/native/src")

target_link_libraries(fpcam_tests PRIVATE fpcam_core fpcam_config)

if(MSVC)
    target_compile_options(fpcam_tests PRIVATE /W4 /permissive- /Zc:__cplusplus)
    # The fuzz cases run hundreds of thousands of iterations; an unoptimised
    # debug build of them is needlessly slow in CI.
    target_compile_options(fpcam_tests PRIVATE $<$<CONFIG:Debug>:/Od>)
else()
    target_compile_options(fpcam_tests PRIVATE -Wall -Wextra)
endif()

add_test(NAME fpcam_tests COMMAND fpcam_tests)
