"""paw-9qim (v4.46): how many points a painted group gets (group_counts: at least GROUP_MIN, more with its size, the
groups at most GROUPS_MAX of the box, the total = box_points)."""
import cv2
import numpy as np

from pawtrack import cli, partlabel
from pawtrack import points as C

WHOLE = {"kind": "box", "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0}


def test_group_counts_minimum_size_and_cap():
    areas = {f"g{k}": a for k, a in enumerate(np.geomspace(0.002, 0.13, 17))}   # the owner's 17 parts
    c = C.group_counts(512, areas)
    assert sum(c.values()) == int(C.GROUPS_MAX * 512) == 384, "the groups take at most 3/4 of the box; the grid keeps 128"
    assert min(c.values()) >= C.GROUP_MIN, "every part at least 16 (was 15 each, the hips like a hand)"
    assert c["g16"] > c["g0"] and list(c.values()) == sorted(c.values()), "more points for a bigger part"
    few = C.group_counts(1024, {"penis": 0.01, "balls": 0.005, "hips": 0.13})
    assert sum(few.values()) == 3 * 102, "few groups: the v4.12 10 % each on average"
    assert few["hips"] > few["penis"] > few["balls"] >= C.GROUP_MIN
    tiny = C.group_counts(64, {f"g{k}": 1.0 for k in range(5)})
    assert sum(tiny.values()) == 48 and min(tiny.values()) == 9, "a box too small for 16 each: an even share"
    assert C.group_counts(512, {}) == {}


def test_wrap_seeds_painted_groups_with_the_new_counts(monkeypatch):
    monkeypatch.setattr(partlabel, "hydra_ready", lambda: False)
    pic = cv2.GaussianBlur(np.random.default_rng(1).integers(0, 255, (360, 640, 3), dtype=np.uint8), (3, 3), 0)
    sq = lambda x0, y0, s: [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s * 16 / 9], [x0, y0 + s * 16 / 9]]
    gs = [{"name": "hips", "poly": sq(0.1, 0.1, 0.3), "t_ms": 0}, {"name": "tip", "poly": sq(0.7, 0.6, 0.04), "t_ms": 0}]
    groups = cli.parse_groups(gs)
    P = {"axis": "vertical", "axis_x0": 0.5, "axis_y0": 0.3, "axis_x1": 0.5, "axis_y1": 0.7, "gap_ms": 1000, "primary": "auto",
         "box_seed": "grid", "box_points": 512, "group_points": 0, "reseed_every_ms": 0, "retire_ms": 2000, "max_points": 0,
         "held_input": "off", "seed_frame": "first", "sem_groups": True, "group_labels": False, "groups": groups}
    static = lambda fr, seed, reseed=None: ((t, seed.copy(), np.ones(len(seed), bool), np.ones(len(seed)), np.ones(len(seed))) for t, _ in fr)
    out = list(C.wrap(static, WHOLE, [(0, pic), (33, pic)], P, lambda vp, cf: 1.0, None, work_wh=(256, 256)))
    pts = out[0][2]["pts"]
    ids = {g["name"]: g["id"] for g in groups}
    mine = lambda n: np.array([q[:2] for q in pts if len(q) >= 6 and q[5] == ids[n]], float)
    hips, tip = mine("hips"), mine("tip")
    assert len(hips) > len(tip) >= C.GROUP_MIN and len(hips) + len(tip) == 2 * 51, (len(hips), len(tip))   # 10 % of 512 each, by size
    poly = lambda n: np.array(gs[[x["name"] for x in gs].index(n)]["poly"])
    for g, a in (("hips", hips), ("tip", tip)):
        lo, hi = poly(g).min(0), poly(g).max(0)
        assert ((a >= lo - 0.01) & (a <= hi + 0.01)).all(), g   # inside its painting
