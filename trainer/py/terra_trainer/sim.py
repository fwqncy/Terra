"""Locates and loads the compiled `terra_sim` module and the exported worlds."""
from __future__ import annotations

import importlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WORLDS_DIR = ROOT / "trainer" / "worlds"
BUILD_DIR = Path(os.environ.get("TERRA_SIM_BUILD", ROOT / "trainer" / "sim-cpp" / "build" / "python"))
MAPS = ("brisbane", "goldcoast", "sydney", "melbourne")


def load_module():
    """Imports terra_sim from the CMake build folder (make trainer)."""
    if str(BUILD_DIR) not in sys.path:
        sys.path.insert(0, str(BUILD_DIR))
    try:
        return importlib.import_module("terra_sim")
    except ImportError as e:  # pragma: no cover - message for humans
        raise ImportError(f"terra_sim not built in {BUILD_DIR}: run `make trainer` first ({e})") from e


terra_sim = load_module()


def read_world_docs(maps=MAPS, worlds_dir: Path = WORLDS_DIR) -> list[dict]:
    docs = []
    for m in maps:
        path = Path(worlds_dir) / f"{m}.json"
        if not path.exists():
            raise FileNotFoundError(f"{path} missing: run `make trainer-worlds`")
        docs.append(json.loads(path.read_text()))
    return docs


def load_world(maps=MAPS, worlds_dir: Path = WORLDS_DIR):
    """A terra_sim.World holding every route of the given maps, plus the source documents."""
    docs = read_world_docs(maps, worlds_dir)
    return terra_sim.World(json.dumps(docs)), docs


def task_table(world, docs):
    """One row per task: global index, map name, task id, holdout flag, route length."""
    rows = []
    for t in world.tasks():
        doc = docs[t["map"]]
        local = t["index"] - sum(len(d["tasks"]) for d in docs[: t["map"]])
        rows.append({
            "task": t["index"],
            "map": doc["map"],
            "id": doc["tasks"][local]["id"],
            "holdout": t["holdout"],
            "route_length": t["route_length"],
        })
    return rows
