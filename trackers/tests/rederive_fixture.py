"""Parity fixture for the frontend re-derive (src/lib/rederive.js, paw-a3n): a synthetic two-scene points run whose
projected channels come from the sidecar's own stroke_proj (and the pair_dist rule with a given axis), written to
test/fixtures/rederive-run.json. The JS test re-derives them from the stored centroids / camera and must match;
test_rederive_fixture.py fails when the sidecar's maths drifts from the committed fixture.
Run (from trackers/): .venv/Scripts/python.exe tests/rederive_fixture.py"""
import json
import sys
from pathlib import Path

import numpy as np

from pawtrack.points import stroke_proj

ASPECT = 16 / 9
OUT = Path(__file__).resolve().parents[2] / "test" / "fixtures" / "rederive-run.json"
CUSTOM = {"axis": "custom", "axis_x0": 0.42, "axis_y0": 0.30, "axis_x1": 0.50, "axis_y1": 0.72}


def scene(n, t0, rng, pan, f, ang):
    i = np.arange(n)
    t = np.round(t0 + i * 1000 / 30)
    K = np.c_[pan[0] * i, pan[1] * i]  # camera drift since the scene start (frame units)
    u = np.array([np.cos(ang), np.sin(ang)])
    s = 0.05 * np.sin(2 * np.pi * f * t / 1000)
    g1 = np.array([0.40, 0.50]) + s[:, None] * u / [ASPECT, 1.0] + rng.normal(0, 0.001, (n, 2))   # background frame
    g2 = np.array([0.62, 0.56]) + 0.2 * s[:, None] * u[::-1] / [ASPECT, 1.0] + rng.normal(0, 0.001, (n, 2))
    C = 0.6 * g1 + 0.4 * g2 + K   # the image-frame centroid
    C[50:55] = np.nan            # bridged (< gap_ms)
    g1[120:n // 2 + 120 if n > 240 else 180] = np.nan   # too long: stays a gap
    g1[200:204] = np.nan
    return t, C, K, g1, g2


def channels(params, scenes):
    out = {}
    for t, C, K, g1, g2 in scenes:
        ch = {"centroid_x": C[:, 0], "centroid_y": C[:, 1], "cam_x": K[:, 0], "cam_y": K[:, 1],
              "g1_x": g1[:, 0], "g1_y": g1[:, 1], "g2_x": g2[:, 0], "g2_y": g2[:, 1],
              "g1_n": np.where(np.isnan(g1[:, 0]), 0.0, 0.5), "g2_n": np.full(len(t), 0.3),
              "sem_hips_x": g2[:, 0], "sem_hips_y": g2[:, 1],
              "proj": stroke_proj(t, C, ASPECT, params)[0], "proj_cam": stroke_proj(t, C - K, ASPECT, params)[0],
              "g1_proj": stroke_proj(t, g1, ASPECT, params)[0], "g2_proj": stroke_proj(t, g2, ASPECT, params)[0],
              "sem_hips_proj": stroke_proj(t, g2, ASPECT, params)[0]}
        if params["axis"] == "custom":   # groups.group_tracks pair_dist with a given axis, then group_channels' 0..1
            u = np.array([(params["axis_x1"] - params["axis_x0"]) * ASPECT, params["axis_y1"] - params["axis_y0"]])
            u = u / np.hypot(*u)
            r = (g1 - g2) * [ASPECT, 1.0]
            d = r @ u
            d = d if np.nanmean(d) >= 0 else -d
            lo, hi = np.nanmin(d), np.nanmax(d)
            ch["pair_proj"] = (d - lo) / (hi - lo)
        for k, v in ch.items():
            out.setdefault(k, []).extend([[int(a), None if not np.isfinite(b) else float(f"{b:.7g}")] for a, b in zip(t, v)])
    return out


def build():
    rng = np.random.default_rng(7)
    sc = [scene(240, 0, rng, (0.0015, 0.0004), 1.3, np.radians(60)), scene(180, 8000, rng, (0.0, 0.0), 0.9, np.radians(20))]
    spans = [{"start_ms": 0, "end_ms": 8000}, {"start_ms": 8000, "end_ms": 14000}]
    base = {"gap_ms": 1000}
    return {"aspect": ASPECT, "scenes": spans,
            "auto": {"params": base | {"axis": "auto"}, "channels": channels(base | {"axis": "auto"}, sc)},
            "custom": {"params": base | CUSTOM, "channels": channels(base | CUSTOM, sc)}}


if __name__ == "__main__":
    OUT.write_text(json.dumps(build(), separators=(",", ":")))
    print(OUT, OUT.stat().st_size, file=sys.stderr)
