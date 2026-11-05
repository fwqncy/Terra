"""Smoke runs of the ES / CMA-ES trainer: every output file exists and the exported brain is valid."""
import json

import numpy as np
import pandas as pd
import pytest

from terra_trainer.es import train
from terra_trainer.runs import centered_ranks


def test_centered_ranks():
    r = centered_ranks(np.array([5.0, -1.0, 3.0, 3.0]))
    assert r.min() == -0.5 and r.max() == 0.5 and r[1] == -0.5 and r[0] == 0.5


@pytest.mark.parametrize("algo", ["es", "cmaes"])
def test_smoke_run_writes_a_complete_run_folder(tmp_path, algo):
    run = train(algo=algo, generations=3, population=8, sigma=0.3, maps=["goldcoast"], tasks_per_gen=4, init="factory",
                out=tmp_path / algo, log=lambda *_: None)
    gens = pd.read_csv(run / "generations.csv")
    eps = pd.read_csv(run / "episodes.csv")
    assert list(gens["generation"]) == [1, 2, 3]
    assert len(eps) == 3 * 10 and set(eps["outcome"]) <= {"arrived", "crashed", "stalled", "out_of_time"}
    assert (run / "hotspots.csv").exists()
    summary = json.loads((run / "summary.json").read_text())
    assert summary["js_validation"]["valid"]
    assert summary["js_validation"]["max_score_diff_vs_cpp"] < 1e-9
    # elitism: the exported brain is never worse than the starting (factory) brain on the training routes
    assert summary["best_train_score"] >= summary["start_train_score"]
