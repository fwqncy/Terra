"""The JS brain format (web/src/engine/ai/network.js) and the flat parameter layout shared with C++.

A brain is {"levels": [{"inputs", "outputs", "biases", "weights"}]} with weights[input][output] and the
step rule `output = 1 if sum(inputs * weights) > bias else 0`. Flat order: per level, weights row-major
then biases (trainer/sim-cpp/src/sim.cpp Network::fromFlat).
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path

import numpy as np

from .sim import ROOT

SHAPE = (10, 8, 4)


def param_count(shape=SHAPE) -> int:
    return sum(a * b + b for a, b in zip(shape[:-1], shape[1:]))


def to_flat(network: dict) -> np.ndarray:
    parts = []
    for level in network["levels"]:
        parts.append(np.asarray(level["weights"], dtype=np.float64).ravel())
        parts.append(np.asarray(level["biases"], dtype=np.float64))
    return np.concatenate(parts)


def shape_of(network: dict) -> tuple[int, ...]:
    levels = network["levels"]
    return (len(levels[0]["inputs"]), *(len(l["outputs"]) for l in levels))


def from_flat(params, shape=SHAPE) -> dict:
    p = np.asarray(params, dtype=np.float64).ravel()
    if p.size != param_count(shape):
        raise ValueError(f"expected {param_count(shape)} parameters for shape {shape}, got {p.size}")
    if not np.all(np.isfinite(p)):
        raise ValueError("parameters must be finite")
    levels, at = [], 0
    for n_in, n_out in zip(shape[:-1], shape[1:]):
        w = p[at : at + n_in * n_out].reshape(n_in, n_out)
        at += n_in * n_out
        b = p[at : at + n_out]
        at += n_out
        levels.append({
            "inputs": [0.0] * n_in,
            "outputs": [0] * n_out,
            "biases": [float(x) for x in b],
            "weights": [[float(x) for x in row] for row in w],
        })
    return {"levels": levels}


def is_valid(obj) -> bool:
    """Python mirror of NeuralNetwork.isValid (the authoritative check runs in Node, see export.validate_with_js)."""
    try:
        levels = obj["levels"]
        if not isinstance(levels, list) or not 0 < len(levels) <= 8:
            return False
        for l in levels:
            ins, outs, bs, ws = l["inputs"], l["outputs"], l["biases"], l["weights"]
            if not all(isinstance(a, list) for a in (ins, outs, bs, ws)):
                return False
            if len(ins) > 64 or len(outs) > 64 or len(bs) != len(outs) or len(ws) != len(ins):
                return False
            for row in ws:
                if not isinstance(row, list) or len(row) != len(outs) or not all(_finite(v) for v in row):
                    return False
            if not all(_finite(v) for v in bs):
                return False
        return True
    except (KeyError, TypeError):
        return False


def _finite(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def factory_brain(domain: str = "city") -> dict:
    """The factory Autopilot brain shipped with the app (web/src/engine/data/brains.js)."""
    text = (ROOT / "web" / "src" / "engine" / "data" / "brains.js").read_text()
    match = re.search(r"export const FACTORY_BRAINS = (\{.*\});?\s*$", text, re.S)
    if not match:
        raise ValueError("could not find FACTORY_BRAINS in brains.js")
    return json.loads(match.group(1))[domain]


def load_brain_file(path: Path) -> dict:
    """Reads a brain file in either form the browser imports: a bare network or {"network": …}."""
    obj = json.loads(Path(path).read_text())
    return obj.get("network", obj) if isinstance(obj, dict) else obj
