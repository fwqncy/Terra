"""Run folders: config, per-generation metrics, evaluation episodes and crash hotspots (CSV for pandas)."""
from __future__ import annotations

import csv
import json
import time
from collections import Counter
from pathlib import Path

import numpy as np

from .sim import ROOT, terra_sim

RUNS_DIR = ROOT / "trainer" / "runs"
OUTCOMES = {terra_sim.STALLED: "stalled", terra_sim.CRASHED: "crashed", terra_sim.ARRIVED: "arrived", terra_sim.OUT_OF_TIME: "out_of_time"}

GENERATION_FIELDS = ["generation", "pop_best", "pop_mean", "train_score", "holdout_score", "train_arrived", "holdout_arrived",
                     "best_train_score", "best_holdout_score", "episodes", "car_steps", "seconds", "wall"]
EPISODE_FIELDS = ["generation", "task", "map", "task_id", "holdout", "outcome", "score", "age", "x", "y", "route_index", "graph_segment"]


class Run:
    def __init__(self, algo: str, config: dict, out: Path | None = None):
        stamp = time.strftime("%Y%m%d-%H%M%S")
        self.dir = (Path(out) if out else RUNS_DIR / f"{stamp}-{algo}").resolve()
        self.dir.mkdir(parents=True, exist_ok=True)
        (self.dir / "config.json").write_text(json.dumps({"algo": algo, **config}, indent=2, default=str))
        self._gen = open(self.dir / "generations.csv", "w", newline="")
        self._gw = csv.DictWriter(self._gen, GENERATION_FIELDS)
        self._gw.writeheader()
        self._eps = open(self.dir / "episodes.csv", "w", newline="")
        self._ew = csv.DictWriter(self._eps, EPISODE_FIELDS)
        self._ew.writeheader()
        self.hotspots: Counter = Counter()
        self.t0 = time.perf_counter()

    def generation(self, row: dict):
        self._gw.writerow({**row, "wall": round(time.perf_counter() - self.t0, 4)})
        self._gen.flush()

    def episodes(self, generation: int, res: dict, tasks: np.ndarray, table: list[dict], row: int = 0):
        """Logs one brain's evaluation episodes (row `row` of a run_episodes result)."""
        for j, t in enumerate(tasks):
            info = table[int(t)]
            self._ew.writerow({
                "generation": generation,
                "task": int(t),
                "map": info["map"],
                "task_id": info["id"],
                "holdout": info["holdout"],
                "outcome": OUTCOMES[int(res["outcome"][row, j])],
                "score": float(res["score"][row, j]),
                "age": int(res["age"][row, j]),
                "x": float(res["x"][row, j]),
                "y": float(res["y"][row, j]),
                "route_index": int(res["route_index"][row, j]),
                "graph_segment": int(res["graph_segment"][row, j]),
            })
        self._eps.flush()

    def count_crashes(self, res: dict, tasks: np.ndarray, table: list[dict]):
        """Accumulates crash sites of a whole population, keyed by (map, graph segment)."""
        crashed = res["outcome"] == terra_sim.CRASHED
        for i, j in zip(*np.nonzero(crashed)):
            self.hotspots[(table[int(tasks[j])]["map"], int(res["graph_segment"][i, j]))] += 1

    def close(self, summary: dict):
        with open(self.dir / "hotspots.csv", "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["map", "graph_segment", "crashes"])
            for (m, seg), n in self.hotspots.most_common():
                w.writerow([m, seg, n])
        (self.dir / "summary.json").write_text(json.dumps(summary, indent=2, default=float))
        self._gen.close()
        self._eps.close()


def centered_ranks(x: np.ndarray) -> np.ndarray:
    """Fitness shaping for ES: ranks mapped to [-0.5, 0.5] (robust to score scale and outliers)."""
    ranks = np.empty(len(x))
    ranks[np.argsort(x, kind="stable")] = np.arange(len(x))
    return ranks / max(1, len(x) - 1) - 0.5
