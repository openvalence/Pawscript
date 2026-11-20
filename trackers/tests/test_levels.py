"""PROTOCOL v4.23: auto levels for the frames the trackers see (pawtrack/levels.py), CPU, no models."""
import json
from fractions import Fraction

import cv2
import numpy as np
import pytest

import make_video as mv
from pawtrack import cli, levels
from pawtrack.levels import apply_levels, auto_levels, levelled


def scene(lo, hi, n=8, seed=0, bgr=(1, 1, 1), size=(90, 160)):
    """Frames of a gradient + noise between lo and hi, tinted bgr (1 = grey)."""
    rng = np.random.default_rng(seed)
    out = []
    for k in range(n):
        g = np.tile(np.linspace(lo, hi, size[1]), (size[0], 1)) + rng.normal(0, 1.5, size)
        out.append(np.clip(np.dstack([g * c for c in bgr]), 0, 255).astype(np.uint8))
    return out


def test_dark_low_contrast_is_stretched_with_caps_honoured():
    adj, rec = auto_levels(scene(3, 15))
    assert rec["applied"] and rec["gain"] == levels.MAX_GAIN and "gain" in rec["capped"]
    assert rec["gamma"] >= levels.GAMMA_RANGE[0]
    assert apply_levels(scene(3, 15)[0], adj).mean() > 2 * scene(3, 15)[0].mean()
    assert rec["lift"] <= levels.MAX_GAIN + 0.1                      # no midtone lifted past the total gain cap


def test_normal_footage_is_identity():
    adj, rec = auto_levels(scene(8, 248))
    assert adj is None and rec["applied"] is False and rec["why"] == "unchanged"
    f = scene(8, 248)[0]
    assert apply_levels(f, None) is f


def test_greyscale_gets_no_saturation_and_colour_does():
    assert auto_levels(scene(60, 200))[0] is None or auto_levels(scene(60, 200))[0]["sat"] == 1.0
    tint = (0.9, 0.95, 1.0)
    adj, rec = auto_levels(scene(20, 90, bgr=tint))
    assert 1.0 < adj["sat"] <= levels.MAX_SAT
    f = scene(20, 90, bgr=tint)[0]
    h = lambda im: int(np.median(cv2.cvtColor(im, cv2.COLOR_BGR2HSV)[..., 0]))
    assert abs(h(apply_levels(f, adj)) - h(f)) <= 2                 # hue kept
    adj, _ = auto_levels(scene(20, 90))                             # grey: the luma moves, the colour does not
    assert adj["sat"] == 1.0


def test_letterbox_bars_are_ignored():
    bare = scene(10, 90)
    boxed = []
    for f in bare:
        g = np.zeros((150, 160, 3), np.uint8)
        g[30:120] = f
        boxed.append(g)
    _, ra = auto_levels(bare)
    _, rb = auto_levels(boxed)
    assert abs(ra["p1"] - rb["p1"]) <= 3 and abs(ra["gamma"] - rb["gamma"]) < 0.1


def test_a_single_bright_speck_does_not_set_the_white_point():
    fr = scene(10, 60)
    for f in fr:
        f[40:42, 80:82] = 255
    _, rec = auto_levels(fr)
    assert rec["p99_5"] < 100


def test_pure_black_frames_are_skipped():
    _, rec = auto_levels(scene(0, 0, n=3) + scene(10, 50, n=3))
    assert rec["frames"] == 3 and rec["applied"]
    assert auto_levels(scene(0, 0, n=3))[1]["why"] == "no usable frames"


def test_wrapper_applies_one_lut_to_every_frame_and_scenes_differ():
    adj, _ = auto_levels(scene(3, 15))
    fr = scene(10, 50, n=5, seed=3)
    out = list(levelled(((k, f) for k, f in enumerate(fr)), adj))
    for (_, o), f in zip(out, fr):
        assert np.array_equal(o, cv2.LUT(f, adj["lut"]))
    adj2, _ = auto_levels(scene(60, 200))
    assert adj2 is None or not np.array_equal(adj["lut"], adj2["lut"])


# --- through cmd_track -------------------------------------------------------------------------------------------

@pytest.fixture(scope="module")
def dark_video(tmp_path_factory):
    """The synthetic clip with its two scenes scaled to 40 % and 70 % brightness."""
    import av
    src = mv.make(tmp_path_factory.mktemp("d") / "src.mp4")
    dst = tmp_path_factory.mktemp("d2") / "dark.mp4"
    with av.open(str(src)) as i, av.open(str(dst), "w") as o:
        s = o.add_stream("mpeg4", rate=mv.FPS)
        s.width, s.height, s.pix_fmt = mv.W, mv.H, "yuv420p"
        s.codec_context.time_base = Fraction(1, mv.FPS)
        s.codec_context.bit_rate = 8_000_000
        for n, f in enumerate(i.decode(video=0)):
            k = 0.4 if n < mv.CUT_FRAME else 0.7
            g = av.VideoFrame.from_ndarray((f.to_ndarray(format="bgr24") * k).astype(np.uint8), format="bgr24")
            g.pts, g.time_base = n, Fraction(1, mv.FPS)
            o.mux(s.encode(g))
        o.mux(s.encode())
    return str(dst)


def run(video, params=None, tracker="lk_box", end=9000, roi=None, **kw):
    box = {"kind": "box", "x": (mv.CX - 25) / mv.W, "y": (mv.CY - 25) / mv.H, "w": 50 / mv.W, "h": 50 / mv.H, **(roi or {})}
    return cli.cmd_track({"cmd": "track", "video": video, "tracker": tracker, "start_ms": 0, "end_ms": end, "roi": box,
                          "params": params or {}, "cuts": [5000], **kw}, lambda e: None)


def test_each_scene_gets_its_own_adjustment_and_off_is_raw(dark_video):
    res = run(dark_video)
    a, b = (s["input"] for s in res["scenes"])
    assert a["applied"] and b["applied"] and a["mode"] == "auto"
    assert (a["black"], a["white"], a["gamma"]) != (b["black"], b["white"], b["gamma"])
    off = run(dark_video, {"input_levels": "off"})
    assert [s["input"] for s in off["scenes"]] == [{"applied": False, "mode": "off"}] * 2


def test_off_feeds_the_original_bytes_and_auto_one_adjustment_per_scene(dark_video, monkeypatch):
    seen = []
    real = cli.apply_levels
    monkeypatch.setattr(cli, "apply_levels", lambda img, adj: (seen.append(adj), real(img, adj))[1])
    run(dark_video, {"input_levels": "off"}, end=1000)
    assert seen and all(a is None for a in seen)
    seen.clear()
    run(dark_video, end=1000)
    assert seen and all(a is not None for a in seen) and all(a is seen[0] for a in seen)


def test_both_ways_with_lk_box_gives_one_row_per_frame_in_order(dark_video):
    res = run(dark_video, roi={"t_ms": 1500, "y": (mv.blob_y(1.5) - 25) / mv.H}, end=3000)
    ts = [t for t, _ in res["samples"]]
    assert ts == sorted(set(ts)) and ts[0] <= 40 and ts[-1] >= 2960
    assert res["scenes"][0]["input"]["applied"]


def test_levels_leave_coordinates_alone(dark_video):
    on, off = run(dark_video), run(dark_video, {"input_levels": "off"})
    a = np.array([v for _, v in on["samples"] if v is not None])
    b = np.array([v for _, v in off["samples"] if v is not None])
    assert len(a) == len(b) and np.corrcoef(a, b)[0, 1] > 0.9


def test_param_is_listed_with_every_tracker():
    res = cli.cmd_list({}, lambda e: None)
    assert all(any(q["key"] == "input_levels" and q["default"] == "auto" for q in t["params"]) for t in res["trackers"])
    json.dumps(res["trackers"][0]["params"])
