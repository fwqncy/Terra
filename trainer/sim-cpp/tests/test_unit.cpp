// Unit tests for the headless sim and its C interface.
#include <cstring>
#include <string>
#include <vector>

#include "check.hpp"
#include "sim.hpp"
#include "terra_sim.h"

using namespace terra;

// A straight 2,000-unit east-bound road, 100 wide: borders at y = -50 and y = +50.
static const char* kStraight = R"({
  "format": "terra-trainer-world", "version": 1, "map": "test", "roadWidth": 100, "gridCell": 300,
  "tasks": [{
    "id": "straight", "start": {"x": 0, "y": 0, "angle": -1.5707963267948966},
    "route": [[0, 0], [1000, 0], [2000, 0]], "routeSegments": [7, 8],
    "borders": [-100, -50, 2100, -50, -100, 50, 2100, 50, -100, -50, -100, 50],
    "holdout": false
  }]
})";

/** A brain whose outputs ignore inputs: biases decide (sum 0 > bias). Output order forward, left, right, reverse. */
static std::vector<double> constantBrain(const std::vector<int>& shape, std::vector<int> outputs) {
  std::vector<double> p(Network::paramCount(shape), 0.0);
  size_t at = 0;
  for (size_t l = 0; l + 1 < shape.size(); l++) {
    at += shape[l] * shape[l + 1];
    const bool last = l + 2 == shape.size();
    for (int j = 0; j < shape[l + 1]; j++) p[at + j] = last ? (outputs[j] ? -1 : 1) : -1;  // hidden layers always fire
    at += shape[l + 1];
  }
  // last level: hidden units are all 1, so the sum is the column of weights; keep them 0 so biases decide
  return p;
}

TEST("getIntersection finds the crossing point and offset") {
  const Hit h = getIntersection({0, 0}, {10, 0}, {5, -5}, {5, 5});
  CHECK(h.hit);
  CHECK_NEAR(h.x, 5, 1e-12);
  CHECK_NEAR(h.offset, 0.5, 1e-12);
  CHECK(!getIntersection({0, 0}, {10, 0}, {0, 1}, {10, 1}).hit);  // parallel
  CHECK(!getIntersection({0, 0}, {4, 0}, {5, -5}, {5, 5}).hit);   // short of the segment
}

TEST("SegmentGrid returns each segment once across cells") {
  SegmentGrid g({{{0, 0}, {900, 0}}, {{100, 100}, {120, 120}}}, 300);
  std::vector<uint32_t> marks;
  uint32_t stamp = 0;
  std::vector<int> out;
  g.query(-10, -10, 1000, 200, marks, stamp, out);
  CHECK(out.size() == 2);
  g.query(500, -10, 520, 10, marks, stamp, out);
  CHECK(out.size() == 1 && out[0] == 0);
  g.query(5000, 5000, 5100, 5100, marks, stamp, out);
  CHECK(out.empty());
}

TEST("Route projects with side and walks arc length") {
  Route r({{0, 0}, {100, 0}, {100, 100}});
  CHECK_NEAR(r.length(), 200, 1e-12);
  const Projection p = r.project({50, 10}, 0, 4);
  CHECK_NEAR(p.progress, 50, 1e-12);
  CHECK_NEAR(p.distance, 10, 1e-12);
  CHECK(p.side == 1);  // y down: below the line is to the right of travel
  CHECK(r.project({50, -10}, 0, 4).side == -1);
  const Vec2 q = r.pointAt(150);
  CHECK_NEAR(q.x, 100, 1e-12);
  CHECK_NEAR(q.y, 50, 1e-12);
  CHECK_NEAR(r.pointAt(-5).x, 0, 0);
  CHECK_NEAR(r.pointAt(500).y, 100, 0);
}

TEST("Network uses the JS step rule: fires only when sum > bias") {
  // 2 -> 4, weights [input][output]
  std::vector<double> p = {1, 0, 0, 0,  // input 0
                           0, 1, 0, 0,  // input 1
                           0.5, 0.5, 0, -0.1};
  Network n = Network::fromFlat({2, 4}, p.data());
  double in[2] = {1, 0.5}, a[8], b[8];
  std::array<int, 4> c{};
  n.feedForward(in, a, b, c);
  CHECK(c[0] == 1);  // 1 > 0.5
  CHECK(c[1] == 0);  // 0.5 > 0.5 is false
  CHECK(c[2] == 0);  // 0 > 0
  CHECK(c[3] == 1);  // 0 > -0.1
  CHECK(Network::paramCount({10, 8, 4}) == 124);
}

TEST("Car physics: accelerate, friction, turn, reverse cap") {
  Car car;
  CarSpec s;
  car.controls = {1, 0, 0, 0};
  car.move(s);
  CHECK_NEAR(car.speed, 0.2 - 0.05, 1e-15);
  CHECK_NEAR(car.y, -0.15, 1e-15);  // angle 0 drives up the screen
  car.controls = {1, 1, 0, 0};
  car.move(s);
  CHECK_NEAR(car.angle, 0.05, 1e-15);
  car = Car{};
  car.controls = {0, 0, 0, 1};
  for (int i = 0; i < 100; i++) car.move(s);
  CHECK_NEAR(car.speed, -s.maxSpeed / 2 + s.friction, 1e-12);
}

TEST("world loader rejects bad documents") {
  bool threw = false;
  try {
    loadWorld(R"({"format":"nope"})");
  } catch (const std::exception&) {
    threw = true;
  }
  CHECK(threw);
  const World w = loadWorld(kStraight);
  CHECK(w.tasks.size() == 1 && w.inputs() == 10);
}

TEST("C API: a full-throttle brain drives the straight road and arrives") {
  char err[256] = {0};
  terra_world* w = terra_create_world(kStraight, err, sizeof err);
  CHECK(w != nullptr);
  CHECK(terra_param_count(w) == 124);
  const auto brain = constantBrain({10, 8, 4}, {1, 0, 0, 0});
  int32_t task = 0;
  terra_episode ep{};
  CHECK(terra_run_episodes(w, brain.data(), 1, &task, 1, 1, &ep) == 0);
  CHECK(ep.outcome == TERRA_ARRIVED);
  CHECK(ep.score > 1.0);
  CHECK(ep.graph_segment == 8);
  // a brain that never accelerates stalls
  const auto idle = constantBrain({10, 8, 4}, {0, 0, 0, 0});
  CHECK(terra_run_episodes(w, idle.data(), 1, &task, 1, 1, &ep) == 0);
  CHECK(ep.outcome == TERRA_STALLED && ep.age == 221);
  // a brain that turns hard left crashes into the north border
  const auto turner = constantBrain({10, 8, 4}, {1, 1, 0, 0});
  CHECK(terra_run_episodes(w, turner.data(), 1, &task, 1, 1, &ep) == 0);
  CHECK(ep.outcome == TERRA_CRASHED);
  terra_destroy_world(w);
  CHECK(terra_create_world("{", err, sizeof err) == nullptr);
  CHECK(std::strlen(err) > 0);
}

TEST("C API: batch rewards sum to the episode score; actions match brains") {
  terra_world* w = terra_create_world(kStraight, nullptr, 0);
  const auto brain = constantBrain({10, 8, 4}, {1, 0, 0, 0});
  int32_t tasks[2] = {0, 0};
  terra_batch* b = terra_create_batch(w, 2, tasks, 1);
  CHECK(terra_step_batch(b, 1, nullptr, nullptr, nullptr) == -2);  // no brains, no actions
  terra_set_brains(b, brain.data(), 1);
  double total = 0;
  uint8_t done[2] = {0, 0};
  double rewards[2];
  terra_episode ep{};
  for (int i = 0; i < 10000 && !done[0]; i++) {
    terra_step_batch(b, 1, nullptr, rewards, done);
    total += rewards[0];
  }
  terra_last_episode(b, 0, &ep);
  CHECK(done[0] == 1 && ep.outcome == TERRA_ARRIVED);
  CHECK_NEAR(total, ep.score, 1e-9);
  // external actions reproduce the brain: the brain decides after each frame, actions apply on the next
  terra_batch* a = terra_create_batch(w, 1, tasks, 1);
  uint8_t act[4] = {1, 0, 0, 0}, d = 0;
  double r = 0;
  // frame 1 moves with no controls in brain mode (the brain has not decided yet)
  uint8_t none[4] = {0, 0, 0, 0};
  terra_step_batch(a, 1, none, &r, &d);
  while (!d) terra_step_batch(a, 1, act, &r, &d);
  terra_episode viaActions{};
  terra_last_episode(a, 0, &viaActions);
  CHECK(viaActions.age == ep.age && viaActions.outcome == ep.outcome);
  double obs[10];
  CHECK(terra_get_observations(a, obs) == 0);
  terra_destroy(a);
  terra_destroy(b);
  terra_destroy_world(w);
}

int main() { return check::run(); }
