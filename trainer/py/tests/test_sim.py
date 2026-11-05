"""The pybind11 module: world loading, episodes, batches, and parity with the JS fixture."""
import json

import numpy as np
import pytest

from terra_trainer.brain import SHAPE, factory_brain, from_flat, is_valid, param_count, shape_of, to_flat
from terra_trainer.sim import ROOT, load_world, task_table, terra_sim

FIXTURE = ROOT / "trainer" / "sim-cpp" / "tests" / "fixtures" / "car-parity.json"


@pytest.fixture(scope="module")
def world():
    return load_world()


def test_world_loads_every_map(world):
    w, docs = world
    assert w.task_count == sum(len(d["tasks"]) for d in docs) == 40
    assert w.param_count == param_count(SHAPE) == 124
    assert w.obs_size == 10
    table = task_table(w, docs)
    assert {r["map"] for r in table} == {"brisbane", "goldcoast", "sydney", "melbourne"}
    assert sum(r["holdout"] for r in table) == 8


def test_brain_flat_round_trip():
    net = factory_brain()
    assert shape_of(net) == SHAPE
    flat = to_flat(net)
    back = from_flat(flat)
    assert is_valid(back)
    assert np.array_equal(to_flat(back), flat)
    with pytest.raises(ValueError):
        from_flat(flat[:-1])
    with pytest.raises(ValueError):
        from_flat(np.full(124, np.nan))


def test_python_path_reproduces_js_episode_scores():
    fx = json.loads(FIXTURE.read_text())
    for wi, doc in enumerate(fx["worlds"]):
        w = terra_sim.World(json.dumps(doc))
        params = np.stack([to_flat(b["network"]) for b in fx["brains"]])
        res = w.run_episodes(params, threads=2)
        for e in fx["episodes"]:
            if e["world"] != wi:
                continue
            assert res["score"][e["brain"], e["task"]] == pytest.approx(e["final"]["score"], abs=1e-9)
            assert res["age"][e["brain"], e["task"]] == e["final"]["age"]


def test_threads_do_not_change_results(world):
    w, _ = world
    rng = np.random.default_rng(3)
    params = to_flat(factory_brain()) + rng.normal(0, 0.1, (12, 124))
    one = w.run_episodes(params, threads=1)
    many = w.run_episodes(params, threads=0)
    for k in ("score", "age", "outcome", "x", "y"):
        assert np.array_equal(one[k], many[k])


def test_episode_outcomes_and_hotspot_fields(world):
    w, _ = world
    res = w.run_episodes(to_flat(factory_brain()), tasks=np.arange(10, dtype=np.int32))
    assert res["score"].shape == (1, 10)
    assert set(np.unique(res["outcome"])) <= {0, 1, 2, 3}
    crashed = res["outcome"] == terra_sim.CRASHED
    assert np.all(res["graph_segment"][crashed] >= 0)


def test_batch_rewards_sum_to_scores_and_actions_match_brains(world):
    w, _ = world
    tasks = np.array([0, 1, 2], dtype=np.int32)
    brain = to_flat(factory_brain())
    expected = w.run_episodes(brain, tasks=tasks)
    b = terra_sim.Batch(w, tasks)
    b.set_brains(brain)
    totals, finished = np.zeros(3), np.zeros(3, bool)
    while not finished.all():
        r, d = b.step()
        totals += np.where(finished, 0, r)
        finished |= d
    assert totals == pytest.approx(expected["score"][0], abs=1e-9)

    # Same brain run in Python on the observations, actions fed back: identical episodes.
    net = from_flat(brain)
    a = terra_sim.Batch(w, tasks)
    acts = np.zeros((3, 4), np.uint8)
    done, ages = np.zeros(3, bool), np.zeros(3, int)
    for _ in range(6000):
        r, d = a.step(actions=acts)
        newly = d & ~done
        for i in np.flatnonzero(newly):
            ages[i] = a.last_episode(int(i))["age"][0, 0]
        done |= d
        if done.all():
            break
        acts = np.stack([forward(net, o) for o in a.observations()]).astype(np.uint8)
    assert np.array_equal(ages, expected["age"][0])


def forward(net, x):
    """Reference forward pass in NumPy (same step rule as network.js)."""
    for l in net["levels"]:
        x = (np.asarray(x) @ np.asarray(l["weights"]) > np.asarray(l["biases"])).astype(float)
    return x


def test_bad_arguments_raise(world):
    w, _ = world
    with pytest.raises(ValueError):
        w.run_episodes(np.zeros((2, 5)))
    with pytest.raises(ValueError):
        w.run_episodes(np.zeros(124), tasks=np.array([999], dtype=np.int32))
    with pytest.raises(ValueError):
        terra_sim.World('{"format": "nope"}')
    b = terra_sim.Batch(w, np.array([0], dtype=np.int32))
    with pytest.raises(RuntimeError):
        b.step()
