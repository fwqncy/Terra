"""Evolution strategies for City Lab brains, evaluated in parallel in the C++ sim.

OpenAI-ES (Salimans et al. 2017): mirrored Gaussian perturbations of the flat brain, centred-rank fitness
shaping, and an Adam step on the PyTorch parameter vector. `--algo cmaes` uses CMA-ES (pycma) instead.
Fitness is the Bootcamp score (route progress, or 1 + time bonus on arrival) averaged over the training
routes of every map; held-out routes are only ever evaluated, never trained on.

    python -m terra_trainer.es                                   # CMA-ES from a random brain
    python -m terra_trainer.es --algo es --init factory --sigma 0.1 --lr 0.02   # fine-tune the factory brain
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch

from .brain import SHAPE, factory_brain, load_brain_file, param_count, to_flat
from .export import brain_document, validate_with_js, write_brain
from .net import StepNet
from .runs import Run, centered_ranks
from .sim import MAPS, WORLDS_DIR, load_world, task_table, terra_sim


def initial_params(init: str, rng: np.random.Generator) -> np.ndarray:
    if init == "factory":
        return to_flat(factory_brain())
    if init == "random":
        # Same distribution as a fresh browser brain: uniform in [-1, 1]
        return rng.uniform(-1, 1, param_count(SHAPE))
    return to_flat(load_brain_file(Path(init)))


def train(algo: str = "cmaes", generations: int = 150, population: int = 64, sigma: float = 0.5, lr: float = 0.03,
          tasks_per_gen: int = 0, init: str = "random", seed: int = 0, threads: int = 0, maps=MAPS, out: Path | None = None,
          weight_decay: float = 0.0, validate: bool = True, log=print) -> Path:
    rng = np.random.default_rng(seed)
    torch.manual_seed(seed)
    world, docs = load_world(maps)
    table = task_table(world, docs)
    train_ids = np.array([r["task"] for r in table if not r["holdout"]], np.int32)
    hold_ids = np.array([r["task"] for r in table if r["holdout"]], np.int32)
    all_ids = np.concatenate([train_ids, hold_ids])
    n_train = len(train_ids)
    population += population % 2  # mirrored pairs

    config = dict(generations=generations, population=population, sigma=sigma, lr=lr, tasks_per_gen=tasks_per_gen or n_train,
                  init=init, seed=seed, maps=list(maps), train_tasks=n_train, holdout_tasks=len(hold_ids),
                  shape=list(SHAPE), params=param_count(SHAPE), weight_decay=weight_decay)
    run = Run(algo, config, out)
    theta0 = initial_params(init, rng)

    # The search distribution's centre lives in PyTorch; StepNet shows it is the browser network.
    net = StepNet.from_flat(theta0)
    theta = torch.nn.Parameter(net.to_flat().clone())
    opt = torch.optim.Adam([theta], lr=lr)
    cma_es = None
    if algo == "cmaes":
        import cma

        cma_es = cma.CMAEvolutionStrategy(theta0, sigma, {"popsize": population, "seed": seed + 1, "verbose": -9})

    def evaluate(params):
        res = world.run_episodes(params, tasks=all_ids, threads=threads)
        return res, res["score"][:, :n_train].mean(1), res["score"][:, n_train:].mean(1) if len(hold_ids) else np.zeros(len(res["score"]))

    best = {"train": -np.inf, "holdout": 0.0, "params": theta0, "generation": -1}
    res0, tr0, ho0 = evaluate(theta0)
    best.update(train=float(tr0[0]), holdout=float(ho0[0]), generation=0)
    log(f"start ({init}): train {tr0[0]:.3f}, holdout {ho0[0]:.3f}")
    total_steps = 0

    for g in range(1, generations + 1):
        t0 = time.perf_counter()
        batch = train_ids if not tasks_per_gen or tasks_per_gen >= n_train else rng.choice(train_ids, tasks_per_gen, replace=False)
        if cma_es is None:
            half = rng.standard_normal((population // 2, theta.numel()))
            eps = np.concatenate([half, -half])
            pop = theta.detach().numpy() + sigma * eps
        else:
            pop = np.asarray(cma_es.ask())
        res = world.run_episodes(pop, tasks=batch, threads=threads)
        fit = res["score"].mean(1)
        run.count_crashes(res, batch, table)
        steps = int(res["age"].sum())

        if cma_es is None:
            grad = centered_ranks(fit) @ eps / (population * sigma)
            opt.zero_grad()
            # Adam minimises: ascend the fitness gradient, with optional decay towards 0
            theta.grad = torch.from_numpy(-grad) + weight_decay * theta.detach()
            opt.step()
            centre = theta.detach().numpy().copy()
        else:
            cma_es.tell(list(pop), list(-fit))
            centre = np.asarray(cma_es.mean)

        # Elitism for export: score the new centre and this generation's champion on every route.
        champion = pop[int(np.argmax(fit))]
        ev, tr, ho = evaluate(np.stack([centre, champion]))
        steps += int(ev["age"].sum())
        total_steps += steps
        k = int(np.argmax(tr))
        if tr[k] > best["train"]:
            best.update(train=float(tr[k]), holdout=float(ho[k]), params=(centre, champion)[k].copy(), generation=g)
        run.episodes(g, ev, all_ids, table, row=0)
        arrived = ev["outcome"][0] == terra_sim.ARRIVED
        row = {
            "generation": g,
            "pop_best": float(fit.max()),
            "pop_mean": float(fit.mean()),
            "train_score": float(tr[0]),
            "holdout_score": float(ho[0]),
            "train_arrived": int(arrived[:n_train].sum()),
            "holdout_arrived": int(arrived[n_train:].sum()),
            "best_train_score": best["train"],
            "best_holdout_score": best["holdout"],
            "episodes": int(res["score"].size + ev["score"].size),
            "car_steps": steps,
            "seconds": round(time.perf_counter() - t0, 4),
        }
        run.generation(row)
        if g == 1 or g % max(1, generations // 10) == 0 or g == generations:
            log(f"gen {g:4d}: pop best {row['pop_best']:.3f} mean {row['pop_mean']:.3f} | centre train {tr[0]:.3f} "
                f"({row['train_arrived']}/{n_train} arrive) holdout {ho[0]:.3f} ({row['holdout_arrived']}/{len(hold_ids)}) "
                f"| {steps / row['seconds'] / 1e6:.1f}M car-steps/s")

    brain_path = run.dir / "best-brain.json"
    doc = brain_document(best["params"], f"Terra Trainer {algo.upper()} g{best['generation']}", best["generation"], best["train"],
                         trainer={"algo": algo, "run": run.dir.name, "train_score": best["train"], "holdout_score": best["holdout"]})
    write_brain(brain_path, doc)
    summary = {"algo": algo, "run": run.dir.name, "best_generation": best["generation"], "best_train_score": best["train"],
               "best_holdout_score": best["holdout"], "start_train_score": float(tr0[0]), "start_holdout_score": float(ho0[0]),
               "car_steps": total_steps, "seconds": round(time.perf_counter() - run.t0, 2), "brain": brain_path.name}
    if validate:
        # The browser validator, then the app's runEpisode on the first map: JS and C++ must agree.
        first = maps[0]
        js = validate_with_js(brain_path, WORLDS_DIR / f"{first}.json")
        cpp = world.run_episodes(best["params"], tasks=np.array([r["task"] for r in table if r["map"] == first], np.int32))["score"][0]
        summary["js_validation"] = {"valid": js["valid"], "bytes": js["bytes"], "max_score_diff_vs_cpp": float(np.abs(np.asarray(js["scores"]) - cpp).max())}
    run.close(summary)
    log(f"best: generation {best['generation']}, train {best['train']:.3f}, holdout {best['holdout']:.3f} → {brain_path}")
    return run.dir


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--algo", choices=["es", "cmaes"], default="cmaes", help="cmaes learns from scratch; es suits fine-tuning")
    ap.add_argument("--generations", type=int, default=150)
    ap.add_argument("--population", type=int, default=64)
    ap.add_argument("--sigma", type=float, default=0.5, help="initial step size (0.1 with --lr 0.02 fine-tunes well with es)")
    ap.add_argument("--lr", type=float, default=0.03)
    ap.add_argument("--tasks-per-gen", type=int, default=0, help="routes sampled per generation (0 = all training routes)")
    ap.add_argument("--init", default="random", help="random | factory | path to a brain JSON")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--threads", type=int, default=0)
    ap.add_argument("--maps", nargs="+", default=list(MAPS))
    ap.add_argument("--out", type=Path)
    ap.add_argument("--no-validate", action="store_true", help="skip the Node validation of the exported brain")
    a = ap.parse_args(argv)
    run_dir = train(a.algo, a.generations, a.population, a.sigma, a.lr, a.tasks_per_gen, a.init, a.seed, a.threads, a.maps, a.out,
                    validate=not a.no_validate)
    print(json.dumps(json.loads((run_dir / "summary.json").read_text()), indent=2))


if __name__ == "__main__":
    main()
