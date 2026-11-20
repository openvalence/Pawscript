"""paw-noy2: a part that lives on another (a knot on the penis) overlaps it. The parent -> child table, the seed points (an overlap
belongs to the child only; the parent seeds in the rest of its area), the stored shapes (both in full), the seeder's targets
(multi-label: a patch under both carries both labels)."""
import numpy as np

from pawtrack import cli, partlabel, seeder
from pawtrack import points as C

SQ = lambda x0, y0, x1, y1: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
WHOLE = {"kind": "box", "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0}


def test_table_and_names():
    assert partlabel.sits_on("c1_knot", "c1_penis") and partlabel.sits_on("c1_knot", "c1_penis2")
    assert not partlabel.sits_on("c1_knot", "c2_penis"), "another character's penis is not the one it lives on"
    assert not partlabel.sits_on("c1_penis", "c1_knot"), "the table is child -> parent (the app also lets the pair overlap both ways)"
    assert partlabel.sits_on("c1_sheath", "c1_hips") and partlabel.sits_on("c2_paws_l", "c2_thighs_r") and partlabel.sits_on("knot", "penis")
    assert not partlabel.sits_on("c1_hips", "c2_hips") and not partlabel.sits_on("c1_penis", "c1_paws_l")


def test_both_shapes_are_stored_in_full():
    groups = cli.parse_groups([{"name": "penis", "who": "c1", "part": "penis", "poly": SQ(0.2, 0.3, 0.8, 0.5)},
                               {"name": "knot", "who": "c1", "part": "knot", "poly": SQ(0.5, 0.32, 0.7, 0.48)}])
    assert [g["name"] for g in groups] == ["c1_penis", "c1_knot"]
    assert groups[0]["poly"] == [list(map(float, q)) for q in SQ(0.2, 0.3, 0.8, 0.5)], "the parent's outline is not cut by the child"


def seeds(names, polys, n=100, gp=24):
    g = np.full((90, 160), 128, np.uint8)
    rng = np.random.default_rng(3)
    g[:] = rng.integers(0, 255, g.shape)   # textured everywhere
    regions = {nm: partlabel.poly_mask(p, 160, 90) for nm, p in zip(names, polys)}
    ids = {nm: 4 + k for k, nm in enumerate(names)}
    s, sem, _ = C.box_seeds(WHOLE, {"box_points": n, "box_seed": "grid", "group_points": gp}, g, None, regions, ids=ids)
    return s, sem, ids


def test_overlap_points_belong_to_the_child_only():
    penis, knot = SQ(0.2, 0.3, 0.8, 0.6), SQ(0.45, 0.35, 0.65, 0.55)
    s, sem, ids = seeds(["c1_penis", "c1_knot"], [penis, knot])
    inside = lambda pts, q: (pts[:, 0] >= q[0][0]) & (pts[:, 0] <= q[1][0]) & (pts[:, 1] >= q[0][1]) & (pts[:, 1] <= q[2][1])
    p, k = s[sem == ids["c1_penis"]], s[sem == ids["c1_knot"]]
    assert len(p) >= 20 and len(k) >= 20
    assert inside(k, knot).all(), "the knot's points are on the knot"
    assert not inside(p, knot).any(), "no penis point under the knot: it seeds in the rest of its area"
    assert inside(p, penis).all()
    assert len({tuple(np.round(q, 4)) for q in np.r_[p, k]}) == len(p) + len(k), "no point is counted twice"


def test_unrelated_groups_keep_their_own_areas_and_an_all_covered_parent_still_seeds():
    a, b = SQ(0.2, 0.3, 0.8, 0.6), SQ(0.45, 0.35, 0.65, 0.55)
    s, sem, ids = seeds(["c1_hips", "c2_hips"], [a, b])   # not parent / child: nothing is carved out of c1_hips
    p = s[sem == ids["c1_hips"]]
    assert ((p[:, 0] >= 0.45) & (p[:, 0] <= 0.65) & (p[:, 1] >= 0.35) & (p[:, 1] <= 0.55)).any(), "c1_hips seeds under c2_hips too"
    s, sem, ids = seeds(["c1_penis", "c1_knot"], [SQ(0.45, 0.35, 0.65, 0.55), SQ(0.4, 0.3, 0.7, 0.6)])   # the knot covers the whole penis
    assert (sem == ids["c1_penis"]).sum() >= 20, "nothing left of the parent: it seeds under the child as before"


def test_seeder_targets_are_multi_label():
    grid = (9, 16)
    m = lambda x0, y0, x1, y1: np.pad(np.ones((y1 - y0, x1 - x0), np.float32), ((y0, 90 - y1), (x0, 160 - x1)))
    Y = seeder.targets([{"part": "penis", "mask": m(20, 30, 140, 60)}, {"part": "knot", "mask": m(60, 30, 100, 60)}], grid).reshape(9, 16, -1)
    pi, ki = seeder.PI["penis"], seeder.PI["knot"]
    assert Y[4, 6, pi] == 1 and Y[4, 6, ki] == 1, "a patch under both parts is positive for both (one label column per part)"
    assert Y[4, 2, pi] == 1 and Y[4, 2, ki] == 0, "beside the knot only the penis"
