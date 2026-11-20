"""pawtrack.camera on synthetic 160 px frame sequences (CPU): the classifier's kinds, held frames, the split rule, the
scenes command's camera segments; pipeline.rolling_axes (the turntable's rolling stroke axis)."""
import json

import cv2
import numpy as np
import pytest

import make_video as mv
from pawtrack import camera as C
from pawtrack.pipeline import pca_axis, project_auto, rolling_axes
from test_cli import run

FPS, N, W, H = 30, 90, 160, 90
RNG = np.random.default_rng(7)
BIG = cv2.GaussianBlur((RNG.random((600, 900)) * 255).astype(np.uint8), (0, 0), 1.5)
PATCH = cv2.GaussianBlur((np.random.default_rng(8).random((H // 2, W // 2)) * 255).astype(np.uint8), (0, 0), 1.5)


def crop(x, y, s=1.0):
    """160 x 90 grey view of BIG centred at (300 + x, 250 + y), s = zoom (> 1 = in)."""
    M = np.float32([[s, 0, W / 2 - s * (300 + x)], [0, s, H / 2 - s * (250 + y)]])
    return cv2.warpAffine(BIG, M, (W, H), flags=cv2.INTER_LINEAR)


def kinds(frames):
    det = C.CameraDetector()
    for i, f in enumerate(frames):
        det(round(i * 1000 / FPS), cv2.cvtColor(f, cv2.COLOR_GRAY2BGR))
    t, m = det.motion()
    return C.classify(t, m, round(len(frames) * 1000 / FPS)), m


def only(segs):
    return C.dominant(segs), {s["kind"] for s in segs}


def test_static():
    segs, _ = kinds([crop(0, 0) for _ in range(N)])
    assert only(segs) == ("static", {"static"})


def test_pan_direction_and_amount():
    segs, _ = kinds([crop(1.5 * i, 0) for i in range(N)])  # the view moves right: content moves left
    s = max(segs, key=lambda s: s["t1"] - s["t0"])
    assert s["kind"] == "pan" and s["dir"] == "right"
    assert s["amount"] == pytest.approx(1.5 * (s["t1"] - s["t0"]) * FPS / 1000 / W, rel=0.25)


def test_tilt_is_a_pan_up_or_down():
    segs, _ = kinds([crop(0, -1.0 * i) for i in range(N)])  # the view moves up: content moves down
    s = max(segs, key=lambda s: s["t1"] - s["t0"])
    assert s["kind"] == "pan" and s["dir"] == "up"


def test_zoom_in():
    segs, _ = kinds([crop(0, 0, 1.01 ** i) for i in range(N)])
    s = max(segs, key=lambda s: s["t1"] - s["t0"])
    assert s["kind"] == "zoom" and s["dir"] == "in" and s["amount"] > 1.2


def test_pan_on_twos_is_spread_over_the_held_frames():
    frames = [crop(3.0 * (i // 2), 0) for i in range(N)]  # a new drawing every second frame
    segs, m = kinds(frames)
    assert C.dominant(segs) == "pan"
    dx = m[2:-2, 0] * W
    assert np.allclose(dx, -1.5, atol=0.15)  # 0, 3, 0, 3 px -> a steady 1.5 px per frame


def test_handheld_jitter():
    j = np.random.default_rng(3).normal(0, 2.5, (N, 2))
    segs, _ = kinds([crop(*j[i]) for i in range(N)])
    assert C.dominant(segs) == "handheld"


def test_reciprocal_bob():
    segs, _ = kinds([crop(0, 5 * np.sin(2 * np.pi * 1.5 * i / FPS)) for i in range(N)])
    s = max(segs, key=lambda s: s["t1"] - s["t0"])
    assert s["kind"] == "reciprocal" and s["dir"] == "vertical"


def test_orbit_border_streams_centre_stays():
    def frame(i):
        f = crop(2.0 * i, 0)
        f[H // 4:H // 4 + H // 2, W // 4:W // 4 + W // 2] = PATCH  # the subject stays put while the background streams
        return f
    segs, _ = kinds([frame(i) for i in range(N)])
    s = max(segs, key=lambda s: s["t1"] - s["t0"])
    assert s["kind"] == "orbit" and s["dir"] == "right"


def test_short_scene_is_static():
    segs, _ = kinds([crop(3.0 * i, 0) for i in range(20)])  # < NET_MS: too short to tell
    assert only(segs) == ("static", {"static"})


class FakeCam:
    def __init__(self, segs):
        self.segs = segs

    def segments(self, a, b):
        return [{**s, "t0": max(a, s["t0"]), "t1": min(b, s["t1"])} for s in self.segs if s["t1"] > a and s["t0"] < b]


HARD = [{"start_ms": 0, "end_ms": 10000}, {"start_ms": 10000, "end_ms": 12000}]


def test_split_rule():
    segs = [{"t0": 0, "t1": 3000, "kind": "static"}, {"t0": 3000, "t1": 5000, "kind": "pan", "dir": "left"},
            {"t0": 5000, "t1": 9000, "kind": "static"}, {"t0": 9000, "t1": 12000, "kind": "static"}]
    out = C.split_scenes(HARD, FakeCam(segs), 500)
    # a pan inside the shot splits it at the move's start and end; the second hard-cut scene stays whole
    assert [(s["start_ms"], s["end_ms"]) for s in out] == [(0, 3000), (3000, 5000), (5000, 10000), (10000, 12000)]
    assert [bool(s.get("continues")) for s in out] == [False, True, True, False]
    cam = FakeCam([{"t0": 0, "t1": 3000, "kind": "static"}, {"t0": 3000, "t1": 3300, "kind": "pan", "dir": "left"},
                   {"t0": 3300, "t1": 5300, "kind": "static"}, {"t0": 5300, "t1": 9000, "kind": "reciprocal"},
                   {"t0": 9000, "t1": 12000, "kind": "static"}])
    out = C.split_scenes(HARD, cam, 500)
    # the cut at the move's end would leave a 300 ms piece (< min scene): dropped; static <-> reciprocal never splits
    assert [(s["start_ms"], s["end_ms"]) for s in out] == [(0, 3000), (3000, 10000), (10000, 12000)]
    assert "continues" not in out[0] and out[1]["continues"] is True and out[1]["split"] == "camera"
    assert "continues" not in out[2] and "split" not in out[2]
    assert [s["kind"] for s in out[1]["camera"]] == ["pan", "static", "reciprocal", "static"]
    assert out[1]["camera"][0]["t0"] == 3000 and out[1]["camera"][-1]["t1"] == 10000


def test_scenes_command_reports_camera_segments(tmp_path):
    v = str(mv.make(tmp_path / "s.mp4"))
    code, ev, err = run({"cmd": "scenes", "video": v, "params": {}})
    assert code == 0, err
    sc = ev[-1]["scenes"]
    assert all(isinstance(s["camera"], list) for s in sc)
    assert all(g["kind"] in C.KINDS and s["start_ms"] <= g["t0"] < g["t1"] <= s["end_ms"] for s in sc for g in s["camera"])
    code, ev2, err = run({"cmd": "scenes", "video": v, "params": {"cut_camera": False}})
    assert code == 0, err
    assert not any(s.get("split") for s in ev2[-1]["scenes"])
    json.dumps(ev[-1])


def test_rolling_axis_is_byte_identical_when_the_axis_holds():
    t = np.arange(600) / 30
    xy = np.c_[0.3 * np.sin(2 * np.pi * t), 1.0 * np.sin(2 * np.pi * t)] + np.random.default_rng(1).normal(0, 0.01, (600, 2))
    assert rolling_axes(xy) is None
    assert np.array_equal(project_auto(xy), (xy - xy.mean(0)) @ pca_axis(xy))


def test_rolling_axis_follows_a_turning_stroke():
    t = np.arange(900) / 30
    ang = np.radians(360 * t / t[-1])  # the stroke axis turns a full circle over the scene (a turntable)
    s = np.sin(2 * np.pi * 1.2 * t)
    xy = np.c_[np.cos(ang) * s, np.sin(ang) * s]
    r = rolling_axes(xy)
    assert r is not None
    rolled = ((xy - r[1]) * r[0]).sum(1)
    fixed = (xy - xy.mean(0)) @ pca_axis(xy)
    assert abs(np.corrcoef(rolled, s)[0, 1]) > 0.95 > abs(np.corrcoef(fixed, s)[0, 1])
