// Throughput benchmark: car-steps per second for Bootcamp episodes.
// usage: terra_bench <world.json> [brains=64] [threads=0 (all cores)]
// Brains are the factory brain from the parity fixture plus seeded perturbations, so episodes have
// realistic lengths (some cars arrive, some crash, some stall).
#include <nlohmann/json.hpp>

#include <chrono>
#include <cstdio>
#include <fstream>
#include <random>
#include <sstream>
#include <thread>

#include "sim.hpp"
#include "terra_sim.h"

#ifndef TERRA_FIXTURE
#define TERRA_FIXTURE "tests/fixtures/car-parity.json"
#endif

static std::string slurp(const char* path) {
  std::ifstream in(path);
  std::stringstream ss;
  ss << in.rdbuf();
  return ss.str();
}

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: %s <world.json> [brains] [threads] [fixture]\n", argv[0]);
    return 2;
  }
  const int nBrains = argc > 2 ? std::atoi(argv[2]) : 64;
  const int threads = argc > 3 ? std::atoi(argv[3]) : 0;
  const std::string fixturePath = argc > 4 ? argv[4] : TERRA_FIXTURE;
  char err[256] = {0};
  terra_world* w = terra_create_world(slurp(argv[1]).c_str(), err, sizeof err);
  if (!w) {
    std::fprintf(stderr, "world: %s\n", err);
    return 1;
  }
  const auto fx = nlohmann::json::parse(slurp(fixturePath.c_str()));
  std::vector<double> base;
  for (const auto& l : fx["brains"][0]["network"]["levels"]) {
    for (const auto& row : l["weights"])
      for (const auto& v : row) base.push_back(v.get<double>());
    for (const auto& v : l["biases"]) base.push_back(v.get<double>());
  }
  const int np = terra_param_count(w);
  std::mt19937_64 rng(7);
  std::normal_distribution<double> noise(0, 0.15);
  std::vector<double> params(static_cast<size_t>(np) * nBrains);
  for (int b = 0; b < nBrains; b++)
    for (int i = 0; i < np; i++) params[b * np + i] = base[i] + (b ? noise(rng) : 0);
  std::vector<int32_t> tasks(terra_task_count(w));
  for (size_t i = 0; i < tasks.size(); i++) tasks[i] = static_cast<int32_t>(i);
  std::vector<terra_episode> out(static_cast<size_t>(nBrains) * tasks.size());

  for (const int th : {1, threads}) {
    const auto t0 = std::chrono::steady_clock::now();
    terra_run_episodes(w, params.data(), nBrains, tasks.data(), static_cast<int>(tasks.size()), th, out.data());
    const double secs = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    long steps = 0;
    for (const auto& e : out) steps += e.age;
    const int used = th <= 0 ? static_cast<int>(std::thread::hardware_concurrency()) : th;
    std::printf("{\"threads\": %d, \"episodes\": %zu, \"car_steps\": %ld, \"seconds\": %.4f, \"car_steps_per_sec\": %.0f}\n", used, out.size(),
                steps, secs, steps / secs);
  }
  terra_destroy_world(w);
  return 0;
}
