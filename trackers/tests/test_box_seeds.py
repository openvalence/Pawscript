"""Motion-weighted box seeds and pinned semantic groups (points.flow_energy / box_seeds / Reseed / wrap,
groups.sem_tracks) on synthetic frames with fake runners: no models, no tagger."""
import cv2
import numpy as np
import pytest

from pawtrack import partlabel
from pawtrack.groups import group_tracks
from pawtrack.trackers import NOTES
from pawtrack import points as C

WHOLE = {"kind": "box", "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0}
P = {"axis": "vertical", "axis_x0": 0.5, "axis_y0": 0.3, "axis_x1": 0.5, "axis_y1": 0.7, "gap_ms": 1000,
     "primary": "proj", "box_seed": "motion", "box_points": 64, "reseed_every_ms": 1000, "retire_ms": 2000,
     "max_points": 0, "held_input": "off", "seed_frame": "first", "sem_groups": False}
RNG = np.random.default_rng(0)
BG = cv2.GaussianBlur(RNG.integers(0, 255, (180, 320, 3), dtype=np.uint8), (3, 3), 0)
BG[:, 240:] = 128  # flat strip: x > 0.75
BLOB = RNG.integers(0, 255, (40, 40, 3), dtype=np.uint8)
BX = (80, 120)  # blob columns: x 0.25 .. 0.375
ms = lambda k: round(k * 1000 / 30)


def frame(k):
    f = BG.copy()
    y = 90 + int(round(30 * np.sin(k / 4)))
    f[y - 20:y + 20, BX[0]:BX[1]] = BLOB
    return f


FRAMES = [(ms(k), frame(k)) for k in range(90)]
ASPECT = 320 / 180


def in_blob_cols(s):
    return (s[:, 0] >= BX[0] / 320) & (s[:, 0] <= BX[1] / 320)


def energy(frames=FRAMES):
    return C.flow_energy([f for _, f in frames], [t for t, _ in frames], ASPECT)


def test_motion_seeds_follow_the_motion():
    e = energy()
    assert e.shape == (144, 256)
    g = C.flow_grey(FRAMES[0][1], ASPECT)
    for n in (64, 256):
        s, sem, lat = C.box_seeds(WHOLE, {"box_points": n, "box_seed": "motion"}, g, e)
        grid, _ = C.seed_points(WHOLE, {"box_points": n, "box_seed": "grid"})
        assert len(s) == n and not sem.any() and lat[0] == 64
        assert in_blob_cols(s).mean() > 2.5 * in_blob_cols(grid).mean()  # the moving column gets the dense share
        assert (s[:, 0] > 0.76).sum() == 0  # flat strip: none
        static = ~in_blob_cols(s) & (s[:, 0] < 0.74)
        assert static.sum() >= 6  # the floor keeps the static background (camera reference, static group)
        d = np.linalg.norm((s[:, None] - s[None]) * [320, 180], axis=2) + np.eye(n) * 1e9
        assert d.min() > 0.5  # no duplicates
    a = C.box_seeds(WHOLE, {"box_points": 64, "box_seed": "motion"}, g, e)
    b = C.box_seeds(WHOLE, {"box_points": 64, "box_seed": "motion"}, g, e)
    assert np.array_equal(a[0], b[0])  # deterministic


def test_flow_pass_skips_held_frames_and_removes_the_camera():
    held = [FRAMES[k - k % 3] for k in range(90)]  # on threes
    e = energy(held)
    assert e[:, 64:96].mean() > 3 * e[:, :48].mean()
    pan = [(t, np.roll(f, k, axis=1)) for k, (t, f) in enumerate(FRAMES)]  # a camera pan is removed
    assert np.median(energy(pan)[:, :48]) < 1.0


def test_pinned_regions_and_order():
    g = C.flow_grey(FRAMES[0][1], ASPECT)
    m = np.zeros((9, 16), bool)
    m[2:5, 2:5] = True  # x 0.125 .. 0.31, y 0.22 .. 0.56
    flat = np.zeros((9, 16), bool)
    flat[:, 13:] = True  # a region on the flat strip still gets its points
    for lay, e in (("grid", None), ("motion", energy())):
        s, sem, _ = C.box_seeds(WHOLE, {"box_points": 100, "box_seed": lay}, g, e, {"balls": m, "hips": flat})
        assert abs(len(s) - 100) <= 2 and (sem == 2).sum() == 16 and (sem == 3).sum() == 16 and (sem == 1).sum() == 0  # v4.46: at least 16 each
        assert np.all(np.diff(sem) >= 0)  # layout first, pinned last by id
        b = s[sem == 2]
        assert (b[:, 0] >= 2 / 16).all() and (b[:, 0] <= 5 / 16).all() and (b[:, 1] >= 2 / 9).all() and (b[:, 1] <= 5 / 9).all()
        assert (s[sem == 3][:, 0] >= 13 / 16).all()
    s, sem, _ = C.box_seeds(WHOLE, {"box_points": 20, "box_seed": "grid"}, g, None, {"balls": m, "hips": m, "penis": m})
    assert abs(len(s) - 20) <= 2 and (sem > 0).sum() == 15  # v4.46: at most 3/4 of n pinned (an even share when 16 each does not fit)


def static_run(fr, seed, reseed=None):
    """Fake runner: every point stays where it was seeded, visible."""
    for t, img in fr:
        yield t, seed.copy(), np.ones(len(seed), bool), np.ones(len(seed)), np.ones(len(seed))


def test_wrap_motion_layout_and_clicks():
    NOTES.clear()
    out = list(C.wrap(static_run, WHOLE, FRAMES, P, lambda vp, cf: 1.0, None, work_wh=(160, 120)))
    assert len(out) == 90 and len(out[0][2]["pts"]) == 64
    seed = next(n for n in NOTES if n["code"] == "primary")["data"]["seed"]
    assert seed["layout"] == "motion" and seed["flow_ms"] >= 0 and seed["mode"] == "first"
    xs = np.array([q[0] for q in out[0][2]["pts"]])
    assert ((xs >= BX[0] / 320) & (xs <= BX[1] / 320)).mean() > 0.25
    clicks = {"kind": "points", "points": [[0.6, 0.2], [0.1, 0.9]]}  # clicks: never re-laid, indices kept
    out = list(C.wrap(static_run, clicks, FRAMES, P, lambda vp, cf: 1.0, None, work_wh=(160, 120)))
    assert [q[:2] for q in out[0][2]["pts"]] == [[0.6, 0.2], [0.1, 0.9]]


def test_wrap_pinned_groups(monkeypatch):
    m = np.zeros((9, 16), bool)
    m[3:6, 4:6] = True
    monkeypatch.setattr(partlabel, "hydra_ready", lambda: True)
    monkeypatch.setattr(partlabel, "sam_ready", lambda: False)  # no SAM in a CPU test
    monkeypatch.setattr(partlabel, "SHAPE", "cam")
    monkeypatch.setattr(partlabel, "sem_regions", lambda bgr, box, **kw: (
        {"balls": m}, {"balls": {"label": "balls", "source": "cam", "score": 0.9, "peak": [0.3, 0.4], "cells": 6}}))
    NOTES.clear()
    p = P | {"box_seed": "grid", "sem_groups": True}
    out = list(C.wrap(static_run, WHOLE, FRAMES, p, lambda vp, cf: 1.0, None, work_wh=(160, 120)))
    pts = out[0][2]["pts"]
    pinned = [q for q in pts if len(q) == 6]
    assert abs(len(pts) - 64) <= 2 and len(pinned) == 16 and all(q[5] == 2 and q[4] == 0 for q in pinned)  # v4.46: at least 16 a group
    assert all(4 / 16 <= q[0] <= 6 / 16 and 3 / 9 <= q[1] <= 6 / 9 for q in pinned)
    ch = out[0][1]["channels"]
    assert ch["sem_balls_n"] == 16 / len(pts) and ch["sem_balls_x"] is not None and ch["sem_penis_x"] is None
    gl = next(n for n in NOTES if n["code"] == "group_labels")["data"]["groups"]
    assert gl["sem_balls"]["source"] == "cam" and gl["sem_balls"]["points"] == 16


def test_sem_shape_and_sem_track_params(monkeypatch):
    """The tracker params pick the outline and the propagation per request: sem_shape cam never runs GrabCut (grabcut
    does), sem_track false never touches the SAM predictor or the mask propagation (even with SAM installed)."""
    m = np.zeros((9, 16), bool)
    m[3:6, 4:6] = True
    calls = []
    monkeypatch.setattr(partlabel, "hydra_ready", lambda: True)
    monkeypatch.setattr(partlabel, "sam_ready", lambda: True)
    monkeypatch.setattr(partlabel, "sem_regions", lambda bgr, box, **kw: ({"balls": m}, {"balls": {"label": "balls"}}))
    monkeypatch.setattr(partlabel, "grabcut", lambda *a, **k: calls.append("grabcut"))
    monkeypatch.setattr(partlabel, "_sam", lambda *a, **k: calls.append("sam") or 1 / 0)
    monkeypatch.setattr(partlabel, "track_masks", lambda *a, **k: calls.append("track") or 1 / 0)
    names = {q["key"] for q in C.common_params()}
    assert {"sem_shape", "sem_track"} <= names
    base = P | {"box_seed": "grid", "sem_groups": True, "sem_track": False}
    for shape, want in (("cam", []), ("grabcut", ["grabcut"])):
        calls.clear()
        NOTES.clear()
        out = list(C.wrap(static_run, WHOLE, FRAMES, base | {"sem_shape": shape}, lambda vp, cf: 1.0, None, work_wh=(160, 120)))
        assert calls == want and len(out) == 90
        assert sum(len(q) == 6 for q in out[0][2]["pts"]) == 16  # the pinned group is there either way

def test_reseed_keeps_pinned_points_in_their_hull():
    grid = C.seed_points(WHOLE, {"box_points": 16, "box_seed": "grid"})[0]
    seed = np.r_[grid, [[0.5, 0.5], [0.52, 0.5], [0.5, 0.53], [0.53, 0.53]]]
    sem = np.r_[np.zeros(16, int), [3, 3, 3, 3]]
    rs = C.Reseed(WHOLE, seed, 0, 0, {"reseed_every_ms": 1000, "retire_ms": 500, "max_points": 0}, 0, lattice=(16, None), sem=sem)
    vis = np.ones(20, bool)
    vis[16] = False  # one hips point lost
    img = np.ascontiguousarray(BG[:, :, ::-1])
    rs(0, img, seed, vis)
    slots, new = rs(1000, img, seed, vis)
    assert list(slots) == [16] and rs.sem_out[-1] == 3 and rs.sem[16] == 3
    assert 0.5 <= new[0, 0] <= 0.53 and 0.5 <= new[0, 1] <= 0.53


def test_group_tracks_pinned_contraction():
    """A body bobbing with a pinned clump on it that also pulses in size: the clump stays out of the clustering,
    keeps its own group, sits on the body, and its scale follows the pulse."""
    T, fps = 240, 30.0
    t = np.arange(T) / fps
    rng = np.random.default_rng(1)
    body = rng.uniform([0.3, 0.3], [0.6, 0.6], (30, 2))
    bg = rng.uniform(0, 1, (60, 2))
    clump = np.array([0.45, 0.62]) + rng.normal(0, 0.02, (8, 2))
    bob = 0.05 * np.sin(2 * np.pi * t / 1.2)[:, None] * [0, 1]
    pulse = 1 + 0.2 * np.sin(2 * np.pi * t / 0.7)
    xy = np.concatenate([np.broadcast_to(bg, (T, 60, 2)), body[None] + bob[:, None],
                         clump.mean(0) + (clump - clump.mean(0))[None] * pulse[:, None, None] + bob[:, None]], 1)
    vis = np.ones(xy.shape[:2], bool)
    pinned = np.r_[np.zeros(90, int), np.full(8, 2)]
    g = group_tracks(xy, vis, fps, pinned=pinned)
    lb = g["labels"][:, 60:90]
    assert (g["labels"][:, 90:] == -1).all() and (lb >= 1).mean() > 0.9
    assert g["sem_body"][1] == np.bincount(lb[lb > 0]).argmax()
    sc = g["sem_scale"][:, 1]
    assert np.isfinite(sc).all() and np.corrcoef(sc[30:-30], pulse[30:-30])[0, 1] > 0.8
    assert np.isnan(g["sem_cent"][:, 0]).all() and np.allclose(g["sem_share"][:, 1], 8 / 98)


def test_sem_regions_from_heat(monkeypatch):
    """The region is the blob >= 0.5 x the peak that holds the peak; a box keeps only regions peaking inside it."""
    balls = np.zeros((9, 16), np.float32)
    balls[6, 3], balls[6, 4], balls[2, 12] = 1.0, 0.6, 0.9  # main blob + a separate weaker one
    butt = np.zeros((9, 16), np.float32)
    butt[1, 14] = 1.0

    def heat(frames, probs=None):
        probs.update({"balls": [0.8], "butt": [0.4], "wide_hips": [0.6]})
        return [{"balls": balls, "butt": butt}]
    monkeypatch.setattr(partlabel, "heat_maps", heat)
    reg, rec = partlabel.sem_regions(np.zeros((90, 160, 3), np.uint8))
    assert set(reg) == {"balls", "hips"} and reg["balls"].sum() == 2 and reg["balls"][6, 3] and reg["balls"][6, 4]
    assert rec["hips"]["score"] == 0.6 and rec["balls"]["source"] == "cam" and rec["balls"]["cells"] == 2
    reg, rec = partlabel.sem_regions(np.zeros((90, 160, 3), np.uint8), (0.5, 0.0, 1.0, 0.5))
    assert set(reg) == {"balls", "hips"} and reg["balls"][2, 12] and reg["balls"].sum() == 1  # the box's own peak


# ---------------------------------------------------------------- outlines (partlabel.shape_regions) and pruning
def part_frame():
    """A 320 x 180 frame: textured grey background, a textured red disc (the part) at (100, 90) r 30."""
    f = np.full((180, 320, 3), 90, np.uint8)
    f[:] = cv2.GaussianBlur(RNG.integers(40, 140, (180, 320), dtype=np.uint8), (3, 3), 0)[..., None]
    yy, xx = np.mgrid[:180, :320]
    disc = (xx - 100) ** 2 + (yy - 90) ** 2 <= 30 ** 2
    tex = RNG.integers(0, 80, (180, 320), dtype=np.uint8)
    f[disc] = np.stack([tex, tex, 150 + tex], -1)[disc]
    return f, disc


def part_blob():
    """The CAM over a 9 x 16 patch grid: a 4 x 4 cell blob over the disc that spills onto the background."""
    h = np.zeros((9, 16), np.float32)
    h[3:7, 4:8] = 0.6
    h[4, 5] = 1.0
    return h >= 0.5, h


def iou(a, b):
    return (a & b).sum() / max((a | b).sum(), 1)


def test_grabcut_outline_hugs_the_part(monkeypatch):
    f, disc = part_frame()
    blob, h = part_blob()
    monkeypatch.setattr(partlabel, "SHAPE", "grabcut")
    rec = {"balls": {"label": "balls", "source": "cam"}}
    out = partlabel.shape_regions(f, {"balls": blob}, rec, {"balls": h})
    m = out["balls"]
    d = partlabel.fit_mask(disc, *m.shape[::-1])
    assert m.shape[1] == partlabel.SEED_W and rec["balls"]["source"] == "grabcut"
    assert rec["balls"]["mask_px"] < rec["balls"]["blob_px"]
    assert iou(m, d) > 0.8 > iou(partlabel.fit_mask(blob, *m.shape[::-1]), d) + 0.1
    again = partlabel.shape_regions(f, {"balls": blob}, {"balls": {}}, {"balls": h})["balls"]
    assert np.array_equal(m, again)  # deterministic
    # seeds: every pinned point on the part
    g = C.flow_grey(f, ASPECT)
    s, sem, _ = C.box_seeds(WHOLE, {"box_points": 100, "box_seed": "grid"}, g, None, out)
    b = s[sem == 2] * [320, 180]
    assert (sem == 2).sum() == 16 and all(disc[int(y), int(x)] for x, y in b)
    monkeypatch.setattr(partlabel, "SHAPE", "cam")  # the blob: some land on the background
    s, sem, _ = C.box_seeds(WHOLE, {"box_points": 100, "box_seed": "grid"}, g, None,
                            partlabel.shape_regions(f, {"balls": blob}, {}, {"balls": h}))
    assert not all(disc[int(y), int(x)] for x, y in s[sem == 2] * [320, 180])


class FakeSam:
    def __init__(self, masks):
        self.masks = masks

    def set_image(self, img):
        self.shape = img.shape[:2]

    def predict(self, point_coords, point_labels, multimask_output):
        assert point_labels[0] == 1 and point_labels.sum() >= 1
        return self.masks(self.shape), None, None


def test_sam_mask_too_big_or_too_small_falls_back(monkeypatch):
    f, disc = part_frame()
    blob, h = part_blob()
    monkeypatch.setattr(partlabel, "SHAPE", "sam")
    monkeypatch.setattr(partlabel, "sam_ready", lambda: True)
    for masks, src, why in ((lambda s: np.ones((3, *s), np.float32), "grabcut", "big"),  # swallowed the frame
                            (lambda s: np.zeros((3, *s), np.float32), "cam", "small"),
                            (lambda s: np.stack([disc, ~disc, disc]).astype(np.float32), "sam", None)):
        monkeypatch.setattr(partlabel, "_sam", lambda m=masks: FakeSam(m))
        rec = {}
        m = partlabel.shape_regions(f, {"balls": blob}, rec, {"balls": h})["balls"]
        assert rec["balls"]["source"] == src and rec["balls"].get("sam_reject") == why
        if src == "sam":  # the candidate with the best IoU with the blob
            assert iou(m, partlabel.fit_mask(disc, *m.shape[::-1])) > 0.95


def test_sam_prompt_from_the_cam():
    blob, h = part_blob()
    raw = h.copy()
    pts, lab = partlabel.sam_prompt(blob, h, raw, [np.array([1, 14])])
    assert tuple(pts[0]) == (4, 5) and lab[0] == 1 and 2 <= lab.sum() <= 3  # the peak, then core / blob cells
    assert all(blob[int(a), int(b)] for a, b in pts[lab == 1])
    neg = pts[lab == 0]
    assert [1, 14] in neg.tolist() and len(neg) == 1 + partlabel.SAM_BG
    assert not any(blob[int(a), int(b)] for a, b in neg)


def moving_group(k):
    """Pinned group of 10 at step k: 7 members bob 0.05 with the part, 3 sit still on the background."""
    base = np.array([[0.40, 0.40], [0.44, 0.40], [0.48, 0.40], [0.40, 0.45], [0.44, 0.45], [0.48, 0.45], [0.44, 0.50],
                     [0.30, 0.40], [0.56, 0.52], [0.32, 0.52]])
    xy = base.copy()
    xy[:7, 1] += 0.05 * np.sin(k / 2)
    return xy


def test_prune_retires_static_members_into_the_inlier_hull():
    grid = C.seed_points(WHOLE, {"box_points": 16, "box_seed": "grid"})[0]
    seed = np.r_[grid, moving_group(0)]
    sem = np.r_[np.zeros(16, int), np.full(10, 2)]
    img = np.ascontiguousarray(BG[:, :, ::-1])
    runs = []
    for _ in range(2):
        rs = C.Reseed(WHOLE, seed, 0, 0, {"reseed_every_ms": 1000, "retire_ms": 2000, "max_points": 0}, 0,
                      lattice=(16, None), sem=sem, aspect=ASPECT)
        got = None
        for k in range(1, 5):  # a call every 8 frames at 30 fps, the timed check at 1000 ms
            xy = np.r_[grid, moving_group(k * 2)]
            ans = rs(round(k * 8000 / 30), img, xy, np.ones(26, bool))
            got = ans if len(ans[0]) else got
        runs.append((got, rs))
    (slots, new), rs = runs[0]
    assert sorted(slots) == [23, 24, 25] and rs.pruned == {2: 3}  # the static three, nobody else
    assert (rs.sem == 2).sum() == 10 and rs.sem_out[-3:] == [2, 2, 2]  # count target kept
    P = moving_group(8)[:7]  # the inliers at the check
    hull = cv2.convexHull(P.astype(np.float32))
    assert all(cv2.pointPolygonTest(hull, (float(a), float(b)), False) >= 0 for a, b in new)
    assert np.array_equal(new, runs[1][0][1])  # deterministic


def test_motion_outliers_still_group_prunes_nothing():
    X = np.broadcast_to(moving_group(0), (6, 10, 2)) + RNG.normal(0, 1e-4, (6, 10, 2))
    bad, order = C.motion_outliers(X, np.ones((6, 10), bool), ASPECT)
    assert not bad.any() and not len(order)
    X = np.stack([moving_group(k) for k in range(6)])
    X[:, 2] += [0.0, 0.03]  # a member that follows the group's motion: kept
    bad, order = C.motion_outliers(X, np.ones((6, 10), bool), ASPECT)
    assert set(np.flatnonzero(bad)) == {7, 8, 9} and set(order) == {7, 8, 9}


def square_mask(cx, cy, r=0.06, shape=(144, 256)):
    """Bool mask over the frame (seed grid): a square of half side r around (cx, cy), normalized."""
    h, w = shape
    yy, xx = np.mgrid[:h, :w]
    return (np.abs((xx + 0.5) / w - cx) <= r) & (np.abs((yy + 0.5) / h - cy) <= r)


def test_mask_oracle_retires_points_outside_into_the_current_mask():
    """A pinned group judged by its part's mask: members that stay outside it for > retire_ms (the part moved on, they
    stayed on the background) are re-seeded on the current mask; nothing is motion-pruned."""
    grid = C.seed_points(WHOLE, {"box_points": 16, "box_seed": "grid"})[0]
    pinned = np.array([[0.30, 0.50], [0.32, 0.50], [0.30, 0.52], [0.32, 0.52], [0.31, 0.51], [0.29, 0.49]])
    seed = np.r_[grid, pinned]
    sem = np.r_[np.zeros(16, int), np.full(6, 1)]
    at = lambda t: (0.3 + 0.3 * min(t, 600) / 600, 0.5)  # the part slides right in 0.6 s, the points do not follow
    rs = C.Reseed(WHOLE, seed, 0, 0, {"reseed_every_ms": 1000, "retire_ms": 300, "max_points": 0}, 0,
                  lattice=(16, None), sem=sem, aspect=ASPECT, masks=lambda t: {1: square_mask(*at(t))})
    img = np.ascontiguousarray(BG[:, :, ::-1])
    got = None
    for k in range(1, 5):
        ans = rs(round(k * 8000 / 30), img, seed, np.ones(22, bool))
        got = ans if len(ans[0]) else got
    slots, new = got
    assert sorted(slots) == list(range(16, 22)) and not rs.pruned  # all six, by the mask
    assert C.in_mask(square_mask(*at(1000)), new).all() and (rs.sem == 1).sum() == 6


def test_wrap_tracked_outlines_membership_and_area(monkeypatch):
    """track_sem (outlines through the scene, faked): a pinned point counts for its group only inside the current mask
    (sem_balls_n drops when the mask leaves half of them), sem_balls_area = the mask's frame share, pts v follows."""
    m0 = square_mask(0.3, 0.5, 0.08)
    monkeypatch.setattr(partlabel, "hydra_ready", lambda: True)
    monkeypatch.setattr(partlabel, "sam_ready", lambda: True)
    monkeypatch.setattr(partlabel, "SEM_TRACK", True)
    monkeypatch.setattr(partlabel, "sem_regions", lambda bgr, box, **kw: ({"balls": m0}, {"balls": {"label": "balls"}}))
    monkeypatch.setattr(partlabel, "shape_regions", lambda bgr, reg, rec, heat=None, shape=None: (
        rec["balls"].update(source="sam"), reg)[1])
    half = m0 & (np.mgrid[:144, :256][1] < 0.3 * 256)  # from frame 45 on: only the left half of the part
    monkeypatch.setattr(partlabel, "track_masks", lambda frames, masks0: [
        {"balls": m0 if i < 45 else half} for i in range(len(frames))])
    NOTES.clear()
    p = P | {"box_seed": "grid", "sem_groups": True, "reseed_every_ms": 0}
    out = list(C.wrap(static_run, WHOLE, FRAMES, p, lambda vp, cf: 1.0, None, work_wh=(160, 120)))
    ch = [o[1]["channels"] for o in out]
    assert ch[0]["sem_balls_area"] == pytest.approx(m0.mean()) and ch[80]["sem_balls_area"] == pytest.approx(half.mean())
    assert ch[80]["sem_balls_n"] < ch[0]["sem_balls_n"] == 16 / len(out[0][2]["pts"]) and ch[0]["sem_penis_area"] is None
    pin = [q for q in out[80][2]["pts"] if len(q) == 6]
    assert all(q[2] == int(q[0] < 0.3) for q in pin)  # outside the mask: shown as not counted
    seed = next(n for n in NOTES if n["code"] == "primary")["data"]["seed"]
    assert seed["track_ms"] >= 0
    gl = next(n for n in NOTES if n["code"] == "group_labels")["data"]["groups"]
    assert gl["sem_balls"]["tracked"] is True


def _sam_cuda():
    try:
        return partlabel.sam_ready()
    except Exception:
        return False


@pytest.mark.gpu
@pytest.mark.skipif(not _sam_cuda(), reason="needs the sam2 extra, its tiny checkpoint and CUDA")
def test_sam_outline_gpu(monkeypatch):
    import time
    f, disc = part_frame()
    blob, h = part_blob()
    monkeypatch.setattr(partlabel, "SHAPE", "sam")
    partlabel.shape_regions(f, {"balls": blob}, {}, {"balls": h})  # model load
    rec, t0 = {}, time.perf_counter()
    m = partlabel.shape_regions(f, {"balls": blob}, rec, {"balls": h})["balls"]
    print(f"SAM outline {1000 * (time.perf_counter() - t0):.0f} ms, {rec}")
    assert rec["balls"]["source"] == "sam" and iou(m, partlabel.fit_mask(disc, *m.shape[::-1])) > 0.8
