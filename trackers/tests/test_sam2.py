"""SAM 2.1 mask tracker. The mask_stats test runs everywhere; the rest needs the sam2 extra and a CUDA
GPU (skipped otherwise; deselect with -m "not gpu"). Uses the tiny model (downloads ~150 MB once)."""
import importlib.util

import numpy as np
import pytest

import make_video as mv
from pawtrack.trackers.sam2_mask import mask_stats
from test_cli import DUR_MS, run, video  # noqa: F401 (video = fixture)

BLOB_BOX = {"kind": "box", "x": (mv.CX - 45) / mv.W, "y": (mv.CY - 45) / mv.H, "w": 90 / mv.W, "h": 90 / mv.H}
CLICK = {"kind": "points", "points": [[mv.CX / mv.W, mv.CY / mv.H]]}


def _cuda():
    if not (importlib.util.find_spec("torch") and importlib.util.find_spec("sam2")):
        return False
    import torch
    return torch.cuda.is_available()


def gpu(f):
    return pytest.mark.gpu(pytest.mark.skipif(not _cuda(), reason="needs `--extra sam2` and CUDA")(f))


def test_mask_stats():
    m = np.zeros((360, 640), bool)
    m[100:130, 200:440] = True  # 240 x 30 rod
    ch, _ = mask_stats(m, "auto")
    assert ch["axis_len"] * 360 == pytest.approx(240, rel=0.01)
    assert ch["axis_width"] * 360 == pytest.approx(30, rel=0.02)
    assert ch["len_over_width"] == pytest.approx(8, rel=0.03) and abs(ch["axis_angle"]) < 1
    assert ch["bulge"] == pytest.approx(1, abs=0.1)
    m[90:140, 200:230] = True  # knot at the left end
    assert mask_stats(m, "left")[0]["bulge"] > 1.5
    assert mask_stats(m, "right")[0]["bulge"] == pytest.approx(1, abs=0.1)
    assert mask_stats(np.zeros((10, 10), bool), "auto")[0] is None


def track(video, roi, end_ms, **params):
    code, ev, err = run({"cmd": "track", "video": video, "tracker": "sam2_mask", "start_ms": 0,
                         "end_ms": end_ms, "roi": roi, "params": {"model": "tiny", **params}})
    assert code == 0, err
    return ev


def _corr(pairs, truth):
    t, v = np.array([p for p in pairs if p[1] is not None], float).T
    return np.corrcoef(v, truth(t))[0, 1]


@gpu
@pytest.mark.parametrize("roi", [BLOB_BOX, CLICK], ids=["box", "click"])
def test_sam2_follows_blob(video, roi):
    ev = track(video, roi, DUR_MS, primary="centroid_y")
    res = ev[-1]
    frames = [e for e in ev if e["type"] == "frame"]
    assert len(frames) == mv.N and all(e["overlay"]["masks"] for e in frames)
    assert set(res["channels"]) == {"centroid_x", "centroid_y", "area", "axis_len", "axis_width",
                                    "len_over_width", "axis_angle", "bulge", "raw_px"}
    gt_y = lambda t: mv.blob_y(t / 1000) / mv.H
    assert _corr(res["channels"]["centroid_y"], gt_y) > 0.9
    cy = np.array([v for _, v in res["channels"]["centroid_y"] if v is not None])
    assert np.abs(cy - gt_y(np.array([t for t, v in res["channels"]["centroid_y"] if v is not None]))).max() * mv.H < 4  # px
    assert _corr(res["samples"], lambda t: -np.sin(2 * np.pi * mv.FREQ * t / 1000)) > 0.9
    assert min(c for _, c in res["confidence"][1:]) >= 0 and np.median([c for _, c in res["confidence"]]) > 0.9


@gpu
def test_sam2_visible_length(tmp_path):
    v = str(mv.make_rod(tmp_path / "rod.mp4"))
    x0 = mv.rod_left(0)
    roi = {"kind": "box", "x": (x0 - 10) / mv.W, "y": (mv.ROD_Y - 25) / mv.H,
           "w": (mv.OCC_X - x0 + 10) / mv.W, "h": 50 / mv.H}
    res = track(v, roi, 5000, chunk_frames=40)[-1]  # small chunks: exercises the chunk hand-over too
    truth = lambda t: np.array([mv.rod_visible_len(round(x * mv.FPS / 1000)) for x in t])
    for ch in ("axis_len", "len_over_width"):
        r = _corr(res["channels"][ch], truth)
        assert r > 0.9, (ch, r)
    assert _corr(res["samples"], truth) > 0.9  # default primary = len_over_width
    L = np.array([v for _, v in res["channels"]["axis_len"]]) * mv.H
    assert np.abs(L - truth([t for t, _ in res["channels"]["axis_len"]])).max() < 12  # px


KNOT_X, KNOT_W, KNOT_H = 30, 30, 60  # knot: rod coords 30..60 from the left end, twice the rod width


def knot_left(i):
    return 315 + 85 * np.sin(2 * np.pi * mv.FREQ * i / mv.FPS)  # 230..400 px; the occluder starts at OCC_X = 420


def make_knot(path):
    """Rod with a knot near its base sliding in and out of an occluder; the tip end is always hidden."""
    import cv2
    rng = np.random.default_rng(4)
    bg, occ = mv._texture(rng, mv.H, mv.W, (200, 120, 60)), mv._texture(rng, mv.H, mv.W - mv.OCC_X, (60, 60, 200))
    rod = mv._texture(rng, KNOT_H, mv.ROD_L, (40, 200, 240))
    shape = np.zeros((KNOT_H, mv.ROD_L), bool)
    shape[(KNOT_H - mv.ROD_W) // 2:(KNOT_H + mv.ROD_W) // 2] = True
    shape[:, KNOT_X:KNOT_X + KNOT_W] = True
    vw = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), mv.FPS, (mv.W, mv.H))
    for i in range(mv.N // 2):
        img = bg.copy()
        x = int(round(knot_left(i)))
        y0 = mv.ROD_Y - KNOT_H // 2
        w = min(mv.ROD_L, mv.W - x)
        sub = img[y0:y0 + KNOT_H, x:x + w]
        sub[shape[:, :w]] = rod[:, :w][shape[:, :w]]
        img[:, mv.OCC_X:] = occ
        vw.write(np.clip(img + rng.normal(0, 4, img.shape), 0, 255).astype(np.uint8))
    vw.release()
    return path


@gpu
def test_sam2_knot(tmp_path):
    """The box is only the first-frame prompt: the mask must follow the rod beyond it (visible length up to
    190 px, the box is 115 px wide), bulge must peak while the knot is just outside the occluder (it is then in
    the basal third of the visible part, base = the end at the occluder), and axis_len tracks the visible length."""
    v = str(make_knot(tmp_path / "knot.mp4"))
    x0 = knot_left(0)
    roi = {"kind": "box", "x": (x0 - 10) / mv.W, "y": (mv.ROD_Y - 40) / mv.H, "w": (mv.OCC_X - x0 + 10) / mv.W, "h": 80 / mv.H}
    res = track(v, roi, 5000, chunk_frames=40)[-1]
    t = np.array([p[0] for p in res["channels"]["axis_len"]], float)
    i = np.round(t * mv.FPS / 1000).astype(int)
    left = knot_left(i)
    vis_len = np.clip(mv.OCC_X - np.round(left), 0, mv.ROD_L)
    L = np.array([np.nan if p[1] is None else p[1] for p in res["channels"]["axis_len"]]) * mv.H
    assert np.nanmax(L) > 160, np.nanmax(L)  # not clipped to the 115 px prompt box
    ok = np.isfinite(L)
    assert np.corrcoef(L[ok], vis_len[ok])[0, 1] > 0.9
    lw = np.array([np.nan if p[1] is None else p[1] for p in res["channels"]["len_over_width"]])
    far = left < 320            # knot well outside, in the middle / outer part of the visible rod
    near = (left > 358) & (left < 385)  # knot just outside the occluder: in the basal third
    b = np.array([np.nan if p[1] is None else p[1] for p in res["channels"]["bulge"]])
    assert np.nanmedian(b[near]) > 1.5 and np.nanmedian(b[near]) > 1.3 * np.nanmedian(b[far]), \
        (np.nanmedian(b[near]), np.nanmedian(b[far]))
    assert np.corrcoef(lw[ok & np.isfinite(lw)], vis_len[ok & np.isfinite(lw)])[0, 1] > 0.8
