"""paw-cdot: the app starts the sidecar with PAWTRACK_MODELS (Settings > Models); every loader looks there, else in
trackers/ as before."""
import os
import subprocess
import sys
from pathlib import Path

PROBE = ("import pawtrack.points as p, pawtrack.trackers.sam2_mask as s, pawtrack.describe as d, pawtrack.taggerine as t;"
         "print(p.CACHE, s.CACHE, d.MODEL_DIR, t.CACHE, sep='|')")


def _paths(env):
    out = subprocess.run([sys.executable, "-c", PROBE], env=env, capture_output=True, text=True, check=True,
                         cwd=Path(__file__).resolve().parents[1])
    return [Path(x) for x in out.stdout.strip().split("|")]


def test_models_folder_from_the_app(tmp_path):
    env = {**os.environ, "PAWTRACK_MODELS": str(tmp_path)}
    assert _paths(env) == [tmp_path / ".cache", tmp_path / ".cache" / "sam2", tmp_path / ".models" / "hydra",
                           tmp_path / ".cache" / "taggerine"]


def test_without_it_trackers_as_before():
    env = {k: v for k, v in os.environ.items() if k != "PAWTRACK_MODELS"}
    trackers = Path(__file__).resolve().parents[1]
    assert _paths(env)[0] == trackers / ".cache"
