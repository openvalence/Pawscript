"""v4.15 track direction: the range cut at the seed (cli.clamp_direction), the one-way stop where points are lost
(points.lost_stop), and a forward track through the real stdin / stdout contract."""
import json
import subprocess
import sys
from types import SimpleNamespace

import numpy as np
import pytest

import make_video as mv
from pawtrack.cli import clamp_direction
from pawtrack.points import LOST_MS, lost_stop

POINTS = SimpleNamespace(id="cotracker_points", params=[{"key": "seed_frame"}])
BOX_TRACKER = SimpleNamespace(id="lk_box", params=[{"key": "axis"}])
ROI = {"kind": "box", "x": 0.1, "y": 0.1, "w": 0.5, "h": 0.5}


def test_clamp_direction():
    req = {"start_ms": 1000, "end_ms": 9000}
    assert clamp_direction(req, POINTS, ROI, {}) == (1000, 9000, ROI, {})
    a, b, roi, p = clamp_direction({**req, "direction": "backward", "seed_ms": 4000}, POINTS, ROI, {})
    assert (a, b, roi["t_ms"], p["direction"]) == (1000, 4001, 4000, "backward")
    a, b, roi, p = clamp_direction({**req, "direction": "forward"}, BOX_TRACKER, {**ROI, "t_ms": 5000}, {})
    assert (a, b, roi["t_ms"], p["direction"]) == (5000, 9000, 5000, "forward")
    a, b, roi, _ = clamp_direction({**req, "direction": "backward", "seed_ms": 4000}, BOX_TRACKER, ROI, {})   # v4.22: any tracker
    assert (a, b, roi["t_ms"]) == (1000, 4001, 4000)
    with pytest.raises(ValueError, match="seed_ms"):
        clamp_direction({**req, "direction": "forward"}, POINTS, ROI, {})
    with pytest.raises(ValueError, match="outside"):
        clamp_direction({**req, "direction": "forward", "seed_ms": 9500}, POINTS, ROI, {})
    with pytest.raises(ValueError, match="direction"):
        clamp_direction({**req, "direction": "sideways", "seed_ms": 2000}, POINTS, ROI, {})


def vis_rows(n=120, pts=20, lost=()):
    ts = np.round(np.arange(n) * 1000 / 30)
    V = np.ones((n, pts), bool)
    for a, b, cols in lost:
        V[a:b, cols] = False
    return list(V), ts


def test_lost_stop_walks_from_the_seed():
    vis, ts = vis_rows(lost=[(0, 30, slice(None))])            # the pan before the action: nothing tracked before row 30
    assert lost_stop(vis, ts, ts[100], "backward", None, 20) == (30, 120)
    vis, ts = vis_rows(lost=[(90, 120, slice(None))])
    assert lost_stop(vis, ts, ts[10], "forward", None, 20) == (0, 90)
    vis, ts = vis_rows(lost=[(40, 45, slice(None))])            # a short occlusion (< LOST_MS) is not a loss
    assert LOST_MS > 5 * 1000 / 30 and lost_stop(vis, ts, ts[100], "backward", None, 20) is None
    vis, ts = vis_rows(lost=[(0, 30, slice(0, 4))])             # the pinned group (points 0..3) lost, the rest seen
    sem = np.array([1] * 4 + [0] * 16)
    assert lost_stop(vis, ts, ts[100], "backward", sem, 20) == (30, 120)
    assert lost_stop(vis, ts, ts[100], "backward", None, 20) is None
    vis, ts = vis_rows(lost=[(0, 120, slice(None))])            # lost at the seed itself: keep everything
    assert lost_stop(vis, ts, ts[100], "backward", None, 20) is None


@pytest.fixture(scope="session")
def video(tmp_path_factory):
    return str(mv.make(tmp_path_factory.mktemp("v") / "synthetic.mp4"))


def test_forward_track_starts_at_the_seed(video):
    box = {"kind": "box", "x": (mv.CX - 25) / mv.W, "y": (mv.CY - 25) / mv.H, "w": 50 / mv.W, "h": 50 / mv.H}
    req = {"cmd": "track", "video": video, "tracker": "lk_box", "start_ms": 0, "end_ms": 3000, "roi": box, "params": {},
           "cuts": [], "direction": "forward", "seed_ms": 1500}
    p = subprocess.run([sys.executable, "-c", "from pawtrack.cli import main; main()"], input=json.dumps(req),
                       capture_output=True, text=True, encoding="utf-8")
    assert p.returncode == 0, p.stderr
    res = [json.loads(x) for x in p.stdout.splitlines()][-1]
    ts = [t for t, _ in res["samples"]]
    assert ts[0] >= 1500 - 1 and ts[0] < 1500 + 40 and ts[-1] <= 3000
    req["direction"] = "backward"
    p = subprocess.run([sys.executable, "-c", "from pawtrack.cli import main; main()"], input=json.dumps(req),
                       capture_output=True, text=True, encoding="utf-8")
    assert p.returncode == 0, p.stderr   # v4.22: every tracker runs backward (the video played in reverse from the seed)
    ts = [t for t, _ in [json.loads(x) for x in p.stdout.splitlines()][-1]["samples"]]
    assert ts[0] <= 40 and 1500 - 40 < ts[-1] <= 1500
