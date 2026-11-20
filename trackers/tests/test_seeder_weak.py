"""PROTOCOL v4.31 (paw-855t): partial labels. "Not painted" is unknown, not "no": weak negatives, strong where reliable, the held-out extras
two ways. Synthetic features only (no model, no GPU)."""
import numpy as np

from pawtrack import seedscore, seeder

from test_seeder import GRID, D, box_mask, synth

PEN = {"part": "penis", "who": "c1", "mask": box_mask(.1, .3, .3, .6)}     # rows 3..5 of 9, cols 2..4 of 16
N = seeder.NEG_WEIGHT


def W(groups, strong=False, ign=None):
    return seeder.weights(groups, GRID, ign, strong).reshape(GRID[0], GRID[1], -1)


def test_weights_for_each_case():
    k, h, pn, tl = (seeder.PI[x] for x in ("knot", "head", "penis", "tail"))
    w = W([PEN])
    assert w[4, 3, pn] == 1, "a painted patch is a positive at full weight"
    assert w[0, 10, tl] == N and w[8, 15, pn] == N, "unpainted on a partial picture: a weak negative of every part"
    assert w[4, 3, h] == 1, "under a painted penis a head is a reliable negative"
    assert w[4, 3, k] == N and w[4, 3, seeder.PI["sheath"]] == N, "but not a knot or a sheath (they live on a penis): as unknown as elsewhere"
    wc = W([PEN], strong=True)
    assert (wc[0, 10] == 1).all() and wc[4, 3, k] == 1, "fully labelled: every unpainted patch is a strong negative"
    none = seeder.weights([], GRID, None, seeder.strong_frame({"groups": []})).reshape(GRID[0], GRID[1], -1)
    assert (none == 1).all(), "'nothing here': every patch a strong negative"
    assert seeder.strong_frame({"groups": [PEN]}) is False and seeder.strong_frame({"groups": [PEN], "complete": True}) is True
    u = box_mask(.6, 0, 1, 1)
    wi = W([PEN], ign=u)
    assert (wi[:, 11:] == 0).all() and wi[4, 3, pn] == 1, "an ignore region weighs nothing"
    Y = seeder.targets([PEN], GRID, u)
    assert (seeder.weights([PEN], GRID, u).reshape(-1, len(seeder.PARTS))[Y < 0] == 0).all()


def toy(n=12, hips_painted=6):
    """n pictures (each its own source): a penis look at one place, a hips look at another; the hips painted on the first `hips_painted`."""
    frames, feats = [], {}
    for i in range(n):
        f, g = synth(i)
        groups = [g[0]] + ([g[1]] if i < hips_painted else [])
        fr = {"key": f"s{i}", "t": 0, "W": 320, "H": 180, "groups": groups, "image": True}
        frames.append(fr)
        feats[(fr["key"], 0)] = (f, GRID)
    return frames, feats


def fit(frames, feats):
    Xs = [feats[(f["key"], 0)][0] for f in frames]
    return seeder.Head.fit(Xs, [seeder.targets(f["groups"], GRID) for f in frames], Ws=[seeder.weights(f["groups"], GRID, None, seeder.strong_frame(f)) for f in frames])


def sparse(n=12):
    """n pictures, ~2 % of whose patches (3 of 144) are painted as the part; the other 98 % are unpainted on a partial picture."""
    frames, feats = [], {}
    for i in range(n):
        f, g = synth(i, part_box=(4, 5, 2, 5))
        pen = np.zeros((180, 320), bool)
        pen[4 * 20:5 * 20, 2 * 20:5 * 20] = True
        fr = {"key": f"s{i}", "t": 0, "W": 320, "H": 180, "groups": [{"part": "penis", "who": "c1", "mask": pen}], "image": True}
        frames.append(fr)
        feats[(fr["key"], 0)] = (f, GRID)
    return frames, feats


def fit_with(frames, feats, balance):
    return seeder.Head.fit([feats[(f["key"], 0)][0] for f in frames], [seeder.targets(f["groups"], GRID) for f in frames], balance=balance,
                           Ws=[seeder.weights(f["groups"], GRID, None, seeder.strong_frame(f)) for f in frames])


def test_balancing_by_total_weight_keeps_a_2_percent_part_alive_where_per_patch_weights_go_silent():
    frames, feats = sparse()
    f, _ = synth(99, part_box=(1, 2, 10, 13))   # held-out picture: the part somewhere else
    pn = seeder.PI["penis"]
    mass = fit_with(frames, feats, "mass").heat(f, GRID)[..., pn]
    naive = fit_with(frames, feats, "patch").heat(f, GRID)[..., pn]
    rest = np.ones(mass.shape, bool)
    rest[1, 10:13] = False
    assert mass[1, 10:13].mean() > 0.5 and mass[1, 10:13].mean() > mass[rest].mean() + 0.08, "fires on the held-out painted region, more than elsewhere: %s" % mass[1, 10:13]
    assert (mass > 0.5).sum() <= 0.4 * GRID[0] * GRID[1], "and not everywhere"
    assert naive.max() < 0.5, "the same constant per patch, no balancing: 98 %% unknown outweighs 2 %% painted, silent (max %.2f)" % naive.max()


def test_the_unknown_mass_is_capped_against_the_positives_by_construction(monkeypatch):
    import torch
    frames, feats = sparse()
    seen = {}
    real = torch.nn.functional.binary_cross_entropy_with_logits
    def spy(x, y, weight=None, pos_weight=None, **kw):
        seen["w"], seen["y"], seen["pw"] = weight.clone(), y.clone(), pos_weight.clone()
        return real(x, y, weight=weight, pos_weight=pos_weight, **kw)
    monkeypatch.setattr(torch.nn.functional, "binary_cross_entropy_with_logits", spy)
    monkeypatch.setattr(seeder, "NEG_WEIGHT", 1.0)   # even a silly constant cannot make the unknown outweigh the painted
    fit_with(frames, feats, "mass")
    w, y, pw = seen["w"], seen["y"], seen["pw"]
    pn = seeder.PI["penis"]
    pos_mass = float(((y[:, pn] == 1) * 1.0).sum() * pw[pn])
    unknown = float((w[:, pn] * ((y[:, pn] == 0) & (w[:, pn] < 1))).sum())
    assert unknown <= seeder.UNK_FRAC * pos_mass + 1e-4, (unknown, pos_mass)


def test_threshold_calibration_picks_a_sensible_value_and_keeps_the_default_without_strict_pictures():
    box = box_mask(.1, .1, .3, .3)
    def pred(f, heat, size, use, thr):
        out = []
        for part, c, sc in heat:
            if sc >= thr:
                out.append({"part": part, "mask": box_mask(c[0] - .1, c[1] - .1, c[0] + .1, c[1] + .1), "c": c, "score": sc})
        return out
    heat = [("penis", (.2, .2), 0.4), ("hips", (.8, .8), 0.3)]   # the true blob peaks at 0.4, a false one at 0.3
    def held(n_strict):
        return [({"id": f"f{i}", "src": f"f{i}", "W": 320, "H": 180, "groups": [{"part": "penis", "mask": box}], "complete": i < n_strict}, heat, (320, 180), None) for i in range(8)]
    thr, info = seedscore.calibrate(held(6), pred, {"penis"})
    assert info["calibrated"] and info["n_strict"] == 6 and 0.3 < thr <= 0.4, thr   # above the false blob, not above the true one
    thr, info = seedscore.calibrate(held(2), pred, {"penis"})
    assert thr == seeder.THR and not info["calibrated"] and "needs" in info["why"], "too few strict pictures: the default stays, and it says so"


def test_the_silent_share_is_reported_and_the_head_uses_the_calibrated_threshold(tmp_path):
    rows = [{"part": "penis", "found": False, "iou": 0.0, "cerr": None}, {"part": "penis", "found": True, "iou": .5, "cerr": .01},
            {"part": "hips", "found": False, "iou": 0.0, "cerr": None}, {"part": "hips", "found": False, "iou": 0.1, "cerr": .3}]
    assert seedscore._agg(rows, None)["silent"] == 0.5
    frames, feats = toy(n=12)
    for f in frames:
        f["complete"] = True
    s = seedscore.score(frames, feats)
    assert s["overall"]["silent"] is not None and s["threshold"]["calibrated"] and s["threshold"]["n_strict"] == 12
    sd = str(tmp_path)
    x, g = synth(0)
    h = fit(frames, feats)
    h.use = np.ones(len(seeder.PARTS), bool)
    info = {"fingerprint": "fp1", "frames": 1}
    h.save(sd, info)
    assert seeder.Head.load(sd).thr == seeder.THR, "no score yet: the default"
    seedscore.store(sd, {**s, "fingerprint": "fp1", "at": 1})
    h2 = seeder.Head.load(sd)
    assert h2.thr == s["threshold"]["value"], "Suggest uses the threshold the held-out score calibrated"


def test_extras_two_ways():
    gts = {"id": "a", "src": "a", "W": 320, "H": 180, "groups": [{"part": "penis", "mask": box_mask(.1, .1, .3, .3)}]}
    blob = {"part": "hips", "mask": box_mask(.6, .6, .7, .7), "c": (.65, .65)}
    _, fr = seedscore.evaluate({"a": [blob], "b": [blob]}, [gts, {**gts, "id": "b", "src": "b", "complete": True}, {**gts, "id": "c", "src": "c", "groups": []}])
    assert [x["strict"] for x in fr] == [False, True, True] and [x["extra"] for x in fr][:2] == [1, 1]
    agg = seedscore._agg([], fr)
    assert agg["extra_strict"] == 0.5 and agg["n_strict"] == 2 and abs(agg["extra"] - 2 / 3) < 1e-9


def test_fingerprint_follows_the_weight_and_the_complete_flag(monkeypatch):
    frames, _ = toy(n=2)
    f0 = seeder.fingerprint(frames)
    frames[0]["complete"] = True
    f1 = seeder.fingerprint(frames)
    assert f1 != f0, "marking a picture fully labelled retrains"
    monkeypatch.setattr(seeder, "NEG_WEIGHT", 0.5)
    assert seeder.fingerprint(frames) != f1, "the negative weight is in it"


def test_image_labels_read_complete(tmp_path):
    import json
    from test_seeder_images import grp, label, make_image
    labels = tmp_path / "labels"
    labels.mkdir()
    im = make_image(tmp_path / "a.png")
    label(labels, "iaaaaaaaaaaaaaa", im, [grp("c1_penis", (.1, .2, .3, .5))])
    d = json.loads((labels / "iaaaaaaaaaaaaaa.json").read_text())
    assert "complete" not in seeder.image_labels(str(labels))[0][0]
    (labels / "iaaaaaaaaaaaaaa.json").write_text(json.dumps({**d, "complete": True}), encoding="utf-8")
    assert seeder.image_labels(str(labels))[0][0]["complete"] is True
