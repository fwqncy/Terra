"""pandas analysis of training runs: learning curves, wall-clock, crash hotspots by road segment, and a
comparison with the in-browser GA (tools/ga-baseline.mjs). Writes PNG charts and a markdown summary.

    python -m terra_trainer.analyze trainer/runs/compare            # every run folder inside
    python -m terra_trainer.analyze trainer/runs/a trainer/runs/b --out report/
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from matplotlib.collections import LineCollection  # noqa: E402

from .sim import MAPS, ROOT, read_world_docs  # noqa: E402

# Validated categorical slots (dataviz reference palette, light surface): fixed order, never cycled.
SURFACE, INK, INK_2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e7e6e2"
ALGOS = {  # algo id -> (label, colour)
    "cmaes": ("CMA-ES (C++)", "#2a78d6"),
    "es": ("OpenAI-ES (C++)", "#eb6834"),
    "browser-ga": ("Browser GA (JS)", "#1baf7a"),
    "ppo": ("PPO (C++ env)", "#eda100"),
}
PER_GENERATION = ("cmaes", "es", "browser-ga")  # PPO updates are not generations; it appears in the wall-clock chart
SEQ = ["#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#0d366b"]  # sequential blue, light -> dark
GOOD = 1.1  # mean Bootcamp score at which nearly every route is completed
MAP_NAMES = {"brisbane": "Brisbane", "goldcoast": "Gold Coast", "sydney": "Sydney", "melbourne": "Melbourne"}


def _spread_labels(ax, items, gap):
    """Direct labels at line ends, nudged apart vertically so equal end values never overlap."""
    items = sorted(items, key=lambda t: t[1])
    placed = []
    for x, y, text in items:
        if placed and y - placed[-1][1] < gap:
            y = placed[-1][1] + gap
        placed.append((x, y, text))
    for x, y, text in placed:
        ax.annotate(text, (x, y), xytext=(6, 0), textcoords="offset points", color=INK_2, fontsize=8, va="center", annotation_clip=False)


def load_runs(paths: list[Path]) -> pd.DataFrame:
    """generations.csv of every run folder, with algo/seed/run columns."""
    frames = []
    for p in _run_dirs(paths):
        cfg = json.loads((p / "config.json").read_text())
        g = pd.read_csv(p / "generations.csv")
        if "best_holdout_score" not in g:  # the GA log scores its elite directly
            g["best_holdout_score"] = g["holdout_score"]
        g["algo"] = cfg["algo"]
        g["seed"] = cfg.get("seed", 0)
        g["run"] = p.name
        frames.append(g)
    if not frames:
        raise FileNotFoundError(f"no run folders (with generations.csv) under {paths}")
    return pd.concat(frames, ignore_index=True)


def _run_dirs(paths):
    for p in map(Path, paths):
        if (p / "generations.csv").exists():
            yield p
        else:
            yield from sorted(d for d in p.iterdir() if (d / "generations.csv").exists())


def compare(df: pd.DataFrame) -> pd.DataFrame:
    """One row per algorithm: final quality (median and range over seeds) and time to a good brain."""
    rows = []
    for algo, runs in df.groupby("algo", sort=False):
        per_run = []
        for _, r in runs.groupby("run"):
            r = r.sort_values("generation")
            hit = r[r["best_train_score"] >= GOOD]
            per_run.append({
                "train": r["best_train_score"].iloc[-1],
                "holdout": r["best_holdout_score"].iloc[-1],
                "gen_to_good": hit["generation"].iloc[0] if len(hit) else np.nan,
                "sec_to_good": hit["wall"].iloc[0] if len(hit) else np.nan,
                "wall": r["wall"].iloc[-1],
                "episodes": r["episodes"].sum(),
                "generations": r["generation"].max(),
            })
        p = pd.DataFrame(per_run)
        rows.append({
            "algorithm": ALGOS.get(algo, (algo,))[0],
            "algo": algo,
            "seeds": len(p),
            "generations": int(p["generations"].median()),
            "best_train": p["train"].median(),
            "best_train_range": f"{p['train'].min():.3f}–{p['train'].max():.3f}",
            "best_holdout": p["holdout"].median(),
            "best_holdout_range": f"{p['holdout'].min():.3f}–{p['holdout'].max():.3f}",
            "reached_good": f"{int(p['gen_to_good'].notna().sum())}/{len(p)}",
            "gens_to_good": p["gen_to_good"].median(),
            "seconds_to_good": p["sec_to_good"].median(),
            "seconds_total": p["wall"].median(),
            "episodes": int(p["episodes"].median()),
        })
    return pd.DataFrame(rows)


def hotspots(paths: list[Path], docs: dict[str, dict], top: int = 12) -> pd.DataFrame:
    """Crashes per (map, graph segment) summed over runs, with the segment's position and length."""
    frames = [pd.read_csv(p / "hotspots.csv") for p in _run_dirs(paths) if (p / "hotspots.csv").exists()]
    if not frames:
        return pd.DataFrame(columns=["map", "graph_segment", "crashes", "share", "x", "y", "length_m", "where"])
    h = pd.concat(frames).query("graph_segment >= 0").groupby(["map", "graph_segment"], as_index=False)["crashes"].sum()
    h["share"] = h["crashes"] / h["crashes"].sum()

    def geom(row):
        segs = docs[row["map"]]["graphSegments"]
        i = int(row["graph_segment"]) * 4
        x1, y1, x2, y2 = segs[i : i + 4]
        return pd.Series({"x": (x1 + x2) / 2, "y": (y1 + y2) / 2, "length_m": np.hypot(x2 - x1, y2 - y1) / 6})

    h = pd.concat([h, h.apply(geom, axis=1)], axis=1)
    # Where the segment sits on the routes that use it: the first segment after Start, the last before Target, or between.
    firsts = {(d["map"], t["routeSegments"][0]) for d in docs.values() for t in d["tasks"] if t["routeSegments"]}
    lasts = {(d["map"], t["routeSegments"][-1]) for d in docs.values() for t in d["tasks"] if t["routeSegments"]}
    h["where"] = ["route start" if (m, s) in firsts else "route end" if (m, s) in lasts else "mid-route"
                  for m, s in zip(h["map"], h["graph_segment"])]
    return h.sort_values("crashes", ascending=False).reset_index(drop=True).head(top) if top else h


# ---------------- charts ----------------

def _style(ax, title=None):
    ax.set_facecolor(SURFACE)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(GRID)
    ax.tick_params(colors=INK_2, labelsize=9)
    ax.grid(True, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    if title:
        ax.set_title(title, loc="left", color=INK, fontsize=11, fontweight="bold")


def _figure(w, h, n=1):
    fig, axes = plt.subplots(1, n, figsize=(w, h), facecolor=SURFACE, squeeze=False)
    return fig, axes[0]


def chart_learning(df: pd.DataFrame, path: Path):
    """Best-so-far score per generation: median over seeds, min–max band, direct labels."""
    fig, axes = _figure(11, 4.2, 2)
    for ax, col, title in zip(axes, ("best_train_score", "best_holdout_score"), ("Training routes (32)", "Held-out routes (8)")):
        _style(ax, title)
        ends = []
        for algo in PER_GENERATION:
            d = df[df["algo"] == algo]
            if d.empty:
                continue
            label, colour = ALGOS[algo]
            g = d.groupby("generation")[col].agg(["median", "min", "max"])
            ax.fill_between(g.index, g["min"], g["max"], color=colour, alpha=0.12, linewidth=0)
            ax.plot(g.index, g["median"], color=colour, linewidth=2, label=label)
            ends.append((g.index[-1], g["median"].iloc[-1], label.split(" (")[0]))
        _spread_labels(ax, ends, 0.06)
        ax.axhline(1.0, color=INK_2, linewidth=0.8, linestyle=(0, (3, 3)))
        ax.set_xlabel("Generation", color=INK_2, fontsize=9)
        ax.set_ylim(0, 1.3)
        ax.margins(x=0.02)
    axes[0].set_ylabel("Best brain's mean score (≥ 1 = arrives)", color=INK_2, fontsize=9)
    axes[0].legend(frameon=False, fontsize=9, loc="lower right", labelcolor=INK)
    fig.tight_layout(rect=(0, 0, 0.97, 1))
    fig.savefig(path, dpi=150)
    plt.close(fig)


def chart_wallclock(df: pd.DataFrame, path: Path):
    """Best training score against wall-clock seconds (log scale): algorithm and runtime together."""
    fig, (ax,) = _figure(7.5, 4.2)
    _style(ax, "Best training score vs wall-clock time")
    ends = []
    for algo in ALGOS:
        d = df[df["algo"] == algo]
        label, colour = ALGOS[algo]
        for i, (_, r) in enumerate(d.groupby("run")):
            ax.plot(r["wall"], r["best_train_score"], color=colour, linewidth=1.6, alpha=0.9, label=label if i == 0 else None)
        if len(d):
            end = d.loc[d["wall"].idxmax()]
            ends.append((end["wall"], end["best_train_score"], label.split(" (")[0]))
    _spread_labels(ax, ends, 0.06)
    ax.set_xscale("log")
    ax.set_xlabel("Seconds since the run started (log scale)", color=INK_2, fontsize=9)
    ax.set_ylabel("Best mean score, training routes", color=INK_2, fontsize=9)
    ax.set_ylim(0, 1.3)
    ax.legend(frameon=False, fontsize=9, loc="lower right", labelcolor=INK)
    fig.tight_layout(rect=(0, 0, 0.95, 1))
    fig.savefig(path, dpi=150)
    plt.close(fig)


def chart_hotspots(h: pd.DataFrame, path: Path):
    """Top road segments by crash count (one series, so one hue and no legend)."""
    fig, (ax,) = _figure(7.5, 0.42 * max(4, len(h)) + 1)
    _style(ax, "Where training cars crash: top road segments")
    ax.grid(axis="y", visible=False)
    labels = [f"{MAP_NAMES.get(m, m)} · segment {s} ({w})" for m, s, w in zip(h["map"], h["graph_segment"], h["where"])][::-1]
    values = h["crashes"].to_numpy()[::-1]
    ax.barh(labels, values, color=ALGOS["cmaes"][1], height=0.62)
    for y, v, share in zip(range(len(values)), values, h["share"].to_numpy()[::-1]):
        ax.annotate(f"{v:,} ({share:.0%})", (v, y), xytext=(4, 0), textcoords="offset points", va="center", fontsize=8, color=INK_2)
    ax.set_xlabel("Crashes during training (CMA-ES and OpenAI-ES population rollouts)", color=INK_2, fontsize=9)
    ax.xaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"{v:,.0f}"))
    ax.margins(x=0.15)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def chart_crash_maps(h_all: pd.DataFrame, docs: dict[str, dict], path: Path):
    """Small multiples: each map's road network, with segments shaded by crash count (sequential blue)."""
    maps = [m for m in MAPS if m in docs]
    fig, axes = _figure(12, 3.4, len(maps))
    top = max(1, int(h_all["crashes"].max())) if len(h_all) else 1
    bins = np.quantile(h_all["crashes"], [0.5, 0.8, 0.95, 0.99]) if len(h_all) else [1, 2, 3, 4]
    for ax, m in zip(axes, maps):
        ax.set_facecolor(SURFACE)
        ax.set_axis_off()
        ax.set_title(MAP_NAMES.get(m, m), loc="left", color=INK, fontsize=10, fontweight="bold")
        segs = np.asarray(docs[m]["graphSegments"]).reshape(-1, 2, 2)
        ax.add_collection(LineCollection(segs, colors="#d6d5d0", linewidths=0.6))
        hm = h_all[h_all["map"] == m]
        if len(hm):
            idx = hm["graph_segment"].to_numpy(int)
            level = np.searchsorted(bins, hm["crashes"].to_numpy(), side="right")
            ax.add_collection(LineCollection(segs[idx], colors=[SEQ[min(l, 4)] for l in level], linewidths=1.2 + 1.6 * level / 4))
        ax.autoscale()
        ax.set_aspect("equal")
        ax.invert_yaxis()  # world y points down the screen, like the app
    fig.text(0.01, 0.01, f"Road segments shaded by training crashes (light → dark = more; darkest ≈ top 1%, max {top:,}).",
             color=INK_2, fontsize=8)
    fig.tight_layout(rect=(0, 0.04, 1, 1))
    fig.savefig(path, dpi=150)
    plt.close(fig)


# ---------------- report ----------------

def _takeaways(cmp: pd.DataFrame) -> list[str]:
    """Plain-language comparison; only algorithms that reached GOOD on every seed are called 'fastest'."""
    ok = cmp[cmp["reached_good"].map(lambda r: r.split("/")[0] == r.split("/")[1])]
    ga = cmp[cmp["algo"] == "browser-ga"]
    out = []
    reliable = ok[ok["algo"] != "browser-ga"].sort_values("seconds_to_good")
    if len(reliable) and len(ga) and not np.isnan(ga["seconds_to_good"].iloc[0]):
        b, g = reliable.iloc[0], ga.iloc[0]
        out.append(f"- **Wall-clock:** {b['algorithm']} reached {GOOD} on every seed, in a median {b['seconds_to_good']:.1f} s; the browser GA "
                   f"in Node took {g['seconds_to_good']:.1f} s ({g['seconds_to_good'] / b['seconds_to_good']:.1f}× longer). Full runs: "
                   f"{b['seconds_total']:.0f} s vs {g['seconds_total']:.0f} s.")
        out.append(f"- **Per generation:** the browser GA needed a median {g['gens_to_good']:.0f} generations to reach {GOOD}, "
                   f"{b['algorithm']} {b['gens_to_good']:.0f}. The GA's elitism and spread mutation are a strong baseline; "
                   "the speed-up comes from the C++ sim running every car in parallel, not from a smarter optimiser.")
    notes = {
        "es": "from a random brain its gradient estimate often stalls on the step network's flat plateaus; it does well "
              "fine-tuning a good brain (`--algo es --init factory --sigma 0.1 --lr 0.02`).",
        "ppo": "it learns from scratch within its time budget, but the deterministic brain it exports swings between updates "
               "(its `train_score` column in generations-all.csv), so the best one is kept.",
    }
    for _, r in cmp.iterrows():
        if r["reached_good"].split("/")[0] != r["reached_good"].split("/")[1]:
            out.append(f"- **{r['algorithm']}** reached {GOOD} on {r['reached_good']} seeds (training range {r['best_train_range']}): "
                       + notes.get(r["algo"], "results vary by seed."))
    return (["**Takeaways**", "", *out, ""]) if out else []


def _md_table(df: pd.DataFrame, decimals: dict[str, int] | None = None) -> str:
    decimals = decimals or {}
    cols = list(df.columns)
    lines = ["| " + " | ".join(cols) + " |", "| " + " | ".join("---:" if pd.api.types.is_numeric_dtype(df[c]) else "---" for c in cols) + " |"]
    for _, r in df.iterrows():
        lines.append("| " + " | ".join(_fmt(r[c], decimals.get(c)) for c in cols) + " |")
    return "\n".join(lines)


def _fmt(v, decimals=None):
    if isinstance(v, float):
        if np.isnan(v):
            return "—"
        if decimals is not None:
            return f"{v:,.{decimals}f}"
        return f"{v:,.0f}" if v.is_integer() else f"{v:,.3f}" if abs(v) < 10 else f"{v:,.1f}"
    return f"{v:,}" if isinstance(v, (int, np.integer)) else str(v)


def report(paths: list[Path], out: Path, bench: Path | None = None) -> Path:
    out.mkdir(parents=True, exist_ok=True)
    df = load_runs(paths)
    docs = {d["map"]: d for d in read_world_docs()}
    cmp = compare(df)
    h_all = hotspots(paths, docs, top=0)
    h_top = h_all.sort_values("crashes", ascending=False).head(12)

    chart_learning(df, out / "learning-curves.png")
    chart_wallclock(df, out / "wallclock.png")
    if len(h_top):
        chart_hotspots(h_top, out / "crash-hotspots.png")
        chart_crash_maps(h_all, docs, out / "crash-maps.png")
    df.to_csv(out / "generations-all.csv", index=False)
    cmp.to_csv(out / "comparison.csv", index=False)
    h_all.to_csv(out / "hotspots-all.csv", index=False)

    cmp = cmp.assign(seconds_to_good=cmp["seconds_to_good"].round(1), seconds_total=cmp["seconds_total"].round(1))
    table = cmp[["algorithm", "seeds", "generations", "best_train", "best_train_range", "best_holdout", "best_holdout_range", "reached_good",
                 "gens_to_good", "seconds_to_good", "seconds_total"]].rename(columns={
        "algorithm": "Algorithm", "seeds": "Seeds", "generations": "Gens / updates", "best_train": "Train (median)", "best_train_range": "Train range",
        "best_holdout": "Held-out (median)", "best_holdout_range": "Held-out range", "reached_good": f"Reached {GOOD}",
        "gens_to_good": f"Gens to {GOOD}", "seconds_to_good": f"Seconds to {GOOD}", "seconds_total": "Seconds total"})
    lines = [
        "# Terra Trainer: training run analysis",
        "",
        f"Runs: {', '.join(sorted(df['run'].unique()))}.",
        "",
        "Scores are Bootcamp scores averaged over routes: the fraction of the route driven, or 1 + a time bonus when the car "
        f"arrives, so ≥ 1 means it completes. Each run's *best* brain is tracked; {GOOD} means nearly every route is completed.",
        "",
        "## Algorithms compared",
        "",
        _md_table(table, {f"Seconds to {GOOD}": 1, "Seconds total": 1, f"Gens to {GOOD}": 0}),
        "",
        "![Learning curves](learning-curves.png)",
        "",
        "![Wall-clock](wallclock.png)",
        "",
    ]
    lines += _takeaways(cmp)
    if len(h_top):
        hot = h_top.assign(Map=h_top["map"].map(MAP_NAMES), Where=h_top["where"], Segment=h_top["graph_segment"], Crashes=h_top["crashes"],
                           Share=(h_top["share"] * 100).round(1).astype(str) + "%", **{"Length (m)": h_top["length_m"].round(0)},
                           **{"Position (x, y)": [f"{x:,.0f}, {y:,.0f}" for x, y in zip(h_top["x"], h_top["y"])]})
        lines += [
            "## Crash hotspots by road segment",
            "",
            f"{int(h_all['crashes'].sum()):,} crashes across every CMA-ES and OpenAI-ES population rollout, located on the map graph segment under the car. "
            f"The top 12 segments hold {h_top['share'].sum():.0%} of them. By position on the route: "
            + ", ".join(f"{w} {s:.0%}" for w, s in h_all.groupby("where")["share"].sum().sort_values(ascending=False).items())
            + ". Counts include every brain tried, from the first random generation onwards.",
            "",
            _md_table(hot[["Map", "Segment", "Where", "Crashes", "Share", "Length (m)", "Position (x, y)"]]),
            "",
            "![Crash hotspots](crash-hotspots.png)",
            "",
            "![Crash maps](crash-maps.png)",
            "",
        ]
    bench = bench or ROOT / "trainer" / "runs" / "bench.json"
    if bench.exists():
        from .bench import table as bench_table

        b = json.loads(bench.read_text())
        lines += ["## Simulation speed", "", f"{b['episodes']:,} Bootcamp episodes ({b['car_steps']:,} car-steps) on {b['map']}, {b['machine']}.", "",
                  bench_table(b), ""]
    (out / "summary.md").write_text("\n".join(lines))
    return out / "summary.md"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("runs", nargs="+", type=Path, help="run folders, or folders containing them")
    ap.add_argument("--out", type=Path, help="report folder (default: <first path>/report)")
    ap.add_argument("--bench", type=Path, help="bench.json to include (default trainer/runs/bench.json)")
    a = ap.parse_args(argv)
    out = a.out or (a.runs[0] / "report")
    path = report(a.runs, out, a.bench)
    print(f"wrote {path} and charts in {out}")


if __name__ == "__main__":
    main()
