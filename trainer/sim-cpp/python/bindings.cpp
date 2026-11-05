// pybind11 module `terra_sim`: a thin NumPy layer over the C interface in include/terra_sim.h.
// The GIL is released while C++ simulates, so Python threads (and PyTorch) keep running.
#include <pybind11/numpy.h>
#include <pybind11/pybind11.h>
#include <pybind11/stl.h>

#include <memory>
#include <stdexcept>
#include <string>

#include "terra_sim.h"

namespace py = pybind11;
using F64 = py::array_t<double, py::array::c_style | py::array::forcecast>;
using I32 = py::array_t<int32_t, py::array::c_style | py::array::forcecast>;
using U8 = py::array_t<uint8_t, py::array::c_style | py::array::forcecast>;

namespace {

struct WorldHandle {
  terra_world* ptr = nullptr;
  ~WorldHandle() { terra_destroy_world(ptr); }
};

py::dict episodesToDict(const std::vector<terra_episode>& eps, py::ssize_t rows, py::ssize_t cols) {
  auto f64 = [&](auto get) {
    py::array_t<double> a({rows, cols});
    auto m = a.mutable_unchecked<2>();
    for (py::ssize_t i = 0; i < rows; i++)
      for (py::ssize_t j = 0; j < cols; j++) m(i, j) = get(eps[i * cols + j]);
    return a;
  };
  auto i32 = [&](auto get) {
    py::array_t<int32_t> a({rows, cols});
    auto m = a.mutable_unchecked<2>();
    for (py::ssize_t i = 0; i < rows; i++)
      for (py::ssize_t j = 0; j < cols; j++) m(i, j) = get(eps[i * cols + j]);
    return a;
  };
  py::dict d;
  d["score"] = f64([](const terra_episode& e) { return e.score; });
  d["progress"] = f64([](const terra_episode& e) { return e.progress; });
  d["x"] = f64([](const terra_episode& e) { return e.x; });
  d["y"] = f64([](const terra_episode& e) { return e.y; });
  d["age"] = i32([](const terra_episode& e) { return e.age; });
  d["outcome"] = i32([](const terra_episode& e) { return e.outcome; });
  d["route_index"] = i32([](const terra_episode& e) { return e.route_index; });
  d["graph_segment"] = i32([](const terra_episode& e) { return e.graph_segment; });
  d["task"] = i32([](const terra_episode& e) { return e.task; });
  d["map"] = i32([](const terra_episode& e) { return e.map; });
  return d;
}

class World {
 public:
  explicit World(const std::string& json) : h_(std::make_shared<WorldHandle>()) {
    char err[512] = {0};
    h_->ptr = terra_create_world(json.c_str(), err, sizeof err);
    if (!h_->ptr) throw std::invalid_argument(std::string("terra world: ") + err);
  }

  void append(const std::string& json) {
    char err[512] = {0};
    if (terra_world_append(h_->ptr, json.c_str(), err, sizeof err) != 0) throw std::invalid_argument(std::string("terra world: ") + err);
  }

  int taskCount() const { return terra_task_count(h_->ptr); }
  int paramCount() const { return terra_param_count(h_->ptr); }
  int obsSize() const { return terra_obs_size(h_->ptr); }

  py::list tasks() const {
    py::list out;
    for (int i = 0; i < taskCount(); i++) {
      int32_t holdout = 0, map = 0;
      double len = 0;
      terra_task_info(h_->ptr, i, &holdout, &len, &map);
      py::dict d;
      d["index"] = i;
      d["holdout"] = holdout != 0;
      d["route_length"] = len;
      d["map"] = map;
      out.append(d);
    }
    return out;
  }

  py::dict runEpisodes(F64 params, py::object tasksObj, int threads) const {
    if (params.ndim() == 1) params = params.reshape({py::ssize_t(1), params.shape(0)});
    if (params.ndim() != 2 || params.shape(1) != paramCount())
      throw std::invalid_argument("params must be [brains, " + std::to_string(paramCount()) + "]");
    I32 tasks = tasksObj.is_none() ? allTasks() : I32(tasksObj);
    if (tasks.ndim() != 1 || tasks.shape(0) == 0) throw std::invalid_argument("tasks must be a non-empty 1-D array");
    const int nb = static_cast<int>(params.shape(0)), nt = static_cast<int>(tasks.shape(0));
    std::vector<terra_episode> out(static_cast<size_t>(nb) * nt);
    int rc;
    {
      py::gil_scoped_release release;
      rc = terra_run_episodes(h_->ptr, params.data(), nb, tasks.data(), nt, threads, out.data());
    }
    if (rc != 0) throw std::invalid_argument("run_episodes: bad arguments (task index out of range?)");
    return episodesToDict(out, nb, nt);
  }

  I32 allTasks() const {
    I32 t(taskCount());
    auto m = t.mutable_unchecked<1>();
    for (int i = 0; i < taskCount(); i++) m(i) = i;
    return t;
  }

  std::shared_ptr<WorldHandle> handle() const { return h_; }

 private:
  std::shared_ptr<WorldHandle> h_;
};

class Batch {
 public:
  Batch(const World& world, I32 tasks, int threads) : world_(world.handle()) {
    n_ = static_cast<int>(tasks.size());
    obs_ = terra_obs_size(world_->ptr);
    ptr_ = terra_create_batch(world_->ptr, n_, tasks.data(), threads);
    if (!ptr_) throw std::invalid_argument("batch: bad task indices");
  }
  ~Batch() { terra_destroy(ptr_); }

  int size() const { return n_; }

  void setBrains(F64 params) {
    if (params.ndim() == 1) params = params.reshape({py::ssize_t(1), params.shape(0)});
    if (terra_set_brains(ptr_, params.data(), static_cast<int>(params.shape(0))) != 0)
      throw std::invalid_argument("set_brains: pass 1 brain or one per car, each with param_count values");
  }

  void reset(py::object tasksObj) {
    if (tasksObj.is_none()) {
      terra_reset(ptr_, nullptr);
      return;
    }
    I32 tasks(tasksObj);
    if (tasks.size() != n_ || terra_reset(ptr_, tasks.data()) != 0) throw std::invalid_argument("reset: one valid task per car");
  }

  py::tuple step(int steps, py::object actionsObj) {
    py::array_t<double> rewards(n_);
    py::array_t<uint8_t> dones(n_);
    int rc;
    if (actionsObj.is_none()) {
      py::gil_scoped_release release;
      rc = terra_step_batch(ptr_, steps, nullptr, rewards.mutable_data(), dones.mutable_data());
    } else {
      U8 actions(actionsObj);
      if (actions.size() != static_cast<py::ssize_t>(n_) * 4) throw std::invalid_argument("actions must be [cars, 4]");
      py::gil_scoped_release release;
      rc = terra_step_batch(ptr_, steps, actions.data(), rewards.mutable_data(), dones.mutable_data());
    }
    if (rc == -2) throw std::runtime_error("step: no brains set; pass actions or call set_brains first");
    if (rc != 0) throw std::invalid_argument("step: bad arguments");
    return py::make_tuple(rewards, dones.attr("astype")("bool"));
  }

  py::array_t<double> observations() const {
    py::array_t<double> out({n_, obs_});
    terra_get_observations(ptr_, out.mutable_data());
    return out;
  }

  py::array_t<double> states() const {
    py::array_t<double> out({n_, 6});
    terra_get_states(ptr_, out.mutable_data());
    return out;
  }

  py::dict lastEpisode(int car) const {
    terra_episode e{};
    if (terra_last_episode(ptr_, car, &e) != 0) throw std::out_of_range("car index");
    return episodesToDict({e}, 1, 1);
  }

 private:
  std::shared_ptr<WorldHandle> world_;  // keeps the world alive while the batch exists
  terra_batch* ptr_ = nullptr;
  int n_ = 0, obs_ = 0;
};

}  // namespace

PYBIND11_MODULE(terra_sim, m) {
  m.doc() = "Terra headless car simulation (C++ port of the browser engine's cars, sensors and network).";
  m.attr("STALLED") = TERRA_STALLED;
  m.attr("CRASHED") = TERRA_CRASHED;
  m.attr("ARRIVED") = TERRA_ARRIVED;
  m.attr("OUT_OF_TIME") = TERRA_OUT_OF_TIME;

  py::class_<World>(m, "World")
      .def(py::init<const std::string&>(), py::arg("json"), "Load an exported world document (or a JSON array of them).")
      .def("append", &World::append, py::arg("json"))
      .def_property_readonly("task_count", &World::taskCount)
      .def_property_readonly("param_count", &World::paramCount)
      .def_property_readonly("obs_size", &World::obsSize)
      .def("tasks", &World::tasks)
      .def("run_episodes", &World::runEpisodes, py::arg("params"), py::arg("tasks") = py::none(), py::arg("threads") = 0,
           "Run a full Bootcamp episode for every (brain, task). Returns arrays shaped [brains, tasks].");

  py::class_<Batch>(m, "Batch")
      .def(py::init<const World&, I32, int>(), py::arg("world"), py::arg("tasks"), py::arg("threads") = 0)
      .def_property_readonly("size", &Batch::size)
      .def("set_brains", &Batch::setBrains, py::arg("params"))
      .def("reset", &Batch::reset, py::arg("tasks") = py::none())
      .def("step", &Batch::step, py::arg("steps") = 1, py::arg("actions") = py::none(),
           "Advance frames. Returns (rewards, dones); finished cars restart on their task.")
      .def("observations", &Batch::observations)
      .def("states", &Batch::states)
      .def("last_episode", &Batch::lastEpisode, py::arg("car"));
}
