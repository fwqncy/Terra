"""PPO comparison: a gradient-based policy on the same browser network, stepped frame by frame in C++.

The policy is the JS brain itself (StepNet): hidden neurons step exactly as in the browser (straight-through
gradients), and each of the 4 outputs is a Bernoulli with p = sigmoid(beta * z). beta > 0 is a learnable
sharpness, so the most likely action is exactly the browser's `z > 0`: the exported brain is the
deterministic version of the trained policy. The value function is a separate MLP that is never exported.
Rewards are the Bootcamp score gained each frame, so an episode's return is its Bootcamp score.

    python -m terra_trainer.ppo --seconds 120 --init factory
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn

from .brain import SHAPE, param_count
from .es import initial_params
from .export import brain_document, validate_with_js, write_brain
from .net import StepNet
from .runs import Run
from .sim import MAPS, WORLDS_DIR, load_world, task_table, terra_sim


class Policy(nn.Module):
    def __init__(self, params: np.ndarray, beta: float = 4.0):
        super().__init__()
        self.net = StepNet.from_flat(params)
        self.log_beta = nn.Parameter(torch.tensor(float(np.log(beta)), dtype=torch.float64))
        self.value = nn.Sequential(nn.Linear(SHAPE[0], 64, dtype=torch.float64), nn.Tanh(),
                                   nn.Linear(64, 64, dtype=torch.float64), nn.Tanh(), nn.Linear(64, 1, dtype=torch.float64))

    def dist(self, obs: torch.Tensor) -> torch.distributions.Bernoulli:
        return torch.distributions.Bernoulli(logits=self.net.logits(obs, straight_through=True) * self.log_beta.exp())

    def flat(self) -> np.ndarray:
        return self.net.to_flat().numpy().copy()


def train(seconds: float = 120, cars: int = 256, horizon: int = 128, epochs: int = 4, minibatch: int = 4096, lr: float = 3e-4,
          gamma: float = 0.999, lam: float = 0.95, clip: float = 0.2, entropy: float = 0.003, init: str = "factory", seed: int = 0,
          threads: int = 0, maps=MAPS, out: Path | None = None, max_updates: int = 0, validate: bool = True, log=print) -> Path:
    rng = np.random.default_rng(seed)
    torch.manual_seed(seed)
    world, docs = load_world(maps)
    table = task_table(world, docs)
    train_ids = np.array([r["task"] for r in table if not r["holdout"]], np.int32)
    hold_ids = np.array([r["task"] for r in table if r["holdout"]], np.int32)
    all_ids = np.concatenate([train_ids, hold_ids])
    n_train = len(train_ids)
    config = dict(seconds=seconds, cars=cars, horizon=horizon, epochs=epochs, minibatch=minibatch, lr=lr, gamma=gamma, lam=lam, clip=clip,
                  entropy=entropy, init=init, seed=seed, maps=list(maps), train_tasks=n_train, holdout_tasks=len(hold_ids),
                  shape=list(SHAPE), params=param_count(SHAPE))
    run = Run("ppo", config, out)

    policy = Policy(initial_params(init, rng))
    opt = torch.optim.Adam(policy.parameters(), lr=lr)
    tasks = train_ids[np.arange(cars) % n_train]
    env = terra_sim.Batch(world, tasks, threads)

    def evaluate(params):
        res = world.run_episodes(params, tasks=all_ids, threads=threads)
        return res, float(res["score"][0, :n_train].mean()), float(res["score"][0, n_train:].mean()) if len(hold_ids) else 0.0

    _, tr0, ho0 = evaluate(policy.flat())
    best = {"train": tr0, "holdout": ho0, "params": policy.flat(), "update": 0}
    log(f"start ({init}): train {tr0:.3f}, holdout {ho0:.3f}")
    obs = torch.from_numpy(env.observations())
    ep_return = np.zeros(cars)
    update = 0
    while (time.perf_counter() - run.t0) < seconds and (not max_updates or update < max_updates):
        t0 = time.perf_counter()
        update += 1
        O, A, LP, R, D, V = [], [], [], [], [], []
        finished = []
        with torch.no_grad():
            for _ in range(horizon):
                d = policy.dist(obs)
                a = d.sample()
                O.append(obs)
                A.append(a)
                LP.append(d.log_prob(a).sum(-1))
                V.append(policy.value(obs).squeeze(-1))
                r, done = env.step(actions=a.to(torch.uint8).numpy())
                ep_return += r
                finished.extend(ep_return[done])
                ep_return[done] = 0
                R.append(torch.from_numpy(r))
                D.append(torch.from_numpy(done.astype(np.float64)))
                obs = torch.from_numpy(env.observations())
            last_v = policy.value(obs).squeeze(-1)
        # GAE over the rollout (cars restart on their task when done)
        adv = torch.zeros(horizon, cars, dtype=torch.float64)
        gae = torch.zeros(cars, dtype=torch.float64)
        for t in reversed(range(horizon)):
            nv = last_v if t == horizon - 1 else V[t + 1]
            delta = R[t] + gamma * nv * (1 - D[t]) - V[t]
            gae = delta + gamma * lam * (1 - D[t]) * gae
            adv[t] = gae
        ret = adv + torch.stack(V)
        O, A, LP = torch.cat(O), torch.cat(A), torch.cat(LP)
        adv, ret = adv.reshape(-1), ret.reshape(-1)
        adv = (adv - adv.mean()) / (adv.std() + 1e-8)
        n = len(O)
        for _ in range(epochs):
            perm = torch.from_numpy(rng.permutation(n))
            for i in range(0, n, minibatch):
                idx = perm[i : i + minibatch]
                d = policy.dist(O[idx])
                ratio = (d.log_prob(A[idx]).sum(-1) - LP[idx]).exp()
                pg = -torch.min(ratio * adv[idx], ratio.clamp(1 - clip, 1 + clip) * adv[idx]).mean()
                vloss = 0.5 * (policy.value(O[idx]).squeeze(-1) - ret[idx]).pow(2).mean()
                loss = pg + vloss - entropy * d.entropy().sum(-1).mean()
                opt.zero_grad()
                loss.backward()
                nn.utils.clip_grad_norm_(policy.parameters(), 0.5)
                opt.step()

        # deterministic brain (the browser's step policy) on every route
        params = policy.flat()
        ev, tr, ho = evaluate(params)
        if tr > best["train"]:
            best.update(train=tr, holdout=ho, params=params, update=update)
        run.episodes(update, ev, all_ids, table, row=0)
        arrived = ev["outcome"][0] == terra_sim.ARRIVED
        row = {
            "generation": update,
            "pop_best": float(np.max(finished)) if finished else np.nan,
            "pop_mean": float(np.mean(finished)) if finished else np.nan,
            "train_score": tr,
            "holdout_score": ho,
            "train_arrived": int(arrived[:n_train].sum()),
            "holdout_arrived": int(arrived[n_train:].sum()),
            "best_train_score": best["train"],
            "best_holdout_score": best["holdout"],
            "episodes": len(finished) + len(all_ids),
            "car_steps": cars * horizon + int(ev["age"].sum()),
            "seconds": round(time.perf_counter() - t0, 4),
        }
        run.generation(row)
        if update == 1 or update % 10 == 0:
            log(f"update {update:4d}: rollout return {row['pop_mean']:.3f} ({len(finished)} episodes) | deterministic train {tr:.3f} "
                f"({row['train_arrived']}/{n_train}) holdout {ho:.3f} | beta {policy.log_beta.exp().item():.1f}")

    brain_path = run.dir / "best-brain.json"
    write_brain(brain_path, brain_document(best["params"], f"Terra Trainer PPO u{best['update']}", best["update"], best["train"],
                                           trainer={"algo": "ppo", "run": run.dir.name, "train_score": best["train"], "holdout_score": best["holdout"]}))
    summary = {"algo": "ppo", "run": run.dir.name, "updates": update, "best_update": best["update"], "best_train_score": best["train"],
               "best_holdout_score": best["holdout"], "start_train_score": tr0, "start_holdout_score": ho0,
               "seconds": round(time.perf_counter() - run.t0, 2), "brain": brain_path.name}
    if validate:
        js = validate_with_js(brain_path, WORLDS_DIR / f"{maps[0]}.json")
        summary["js_validation"] = {"valid": js["valid"], "bytes": js["bytes"]}
    run.close(summary)
    log(f"best: update {best['update']}, train {best['train']:.3f}, holdout {best['holdout']:.3f} → {brain_path}")
    return run.dir


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seconds", type=float, default=120, help="wall-clock budget")
    ap.add_argument("--updates", type=int, default=0, help="stop after this many updates (0 = use --seconds)")
    ap.add_argument("--cars", type=int, default=256)
    ap.add_argument("--horizon", type=int, default=128)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--entropy", type=float, default=0.003)
    ap.add_argument("--init", default="factory", help="factory | random | path to a brain JSON")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--threads", type=int, default=0)
    ap.add_argument("--maps", nargs="+", default=list(MAPS))
    ap.add_argument("--out", type=Path)
    ap.add_argument("--no-validate", action="store_true")
    a = ap.parse_args(argv)
    run_dir = train(a.seconds, a.cars, a.horizon, lr=a.lr, entropy=a.entropy, init=a.init, seed=a.seed, threads=a.threads, maps=a.maps,
                    out=a.out, max_updates=a.updates, validate=not a.no_validate)
    print(json.dumps(json.loads((run_dir / "summary.json").read_text()), indent=2))


if __name__ == "__main__":
    main()
