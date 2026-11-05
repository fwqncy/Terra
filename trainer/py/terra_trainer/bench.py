"""Speed comparison: car-steps per second for the same Bootcamp episodes in C++, Node and Chromium.

The JS runs call the app's own `runEpisode` (web/src/engine/sim/bootcamp.js). Every runtime simulates the
same brains on the same routes; scores are compared so we know the work was identical. Because the C++ sim
matches the JS engine frame for frame, the C++ step count is also the JS step count.

    python -m terra_trainer.bench --map brisbane --brains 32 [--no-browser]
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import subprocess
import tempfile
import time
from pathlib import Path

import numpy as np

from .brain import factory_brain, from_flat, to_flat
from .sim import ROOT, WORLDS_DIR, terra_sim

REALTIME_FPS = 60


def make_brains(n: int, seed: int = 7, sigma: float = 0.05) -> np.ndarray:
    """The factory brain plus seeded perturbations: a realistic mix of arrivals, crashes and stalls."""
    base = to_flat(factory_brain())
    rng = np.random.default_rng(seed)
    params = base + rng.normal(0, sigma, (n, base.size))
    params[0] = base
    return params


def run_js(world_path: Path, brains_path: Path, browser: bool) -> dict:
    cmd = ["node", str(ROOT / "tools" / "bench-js.mjs"), "--world", str(world_path), "--brains", str(brains_path)]
    if browser:
        cmd.append("--browser")
    out = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, check=True, timeout=1800)
    return json.loads(out.stdout.strip().splitlines()[-1])


def bench(map_id: str = "brisbane", n_brains: int = 32, browser: bool = True, seed: int = 7) -> dict:
    world_path = WORLDS_DIR / f"{map_id}.json"
    world = terra_sim.World(world_path.read_text())
    params = make_brains(n_brains, seed)

    runs = []
    steps = None
    reference = None
    for threads in (1, 0):
        world.run_episodes(params[:2], threads=threads)  # warm caches
        t0 = time.perf_counter()
        res = world.run_episodes(params, threads=threads)
        secs = time.perf_counter() - t0
        steps = int(res["age"].sum())
        reference = res["score"]
        runs.append({
            "runtime": f"C++ ({'1 thread' if threads == 1 else f'{os.cpu_count()} threads'})",
            "seconds": secs,
            "car_steps": steps,
        })

    with tempfile.TemporaryDirectory() as tmp:
        brains_path = Path(tmp) / "brains.json"
        brains_path.write_text(json.dumps([from_flat(p) for p in params]))
        for use_browser in (False, True) if browser else (False,):
            r = run_js(world_path, brains_path, use_browser)
            scores = np.asarray(r["scores"])
            max_diff = float(np.abs(scores - reference).max())
            if max_diff > 1e-9:
                raise AssertionError(f"{r['runtime']} disagrees with C++ (max score difference {max_diff})")
            runs.append({"runtime": f"JS · {r['runtime']}", "seconds": r["seconds"], "car_steps": steps, "max_score_diff": max_diff})

    for r in runs:
        r["car_steps_per_sec"] = r["car_steps"] / r["seconds"]
        r["realtime_cars"] = r["car_steps_per_sec"] / REALTIME_FPS
    js_node = next(r for r in runs if r["runtime"].startswith("JS · node"))
    for r in runs:
        r["vs_node"] = r["car_steps_per_sec"] / js_node["car_steps_per_sec"]
    return {
        "map": map_id,
        "brains": n_brains,
        "tasks": world.task_count,
        "episodes": n_brains * world.task_count,
        "car_steps": steps,
        "machine": f"{platform.machine()} · {platform.system()} · {os.cpu_count()} cores",
        "runs": runs,
    }


def table(result: dict) -> str:
    lines = [
        "| Runtime | Car-steps / s | Cars at 60 fps | vs Node |",
        "| --- | ---: | ---: | ---: |",
    ]
    for r in result["runs"]:
        lines.append(f"| {r['runtime']} | {r['car_steps_per_sec']:,.0f} | {r['realtime_cars']:,.0f} | {r['vs_node']:.1f}× |")
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--map", default="brisbane")
    ap.add_argument("--brains", type=int, default=128)
    ap.add_argument("--no-browser", action="store_true", help="skip headless Chromium")
    ap.add_argument("--out", type=Path, default=ROOT / "trainer" / "runs" / "bench.json")
    a = ap.parse_args(argv)
    result = bench(a.map, a.brains, browser=not a.no_browser)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(result, indent=2))
    print(f"{result['episodes']} episodes, {result['car_steps']:,} car-steps on {result['map']} ({result['machine']})")
    print(table(result))


if __name__ == "__main__":
    main()
