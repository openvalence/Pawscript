"""Group / pinned-group centres are seed-anchored (groups.centroid): a rigidly translating cloud whose points drop out
for a stretch (a thumb occluded by a shaft) must not step its centre -- the hand did not move laterally."""
import numpy as np

from pawtrack.groups import group_tracks
from pawtrack.points import translation


def scene(hide):
    rng = np.random.default_rng(3)
    T, fps = 240, 24.0
    t = np.arange(T)
    A = rng.uniform([0.15, 0.2], [0.45, 0.5], (40, 2))     # a moving body
    H = rng.uniform([0.55, 0.25], [0.75, 0.45], (20, 2))   # pinned hips
    bg = rng.uniform([0.05, 0.6], [0.95, 0.95], (60, 2))
    xy = np.repeat(np.r_[A, H, bg][None], T, 0)
    ma = np.c_[0.04 * np.sin(2 * np.pi * t / 24), 0.02 * np.cos(2 * np.pi * t / 24)]
    mh = np.c_[0.03 * np.sin(2 * np.pi * t / 30 + 1), 0.03 * np.sin(2 * np.pi * t / 30)]
    xy[:, :40] += ma[:, None]
    xy[:, 40:60] += mh[:, None]
    vis = np.ones((T, 120), bool)
    if hide:   # 30 % of each cloud, its left-most points (a one-sided drop moves a plain mean), for 1.25 s
        vis[100:130, np.argsort(A[:, 0])[:12]] = False
        vis[100:130, 40 + np.argsort(H[:, 0])[:6]] = False
    pinned = np.r_[np.zeros(40, int), np.full(20, 3), np.zeros(60, int)]
    return xy, vis, fps, pinned, ma, mh


def test_centres_do_not_step_when_points_drop():
    xy, vis, fps, pinned, ma, mh = scene(True)
    full = group_tracks(*scene(False)[:3], aspect=16 / 9, pinned=scene(False)[3])
    r = group_tracks(xy, vis, fps, aspect=16 / 9, pinned=pinned)
    g = int(np.bincount(r["labels"][:, :40][r["labels"][:, :40] > 0]).argmax())
    for name, c, c0 in (("group", r["cent"][:, g - 1], full["cent"][:, g - 1]), ("sem_hips", r["sem_cent"][:, 2], full["sem_cent"][:, 2])):
        assert np.isfinite(c).all(), name
        assert np.abs(c - c0).max() < 1e-6, (name, np.abs(c - c0).max())   # hidden or not: the same centre
    # the camera-removed centre + cam follows the true motion (no step at the drop / return)
    img = r["sem_cent"][:, 2] + r["cam"]
    assert np.abs(np.diff(img, axis=0) - np.diff(mh, axis=0)).max() < 1e-6


def test_translation_ignores_dropouts():
    xy, vis, *_ , ma, _ = scene(True)
    c = translation(xy[:, :40], vis[:, :40], xy[0, :40])
    assert np.abs(np.diff(c, axis=0) - np.diff(ma, axis=0)).max() < 1e-9


def test_centroid_channel_is_anchored():
    """wrap() with a fake tracker: a box grid sliding right; its left third hidden for a stretch -> centroid_x / _y
    (a primary and the overlay's fallback centre) follow the slide, no step at the drop or the return."""
    from pawtrack.points import wrap
    T = 60
    frames = [(i * 33, np.zeros((36, 64, 3), np.uint8)) for i in range(T)]
    slide = 0.002 * np.arange(T)

    def run(fr, seed):
        for k, (t, _) in enumerate(fr):
            vis = np.ones(len(seed), bool)
            if 20 <= k < 40:
                vis[seed[:, 0] < np.quantile(seed[:, 0], 0.3)] = False
            yield t, seed + [slide[k], 0.0], vis, np.ones(len(seed)), np.ones(len(seed))
    p = {"axis": "auto", "axis_x0": 0.5, "axis_y0": 0.3, "axis_x1": 0.5, "axis_y1": 0.7, "gap_ms": 1000,
         "primary": "centroid_x", "box_seed": "grid", "box_points": 64, "sem_groups": False}
    out = list(wrap(run, {"kind": "box", "x": 0.2, "y": 0.2, "w": 0.4, "h": 0.4}, frames, p, lambda vp, cf: 1.0, None))
    cx = np.array([o[1]["channels"]["centroid_x"] for o in out])
    cy = np.array([o[1]["channels"]["centroid_y"] for o in out])
    assert np.abs(np.diff(cx) - 0.002).max() < 1e-9 and np.ptp(cy) < 1e-9
