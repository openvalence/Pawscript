"""PROTOCOL v4.34 (paw-p9ve): automatic naming of painted blobs (pawtrack/autoname.py, `name_groups`). Synthetic features and generated
images only; no model, no GPU."""
import importlib.util
import json
import os

import numpy as np
import pytest

from pawtrack import autoname, cli, seeder

from test_seeder import D, GRID, box_mask, rle
from test_seeder_images import grp, label, make_image

LOOKS = {"penis": (0, 8), "hips": (8, 16), "head": (16, 24)}   # which feature channels a part lights up
CELL = 20


def synth3(seed):
    """A frame with a penis, hips and head at random spots: features (S, D) f16 + groups (masks at 320 x 180)."""
    r = np.random.default_rng(seed)
    f = r.normal(0, 1, (GRID[0], GRID[1], D)).astype(np.float32)
    groups = []
    cols = list(r.permutation([0, 5, 10]))
    for n, (part, (a, b)) in enumerate(LOOKS.items()):
        y, x = int(r.integers(0, GRID[0] - 3)), int(cols[n])
        f[y:y + 3, x:x + 4, a:b] += 6
        m = np.zeros((180, 320), bool)
        m[y * CELL:(y + 3) * CELL, x * CELL:(x + 4) * CELL] = True
        groups.append({"part": part, "who": "c1" if part == "head" else "c2", "mask": m})
    return f.reshape(-1, D).astype(np.float16), groups


def frames_of(seeds):
    fr, feats = [], {}
    for s in seeds:
        f, g = synth3(s)
        fr.append({"key": "k%d" % s, "t": 0, "W": 320, "H": 180, "groups": g})
        feats[("k%d" % s, 0)] = (f, GRID)
    return fr, feats


def test_region_features_are_pure_and_shaped():
    m = np.zeros((18, 32), bool)
    m[4:10, 8:20] = True
    ring = autoname.ring_of(m)
    assert ring.any() and not (ring & m).any(), "the ring is outside the blob"
    bgr = np.zeros((18, 32, 3), np.uint8)
    bgr[m] = (200, 10, 10)
    h = autoname.colour_hist(bgr, m)
    assert h.shape == (64,) and abs((h ** 2).sum() - 1) < 1e-5 and (h > 0).sum() == 1
    G = autoname.geometry([m, m.copy()], 16 / 9)
    assert G.shape == (2, 12) and np.isfinite(G).all()
    f, _ = synth3(1)
    ft = autoname.blob_features(f, GRID, [m, ~m], 16 / 9, [h, h])
    assert ft["pool"].shape == (2, D) and abs(np.linalg.norm(ft["pool"][0]) - 1) < 1e-4 and ft["gap"].shape == (2, 2)


def test_linear_model_on_separable_data():
    r = np.random.default_rng(0)
    X = np.r_[r.normal(0, 1, (60, 5)) + [3, 0, 0, 0, 0], r.normal(0, 1, (60, 5)) + [0, 3, 0, 0, 0], r.normal(0, 1, (60, 5)) + [0, 0, 3, 0, 0]]
    y = ["a"] * 60 + ["b"] * 60 + ["c"] * 60
    m = autoname.Lin.fit(X, y, ["a", "b", "c"], 0.03)
    P = m.proba(X)
    assert (np.array(m.classes)[P.argmax(1)] == np.array(y)).mean() > 0.9 and np.allclose(P.sum(1), 1)


def test_set_wise_decode_keeps_one_hips_per_character():
    cl = ["penis", "hips", "hand"]
    P = np.array([[.1, .8, .1], [.1, .7, .2]])
    best, P2 = autoname.decode_parts(P, cl)
    assert best == ["hips", "hips"], "unknown characters: two hips are allowed (one per character)"
    best, P2 = autoname.decode_parts(np.array([[.1, .8, .1], [.1, .7, .2], [.1, .6, .3]]), cl)
    assert best.count("hips") == 2 and best[2] != "hips", "three hips cannot be two characters'"
    best, _ = autoname.decode_parts(P, cl, who=[0, 0])
    assert best[0] == "hips" and best[1] == "hand", "one character: its hips only once"
    best, P2 = autoname.decode_parts(np.array([[.1, .8, .1], [.1, .7, .2]]), cl, who=[0, 0], named={0: "hips"})
    assert best == ["hips", "hand"] and P2[0, 1] == 1, "a named blob keeps its part and uses up its slot"
    best, _ = autoname.decode_parts(np.array([[.1, .1, .8], [.1, .1, .7], [.1, .1, .6]]), cl, who=[0, 0, 0])
    assert best[:2] == ["hand", "hand"] and best[2] != "hand", "a paired part (hand) twice per character"


def test_who_split_and_propagation_from_one_named_blob():
    r = np.random.default_rng(1)
    Z = np.r_[r.normal(0, .1, (3, 4)), r.normal(0, .1, (3, 4)) + 5]
    lab, margin = autoname.split_two(Z, ["head", "hips", "penis", "head", "hips", "penis"])
    assert len(set(lab[:3])) == 1 and len(set(lab[3:])) == 1 and lab[0] != lab[3] and margin > 0.5
    assert autoname.propagate_who(lab, {0: "c1"}) == ["c1"] * 3 + ["c2"] * 3
    assert autoname.propagate_who(lab, {0: "c1", 1: "c2"}) == [None] * 6, "named blobs that disagree name nothing"
    assert autoname.propagate_who(lab, {}) == [None] * 6
    # a part twice on one side forces the split even when the looks say one character
    lab2, _ = autoname.split_two(np.zeros((2, 3)), ["hips", "hips"])
    assert lab2[0] != lab2[1]


def test_namer_proposes_the_part_and_gates_what_confirm_all_may_take(tmp_path):
    fr, feats = frames_of(range(30))
    nm = autoname.fit(fr, feats, seeder.PARTS, "fp1")
    assert nm is not None and nm.info["blobs"] == 90 and len(nm.info["trained_on"]) == 30
    f, g = synth3(99)   # a picture it has not seen
    ms = [x["mask"] for x in g]
    out = nm.propose(f, GRID, ms, 16 / 9, None)
    assert [o["part"][0]["part"] for o in out] == ["penis", "hips", "head"]
    assert all(o["conf"] > 0.8 and o["auto"] == (o["conf"] >= autoname.GATE_PART) and len(o["part"]) == 3 and not o["named"] for o in out)
    assert sum(o["auto"] for o in out) >= 2
    assert all(o["who"] == "c1" and o["who_by"] == "solo" and o["who_conf"] < 0.95 for o in out), "no doubled anchor part: one body = Bottom, too unsure to apply by itself"
    # the owner named the first blob: it is fixed, and never "auto"
    out = nm.propose(f, GRID, ms, 16 / 9, None, named={0: "penis"})
    assert out[0]["named"] and not out[0]["auto"] and out[0]["part"][0] == {"part": "penis", "p": 1.0}
    # a blob that looks like nothing it knows is not confident: confirm-all must not take it
    z = np.random.default_rng(7).normal(0, 1, f.shape).astype(np.float16)
    out = nm.propose(z, GRID, ms, 16 / 9, None)
    assert not all(o["auto"] for o in out), "noise is not auto-confirmed (conf %s)" % [o["conf"] for o in out]
    # saved beside the head; another fingerprint (labels changed) = no model, never a guess
    nm.save(str(tmp_path))
    assert autoname.Namer.load(str(tmp_path), "fp1") is not None and autoname.Namer.load(str(tmp_path), "fp2") is None
    assert autoname.Namer.load(str(tmp_path)) is not None and autoname.Namer.load(str(tmp_path / "none")) is None
    assert autoname.fit(fr[:1], feats, seeder.PARTS) is None, "too few blobs to learn from"


def test_who_proposals_follow_the_named_blobs_via_the_appearance_split():
    fr, feats = frames_of(range(30))
    nm = autoname.fit(fr, feats, seeder.PARTS, "x")
    f, g = synth3(5)
    ms = [x["mask"] for x in g]
    # colours: blob 0 + 1 one character (red), blob 2 the other (blue)
    red, blue = np.sqrt(np.eye(64)[40]).astype(np.float32), np.sqrt(np.eye(64)[3]).astype(np.float32)
    out = nm.propose(f, GRID, ms, 16 / 9, [red, red, blue], named={0: "penis"}, whos={0: "c1"})
    assert out[0]["who"] == "c1" and out[0]["who_by"] == "given"
    assert [o["who"] for o in out[1:]] == ["c1", "c1"] and all(o["who_by"] == "given" for o in out[1:])   # one body: the owner's c1 names it all
    out = nm.propose(f, GRID, ms, 16 / 9, [red, red, blue], named={0: "penis"}, whos={0: "c2"})
    assert [o["who"] for o in out] == ["c2", "c2", "c2"]


def test_the_naming_scorer_never_scores_an_image_it_trained_on():
    path = os.path.join(os.path.dirname(__file__), "..", "..", "experiments", "seeder-probe", "autoname.py")
    if not os.path.exists(path):
        pytest.skip("experiments/seeder-probe is not part of the public source")
    spec = importlib.util.spec_from_file_location("autoname_probe", path)
    probe = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(probe)
    fr = [{"id": "s%d_%d" % (s, t), "key": "src%d" % s} for s in range(12) for t in range(1 + s % 3)]   # video-like sources with several frames
    seen = []

    def fit_predict(tr, te):
        assert {f["key"] for f in tr}.isdisjoint({f["key"] for f in te}), "a source is on one side of the split only"
        assert not {f["id"] for f in tr} & {f["id"] for f in te}
        seen.append(len(te))
        return {f["id"]: 0 for f in te}
    res = probe.cv(fr, fit_predict)
    assert len(res) == len(fr) and sum(seen) == len(fr), "every frame is held out exactly once"


def _setup(tmp_path, monkeypatch, n=10):
    keys = ["i%014x" % k for k in range(n)]
    images, boxes = {k: make_image(tmp_path / ("%s.png" % k)) for k in keys}, {}
    labels = tmp_path / "labels"
    labels.mkdir()
    for k in keys:
        f, g = synth3(int(k[1:], 16))
        boxes[k] = g
        label(labels, k, images[k], [{"name": "%s_%s" % (x["who"], x["part"]), "who": x["who"], "part": x["part"], "poly": [[0, 0], [1, 0], [1, 1]],
                                      "mask": rle(x["mask"]), "t_ms": 0, "source": "user"} for x in g])

    def fake_features(seed_dir, frames, emit=None, device=None, src=None):
        os.makedirs(os.path.join(seed_dir, "feats"), exist_ok=True)
        for fr in frames:
            fn = seeder.feat_file(seed_dir, fr["key"], fr["t"], seeder.HYDRA, fr.get("ign", ""))
            if not os.path.exists(fn):
                np.savez(fn, f=synth3(int(fr["key"][1:], 16))[0], grid=np.array(GRID))
        return len(frames)
    monkeypatch.setattr(seeder, "ensure_features", fake_features)
    seed = str(tmp_path / "seeder")
    return keys, images, seed, str(labels)


def test_name_groups_command_end_to_end(tmp_path, monkeypatch):
    keys, images, seed, labels = _setup(tmp_path, monkeypatch)
    assert "name_groups" in cli.COMMANDS
    ds = str(tmp_path / "seeder" / "datasets" / "v2")
    os.makedirs(ds)
    req = lambda key, ms: {"cmd": "name_groups", "image": images[keys[0]], "masks": ms, "seed": {"dir": seed, "dataset": ds, "key": key}}
    # before any Train: unknown, with the reason
    r = cli.cmd_name_groups(req(keys[0], [rle(synth3(0)[1][0]["mask"])]), lambda e: None)
    assert r["blobs"][0]["part"] == [] and "Train" in r["note"]
    rec = seeder.train(seed, (), (), labels=labels, dataset=ds, features="hydra")
    assert os.path.exists(os.path.join(seed, "namer.pt")) and os.path.exists(os.path.join(seed, "namer.json")), "v4.38: one namer for every dataset, in the seeder folder"
    assert rec["namer"]["blobs"] == 30 and rec["namer"]["score"]["top1"] > 0.8 and 0 < rec["namer"]["score"]["n"] <= 30
    f, g = synth3(0)
    r = cli.cmd_name_groups(req(keys[0], [rle(x["mask"]) for x in g]), lambda e: None)
    assert [b["part"][0]["part"] for b in r["blobs"]] == ["penis", "hips", "head"] and all(b["auto"] for b in r["blobs"])
    assert r["seen"] is True and r["model"]["blobs"] == 30, "the picture was trained on: the answer says so"
    # the owner named one blob and its character: the others are proposed with that as context
    ms = [rle(x["mask"]) for x in g]
    ms[0] = {**ms[0], "part": "penis", "who": "c2"}
    r = cli.cmd_name_groups(req(keys[0], ms), lambda e: None)
    assert r["blobs"][0]["named"] and not r["blobs"][0]["auto"] and r["blobs"][0]["who"] == "c2"
    assert all(b["who"] in ("c1", "c2") for b in r["blobs"][1:]), "propagation names the rest by the split"
    # a picture with no cached features and no GPU: unknown, not an error
    r = cli.cmd_name_groups({**req("inew", ms[:1]), "image": images[keys[1]]}, lambda e: None)
    assert r["blobs"][0]["part"] == [] and "no cached features" in r["note"]
    # whichever dataset is active (one with no head of its own): the shared namer names
    other = str(tmp_path / "seeder" / "datasets" / "v3")
    os.makedirs(other)
    r = cli.cmd_name_groups({**req(keys[0], [rle(x["mask"]) for x in g]), "seed": {"dir": seed, "dataset": other, "key": keys[0]}}, lambda e: None)
    assert [b["part"][0]["part"] for b in r["blobs"]] == ["penis", "hips", "head"]
    # no namer at all: unknown, never a guess
    os.remove(os.path.join(seed, "namer.pt"))
    r = cli.cmd_name_groups(req(keys[0], ms), lambda e: None)
    assert r["blobs"][0]["part"] == [] and r["note"]
    # an unchanged Train re-makes a missing namer without retraining the head
    rec2 = seeder.train(seed, (), (), labels=labels, dataset=ds, features="hydra")
    assert rec2["changed"] is False and autoname.Namer.load(seed, rec2["namer"]["fingerprint"]) is not None


def test_the_namer_learns_from_every_dataset_and_is_scored_held_out_by_source(tmp_path, monkeypatch):
    """v4.38: the namer trains on the union of the datasets' named groups (a picture labelled in two datasets counts in both, on ONE side of
    every split), the seeder head stays per dataset; the summary counts the auto-named labels it learned from."""
    keys, images, seed, la = _setup(tmp_path, monkeypatch, n=8)
    lb = tmp_path / "labels_b"
    lb.mkdir()
    for k in ["i%014x" % (100 + j) for j in range(6)] + [keys[0]]:   # 6 new pictures + one also labelled in a
        img = images.get(k) or make_image(tmp_path / ("%s.png" % k))
        label(lb, k, img, [{"name": "%s_%s" % (x["who"], x["part"]), "who": x["who"], "part": x["part"], "poly": [[0, 0], [1, 0], [1, 1]],
                            "mask": rle(x["mask"]), "t_ms": 0, "source": "user", **({"named_by": "auto"} if x["part"] == "hips" else {})} for x in synth3(int(k[1:], 16))[1]])
    da, ds = str(tmp_path / "seeder" / "datasets" / "a"), str(tmp_path / "seeder" / "datasets" / "b")
    os.makedirs(da)
    os.makedirs(ds)
    seeder.train(seed, (), (), labels=la, dataset=da, features="hydra")   # a was trained before: its pictures' features are cached
    rec = seeder.train(seed, (), (), labels=str(lb), dataset=ds, features="hydra", namer={"labels": {"a": la, "b": str(lb)}})
    assert rec["frames"] == 7, "the head learns from its own dataset only"
    nm = rec["namer"]
    assert nm["blobs"] == (8 + 7) * 3 and nm["images"] == 15 and nm["datasets"] == ["a", "b"]
    assert nm["auto"] == 7, "the auto-named labels it learned from (named_by auto)"
    sc = nm["score"]
    assert set(sc["by_ds"]) == {"a", "b"} and 0 < sc["n"] <= 45 and sc["top1"] > 0.8 and sc["top3"] >= sc["top1"]
    assert [p[0] for p in sc["parts"]] and sc["parts"] == sorted(sc["parts"], key=lambda z: (z[2], -z[1])), "weakest part first"
    assert autoname.Namer.load(seed).info["features"] == seeder.HYDRA
    assert json.load(open(os.path.join(seed, "namer.json"), encoding="utf-8"))["fingerprint"] == nm["fingerprint"]
    # another dataset's labels changed: an unchanged head, a new namer
    label(lb, "i%014x" % 200, make_image(tmp_path / "x.png"), [])
    (tmp_path / "labels" / ("%s.json" % keys[1])).unlink()
    rec2 = seeder.train(seed, (), (), labels=str(lb), dataset=ds, features="hydra", namer={"labels": {"a": la, "b": str(lb)}})
    assert rec2["changed"] is False and rec2["namer"]["fingerprint"] != nm["fingerprint"] and rec2["namer"]["images"] == 14


def test_the_namer_score_never_scores_a_source_it_trained_on(monkeypatch):
    fr, feats = frames_of(range(24))
    for f in fr[:6]:   # one picture in several datasets / one video with several frames
        feats[("shared", 0)] = feats[(f["key"], 0)]
        f["key"] = "shared"
    rows = autoname.region_rows([dict(f, ds="a") for f in fr], feats)
    fit = autoname._fit_rows
    seen = []

    def spy(tr, parts):
        seen.append({r[0]["key"] for r in tr})
        return fit(tr, parts)
    monkeypatch.setattr(autoname, "_fit_rows", spy)
    sc = autoname.held_out(rows, seeder.PARTS)
    assert sc["n"] == 72 and len(seen) == autoname.FOLDS
    for k, keys in enumerate(seen):
        test = {r[0]["key"] for r in rows if autoname.fold_of(r[0]["key"]) == k}
        assert keys.isdisjoint(test), "a source is on one side of the split only"
