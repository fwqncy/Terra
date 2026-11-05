// JS ⇄ C++ parity: replays tests/fixtures/car-parity.json (made by tools/car-parity-fixtures.mjs from the
// browser engine) and checks the C++ sim reproduces sensor readings, network decisions, positions and
// crash/finish events.
#include <nlohmann/json.hpp>

#include <cstdio>
#include <fstream>
#include <sstream>

#include "check.hpp"
#include "sim.hpp"

using namespace terra;
using nlohmann::json;

#ifndef TERRA_FIXTURE
#define TERRA_FIXTURE "tests/fixtures/car-parity.json"
#endif

// Single steps start from the same state, so they must agree to rounding.
constexpr double STEP_TOL = 1e-9;
// Episodes compound rounding over hundreds of frames (sin/cos may differ by an ulp between libms).
constexpr double EPISODE_TOL = 1e-6;

namespace {

const json& fixture() {
  static json f = [] {
    std::ifstream in(TERRA_FIXTURE);
    if (!in) {
      std::fprintf(stderr, "missing fixture %s (run node tools/car-parity-fixtures.mjs)\n", TERRA_FIXTURE);
      std::exit(2);
    }
    std::stringstream ss;
    ss << in.rdbuf();
    return json::parse(ss.str());
  }();
  return f;
}

const std::vector<World>& worlds() {
  static std::vector<World> w = [] {
    std::vector<World> out;
    for (const auto& doc : fixture()["worlds"]) out.push_back(loadWorld(doc.dump()));
    return out;
  }();
  return w;
}

/** JS brain JSON ({levels:[{weights[i][j], biases}]}) to the flat order. */
Network brain(int i) {
  const auto& levels = fixture()["brains"][i]["network"]["levels"];
  std::vector<int> shape{static_cast<int>(levels[0]["weights"].size())};
  std::vector<double> flat;
  for (const auto& l : levels) {
    shape.push_back(static_cast<int>(l["biases"].size()));
    for (const auto& row : l["weights"])
      for (const auto& v : row) flat.push_back(v.get<double>());
    for (const auto& v : l["biases"]) flat.push_back(v.get<double>());
  }
  return Network::fromFlat(shape, flat.data());
}

struct Diff {
  double max = 0;
  void add(double a, double b) { max = std::max(max, std::fabs(a - b)); }
};

/** Compares a car with one recorded JS frame; returns the largest numeric difference, or 1e9 on a discrete mismatch. */
double compare(const Car& car, const json& f) {
  Diff d;
  d.add(car.x, f["x"]);
  d.add(car.y, f["y"]);
  d.add(car.angle, f["angle"]);
  d.add(car.speed, f["speed"]);
  d.add(car.lastProj.progress, f["progress"]);
  for (size_t i = 0; i < car.sensors.size(); i++) d.add(car.sensors[i], f["sensors"][i]);
  for (int i = 0; i < 3; i++) d.add(car.extras[i], f["extras"][i]);
  for (int i = 0; i < 4; i++)
    if (car.controls[i] != f["controls"][i].get<int>()) return 1e9;
  if (car.damaged != f["damaged"].get<bool>()) return 1e9;
  return d.max;
}

}  // namespace

TEST("single steps match the JS engine to rounding") {
  const World& w = worlds()[0];
  double worst = 0;
  int n = 0;
  for (const auto& s : fixture()["steps"]) {
    const Task& task = w.tasks[s["task"].get<int>()];
    const Network net = brain(s["brain"]);
    const auto& pre = s["pre"];
    Car car;
    car.reset(task, w);
    car.x = pre["x"];
    car.y = pre["y"];
    car.angle = pre["angle"];
    car.speed = pre["speed"];
    for (int k = 0; k < 4; k++) car.controls[k] = pre["controls"][k].get<int>();
    const int pts = static_cast<int>(task.route.points().size());
    const Projection proj = task.route.project({car.x, car.y}, pts / 2, pts);
    CHECK_NEAR(proj.progress, s["projection"]["progress"].get<double>(), STEP_TOL);
    CHECK_NEAR(proj.distance, s["projection"]["distance"].get<double>(), STEP_TOL);
    CHECK(proj.index == s["projection"]["index"].get<int>());
    const Vec2 t = task.route.pointAt(proj.progress + w.episode.lookahead);
    CHECK_NEAR(t.x, s["target"][0].get<double>(), STEP_TOL);
    car.setTarget(t.x, t.y, (proj.side * proj.distance) / (w.roadWidth / 2), w.car);
    Scratch scratch;
    car.update(task, w, &net, scratch);
    car.lastProj = proj;
    const double d = compare(car, s["post"]);
    CHECK(d <= STEP_TOL);
    worst = std::max(worst, d);
    n++;
  }
  std::printf("    %d steps, worst difference %.3g\n", n, worst);
}

TEST("episodes match the JS engine frame by frame, with the same ending") {
  const auto& f = fixture();
  const size_t record = f["recordFrames"].get<size_t>();
  double worst = 0;
  int n = 0;
  for (const auto& e : f["episodes"]) {
    const World& w = worlds()[e["world"].get<int>()];
    const Task& task = w.tasks[e["task"].get<int>()];
    const Network net = brain(e["brain"]);
    const auto& frames = e["frames"];
    Car car;
    car.reset(task, w);
    Scratch scratch;
    size_t k = 0;
    int firstBad = -1;
    double epWorst = 0;
    bool more = true;
    while (more) {
      more = car.step(task, w, &net, scratch);
      if ((more && k < record) || (!more && k < frames.size())) {
        const double d = compare(car, frames[k]);
        epWorst = std::max(epWorst, d);
        if (d > EPISODE_TOL && firstBad < 0) firstBad = static_cast<int>(k);
        k++;
      }
    }
    const auto& fin = e["final"];
    const std::string label = task.id + " / " + f["brains"][e["brain"].get<int>()]["name"].get<std::string>();
    if (firstBad >= 0) std::printf("    %s first diverges at frame %d\n", label.c_str(), firstBad + 1);
    CHECK(firstBad < 0);
    CHECK(k == frames.size());
    CHECK(car.age == fin["age"].get<int>());
    CHECK(car.damaged == fin["damaged"].get<bool>());
    CHECK(car.arrived == fin["arrived"].get<bool>());
    CHECK(car.timedOut == fin["timedOut"].get<bool>());
    CHECK_NEAR(car.bestProgress, fin["bestProgress"].get<double>(), EPISODE_TOL);
    CHECK_NEAR(car.score(task), fin["score"].get<double>(), 1e-9);
    worst = std::max(worst, epWorst);
    n++;
  }
  std::printf("    %d episodes, worst per-frame difference %.3g\n", n, worst);
}

int main() { return check::run(); }
