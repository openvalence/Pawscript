"""pawtrack.groups on synthetic tracks: two rigid bodies in anti-phase, a static background, 3 rogue points that sit
on body A but move with body B (cluster with B, fail the neighbour rule) and a global camera drift."""
import numpy as np
import pytest

from pawtrack.groups import group_tracks


def test_groups_synthetic():
    rng = np.random.default_rng(0)
    T, fps, per = 240, 24.0, 24
    s = np.sin(np.arange(T) * 2 * np.pi / per)[:, None]
    A = rng.uniform([0.15, 0.2], [0.35, 0.5], (30, 2))
    B = rng.uniform([0.6, 0.2], [0.8, 0.5], (30, 2))
    bg = rng.uniform([0.05, 0.6], [0.95, 0.95], (60, 2))
    rogue = rng.uniform([0.2, 0.25], [0.3, 0.45], (3, 2))
    xy = np.repeat(np.r_[A, B, bg, rogue][None], T, 0)
    xy[:, :30, 0] += 0.03 * s
    xy[:, 30:60, 0] -= 0.03 * s
    xy[:, 120:, 0] -= 0.03 * s + rng.normal(0, 0.01, (T, 3))  # on A, moving with B
    drift = 0.0005 * np.arange(T)
    xy[..., 0] += drift[:, None]
    xy += rng.normal(0, 0.0005, xy.shape)
    r = group_tracks(xy, np.ones((T, 123), bool), fps, aspect=16 / 9)
    lab = r["labels"]
    ga, gb = np.unique(lab[:, :30]), np.unique(lab[:, 30:60])
    assert len(ga) == 1 and len(gb) == 1 and ga[0] >= 1 and gb[0] >= 1 and ga[0] != gb[0], (ga, gb)  # stable ids
    assert (lab[:, 60:120] == 0).mean() > 0.95
    assert (lab[:, 120:] == -1).mean() > 0.9, lab[:, 120:].T
    assert (r["n_groups"] == 2).all()
    pd = r["pair_dist"]
    assert np.isfinite(pd).all() and pd.mean() > 0
    f = np.abs(np.fft.rfft(pd - pd.mean()))
    assert np.argmax(f) == T // per  # oscillates at the input period
    assert np.abs(r["cam"][:, 0] - (drift - drift[0])).max() < 0.01  # the drift is in cam_x
    for g in (ga[0], gb[0]):
        cx = r["cent"][:, g - 1, 0]
        assert abs(np.polyfit(np.arange(T), cx, 1)[0]) < 0.1 * 0.0005  # and not in the centroids


def test_cam_guard():
    """Camera reference guard (groups docstring): a pan over one stroking body must not put the stroke into cam.
    Box on the body only (cluster calls it all static): no reference, cam stays 0, cam_conf 0. Body covering 70 % of
    the grid (the body is the window median, so "static", the background a moving group): cam = the pan."""
    rng = np.random.default_rng(2)
    T, fps, per = 240, 24.0, 24
    s = 0.04 * np.sin(np.arange(T) * 2 * np.pi / per)
    pan = 0.0006 * np.arange(T)
    pts = rng.uniform(0.1, 0.9, (100, 2))
    body = np.arange(100) < 70
    xy = np.repeat(pts[None], T, 0) + rng.normal(0, 0.0005, (T, 100, 2))
    xy[:, body, 1] += s[:, None]
    xy[..., 0] += pan[:, None]
    vis = np.ones((T, 100), bool)
    one = group_tracks(xy[:, body], vis[:, body], fps, aspect=16 / 9)
    assert (one["cam_conf"] == 0).all() and np.abs(one["cam"]).max() == 0
    most = group_tracks(xy, vis, fps, aspect=16 / 9)
    assert np.abs(most["cam"][:, 0] - pan).max() < 0.01 and np.abs(most["cam"][:, 1]).max() < 0.005  # pan, no stroke
    assert np.median(most["cam_conf"]) == pytest.approx(0.3, abs=0.05)  # the 30 background points


def test_borderline_stable():
    """Label stability (vote + hysteresis): bodies A (sin) and B (cos) and 3 points between them at a phase that
    jitters around 45 deg every 2 s (correlation ~0.7 with both). The borderline points must not flip group at every
    window step (the old nearest-window labels flipped them 3 times each over 30 s) and A / B stay two groups."""
    rng = np.random.default_rng(1)
    T, fps, per = 720, 24.0, 24
    ph = np.arange(T) * 2 * np.pi / per
    A = rng.uniform([0.15, 0.2], [0.35, 0.5], (30, 2))
    B = rng.uniform([0.6, 0.2], [0.8, 0.5], (30, 2))
    bg = rng.uniform([0.05, 0.6], [0.95, 0.95], (120, 2))
    mid = rng.uniform([0.42, 0.3], [0.53, 0.4], (3, 2))
    xy = np.repeat(np.r_[A, B, bg, mid][None], T, 0)
    xy[:, :30, 1] += 0.03 * np.sin(ph)[:, None]
    xy[:, 30:60, 1] += 0.03 * np.cos(ph)[:, None]
    th = np.repeat(np.pi / 4 + rng.uniform(-0.3, 0.3, (T // 48 + 1, 3)), 48, 0)[:T]
    xy[:, 180:, 1] += 0.03 * np.sin(ph[:, None] + th)
    xy += rng.normal(0, 0.001, xy.shape)
    r = group_tracks(xy, np.ones((T, 183), bool), fps, aspect=16 / 9)
    lab = r["labels"]
    ga, gb = np.unique(lab[:, :30]), np.unique(lab[:, 30:60])
    assert len(ga) == 1 and len(gb) == 1 and ga[0] >= 1 and gb[0] >= 1 and ga[0] != gb[0], (ga, gb)
    assert (r["n_groups"] == 2).all()
    assert (lab[1:, 180:] != lab[:-1, 180:]).sum() <= 2, lab[:, 180:].T


def _ids(x):
    return np.unique(x[x > 0])


def _mode(x):
    return int(np.bincount(x.ravel() + 1).argmax()) - 1


def _scene(rng, T, bodies, n_bg=150):
    """Static points at the given (N,2) seed arrays + background; returns xy (T,N,2) before motion, slices per body."""
    pts = [b for b in bodies] + [rng.uniform([0.05, 0.7], [0.95, 0.95], (n_bg, 2))]
    sl, i = [], 0
    for b in bodies:
        sl.append(slice(i, i + len(b)))
        i += len(b)
    return np.repeat(np.concatenate(pts)[None], T, 0), sl


@pytest.mark.parametrize("sync_from", [0.2, 0.0])
def test_sync_stays_two(sync_from):
    """Owner's complaint: bodies A and B move differently for the first 20 %, then in exact sync for the middle 60 %
    (same displacement: correlation 1), then differently again. They must stay two ids throughout, and pair_dist must
    stay defined and flat during the sync (the relative motion is zero). sync_from 0: in sync from the first frame for
    80 % of the scene (the first windows see one body; the ids are seeded on the clearest window and carried back)."""
    rng = np.random.default_rng(3)
    T, fps, per = 1440, 24.0, 24
    ph = np.arange(T) * 2 * np.pi / per
    sync = (np.arange(T) >= sync_from * T) & (np.arange(T) < 0.8 * T)
    xy, (a, b) = _scene(rng, T, [rng.uniform([0.1, 0.2], [0.3, 0.5], (30, 2)), rng.uniform([0.6, 0.2], [0.8, 0.5], (30, 2))])
    xy[:, a, 1] += 0.03 * np.sin(ph)[:, None]
    xy[:, b, 1] += 0.03 * np.where(sync, np.sin(ph), np.cos(ph))[:, None]
    xy += rng.normal(0, 0.0005, xy.shape)
    r = group_tracks(xy, np.ones(xy.shape[:2], bool), fps, aspect=16 / 9, axis=(0.0, 1.0))
    lab = r["labels"]
    ga, gb = np.unique(lab[:, a]), np.unique(lab[:, b])
    assert len(ga) == 1 and len(gb) == 1 and ga[0] >= 1 and gb[0] >= 1 and ga[0] != gb[0], (ga, gb)
    assert (r["n_groups"] == 2).all()
    mid = slice(int(0.3 * T), int(0.7 * T))
    pd = r["pair_dist"][mid]
    assert np.isfinite(pd).all() and np.std(pd) < 0.002, np.std(pd)  # flat: no relative motion


def test_detached_part_new_id():
    """A 12-point piece of body A rides with A for the first half, then moves on its own (other phase): it gets a NEW
    id (not A's, not B's); A and B keep theirs throughout. (The ids are seeded on the scene's clearest window, here in
    the second half, and propagated both ways: the piece keeps its own id while it rides along in the first half.)"""
    rng = np.random.default_rng(4)
    T, fps, per = 960, 24.0, 24
    ph = np.arange(T) * 2 * np.pi / per
    late = np.arange(T) >= T // 2
    A = rng.uniform([0.1, 0.2], [0.35, 0.5], (40, 2))
    xy, (a, b) = _scene(rng, T, [A, rng.uniform([0.6, 0.2], [0.8, 0.5], (30, 2))])
    piece = np.flatnonzero(xy[0, :40, 0] > np.sort(xy[0, :40, 0])[-13])  # A's 12 right-most points
    rest = np.setdiff1d(np.arange(40), piece)
    xy[:, :40, 1] += 0.03 * np.sin(ph)[:, None]
    xy[:, piece, 1] += np.where(late, 0.04 * np.sin(ph * 0.7 + 1.3) - 0.03 * np.sin(ph), 0)[:, None]
    xy[:, b, 1] += 0.03 * np.cos(ph)[:, None]
    xy += rng.normal(0, 0.0005, xy.shape)
    r = group_tracks(xy, np.ones(xy.shape[:2], bool), fps, aspect=16 / 9)
    lab = r["labels"]
    ga, gb, gp = _mode(lab[:, rest]), _mode(lab[:, b]), _mode(lab[-T // 4:, piece])
    assert ga > 0 and gb > 0 and gp > 0 and len({ga, gb, gp}) == 3, (ga, gb, gp)
    assert (lab[:, rest] == ga).mean() > 0.9 and (lab[:, b] == gb).all() and (lab[-T // 4:, piece] == gp).mean() > 0.9


def test_merge_needs_long_sync_and_contact(monkeypatch):
    """Two bodies that touch (one cloud split at x = 0.5) move differently for 10 s, then identically. They stay two
    ids until MERGE_SYNC_S (set to 10 s here) of sync, then merge into one; the same pair with a gap between them
    (test_sync_stays_two's layout) never merges."""
    from pawtrack import groups
    monkeypatch.setattr(groups, "MERGE_SYNC_S", 10.0)
    rng = np.random.default_rng(5)
    T, fps, per = 960, 24.0, 24
    ph = np.arange(T) * 2 * np.pi / per
    sync = np.arange(T) >= 240
    cloud = rng.uniform([0.3, 0.2], [0.7, 0.5], (60, 2))
    cloud = cloud[np.argsort(cloud[:, 0])]
    xy, (a, b) = _scene(rng, T, [cloud[:30], cloud[30:]])
    xy[:, a, 1] += 0.03 * np.sin(ph)[:, None]
    xy[:, b, 1] += 0.03 * np.where(sync, np.sin(ph), np.cos(ph))[:, None]
    xy += rng.normal(0, 0.0005, xy.shape)
    n0 = groups.stats["merges"]
    lab = group_tracks(xy, np.ones(xy.shape[:2], bool), fps, aspect=16 / 9)["labels"]
    assert groups.stats["merges"] == n0 + 1
    two = slice(0, 240 + 9 * 24)  # until ~10 s of sync
    ga, gb = _mode(lab[two, a]), _mode(lab[two, b])
    assert ga > 0 and gb > 0 and ga != gb and (lab[two, a] == ga).mean() > 0.9 and (lab[two, b] == gb).mean() > 0.9
    assert len(_ids(lab[-120:, :60])) == 1 and (lab[-120:, :60] > 0).mean() > 0.9  # one body at the end
