"""held_input on the point trackers' shared body (wrap): an animation on threes is tracked on its own clock.
No GPU: a fake tracker stands in for CoTracker3 / TAPNext++."""
import numpy as np

from pawtrack.trackers import NOTES
from pawtrack.points import wrap
from test_points_cotracker import PARAMS

WH = (64, 48)


def threes(n_draw=30, step=3):
    """A 16 x 32 px block moving 1.5 px per drawing, every drawing shown `step` frames, plus +-2 grey of noise."""
    rng = np.random.default_rng(0)
    out = []
    for k in range(n_draw):
        img = np.zeros((WH[1], WH[0], 3), np.uint8)
        x = 4 + 3 * k // 2
        img[8:40, x:x + 16] = 200
        for _ in range(step):
            noisy = np.clip(img.astype(int) + rng.integers(-2, 3, img.shape), 0, 255).astype(np.uint8)
            out.append((len(out) * 33, noisy))
    return out


def test_threes_tracked_per_drawing():
    frames = threes()
    got = []

    def fake(fr, seed):
        for k, (t, img) in enumerate(fr):
            got.append(t)
            xy = seed + [0.01 * k, 0.0]
            yield t, xy, np.ones(len(xy), bool), np.ones(len(xy)), np.ones(len(xy))

    p = {**PARAMS, "primary": "auto", "box_seed": "grid", "box_points": 16, "held_input": "auto"}
    roi = {"kind": "box", "x": 0.1, "y": 0.3, "w": 0.4, "h": 0.4}
    NOTES.clear()
    out = list(wrap(fake, roi, frames, p, lambda vp, cf: 1.0, None, work_wh=WH))
    msg = next(n["message"] for n in NOTES if n["code"] == "held_input")
    assert "step 3" in msg and "tracked 30/90" in msg, msg
    assert got == [t for t, _ in frames[::3]]  # one frame per drawing, its first frame
    assert [o[0] for o in out] == [t for t, _ in frames]  # every video frame, video timestamps
    pts = [o[2]["pts"] for o in out]
    for k in range(30):  # held frames repeat their drawing (positions, visibility, group)
        assert pts[3 * k] == pts[3 * k + 1] == pts[3 * k + 2]
        if k:
            assert pts[3 * k][0][0] > pts[3 * k - 1][0][0]
    assert out[1][1]["channels"]["centroid_x"] == out[0][1]["channels"]["centroid_x"]

    got.clear()  # off: every frame goes to the tracker
    assert len(list(wrap(fake, roi, frames, {**p, "held_input": "off"}, lambda vp, cf: 1.0, None, work_wh=WH))) == 90
    assert len(got) == 90


def test_ones_auto_keeps_every_frame():
    frames = threes(step=1)
    got = []

    def fake(fr, seed):
        for t, _ in fr:
            got.append(t)
            yield t, seed, np.ones(len(seed), bool), np.ones(len(seed)), np.ones(len(seed))

    p = {**PARAMS, "primary": "auto", "box_seed": "grid", "box_points": 16, "held_input": "auto"}
    list(wrap(fake, {"kind": "box", "x": 0.1, "y": 0.3, "w": 0.4, "h": 0.4}, frames, p, lambda vp, cf: 1.0, None,
              work_wh=WH))
    assert len(got) == len(frames)
