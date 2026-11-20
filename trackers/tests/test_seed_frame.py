"""Seed frame + bidirectional tracking of the point trackers (points.seed_frame / merge_passes / wrap) and the
travel-triggered void check, with fake runners: no models needed."""
import json

import numpy as np

from pawtrack.trackers import NOTES
from pawtrack.points import Reseed, seed_candidates, seed_frame, wrap

P = {"axis": "horizontal", "axis_x0": 0.5, "axis_y0": 0.3, "axis_x1": 0.5, "axis_y1": 0.7, "gap_ms": 1000,
     "primary": "proj", "box_seed": "grid", "box_points": 64, "reseed_every_ms": 0, "retire_ms": 2000,
     "max_points": 0, "held_input": "off", "seed_frame": "first"}
WHOLE = {"kind": "box", "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0}
WH = (64, 36)  # the fake tracker's input res
NOISE = np.random.default_rng(0).integers(0, 255, (90, 160, 3), dtype=np.uint8)
ms = lambda k: round(k * 1000 / 30)


def frame(k):
    """A textured frame that carries its own index k in pixel (0, 0) (survives the nearest resize)."""
    img = np.roll(NOISE, 3 * k, axis=1)  # new content every frame (held_input sees real drawings)
    img[0, 0, :2] = k % 256, k // 256
    return img


def fake(pan, seen=None):
    """Honest about time: every point sits at its scene position + pan(k), k = the frame's own index read from the
    image (a reversed pass gets the frames in reverse). Honours Reseed like the real runners."""
    def run(fr, seed, reseed=None):
        base, last = None, None
        for t, img in fr:
            k = int(img[0, 0, 0]) + 256 * int(img[0, 0, 1])
            if base is None:
                base = seed - pan(k)
            if reseed is not None and last is not None:
                slots, new = reseed(t, img, *last)
                base = np.r_[base, np.zeros((int((slots >= len(base)).sum()), 2))]
                base[slots] = np.asarray(new).reshape(-1, 2) - pan(k)
            xy = base + pan(k)
            vis = ((xy >= 0) & (xy <= 1)).all(1)
            last = xy, vis
            if seen is not None:
                seen.append(len(xy))
            yield t, xy, vis, vis.astype(float), np.ones(len(xy))
    return run


def track(run, n, roi=WHOLE, p=P, fr=None):
    NOTES.clear()
    return list(wrap(run, roi, fr or [(ms(k), frame(k)) for k in range(n)], p, lambda vp, cf: 1.0, None, work_wh=WH))


def test_pickers_on_synthetic_thumbs():
    rng = np.random.default_rng(1)
    th = np.full((90, 24, 32), 120.0) + rng.normal(0, 1, (90, 24, 32))
    th[:12] = 10.0  # the scene opens on a dark close-up
    th[37, 6:18, 8:24] += rng.normal(0, 40, (12, 16))  # one frame with texture inside the box
    ts = [ms(k) for k in range(90)]
    c = seed_candidates(ts, th, {"kind": "box", "x": 0.25, "y": 0.25, "w": 0.5, "h": 0.5})
    assert c["medoid"] >= 12 and c["far_first"] >= 12 and c["texture"] == 37 and c["cells"] == 37
    assert c["keyframe"] == c["medoid"]  # no motion period: falls back to the medoid
    bar = np.zeros((300, 24, 32))  # a bar moving up and down, period 30 frames
    for k in range(300):
        y = int(round(11.5 + 9 * np.sin(2 * np.pi * k / 30)))
        bar[k, y:y + 3] = 255
    ts = [ms(k) for k in range(300)]
    kf = seed_candidates(ts, bar, None)["keyframe"]
    assert abs(kf - 150) <= 15 and abs(np.sin(2 * np.pi * kf / 30)) > 0.9  # a turn (extreme) near the middle


def test_roi_t_ms_maps_to_its_scene():
    ts = [ms(k) for k in range(100, 160)]
    th = np.zeros((60, 4, 4))
    roi = {**WHOLE, "t_ms": ms(130) + 5}
    s, rec = seed_frame(ts, th, roi, "first", ts)
    assert s == 30 and rec == {"frame_ms": ms(130), "mode": "roi", "reason": f"the ROI was drawn at {ms(130) + 5} ms"}
    assert seed_frame(ts, th, {**WHOLE, "t_ms": ms(99)}, "first", ts)[0] == 0  # another scene: first frame
    assert seed_frame(ts, th, {**WHOLE, "t_ms": ms(170)}, "first", ts)[1]["mode"] == "first"
    held = ts[::2]  # held_input: the tracker gets the drawings; the seed is the drawing on show at t_ms
    assert seed_frame(held, th[::2], {**WHOLE, "t_ms": ms(131)}, "first", ts)[0] == 15


def test_bidirectional_merge():
    """Seeded mid-scene: time order kept, the seed frame shows the seed grid, every frame the true position, anchors
    at S (raw_px linear through the seed frame), the decision record names the frame."""
    pan = lambda k: np.array([0.001 * k, 0.0005 * k])
    out = track(fake(pan), 120, {**WHOLE, "t_ms": ms(60)})
    assert [o[0] for o in out] == [ms(k) for k in range(120)]
    pts = np.array([o[2]["pts"] for o in out])[..., :2]
    seed = np.array(out[60][2]["pts"])[:, :2]
    assert np.allclose(pts, seed[None] + (np.array([pan(k) for k in range(120)]) - pan(60))[:, None], atol=1e-4)
    rp = np.array([o[1]["channels"]["raw_px"] for o in out])
    assert np.allclose(np.diff(rp), 0.001 * 160, atol=1e-6)
    rec = next(n["data"] for n in NOTES if n["code"] == "primary")
    assert rec["seed"] == {"frame_ms": ms(60), "mode": "roi", "reason": f"the ROI was drawn at {ms(60)} ms"}


def test_first_is_unchanged():
    """seed_frame first streams as before; a buffered run seeded on the first frame (roi.t_ms there) is byte-identical."""
    pan = lambda k: np.array([0.002 * k, 0.0])
    a = track(fake(pan), 90)
    b = track(fake(pan), 90, {**WHOLE, "t_ms": 0})
    assert json.dumps(a) == json.dumps(b)
    c = track(fake(pan), 90, p={**P, "seed_frame": "auto"})  # auto on a textured still: some frame, still both ways
    assert [o[0] for o in c] == [o[0] for o in a]


def test_reseed_in_both_passes():
    """A pan carries the cloud out on both sides of the seed frame: each pass re-seeds (constant n), the merged points
    keep stable indices, nothing steps the centroid on either side of S."""
    pan = lambda k: np.array([0.004 * (k - 150), 0.0])
    seen = []
    out = track(fake(pan, seen), 300, {**WHOLE, "t_ms": ms(150)}, {**P, "reseed_every_ms": 1000})
    assert set(seen) == {64}
    rp = np.array([o[1]["channels"]["raw_px"] for o in out])
    assert np.allclose(np.diff(rp), 0.004 * 160, atol=1e-6)
    pts = np.array([o[2]["pts"] for o in out])
    assert pts.shape[1] > 64 and len({len(o[2]["pts"]) for o in out}) == 1
    vis = pts[..., 2] > 0
    assert vis[0, 64:].sum() >= 20 and vis[-1, 64:].sum() >= 20  # re-seeds carry both ends
    assert not (vis[:150, 64:].any(0) & vis[151:, 64:].any(0)).any()  # a re-seed lives on one side of S only
    assert next(n for n in NOTES if n["code"] == "reseed")


def test_held_input_reversed():
    """On twos, seeded mid-scene: the drawings are tracked both ways, every held frame takes its drawing."""
    fr = [(ms(k), frame(k - k % 2)) for k in range(120)]
    pan = lambda k: np.array([0.0015 * k, 0.0])
    out = track(fake(pan), 0, {**WHOLE, "t_ms": ms(61)}, {**P, "held_input": "on"}, fr)
    assert [o[0] for o in out] == [t for t, _ in fr]
    pts = np.array([o[2]["pts"] for o in out])[..., :2]
    assert all(np.array_equal(pts[k], pts[k + 1]) for k in range(0, 120, 2))
    rec = next(n["data"] for n in NOTES if n["code"] == "primary")
    assert rec["seed"]["frame_ms"] == ms(60)
    assert next(n["data"] for n in NOTES if n["code"] == "held_input")["tracked"] == 60


def test_travel_triggers_void_check_not_bob():
    g = (np.arange(8) + 0.5) / 8
    seed = np.stack(np.meshgrid(g, g), -1).reshape(-1, 2)
    rs = Reseed(WHOLE, seed, 0, 0, {**P, "reseed_every_ms": 10000}, 0)  # the timed check never comes
    fired = 0
    for k in range(0, 3000, 267):  # a pan of 0.5 frame widths per second (4 cells / s)
        xy = seed + [0.0005 * k, 0.0]
        fired += len(rs(k, NOISE, xy, ((xy >= 0) & (xy <= 1)).all(1))[1]) > 0
    assert rs.travel_checks >= 3 and fired >= 3
    rb = Reseed(WHOLE, seed, 0, 0, {**P, "reseed_every_ms": 10000}, 0)
    for k in range(0, 6000, 267):  # a bob of +-2 cells, period 0.5 s: no net travel over 0.5-1 s
        xy = seed + [0.25 * np.sin(2 * np.pi * k / 500), 0.0]
        rb(k, NOISE, xy, ((xy >= 0) & (xy <= 1)).all(1))
    assert rb.travel_checks == 0
