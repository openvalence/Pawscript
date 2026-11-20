"""paw-s63m: the painted shape reaches almost to the part's edge; the safety inset is applied where seed points go (v4.33
`seed_inset`). inset_mask's mapping (proportional, floored / ceilinged in frame units, relaxed before a part is eroded away),
the points box_seeds places (inside the eroded mask, the parent / child rule intact, the stored shape untouched), the seeder's
targets (the label masks as stored: seed_inset never reaches them), and the margin mapping the SAM cleaner shares with the app."""
import cv2
import numpy as np

from pawtrack import cli, partlabel, seeder, seedsam
from pawtrack import points as C

WHOLE = {"kind": "box", "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0}
W, H = 512, 288   # the motion pass's grey (FLOW_W wide)


def disc(r, cx=256, cy=144, w=W, h=H):
    m = np.zeros((h, w), np.uint8)
    cv2.circle(m, (cx, cy), r, 1, -1)
    return m > 0


def depth(m):
    return cv2.distanceTransform(np.pad(m, 1).astype(np.uint8), cv2.DIST_L2, cv2.DIST_MASK_PRECISE)[1:-1, 1:-1]


def grey(seed):
    return np.random.default_rng(seed).integers(0, 255, (H, W)).astype(np.uint8)


def at(a):
    return np.clip((a * [W, H]).astype(int), 0, [W - 1, H - 1])


def test_inset_is_a_share_of_the_part_within_frame_relative_floor_and_ceiling():
    floor, ceil = C.INSET_FLOOR * W, C.INSET_CEIL * W   # 1.28 .. 2.56 px at this width = about 5 .. 10 px at 1080p
    big = C.inset_mask(disc(80), C.SEED_INSET, 4)[1]
    assert big["px"] == round(ceil, 2) and not big["relaxed"], "a big part sits on the ceiling"
    mid = C.inset_mask(disc(14), C.SEED_INSET, 4)[1]
    assert round(floor, 2) <= mid["px"] <= round(ceil, 2) and not mid["relaxed"]
    bar = lambda t: np.pad(np.ones((t, 400), bool), ((144 - t // 2, H - 144 - t + t // 2), (56, 56)))
    thin, wide = C.inset_mask(bar(30), 2, 4)[1], C.inset_mask(bar(120), 2, 4)[1]
    assert thin["want"] == round(floor, 2) and wide["want"] > thin["want"], "the narrower dimension drives it (a bar 120 px wide vs 30), not its length"
    assert C.inset_mask(disc(30), 0, 4)[0].sum() == disc(30).sum(), "0 = the painted shape whole"


def test_points_lie_inside_the_eroded_mask_never_on_the_outline():
    m = disc(60)
    e, info = C.inset_mask(m, C.SEED_INSET, 32)
    d = depth(m)
    assert not info["relaxed"] and e.sum() < m.sum() and d[e].min() >= info["px"], "every kept pixel is at least the inset inside the edge"
    g = grey(0)
    for gp in (16, 40):
        s, sem, _ = C.box_seeds(WHOLE, {"box_points": 40, "box_seed": "grid", "group_points": gp}, g, None, {"hips": m}, ids={"hips": 5})
        p = at(s[sem == 5])
        assert len(p) == gp and (d[p[:, 1], p[:, 0]] >= info["px"] - 0.01).all(), "seed points keep the inset from the painted outline"
    s0, sem0, _ = C.box_seeds(WHOLE, {"box_points": 40, "box_seed": "grid", "group_points": 40, "seed_inset": 0}, g, None, {"hips": m}, ids={"hips": 5})
    p0 = at(s0[sem0 == 5])
    assert d[p0[:, 1], p0[:, 0]].min() < info["px"], "inset 0: points may sit nearer the edge (only the old 1 px erode)"


def test_inset_is_proportional_to_the_part():
    a, b = C.inset_mask(disc(14), 15, 4)[1], C.inset_mask(disc(70), 15, 4)[1]
    assert a["px"] <= b["px"]
    assert a["kept"] > 0.5, "a small part keeps most of its area"


def test_a_part_too_small_is_relaxed_never_eroded_to_nothing():
    tiny = disc(3)
    e, info = C.inset_mask(tiny, 40, 6)
    assert info["relaxed"] and info["px"] < info["want"], "the asked inset did not fit: it was halved"
    assert e.sum() >= C.INSET_PTS * 6 or (e == tiny).all(), "what is left still holds the points asked"
    one = np.zeros((H, W), bool)
    one[100:102, 100:102] = True
    e, info = C.inset_mask(one, 40, 4)
    assert (e == one).all() and info["relaxed"] and info["px"] == 0, "under half a pixel: the whole mask"
    assert not C.inset_mask(np.zeros((H, W), bool), 15, 4)[0].any(), "an empty mask stays empty"
    rec = {}
    s, sem, _ = C.box_seeds(WHOLE, {"box_points": 20, "box_seed": "grid", "group_points": 8, "seed_inset": 40}, grey(1), None, {"tip": disc(4)}, ids={"tip": 5}, rec=rec)
    assert (sem == 5).sum() > 0 and rec["tip"]["relaxed"], "the group is seeded, and the record says its inset was relaxed"


def test_parent_seeds_outside_its_child_with_the_inset_too():
    penis, knot = np.zeros((H, W), bool), np.zeros((H, W), bool)
    penis[80:200, 80:430] = True
    knot[110:170, 250:360] = True
    rec = {}
    s, sem, _ = C.box_seeds(WHOLE, {"box_points": 40, "box_seed": "grid", "group_points": 30}, grey(2), None, {"c1_penis": penis, "c1_knot": knot},
                            ids={"c1_penis": 4, "c1_knot": 5}, rec=rec)
    p, k = at(s[sem == 4]), at(s[sem == 5])
    assert len(p) and len(k)
    assert not knot[p[:, 1], p[:, 0]].any(), "no parent point under the child"
    assert depth(knot)[k[:, 1], k[:, 0]].min() >= rec["c1_knot"]["px"] - 0.01, "the child's points keep their inset"
    assert depth(penis)[p[:, 1], p[:, 0]].min() >= rec["c1_penis"]["px"] - 0.01, "and the parent's"


def test_the_stored_shape_is_not_changed_and_training_targets_ignore_the_inset():
    poly = [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]]
    mk = lambda: cli.parse_groups([{"name": "hips", "who": "c1", "part": "hips", "poly": poly}])
    before = mk()
    C.box_seeds(WHOLE, {"box_points": 20, "box_seed": "grid", "group_points": 10, "seed_inset": 40}, grey(3), None,
                {"c1_hips": partlabel.poly_mask(poly, W, H)}, ids={"c1_hips": 4})
    assert mk() == before and before[0]["poly"] == [list(map(float, q)) for q in poly]
    # seeder.targets reads the label masks as stored: no tracker parameter is in its path, and its positives are the mask's own coverage
    m = partlabel.poly_mask(poly, seeder.MASK_W, 180)
    Y = seeder.targets([{"part": "hips", "mask": m}], (9, 16)).reshape(9, 16, -1)[..., seeder.PI["hips"]]
    cov = cv2.resize(m.astype(np.float32), (16, 9), interpolation=cv2.INTER_AREA)
    assert ((Y == 1) == (cov >= 0.5)).all(), "targets = the mask's own coverage per patch (no erosion)"
    import inspect
    assert "seed_inset" not in inspect.getsource(seeder)


def test_seed_inset_is_declared_for_the_form():
    q = {q["key"]: q for q in C.common_params()}["seed_inset"]
    assert q["type"] == "float" and q["default"] == C.SEED_INSET and q["min"] == 0 and q["max"] == 40 and q["hint"]


def test_paint_margin_mapping_matches_the_app_and_zero_is_at_the_edge():
    d = np.zeros((90, 160), np.float32)
    cv2.circle(d, (80, 45), 30, 1, -1)
    s = seedsam.signed_distance(d)
    wd = seedsam.part_width(s)
    assert abs(wd - 4 * 30 / 3) < 3, "a disc of radius 30: width ~ 4R/3"
    assert seedsam.margin_for(s, 0) == 0
    assert abs(seedsam.margin_for(s, 15) - 0.15 * min(3, 0.15 * wd)) < 1e-6
    small = np.zeros((90, 160), np.float32)
    cv2.circle(small, (80, 45), 4, 1, -1)
    ss = seedsam.signed_distance(small)
    assert seedsam.margin_for(ss, 100) < seedsam.margin_for(s, 100) <= seedsam.MARGIN_MAX, "a small part loses less; the ceiling holds"
    assert seedsam.margin_for(s, 100) == seedsam.MARGIN_MAX
    a0, a15, a100 = (seedsam.clean_mask(d, [(80, 45)], m) >= 0.5 for m in (0, 15, 100))
    assert a0.sum() >= a15.sum() >= a100.sum() and a0.sum() > a100.sum()
