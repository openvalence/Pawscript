"""PROTOCOL v4.9 soft cuts: normalisation per segment and camera-trend removal (pipeline.cam_detrend), cut parsing.
CPU only. The tracker side (re-seed at a soft cut) is in test_reseed.py."""
import json

import numpy as np
import pytest

from pawtrack.cli import parse_cuts, process_scene
from pawtrack.pipeline import PIPE_PARAMS, cam_detrend, local_normalize, stroke_period
from pawtrack.registry import coerce
from pawtrack.loops import FOLD_PARAMS
from pawtrack.score import score

FPS = 30
P = coerce(PIPE_PARAMS + FOLD_PARAMS, {})
T = np.arange(0, 12000, 1000 / FPS)
F = 1.4  # strokes / s
THRUST = 0.03 * np.sin(2 * np.pi * F * T / 1000)  # frame heights: the stroke (peak speed 0.26 fh/s)
PAN = 2.0 * np.clip((T - 3000) / 6000, 0, 1)      # the camera carries the blob 2 frame heights over 3..9 s (0.33 fh/s)
CAMERA = [{"t0": 0, "t1": 3000, "kind": "static"}, {"t0": 3000, "t1": 9000, "kind": "pan"},
          {"t0": 9000, "t1": 12000, "kind": "static"}]
SOFT = [3000, 9000]
TRUTH = [{"at": int(round(t)), "pos": 100 if k % 2 == 0 else 0}
         for k, t in enumerate(1000 * (0.25 + np.arange(0, 12 * 2 * F) / 2) / F) if t < 12000]


def _norm(x):
    return (x - x.min()) / np.ptp(x)


def _share(pts, a, b):
    """Stroke amplitude / output range over [a, b): mean |step| of the points' turns over their p95 - p5 span."""
    pos = np.array([q["pos"] for q in pts if a <= q["at"] < b], float)
    return np.mean(np.abs(np.diff(pos))) / max(np.ptp(pos), 1e-9) if len(pos) > 3 else 0.0


def _run(**kw):
    v = _norm(THRUST + PAN)
    dec = {}
    out, pts, _ = process_scene(list(T), v, [], P, [], dec, **kw)
    return out, pts, dec


def _f1(pts, a=3000, b=9000):
    return score(pts, TRUTH, a, b, FPS)["f1"]


def test_pan_drowns_thrusts_before():
    pan = (T >= 3000) & (T < 9000)
    x = (THRUST + PAN)[pan]
    assert np.ptp(THRUST) / np.subtract(*np.percentile(x, [95, 5])) < 0.2  # the pan sets the range: thrusts are ripples
    _, pts, _ = _run()
    assert _f1(pts) < 0.3  # and the pan's speed swallows the turns


@pytest.mark.parametrize("cam", [True, False])
def test_pan_detrended_after(cam):
    """The pan segment's primary keeps its thrusts: share > 0.6 after (< 0.2 before), turns match the truth."""
    chans = {"cam_x": PAN.tolist(), "cam_y": [0.0] * len(T), "cam_conf": [0.8 if cam else 0.0] * len(T),
             "raw_px": None}
    out, pts, dec = _run(soft=SOFT, camera=CAMERA, chans=chans)
    seg = dec["segments"]
    assert [s["kind"] for s in seg] == ["static", "pan", "static"]
    pan = seg[1]
    assert pan["detrend"] == ("cam" if cam else "trend") and pan["why"] == "camera pan"
    assert pan["share_before"] < 0.2 and pan["share_after"] > 0.6, pan
    assert seg[0]["detrend"] is None and seg[2]["detrend"] is None
    _, pts0, dec0 = _run()
    assert "segments" not in dec0
    assert _f1(pts) >= 0.9 and _f1(pts) > _f1(pts0) + 0.2, (_f1(pts), _f1(pts0))
    # no step at the soft cuts: the samples stay continuous across them
    for c in SOFT:
        i = int(np.searchsorted(T, c))
        assert abs(out[i] - out[i - 1]) < 0.1


def test_camera_travel_without_detector_kind():
    """The detector says static, the tracker's camera path travels > 1.5 x the stroke: progressive by travel."""
    chans = {"cam_x": PAN.tolist(), "cam_y": [0.0] * len(T), "cam_conf": [0.8] * len(T), "raw_px": None}
    _, pts, dec = _run(camera=[{"t0": 0, "t1": 12000, "kind": "static"}], chans=chans)
    assert dec["segments"][0]["why"] == "camera travel" and dec["segments"][0]["detrend"] == "cam"
    assert _f1(pts) >= 0.9


def test_static_scene_untouched():
    """No camera travel, no soft cut: the v4.8 output exactly; a reciprocal camera is never detrended."""
    v = _norm(THRUST + 0.002 * np.sin(T / 3000))
    base = process_scene(list(T), v.copy(), [], P, [], {})
    for kw in ({"camera": [{"t0": 0, "t1": 12000, "kind": "static"}]},
               {"camera": [{"t0": 0, "t1": 12000, "kind": "reciprocal"}],
                "chans": {"cam_x": (0.04 * np.sin(2 * np.pi * F * T / 1000)).tolist(), "cam_y": [0.0] * len(T),
                          "cam_conf": [0.9] * len(T), "raw_px": None}}):
        dec = {}
        got = process_scene(list(T), v.copy(), [], P, [], dec, **kw)
        assert json.dumps(got[1]) == json.dumps(base[1]) and "segments" not in dec
    assert np.array_equal(cam_detrend(T, v, (), None, None, P), v)
    assert process_scene(list(T), v.copy(), [], {**P, "pipe_cam_detrend": False}, [], {},
                         camera=CAMERA, chans=None)[1] == process_scene(list(T), v.copy(), [], P, [], {}, soft=())[1]


def test_segment_ranges_and_blend():
    """Each soft-cut segment has its own robust range; the ranges cross-fade, so no step at the cut."""
    v = np.r_[0.5 + 0.05 * np.sin(np.arange(300) / 4), 0.5 + 0.4 * np.sin(np.arange(300) / 4)]
    one = local_normalize(v, 0)  # the whole scene's p5..p95
    two = local_normalize(v, 0, [300], 15)
    assert np.std(two[:250]) > 3 * np.std(one[:250])  # the small strokes get their own range
    assert np.max(np.abs(np.diff(two[280:320]))) < 0.3
    assert np.array_equal(local_normalize(v, 90, []), local_normalize(v, 90))  # no start: the v4.8 path
    seg0 = local_normalize(v, 0, [300])
    assert seg0[:300].max() == 1.0 and seg0[300:].min() == 0.0


def test_stroke_period():
    assert abs(stroke_period(THRUST + PAN, 1000 / FPS) - FPS / F) <= 1
    assert stroke_period(np.zeros(100), 33.3) is None


def test_parse_cuts():
    assert parse_cuts([1000, {"t_ms": 2000, "kind": "soft", "why": "camera: pan"}, {"t_ms": 3000, "kind": "hard"},
                       {"t_ms": 500}]) == ([1000.0, 3000.0, 500.0], [2000.0])
    for bad in ([{"t_ms": 1, "kind": "fade"}], ["1000"], [{"kind": "soft"}], [True]):
        with pytest.raises(ValueError):
            parse_cuts(bad)


# ---- through the real stdin / stdout contract (lk_box on the synthetic clip: no camera, no models) ----
from test_cli import BOX, DUR_MS, run, video  # noqa: E402,F401 (video: the session fixture)


def _track(video, cuts):
    code, ev, err = run({"cmd": "track", "video": video, "tracker": "lk_box", "start_ms": 0, "end_ms": DUR_MS, "roi": BOX,
                         "params": {}, "cuts": cuts})
    assert code == 0, err
    return ev[-1]


def test_hard_cuts_unchanged(video):
    """Plain numbers and {kind: hard} are the same request, byte for byte (the v4.8 hard-cut path)."""
    a = _track(video, [1010, 7000])
    b = _track(video, [{"t_ms": 1010, "kind": "hard"}, {"t_ms": 7000}])
    assert json.dumps(a) == json.dumps(b)
    assert [s["start_ms"] for s in a["scenes"]] == [0, 1033, 7000]


def test_soft_cut_keeps_the_run(video):
    """A soft cut is no scene: no restart, no flagged frame; the scene list is the hard cuts'."""
    hard = _track(video, [7000])
    soft = _track(video, [{"t_ms": 2000, "kind": "soft", "why": "camera: pan"}, 7000])
    assert [s["start_ms"] for s in soft["scenes"]] == [s["start_ms"] for s in hard["scenes"]] == [0, 7000]
    nulls = lambda r: [t for t, v in r["samples"] if v is None]
    assert nulls(soft) == nulls(hard)
    code, ev, _ = run({"cmd": "track", "video": video, "tracker": "lk_box", "start_ms": 0, "end_ms": DUR_MS, "roi": BOX,
                       "params": {}, "cuts": [{"t_ms": 2000, "kind": "fade"}]})
    assert code == 1 and ev[-1]["type"] == "error" and "cuts" in ev[-1]["message"]
