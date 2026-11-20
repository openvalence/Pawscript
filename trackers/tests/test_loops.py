"""Loop period, held frames, folding and retiming on a synthetic perfect loop (24-frame cycle on twos)."""
import numpy as np
import pytest

import make_video as mv
from pawtrack.loops import fold
from test_cli import run

P, NF = mv.LOOP_P, mv.LOOP_P * mv.LOOP_CYCLES
BOX = {"kind": "box", "x": (mv.CX - 50) / mv.W, "y": (mv.CY - 50) / mv.H, "w": 100 / mv.W, "h": 100 / mv.H}  # incl. the blob edge


@pytest.fixture(scope="module")
def clips(tmp_path_factory):
    d = tmp_path_factory.mktemp("loop")
    return str(mv.make_loop(d / "loop.mp4")), str(mv.make_loop(d / "noisy.mp4", frame_noise=20))


def track(video, **params):
    code, ev, err = run({"cmd": "track", "video": video, "tracker": "template", "start_ms": 0,
                         "end_ms": 10_000, "roi": BOX, "params": {"cut_enabled": False, **params}})
    assert code == 0, err
    return ev[-1]


def test_loop_period_and_held(clips):
    code, ev, err = run({"cmd": "loop", "video": clips[0], "start_ms": 0, "end_ms": 10_000, "params": {}})
    assert code == 0, err
    r = ev[-1]
    assert r["period_frames"] == P and r["cycles"] == mv.LOOP_CYCLES and r["confidence"] > 0.9
    assert r["period_ms"] == pytest.approx(P * 1000 / mv.LOOP_FPS, abs=1)
    assert r["held"] == {"step": 2, "ratio": 0.5}
    assert r["media"]["frame_count"] == NF
    assert r["kind"] == "exact" and r["motion_period_frames"] == P and r["prominence"] > 0.5
    assert r["motion_period_ms"] == r["period_ms"]


def test_no_loop_on_non_looping_clip(tmp_path):
    v = str(mv.make(tmp_path / "s.mp4"))  # 0.8 Hz at 30 fps = 37.5-frame period plus a cut: not a perfect loop
    code, ev, err = run({"cmd": "loop", "video": v, "start_ms": 0, "end_ms": 10_000, "params": {}})
    assert code == 0, err
    assert ev[-1]["period_frames"] is None and ev[-1]["held"]["step"] == 1
    assert ev[-1]["kind"] != "exact"


def test_fold_unit():
    rng = np.random.default_rng(0)
    gt = np.tile(np.sin(np.linspace(0, 2 * np.pi, 30, endpoint=False)), 8)[:225]
    noisy = gt + rng.normal(0, 0.3, gt.shape)
    noisy[5] = np.nan
    f = fold(noisy, 30)
    assert np.isfinite(f).all() and np.allclose(f[:30], f[30:60])
    assert np.corrcoef(f, gt)[0, 1] > np.corrcoef(np.nan_to_num(noisy), gt)[0, 1] + 0.05


def test_track_fold_beats_raw_on_noisy_loop(clips):
    raw = track(clips[1], held_retime="off")
    fo = track(clips[1], held_retime="off", loop_fold="on")
    gt = -mv.loop_y(np.arange(NF))  # template: up = higher
    vr, vf = (np.array([v for _, v in r["samples"]], float) for r in (raw, fo))
    cyc = vf[:P * (NF // P)].reshape(-1, P)
    assert np.allclose(cyc, cyc[0])  # every cycle identical
    r_raw, r_fold = np.corrcoef(vr, gt)[0, 1], np.corrcoef(vf, gt)[0, 1]
    assert r_fold > r_raw and r_fold > 0.97, (r_raw, r_fold)
    assert [e["t_ms"] for e in fo["events"]] == [round(i * 1000 / mv.LOOP_FPS) for i in range(0, NF, P)]
    assert all(e["kind"] == "cycle" for e in fo["events"]) and raw["events"] == []


def test_held_retime_removes_staircase(clips):
    stairs = np.array([v for _, v in track(clips[0], held_retime="off")["samples"]])
    smooth = np.array([v for _, v in track(clips[0])["samples"]])  # default held_retime=auto
    flat = lambda v: np.mean(np.abs(np.diff(v)) < 0.02)
    assert flat(stairs) > 0.4 and flat(smooth) < 0.15, (flat(stairs), flat(smooth))
    t = np.arange(NF)
    smooth_gt = -(mv.CY + mv.AMP * np.sin(2 * np.pi * t / P))  # drawing d's pose is reached at frame 2d
    assert np.corrcoef(smooth, smooth_gt)[0, 1] > np.corrcoef(stairs, smooth_gt)[0, 1]
