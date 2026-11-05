"""PPO smoke run, the straight-through step, and the pandas report over a mix of runs."""
import json
import subprocess

import numpy as np
import pandas as pd
import torch

from terra_trainer.analyze import compare, load_runs, report
from terra_trainer.brain import factory_brain, to_flat
from terra_trainer.es import train as train_es
from terra_trainer.net import StepNet, StepSTE
from terra_trainer.ppo import Policy, train as train_ppo
from terra_trainer.sim import ROOT


def test_straight_through_step_is_exact_forward_and_sigmoid_backward():
    z = torch.tensor([-2.0, -0.1, 0.0, 0.3, 4.0], dtype=torch.float64, requires_grad=True)
    y = StepSTE.apply(z)
    assert y.tolist() == [0, 0, 0, 1, 1]  # `sum > bias` is strict, like network.js
    y.sum().backward()
    s = torch.sigmoid(z.detach())
    assert torch.allclose(z.grad, s * (1 - s))


def test_ppo_policy_mode_is_the_browser_brain():
    flat = to_flat(factory_brain())
    policy = Policy(flat)
    assert np.array_equal(policy.flat(), flat)
    x = torch.rand(256, 10, dtype=torch.float64)
    with torch.no_grad():
        most_likely = policy.dist(x).probs > 0.5
        hard = StepNet.from_flat(flat)(x) > 0.5
    assert torch.equal(most_likely, hard)


def test_ppo_smoke_run_exports_a_valid_brain(tmp_path):
    run = train_ppo(seconds=600, max_updates=2, cars=32, horizon=16, maps=["goldcoast"], out=tmp_path / "ppo", log=lambda *_: None)
    summary = json.loads((run / "summary.json").read_text())
    assert summary["updates"] == 2 and summary["js_validation"]["valid"]
    gens = pd.read_csv(run / "generations.csv")
    assert list(gens["generation"]) == [1, 2]


def test_report_compares_ga_es_and_ppo(tmp_path):
    runs = tmp_path / "runs"
    train_es(algo="cmaes", generations=3, population=8, maps=["goldcoast"], tasks_per_gen=4, out=runs / "cmaes", validate=False, log=lambda *_: None)
    train_ppo(seconds=600, max_updates=2, cars=32, horizon=16, maps=["goldcoast"], out=runs / "ppo", validate=False, log=lambda *_: None)
    subprocess.run(["node", str(ROOT / "tools" / "ga-baseline.mjs"), "--generations", "2", "--population", "6", "--out", str(runs / "ga")],
                   cwd=ROOT, check=True, capture_output=True, timeout=600)
    df = load_runs([runs])
    assert set(df["algo"]) == {"cmaes", "ppo", "browser-ga"}
    cmp = compare(df)
    assert set(cmp["algo"]) == {"cmaes", "ppo", "browser-ga"} and (cmp["seeds"] == 1).all()
    summary = report([runs], tmp_path / "report", bench=tmp_path / "missing.json")
    text = summary.read_text()
    assert "## Algorithms compared" in text and "## Crash hotspots by road segment" in text
    for png in ("learning-curves.png", "wallclock.png", "crash-hotspots.png", "crash-maps.png"):
        assert (tmp_path / "report" / png).stat().st_size > 10_000
