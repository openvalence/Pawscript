"""pawtrack.motion_model (bodies -> parts, per-group similarity) on synthetic tracks, through groups.group_tracks."""
import numpy as np

from pawtrack import motion_model as mm
from pawtrack.groups import group_tracks

T, FPS, PER = 480, 24.0, 24
PH = np.arange(T) * 2 * np.pi / PER


def grid():
    """The CoTracker grid layout: 24 x 14 seed points over the frame."""
    return (np.stack(np.meshgrid(np.arange(24), np.arange(14)), -1).reshape(-1, 2) + 0.5) / [24, 14]


def test_fit_robust():
    """Similarity recovered with 10 % wild members (large scale / rotation, no noise); their residuals stand out."""
    rng = np.random.default_rng(0)
    r = np.repeat(rng.uniform(0, 1, (1, 50, 2)), 100, 0)
    p = np.c_[rng.normal(0, 0.03, (100, 2)), rng.normal(0, 0.05, (100, 2))]
    d = mm.predict(p, r.mean(1), r)
    d[:, :5] += rng.normal(0, 0.05, (100, 5, 2))
    q, _, res = mm.fit(d, r, np.ones((100, 50), bool))
    assert np.abs(q - p).max() < 1e-3
    assert 10 * np.nanmedian(res[:, 5:]) < np.nanmedian(res[:, :5])


def test_appendage_is_a_part(monkeypatch):
    """The owner's case: a body (grid points in a box) strokes at 1 x, a small appendage on its edge rides along and
    flaps at 3 x with up to 2 x the body's amplitude (3.3 x with FOLD). The body's centroid must follow the body
    within noise with and without the appendage, the appendage must be a part of the body (not a second body, not
    unassigned) and its part_rel must be its own flap. Before parts the centroid error grew with the flap (0.0037 at
    amp 0.03, 0.0075 at 0.06); at 0.1 the appendage is a second body unless FOLD."""
    g = grid()
    body = (g[:, 0] > 0.3) & (g[:, 0] < 0.6) & (g[:, 1] > 0.3) & (g[:, 1] < 0.75)
    app = (g[:, 0] > 0.6) & (g[:, 0] < 0.72) & (g[:, 1] > 0.42) & (g[:, 1] < 0.62)
    s = 0.03 * np.sin(PH)
    for amp, fold in ((0.0, False), (0.03, False), (0.06, False), (0.1, True)):
        monkeypatch.setattr(mm, "FOLD", fold)
        rng = np.random.default_rng(0)
        flap = amp * np.sin(3 * PH + 0.5)
        xy = np.repeat(g[None], T, 0)
        xy[:, body | app, 1] += s[:, None]
        xy[:, app, 1] += flap[:, None]
        xy += rng.normal(0, 0.0007, xy.shape)
        r = group_tracks(xy, np.ones(xy.shape[:2], bool), FPS, aspect=16 / 9)
        lab, part = r["labels"], r["part"]
        gb = np.bincount(lab[:, body].ravel() + 1).argmax() - 1
        assert gb >= 1 and (r["n_groups"] == 1).all(), (amp, np.unique(r["n_groups"]))
        c = r["cent"][:, gb - 1, 1]
        assert np.std((c - c.mean()) - (s - s.mean())) < 0.001, amp
        assert (lab[:, app] == gb).mean() > 0.95
        if amp:
            assert (part[:, app] == 1).mean() > 0.95 and (part[:, body] == 0).mean() > 0.95
            rel = r["part_rel"][:, gb - 1, 0, 1]
            assert np.corrcoef(rel, flap)[0, 1] > 0.95
            assert r["part_share"][:, gb - 1, 0].min() > 0
        else:
            assert (part == 0).all()


def test_scale_rot_channels():
    """A body that grows / shrinks on screen (toward / away from the camera) and rocks: "scale" follows the relative
    size change, "rot" the rotation (radians, > 0 clockwise on screen); a static background around it."""
    g = grid()
    body = (g[:, 0] > 0.3) & (g[:, 0] < 0.7) & (g[:, 1] > 0.25) & (g[:, 1] < 0.75)
    a, b = 0.05 * np.sin(PH), 0.04 * np.cos(PH)
    c = g[body].mean(0) * [16 / 9, 1]
    u = g[body] * [16 / 9, 1] - c
    xy = np.repeat(g[None], T, 0)
    rot = np.stack([np.cos(b), -np.sin(b), np.sin(b), np.cos(b)], 1).reshape(T, 2, 2)
    xy[:, body] = (c + (1 + a)[:, None, None] * np.einsum("tij,nj->tni", rot, u)) / [16 / 9, 1]
    xy += np.random.default_rng(1).normal(0, 0.0005, xy.shape)
    r = group_tracks(xy, np.ones(xy.shape[:2], bool), FPS, aspect=16 / 9)
    gb = np.bincount(r["labels"][:, body].ravel() + 1).argmax() - 1
    assert gb >= 1
    assert np.corrcoef(r["scale"][:, gb - 1], a)[0, 1] > 0.9
    assert np.corrcoef(r["rot"][:, gb - 1], b)[0, 1] > 0.9


def test_contracting_clump_is_a_part():
    """Balls next to a flapping penis: a 6-point clump on the body that contracts in pulses at its own rhythm (its
    points move apart / together, so their residuals do not correlate) becomes a second part of the body, and its
    part_scale follows the pulses; the penis stays part 1."""
    g = grid()
    body = (g[:, 0] > 0.3) & (g[:, 0] < 0.6) & (g[:, 1] > 0.3) & (g[:, 1] < 0.75)
    pen = (g[:, 0] > 0.6) & (g[:, 0] < 0.72) & (g[:, 1] > 0.42) & (g[:, 1] < 0.55)
    balls = (g[:, 0] > 0.6) & (g[:, 0] < 0.72) & (g[:, 1] > 0.55) & (g[:, 1] < 0.7)
    xy = np.repeat(g[None], T, 0)
    xy[:, body | pen | balls, 1] += 0.03 * np.sin(PH)[:, None]
    xy[:, pen, 1] += 0.03 * np.sin(3 * PH + 0.5)[:, None]
    c = g[balls].mean(0) * [16 / 9, 1]
    sc = 0.4 * np.maximum(0, np.sin(2 * np.pi * np.arange(T) / 30)) ** 4
    xy[:, balls] += sc[:, None, None] * (g[balls] * [16 / 9, 1] - c)[None] / [16 / 9, 1]
    xy += np.random.default_rng(0).normal(0, 0.0007, xy.shape)
    r = group_tracks(xy, np.ones(xy.shape[:2], bool), FPS, aspect=16 / 9)
    lab, part = r["labels"], r["part"]
    gb = np.bincount(lab[:, body].ravel() + 1).argmax() - 1
    assert (lab[:, balls] == gb).mean() > 0.95 and (lab[:, pen] == gb).mean() > 0.95
    jp, jb = (np.bincount(part[:, m].ravel()).argmax() for m in (pen, balls))
    assert jp >= 1 and jb >= 1 and jp != jb and (part[:, balls] == jb).mean() > 0.95
    ps = r["part_scale"][:, gb - 1, jb - 1]
    ok = np.isfinite(ps)
    assert ok.mean() > 0.95 and np.corrcoef(ps[ok], sc[ok])[0, 1] > 0.8
