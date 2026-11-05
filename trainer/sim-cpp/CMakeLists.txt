cmake_minimum_required(VERSION 3.20)
project(terra_sim VERSION 1.1.0 LANGUAGES CXX)

# Headless C++17 port of the Terra car sim (web/src/engine stays the source of truth).
#   cmake -S trainer/sim-cpp -B trainer/sim-cpp/build -DCMAKE_BUILD_TYPE=Release
#   cmake --build trainer/sim-cpp/build && ctest --test-dir trainer/sim-cpp/build --output-on-failure

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release)
endif()

option(TERRA_BUILD_TESTS "Build unit and JS parity tests" ON)
option(TERRA_BUILD_PYTHON "Build the pybind11 module" OFF)

# Some Command Line Tools installs ship libc++ headers only inside the SDK, where clang does not look.
if(APPLE)
  include(CheckIncludeFileCXX)
  check_include_file_cxx(array TERRA_HAS_LIBCXX)
  if(NOT TERRA_HAS_LIBCXX)
    execute_process(COMMAND xcrun --show-sdk-path OUTPUT_VARIABLE TERRA_SDK OUTPUT_STRIP_TRAILING_WHITESPACE)
    if(EXISTS "${TERRA_SDK}/usr/include/c++/v1/array")
      message(STATUS "libc++ headers missing from the toolchain; using ${TERRA_SDK}/usr/include/c++/v1")
      include_directories(SYSTEM "${TERRA_SDK}/usr/include/c++/v1")
    endif()
  endif()
endif()

# The only third-party dependency: nlohmann/json, pinned.
include(FetchContent)
FetchContent_Declare(nlohmann_json
  URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
  URL_HASH SHA256=d6c65aca6b1ed68e7a182f4757257b107ae403032760ed6ef121c9d55e81757d
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
FetchContent_MakeAvailable(nlohmann_json)

# Parity with the JS engine needs IEEE rounding at every step: no fused multiply-add, no fast-math.
if(MSVC)
  set(TERRA_FP_FLAGS /fp:precise)
else()
  set(TERRA_FP_FLAGS -ffp-contract=off -fno-fast-math)
endif()

add_library(terra_core STATIC src/sim.cpp src/world.cpp src/terra_sim.cpp)
target_include_directories(terra_core PUBLIC include src)
target_link_libraries(terra_core PUBLIC nlohmann_json::nlohmann_json)
target_compile_options(terra_core PUBLIC ${TERRA_FP_FLAGS} $<$<NOT:$<CXX_COMPILER_ID:MSVC>>:-Wall -Wextra>)
find_package(Threads REQUIRED)
target_link_libraries(terra_core PUBLIC Threads::Threads)

# The C interface as a shared library (ctypes, other languages).
add_library(terra_sim SHARED src/sim.cpp src/world.cpp src/terra_sim.cpp)
target_include_directories(terra_sim PUBLIC include PRIVATE src)
target_link_libraries(terra_sim PRIVATE nlohmann_json::nlohmann_json Threads::Threads)
target_compile_options(terra_sim PRIVATE ${TERRA_FP_FLAGS})

if(TERRA_BUILD_TESTS)
  enable_testing()
  add_executable(terra_unit_tests tests/test_unit.cpp)
  target_link_libraries(terra_unit_tests PRIVATE terra_core)
  add_test(NAME unit COMMAND terra_unit_tests)

  add_executable(terra_parity_tests tests/test_parity.cpp)
  target_link_libraries(terra_parity_tests PRIVATE terra_core)
  target_compile_definitions(terra_parity_tests PRIVATE TERRA_FIXTURE="${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures/car-parity.json")
  add_test(NAME js_parity COMMAND terra_parity_tests)

  add_executable(terra_bench tests/bench.cpp)
  target_link_libraries(terra_bench PRIVATE terra_core)
endif()

if(TERRA_BUILD_PYTHON)
  find_package(Python 3.9 COMPONENTS Interpreter Development.Module REQUIRED)
  execute_process(COMMAND "${Python_EXECUTABLE}" -m pybind11 --cmakedir OUTPUT_VARIABLE pybind11_DIR OUTPUT_STRIP_TRAILING_WHITESPACE)
  find_package(pybind11 CONFIG REQUIRED)
  pybind11_add_module(terra_sim_python python/bindings.cpp)
  set_target_properties(terra_sim_python PROPERTIES OUTPUT_NAME terra_sim LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/python")
  target_link_libraries(terra_sim_python PRIVATE terra_core)
endif()
