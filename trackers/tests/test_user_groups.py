"""v4.11 user groups: track.groups (cli.parse_groups -> points.wrap) and suggest_groups (partlabel.suggest),
on synthetic frames with a fake runner and a mocked tagger: no models."""
import cv2
import numpy as np
import pytest

from pawtrack import cli, partlabel
from pawtrack.trackers import NOTES
from pawtrack import points as C

WHOLE = {"kind": "box", "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0}
P = {"axis": "vertical", "axis_x0": 0.5, "axis_y0": 0.3, "axis_x1": 0.5, "axis_y1": 0.7, "gap_ms": 1000,
     "primary": "auto", "box_seed": "grid", "box_points": 64, "reseed_every_ms": 1000, "retire_ms": 2000,
     "max_points": 0, "held_input": "off", "seed_frame": "first", "sem_groups": True}
RNG = np.random.default_rng(0)
BG = cv2.GaussianBlur(RNG.integers(0, 255, (180, 320, 3), dtype=np.uint8), (3, 3), 0)
FRAMES = [(round(k * 1000 / 30), BG) for k in range(60)]
SQ = lambda x0, y0, x1, y1: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def static_run(fr, seed, reseed=None):
    for t, img in fr:
        yield t, seed.copy(), np.ones(len(seed), bool), np.ones(len(seed)), np.ones(len(seed))


def inside(q, box):
    return box[0] - 0.01 <= q[0] <= box[2] + 0.01 and box[1] - 0.01 <= q[1] <= box[3] + 0.01


def test_parse_groups_names_ids_and_errors():
    g = cli.parse_groups([{"name": "Tail", "poly": SQ(0, 0, .1, .1)}, {"name": "hips", "poly": SQ(0, 0, .2, .2)},
                          {"name": "tail", "poly": SQ(0, 0, .3, .3), "t_ms": 500},
                          {"name": "body", "poly": SQ(0, 0, 1, 1), "pinned": False}, {"name": "?!", "poly": SQ(0, 0, 2, 2)}])
    assert [(x["name"], x["id"], x["pinned"]) for x in g] == [("tail", 4, True), ("hips", 3, True), ("tail2", 5, True),
                                                             ("body", None, False), ("other", 6, True)]
    assert g[2]["t_ms"] == 500.0 and g[0]["t_ms"] is None and g[4]["poly"][2] == [1.0, 1.0]
    for bad in ([{"name": "x", "poly": [[0, 0], [1, 1]]}], "nope", [{"name": "x", "poly": SQ(0, 0, 1, 1), "t_ms": "1"}]):
        with pytest.raises(ValueError):
            cli.parse_groups(bad)


def test_user_groups_replace_the_tagger_seed_inside_and_name_the_channels(monkeypatch):
    monkeypatch.setattr(partlabel, "hydra_ready", lambda: True)
    monkeypatch.setattr(partlabel, "sem_regions", lambda *a, **k: 1 / 0)  # never asked when the owner drew groups
    tail, hips = (0.6, 0.1, 0.9, 0.4), (0.1, 0.5, 0.4, 0.9)
    groups = cli.parse_groups([{"name": "tail", "poly": SQ(*tail), "t_ms": 1000},
                               {"name": "hips", "poly": SQ(*hips), "t_ms": 1000},
                               {"name": "body", "poly": SQ(0.45, 0.45, 0.55, 0.55), "pinned": False, "t_ms": 1000}])
    NOTES.clear()
    out = list(C.wrap(static_run, WHOLE, FRAMES, P | {"groups": groups}, lambda vp, cf: 1.0, None, work_wh=(160, 120)))
    pts = out[0][2]["pts"]
    pinned = {s: [q for q in pts if len(q) == 6 and q[5] == s] for s in (3, 4)}
    assert len(pinned[3]) == 16 and len(pinned[4]) == 16  # v4.46 group_counts: at least 16 each (3 groups in 64: 3/4 of the box); the grid rounds the rest
    assert all(inside(q, hips) for q in pinned[3]) and all(inside(q, tail) for q in pinned[4])
    assert sum(inside(q, (0.45, 0.45, 0.55, 0.55)) and len(q) == 4 for q in pts) >= 6  # the body hull: free points
    ch = out[0][1]["channels"]
    assert ch["sem_tail_n"] == 16 / len(pts) and ch["sem_tail_x"] is not None and ch["sem_hips_proj"] is not None
    assert "sem_penis_x" not in ch or ch["sem_penis_x"] is None
    rec = next(n for n in NOTES if n["code"] == "primary")["data"]
    assert rec["seed"]["mode"] == "roi" and rec["seed"]["frame_ms"] == 1000 and "groups were drawn" in rec["seed"]["reason"]
    assert rec["chosen"] == "sem_hips_proj"  # a user group named hips keeps the hips rule
    gl = next(n for n in NOTES if n["code"] == "group_labels")["data"]["groups"]
    assert gl["sem_tail"]["source"] == "user" and gl["sem_tail"]["id"] == 4 and gl["sem_tail"]["points"] == 16


def test_groups_of_another_scene_leave_this_one_alone(monkeypatch):
    monkeypatch.setattr(partlabel, "hydra_ready", lambda: False)
    groups = cli.parse_groups([{"name": "tail", "poly": SQ(.6, .1, .9, .4), "t_ms": 90_000}])
    a = list(C.wrap(static_run, WHOLE, FRAMES, P | {"groups": groups}, lambda vp, cf: 1.0, None, work_wh=(160, 120)))
    b = list(C.wrap(static_run, WHOLE, FRAMES, P, lambda vp, cf: 1.0, None, work_wh=(160, 120)))
    assert [x[2]["pts"] for x in a] == [x[2]["pts"] for x in b] and not any(len(q) == 6 for q in a[0][2]["pts"])


def test_mask_poly_round_trip():
    m = np.zeros((90, 160), bool)
    cv2.circle(m.view(np.uint8), (80, 45), 30, 1, -1)
    poly = partlabel.mask_poly(m)
    assert 3 <= len(poly) <= partlabel.POLY_MAX and all(0 <= v <= 1 for q in poly for v in q)
    back = partlabel.poly_mask(poly, 160, 90)
    assert (back & m).sum() / (back | m).sum() > 0.9
    assert partlabel.mask_poly(np.zeros((9, 16), bool)) is None


def test_suggest_well_formed_polys(monkeypatch):
    """The tagger mocked: penis and tail CAMs -> one pinned polygon each around its blob, ordered, scored; no SAM."""
    pen, tail = np.zeros((9, 16), np.float32), np.zeros((9, 16), np.float32)
    pen[4:6, 3:5], tail[1:3, 11:14] = 1.0, 1.0
    seen = {}

    def heat(frames, probs=None, vocab=None, feats=None):
        seen["vocab"] = vocab
        probs.update({"penis": [0.7], "tail": [0.55]})
        return [{"penis": pen, "tail": tail}]
    monkeypatch.setattr(partlabel, "heat_maps", heat)
    monkeypatch.setattr(partlabel, "sam_ready", lambda: False)
    out = partlabel.suggest(np.zeros((90, 160, 3), np.uint8), shape="cam", who_split="position")
    assert seen["vocab"] is partlabel.SUGGEST_VOCAB and "torso" in seen["vocab"]
    by = {g["part"]: g for g in out}
    assert set(by) == {"penis", "tail"} and by["penis"]["score"] == 0.7 and by["tail"]["source"] == "tagger"
    # v4.12: far apart -> two characters, C1 the left one; name = who_part
    assert (by["penis"]["name"], by["tail"]["name"]) == ("c1_penis", "c2_tail") and "sheath" in seen["vocab"] and "slit" in seen["vocab"]
    for g, (x0, y0, x1, y1) in ((by["penis"], (3 / 16, 4 / 9, 5 / 16, 6 / 9)), (by["tail"], (11 / 16, 1 / 9, 14 / 16, 3 / 9))):
        assert len(g["poly"]) >= 3 and g["pinned"] and g["outline"] == "cam"
        assert all(x0 - 0.02 <= x <= x1 + 0.02 and y0 - 0.02 <= y <= y1 + 0.02 for x, y in g["poly"])


def test_suggest_groups_needs_the_gpu_without_one(monkeypatch, tmp_path):
    """No CUDA: a clear error, not a crash (CI); the request shape is validated first."""
    import torch
    import make_video as mv
    v = str(mv.make(tmp_path / "s.mp4"))
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    with pytest.raises(RuntimeError, match="CUDA"):
        cli.cmd_suggest_groups({"video": v, "t_ms": 500}, lambda e: None)
    with pytest.raises(ValueError, match="unknown|Unknown"):
        cli.cmd_suggest_groups({"video": v, "t_ms": 500, "params": {"nope": 1}}, lambda e: None)


def test_track_request_with_groups_old_trackers_unchanged(tmp_path):
    """Through cli.cmd_track: a non-points tracker ignores valid groups (same result as without); bad groups are an error."""
    import make_video as mv
    v = str(mv.make(tmp_path / "s.mp4"))
    box = {"kind": "box", "x": (mv.CX - 25) / mv.W, "y": (mv.CY - 25) / mv.H, "w": 50 / mv.W, "h": 50 / mv.H}
    req = {"cmd": "track", "video": v, "tracker": "lk_box", "start_ms": 0, "end_ms": 2000, "roi": box, "cuts": []}
    a = cli.cmd_track(req, lambda e: None)
    b = cli.cmd_track(req | {"groups": [{"name": "tail", "poly": SQ(.1, .1, .3, .3)}]}, lambda e: None)
    assert a["samples"] == b["samples"] and a["points"] == b["points"]
    with pytest.raises(ValueError, match="groups"):
        cli.cmd_track(req | {"groups": [{"name": "tail"}]}, lambda e: None)


# ---------------------------------------------------------------- v4.12 characters (who / part / side)

def test_parse_groups_who_part_side():
    g = cli.parse_groups([{"name": "x", "who": "c1", "part": "Penis", "poly": SQ(0, 0, .1, .1)},
                          {"who": "c2", "part": "hand", "side": "l", "poly": SQ(0, 0, .1, .1)},
                          {"who": "c2", "part": "hand", "side": "l", "poly": SQ(0, 0, .1, .1)},
                          {"who": "c2", "part": "body", "pinned": False, "poly": SQ(0, 0, 1, 1)},
                          {"name": "hips", "poly": SQ(0, 0, .2, .2)}])
    assert [(x["name"], x["id"], x["who"], x["part"], x["side"]) for x in g] == [
        ("c1_penis", 4, "c1", "penis", None), ("c2_hand_l", 5, "c2", "hand", "l"), ("c2_hand_l2", 6, "c2", "hand", "l"),
        ("c2_body", None, "c2", "body", None), ("hips", 3, None, None, None)]
    for bad in ({"who": "c3"}, {"who": "c1", "side": "x"}):
        with pytest.raises(ValueError, match="who"):
            cli.parse_groups([{"part": "tail", "poly": SQ(0, 0, .1, .1)} | bad])


def test_sem_budget_scales_evenly():
    assert C.sem_budget(1024, 3) == 102 and C.sem_budget(1024, 16) == 32 and C.sem_budget(64, 3) == 6
    assert C.sem_budget(64, 5) == 6 and C.sem_budget(64, 16) == 2 and C.sem_budget(32, 3) == 5 and C.sem_budget(8, 16) == 1
    for n in (64, 256, 1024, 4096):
        for k in range(1, 17):
            assert k * C.sem_budget(n, k) <= max(n // 2, k)


def test_who_centre_is_seed_anchored():
    from pawtrack.groups import who_cent
    T = 20
    xy = np.tile(np.array([[0.2, 0.5], [0.3, 0.5], [0.8, 0.5]]), (T, 1, 1))
    vis = np.ones((T, 3), bool)
    vis[10:, 1] = False  # a member of C1's second group drops out: the centre must not move
    c, sh = who_cent(xy, vis, np.array([4, 5, 6]), {4, 5}, np.zeros((T, 2)), 1.5)
    assert np.allclose(c[:, 0], 0.25) and np.allclose(c[:, 1], 0.5) and sh[0] == 2 / 3 and sh[-1] == 1 / 3


def moving_run(fr, seed, reseed=None):
    """Points right of x = 0.5 (C2) bob up and down 0.1 frame heights at 1 Hz; the rest stay."""
    for t, img in fr:
        q = seed.copy()
        q[q[:, 0] > 0.5, 1] += 0.05 * np.sin(2 * np.pi * t / 1000)
        yield t, q, np.ones(len(seed), bool), np.ones(len(seed)), np.ones(len(seed))


def test_characters_get_centres_and_relative_channels(monkeypatch):
    monkeypatch.setattr(partlabel, "hydra_ready", lambda: False)
    a = lambda who, part, box, **k: {"who": who, "part": part, "poly": SQ(*box), "t_ms": 1000, **k}
    groups = cli.parse_groups([a("c1", "penis", (0.1, 0.4, 0.3, 0.6)), a("c1", "hand", (0.05, 0.1, 0.2, 0.25), side="l"),
                               a("c2", "hips", (0.6, 0.3, 0.9, 0.6)), a("c2", "sheath", (0.6, 0.7, 0.8, 0.9))])
    NOTES.clear()
    out = list(C.wrap(moving_run, WHOLE, FRAMES, P | {"groups": groups}, lambda vp, cf: 1.0, None, work_wh=(160, 120)))
    chs = [o[1]["channels"] for o in out]
    for k in ("sem_c1_penis_x", "sem_c1_hand_l_proj", "sem_c2_hips_proj", "sem_c2_sheath_n", "who_c1_x", "who_c2_proj",
              "who_pair_dist", "who_pair_proj", "who_p1h2_dist", "who_p1h2_proj"):
        assert all(c.get(k) is not None for c in chs), k
    assert "who_p2h1_dist" not in chs[0]  # C2 has no penis
    c1x = [c["who_c1_x"] for c in chs]
    assert max(c1x) - min(c1x) < 1e-6  # C1 stands still
    d = np.array([c["who_pair_dist"] for c in chs])
    assert d.min() > 0 and d.max() - d.min() > 0.05  # C2 bobbing: the distance on the (vertical) axis moves
    pp = np.array([c["who_pair_proj"] for c in chs])
    assert pp.min() == 0 and pp.max() == 1
    rec = next(n for n in NOTES if n["code"] == "primary")["data"]
    assert rec["chosen"] == "sem_c2_hips_proj" and "pinned c2_hips" in rec["rule"]  # a character's hips keeps the hips rule
    assert {"who_pair_proj", "who_p1h2_proj", "who_c1_proj"} <= set(rec["candidates"])  # offered, never the default
    pts = out[0][2]["pts"]
    assert {q[5] for q in pts if len(q) == 6} == {4, 5, 6, 7}


def test_assign_who_proximity_and_bodies():
    g = lambda name, x, y: {"name": name, "poly": SQ(x - .03, y - .03, x + .03, y + .03), "pinned": True}
    out = partlabel.assign_who([g("penis", .7, .6), g("hand", .2, .3), g("hips", .25, .6), g("hand", .85, .4), g("balls", .72, .7)])
    # paw-5r1: a side is the character's own, proposed by order (a character's first of a part l), never by where it sits in the picture
    assert [x["name"] for x in out] == ["c2_penis", "c1_hand_l", "c1_hips", "c2_hand_l", "c2_balls"]
    near = partlabel.assign_who([g("penis", .5, .5), g("balls", .52, .58)])
    assert [x["who"] for x in near] == ["c1", "c1"]
    # SAM bodies: the masks decide, even where proximity would not (the hand reaches across)
    m1, m2 = np.zeros((90, 160), bool), np.zeros((90, 160), bool)
    m1[:, :100], m2[:, 100:] = True, True
    body = lambda m: {"name": "body", "poly": partlabel.mask_poly(m), "pinned": False}
    out = partlabel.assign_who([g("hand", .6, .5), g("tail", .9, .5), body(m1), body(m2)], [m1, m2], 16 / 9)
    assert [x["name"] for x in out] == ["c1_hand_l", "c2_tail", "c1_body", "c2_body"]
    # v4.19 (paw-cq4): C1 = the character whose head is further left, not the one whose parts are on average
    top, bot = np.zeros((90, 160), bool), np.zeros((90, 160), bool)
    top[:45], bot[45:] = True, True
    parts = [g("head", .8, .2), g("hand", .1, .2), g("tail", .15, .3), g("head", .3, .7), g("hips", .7, .7), g("penis", .75, .75), body(top), body(bot)]
    by_head = partlabel.assign_who(parts, [top, bot], 16 / 9)
    assert [x["who"] for x in by_head] == ["c2", "c2", "c2", "c1", "c1", "c1", "c2", "c1"]
    by_parts = partlabel.assign_who(parts, [top, bot], 16 / 9, left_by="parts")
    assert [x["who"] for x in by_parts] == ["c1", "c1", "c1", "c2", "c2", "c2", "c1", "c2"]


# ---------------------------------------------------------------- v4.13 the previous shot's groups as a clue

def test_suggest_groups_prior_refinds_identities(tmp_path, monkeypatch):
    """cli.cmd_suggest_groups with `prior` (a hard cut inside one scene): the mocked tagger's suggestions that match a
    prior part take its identity, flagged unconfirmed; a prior part not found is in `missing`. No GPU, no models."""
    import torch
    import make_video as mv
    v = str(mv.make(tmp_path / "s.mp4"))
    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    monkeypatch.setattr(partlabel, "hydra_ready", lambda: True)
    import pawtrack.vram as V
    monkeypatch.setattr(V, "cap", lambda *a: None)
    monkeypatch.setattr(cli, "_describe_module", lambda: type("M", (), {"_MODEL": object()}))
    monkeypatch.setattr(partlabel, "suggest", lambda bgr, box, shape, **kw: partlabel.assign_who(
        [{"name": "penis", "poly": SQ(.2, .4, .3, .6), "score": .9, "pinned": True}, {"name": "hips", "poly": SQ(.7, .4, .8, .6), "score": .8, "pinned": True}], (), bgr.shape[1] / bgr.shape[0]))
    r = cli.cmd_suggest_groups({"video": v, "t_ms": 500, "prior": [{"name": "c2_penis", "poly": SQ(.6, .4, .7, .6)}, {"name": "c1_hips"}, {"name": "c1_tail"}]}, lambda e: None)
    by = {g["name"]: g for g in r["groups"]}
    assert set(by) == {"c2_penis", "c1_hips"} and all(g["unconfirmed"] for g in by.values()), r["groups"]
    assert r["missing"] == ["c1_tail"]
    plain = cli.cmd_suggest_groups({"video": v, "t_ms": 500}, lambda e: None)
    assert "missing" not in plain and not any(g.get("unconfirmed") for g in plain["groups"])


def test_group_points_fixed_count_on_top_of_the_grid(monkeypatch):
    """v4.14 group_points: every group gets that many points whatever the grid; the grid keeps box_points (total = grid +
    groups x group_points); 0 = a share of the box (v4.46 group_counts)."""
    monkeypatch.setattr(partlabel, "hydra_ready", lambda: False)
    boxes = [(0.1, 0.1, 0.3, 0.3), (0.6, 0.1, 0.9, 0.4), (0.1, 0.6, 0.4, 0.9)]
    groups = cli.parse_groups([{"name": f"part{k}", "poly": SQ(*b), "t_ms": 1000} for k, b in enumerate(boxes)])
    out = list(C.wrap(static_run, WHOLE, FRAMES, P | {"groups": groups, "box_points": 16, "group_points": 16},
                      lambda vp, cf: 1.0, None, work_wh=(160, 120)))
    pts = out[0][2]["pts"]
    for gid, b in zip((4, 5, 6), boxes):
        mine = [q for q in pts if len(q) == 6 and q[5] == gid]
        assert len(mine) == 16 and all(inside(q, b) for q in mine)
    assert len(pts) == C.group_total({"box_points": 16, "group_points": 16}, 3) == 64
    assert sum(len(q) == 4 for q in pts) == 16  # the grid is the box's own 16
    old = list(C.wrap(static_run, WHOLE, FRAMES, P | {"groups": groups, "box_points": 16}, lambda vp, cf: 1.0, None,
                      work_wh=(160, 120)))[0][2]["pts"]
    assert len(old) == 16 and sum(len(q) == 6 for q in old) == 12  # v4.46: 3 groups share 3/4 of 16 (4 each; v4.12: half, 2 each)


def test_candidate_bonus_weighs_the_seed_frame_pick():
    """v4.20: candidate_bonus adds to a candidate's parts (a frame that repeats elsewhere, the owner's loop frame);
    without it the v4.18 pick (most parts, ties: the first listed)."""
    ts, parts = [500, 0, 400, 800], [3, 3, 4, 3]
    assert cli.pick_candidate(ts, parts, {}) == 2
    bonus = cli.candidate_bonus([0, 400, 800], [0.5, 0.0, 2.0])
    assert bonus == {0: 0.5, 400: 0.0, 800: 2.0}
    assert cli.pick_candidate(ts, parts, bonus) == 3          # 3 + 2 beats 4
    assert cli.pick_candidate(ts, parts, {0: 0.5, 800: 0.5}) == 2   # a small weight never beats one more part
    assert cli.candidate_bonus([0, "x", 400], [1, 2, None]) == {0: 1.0}

def test_group_points_seed_exactly_the_given_points(monkeypatch):
    """v4.21: a pinned group with `points` (paw-8mf4: a stored run's seeds on an exact repeat) is seeded on exactly those
    points on its frame, also mid-scene; its outline is not used for placement; another group keeps the v4.11 placement."""
    monkeypatch.setattr(partlabel, "hydra_ready", lambda: False)
    given = [[0.71, 0.21], [0.75, 0.3], [0.8, 0.25], [0.95, 0.9]]   # one point outside the polygon: still exactly there
    groups = cli.parse_groups([{"name": "tail", "poly": SQ(.6, .1, .9, .4), "t_ms": 1000, "points": given},
                               {"name": "hips", "poly": SQ(.1, .5, .4, .9), "t_ms": 1000}])
    assert groups[0]["points"] == given and "points" not in groups[1]
    out = list(C.wrap(static_run, WHOLE, FRAMES, P | {"groups": groups}, lambda vp, cf: 1.0, None, work_wh=(160, 120)))
    pts = out[0][2]["pts"]
    tail = sorted([round(q[0], 4), round(q[1], 4)] for q in pts if len(q) == 6 and q[5] == 4)
    assert tail == sorted(given)
    assert len([q for q in pts if len(q) == 6 and q[5] == 3]) == 16   # hips: its share (v4.46: at least 16) inside its polygon
    for bad in ([{"name": "x", "poly": SQ(0, 0, 1, 1), "points": []}], [{"name": "x", "poly": SQ(0, 0, 1, 1), "points": [[0.1]]}]):
        with pytest.raises(ValueError):
            cli.parse_groups(bad)


# ---------------------------------------------------------------- v4.30 Extra (x): Bottom c1, Top c2, Extra x (paw-uzzr)

def test_extra_who_parses_and_cannot_be_confused_with_a_part_or_side():
    g = cli.parse_groups([{"who": "x", "part": "penis", "poly": SQ(0, 0, .1, .1)},
                          {"who": "x", "part": "penis", "poly": SQ(0, 0, .1, .1)},
                          {"who": "x", "part": "paws", "side": "l", "poly": SQ(0, 0, .1, .1)},
                          {"who": "x", "part": "hips", "poly": SQ(0, 0, .1, .1)}])
    assert [(x["name"], x["who"], x["part"], x["side"]) for x in g] == [
        ("x_penis", "x", "penis", None), ("x_penis2", "x", "penis", None), ("x_paws_l", "x", "paws", "l"), ("x_hips", "x", "hips", None)]
    assert all(x["id"] is not None for x in g)
    assert partlabel.WHOS == ("c1", "c2", "x")
    for bad in ({"who": "x2"}, {"who": "X"}, {"who": ""}):
        with pytest.raises(ValueError, match="who"):
            cli.parse_groups([{"part": "tail", "poly": SQ(0, 0, .1, .1)} | bad])
    # the name -> (who, part, side) readers on the sidecar side agree with groups.js splitName
    from pawtrack import seeder
    assert seeder.split_name("x_paws_l") == ("x", "paws", "l") and seeder.split_name("x_penis2") == ("x", "penis", None)
    assert seeder.split_name("c1_hips") == ("c1", "hips", None) and seeder.split_name("xpenis") == (None, "xpenis", None)
    assert seeder.split_name("penis2") == (None, "penis", None) and seeder.split_name("tail") == (None, "tail", None)
    assert partlabel._who_part("x_penis2") == ("x", "penis") and partlabel._who_part("x_hips") == ("x", "hips")
    assert partlabel.sits_on("x_knot", "x_penis") and not partlabel.sits_on("x_knot", "c1_penis")   # the overlap table applies within Extra


def test_extra_groups_are_seeded_and_tracked_like_any_group(monkeypatch):
    monkeypatch.setattr(partlabel, "hydra_ready", lambda: False)
    a = lambda who, part, box, **k: {"who": who, "part": part, "poly": SQ(*box), "t_ms": 1000, **k}
    groups = cli.parse_groups([a("c1", "hips", (0.1, 0.4, 0.3, 0.6)), a("c2", "hips", (0.6, 0.3, 0.9, 0.6)),
                               a("x", "penis", (0.35, 0.7, 0.5, 0.9))])
    NOTES.clear()
    out = list(C.wrap(moving_run, WHOLE, FRAMES, P | {"groups": groups}, lambda vp, cf: 1.0, None, work_wh=(160, 120)))
    chs = [o[1]["channels"] for o in out]
    for k in ("sem_x_penis_x", "sem_x_penis_y", "sem_x_penis_n", "sem_x_penis_proj", "who_x_x", "who_x_proj", "who_c1_proj", "who_c2_proj",
              "who_pair_dist", "who_pair_proj"):
        assert all(c.get(k) is not None for c in chs), k   # the pair channel survives a third character
    assert not any(k.startswith("who_x_") and "pair" in k for k in chs[0]) and "who_p1h2_dist" not in chs[0]
    pts = out[0][2]["pts"]
    ids = {q[5] for q in pts if len(q) == 6}
    assert ids == {4, 5, 6}, ids   # one pinned id per group, Extra included
    xs = [q for q in pts if len(q) == 6 and q[5] == 6]
    assert xs and all(inside(q, (0.35, 0.7, 0.5, 0.9)) for q in xs), "the Extra group's points sit inside its outline"


# ---------------------------------------------------------------- v4.45 groups_only (paw-o74b: a part that comes into view later)

def test_groups_only_tracks_a_late_group_both_ways_and_stops_where_lost(monkeypatch):
    """groups_only: no layout points (every pts entry is the group's, pinned), no re-seeding; seeded on the group's own frame
    mid-scene, tracked both ways from it, and each way stops where the group's points are lost (lost_stop both sides)."""
    monkeypatch.setattr(partlabel, "hydra_ready", lambda: False)
    frames = []
    for k in range(90):   # each frame carries its index in its first pixel (the runner reads it: both passes see real frames)
        img = BG.copy()
        img[0, 0] = (k, k, k)
        frames.append((round(k * 1000 / 30), img))

    def seen_25_to_70(fr, seed, reseed=None):
        assert reseed is None   # re-seeding into voids is off
        for t, img in fr:
            k = int(img[0, 0, 0])
            yield t, seed.copy(), np.full(len(seed), 25 <= k <= 70), np.ones(len(seed)), np.ones(len(seed))

    tail = (0.6, 0.1, 0.9, 0.4)
    groups = cli.parse_groups([{"name": "tail", "who": "c2", "part": "tail", "poly": SQ(*tail), "t_ms": frames[40][0]}])
    p = P | {"groups": groups, "box_points": 64, "groups_only": True, "reseed_every_ms": 0}
    NOTES.clear()
    out = list(C.wrap(seen_25_to_70, WHOLE, frames, p, lambda vp, cf: 1.0, None, work_wh=(160, 120)))
    ts = [o[0] for o in out]
    assert ts[0] == frames[25][0] and ts[-1] == frames[70][0], (ts[0], ts[-1])   # both ways from frame 40, cut where lost
    for o in out:
        pts = o[2]["pts"]
        assert pts and all(len(q) == 6 and q[5] == 4 for q in pts)   # the group's points only: no grid
        assert all(inside(q, tail) for q in pts)
    assert out[0][1]["channels"]["sem_c2_tail_x"] is not None
    lost = next(n for n in NOTES if n["code"] == "lost")["data"]
    assert lost["t0_ms"] == frames[25][0] and lost["t1_ms"] == frames[70][0]
    # a scene without the call's group gives nothing (never the box grid)
    far = cli.parse_groups([{"name": "tail", "poly": SQ(*tail), "t_ms": 90_000}])
    assert list(C.wrap(static_run, WHOLE, FRAMES, P | {"groups": far, "groups_only": True, "reseed_every_ms": 0}, lambda vp, cf: 1.0, None, work_wh=(160, 120))) == []
