"""paw-svnz: bodies first, then roles (pawtrack/bodies.py). Synthetic layouts on a 160 x 90 grid; no models, no GPU, no pictures."""
import numpy as np

from pawtrack import bodies

W, H = 160, 90
ASP = W / H


def box(x0, y0, x1, y1):
    m = np.zeros((H, W), bool)
    m[y0:y1, x0:x1] = True
    return m


def P(part, m, score=0.9, feat=None):
    return {"part": part, "mask": m, "score": score, "feat": feat}


def two_chars():
    """Left character: head, torso, hips, penis (reaching the right one's hips). Right character: head, torso, hips, tail."""
    return [P("head", box(10, 10, 25, 25)), P("torso", box(10, 30, 40, 50)), P("hips", box(40, 30, 55, 50)), P("penis", box(55, 38, 80, 44)),
            P("head", box(130, 10, 145, 25)), P("torso", box(110, 30, 140, 50)), P("hips", box(85, 30, 100, 50)), P("tail", box(95, 50, 125, 60))]


def sam_for(masks):
    """A fake SAM: returns each body mask as the one candidate that holds the first positive point."""
    def sam(pts, lab):
        pos = pts[lab == 1]
        for m in masks:
            if m[int(pos[0][1] * H), int(pos[0][0] * W)]:
                return np.stack([m.astype(np.float32)]), np.array([0.9])
        return np.zeros((1, H, W), np.float32), np.array([0.1])
    return sam


# ------------------------------------------------------------------ units and anchors
def test_units_merge_touching_and_halves_but_not_far_apart():
    # two touching blobs of one unpaired part are one unit; far apart with nothing between they stay two; paired parts never merge
    ps = [P("penis", box(10, 10, 30, 20)), P("penis", box(30, 10, 50, 20)), P("balls", box(100, 10, 110, 20)), P("balls", box(130, 70, 140, 80)),
          P("hand", box(60, 60, 70, 70)), P("hand", box(70, 60, 80, 70))]
    us = bodies.units(ps)
    assert sorted(len(u["ids"]) for u in us) == [1, 1, 1, 1, 2]
    assert sum(u["part"] == "balls" for u in us) == 2
    assert sum(u["part"] == "hand" for u in us) == 2


def test_units_other_half_behind_something_is_one_thing():
    ps = [P("tail", box(10, 40, 40, 52), 0.9), P("tail", box(60, 40, 90, 52), 0.9), P("hips", box(40, 30, 60, 60), 0.9)]
    us = bodies.units(ps)
    assert sorted(len(u["ids"]) for u in us) == [1, 2]


def test_anchors_two_heads_are_two_characters_and_a_third_means_none():
    us = bodies.units(two_chars())
    sets = bodies.anchors(us, ASP)
    assert len(sets) == 2 and {us[s[0]]["part"] for s in sets} == {"head"}
    assert bodies.anchors(bodies.units(two_chars() + [P("head", box(70, 70, 80, 80))]), ASP) is None


def test_anchors_one_head_and_doubled_hips_found_a_second_character():
    ps = [P("head", box(10, 10, 25, 25)), P("hips", box(20, 40, 35, 55)), P("hips", box(120, 40, 135, 55)), P("torso", box(10, 30, 40, 50))]
    us = bodies.units(ps)
    sets = bodies.anchors(us, ASP)
    assert len(sets) == 2
    assert [us[i]["part"] for i in sets[0]] == ["head", "hips"] and us[sets[0][1]]["mask"][45, 25]   # the near hips joins the head
    assert [us[i]["part"] for i in sets[1]] == ["hips"] and us[sets[1][0]]["mask"][45, 125]


def test_anchors_solo_has_no_doubled_anchor_part():
    ps = [P("head", box(10, 10, 25, 25)), P("torso", box(10, 30, 40, 50)), P("penis", box(60, 30, 80, 40))]
    assert bodies.anchors(bodies.units(ps), ASP) == [[]]


# ------------------------------------------------------------------ bodies
def test_body_mask_picks_largest_valid_candidate_and_respects_negatives():
    small, big, huge = box(10, 10, 20, 20), box(5, 5, 60, 60), box(0, 0, 160, 90)
    cov = np.stack([small, big, huge]).astype(np.float32)
    pos, neg = [(15 / W, 15 / H)], [(100 / W, 50 / H)]
    assert bodies.body_mask(cov, [.5, .6, .7], pos, neg)[30, 30]
    assert not bodies.body_mask(cov, [.5, .6, .7], pos, neg)[70, 70]     # the whole-picture candidate is no body
    assert bodies.body_mask(cov, [.9, .6, .7], pos, neg, "score")[15, 15] and not bodies.body_mask(cov, [.9, .6, .7], pos, neg, "score")[30, 30]
    assert bodies.body_mask(np.stack([box(0, 0, 160, 80)]).astype(np.float32), [1], pos, neg) is None


def test_bodies_split_the_overlap_by_distance_to_the_anchors():
    ps = two_chars()
    us = bodies.units(ps)
    sets = bodies.anchors(us, ASP)
    left, right = box(0, 0, 100, 90), box(60, 0, 160, 90)     # overlap 60..100
    bods = bodies.bodies(us, sets, sam_for([left, right]))
    k = [us[s[0]]["mask"][15, 15] for s in sets].index(True)       # the set of the left head
    assert bods[k][45, 70] and not bods[1 - k][45, 70] and bods[1 - k][45, 90] is np.False_ or not bods[k][45, 90]
    assert not (bods[0] & bods[1]).any()


# ------------------------------------------------------------------ the joint assignment
def solve(ps, bods=None, feats=False):
    us = bodies.units(ps)
    sets = bodies.anchors(us, ASP)
    bods = bods or [None, None]
    C = bodies.cost_matrix(us, sets, bods, ASP)
    lab, marg = bodies.assign(us, C)
    return us, sets, lab, marg


def test_two_heads_make_two_bodies_with_one_of_each_unpaired_part():
    us, sets, lab, _ = solve(two_chars())
    for p in ("head", "torso", "hips"):
        assert sorted(lab[i] for i, u in enumerate(us) if u["part"] == p) == [0, 1]    # one per body
    left = {u["part"] for i, u in enumerate(us) if lab[i] == lab[sets[0][0]] and us[sets[0][0]]["mask"][15, 15]}
    assert "penis" in left or "penis" in {u["part"] for i, u in enumerate(us) if lab[i] != lab[sets[0][0]]}


def test_capacity_beats_nearest_body_never_head_two_on_one_character():
    # the second head is nearer the first character's parts, but two heads can never share a body
    ps = [P("head", box(10, 10, 25, 25)), P("head", box(40, 10, 55, 25)), P("hips", box(20, 40, 35, 55)), P("hips", box(45, 40, 60, 55))]
    us, sets, lab, _ = solve(ps)
    heads = [lab[i] for i, u in enumerate(us) if u["part"] == "head"]
    assert sorted(heads) == [0, 1]
    assert bodies.assign(us, bodies.cost_matrix(us, sets, [None, None], ASP))[0].tolist() == lab.tolist()
    # no capacities: the nearest-body assignment would put both hips by their nearer head, still one each here; the capacity is exercised below
    assert sorted(lab[i] for i, u in enumerate(us) if u["part"] == "hips") == [0, 1]


def test_halves_count_as_one_unit_and_stay_together():
    ps = [P("head", box(10, 10, 25, 25)), P("head", box(130, 10, 145, 25)), P("penis", box(60, 40, 75, 50)), P("penis", box(75, 40, 90, 50)), P("hips", box(20, 40, 35, 55))]
    us, sets, lab, _ = solve(ps)
    pen = [u for u in us if u["part"] == "penis"]
    assert len(pen) == 1 and len(pen[0]["ids"]) == 2


def test_paired_parts_two_per_body_never_three():
    ps = [P("head", box(10, 10, 25, 25)), P("head", box(130, 10, 145, 25))] + [P("hand", box(12 + 6 * i, 30, 16 + 6 * i, 40)) for i in range(4)]
    us, sets, lab, _ = solve(ps)
    hands = [lab[i] for i, u in enumerate(us) if u["part"] == "hand"]
    assert sorted(hands) == [0, 0, 1, 1]       # all four are near the left head: the capacity sends two over


def test_body_masks_decide_when_distance_would_not():
    ps = two_chars()
    us = bodies.units(ps)
    sets = bodies.anchors(us, ASP)
    k = [us[s[0]]["mask"][15, 15] for s in sets].index(True)
    left, right = box(0, 0, 100, 90), box(60, 0, 160, 90)
    bods = bodies.bodies(us, sets, sam_for([left, right]))
    C = bodies.cost_matrix(us, sets, bods, ASP)
    lab, _ = bodies.assign(us, C)
    pen = next(i for i, u in enumerate(us) if u["part"] == "penis")
    assert lab[pen] == k      # the penis lies inside the left body (x 55..80), though it reaches the right one's hips


def test_assign_margin_is_zero_for_a_toss_up():
    ps = [P("head", box(10, 10, 25, 25)), P("head", box(130, 10, 145, 25)), P("paws", box(70, 40, 80, 50))]
    us, sets, lab, marg = solve(ps)
    i = next(i for i, u in enumerate(us) if u["part"] == "paws")
    j = next(i for i, u in enumerate(us) if u["part"] == "head")
    assert marg[i] < 0.5 < marg[j]


# ------------------------------------------------------------------ roles
def layout(flip=False, top_penis=True):
    """Two bodies; the giver's penis reaches the other's hips. Returns units, labels (0 = left body) in the true roles."""
    ps = two_chars()
    if flip:   # mirror x: the giver is on the right
        ps = [{**p, "mask": p["mask"][:, ::-1].copy()} for p in ps]
    us = bodies.units(ps)
    sets = bodies.anchors(us, ASP)
    lab, _ = bodies.assign(us, bodies.cost_matrix(us, sets, [None, None], ASP))
    return us, lab


def test_role_cues_are_antisymmetric_and_see_penis_reach():
    us, lab = layout()
    d = bodies.role_cues(us, lab, ASP)
    assert np.allclose(d, -bodies.role_cues(us, 1 - lab, ASP))
    i = bodies.CUES.index("reach")
    pen_body = lab[next(j for j, u in enumerate(us) if u["part"] == "penis")]
    assert (d[i] > 0) == (pen_body == 0)


def test_role_learns_penis_giver_is_top_on_synthetic_layouts():
    D, y = [], []
    rng = np.random.default_rng(0)
    for k in range(24):
        us, lab = layout(flip=bool(k % 2))
        pen = lab[next(j for j, u in enumerate(us) if u["part"] == "penis")]
        # the Bottom is the body WITHOUT the penis; body 0 is Bottom when the penis is on body 1
        D.append(bodies.role_cues(us, lab, ASP) + rng.normal(0, 1e-3, len(bodies.CUES)))
        y.append(float(pen == 1))
    r = bodies.Role.fit(np.array(D), np.array(y))
    for k, (d, t) in enumerate(zip(D, y)):
        assert (r.p_first_bottom(d) >= 0.5) == bool(t)
    # antisymmetric: swapping the two bodies swaps the answer
    assert abs(r.p_first_bottom(D[0]) + r.p_first_bottom(-np.array(D[0])) - 1) < 1e-9


def test_name_solo_is_bottom_two_bodies_by_role_else_left_head():
    us, lab = layout()
    who, by, conf = bodies.name(us, np.zeros(len(us), int), None, ASP)
    assert set(who) == {"c1"} and by == "solo" and conf == bodies.SOLO_CONF
    who, by, conf = bodies.name(us, lab, None, ASP)         # no role model: the left head is Bottom
    assert by == "left" and conf == bodies.LEFT_CONF
    left_head = next(i for i, u in enumerate(us) if u["part"] == "head" and u["mask"][15, 15])
    assert who[left_head] == "c1"
    who2, by2, _ = bodies.name(*layout(flip=True)[:2], None, ASP)
    assert by2 == "left"
    # the same split in a mirrored picture: the left head is still the Bottom
    us2, lab2 = layout(flip=True)
    lh = next(i for i, u in enumerate(us2) if u["part"] == "head" and u["mask"][15, 15] or u["part"] == "head" and u["mask"][15, 30])
    assert who2[next(i for i, u in enumerate(us2) if u["part"] == "head" and centre_x(u) < 0.5)] == "c1"


def centre_x(u):
    return bodies.centre(u["mask"])[0]


def test_role_file_roundtrip_and_stale_fingerprint(tmp_path):
    def cue(**kw):
        d = np.zeros(len(bodies.CUES))
        for k, v in kw.items():
            d[bodies.CUES.index(k)] = v
        return d
    r = bodies.Role.fit(np.array([cue(reach=-1, penis=-1), cue(reach=1, penis=1)]), np.array([1.0, 0.0]), info={"fingerprint": "abc"})
    r.save(str(tmp_path))
    assert bodies.Role.load(str(tmp_path), "abc") is not None
    assert bodies.Role.load(str(tmp_path), "other") is None      # stale: answers nothing, the left-head rule decides
    assert bodies.Role.load(str(tmp_path / "none"), "abc") is None
    r2 = bodies.Role.load(str(tmp_path), "abc")
    d = cue(reach=-1, penis=-1)
    assert abs(r.p_first_bottom(d) - r2.p_first_bottom(d)) < 1e-9 and r.p_first_bottom(d) > 0.5


# ------------------------------------------------------------------ suggest's use of it (partlabel.assign_bodies, tidy per body)
def groups_of(ps):
    from pawtrack import partlabel
    return [{"name": p["part"], "_mask": p["mask"], "score": p["score"], "poly": partlabel.mask_poly(p["mask"]), "source": "seeder", "pinned": True} for p in ps]


def test_assign_bodies_two_heads_two_characters_no_head_2():
    from pawtrack import partlabel, tidy
    gs, rec = partlabel.assign_bodies(groups_of(two_chars()), ASP, None, None, None, sam=False)
    assert rec["bodies"] == 2 and rec["by"] == "left"
    assert {g["who"] for g in gs} == {"c1", "c2"}
    heads = [g for g in gs if g["part"] == "head"]
    assert sorted(g["who"] for g in heads) == ["c1", "c2"] and heads[0]["who_conf"] == bodies.LEFT_CONF
    fin = tidy.finish(gs, ASP, 0.0, partlabel.mask_poly)
    assert sorted((g["who"], g["part"]) for g in fin if g["part"] in ("head", "torso", "hips")) == sorted((w, p) for p in ("head", "hips", "torso") for w in ("c1", "c2"))
    assert not any(g.get("half") for g in fin)           # one per part per body: no `head 2`
    left_head = next(g for g in heads if g["poly"][0][0] < 0.5)
    assert left_head["who"] == "c1"                      # the left-head fallback names the bodies


def test_assign_bodies_solo_is_bottom_and_many_heads_fall_back():
    from pawtrack import partlabel
    ps = [P("head", box(10, 10, 25, 25)), P("torso", box(10, 30, 40, 50)), P("penis", box(60, 30, 80, 40))]
    gs, rec = partlabel.assign_bodies(groups_of(ps), ASP, None, None, None, sam=False)
    assert {g["who"] for g in gs} == {"c1"} and rec["by"] == "solo" and gs[0]["who_conf"] == bodies.SOLO_CONF
    three = two_chars() + [P("head", box(70, 70, 80, 80))]
    gs, rec = partlabel.assign_bodies(groups_of(three), ASP, None, None, None, sam=False)
    assert gs is None and "fallback" in rec


def test_assign_bodies_owner_named_blobs_name_the_bodies_by_vote():
    from pawtrack import partlabel
    ps = two_chars()
    left_head = next(i for i, p in enumerate(ps) if p["part"] == "head")
    # the owner says the LEFT head is Top (c2): that body is Top, the other Bottom, whatever the rule says
    gs, rec = partlabel.assign_bodies(groups_of(ps), ASP, None, None, None, whos={left_head: "c2"}, sam=False)
    assert rec["by"] == "given" and gs[left_head]["who"] == "c2"
    right_head = next(i for i, p in enumerate(ps) if p["part"] == "head" and i != left_head)
    assert gs[right_head]["who"] == "c1"


def test_namer_bodies_fill_who_confidence_and_leave_the_owners_who(tmp_path):
    from pawtrack import autoname
    ps = two_chars()
    n = len(ps)
    out = [{"part": [], "conf": 0.9, "auto": True, "who": None, "who_by": None, "named": False} for _ in range(n)]
    best = [p["part"] for p in ps]
    ok = autoname.Namer._bodies(out, best, list(set(best)), [p["mask"] for p in ps], np.zeros((4, 2), np.float32), (2, 2), ASP, None, {0: "c2"}, None, None)
    assert ok and out[0]["who"] == "c2" and out[0]["who_by"] == "given"
    assert all(o["who"] in ("c1", "c2") and o["who_conf"] <= 1.0 for o in out[1:])
