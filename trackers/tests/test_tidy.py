"""PROTOCOL v4.34 (paw-r6t0): fewer, cleaner proposals (pawtrack/tidy.py, seeder.smooth_up / proposals). Synthetic heat and masks; no models, no GPU."""
import cv2
import numpy as np

from pawtrack import partlabel, seeder, seedscore, tidy

W, H = 160, 90


def blob(x0, y0, x1, y1):
    m = np.zeros((H, W), bool)
    m[y0:y1, x0:x1] = True
    return m


def grp(part, who, side, score, m, name=None):
    return {"name": name or "_".join(x for x in (who, part, side) if x), "who": who, "part": part, "side": side, "score": score, "_mask": m, "source": "seeder", "pinned": True}


def finish(gs):
    return tidy.finish(gs, 16 / 9, 0.0, partlabel.mask_poly)


# ------------------------------------------------------------------ the smooth upsample: no stair-steps
def circle_heat(ph=12, pw=21, cx=10.0, cy=6.0, r=3.2):
    yy, xx = np.mgrid[0:ph, 0:pw]
    return (np.hypot(xx - cx, yy - cy) <= r).astype(np.float32) * 0.9


def perimeter_ratio(mask):
    cs, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cs, key=cv2.contourArea)
    return cv2.arcLength(c, True) / (2 * np.sqrt(np.pi * cv2.contourArea(c)))   # 1.0 for a circle, 4/pi = 1.27 for a staircase circle


def max_turn(mask, step=8):
    cs, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cs, key=cv2.contourArea)[:, 0].astype(float)
    p = c[::step]
    a, b = p - np.roll(p, 1, 0), np.roll(p, -1, 0) - p
    ang = np.arctan2(a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0], (a * b).sum(1))
    return float(np.abs(np.degrees(ang)).max())


def test_smooth_upsample_has_no_stair_steps():
    heat = circle_heat()
    size = (320, 180)
    nearest = cv2.resize(heat, size, interpolation=cv2.INTER_NEAREST) >= 0.5
    smooth = seeder.smooth_up(heat, size) >= 0.5
    assert perimeter_ratio(nearest) > 1.2, "the staircase this replaces"
    assert perimeter_ratio(smooth) < 1.08
    assert max_turn(smooth) < 45 < max_turn(nearest), "the boundary's turning angle per 8 px is bounded"


def test_regions_then_cleaning_give_one_smooth_blob_without_specks():
    heat = np.zeros((12, 21, len(seeder.PARTS)), np.float32)
    heat[..., seeder.PI["hips"]] = circle_heat()
    heat[0, 0, seeder.PI["hips"]] = 0.9   # a one-cell speck far away
    use = np.ones(len(seeder.PARTS), bool)
    out = seeder.proposals(heat, (320, 180), use)
    assert [o["part"] for o in out] == ["hips"] and perimeter_ratio(out[0]["mask"]) < 1.1


# ------------------------------------------------------------------ slivers and overlap
def test_a_sliver_is_dropped():
    big, tiny = blob(20, 20, 60, 60), blob(100, 40, 103, 43)
    regs = [{"part": "hips", "mask": big, "score": 0.9, "peak": (.25, .45)}, {"part": "head", "mask": tiny, "score": 0.9, "peak": (.64, .47)}]
    assert [o["part"] for o in tidy.tidy_regions(regs)] == ["hips"]


def test_unrelated_parts_do_not_overlap_parent_child_may():
    a = {"part": "hips", "mask": blob(20, 20, 80, 70), "score": 0.9}
    b = {"part": "torso", "mask": blob(60, 20, 120, 70), "score": 0.8}
    out = {o["part"]: o["mask"] for o in tidy.drop_overlap([a, b])}
    assert set(out) == {"hips", "torso"} and not (out["hips"] & out["torso"]).any()
    knot = {"part": "knot", "mask": blob(60, 30, 100, 50), "score": 0.8}
    penis = {"part": "penis", "mask": blob(20, 30, 120, 50), "score": 0.9}
    out = {o["part"]: o["mask"] for o in tidy.drop_overlap([knot, penis])}
    assert (out["knot"] & out["penis"]).sum() == knot["mask"].sum()
    mostly = {"part": "torso", "mask": blob(22, 22, 78, 68), "score": 0.5}   # almost entirely inside the better hips: dropped
    assert [o["part"] for o in tidy.drop_overlap([a, mostly])] == ["hips"]


# ------------------------------------------------------------------ one per thing
def test_one_group_per_unpaired_part_and_character_best_wins_far_ones_dropped():
    gs = [grp("hips", "c1", None, 0.95, blob(10, 50, 40, 80)), grp("hips", "c1", None, 0.75, blob(110, 10, 140, 40)),
          grp("hips", "c2", None, 0.85, blob(100, 50, 130, 80))]
    out = finish(gs)
    assert sorted((g["who"], g["score"]) for g in out) == [("c1", 0.95), ("c2", 0.85)]


def test_touching_blobs_of_one_part_merge_into_the_best():
    gs = [grp("torso", "c1", None, 0.99, blob(10, 10, 50, 50)), grp("torso", "c1", None, 0.74, blob(52, 12, 80, 48))]
    out = finish(gs)
    assert len(out) == 1 and out[0]["score"] == 0.99
    xs = np.array(out[0]["poly"])[:, 0]
    assert xs.max() > 70 / W, "the second blob is part of it"


def test_three_scattered_hands_give_one_per_side():
    gs = [grp("hand", "c1", "l", 0.9, blob(10, 10, 25, 25)), grp("hand", "c1", "l", 0.8, blob(100, 60, 115, 75)), grp("hand", "c1", "l", 0.75, blob(130, 10, 145, 25))]
    assert len(finish(gs)) == 1


def test_two_halves_either_side_of_an_occluder_are_both_kept_as_part_and_repeat():
    left, right = grp("hand", "c1", "r", 0.9, blob(20, 30, 50, 55)), grp("hand", "c1", "r", 0.85, blob(80, 30, 110, 55))
    shaft = grp("penis", "c1", None, 0.95, blob(48, 38, 82, 46))   # lies across the gap between them
    out = finish([left, right, shaft])
    hands = [g for g in out if g["part"] == "hand"]
    assert len(hands) == 2 and {g["name"] for g in hands} == {"c1_hand_r"} and sum(1 for g in hands if g.get("half")) == 1
    assert {g["side"] for g in hands} == {"r"} and {g["who"] for g in hands} == {"c1"}


def test_halves_with_nothing_between_them_merge_or_the_lower_is_dropped():
    touching = finish([grp("hand", "c1", "r", 0.9, blob(20, 30, 50, 55)), grp("hand", "c1", "r", 0.85, blob(52, 30, 80, 55))])
    assert len(touching) == 1
    apart = finish([grp("hand", "c1", "r", 0.9, blob(20, 30, 50, 55)), grp("hand", "c1", "r", 0.85, blob(80, 30, 110, 55))])
    assert len(apart) == 1 and apart[0]["score"] == 0.9
    weak = finish([grp("hand", "c1", "r", 0.9, blob(20, 30, 50, 55)), grp("hand", "c1", "r", 0.5, blob(80, 30, 110, 55)), grp("penis", "c1", None, 0.9, blob(48, 38, 82, 46))])
    assert len([g for g in weak if g["part"] == "hand"]) == 1, "a weak second blob is not a half even with an occluder"


# ------------------------------------------------------------------ isolation and the cap
def test_an_isolated_part_is_penalised_and_the_total_is_capped():
    near = [grp(p, "c1", None, 0.9, blob(10 + 12 * i, 10, 20 + 12 * i, 20)) for i, p in enumerate(["hips", "balls", "penis", "tail"])]
    far = grp("head", "c1", None, 0.9, blob(150, 80, 158, 88))
    out = {g["part"]: g for g in finish(near + [far])}
    assert out["head"]["score"] < 0.9 and out["head"].get("isolated") and out["hips"]["score"] == 0.9
    parts = [p for p in seeder.PARTS if p not in partlabel.PAIRED]
    many = [grp(p, "c1" if i % 2 else "c2", None, 0.5 + i / 100, blob(4 + (i % 7) * 20, 4 + (i // 7) * 28, 16 + (i % 7) * 20, 20 + (i // 7) * 28)) for i, p in enumerate(parts * 2 if len(parts) * 2 <= 22 else parts)]
    assert len(finish(many)) <= tidy.MAX_TOTAL


# ------------------------------------------------------------------ the scorer carries proposals per image and duplicates
def test_scorer_reports_proposals_and_duplicates():
    g = {"part": "hips", "mask": blob(20, 20, 60, 60)}
    fr = [{"id": "a", "src": "a", "W": W, "H": H, "groups": [g]}]
    preds = {"a": [{"part": "hips", "mask": blob(20, 20, 60, 60), "c": (.25, .45)}, {"part": "hips", "mask": blob(100, 20, 140, 60), "c": (.75, .45)}]}
    rows, frs = seedscore.evaluate(preds, fr)
    a = seedscore._agg(rows, frs)
    assert a["proposals"] == 2 and a["dup_share"] == 0.5 and rows[0]["found"]
