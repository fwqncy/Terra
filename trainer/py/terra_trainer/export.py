"""Export trained weights in the browser's brain format, validated by the browser's own check.

The file loads with City Lab → Train → "Import Brain…" (it reads name, generation, fitness and network),
and can be published to the API brain library (POST /api/brains, which validates it again server-side).

    python -m terra_trainer.export trainer/runs/<run>/best-brain.json --publish http://localhost:5080
"""
from __future__ import annotations

import argparse
import json
import subprocess
import urllib.request
from pathlib import Path

import numpy as np

from .brain import SHAPE, from_flat, is_valid, load_brain_file, to_flat
from .sim import ROOT, WORLDS_DIR

MAX_BYTES = 200_000  # BrainStore.importFile limit


def brain_document(params, name: str, generation: int, fitness: float, map_id: str = "brisbane", trainer: dict | None = None) -> dict:
    network = from_flat(params, SHAPE)
    return {
        "name": name[:40],
        "domain": "city",
        "map": map_id,
        "generation": int(generation),
        "fitness": float(fitness),
        "network": network,
        "trainer": trainer or {},
    }


def write_brain(path: Path, doc: dict) -> Path:
    path = Path(path)
    if not is_valid(doc["network"]):
        raise ValueError("network failed the Python mirror of NeuralNetwork.isValid")
    text = json.dumps(doc)
    if len(text.encode()) > MAX_BYTES:
        raise ValueError(f"brain file is {len(text)} bytes; the browser accepts at most {MAX_BYTES}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


def validate_with_js(path: Path, world: Path | None = None) -> dict:
    """Runs tools/validate-brain.mjs: the browser's NeuralNetwork.isValid, plus runEpisode scores with a world."""
    cmd = ["node", str(ROOT / "tools" / "validate-brain.mjs"), str(Path(path).resolve())]
    if world:
        cmd += ["--world", str(Path(world).resolve())]
    out = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=600)
    lines = out.stdout.strip().splitlines()
    if not lines:
        raise RuntimeError(f"tools/validate-brain.mjs failed: {out.stderr.strip()[-800:]}")
    result = json.loads(lines[-1])
    if out.returncode != 0 or not result.get("valid"):
        raise ValueError(f"{path} rejected by the browser validator: {result}")
    return result


def publish(path: Path, api: str, player: str = "terra-trainer") -> str:
    """POSTs the brain to the API's brain library; returns the new document id."""
    doc = json.loads(Path(path).read_text())
    body = {k: doc[k] for k in ("name", "domain", "map", "generation", "fitness", "network")}
    body["player"] = player
    req = urllib.request.Request(
        api.rstrip("/") + "/api/brains",
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json", "X-Terra-Player": player},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read())["id"]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("brain", type=Path, help="brain JSON (an exported file or a bare network)")
    ap.add_argument("--out", type=Path, help="re-export to this path (normalises the format)")
    ap.add_argument("--name", help="name shown in the brain library")
    ap.add_argument("--world", type=Path, default=WORLDS_DIR / "brisbane.json", help="also score it with the JS engine")
    ap.add_argument("--publish", metavar="API_URL", help="POST to the API brain library, e.g. http://localhost:5080")
    a = ap.parse_args(argv)
    src = json.loads(a.brain.read_text())
    path = a.brain
    if a.out or a.name:
        doc = brain_document(to_flat(load_brain_file(a.brain)), a.name or src.get("name", a.brain.stem), src.get("generation", 0),
                             src.get("fitness", 0), src.get("map", "brisbane"), src.get("trainer"))
        path = write_brain(a.out or a.brain, doc)
    result = validate_with_js(path, a.world)
    scores = result.get("scores") or []
    print(f"valid for the browser: {path} ({result['bytes']} bytes, shape {result['shape']}); JS mean score {np.mean(scores):.3f} on {len(scores)} routes")
    if a.publish:
        print(f"published to {a.publish}: id {publish(path, a.publish)}")


if __name__ == "__main__":
    main()
