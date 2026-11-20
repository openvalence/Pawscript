"""Re-seeding of the point trackers (points.Reseed + wrap) with fake runners: no models needed."""
import json

import numpy as np

from pawtrack.points import Reseed, translation, wrap

P = {"axis": "horizontal", "axis_x0": 0.5, "axis_y0": 0.3, "axis_x1": 0.5, "axis_y1": 0.7, "gap_ms": 1000,
     "primary": "proj", "box_seed": "grid", "box_points": 64, "reseed_every_ms": 1000, "retire_ms": 2000,
     "max_points": 0}
WHOLE = {"kind": "box", "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0}
RNG = np.random.default_rng(0)
NOISE = RNG.integers(0, 255, (90, 160, 3), dtype=np.uint8)  # textured frame
FLAT = np.full((90, 160, 3), 128, np.uint8)


def fake(pan, seen=None):
    """A runner that honours Reseed like the real ones: every slot sits at its scene position + pan(k); a slot is
    visible while inside the frame. New seeds are scene positions minus the current pan, written into their slots.
    seen: a list that collects the active point count of every frame."""
    def run(fr, seed, reseed=None):
        base, last = seed.copy(), None
        for k, (t, img) in enumerate(fr):
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


def frames(n, img=NOISE):
    return [(round(k * 1000 / 30), img) for k in range(n)]


def test_void_detection_moving_cloud():
    seed = np.stack(np.meshgrid((np.arange(8) + 0.5) / 8, (np.arange(8) + 0.5) / 8), -1).reshape(-1, 2)
    rs = Reseed(WHOLE, seed, 0, 0, P, 0)
    assert len(rs.cells) == 64 and rs.base == 0 and rs.cap == 64
    moved = seed + [0.3, 0.0]  # pan: the cloud slid right 2.4 cells; the left 2 columns are empty, 2 off-frame
    vis = (moved <= 1).all(1)
    assert rs(500, NOISE, moved, vis)[1].shape == (0, 2)  # not yet time
    slots, new = rs(1000, NOISE, moved, vis)
    off = np.flatnonzero(moved[:, 0] > 1.02)
    assert len(new) == 16 and (new[:, 0] < 0.25).all()  # 2 columns x 8 rows ...
    assert sorted(slots) == sorted(off) and len(rs.ids) == 64  # ... in the off-frame points' slots: n stays 64
    assert sorted(rs.born) == list(range(64, 80)) and sorted(rs.ids[off]) == list(range(64, 80)) and rs.dropped == 16
    rs2 = Reseed(WHOLE, seed, 0, 0, P, 0)
    assert rs2(1000, FLAT, moved, vis)[1].shape == (0, 2)  # no texture: nothing seeded
    body = {"kind": "box", "x": 0.4, "y": 0.4, "w": 0.2, "h": 0.2}  # a body box: voids only inside its hull
    bs = (np.stack(np.meshgrid((np.arange(4) + 0.5) / 4, (np.arange(4) + 0.5) / 4), -1).reshape(-1, 2) * 0.2 + 0.4)
    grown = (bs - 0.5) * 2 + 0.5  # zoom x2: the same points now spread over 4x the area
    rb = Reseed(body, bs, 0, 0, P, 0)
    assert rb.base == 0 and rb(1000, NOISE, grown, np.ones(16, bool))[1].shape == (0, 2)  # all visible: no slot free
    rb = Reseed(body, bs, 0, 0, {**P, "max_points": 24}, 0)  # opted in to 8 more
    slots, new = rb(1000, NOISE, grown, np.ones(16, bool))
    assert len(new) == 8 and (np.abs(new - 0.5) < 0.2).all() and slots.tolist() == list(range(16, 24))  # inside the body


def test_retire_and_cap():
    box = {"kind": "box", "x": 0.2, "y": 0.2, "w": 0.6, "h": 0.6}
    g = (np.arange(4) + 0.5) / 4 * 0.6 + 0.2
    seed = np.stack(np.meshgrid(g, g), -1).reshape(-1, 2)  # index = row * 4 + col
    rs = Reseed(box, seed, 0, 0, P, 0)
    assert rs.base == 0 and rs.cap == 16 and len(rs.cells) > 16  # the lattice extends past the box
    xy, vis = seed.copy(), np.ones(16, bool)
    vis[[5, 6, 9, 10]] = False  # the 4 inner points hidden since t=0 ...
    xy[[6, 10]] = [1.5, 0.5]    # ... two of them off-frame
    slots, new = rs(1000, NOISE, xy, vis)
    assert slots.tolist() == [6, 10]  # hidden only 1 s: just the off-frame ones are retired
    xy[[6, 10]] = new
    vis[[6, 10]] = True
    slots, new = rs(3000, NOISE, xy, vis)  # 5 and 9 now hidden > 2 s
    assert slots.tolist() == [5, 9] and rs.dropped == 4 and len(rs.ids) == 16
    assert rs.ids.tolist() == [0, 1, 2, 3, 4, 18, 16, 7, 8, 19, 17, 11, 12, 13, 14, 15]
    vis[[5, 6, 9, 10]] = False  # every inner point hidden <= 2 s: nothing to retire, nothing seeded
    assert rs(4000, NOISE, xy, vis)[1].shape == (0, 2) and rs.dropped == 4
    clicks = np.array([[0.3, 0.3], [0.7, 0.3], [0.5, 0.7]])
    rc = Reseed({"kind": "points", "points": clicks.tolist()}, clicks, 3, 0, P, 0)
    far = (clicks - 0.5) * 1.8 + 0.5
    far[2, 1] = 1.5  # zoomed in, click 2 off-frame: clicks are never retired
    assert rc(3000, NOISE, far, np.array([True, True, False]))[1].shape == (0, 2) and rc.dropped == 0


def test_entry_does_not_step_proj():
    """A pan carries the whole cloud out of frame: re-seeds take over; the centroid (translation) moves exactly
    with the pan at every frame (no step when a point enters or leaves)."""
    pan = lambda k: np.array([0.004 * k, 0.0])  # 0.12 frame widths per second
    seen = []
    out = list(wrap(fake(pan, seen), WHOLE, frames(300), P, lambda vp, cf: 1.0, None))
    assert set(seen) == {64}  # constant n: new points only take retired slots
    rp = np.array([o[1]["channels"]["raw_px"] for o in out])
    assert np.allclose(np.diff(rp), 0.004 * 160, atol=1e-6)  # raw_px: proj in frame px (W 160), axis horizontal
    pts = np.array([o[2]["pts"] for o in out])  # (T, N, 4): constant length, index = point
    assert pts.shape[1] > 64 and (pts[-1, :64, 2] == 0).all() and pts[-1, :, 2].sum() >= 40  # new points visible
    assert len(out[-1][2]["boxes"]) < pts.shape[1] - pts[-1, :, 2].sum()  # retired / unborn: no boxes
    born = np.argmax(pts[:, 64:, 2] > 0, 0)
    assert born.min() > 0 and (pts[born.min() - 1, 64:, 2] == 0).all()  # pre-birth: invisible
    cover = lambda xy, v: len({(int(a * 8), int(b * 8)) for (a, b), w in zip(xy, v) if w and 0 <= a < 1 and 0 <= b < 1})
    assert cover(pts[-1, :, :2], pts[-1, :, 2]) >= 44  # most 8x8 cells covered (a slot frees once off-frame)
    off = list(wrap(fake(pan), WHOLE, frames(300), {**P, "reseed_every_ms": 0}, lambda vp, cf: 1.0, None))
    assert cover(np.array(off[-1][2]["pts"])[:, :2], np.array(off[-1][2]["pts"])[:, 2]) == 0  # all gone


def test_naive_anchor_would_step():
    """Why anchors(): anchoring a new point at its own birth position steps the plain mean."""
    xy = np.array([[[0.5, 0.5], [0.2, 0.5]], [[0.6, 0.5], [0.3, 0.5]]])
    vis = np.array([[True, False], [True, True]])
    naive = translation(xy, vis, np.array([[0.4, 0.5], [0.3, 0.5]]), np.array([0.4, 0.5]))
    assert abs(naive[1, 0] - naive[0, 0] - 0.1) > 0.04  # moved 0.1, reads 0.05


def test_no_void_byte_identical():
    """A static full cloud: re-seeding on never fires, and the output is byte-identical to re-seeding off."""
    still = lambda k: np.array([0.0, 0.002 * np.sin(k / 4)])
    on = list(wrap(fake(still), WHOLE, frames(120), P, lambda vp, cf: 1.0, None))
    off = list(wrap(fake(still), WHOLE, frames(120), {**P, "reseed_every_ms": 0}, lambda vp, cf: 1.0, None))
    assert json.dumps(on) == json.dumps(off) and len(on[0][2]["pts"]) == 64


def test_groups_keep_id_when_a_body_gains_points():
    """4 points join body A mid-scene (hidden before; re-seeds keep about one point per cell, so a body's share stays
    near its area share): A keeps its group id, the newcomers join it once eligible, A's centroid does not jump."""
    from pawtrack.groups import group_tracks
    T, per, k0 = 360, 24, 150
    s = np.sin(np.arange(T) * 2 * np.pi / per)
    g = (np.arange(6) + 0.5) / 6
    seed = np.stack(np.meshgrid(g, g), -1).reshape(-1, 2)
    late = np.array([[0.1, 0.25], [0.3, 0.25], [0.1, 0.75], [0.3, 0.75]])
    pts = np.r_[seed, late]
    a, b = pts[:, 0] < 0.4, pts[:, 0] > 0.7
    rng = np.random.default_rng(2)
    xy = np.repeat(pts[None], T, 0) + rng.normal(0, 0.0005, (T, len(pts), 2))
    xy[:, a, 1] += 0.05 * s[:, None]
    xy[:, b, 1] -= 0.05 * s[:, None]
    vis = np.ones((T, len(pts)), bool)
    vis[:k0, len(seed):] = False
    gr = group_tracks(xy, vis, 24.0)
    lab = gr["labels"]
    ga = set(lab[k0 - 10, :len(seed)][a[:len(seed)]])
    assert len(ga) == 1 and ga == set(lab[T - 10, :len(seed)][a[:len(seed)]]) and min(ga) >= 1
    ga = ga.pop()
    assert (lab[T - 10, len(seed):] == ga).all()
    c = gr["cent"][:, ga - 1, 1]
    step = np.abs(np.diff(c))
    assert step[k0 - 5:k0 + 5].max() < 1.5 * step[:k0 - 20].max()  # no jump at the entry


# ---------------------------------------------------------------- soft cuts (PROTOCOL v4.9)

def test_soft_cut_check_keeps_ids_and_fills_the_box():
    """A soft cut runs a check off the clock: hidden points go at once (not after retire_ms), off-frame first; the void
    region takes the ROI box's cells again; visible points keep their ids; the count stays the cap."""
    box = {"kind": "box", "x": 0.3, "y": 0.3, "w": 0.4, "h": 0.4}
    g = (np.arange(4) + 0.5) / 4 * 0.4 + 0.3
    seed = np.stack(np.meshgrid(g, g), -1).reshape(-1, 2)
    P10 = {**P, "reseed_every_ms": 10000}  # no timed check in the window
    moved = seed + [0.3, 0.0]  # the camera panned: the cloud slid 0.3 right, the box's left part is empty
    vis = np.ones(16, bool)
    vis[[3, 7]] = False         # two points just lost (hidden 0.5 s < retire_ms)
    moved[[11, 15]] = [1.1, 0.5]  # two off-frame
    plain = Reseed(box, seed, 0, 0, P10, 0)
    assert plain(500, NOISE, seed, np.ones(16, bool))[1].shape == (0, 2)
    assert plain(1500, NOISE, moved, vis)[1].shape == (0, 2)  # no soft cut: nothing until the clock
    rs = Reseed(box, seed, 0, 0, P10, 0, soft=[1400])
    rs(500, NOISE, seed, np.ones(16, bool))
    ids0 = rs.ids.copy()
    slots, new = rs(1500, NOISE, moved, vis)
    assert rs.soft_checks == 1 and sorted(slots) == [3, 7, 11, 15] and slots[:2].tolist() == [11, 15]  # off-frame first
    assert ((new >= [0.3, 0.3]) & (new <= [0.7, 0.7])).all(1).all()  # seeded in the box, where the cloud left
    keep = np.setdiff1d(np.arange(16), slots)
    assert np.array_equal(rs.ids[keep], ids0[keep]) and len(rs.ids) == 16  # visible ids kept, n constant
    assert rs(1600, NOISE, moved, vis)[1].shape == (0, 2)  # one pass per soft cut


def test_soft_cut_refills_a_pinned_group_on_its_region():
    """The tagger finds the penis region again at the soft cut while fewer than half its points are visible: the group
    is refilled on that region up to its initial count, under its own id; a group still half there is left alone."""
    box = {"kind": "box", "x": 0.0, "y": 0.0, "w": 0.6, "h": 0.6}  # < RESEED_WHOLE: voids only in hull + box
    g = (np.arange(4) + 0.5) / 4 * 0.6
    seed = np.stack(np.meshgrid(g, g), -1).reshape(-1, 2)
    sem = np.zeros(16, int)
    sem[[5, 6, 9, 10]] = 1  # penis
    sem[[0, 1, 4]] = 2      # balls
    mask = np.zeros((32, 32), bool)
    mask[20:28, 20:28] = True  # the region on the new segment's frame (lower right)
    asked = []
    redetect = lambda img: asked.append(1) or {1: mask, 2: np.ones((32, 32), bool)}
    rs = Reseed(box, seed, 0, 0, {**P, "reseed_every_ms": 10000}, 0, sem=sem, soft=[1000], redetect=redetect)
    vis = np.ones(16, bool)
    vis[[5, 6, 9]] = False  # penis: 1 of 4 visible; balls all visible
    slots, new = rs(1000, NOISE, seed, vis)
    assert asked == [1] and rs.refilled == {1: 3} and rs.n0 == {1: 4, 2: 3}
    born = [i for i, (t, _) in rs.born.items()]
    assert [rs.sem_out[i] for i in born] == [1, 1, 1]  # the old group id
    assert sorted(slots.tolist()) == [5, 6, 9]  # its own lost slots
    assert (np.abs(new - 0.75) < 0.13).all()  # on the region (mask rows / cols 20..28 of 32)
    assert len(rs.ids) == 16


def test_soft_cut_through_wrap():
    """wrap passes p["soft_cuts"] to Reseed: nothing lost and no void -> the output is byte-identical to no soft cut;
    a pan that loses points re-seeds at the cut with the visible points' indices kept and n constant (the cap)."""
    still = lambda k: np.array([0.0, 0.002 * np.sin(k / 4)])
    a = list(wrap(fake(still), WHOLE, frames(120), P, lambda vp, cf: 1.0, None))
    b = list(wrap(fake(still), WHOLE, frames(120), {**P, "soft_cuts": [2000]}, lambda vp, cf: 1.0, None))
    assert json.dumps(a) == json.dumps(b)
    box = {"kind": "box", "x": 0.2, "y": 0.2, "w": 0.6, "h": 0.6}
    pan = lambda k: np.array([0.006 * max(0, k - 30), 0.0])
    seen0, seen1 = [], []
    p10 = {**P, "box_points": 36, "reseed_every_ms": 10000}
    plain = list(wrap(fake(pan, seen0), box, frames(150), p10, lambda vp, cf: 1.0, None))
    soft = list(wrap(fake(pan, seen1), box, frames(150), {**p10, "soft_cuts": [2500]}, lambda vp, cf: 1.0, None))
    assert set(seen1) == {36} and set(seen0) == {36}  # the cap: retire before admit
    P0, P1 = (np.array([o[2]["pts"][:36] for o in r]) for r in (plain, soft))
    assert np.array_equal(P0[:75], P1[:75])  # before the cut: the same run
    k = 80
    stay = (P1[k, :, 2] == 1) & (P0[k, :, 2] == 1)
    assert stay.sum() >= 10 and np.allclose(P0[k, stay, :2], P1[k, stay, :2])  # visible points: same index, same track
    assert len(soft[-1][2]["pts"]) > len(plain[-1][2]["pts"])  # the soft cut re-seeded (new indices appended)
    assert any("soft-cut pass" in n["message"] for n in __import__("pawtrack.trackers", fromlist=["NOTES"]).NOTES)


# ---------------------------------------------------------------- GPU: the real models (skipped without CUDA)

from test_cli import video  # noqa: E402, F401 (fixture)
from test_points_cotracker import gpu  # noqa: E402

NEW4 = np.array([[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]])
SLOTS = np.array([21, 22, 23, 24])  # the 4 points they replace (of a 5 x 5 grid)
GRID = np.stack(np.meshgrid(np.linspace(0.1, 0.9, 5), np.linspace(0.1, 0.9, 5)), -1).reshape(-1, 2)


class Once:
    """A stand-in Reseed: puts NEW4 into SLOTS once, at the first chance at or after 1 s."""
    t = None

    def __call__(self, t, img, xy, vis):
        if self.t is None and t >= 1000:
            self.t = t
            return SLOTS, NEW4
        return np.zeros(0, int), np.zeros((0, 2))


def first_scene(video):
    from pawtrack.video import open_frames
    import make_video as mv
    return list(open_frames(video, 0, mv.CUT_FRAME * 1000 // mv.FPS - 1)[1])


def check_refill(run, fr, tol_px):
    """Constant n; rows before the change are untouched; the refilled slots track like a fresh run from their
    frame (median px at 640 x 360)."""
    plain = list(run(fr, GRID))
    st = Once()
    re = list(run(fr, GRID, reseed=st))
    k = [r[0] for r in re].index(st.t)
    assert {len(r[1]) for r in re} == {25}
    assert all(np.array_equal(a[1], b[1]) for a, b in zip(plain[:k - 8], re[:k - 8]))
    fresh = list(run(fr[k:], NEW4))
    err = np.concatenate([np.linalg.norm((a[1][SLOTS] - b[1]) * [640, 360], axis=1) for a, b in zip(re[k:], fresh)])
    assert np.median(err) < tol_px, np.median(err)
    return np.median(err)


@gpu("tapnet")
def test_tapnext_refill_in_place(video):
    """TAPNext++ (256, 25 points): a retired slot is reset in place (no state copy) and tracks its new point."""
    import torch
    from pawtrack.trackers.tapnext_points import load_model, refill, run_tapnext
    fr = first_scene(video)
    check_refill(lambda f, s, reseed=None: run_tapnext(f, s, chunk=8, reseed=reseed), fr, 2.0)
    m = load_model("256", "cuda")
    x = torch.rand(1, 8, 256, 256, 3, device="cuda") * 2 - 1
    q = torch.zeros(1, 25, 3, device="cuda")
    with torch.inference_mode(), torch.autocast("cuda", dtype=torch.float16):
        state = m(video=x, query_points=q)[3]
        ptr = [h.rg_lru_state.data_ptr() for h in state.hidden_state] + [state.query_points.data_ptr()]
        refill(state, (SLOTS, NEW4), "cuda")
        assert ptr == [h.rg_lru_state.data_ptr() for h in state.hidden_state] + [state.query_points.data_ptr()]
        assert state.hidden_state[0].rg_lru_state[-4:].abs().sum() == 0 and state.query_points.shape[1] == 25
        assert state.query_points[0, 21, 0] == state.step


def _occluded_group(t, moved, vis, whos=None, extra=None):
    """A pinned group of 16 on a 4 x 4 layout (id 5); the free grid around; returns the Reseed answer at time t."""
    lay = np.stack(np.meshgrid(np.linspace(0.3, 0.45, 4), np.linspace(0.3, 0.45, 4)), -1).reshape(-1, 2)
    seed = np.r_[lay, [[0.05, 0.05], [0.95, 0.05], [0.05, 0.95], [0.95, 0.95]], extra if extra is not None else np.zeros((0, 2))]
    sem = np.r_[np.full(16, 5), np.zeros(4, int), np.full(0 if extra is None else len(extra), 9)]
    rs = Reseed(WHOLE, seed, 0, 0, {**P, "retire_ms": 600, "reseed_every_ms": 500}, 0, sem=sem, aspect=1.0, whos=whos)
    out = None
    for tt in (500, t):
        out = rs(tt, NOISE, np.r_[moved(lay), seed[16:]], np.r_[vis, np.ones(len(seed) - 16, bool)])
    return lay, rs, out


def test_a_lost_pinned_member_goes_back_to_its_own_place_not_into_the_survivors_hull():
    """paw-bs1o: a hand covers the left half of a painted group for longer than retire_ms (it moved meanwhile): under
    GROUP_FLOOR of its members show. The lost members next to the visible half go back to their own places in the group's layout (it keeps its extent: the hull
    picks of v4.14 put them between the survivors and shrank the group to a sliver over a long run); those whose
    neighbours are all covered wait (a re-seed there would land on the hand)."""
    move = lambda P: P + [0.06, 0.02]
    vis = np.ones(16, bool)
    left = np.isclose(np.tile(np.linspace(0.3, 0.45, 4), 4), 0.3) | np.isclose(np.tile(np.linspace(0.3, 0.45, 4), 4), 0.35)
    vis[left] = False   # the two left columns covered
    lay, rs, (slots, new) = _occluded_group(1200, move, vis)
    near = np.isclose(lay[:, 0], 0.35)   # the covered column next to the visible ones
    got = {int(s): q for s, q in zip(slots, new) if s < 16}
    assert set(got) == set(np.flatnonzero(near).tolist())
    for s, q in got.items():
        assert np.abs(q - move(lay[s])).max() < 1e-6 and np.allclose(rs.ref[s], lay[s])


def test_a_re_seed_never_lands_on_the_other_characters_group():
    """paw-bs1o: the shaft's covered members' places lie inside the partner's visible group (it went in): they wait."""
    move = lambda P: P
    vis = np.ones(16, bool)
    col = np.tile(np.linspace(0.3, 0.45, 4), 4)
    vis[np.isclose(col, 0.45) | np.isclose(col, 0.4)] = False      # the two tip columns hidden: under the floor
    partner = np.stack(np.meshgrid(np.linspace(0.38, 0.6, 4), np.linspace(0.25, 0.5, 4)), -1).reshape(-1, 2)
    _, _, (slots, _) = _occluded_group(1200, move, vis, whos={5: "c2", 9: "c1"}, extra=partner)
    assert not any(s < 16 for s in slots)
    _, _, (slots, _) = _occluded_group(1200, move, vis, whos={5: "c2", 9: "c2"}, extra=partner)   # same character: allowed
    assert sum(s < 16 for s in slots) == 4   # the column next to the visible ones
