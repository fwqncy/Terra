"""PyTorch network parity with network.js, and brain export through the browser's own validator."""
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np
import pytest
import torch

from terra_trainer.brain import factory_brain, from_flat, to_flat
from terra_trainer.export import MAX_BYTES, brain_document, publish, validate_with_js, write_brain
from terra_trainer.net import StepNet
from terra_trainer.sim import ROOT, WORLDS_DIR, terra_sim


def js_forward(net, x):
    """network.js Level.feedForward, literally: sum over inputs, then `sum > bias`."""
    for l in net["levels"]:
        out = []
        for i in range(len(l["biases"])):
            s = 0.0
            for j in range(len(x)):
                s += x[j] * l["weights"][j][i]
            out.append(1.0 if s > l["biases"][i] else 0.0)
        x = out
    return x


def test_stepnet_round_trips_the_flat_layout():
    flat = to_flat(factory_brain())
    net = StepNet.from_flat(flat)
    assert np.array_equal(net.to_flat().numpy(), flat)


def test_stepnet_hard_forward_matches_the_js_rule():
    brain = factory_brain()
    net = StepNet.from_flat(to_flat(brain))
    rng = np.random.default_rng(0)
    xs = np.concatenate([rng.uniform(0, 1, (400, 7)), rng.uniform(-1, 1, (400, 3))], axis=1)
    got = net(torch.from_numpy(xs)).numpy()
    want = np.array([js_forward(brain, x) for x in xs])
    assert np.array_equal(got, want)
    # the smooth policy used by PPO agrees with the step policy at 0.5
    with torch.no_grad():
        soft = net(torch.from_numpy(xs), hard=False).numpy()
    assert np.array_equal(soft > 0.5, want > 0.5)


def test_export_is_accepted_by_the_browser_validator_and_scores_like_cpp(tmp_path):
    flat = to_flat(factory_brain())
    path = write_brain(tmp_path / "b.json", brain_document(flat, "Factory copy", 3, 1.1))
    result = validate_with_js(path, WORLDS_DIR / "goldcoast.json")
    assert result["valid"] and result["shape"] == [10, 8, 4]
    world = terra_sim.World((WORLDS_DIR / "goldcoast.json").read_text())
    cpp = world.run_episodes(flat)["score"][0]
    assert np.abs(np.asarray(result["scores"]) - cpp).max() < 1e-9
    doc = json.loads(path.read_text())
    assert {"name", "domain", "generation", "fitness", "network"} <= doc.keys() and doc["domain"] == "city"


def test_the_browser_validator_rejects_broken_brains(tmp_path):
    bad = factory_brain()
    bad["levels"][0]["weights"][0] = bad["levels"][0]["weights"][0][:-1]  # ragged row
    (tmp_path / "bad.json").write_text(json.dumps({"network": bad}))
    with pytest.raises(ValueError, match="rejected"):
        validate_with_js(tmp_path / "bad.json")
    with pytest.raises(ValueError):
        write_brain(tmp_path / "nan.json", {"network": {"levels": [{"inputs": [0], "outputs": [0], "biases": [float("nan")], "weights": [[1.0]]}]}})
    assert MAX_BYTES == 200_000


def test_shipped_trainer_brain_is_valid_and_drives_every_held_out_route():
    path = ROOT / "trainer" / "brains" / "terra-trainer-cmaes.json"
    assert validate_with_js(path)["valid"]
    from terra_trainer.sim import load_world, task_table

    world, docs = load_world()
    hold = np.array([t["task"] for t in task_table(world, docs) if t["holdout"]], np.int32)
    res = world.run_episodes(to_flat(json.loads(path.read_text())["network"]), tasks=hold)
    assert (res["outcome"] == terra_sim.ARRIVED).all()


def test_publish_posts_what_the_api_expects(tmp_path):
    seen = {}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            seen["path"] = self.path
            seen["player"] = self.headers["X-Terra-Player"]
            seen["body"] = json.loads(self.rfile.read(int(self.headers["content-length"])))
            self.send_response(201)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"id":"abc123"}')

        def log_message(self, *a):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        path = write_brain(tmp_path / "b.json", brain_document(to_flat(factory_brain()), "Pub", 1, 0.5))
        assert publish(path, f"http://127.0.0.1:{server.server_port}") == "abc123"
    finally:
        server.shutdown()
    assert seen["path"] == "/api/brains" and seen["player"] == "terra-trainer"
    assert seen["body"]["domain"] == "city" and "levels" in seen["body"]["network"]
    assert from_flat(to_flat(seen["body"]["network"]))
