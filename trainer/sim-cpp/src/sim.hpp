// Terra headless car simulation: a C++17 port of the browser engine's car, sensors, network and
// route tracking (web/src/engine). The JS engine is the source of truth; every formula here mirrors
// it in the same operation order so results match to floating point (see tests/test_parity.cpp).
// Build with -ffp-contract=off: fused multiply-adds would change the rounding.
#pragma once

#include <array>
#include <cmath>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

namespace terra {

constexpr double PI = 3.14159265358979323846;

struct Vec2 {
  double x = 0, y = 0;
};

struct Seg {
  Vec2 p1, p2;
};

inline double lerp(double a, double b, double t) { return a + (b - a) * t; }

inline double wrapAngle(double a) {
  while (a > PI) a -= 2 * PI;
  while (a < -PI) a += 2 * PI;
  return a;
}

inline double clamp1(double v) { return std::max(-1.0, std::min(1.0, v)); }

/** utils.js getIntersection: segment AB against CD, `offset` is the position along AB (0..1). */
struct Hit {
  bool hit = false;
  double x = 0, y = 0, offset = 0;
};

inline Hit getIntersection(const Vec2& A, const Vec2& B, const Vec2& C, const Vec2& D) {
  const double tTop = (D.x - C.x) * (A.y - C.y) - (D.y - C.y) * (A.x - C.x);
  const double uTop = (C.y - A.y) * (A.x - B.x) - (C.x - A.x) * (A.y - B.y);
  const double bottom = (D.y - C.y) * (B.x - A.x) - (D.x - C.x) * (B.y - A.y);
  if (std::fabs(bottom) > 1e-3) {
    const double t = tTop / bottom;
    const double u = uTop / bottom;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return {true, lerp(A.x, B.x, t), lerp(A.y, B.y, t), t};
  }
  return {};
}

/** segment-grid.js: uniform grid; a query returns each overlapping segment once. Not thread-safe (scratch marks). */
class SegmentGrid {
 public:
  SegmentGrid() = default;
  SegmentGrid(std::vector<Seg> segs, double cell);
  /** Fills `out` with segment ids; `marks`/`stamp` are per-caller scratch so threads can share one grid. */
  void query(double minX, double minY, double maxX, double maxY, std::vector<uint32_t>& marks, uint32_t& stamp, std::vector<int>& out) const;
  const Seg& seg(int id) const { return segs_[id]; }
  size_t size() const { return segs_.size(); }

 private:
  static int64_t key(int64_t cx, int64_t cy) { return (cx << 32) ^ (cy & 0xffffffffLL); }
  double cell_ = 300;
  std::vector<Seg> segs_;
  std::unordered_map<int64_t, std::vector<int>> cells_;
};

/** route.js: polyline with cumulative arc length. */
struct Projection {
  double progress = 0, distance = 0;
  int index = 0;
  double side = 1;  // `proj.side ?? 1`
};

class Route {
 public:
  Route() = default;
  explicit Route(std::vector<Vec2> pts);
  Projection project(const Vec2& p, int hint, int window) const;
  Vec2 pointAt(double s) const;
  double length() const { return length_; }
  const std::vector<Vec2>& points() const { return pts_; }

 private:
  std::vector<Vec2> pts_;
  std::vector<double> cum_;
  double length_ = 0;
};

/** network.js: feed-forward levels with step activation (`sum > bias`). Weights are [input][output]. */
struct Level {
  int in = 0, out = 0;
  std::vector<double> weights;  // in * out, row = input
  std::vector<double> biases;   // out
};

struct Network {
  std::vector<Level> levels;
  /** Flat parameter order shared with the Python trainer: per level, weights row-major then biases. */
  static Network fromFlat(const std::vector<int>& shape, const double* params);
  static int paramCount(const std::vector<int>& shape);
  void feedForward(const double* inputs, double* scratchA, double* scratchB, std::array<int, 4>& controls) const;
};

struct SensorSpec {
  int rayCount = 7;
  double rayLength = 190;
  double raySpread = PI * 0.62;
};

struct CarSpec {
  double width = 30, height = 50, acceleration = 0.2, friction = 0.05, turnRate = 0.05, maxSpeed = 3.2;
};

struct EpisodeSpec {
  double lookahead = 160;
  int stallLimit = 220;
  int maxFrames = 60 * 90;
};

struct Task {
  std::string id;
  Vec2 start;
  double startAngle = 0;
  Route route;
  SegmentGrid grid;
  std::vector<int> routeSegments;  // graph segment under each route polyline segment
  bool holdout = false;
  int map = 0;
};

struct World {
  std::vector<std::string> maps;
  std::vector<Task> tasks;
  double roadWidth = 100;
  SensorSpec sensor;
  CarSpec car;
  EpisodeSpec episode;
  std::vector<int> shape{10, 8, 4};
  int inputs() const { return sensor.rayCount + 3; }
};

/** Parses one exported world document, or an array of them (all must share specs). Throws std::runtime_error. */
World loadWorld(const std::string& json);
void appendWorld(World& world, const std::string& json);

/** Scratch buffers for one thread. */
struct Scratch {
  std::vector<uint32_t> marks;
  uint32_t stamp = 0;
  std::vector<int> ids;
  std::array<double, 64> a{}, b{};
};

enum Outcome : int { Driving = -1, Stalled = 0, Crashed = 1, Arrived = 2, OutOfTime = 3 };

/** car.js + sensor.js for one car. */
struct Car {
  double x = 0, y = 0, angle = 0, speed = 0;
  std::array<int, 4> controls{0, 0, 0, 0};  // forward, left, right, reverse
  bool damaged = false, arrived = false, timedOut = false;
  std::array<double, 3> extras{0, 0, 0};
  std::vector<double> sensors;  // 1 - offset, or 0 when nothing is in range
  std::vector<Vec2> hits;       // ray end or hit point (for debugging/visuals)
  double bestProgress = 0;
  int routeHint = 0, idleFrames = 0, age = 0;
  Projection lastProj;

  bool done() const { return damaged || arrived || timedOut; }
  void reset(const Task& t, const World& w);
  void setTarget(double tx, double ty, double lateral, const CarSpec& spec);
  void move(const CarSpec& spec);
  std::array<Vec2, 4> polygon(const CarSpec& spec) const;
  bool assessDamage(const Task& t, const CarSpec& spec, Scratch& s) const;
  void sense(const Task& t, const SensorSpec& spec, Scratch& s);
  /** car.update(): move, collide, sense, and (when a brain is given) decide the next controls. */
  void update(const Task& t, const World& w, const Network* brain, Scratch& s);
  /** One frame of bootcamp.js runEpisode for this car. Returns false once the episode is over. */
  bool step(const Task& t, const World& w, const Network* brain, Scratch& s);
  Outcome outcome(const World& w) const;
  double score(const Task& t) const;
  /** The 10 network inputs the brain saw last frame: sensors then extras. */
  void observation(double* out) const;
};

}  // namespace terra
