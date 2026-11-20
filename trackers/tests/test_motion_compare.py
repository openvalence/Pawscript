"""motion.compare (pure) and motion.propose (synthetic clip)."""
import numpy as np

import make_video as mv
from pawtrack import motion


def series(f=1.25, phase=0.0, t1=20000, step=1000 / 30, lost=None, id="a", noise=0.0, rng=None):
    t = np.arange(0, t1, step)
    v = np.sin(2 * np.pi * f * t / 1000 + phase) + (rng.normal(0, noise, len(t)) if rng is not None else 0)
    v = [None if lost and lost[0] <= x < lost[1] else float(y) for x, y in zip(t, v)]
    return {"id": id, "role": "subject", "tracker": "x", "channel": "proj", "t": t.tolist(), "v": v}


def test_rate_regularity_loop():
    r = motion.compare([series()], 0, 20000, loop_period_ms=800)["series"][0]
    assert abs(r["turns_per_s"] - 2.5) < 0.15 and r["coverage"] == 1.0 and r["gaps"] == []
    assert abs(r["cycle_ms"] - 800) < 20 and abs(r["vs_loop"] - 1.0) < 0.03 and r["half_cv"] < 0.05
    assert r["camera_share"] is None and r["role"] == "subject"


def test_gaps_and_coverage():
    r = motion.compare([series(lost=(5000, 7000))], 0, 20000)["series"][0]
    assert len(r["gaps"]) == 1 and abs(r["gaps"][0][0] - 5000) < 50 and abs(r["gaps"][0][1] - 7000) < 50
    assert 0.88 < r["coverage"] < 0.92


def test_pairs_agree_and_flip():
    a, b = series(id="a"), series(id="b", phase=np.pi)  # mirrored: same turn times, opposite kinds
    c = series(id="c", phase=2 * np.pi * 1.25 * 0.2)     # 200 ms early
    out = motion.compare([a, b, c], 0, 20000, match_ms=120)["pairs"]
    ab = next(p for p in out if p["b"] == "b")
    ac = next(p for p in out if p["b"] == "c")
    assert ab["corr"] < -0.99 and ab["match"] > 0.95 and abs(ab["median_offset_ms"]) < 20
    assert ac["match"] < 0.2


def test_camera_share():
    t = np.arange(0, 20000, 1000 / 15)
    pos = 10 * np.sin(2 * np.pi * 1.25 * t / 1000)
    cam = {"t": t.tolist(), "dx": [0.0] * len(t), "dy": np.diff(pos, prepend=pos[0]).tolist()}
    same = series(id="cam-like")                         # turns with the camera
    late = series(id="late", phase=-2 * np.pi * 1.25 * 0.177)  # the trace-2 s1 case: 177 ms behind
    rs = {r["id"]: r for r in motion.compare([same, late], 0, 20000, camera=cam)["series"]}
    assert rs["cam-like"]["camera_share"] >= 0.9 and rs["cam-like"]["camera_offset_ms"] < 60
    assert rs["late"]["camera_share"] < 0.8 or rs["late"]["camera_offset_ms"] >= 60


def test_propose_finds_the_blob(tmp_path):
    v = str(mv.make(tmp_path / "syn.mp4"))
    out = motion.cmd_propose({"video": v, "start_ms": 0, "end_ms": 4900, "period_ms": 1250}, lambda e: None)
    c = out["candidates"][0]
    cx, cy = mv.CX / mv.W, mv.CY / mv.H
    b = c["box"]
    assert b["x"] - 0.07 <= cx <= b["x"] + b["w"] + 0.07 and b["y"] - 0.1 <= cy <= b["y"] + b["h"] + 0.1, c
    x0, y0, x1, y1 = c["axis"]
    assert abs(y1 - y0) > 2 * abs(x1 - x0), c  # the blob bobs vertically
    assert len(c["points"]) == 4 and c["power"] > 0.3 and 0 <= c["cam_corr"] <= 1
