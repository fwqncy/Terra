// Port of web/src/engine: math/segment-grid.js, route.js, ai/network.js, ai/sensor.js, ai/car.js and
// the per-car loop of sim/bootcamp.js runEpisode. Keep operation order identical to the JS.
#include "sim.hpp"

#include <algorithm>
#include <limits>
#include <stdexcept>

namespace terra {

// ---------- SegmentGrid ----------

SegmentGrid::SegmentGrid(std::vector<Seg> segs, double cell) : cell_(cell), segs_(std::move(segs)) {
  for (int id = 0; id < static_cast<int>(segs_.size()); id++) {
    const Seg& s = segs_[id];
    const int64_t x0 = static_cast<int64_t>(std::floor(std::min(s.p1.x, s.p2.x) / cell_));
    const int64_t x1 = static_cast<int64_t>(std::floor(std::max(s.p1.x, s.p2.x) / cell_));
    const int64_t y0 = static_cast<int64_t>(std::floor(std::min(s.p1.y, s.p2.y) / cell_));
    const int64_t y1 = static_cast<int64_t>(std::floor(std::max(s.p1.y, s.p2.y) / cell_));
    for (int64_t cx = x0; cx <= x1; cx++)
      for (int64_t cy = y0; cy <= y1; cy++) cells_[key(cx, cy)].push_back(id);
  }
}

void SegmentGrid::query(double minX, double minY, double maxX, double maxY, std::vector<uint32_t>& marks, uint32_t& stamp,
                        std::vector<int>& out) const {
  out.clear();
  if (marks.size() < segs_.size()) marks.assign(segs_.size(), 0);
  stamp = stamp + 1 ? stamp + 1 : 1;
  if (stamp == 1) std::fill(marks.begin(), marks.end(), 0);
  const int64_t x0 = static_cast<int64_t>(std::floor(minX / cell_)), x1 = static_cast<int64_t>(std::floor(maxX / cell_));
  const int64_t y0 = static_cast<int64_t>(std::floor(minY / cell_)), y1 = static_cast<int64_t>(std::floor(maxY / cell_));
  for (int64_t cx = x0; cx <= x1; cx++) {
    for (int64_t cy = y0; cy <= y1; cy++) {
      const auto it = cells_.find(key(cx, cy));
      if (it == cells_.end()) continue;
      for (const int id : it->second) {
        if (marks[id] != stamp) {
          marks[id] = stamp;
          out.push_back(id);
        }
      }
    }
  }
}

// ---------- Route ----------

Route::Route(std::vector<Vec2> pts) : pts_(std::move(pts)) {
  cum_.push_back(0);
  for (size_t i = 1; i < pts_.size(); i++) cum_.push_back(cum_[i - 1] + std::hypot(pts_[i].x - pts_[i - 1].x, pts_[i].y - pts_[i - 1].y));
  length_ = cum_.back();
}

Projection Route::project(const Vec2& p, int hint, int window) const {
  const int n = static_cast<int>(pts_.size());
  if (n < 2) return {};
  const int from = std::max(0, hint - window);
  const int to = std::min(n - 2, hint + window);
  Projection best;
  best.distance = std::numeric_limits<double>::infinity();
  best.index = from;
  for (int i = from; i <= to; i++) {
    const Vec2& a = pts_[i];
    const Vec2& b = pts_[i + 1];
    const double dx = b.x - a.x;
    const double dy = b.y - a.y;
    double len2 = dx * dx + dy * dy;
    if (len2 == 0) len2 = 1;
    double t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = std::max(0.0, std::min(1.0, t));
    const double px = a.x + dx * t;
    const double py = a.y + dy * t;
    const double d = std::hypot(p.x - px, p.y - py);
    if (d < best.distance) {
      best.side = dx * (p.y - a.y) - dy * (p.x - a.x) > 0 ? 1 : -1;
      best.progress = cum_[i] + std::sqrt(len2) * t;
      best.distance = d;
      best.index = i;
    }
  }
  return best;
}

Vec2 Route::pointAt(double s) const {
  if (s <= 0) return pts_.front();
  if (s >= length_) return pts_.back();
  size_t i = 1;
  while (i < cum_.size() && cum_[i] < s) i++;
  const Vec2& a = pts_[i - 1];
  const Vec2& b = pts_[i];
  double span = cum_[i] - cum_[i - 1];
  if (span == 0) span = 1;
  const double t = (s - cum_[i - 1]) / span;
  return {a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t};
}

// ---------- Network ----------

int Network::paramCount(const std::vector<int>& shape) {
  int n = 0;
  for (size_t l = 0; l + 1 < shape.size(); l++) n += shape[l] * shape[l + 1] + shape[l + 1];
  return n;
}

Network Network::fromFlat(const std::vector<int>& shape, const double* params) {
  Network net;
  for (size_t l = 0; l + 1 < shape.size(); l++) {
    Level lv;
    lv.in = shape[l];
    lv.out = shape[l + 1];
    lv.weights.assign(params, params + lv.in * lv.out);
    params += lv.in * lv.out;
    lv.biases.assign(params, params + lv.out);
    params += lv.out;
    net.levels.push_back(std::move(lv));
  }
  return net;
}

void Network::feedForward(const double* inputs, double* a, double* b, std::array<int, 4>& controls) const {
  const double* in = inputs;
  double* out = a;
  for (size_t l = 0; l < levels.size(); l++) {
    const Level& lv = levels[l];
    for (int i = 0; i < lv.out; i++) {
      double sum = 0;
      for (int j = 0; j < lv.in; j++) sum += in[j] * lv.weights[j * lv.out + i];
      out[i] = sum > lv.biases[i] ? 1 : 0;
    }
    in = out;
    out = out == a ? b : a;
  }
  for (int i = 0; i < 4; i++) controls[i] = in[i] == 1 ? 1 : 0;
}

// ---------- Car ----------

void Car::reset(const Task& t, const World& w) {
  *this = Car{};
  x = t.start.x;
  y = t.start.y;
  angle = t.startAngle;
  sensors.assign(w.sensor.rayCount, 0);
  hits.assign(w.sensor.rayCount, {});
}

void Car::setTarget(double tx, double ty, double lateral, const CarSpec& spec) {
  const double fx = -std::sin(angle);
  const double fy = -std::cos(angle);
  const double vx = tx - x;
  const double vy = ty - y;
  const double rel = std::atan2(fx * vy - fy * vx, fx * vx + fy * vy);
  extras[0] = clamp1(wrapAngle(rel) / (PI / 4));
  extras[1] = speed / spec.maxSpeed;
  extras[2] = clamp1(lateral);
}

void Car::move(const CarSpec& s) {
  if (controls[0]) speed += s.acceleration;
  if (controls[3]) speed -= s.acceleration;
  if (speed > s.maxSpeed) speed = s.maxSpeed;
  if (speed < -s.maxSpeed / 2) speed = -s.maxSpeed / 2;
  if (speed > 0) speed -= s.friction;
  if (speed < 0) speed += s.friction;
  if (std::fabs(speed) < s.friction) speed = 0;
  if (speed != 0) {
    const double flip = speed > 0 ? 1 : -1;
    if (controls[1]) angle += s.turnRate * flip;
    if (controls[2]) angle -= s.turnRate * flip;
  }
  x -= std::sin(angle) * speed;
  y -= std::cos(angle) * speed;
}

std::array<Vec2, 4> Car::polygon(const CarSpec& s) const {
  const double rad = std::hypot(s.width, s.height) / 2;
  const double alpha = std::atan2(s.width, s.height);
  const double a = angle;
  return {{
      {x - std::sin(a - alpha) * rad, y - std::cos(a - alpha) * rad},
      {x - std::sin(a + alpha) * rad, y - std::cos(a + alpha) * rad},
      {x - std::sin(PI + a - alpha) * rad, y - std::cos(PI + a - alpha) * rad},
      {x - std::sin(PI + a + alpha) * rad, y - std::cos(PI + a + alpha) * rad},
  }};
}

bool Car::assessDamage(const Task& t, const CarSpec& spec, Scratch& s) const {
  const auto poly = polygon(spec);
  double minX = poly[0].x, minY = poly[0].y, maxX = poly[0].x, maxY = poly[0].y;
  for (const Vec2& p : poly) {
    minX = std::min(minX, p.x);
    minY = std::min(minY, p.y);
    maxX = std::max(maxX, p.x);
    maxY = std::max(maxY, p.y);
  }
  t.grid.query(minX - 2, minY - 2, maxX + 2, maxY + 2, s.marks, s.stamp, s.ids);
  for (const int id : s.ids) {
    const Seg& seg = t.grid.seg(id);
    for (int i = 0; i < 4; i++)
      if (getIntersection(poly[i], poly[(i + 1) % 4], seg.p1, seg.p2).hit) return true;
  }
  return false;
}

void Car::sense(const Task& t, const SensorSpec& spec, Scratch& s) {
  const int n = spec.rayCount;
  for (int i = 0; i < n; i++) {
    const double rayAngle = lerp(spec.raySpread / 2, -spec.raySpread / 2, n == 1 ? 0.5 : static_cast<double>(i) / (n - 1)) + angle + 0.0;
    const Vec2 a{x, y};
    const Vec2 b{x - std::sin(rayAngle) * spec.rayLength, y - std::cos(rayAngle) * spec.rayLength};
    t.grid.query(std::min(a.x, b.x), std::min(a.y, b.y), std::max(a.x, b.x), std::max(a.y, b.y), s.marks, s.stamp, s.ids);
    Hit best;
    for (const int id : s.ids) {
      const Seg& seg = t.grid.seg(id);
      const Hit h = getIntersection(a, b, seg.p1, seg.p2);
      if (h.hit && (!best.hit || h.offset < best.offset)) best = h;
    }
    sensors[i] = best.hit ? 1 - best.offset : 0;
    hits[i] = best.hit ? Vec2{best.x, best.y} : b;
  }
}

void Car::update(const Task& t, const World& w, const Network* brain, Scratch& s) {
  if (!done()) {
    move(w.car);
    damaged = assessDamage(t, w.car, s);
    age++;
  }
  sense(t, w.sensor, s);
  if (brain && !done()) {
    double in[64];
    observation(in);
    brain->feedForward(in, s.a.data(), s.b.data(), controls);
  }
}

bool Car::step(const Task& t, const World& w, const Network* brain, Scratch& s) {
  if (done()) return false;
  const Projection proj = t.route.project({x, y}, routeHint, 4);
  routeHint = proj.index;
  if (proj.progress > bestProgress + 0.5) {
    bestProgress = proj.progress;
    idleFrames = 0;
  } else {
    idleFrames++;
  }
  const Vec2 target = t.route.pointAt(proj.progress + w.episode.lookahead);
  setTarget(target.x, target.y, (proj.side * proj.distance) / (w.roadWidth / 2), w.car);
  update(t, w, brain, s);
  lastProj = proj;
  if (damaged) return false;
  if (t.route.length() - proj.progress < w.roadWidth * 0.6) {
    arrived = true;
    return false;
  }
  if (idleFrames > w.episode.stallLimit) timedOut = true;
  return !done() && age < w.episode.maxFrames;
}

Outcome Car::outcome(const World& w) const {
  if (arrived) return Arrived;
  if (damaged) return Crashed;
  if (timedOut) return Stalled;
  return age >= w.episode.maxFrames ? OutOfTime : Driving;
}

double Car::score(const Task& t) const {
  return arrived ? 1 + std::max(0.0, 1 - age / 6000.0) * 0.25 : bestProgress / t.route.length();
}

void Car::observation(double* out) const {
  const size_t n = sensors.size();
  for (size_t i = 0; i < n; i++) out[i] = sensors[i];
  for (int i = 0; i < 3; i++) out[n + i] = extras[i];
}

}  // namespace terra
