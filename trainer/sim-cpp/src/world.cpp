// Loads worlds exported by tools/export-trainer-worlds.mjs (format "terra-trainer-world", version 1).
#include <nlohmann/json.hpp>

#include <stdexcept>

#include "sim.hpp"

namespace terra {

using nlohmann::json;

namespace {

std::vector<Seg> segsFrom(const json& flat) {
  if (flat.size() % 4) throw std::runtime_error("borders must hold x1,y1,x2,y2 groups");
  std::vector<Seg> segs;
  segs.reserve(flat.size() / 4);
  for (size_t i = 0; i < flat.size(); i += 4)
    segs.push_back({{flat[i].get<double>(), flat[i + 1].get<double>()}, {flat[i + 2].get<double>(), flat[i + 3].get<double>()}});
  return segs;
}

void appendDoc(World& w, const json& doc, bool first) {
  if (doc.value("format", "") != "terra-trainer-world" || doc.value("version", 0) != 1)
    throw std::runtime_error("not a terra-trainer-world v1 document");
  const double roadWidth = doc.value("roadWidth", 100.0);
  if (first) {
    w.roadWidth = roadWidth;
    if (doc.contains("sensor")) {
      const auto& s = doc["sensor"];
      w.sensor.rayCount = s.value("rayCount", 7);
      w.sensor.rayLength = s.value("rayLength", 190.0);
      w.sensor.raySpread = s.value("raySpread", PI * 0.62);
    }
    if (doc.contains("car")) {
      const auto& c = doc["car"];
      w.car.width = c.value("width", 30.0);
      w.car.height = c.value("height", 50.0);
      w.car.acceleration = c.value("acceleration", 0.2);
      w.car.friction = c.value("friction", 0.05);
      w.car.turnRate = c.value("turnRate", 0.05);
      w.car.maxSpeed = c.value("maxSpeed", 3.2);
    }
    if (doc.contains("episode")) {
      const auto& e = doc["episode"];
      w.episode.lookahead = e.value("lookahead", 160.0);
      w.episode.stallLimit = e.value("stallLimit", 220);
      w.episode.maxFrames = e.value("maxFrames", 5400);
    }
    if (doc.contains("network")) w.shape = doc["network"].get<std::vector<int>>();
    if (w.sensor.rayCount < 1 || w.sensor.rayCount > 32) throw std::runtime_error("rayCount must be 1..32");
    if (w.shape.size() < 2 || w.shape.front() != w.inputs() || w.shape.back() != 4)
      throw std::runtime_error("network shape must start with rayCount + 3 inputs and end with 4 outputs");
    for (int n : w.shape)
      if (n < 1 || n > 64) throw std::runtime_error("network layers must have 1..64 neurons");
  } else if (roadWidth != w.roadWidth) {
    throw std::runtime_error("all worlds in one batch must share roadWidth");
  }
  const double cell = doc.value("gridCell", 300.0);
  const int mapIndex = static_cast<int>(w.maps.size());
  w.maps.push_back(doc.value("map", "map"));
  for (const auto& t : doc.at("tasks")) {
    Task task;
    task.id = t.at("id").get<std::string>();
    task.start = {t.at("start").at("x").get<double>(), t.at("start").at("y").get<double>()};
    task.startAngle = t.at("start").at("angle").get<double>();
    std::vector<Vec2> pts;
    for (const auto& p : t.at("route")) pts.push_back({p.at(0).get<double>(), p.at(1).get<double>()});
    if (pts.size() < 2) throw std::runtime_error("task " + task.id + " needs a route of 2+ points");
    task.route = Route(std::move(pts));
    task.grid = SegmentGrid(segsFrom(t.at("borders")), cell);
    if (t.contains("routeSegments")) task.routeSegments = t["routeSegments"].get<std::vector<int>>();
    task.holdout = t.value("holdout", false);
    task.map = mapIndex;
    w.tasks.push_back(std::move(task));
  }
}

}  // namespace

World loadWorld(const std::string& text) {
  World w;
  appendWorld(w, text);
  return w;
}

void appendWorld(World& w, const std::string& text) {
  const json doc = json::parse(text);
  if (doc.is_array()) {
    for (const auto& d : doc) appendDoc(w, d, w.maps.empty());
  } else {
    appendDoc(w, doc, w.maps.empty());
  }
  if (w.tasks.empty()) throw std::runtime_error("world has no tasks");
}

}  // namespace terra
