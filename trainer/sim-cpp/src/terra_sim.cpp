// C interface over the headless sim: parallel whole episodes and frame-stepped batches.
#include "terra_sim.h"

#include <algorithm>
#include <atomic>
#include <cstring>
#include <exception>
#include <thread>

#include "sim.hpp"

using terra::Car;
using terra::Network;
using terra::Scratch;
using terra::World;

struct terra_world {
  World w;
};

struct terra_batch {
  const World* w = nullptr;
  std::vector<Car> cars;
  std::vector<int32_t> tasks;
  std::vector<Network> brains;  // empty, 1 shared, or one per car
  std::vector<terra_episode> last;
  std::vector<Scratch> scratch;  // one per thread
  int threads = 1;
};

namespace {

void writeErr(char* err, size_t len, const char* msg) {
  if (err && len) {
    std::strncpy(err, msg, len - 1);
    err[len - 1] = 0;
  }
}

int resolveThreads(int threads) {
  const int hw = static_cast<int>(std::max(1u, std::thread::hardware_concurrency()));
  return threads <= 0 ? hw : std::min(threads, 256);
}

/** Runs fn(job, threadIndex) for job in [0, n) on up to `threads` threads. */
template <class Fn>
void parallelFor(int n, int threads, Fn fn) {
  threads = std::min(threads, n);
  if (threads <= 1) {
    for (int i = 0; i < n; i++) fn(i, 0);
    return;
  }
  std::atomic<int> next{0};
  std::vector<std::thread> pool;
  for (int t = 0; t < threads; t++) {
    pool.emplace_back([&, t] {
      for (int i = next++; i < n; i = next++) fn(i, t);
    });
  }
  for (auto& th : pool) th.join();
}

terra_episode describe(const Car& car, const World& w, int task) {
  const auto& t = w.tasks[task];
  terra_episode e{};
  e.score = car.score(t);
  e.progress = car.bestProgress;
  e.x = car.x;
  e.y = car.y;
  e.age = car.age;
  e.outcome = car.outcome(w);
  e.route_index = car.lastProj.index;
  e.graph_segment = e.route_index >= 0 && e.route_index < static_cast<int>(t.routeSegments.size()) ? t.routeSegments[e.route_index] : -1;
  e.task = task;
  e.map = t.map;
  return e;
}

bool validTasks(const World& w, const int32_t* tasks, int n) {
  if (!tasks || n <= 0) return false;
  for (int i = 0; i < n; i++)
    if (tasks[i] < 0 || tasks[i] >= static_cast<int>(w.tasks.size())) return false;
  return true;
}

}  // namespace

extern "C" {

terra_world* terra_create_world(const char* json, char* err, size_t err_len) {
  if (!json) {
    writeErr(err, err_len, "json is null");
    return nullptr;
  }
  try {
    auto* world = new terra_world{terra::loadWorld(json)};
    return world;
  } catch (const std::exception& e) {
    writeErr(err, err_len, e.what());
    return nullptr;
  }
}

int terra_world_append(terra_world* world, const char* json, char* err, size_t err_len) {
  if (!world || !json) return -1;
  try {
    terra::appendWorld(world->w, json);
    return 0;
  } catch (const std::exception& e) {
    writeErr(err, err_len, e.what());
    return -2;
  }
}

int terra_task_count(const terra_world* world) { return world ? static_cast<int>(world->w.tasks.size()) : -1; }
int terra_param_count(const terra_world* world) { return world ? Network::paramCount(world->w.shape) : -1; }
int terra_obs_size(const terra_world* world) { return world ? world->w.inputs() : -1; }

int terra_task_info(const terra_world* world, int task, int32_t* holdout, double* route_length, int32_t* map) {
  if (!world || task < 0 || task >= static_cast<int>(world->w.tasks.size())) return -1;
  const auto& t = world->w.tasks[task];
  if (holdout) *holdout = t.holdout ? 1 : 0;
  if (route_length) *route_length = t.route.length();
  if (map) *map = t.map;
  return 0;
}

void terra_destroy_world(terra_world* world) { delete world; }

int terra_run_episodes(const terra_world* world, const double* params, int n_brains, const int32_t* tasks, int n_tasks, int threads,
                       terra_episode* out) {
  if (!world || !params || n_brains <= 0 || !out || !validTasks(world->w, tasks, n_tasks)) return -1;
  const World& w = world->w;
  const int np = Network::paramCount(w.shape);
  std::vector<Network> nets;
  nets.reserve(n_brains);
  for (int b = 0; b < n_brains; b++) nets.push_back(Network::fromFlat(w.shape, params + static_cast<size_t>(b) * np));
  const int nt = resolveThreads(threads);
  std::vector<Scratch> scratch(nt);
  parallelFor(n_brains * n_tasks, nt, [&](int job, int th) {
    const int b = job / n_tasks;
    const int task = tasks[job % n_tasks];
    Car car;
    car.reset(w.tasks[task], w);
    while (car.step(w.tasks[task], w, &nets[b], scratch[th])) {
    }
    out[job] = describe(car, w, task);
  });
  return 0;
}

terra_batch* terra_create_batch(const terra_world* world, int n_cars, const int32_t* tasks, int threads) {
  if (!world || n_cars <= 0 || !validTasks(world->w, tasks, n_cars)) return nullptr;
  auto* b = new terra_batch;
  b->w = &world->w;
  b->tasks.assign(tasks, tasks + n_cars);
  b->cars.resize(n_cars);
  b->last.assign(n_cars, terra_episode{});
  b->threads = resolveThreads(threads);
  b->scratch.resize(b->threads);
  terra_reset(b, nullptr);
  return b;
}

int terra_batch_size(const terra_batch* batch) { return batch ? static_cast<int>(batch->cars.size()) : -1; }

int terra_set_brains(terra_batch* batch, const double* params, int n_brains) {
  if (!batch || !params || (n_brains != 1 && n_brains != static_cast<int>(batch->cars.size()))) return -1;
  const int np = Network::paramCount(batch->w->shape);
  batch->brains.clear();
  for (int i = 0; i < n_brains; i++) batch->brains.push_back(Network::fromFlat(batch->w->shape, params + static_cast<size_t>(i) * np));
  return 0;
}

int terra_reset(terra_batch* batch, const int32_t* tasks) {
  if (!batch) return -1;
  if (tasks) {
    if (!validTasks(*batch->w, tasks, static_cast<int>(batch->cars.size()))) return -1;
    batch->tasks.assign(tasks, tasks + batch->cars.size());
  }
  for (size_t i = 0; i < batch->cars.size(); i++) batch->cars[i].reset(batch->w->tasks[batch->tasks[i]], *batch->w);
  return 0;
}

int terra_step_batch(terra_batch* batch, int steps, const uint8_t* actions, double* rewards, uint8_t* dones) {
  if (!batch || steps <= 0) return -1;
  if (!actions && batch->brains.empty()) return -2;
  const World& w = *batch->w;
  const int n = static_cast<int>(batch->cars.size());
  const int threads = static_cast<long>(n) * steps >= 2048 ? batch->threads : 1;
  const int chunk = (n + threads - 1) / threads;
  parallelFor(threads, threads, [&](int part, int th) {
    for (int i = part * chunk; i < std::min(n, (part + 1) * chunk); i++) {
      Car& car = batch->cars[i];
      const auto& task = w.tasks[batch->tasks[i]];
      const Network* brain = actions ? nullptr : &batch->brains[batch->brains.size() == 1 ? 0 : i];
      double gained = 0;
      bool ended = false;
      for (int s = 0; s < steps && !ended; s++) {
        const double before = car.score(task);
        if (actions)
          for (int k = 0; k < 4; k++) car.controls[k] = actions[i * 4 + k] ? 1 : 0;
        ended = !car.step(task, w, brain, batch->scratch[th]);
        gained += car.score(task) - before;
      }
      if (rewards) rewards[i] = gained;
      if (dones) dones[i] = ended ? 1 : 0;
      if (ended) {
        batch->last[i] = describe(car, w, batch->tasks[i]);
        car.reset(task, w);
      }
    }
  });
  return 0;
}

int terra_get_observations(const terra_batch* batch, double* out) {
  if (!batch || !out) return -1;
  const int k = batch->w->inputs();
  for (size_t i = 0; i < batch->cars.size(); i++) batch->cars[i].observation(out + i * k);
  return 0;
}

int terra_get_states(const terra_batch* batch, double* out) {
  if (!batch || !out) return -1;
  for (size_t i = 0; i < batch->cars.size(); i++) {
    const Car& c = batch->cars[i];
    double* o = out + i * 6;
    o[0] = c.x;
    o[1] = c.y;
    o[2] = c.angle;
    o[3] = c.speed;
    o[4] = c.bestProgress;
    o[5] = c.age;
  }
  return 0;
}

int terra_last_episode(const terra_batch* batch, int car, terra_episode* out) {
  if (!batch || !out || car < 0 || car >= static_cast<int>(batch->cars.size())) return -1;
  *out = batch->last[car];
  return 0;
}

void terra_destroy(terra_batch* batch) { delete batch; }

}  // extern "C"
