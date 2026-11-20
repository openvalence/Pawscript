"""paw-vdr4 / paw-uekm: CoTracker3 is not part of Pawscript (CC-BY-NC 4.0). The public source and code.zip have neither the
`cotracker` package nor its glue module (pawtrack/trackers/cotracker_points.py stays in the private repo). Without them
nothing errors: CoTracker3 is simply not listed, a track request naming it says so plainly, TAPNext++ tracks, and an old
CoTracker run's data still reads. The glue module's own tests are private too (test_cotracker_glue.py)."""
import inspect
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pawtrack
from test_cli import video  # noqa: F401 (fixture)


class NoCotracker:
    """A meta path finder that makes `import cotracker` fail, as in the public runtime (no such package)."""
    def find_spec(self, name, path=None, target=None):
        if name == "cotracker" or name.startswith("cotracker."):
            raise ModuleNotFoundError(f"No module named {name!r}", name=name)


BLOCK = "import sys\n" + inspect.getsource(NoCotracker) + "sys.meta_path.insert(0, NoCotracker())\n"


def test_list_in_a_runtime_without_the_package():
    """The real list command in a fresh interpreter that cannot import cotracker: listed without it, nothing imports it."""
    code = BLOCK + "from pawtrack.cli import main; main(); import sys; print('LOADED', 'cotracker' in sys.modules, file=sys.stderr)"
    p = subprocess.run([sys.executable, "-c", code], input=json.dumps({"cmd": "list"}), capture_output=True, text=True,
                       encoding="utf-8")
    assert p.returncode == 0, p.stderr
    ids = {t["id"] for t in json.loads(p.stdout.splitlines()[-1])["trackers"]}
    assert "cotracker_points" not in ids and {"tapnext_points", "lk_box", "template"} <= ids
    assert "LOADED False" in p.stderr


# Run inside a copy of the pawtrack package without cotracker_points.py (the published tree); argv[1] = the synthetic video.
# The cotracker package may well be installed here: without the module it must not matter.
WITHOUT_GLUE = r"""
import sys
from pathlib import Path
import numpy as np
import pawtrack
assert Path(pawtrack.__file__).parent == Path.cwd() / "pawtrack", pawtrack.__file__
assert not (Path.cwd() / "pawtrack" / "trackers" / "cotracker_points.py").exists()
import make_video as mv
from test_points_cotracker import ON_BLOB, corr
from pawtrack import cli, motion
from pawtrack.trackers import tapnext_points as T

# list (the app's tracker list and the fallback's input): no CoTracker3, TAPNext++ there and marked GPU
ts = {t["id"]: t for t in cli.cmd_list({}, lambda e: None)["trackers"]}
assert "cotracker_points" not in ts and {"tapnext_points", "sam2_mask", "lk_box", "template"} <= ts.keys(), sorted(ts)
assert ts["tapnext_points"]["gpu"] and not ts["lk_box"]["gpu"]

# a request naming it: the plain error, as before
try:
    cli._track({"tracker": "cotracker_points"}, None, None)
    raise AssertionError("no error")
except ValueError as e:
    assert "CoTracker3 is not installed" in str(e), e

# a TAPNext++ track through the real pipeline, the model replaced by a runner whose points ride the blob
def fake(fr, seed, model="256", chunk=8, reseed=None):
    t0 = None
    for t, img in fr:
        t0 = t if t0 is None else t0
        xy = seed + [0.0, (mv.blob_y(t / 1000) - mv.blob_y(t0 / 1000)) / mv.H]
        yield t, xy, np.ones(len(seed), bool), np.ones(len(seed)), np.ones(len(seed))
T.run_tapnext = fake
ev = []
dur = mv.N * 1000 // mv.FPS
res = cli.cmd_track({"video": sys.argv[1], "tracker": "tapnext_points", "start_ms": 0, "end_ms": dur, "roi": ON_BLOB,
                     "params": {"axis": "vertical", "model": "256"}}, ev.append)
assert len([e for e in ev if e["type"] == "frame"]) == mv.N
first = [p for p in res["samples"] if p[0] < mv.CUT_FRAME * 1000 / mv.FPS]
assert corr(first, lambda t: -mv.blob_y(t / 1000)) > 0.95

# an old CoTracker run: its stored series reads like any other (run data does not depend on the tracker)
t = np.arange(0, 6000, 1000 / 30)
s = {"id": "run3", "role": "subject", "tracker": "cotracker_points", "channel": "proj", "t": t.tolist(),
     "v": np.sin(2 * np.pi * 1.25 * t / 1000).tolist()}
r = motion.compare([s], 0, 6000)["series"][0]
assert r["tracker"] == "cotracker_points" and abs(r["turns_per_s"] - 2.5) < 0.2

loaded = [m for m in sys.modules if m.split(".")[0] == "cotracker" or m.endswith(".cotracker_points")]
assert not loaded, loaded
print("OK")
"""


def test_everything_works_without_the_glue_module(tmp_path, video):
    root = tmp_path / "public"
    shutil.copytree(Path(pawtrack.__file__).parent, root / "pawtrack",
                    ignore=shutil.ignore_patterns("__pycache__", "cotracker_points.py"))
    env = {**os.environ, "PYTHONPATH": str(Path(__file__).parent), "CUDA_VISIBLE_DEVICES": "-1"}
    p = subprocess.run([sys.executable, "-c", WITHOUT_GLUE, video], cwd=root, env=env, capture_output=True, text=True,
                       encoding="utf-8")
    assert p.returncode == 0 and p.stdout.strip().endswith("OK"), p.stderr[-3000:]
