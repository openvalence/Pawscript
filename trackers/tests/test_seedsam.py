"""PROTOCOL v4.29 (paw-26iv): the head locates, SAM draws (pawtrack/seedsam.py). Synthetic masks, a fake SAM predictor; no models, no GPU."""
import json
import os
import shutil
import subprocess

import cv2
import numpy as np
import pytest

from pawtrack import seeder, seedsam

W, H = 160, 90
SHIPPED = dict(seedsam.POLICY)


@pytest.fixture(autouse=True)
def neutral_policy(monkeypatch):
    """The shipped per-part table and drift rule are tested on their own below; the older tests run the plain walk-up."""
    monkeypatch.setattr(seedsam, "POLICY", {})
    monkeypatch.setattr(seedsam, "CENTRE_MAX", None)


def blob(x0, y0, x1, y1):
    m = np.zeros((H, W), bool)
    m[y0:y1, x0:x1] = True
    return m


def reg(part, m, score=0.9, peak=None, heat=None):
    ys, xs = np.nonzero(m)
    return {"part": part, "mask": m, "score": score, "c": (xs.mean() / W, ys.mean() / H),
            "peak": peak or ((xs.mean() + .5) / W, (ys.mean() + .5) / H), **({} if heat is None else {"heat": heat})}


# ------------------------------------------------------------------ clean_mask: one smooth piece, and the JS agrees
def ragged(seed=0):
    """An ellipse with a hole, a speck, a far second piece and a noisy edge (coverage 0 / 1)."""
    r = np.random.default_rng(seed)
    m = np.zeros((H, W), np.float32)
    cv2.ellipse(m, (60, 45), (36, 22), 20, 0, 360, 1, -1)
    m[40:44, 50:54] = 0                       # a hole (under HOLE_FRAC)
    m[5:7, 140:142] = 1                       # a speck
    m[70:84, 110:150] = 1                     # a second, far piece without a prompt
    edge = (cv2.dilate(m, np.ones((3, 3), np.uint8)) - cv2.erode(m, np.ones((3, 3), np.uint8))) > 0
    m[edge & (r.random((H, W)) < 0.4)] = 0    # ragged fringe
    return m


def test_clean_mask_keeps_the_prompted_piece_fills_holes_and_smooths():
    a = ragged()
    c = seedsam.clean_mask(a, [(60, 45)], margin=15)
    b = c >= 0.5
    n, lab = cv2.connectedComponents(b.astype(np.uint8), connectivity=4)
    assert n == 2, "one piece"
    assert not b[5:7, 140:142].any() and not b[70:84, 110:150].any(), "speck and far piece gone"
    assert b[41:43, 51:53].all(), "the hole is filled"
    # smoother: fewer boundary pixels than the ragged original's
    assert cv2.Laplacian(c, cv2.CV_32F).std() < cv2.Laplacian(a, cv2.CV_32F).std()
    # prompts in the other piece: that one wins (the one holding the most prompts)
    c2 = seedsam.clean_mask(a, [(130, 77)], margin=15) >= 0.5
    assert c2[75, 130] and not c2[45, 60]
    assert not seedsam.clean_mask(np.zeros((H, W), np.float32), [(1, 1)]).any()
    # never into another group
    other = blob(60, 0, 160, 90)
    assert not (seedsam.clean_mask(a, [(40, 45)], 15, others=[other]) >= 0.5)[other].any()


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_clean_mask_agrees_with_the_apps_grow_js(tmp_path):
    """The Python port and src/features/tracking/grow.js cleanMask, same constants, on the same synthetic mask: within a few %."""
    for seed, margin in ((0, 15), (1, 0), (2, 100)):   # the default, at the edge, the most
        a = ragged(seed)
        pos = [(60, 45), (75, 50)]
        fn = tmp_path / f"m{seed}.json"
        fn.write_text(json.dumps({"w": W, "h": H, "a": a.ravel().tolist(), "pos": pos, "margin": margin}))
        out = subprocess.run(["node", os.path.join(os.path.dirname(__file__), "cleanmask_js.mjs"), str(fn)], capture_output=True, text=True, timeout=60)
        assert out.returncode == 0, out.stderr
        js = np.array(json.loads(out.stdout)["a"], np.float32).reshape(H, W) >= 0.5
        py = seedsam.clean_mask(a, pos, margin) >= 0.5
        iou = (js & py).sum() / (js | py).sum()
        assert abs(int(js.sum()) - int(py.sum())) <= 0.03 * js.sum(), (seed, js.sum(), py.sum())
        assert iou >= 0.97, (seed, iou)


# ------------------------------------------------------------------ prompts
def test_positives_one_point_for_a_compact_blob_spread_interior_points_for_an_elongated_one():
    m = blob(60, 35, 90, 60)
    assert len(seedsam.positives(reg("head", m, 0.9))) == 1
    long_ = blob(10, 40, 150, 50)
    pos = seedsam.positives(reg("penis", long_, 0.9, peak=(80.5 / W, 45.5 / H)))
    assert len(pos) == 3 and pos[0] == (80.5, 45.5)
    xs = sorted(p[0] for p in pos)
    assert xs[0] < 30 and xs[-1] > 130, "well spread along the blob"
    assert all(long_[int(y), int(x)] for x, y in pos), "inside the blob"


def test_negatives_skip_parent_child_pairs():
    penis, knot, hips, low, tail2 = (reg("penis", blob(10, 40, 80, 50), 0.9, peak=(.2, .5)), reg("knot", blob(60, 38, 80, 52), 0.9, peak=(.45, .5)),
                                     reg("hips", blob(100, 20, 150, 70), 0.9, peak=(.8, .5)), reg("tongue", blob(5, 5, 15, 15), 0.5, peak=(.07, .1)),
                                     reg("penis", blob(100, 70, 120, 85), 0.8, peak=(.7, .9)))
    regs = [penis, knot, hips, low, tail2]
    pos = [(.2 * W, .5 * H)]
    neg = seedsam.negatives(0, regs, pos, (W, H))
    assert (.45 * W, .5 * H) not in neg, "a knot's peak is no negative for the penis"
    assert (.8 * W, .5 * H) in neg and (.7 * W, .9 * H) in neg, "an unrelated part and another blob of the same part are"
    assert (.07 * W, .1 * H) not in neg, "an unconfident blob is not"
    neg_k = seedsam.negatives(1, regs, [(.45 * W, .5 * H)], (W, H))
    assert (.2 * W, .5 * H) not in neg_k, "nor the penis' for the knot"
    assert not seedsam.related("penis", "hips") and seedsam.related("sheath", "penis") and seedsam.related("knot", "penis")


# ------------------------------------------------------------------ choosing (paw-om3e: the dab's rule, the head's blob only a guard)
def test_choose_walks_up_from_the_sub_part_to_the_part_even_when_the_blob_is_small():
    blobm = blob(60, 35, 90, 60)                                # the head's coarse blob: 750 px
    sub = blob(65, 38, 85, 58).astype(np.float32)               # a quarter of the part
    part = blob(50, 28, 100, 66).astype(np.float32)             # the part: 1900 px = 2.5x the blob (the old rule's ceiling is 3x, closeness picked the sub-part)
    whole = blob(0, 0, 160, 90).astype(np.float32)              # the body
    pos = [(72, 44)]
    k, why = seedsam.choose(np.stack([sub, part, whole]), [0.9, 0.7, 0.3], blobm, pos)
    assert (k, why) == (1, ""), "sub-part -> part; the next level (the scene) is over the image share"
    # a much larger part than the blob (5x): still taken (the old 3x ceiling refused it)
    big = blob(40, 22, 115, 72).astype(np.float32)             # 5x the blob
    k, why = seedsam.choose(np.stack([sub, big]), [0.9, 0.5], blobm, pos)
    assert (k, why) == (1, "")
    # the guards: over BLOB_MAX x the blob steps back down; over half the picture is refused
    huge = blob(10, 5, 150, 85).astype(np.float32)              # 12 x the blob, 88 % of the picture
    k, why = seedsam.choose(np.stack([sub, part, huge]), [0.9, 0.7, 0.6], blobm, pos)
    assert (k, why) == (1, "")
    assert seedsam.choose(np.stack([whole]), [0.9], blobm, pos) == (None, "size")
    # a candidate covering another unrelated part's peak swallowed it: the previous level
    k, why = seedsam.choose(np.stack([sub, part, big]), [0.9, 0.7, 0.6], blobm, pos, neg=[(45, 25)])
    assert (k, why) == (1, "")
    assert seedsam.choose(np.stack([big]), [0.9], blobm, pos, neg=[(45, 25)]) == (None, "swallow")
    # SAM's score does not rank: a high-scored sub-part loses to the part; a level below SCORE_FLOOR is not climbed to
    k, why = seedsam.choose(np.stack([sub, part]), [0.95, 0.02], blobm, pos)
    assert k == 0
    # only candidates holding every positive count (the sub-part misses the second one)
    k, why = seedsam.choose(np.stack([sub, part]), [0.9, 0.9], blobm, [(72, 44), (95, 60)])
    assert k == 1
    assert seedsam.choose(np.stack([sub]), [0.9], blobm, [(150, 80)]) == (None, "none")
    # a jump of more than LEVEL_MAX x stays below
    tiny = blob(70, 42, 72, 44).astype(np.float32)
    k, _ = seedsam.choose(np.stack([tiny, part]), [0.9, 0.9], blobm, [(70, 42)])
    assert k == 0


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_choose_agrees_with_the_apps_pickmask(tmp_path):
    """Suggest's choice and the dab's (grow.js pickMask) on the same synthetic candidate sets (sub-part / part / whole, big jumps, low scores)."""
    rects = {"s": (70, 42, 76, 47), "m": (62, 34, 90, 60), "p": (50, 28, 100, 66), "b": (30, 15, 130, 75), "w": (0, 0, 160, 90), "t": (70, 42, 72, 44)}
    sets = [("s", "p", "w"), ("s", "m", "p", "b"), ("s", "p"), ("t", "p"), ("t", "m", "p", "w"), ("s", "w"), ("m", "b", "w")]
    scores = [(0.9, 0.7, 0.3, 0.2), (0.9, 0.02, 0.5, 0.5), (0.3, 0.9, 0.04, 0.9)]
    whole_blob = np.ones((H, W), bool)   # the blob guard is Suggest's own: a blob as large as the picture never refuses
    for si, names in enumerate(sets):
        for sj, sc in enumerate(scores):
            ms = [blob(*rects[n]).astype(np.float32) for n in names]
            sc = list(sc[:len(ms)])
            pos = [(72, 44)]
            fn = tmp_path / f"p{si}_{sj}.json"
            fn.write_text(json.dumps({"w": W, "h": H, "masks": [{"a": m.ravel().tolist(), "score": s} for m, s in zip(ms, sc)], "pos": pos}))
            out = subprocess.run(["node", os.path.join(os.path.dirname(__file__), "pickmask_js.mjs"), str(fn)], capture_output=True, text=True, timeout=60)
            assert out.returncode == 0, out.stderr
            js = json.loads(out.stdout)
            k, why = seedsam.choose(np.stack(ms), sc, whole_blob, pos)
            assert (k if k is not None else -1) == js["index"], (names, sc, k, js)


# ------------------------------------------------------------------ the step, with a fake SAM
def fake_predict(answers):
    """predict(points, labels, box): the masks `answers(points, labels)` returns, all three at 0.9."""
    calls = []

    def predict(pts, lab, box, single=False):
        calls.append((pts.copy(), lab.copy(), box))
        ms = answers(pts, lab)
        return np.stack(ms).astype(np.float32), np.full(len(ms), 0.9)
    predict.calls = calls
    return predict


def test_refine_draws_with_sam_and_marks_where_the_mask_came_from():
    head_blob = blob(60, 35, 100, 60)
    real = blob(58, 33, 98, 58)
    r = reg("penis", head_blob, 0.9)
    pr = fake_predict(lambda p, l: [blob(70, 40, 80, 50), real, blob(0, 0, 160, 90)])
    out, rec = seedsam.refine([r], (W, H), pr)
    assert len(out) == 1 and out[0]["mask_from"] == "sam" and rec["sam"] == 1 and rec["head"] == 0
    iou = lambda a, b: (a & b).sum() / (a | b).sum()
    assert iou(out[0]["mask"], real) > 0.8, "SAM's outline, cleaned, not the head's blob"
    assert len(pr.calls) == 1 and pr.calls[0][1].tolist() == [1]
    assert pr.calls[0][2] is None, "no box: it clips whatever would grow past the head's blob"
    st = out[0]["sam"]
    assert st["pos"] and st["neg"] == [] and st["raw"].shape == (H, W), "the prompts and SAM's chosen mask travel with the proposal"


def test_refine_never_loses_a_part_the_head_found_to_a_sam_that_disagrees():
    nothing = fake_predict(lambda p, l: [blob(0, 0, 160, 90)] * 3)   # always the whole frame: refused as far too large
    confident, tentative = reg("penis", blob(10, 10, 40, 30), 0.9), reg("hand", blob(100, 50, 130, 70), 0.55)
    out, rec = seedsam.refine([confident, tentative], (W, H), nothing)
    assert sorted((o["part"], o["mask_from"]) for o in out) == [("hand", "head"), ("penis", "head")]
    for o, r in zip(sorted(out, key=lambda o: o["part"]), [tentative, confident]):
        assert (o["mask"] & r["mask"]).sum() > 0.5 * r["mask"].sum(), "the head's own blob, cleaned (smoothed, margin)"
    assert rec["dropped"] == 0 and rec["why"] == {"size": 2} and all("sam" not in o for o in out)


def test_unrelated_parts_do_not_overlap_but_parent_and_child_may():
    # two unrelated parts whose masks are the same thing: the lower score is dropped
    a, b = reg("hips", blob(50, 30, 100, 70), 0.9), reg("torso", blob(52, 31, 100, 70), 0.8)
    same = fake_predict(lambda p, l: [blob(50, 30, 100, 70)] * 3)
    out, _ = seedsam.refine([a, b], (W, H), same)
    assert [o["part"] for o in out] == ["hips"]
    # partial overlap of unrelated parts: the lower score gives up the shared pixels
    ans = {0: blob(40, 30, 90, 70), 1: blob(80, 30, 130, 70)}
    seq = iter([0, 1])
    two = fake_predict(lambda p, l: [ans[next(seq)]] * 3)
    out, _ = seedsam.refine([reg("hips", blob(40, 30, 90, 70), 0.9, peak=(.4, .55)), reg("torso", blob(80, 30, 130, 70), 0.8, peak=(.65, .55))], (W, H), two)
    m = {o["part"]: o["mask"] for o in out}
    assert set(m) == {"hips", "torso"} and not (m["hips"] & m["torso"]).any()
    # a knot on the penis: both stay, overlapping
    seq = iter([0, 1])
    ans = {0: blob(20, 40, 120, 50), 1: blob(90, 38, 115, 52)}
    kn = fake_predict(lambda p, l: [ans[next(seq)]] * 3)
    out, _ = seedsam.refine([reg("penis", blob(20, 40, 120, 50), 0.9, peak=(.4, .5)), reg("knot", blob(90, 38, 115, 52), 0.85, peak=(.65, .5))], (W, H), kn)
    m = {o["part"]: o["mask"] for o in out}
    assert set(m) == {"penis", "knot"} and (m["penis"] & m["knot"]).sum() > 100


def test_the_knot_is_not_a_negative_in_the_penis_prompt():
    seen = []
    pr = fake_predict(lambda p, l: (seen.append((p.copy(), l.copy())), [blob(20, 40, 120, 50)] * 3)[1])
    penis, knot, hips = reg("penis", blob(20, 40, 120, 50), 0.9, peak=(.4, .5)), reg("knot", blob(90, 38, 115, 52), 0.85, peak=(.65, .5)), reg("hips", blob(130, 10, 155, 80), 0.9, peak=(.9, .5))
    seedsam.refine([penis, knot, hips], (W, H), pr)
    pts, lab = seen[0]
    neg = pts[lab == 0]
    assert len(neg) == 1 and abs(neg[0][0] - .9) < 1e-3, "only the hips' peak"
    assert [p for p in seen[1][0][seen[1][1] == 0]] and not any(abs(p[0] - .4) < 1e-3 for p in seen[1][0][seen[1][1] == 0]), "the knot's negatives do not include the penis"


def test_regions_carry_the_peak_and_the_heat_for_the_prompts():
    heat = np.zeros((9, 16, len(seeder.PARTS)), np.float32)
    heat[3:6, 4:9, seeder.PI["penis"]] = 0.9
    heat[4, 6, seeder.PI["penis"]] = 1.0
    use = np.array([p == "penis" for p in seeder.PARTS])
    r = seeder.regions(heat, (160, 90), use)[0]
    assert r["part"] == "penis" and r["heat"].shape == (90, 160) and abs(r["peak"][0] - 6.5 / 16) < 0.05 and abs(r["peak"][1] - 4.5 / 9) < 0.05


# ------------------------------------------------------------------ suggest(): the SAM step wired in (tagger, SAM and the head faked)
def test_suggest_draws_head_and_cam_parts_with_sam_and_marks_them(monkeypatch):
    from pawtrack import partlabel
    monkeypatch.setattr(seeder, "MASK_W", W)   # masks of the fakes are W x H
    gh, gw = 9, 16
    heat_cam = np.zeros((gh, gw), np.float32)
    heat_cam[1:3, 11:14] = 1.0
    reg_cam = np.zeros((gh, gw), bool)
    reg_cam[1:3, 11:14] = True
    def sem(bgr, box, probs, heat_out, labels, vocab, feats=None):
        heat_out["tail"] = heat_cam
        feats.append((np.zeros((gh * gw, 8), np.float16), (gh, gw)))
        return {"tail": reg_cam}, {"tail": {"label": "tail", "source": "cam", "score": 0.4, "peak": [12.5 / gw, 1.5 / gh], "cells": 6}}
    monkeypatch.setattr(partlabel, "sem_regions", sem)
    monkeypatch.setattr(partlabel, "shape_regions", lambda bgr, regions, rec, heat, shape: {"tail": blob(118, 8, 140, 20)})
    monkeypatch.setattr(partlabel, "sam_ready", lambda: True)
    monkeypatch.setattr(partlabel, "_sam", lambda: object())

    class Head:
        features = seeder.HYDRA
        use = np.array([p == "penis" for p in seeder.PARTS])

        def heat(self, f, grid):
            h = np.zeros((grid[0], grid[1], len(seeder.PARTS)), np.float32)
            h[4:6, 2:7, seeder.PI["penis"]] = 0.95
            return h
    drawn = {"penis": blob(18, 38, 68, 62), "tail": blob(118, 8, 140, 20)}
    from pawtrack import seedsam as S
    monkeypatch.setattr(S, "sam_predict", lambda pred, rgb, size, key=None: (lambda pts, lab, box, single=False: (
        np.stack([drawn["tail" if pts[0][0] > 0.6 else "penis"].astype(np.float32)] * 3), np.full(3, 0.9))))
    from pawtrack import segment
    monkeypatch.setattr(segment, "_fit", lambda b: b)
    bgr = np.zeros((90, 160, 3), np.uint8)
    out = partlabel.suggest(bgr, head=Head(), who_split="position", head_shape="sam")
    by = {g["name"].split("_")[-1] if "_" in g["name"] else g["name"]: g for g in out}
    pen = next(g for g in out if "penis" in g["name"])
    tail = next(g for g in out if "tail" in g["name"])
    assert pen["source"] == "seeder" and pen["mask_from"] == "sam" and pen["outline"] == "sam"
    assert tail["source"] == "tagger" and tail["mask_from"] == "sam"
    xs = [p[0] for p in pen["poly"]]
    assert 0.1 < min(xs) and max(xs) < 0.45, "SAM's outline of the penis, not the head's 16 px blob"
    assert partlabel.LAST["sam"]["sam"] == 2
    # head_shape 'head': blobs, marked as such
    out = partlabel.suggest(bgr, head=Head(), who_split="position", head_shape="head")
    assert next(g for g in out if "penis" in g["name"])["mask_from"] == "head" and next(g for g in out if "tail" in g["name"])["mask_from"] == "cam"
    assert not partlabel.LAST


def test_clean_mask_smoothing_keeps_the_area(tmp_path):
    """paw-k8jj: the blur rounds the fringe, it must not shrink the part (grow.js areaKeep): margin 0, a small and a large disc."""
    for r in (6, 12, 30):
        yy, xx = np.mgrid[:H, :W]
        a = (np.hypot(xx + 0.5 - 80, yy + 0.5 - 45) < r).astype(np.float32)
        out = seedsam.clean_mask(a, [(80, 45)], 0)
        assert abs(float((out >= 0.5).sum()) - float(a.sum())) <= 0.03 * a.sum() + (6 if r < 8 else 2), (r, out.sum(), a.sum())


# ------------------------------------------------------------------ paw-0u0d: a SAM level per part, and the drift rule (Suggest only)
def test_choose_sub_takes_the_smallest_candidate_where_part_walks_up():
    blobm = blob(60, 35, 90, 60)
    sub, part = blob(65, 38, 85, 58).astype(np.float32), blob(50, 28, 100, 66).astype(np.float32)
    pos = [(72, 44)]
    ms, sc = np.stack([sub, part]), [0.9, 0.7]
    assert seedsam.choose(ms, sc, blobm, pos) == (1, "")
    assert seedsam.choose(ms, sc, blobm, pos, level="part") == (1, "")
    assert seedsam.choose(ms, sc, blobm, pos, level="sub") == (0, "")
    assert seedsam.choose(np.stack([sub]), [0.9], blobm, [(150, 80)], level="sub") == (None, "none"), "the guards still apply"


def test_refine_applies_the_part_level_head_single_and_sub(monkeypatch):
    sub, part = blob(70, 40, 80, 50), blob(58, 33, 98, 58)
    seen = []

    def predict(pts, lab, box, single=False):
        seen.append(single)
        return np.stack([sub, part]).astype(np.float32), np.array([0.9, 0.9])
    monkeypatch.setattr(seedsam, "POLICY", {"hips": "head", "thighs": "single", "torso": "sub"})
    regs = [reg("hips", blob(60, 35, 100, 60)), reg("thighs", blob(5, 5, 30, 25)), reg("torso", blob(110, 60, 150, 85)), reg("tail", blob(5, 60, 40, 85))]
    out, rec = seedsam.refine(regs[:1], (W, H), predict)
    assert out[0]["mask_from"] == "head" and seen == [] and rec["why"] == {"policy": 1}, "'head': SAM is not even asked"
    out, _ = seedsam.refine(regs[1:2], (W, H), predict)
    assert seen == [True], "'single' asks for one best mask"
    seen.clear()
    seedsam.refine(regs[2:], (W, H), predict)
    assert seen == [False, False], "'sub' and the default 'part' use the multimask answer"


def test_refine_drops_a_sam_mask_that_drifted_off_the_locator(monkeypatch):
    monkeypatch.setattr(seedsam, "CENTRE_MAX", 0.06)
    r = reg("penis", blob(60, 35, 100, 60))
    near = fake_predict(lambda p, l: [blob(56, 32, 100, 60)])
    far = fake_predict(lambda p, l: [blob(60, 20, 135, 85)])   # holds the peak but its interior point is ~35 px away (0.2 of the diagonal)
    out, _ = seedsam.refine([dict(r)], (W, H), near)
    assert out[0]["mask_from"] == "sam"
    out, rec = seedsam.refine([dict(r)], (W, H), far)
    assert out[0]["mask_from"] == "head" and rec["why"] == {"drift": 1}


def test_the_shipped_policy_names_only_known_parts_and_levels():
    assert set(SHIPPED.values()) <= {"part", "sub", "single", "head"}
    assert set(SHIPPED) <= set(seeder.PARTS) and SHIPPED["hips"] == "head"


def test_fit_size_cuts_hips_off_its_siblings_and_down_to_the_typical_area():
    """paw-4fne: hips = the blob minus an unrelated part's mask (tail; thighs sit on hips: kept), then its hottest pixels up to HIPS_AREA x the typical share."""
    yy, xx = np.mgrid[0:H, 0:W]
    heat = np.clip(1 - np.hypot(xx - 60, yy - 45) / 60, 0, 1).astype(np.float32)   # hottest at (60, 45)
    hips = np.zeros((H, W), bool)
    hips[20:70, 30:110] = True
    tail = np.zeros((H, W), bool)
    tail[20:70, 80:120] = True
    out = [{"part": "hips", "mask": hips, "heat": heat, "score": .9}, {"part": "tail", "mask": tail, "heat": heat, "score": .9}]
    assert seedsam.fit_size(out, None) is out and seedsam.fit_size(out, {}) is out   # no prior: unchanged (a head trained before paw-4fne)
    r = seedsam.fit_size(out, {"hips": 0.05})
    m = r[0]["mask"]
    assert not (m & tail).any()
    assert abs(m.sum() - seedsam.HIPS_AREA * 0.05 * m.size) <= 0.02 * m.size and m[45, 60]
    assert r[1]["mask"] is tail   # tail is not a guarded part


def test_fit_size_guards_an_oversized_torso_only_past_the_multiple():
    heat = np.tile(np.linspace(0, 1, W, dtype=np.float32), (H, 1))
    big = np.zeros((H, W), bool)
    big[10:80, 10:150] = True
    a = big.mean() / (seedsam.SIZE_GUARD * 1.5)   # the torso is 1.5x over the guard
    r = seedsam.fit_size([{"part": "torso", "mask": big, "heat": heat, "score": .9}], {"torso": a})[0]["mask"]
    assert abs(r.mean() - seedsam.SIZE_GUARD * a) < 0.01 and r[40, 149] and not r[40, 10]   # the hottest (right) side kept
    ok = seedsam.fit_size([{"part": "torso", "mask": big, "heat": heat, "score": .9}], {"torso": big.mean()})[0]["mask"]
    assert ok is big   # within the guard: untouched


def test_area_prior_is_the_median_share_with_enough_groups():
    def g(part, frac):
        m = np.zeros((10, 10), bool)
        m.flat[:int(frac * 100)] = True
        return {"part": part, "mask": m}
    frames = [{"groups": [g("hips", f), g("head", .5)]} for f in (.01, .02, .03, .04, .05)] + [{"groups": [g("knot", .1)]}]
    a = seeder.area_prior(frames)
    assert a == {"hips": 0.03, "head": 0.5}   # knot: one group, no prior
    assert "area" not in seeder._public({"area": a, "frames": 6})
