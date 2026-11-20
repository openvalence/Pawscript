"""v4.14 parts-first tracking: group points placed on corners inside the mask (points.pick_corners), the
rigid fit per group (groups.rigid_fit) and its re-seeding; synthetic data, no models."""
import cv2
import numpy as np

from pawtrack import points as C

RNG = np.random.default_rng(5)


def textured(h=180, w=320):
    """A flat grey frame with a blob of random texture (x 80..200, y 40..140) and a flat hole in it (x 150..200)."""
    g = np.full((h, w), 128, np.uint8)
    g[40:140, 80:200] = cv2.GaussianBlur(RNG.integers(0, 255, (100, 120), dtype=np.uint8), (3, 3), 0)
    g[40:140, 150:200] = 128
    return g


def test_corners_inside_the_mask_away_from_its_edge_on_texture():
    g = textured()
    m = np.zeros(g.shape, bool)
    m[40:140, 80:200] = True  # the outline = the blob's silhouette
    a = C.pick_corners(m, g, 16)
    assert a.shape == (16, 2) and np.array_equal(a, C.pick_corners(m, g, 16))  # deterministic
    px = a * [320, 180] - 0.5
    d = cv2.distanceTransform(np.pad(m, 1).astype(np.uint8), cv2.DIST_L2, cv2.DIST_MASK_PRECISE)[1:-1, 1:-1]
    inset = d[px[:, 1].round().astype(int), px[:, 0].round().astype(int)]
    assert inset.min() >= 0.2 * np.sqrt(m.sum() / np.pi) - 1  # well inside the outline
    assert (px[:, 0] < 150).all()  # on the textured part, never the flat hole
    nn = np.sort(np.linalg.norm(px[:, None] - px[None], axis=2), 1)[:, 1]
    assert nn.min() > 5  # spread out
    # the old placement puts points on the outline's first pixel ring and on the flat hole
    old = C.pick_in(m, C.texture(g) >= C.RESEED_TEX, 16, np.random.default_rng(0)) * [320, 180] - 0.5
    assert d[old[:, 1].round().astype(int), old[:, 0].round().astype(int)].min() < inset.min()


def test_corners_tiny_and_flat_regions_still_fill_the_count():
    g = textured()
    tiny = np.zeros(g.shape, bool)
    tiny[60:63, 100:103] = True
    assert len(C.pick_corners(tiny, g, 16)) == 9  # fewer pixels than k: every pixel
    flat = np.zeros(g.shape, bool)
    flat[150:175, 10:60] = True
    a = C.pick_corners(flat, g, 12)
    assert len(a) == 12 and len({tuple(q) for q in a.round(5)}) == 12
    assert C.pick_corners(np.zeros(g.shape, bool), g, 5).shape == (0, 2)


def test_box_seeds_group_seed_corners_uses_the_fine_grey():
    g = textured()
    small = cv2.resize(g, (160, 90), interpolation=cv2.INTER_AREA)
    m = np.zeros((90, 160), bool)
    m[20:70, 40:100] = True
    whole = {"kind": "box", "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0}
    p = {"box_points": 16, "box_seed": "grid", "group_points": 12, "group_seed": "corners"}
    s, sem, _ = C.box_seeds(whole, p, small, None, {"hips": m}, fine=g)
    h = s[sem == 3]
    assert len(s) == 28 and len(h) == 12
    assert (h[:, 0] > 0.25).all() and (h[:, 0] < 150 / 320).all() and (h[:, 1] > 40 / 180).all() and (h[:, 1] < 140 / 180).all()


WHOLE = {"kind": "box", "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0}
P = {"axis": "vertical", "axis_x0": 0.5, "axis_y0": 0.3, "axis_x1": 0.5, "axis_y1": 0.7, "gap_ms": 1000,
     "primary": "auto", "box_seed": "grid", "box_points": 16, "reseed_every_ms": 1000, "retire_ms": 2000,
     "max_points": 0, "held_input": "off", "seed_frame": "first", "sem_groups": True, "group_labels": False}
SQ = lambda x0, y0, x1, y1: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def static_run(fr, seed, reseed=None):
    for t, img in fr:
        yield t, seed.copy(), np.ones(len(seed), bool), np.ones(len(seed)), np.ones(len(seed))


def test_wrap_group_seed_corners(monkeypatch):
    from pawtrack import cli, partlabel
    monkeypatch.setattr(partlabel, "hydra_ready", lambda: False)
    frames = [(round(k * 1000 / 30), cv2.cvtColor(textured(), cv2.COLOR_GRAY2BGR)) for k in range(30)]
    groups = cli.parse_groups([{"name": "hips", "poly": SQ(0.25, 0.22, 0.625, 0.78), "t_ms": 0}])
    out = list(C.wrap(static_run, WHOLE, frames, P | {"groups": groups, "group_points": 16, "group_seed": "corners"},
                      lambda vp, cf: 1.0, None, work_wh=(160, 120)))
    h = np.array([q[:2] for q in out[0][2]["pts"] if len(q) == 6])
    assert len(h) == 16 and (h[:, 0] < 150 / 320).all()  # the flat hole (x > 150 px) gets none


# ---------------------------------------------------------------- step 3: rigid fit per group

def moving_group(T=120, m=16, outliers=0, seed=1):
    """m members of a part (aspect-scaled coords) that translates, turns and breathes (known similarity per frame);
    the first `outliers` members slide off onto the static background from frame 20 (a point lost at the silhouette)."""
    rng = np.random.default_rng(seed)
    R = rng.uniform([0.5, 0.3], [0.8, 0.6], (m, 2))
    c0 = R.mean(0)
    t = np.arange(T)
    th, sc = 0.25 * np.sin(2 * np.pi * t / 40), 1 + 0.15 * np.sin(2 * np.pi * t / 30)
    tr = np.c_[0.08 * np.sin(2 * np.pi * t / 25), 0.05 * np.cos(2 * np.pi * t / 25)]
    rot = np.stack([np.c_[np.cos(th), -np.sin(th)], np.c_[np.sin(th), np.cos(th)]], 1)  # (T, 2, 2)
    q = np.einsum("tij,mj->tmi", rot * sc[:, None, None], R - c0) + c0 + tr[:, None]
    q += rng.normal(0, 0.0005, q.shape)
    if outliers:
        q[20:, :outliers] = q[20, :outliers]  # stuck on the background from frame 20
    true_c = c0 + tr
    return q, np.ones((T, m), bool), true_c, th, sc


def test_rigid_fit_recovers_the_transform():
    from pawtrack.groups import rigid_fit
    q, vis, c, th, sc = moving_group()
    cent, size, rot, fit = rigid_fit(q, vis)
    t0 = 0  # every frame shows all members: the first is the reference
    assert np.abs(cent - c).max() < 0.002
    assert np.abs(size - sc / sc[t0]).max() < 0.01 and np.abs(rot - (th - th[t0])).max() < 0.01
    assert fit.min() > 0.8


def test_rigid_fit_beats_the_anchored_centroid_under_outliers_and_occlusion():
    from pawtrack.groups import centroid, rigid_fit
    q, vis, c, *_ = moving_group(outliers=5)  # 5 of 16 slide off onto the background
    cent, _, _, fit = rigid_fit(q, vis)
    anch = centroid(q, vis, np.arange(q.shape[1]))
    e_fit, e_anch = np.abs(cent - c).max(), np.abs(anch - c - (anch[0] - c[0])).max()
    assert e_fit < 0.003 and e_anch > 5 * e_fit, (e_fit, e_anch)
    assert np.nanmedian(fit[40:]) < 0.75 and np.nanmedian(fit[:20]) > 0.9  # the outliers show in the fit quality
    # one-sided occlusion while the part turns and breathes: the visible half's mean is not the centre
    q, vis, c, *_ = moving_group()
    vis[30:70, np.argsort(q[0, :, 0])[:8]] = False
    cent, *_ = rigid_fit(q, vis)
    anch = centroid(q, vis, np.arange(q.shape[1]))
    assert np.abs(cent - c).max() < 0.003 and np.abs(anch - c - (anch[0] - c[0])).max() > 0.01


def test_rigid_fit_dropout_and_late_members():
    from pawtrack.groups import rigid_fit
    q, vis, c, *_ = moving_group()
    vis[:, 12:] = False
    vis[60:, 12:] = True  # four members first seen on frame 60 (re-seeds): they learn their reference there
    vis[80:100, :6] = False  # and six originals drop out for a while
    cent, *_ = rigid_fit(q, vis)
    assert np.abs(cent - c).max() < 0.003
    q2, vis2 = q.copy(), vis.copy()
    q2[90:, :12] += 0.2  # every original member jumps (a bad re-track): the late members alone would keep the centre
    vis2[85:, :12] = False
    cent2, *_ = rigid_fit(q2, vis2)
    assert np.abs(cent2[85:] - c[85:]).max() < 0.004


def test_group_tracks_group_fit_channels_and_dropout():
    """The anchored-centre property holds with group_fit: a hidden stretch of members does not move the centre."""
    from pawtrack.groups import group_tracks
    from test_anchored_centres import scene
    xy, vis, fps, pinned, ma, mh = scene(True)
    full = group_tracks(*scene(False)[:3], aspect=16 / 9, pinned=scene(False)[3], group_fit=True)
    r = group_tracks(xy, vis, fps, aspect=16 / 9, pinned=pinned, group_fit=True)
    c, c0 = r["sem_cent"][:, 2], full["sem_cent"][:, 2]
    assert np.isfinite(c).all() and np.abs(c - c0).max() < 1e-6
    img = c + r["cam"]
    assert np.abs(np.diff(img, axis=0) - np.diff(mh, axis=0)).max() < 1e-6
    assert np.allclose(r["sem_size"][:, 2], 1) and np.allclose(r["sem_rot"][:, 2], 0, atol=1e-9) and (r["sem_fit"][:, 2] == 1).all()
    assert "sem_size" not in group_tracks(xy, vis, fps, aspect=16 / 9, pinned=pinned)  # off: v4.13 output


def test_reseed_puts_a_lost_pinned_point_where_the_fit_says():
    """group_fit: a pinned member hidden longer than retire_ms is re-seeded at its own place under the group's motion
    (translated + turned), not at a hull pick."""
    seed = np.array([[0.4, 0.4], [0.5, 0.4], [0.5, 0.5], [0.4, 0.5], [0.45, 0.45], [0.1, 0.9], [0.9, 0.9], [0.9, 0.1]])
    sem = np.array([3, 3, 3, 3, 3, 0, 0, 0])
    p = {"reseed_every_ms": 500, "retire_ms": 600, "max_points": 0, "group_fit": True}
    roi = {"kind": "box", "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0}
    rs = C.Reseed(roi, seed, 0, 0, p, 0, sem=sem, aspect=1.0)
    th, d = 0.3, np.array([0.1, 0.05])
    c = seed[:5].mean(0)
    M = np.array([[np.cos(th), -np.sin(th)], [np.sin(th), np.cos(th)]])
    moved = seed.copy()
    moved[:5] = (seed[:5] - c) @ M.T + c + d
    vis = np.ones(8, bool)
    vis[4] = False  # the centre member is lost
    img = np.full((90, 160, 3), 128, np.uint8)
    for t in (500, 1000):
        out = rs(t, img, moved, vis)
    slots, new = out
    assert 4 in slots.tolist()
    assert np.abs(new[slots.tolist().index(4)] - moved[4]).max() < 1e-6  # exactly where it belongs now
    assert np.allclose(rs.ref[4], seed[4])  # the slot keeps its reference


def test_wrap_group_fit_through_a_reseed(monkeypatch):
    """wrap with a painted group and group_fit: the group bobs; one member hides for 3 s (retired, re-seeded where the
    fit puts it, a new output column); sem_hips_x follows the bob with no step, _size / _rot / _fit come out."""
    from pawtrack import cli, partlabel
    monkeypatch.setattr(partlabel, "hydra_ready", lambda: False)
    bob = lambda k: np.array([0.0, 0.04 * np.sin(2 * np.pi * k / 30)])
    born = {}

    def run(fr, seed, reseed=None):
        base, mov, last = seed.copy(), np.zeros(len(seed), bool), None
        mov[-16:] = True  # the pinned points come last (box_seeds order)
        hide = len(seed) - 8
        for k, (t, img) in enumerate(fr):
            if reseed is not None and last is not None:
                slots, new = reseed(t, img, *last)
                for s_, q in zip(slots, np.asarray(new).reshape(-1, 2)):
                    base[s_] = q - (bob(k) if mov[s_] else 0)
                    born[int(s_)] = k
            xy = base + mov[:, None] * bob(k)
            vis = np.ones(len(seed), bool)
            if 15 <= k and hide not in born:
                vis[hide] = False
            last = xy, vis
            yield t, xy, vis, vis.astype(float), np.linspace(0.2, 1, len(seed))
    frames = [(round(k * 1000 / 30), cv2.cvtColor(textured(), cv2.COLOR_GRAY2BGR)) for k in range(150)]
    groups = cli.parse_groups([{"name": "hips", "poly": SQ(0.25, 0.22, 0.45, 0.78), "t_ms": 0}])
    p = P | {"groups": groups, "group_points": 16, "group_seed": "corners", "group_fit": True}
    out = list(C.wrap(run, WHOLE, frames, p, lambda vp, cf: float(np.nanmean(cf)), None, work_wh=(160, 120)))
    o0, o = out[0][2]["pts"], out[-1][2]["pts"]
    assert list(born) == [24] and len(o) == 33 and o[32][5] == o[24][5] == 3  # slot 24 re-seeded: output column 32
    k = born[24]  # re-seeded before frame k from frame k - 1's positions (the runners' one-step lag)
    want = np.array(o0[24][:2]) + bob(k - 1) - bob(k) + bob(149)
    assert np.abs(np.array(o[32][:2]) - want).max() < 1e-3  # where the lost member was then, carried by the motion since
    ch = [o[1]["channels"] for o in out]
    y = np.array([c["sem_hips_y"] for c in ch])
    truth = np.array([bob(k)[1] for k in range(150)])
    assert np.abs((y - y[0]) - (truth - truth[0])).max() < 1e-3
    assert all(abs(c["sem_hips_size"] - 1) < 1e-3 and abs(c["sem_hips_rot"]) < 1e-3 and c["sem_hips_fit"] > 0.9 for c in ch)
