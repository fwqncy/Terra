"""The speed benchmark runs the app's own runEpisode in Node and must agree with C++ on every score."""
from terra_trainer.bench import bench, table


def test_node_runs_the_same_episodes_as_cpp():
    result = bench("goldcoast", n_brains=4, browser=False)  # raises if any score differs by > 1e-9
    runtimes = [r["runtime"] for r in result["runs"]]
    assert any(r.startswith("C++") for r in runtimes) and any(r.startswith("JS · node") for r in runtimes)
    assert all(r["car_steps_per_sec"] > 0 for r in result["runs"])
    assert "| Runtime |" in table(result)
