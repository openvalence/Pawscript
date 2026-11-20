"""The point trackers' shared code (pawtrack/points.py): seeding and channel helpers, no model needed. The track checks
below (check_proj / check_blob / check_rod) are run on TAPNext++ by test_points_tapnext.py and on CoTracker3 by the
private test_cotracker_glue.py (paw-uekm); they need the model's extra and a CUDA GPU (deselect with -m "not gpu")."""
import importlib.util
import json

import numpy as np
import pytest

import make_video as mv
from pawtrack.points import CHANNELS, channels, seed_axis, seed_points, stroke_proj, translation, wrap
from test_cli import DUR_MS, TWO, run, video  # noqa: F401 (video = fixture)

BLOB_BOX = {"kind": "box", "x": (mv.CX - 28) / mv.W, "y": (mv.CY - 28) / mv.H, "w": 56 / mv.W, "h": 56 / mv.H}


def cuda_with(mod):
    if not (importlib.util.find_spec("torch") and importlib.util.find_spec(mod)):
        return False
    import torch
    return torch.cuda.is_available()


def gpu(mod):
    return lambda f: pytest.mark.gpu(pytest.mark.skipif(not cuda_with(mod), reason=f"needs the {mod} extra and CUDA")(f))


def test_seed_and_channels():
    pts, n = seed_points({"kind": "box", "x": 0.1, "y": 0.2, "w": 0.4, "h": 0.1}, {"box_seed": "grid", "box_points": 64})
    assert n == 0 and 50 <= len(pts) <= 80
    assert pts[:, 0].min() > 0.1 and pts[:, 0].max() < 0.5 and pts[:, 1].min() > 0.2 and pts[:, 1].max() < 0.3
    line, _ = seed_points({"kind": "box", "x": 0.1, "y": 0.2, "w": 0.1, "h": 0.4}, {"box_seed": "line", "box_points": 30})
    assert len(line) == 30 and np.ptp(line[:, 1]) > 3 * np.ptp(line[:, 0])  # along the long (vertical) side
    s = seed_axis(line, 16 / 9)
    vis = line[:, 1] < 0.4  # top half visible
    ch = channels(line, vis, s, 0, 16 / 9)
    assert ch["vis_frac"] == pytest.approx(0.5, abs=0.05) and ch["vis_extent"] == pytest.approx(0.5, abs=0.1)
    assert ch["dist01"] is None and ch["p3_x"] == pytest.approx(line[3, 0])
    ch2 = channels(line[:2], np.ones(2, bool), s[:2], 2, 16 / 9)
    assert ch2["dist01"] == pytest.approx(np.hypot(*((line[0] - line[1]) * [16 / 9, 1])))
    assert channels(line, np.zeros(len(line), bool), s, 0, 1.0)["vis_frac"] == 0


PARAMS = {"axis": "auto", "axis_x0": 0.5, "axis_y0": 0.3, "axis_x1": 0.5, "axis_y1": 0.7, "gap_ms": 1000}


def test_stroke_proj():
    t = np.arange(100) * 33.0
    y = 0.5 + 0.2 * np.sin(t / 300)
    c = np.stack([np.full(100, 0.4), y], 1)
    up = stroke_proj(t, c, 16 / 9, {**PARAMS, "axis": "vertical"})[0]
    assert np.corrcoef(up, -y)[0, 1] > 0.999 and up.min() == 0 and up.max() == 1
    down_is_in = stroke_proj(t, c, 16 / 9, {**PARAMS, "axis": "custom"})[0]  # (0.5,0.3) -> (0.5,0.7): down = in
    assert np.corrcoef(down_is_in, -y)[0, 1] > 0.999  # deeper (lower on screen) = lower value
    up_is_in = stroke_proj(t, c, 16 / 9, {**PARAMS, "axis": "custom", "axis_y0": 0.7, "axis_y1": 0.3})[0]
    assert np.corrcoef(up_is_in, -y)[0, 1] < -0.999
    auto = stroke_proj(t, c, 16 / 9, PARAMS)[0]
    assert abs(np.corrcoef(auto, y)[0, 1]) > 0.999
    gap = c.copy()
    gap[40:50] = np.nan  # 330 ms hidden: bridged
    gap[70:] = np.nan    # hidden to the end: not bridged
    pj, _, br, _ = stroke_proj(t, gap, 16 / 9, {**PARAMS, "axis": "vertical"})
    assert np.isfinite(pj[40:50]).all() and br[40:50].all() and np.isnan(pj[70:]).all() and not br[:40].any()
    seed = np.array([[0.4, 0.5], [0.5, 0.5]])
    xy = seed[None] + np.array([0.0, 0.1])[None, None]
    vis = np.array([[True, False]])
    assert np.allclose(translation(xy, vis, seed), [[0.45, 0.6]])  # seed centroid + visible displacement


def test_wrap_auto_choice():
    """wrap() with a fake tracker: clicks moving together -> proj; one click static -> dist01."""
    frames = [(i * 33, np.zeros((36, 64, 3), np.uint8)) for i in range(60)]
    p = {**PARAMS, "primary": "auto", "box_seed": "grid", "box_points": 16, "axis": "vertical"}

    def fake(still):
        def run(fr, seed):
            for k, (t, _) in enumerate(fr):
                xy = seed.copy()
                xy[:2, 1] += 0.1 * np.sin(k / 5)  # clicks 0 and 1 bob together (plus support points: static)
                if still:
                    xy[1] = seed[1]
                yield t, xy, np.ones(len(xy), bool), np.ones(len(xy)), np.ones(len(xy))
        return run
    roi = {"kind": "points", "points": [[0.5, 0.3], [0.5, 0.6]]}  # aligned with the motion
    out = list(wrap(fake(False), roi, frames, p, lambda vp, cf: 1.0, False))
    assert set(out[0][1]["channels"]) == set(CHANNELS) and out[0][1]["channels"]["primary_used"] == 0
    pts = out[5][2]["pts"]  # v3.1: every point, seed order, [x, y, visible, group]
    assert len(pts) == 2 and pts[1][0] == 0.5 and pts[0][2] == 1
    assert pts[0][3] == -1  # 2 points: too few to group
    assert np.corrcoef([o[1]["value"] for o in out], [-np.sin(k / 5) for k in range(60)])[0, 1] > 0.99
    from pawtrack.trackers import NOTES
    rec = [n for n in NOTES if n["code"] == "primary"][-1]["data"]  # the decision record (PROTOCOL notes)
    assert rec["chosen"] == "proj" and "clicks move together" in rec["rule"]
    assert {"proj", "proj_cam", "dist01", "centroid_y", "p1_y"} <= set(rec["candidates"]) and rec["axis"]["deg"] == 90
    assert rec["candidates"]["dist01"]["std"] < 1e-6 and rec["candidates"]["proj"]["valid"] == 1
    json.dumps(rec, allow_nan=False)
    out = list(wrap(fake(True), roi, frames, p, lambda vp, cf: 1.0, False))
    assert out[0][1]["channels"]["primary_used"] == 1
    rec = [n for n in NOTES if n["code"] == "primary"][-1]["data"]
    assert rec["chosen"] == "dist01" and "against each other" in rec["rule"]


@pytest.mark.parametrize("on, chosen", [(1.0, "sem_hips_proj"), (0.3, "proj"), (None, "proj")])
def test_wrap_auto_hips(monkeypatch, on, chosen):
    """auto with a box: the pinned hips (tagger CAM, faked) present on >= 50 % of frames -> sem_hips_proj; on 30 %
    of frames, or not found -> proj. Explicit primaries win; sem_hips_proj is listed among the candidates."""
    from pawtrack import partlabel
    from pawtrack.trackers import NOTES
    m = np.zeros((9, 16), bool)
    m[3:6, 4:6] = True  # x 0.25 .. 0.375, y 1/3 .. 2/3
    monkeypatch.setattr(partlabel, "hydra_ready", lambda: True)
    monkeypatch.setattr(partlabel, "sam_ready", lambda: False)  # no SAM in a CPU test
    monkeypatch.setattr(partlabel, "SHAPE", "cam")
    monkeypatch.setattr(partlabel, "sem_regions", lambda bgr, box, **kw: ({"hips": m} if on else {}, {"hips": {
        "label": "hips", "source": "cam", "score": 0.9, "peak": [0.3, 0.5], "cells": 6}} if on else {}))
    T = 60

    def run(fr, seed, reseed=None):
        inside = (seed[:, 0] >= 4 / 16) & (seed[:, 0] <= 6 / 16) & (seed[:, 1] >= 3 / 9) & (seed[:, 1] <= 6 / 9)
        for k, (t, _) in enumerate(fr):
            xy = seed.copy()
            xy[inside, 1] += 0.05 * np.sin(k / 3)
            vis = np.ones(len(xy), bool)
            if on and k >= on * T:
                vis[inside] = False
            yield t, xy, vis, np.ones(len(xy)), np.ones(len(xy))
    frames = [(i * 33, np.zeros((120, 160, 3), np.uint8)) for i in range(T)]
    box = {"kind": "box", "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0}
    p = {**PARAMS, "primary": "auto", "box_seed": "grid", "box_points": 64, "axis": "vertical", "sem_groups": True,
         "seed_frame": "first", "held_input": "off", "reseed_every_ms": 0}
    NOTES.clear()
    out = list(wrap(run, box, frames, p, lambda vp, cf: 1.0, None, work_wh=(160, 120)))
    rec = [n for n in NOTES if n["code"] == "primary"][-1]["data"]
    assert rec["chosen"] == chosen, rec["rule"]
    if chosen == "sem_hips_proj":
        assert rec["rule"] == "auto: pinned hips found on 100 % of frames → sem_hips_proj"
        assert np.allclose([o[1]["value"] for o in out], [o[1]["channels"]["sem_hips_proj"] for o in out])
    if on:
        c = rec["candidates"]["sem_hips_proj"]
        assert c["present"] == pytest.approx(on, abs=0.02) and c["valid"] > 0 and c["share"] > 0
    else:
        assert "sem_hips_proj" not in rec["candidates"] and rec["rule"] == "auto: box → proj"
    json.dumps(rec, allow_nan=False)
    NOTES.clear()
    list(wrap(run, box, frames, p | {"primary": "proj"}, lambda vp, cf: 1.0, None, work_wh=(160, 120)))
    assert [n for n in NOTES if n["code"] == "primary"][-1]["data"]["chosen"] == "proj"  # explicit wins


def test_group_pass_labels():
    """Grid over two bodies bobbing vertically in anti-phase + static background: the group pass puts each body's points
    in one moving group of its own (overlay pts[3]); only its camera estimate becomes channels."""
    T, per = 240, 24
    s = np.sin(np.arange(T) * 2 * np.pi / per)
    frames = [(round(i * 1000 / 24), np.zeros((36, 64, 3), np.uint8)) for i in range(T)]
    rng = np.random.default_rng(1)

    def run(fr, seed):
        a, b = seed[:, 0] < 0.4, seed[:, 0] > 0.7
        for k, (t, _) in enumerate(fr):
            xy = seed + rng.normal(0, 0.0005, seed.shape)
            xy[a, 1] += 0.05 * s[k]  # A down when s > 0
            xy[b, 1] -= 0.05 * s[k]
            yield t, xy, np.ones(len(xy), bool), np.ones(len(xy)), np.ones(len(xy))
    roi = {"kind": "box", "x": 0.0, "y": 0.2, "w": 1.0, "h": 0.6}
    p = {**PARAMS, "primary": "proj", "box_seed": "grid", "box_points": 64, "axis": "vertical"}
    out = list(wrap(run, roi, frames, p, lambda vp, cf: 1.0, None))
    pts = out[0][2]["pts"]
    ga = {q[3] for q in pts if q[0] < 0.4}
    gb = {q[3] for q in pts if q[0] > 0.7}
    assert len(ga) == 1 and len(gb) == 1 and min(ga | gb) >= 1 and ga != gb, (ga, gb)
    assert not [k for k in out[0][1]["channels"] if k.startswith(("g1", "g2", "g3", "g4", "pair_", "n_groups"))]


def test_proj_cam():
    """Whole-frame grid: static background + a blob bobbing vertically + a linear vertical pan. proj carries the pan
    (a ramp over the scene), proj_cam (camera removed) only the blob's strokes; it also works as the primary."""
    T, per = 240, 24
    s = np.sin(np.arange(T) * 2 * np.pi / per)
    pan = 0.0006 * np.arange(T)
    frames = [(round(i * 1000 / 24), np.zeros((36, 64, 3), np.uint8)) for i in range(T)]
    rng = np.random.default_rng(3)

    def run(fr, seed):
        blob = (seed[:, 0] < 0.5) & (seed[:, 1] < 0.5)
        for k, (t, _) in enumerate(fr):
            xy = seed + rng.normal(0, 0.0005, seed.shape)
            xy[blob, 1] += 0.05 * s[k]
            xy[:, 1] += pan[k]  # camera tilts: everything slides down the frame
            yield t, xy, np.ones(len(xy), bool), np.ones(len(xy)), np.ones(len(xy))
    roi = {"kind": "box", "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0}
    p = {**PARAMS, "primary": "proj_cam", "box_seed": "grid", "box_points": 64, "axis": "vertical"}
    out = list(wrap(run, roi, frames, p, lambda vp, cf: 1.0, None))
    ch = lambda name: np.array([o[1]["channels"][name] for o in out], float)
    pj, pc = ch("proj"), ch("proj_cam")
    assert np.corrcoef(pj, -pan)[0, 1] > 0.9  # the pan dominates proj (down = lower)
    assert np.corrcoef(pc, -s)[0, 1] > 0.95 and abs(np.corrcoef(pc, pan)[0, 1]) < 0.1
    assert (ch("cam_conf") > 0.5).all()  # the background: 3/4 of the grid
    assert np.allclose([o[1]["value"] for o in out], pc) and np.allclose(ch("raw_px"), ch("raw_px_cam"))  # raw_px follows
    assert (ch("primary_used") == 2).all()
    from pawtrack.trackers import NOTES
    rec = [n for n in NOTES if n["code"] == "primary"][-1]["data"]
    assert rec["rule"] == "explicit: proj_cam" and rec["candidates"]["proj_cam"]["cam_conf"] > 0.5
    assert rec["candidates"]["proj"]["travel"] > rec["candidates"]["proj_cam"]["travel"]  # the pan rides on proj
    assert not [k for k in rec["candidates"] if k.startswith(("g1", "g2", "pair_"))] and rec["camera"]["std"] > 0


def track(tracker, video, roi, end_ms, **params):
    code, ev, err = run({"cmd": "track", "video": video, "tracker": tracker, "start_ms": 0,
                         "end_ms": end_ms, "roi": roi, "params": params})
    assert code == 0, err
    return ev


def corr(pairs, truth):
    t, v = np.array([p for p in pairs if p[1] is not None], float).T
    return np.corrcoef(v, truth(t))[0, 1]


def check_blob(tracker, video, **params):
    """Two clicks (blob centre + static anchor): p0_y follows the blob to a few px, dist01 follows the
    distance; a grid in a box on the blob: centroid_y follows it. Across the cut the core re-seeds."""
    res = track(tracker, video, TWO, DUR_MS, **params)[-1]
    gt = lambda t: mv.blob_y(t / 1000) / mv.H
    first = lambda pairs: [p for p in pairs if p[0] < mv.CUT_FRAME * 1000 / mv.FPS]
    y = np.array([[t, v] for t, v in first(res["channels"]["p0_y"]) if v is not None])
    err_px = np.abs(y[:, 1] - gt(y[:, 0])) * mv.H
    assert np.median(err_px) < 3 and err_px.max() < 10, (np.median(err_px), err_px.max())
    assert corr(first(res["channels"]["dist01"]), lambda t: np.abs(mv.blob_y(t / 1000) - mv.ANCHOR[1])) > 0.95
    box = track(tracker, video, BLOB_BOX, DUR_MS, **params)[-1]
    assert corr(first(box["channels"]["centroid_y"]), gt) > 0.95
    assert len(box["confidence"]) == mv.N
    return err_px


def check_rod(tracker, tmp_path, **params):
    """Points along a rod that slides under an occluder: the visible fraction tracks the true visible
    length with the physical sign (fewer visible = more hidden = deeper)."""
    v = str(mv.make_rod(tmp_path / "rod.mp4"))
    x0 = mv.rod_left(0)
    roi = {"kind": "box", "x": x0 / mv.W, "y": (mv.ROD_Y - 12) / mv.H, "w": (mv.OCC_X - x0) / mv.W, "h": 24 / mv.H}
    res = track(tracker, v, roi, 5000, box_seed="line", box_points=48, primary="vis_frac", **params)[-1]
    truth = lambda t: np.array([mv.rod_visible_len(round(x * mv.FPS / 1000)) for x in t])
    r = {ch: corr(res["channels"][ch], truth) for ch in ("vis_frac", "vis_extent", "vis_len")}
    assert r["vis_frac"] > 0.9, r
    assert corr(res["samples"], truth) > 0.9  # vis_frac as primary: oriented out = high
    return r


ON_BLOB = {"kind": "points", "points": [[(mv.CX + dx) / mv.W, (mv.CY + dy) / mv.H] for dx, dy in ((-15, 0), (15, 0), (0, 15))]}


def check_proj(tracker, video, **params):
    """Three clicks on ONE moving body: auto picks proj (not dist01); proj follows the true position with
    axis vertical (up = higher) and with a custom axis drawn downward (down = in = lower). A box -> proj too."""
    first = lambda pairs: [p for p in pairs if p[0] < mv.CUT_FRAME * 1000 / mv.FPS]
    up = lambda t: -mv.blob_y(t / 1000)
    res = track(tracker, video, ON_BLOB, DUR_MS, axis="vertical", **params)[-1]
    assert {v for _, v in res["channels"]["primary_used"] if v is not None} == {0}, "auto: proj for clicks on one body"
    assert corr(first(res["channels"]["proj"]), up) > 0.95
    assert corr(first(res["samples"]), up) > 0.95
    down = track(tracker, video, ON_BLOB, DUR_MS, axis="custom", axis_x0=0.5, axis_y0=0.2, axis_x1=0.5, axis_y1=0.8,
                 **params)[-1]
    assert corr(first(down["samples"]), up) > 0.95  # lower on screen = deeper = lower value
    two = track(tracker, video, TWO, DUR_MS, **params)[-1]  # blob + static anchor: two bodies -> dist01
    assert {v for _, v in two["channels"]["primary_used"] if v is not None} == {1}  # (None = cut frame)
    box = track(tracker, video, BLOB_BOX, DUR_MS, axis="vertical", **params)[-1]
    assert corr(first(box["samples"]), up) > 0.95
