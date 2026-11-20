"""PROTOCOL v4.31 (paw-855t): ignore regions (an inset crop of another angle) in the seeder's labels, targets, features, held-out score and
Suggest. Generated images and label files only; the backbone is replaced by a fake feature function (no model, no GPU)."""
import json
import os
from contextlib import contextmanager

import cv2
import numpy as np

from pawtrack import seedscore, seeder

from test_seeder import GRID, G, box_mask, rle, synth, write_proj
from test_seeder_images import grp, label, make_image


def ign(box):
    return rle(box_mask(*box))


def test_image_label_ignore_part_wins_inside_its_mask_and_the_rest_stays_ignored(tmp_path):
    labels = tmp_path / "labels"
    labels.mkdir()
    im = make_image(tmp_path / "a.png")
    # the inset in the right third; a knot painted inside it
    d = {"image": im, "key": "iaaaaaaaaaaaaaa", "w": 320, "h": 180, "savedAt": 1, "groups": [grp("c1_knot", (.7, .2, .8, .4))], "ignore": [ign((.6, .1, 1, .9))]}
    (labels / "iaaaaaaaaaaaaaa.json").write_text(json.dumps(d), encoding="utf-8")
    fr, _ = seeder.image_labels(str(labels))
    f = fr[0]
    u = f["ign_mask"]
    assert u.shape == (180, 320) and f["ign"] and len(f["ign"]) == 10
    assert not u[int(.3 * 180), int(.75 * 320)], "the part wins inside its own mask"
    assert u[int(.6 * 180), int(.9 * 320)] and not u[int(.5 * 180), int(.3 * 320)], "the rest of the region stays ignored, nothing outside it"
    assert [g["part"] for g in f["groups"]] == ["knot"], "an ignore region is never a part"
    # an ignore region wholly under a part is no region; no ignore list: no keys at all (old labels are untouched)
    d["ignore"] = [ign((.7, .2, .8, .4))]
    (labels / "iaaaaaaaaaaaaaa.json").write_text(json.dumps(d), encoding="utf-8")
    assert "ign" not in seeder.image_labels(str(labels))[0][0]
    del d["ignore"]
    (labels / "iaaaaaaaaaaaaaa.json").write_text(json.dumps(d), encoding="utf-8")
    assert "ign_mask" not in seeder.image_labels(str(labels))[0][0]


def test_project_scene_groups_named_ignore_are_regions_not_parts(tmp_path):
    p = write_proj(tmp_path / "a.pawproj", [G("c1_penis", (.1, .1, .3, .4), source="user"), G("ignore", (.6, .1, 1, .9), source="user"),
                                            G("ignore2", (.0, .8, .2, 1), source="user"), G("ignore3", (.4, .4, .5, .5), source="user", off=True)])
    fr, sk = seeder.project_labels(p)
    assert [g["part"] for g in fr[0]["groups"]] == ["penis"] and sk == {}, "not counted as 'other'"
    u = fr[0]["ign_mask"]
    assert u[int(.5 * 180), int(.8 * 320)] and u[int(.9 * 180), int(.1 * 320)] and not u[int(.45 * 180), int(.45 * 320)], "two regions, the hidden one left out"
    f2 = seeder.fingerprint(fr)
    p = write_proj(tmp_path / "a.pawproj", [G("c1_penis", (.1, .1, .3, .4), source="user")])
    fr0, _ = seeder.project_labels(p)
    assert seeder.fingerprint(fr0) != f2, "a region changes the fingerprint"


def test_targets_give_ignored_patches_no_target_at_all():
    pen = box_mask(.1, .2, .3, .5)
    groups = [{"part": "penis", "who": "c1", "mask": pen}]
    base = seeder.targets(groups, GRID).reshape(GRID[0], GRID[1], -1)
    u = box_mask(.5, .1, 1, .9)   # the inset
    Y = seeder.targets(groups, GRID, u).reshape(GRID[0], GRID[1], -1)
    inside = Y[2:7, 11:15]        # well inside the inset
    assert (inside == -1).all() and (base[2:7, 11:15] == 0).all(), "a negative before, no target for any part now"
    assert (Y[:, :6] == base[:, :6]).all() and (Y[0:3, 3:5] == base[0:3, 3:5]).all(), "outside it nothing changes"
    # a part painted inside the region stays a positive (its own channel only); the other parts' targets on those patches go
    both = seeder.targets([{"part": "knot", "who": "c1", "mask": box_mask(.7, .2, .8, .4)}], GRID, u).reshape(GRID[0], GRID[1], -1)
    k = seeder.PI["knot"]
    pos = both[..., k] == 1
    assert pos[2:4, 11:13].any(), "the knot painted inside the inset is a positive"
    assert (both[pos][:, k] == 1).all() and ((both[pos] == 1).sum(1) == 1).all()
    assert not np.any((both[2:7, 11:15] == 0)), "no negative of any part anywhere in the region"
    # the loss weight is (target >= 0): ignored patches weigh exactly 0 (Head.fit)
    assert ((inside >= 0).astype(float) == 0).all()
    assert seeder.targets(groups, GRID, None).tolist() == seeder.targets(groups, GRID).tolist()
    assert seeder.targets(groups, GRID, np.zeros_like(u)).tolist() == seeder.targets(groups, GRID).tolist()


def test_the_cache_name_and_the_fingerprint_follow_the_mask(tmp_path):
    a, b = box_mask(.6, .1, 1, .9), box_mask(.6, .1, 1, .8)
    f = {"key": "k", "t": 0, "W": 320, "H": 180, "groups": [{"part": "knot", "who": "c1", "mask": box_mask(.1, .1, .2, .2)}], "image": True}
    fa, fb = seeder.with_ignore(f, [a]), seeder.with_ignore(f, [b])
    assert fa["ign"] != fb["ign"]
    names = {seeder.feat_file("S", "k", 0, seeder.HYDRA, x) for x in ("", fa["ign"], fb["ign"])}
    assert len(names) == 3 and seeder.feat_file("S", "k", 0) == seeder.feat_file("S", "k", 0, seeder.HYDRA, ""), "no region: the name every old cache has"
    assert len({seeder.fingerprint([x]) for x in (f, fa, fb)}) == 3
    assert seeder.with_ignore(f, []) is f and seeder.with_ignore(f, None) is f


def test_features_are_taken_from_the_blanked_picture(tmp_path, monkeypatch):
    img = np.full((180, 320, 3), (30, 90, 200), np.uint8)   # a flat orange picture ...
    img[:, 200:] = (250, 250, 250)                          # ... with a white inset on the right
    path = tmp_path / "p.png"
    cv2.imwrite(str(path), img)
    f = seeder.with_ignore({"key": "kk", "t": 0, "W": 320, "H": 180, "video": str(path), "image": True, "groups": [{"part": "knot", "who": "c1", "mask": box_mask(.05, .1, .2, .3)}]},
                           [box_mask(200 / 320, 0, 1, 1)])
    seen = []

    @contextmanager
    def fake_extractor(src, emit, total, device=None):
        def feat(bgr):
            seen.append(bgr.copy())
            return np.zeros((GRID[0] * GRID[1], 8), np.float16), GRID
        yield feat
    monkeypatch.setattr(seeder, "_extractor", fake_extractor)
    sd = str(tmp_path / "seed")
    assert seeder.ensure_features(sd, [f]) == 1
    got = seen[0]
    assert got.shape == img.shape and (got[:, 205:] == (30, 90, 200)).all(), "the inset is the colour of the rest of the picture: nothing of it reaches the backbone"
    assert (got[:, :195] == img[:, :195]).all()
    assert os.path.exists(seeder.feat_file(sd, "kk", 0, seeder.HYDRA, f["ign"])) and not os.path.exists(seeder.feat_file(sd, "kk", 0))
    assert seeder.ensure_features(sd, [f]) == 0, "cached by the mask"
    base = {k: v for k, v in f.items() if k not in ("ign", "ign_mask")}
    f2 = seeder.with_ignore(base, [box_mask(150 / 320, 0, 1, 1)])
    assert seeder.ensure_features(sd, [f2]) == 1, "another mask: new features"


def test_mean_fill_makes_a_weaker_edge_than_black():
    rng = np.random.default_rng(1)
    img = np.clip(rng.normal(150, 25, (180, 320, 3)), 0, 255).astype(np.uint8)   # a bright, textured picture
    m = box_mask(.55, .1, .95, .9)
    ring = cv2.dilate(m.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool) & ~cv2.erode(m.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)

    def edge(a):
        g = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY).astype(float)
        gx, gy = cv2.Sobel(g, cv2.CV_64F, 1, 0), cv2.Sobel(g, cv2.CV_64F, 0, 1)
        return np.hypot(gx, gy)[ring].mean()
    black = img.copy()
    black[m] = 0
    mean_fill = seeder.blank(img, m)
    assert edge(mean_fill) < 0.4 * edge(black), "the mean colour sits in the picture's own range: a fraction of black's edge"
    assert (mean_fill[m] == mean_fill[m][0]).all() and abs(float(mean_fill[m][0].mean()) - float(img[~m].mean())) < 1.5
    assert seeder.blank(img, None) is img and seeder.blank(img, np.zeros_like(m)) is img


def test_a_blob_centred_in_an_ignored_area_is_not_an_extra():
    u = box_mask(.6, 0, 1, 1)
    painted = {"id": "a", "src": "a", "W": 320, "H": 180, "groups": [{"part": "knot", "mask": box_mask(.1, .1, .3, .3)}]}
    blob = lambda part, x, y: {"part": part, "mask": box_mask(x - .05, y - .05, x + .05, y + .05), "c": (x, y)}
    preds = {"a": [blob("knot", .2, .2), blob("hips", .8, .5), blob("knot", .85, .3)]}
    _, fr = seedscore.evaluate(preds, [painted])
    assert fr[0]["extra"] == 2 and fr[0]["blobs"] == 3, "without a region the two blobs on the inset are extras"
    _, fr = seedscore.evaluate(preds, [{**painted, "ign_mask": u}])
    assert fr[0]["extra"] == 0 and fr[0]["blobs"] == 1, "centred in the ignored area: nobody's"
    _, fr = seedscore.evaluate({"a": [blob("hips", .5, .5)]}, [{**painted, "ign_mask": u}])
    assert fr[0]["extra"] == 1, "a blob outside it still counts"


def test_suggest_helpers_blank_and_drop_inside_the_region():
    u = box_mask(.5, 0, 1, 1)
    masks = [ign((.5, 0, 1, 1))]
    r = seeder.request_ignore(masks)
    assert r.shape == (180, 320) and r[90, 250] and not r[90, 100]
    assert seeder.request_ignore([{"rle": "x"}, {}, None]) is None and seeder.request_ignore(None) is None
    sq = lambda x0, y0, x1, y1: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    groups = [{"name": "a", "poly": sq(.1, .1, .3, .3)}, {"name": "b", "poly": sq(.6, .1, .9, .4)}, {"name": "c", "poly": sq(.4, .1, .7, .4)}]
    assert [g["name"] for g in seeder.drop_ignored(groups, r)] == ["a"], "b's centre (.75) and c's (.55) are inside"
    assert [g["name"] for g in seeder.drop_ignored(groups, None)] == ["a", "b", "c"]
    assert seeder.inside(u, (.9, .5)) and not seeder.inside(u, (.1, .5)) and not seeder.inside(None, (.9, .5))


def test_train_with_an_ignore_region_matches_a_clean_run_elsewhere(tmp_path, monkeypatch):
    labels = tmp_path / "labels"
    labels.mkdir()
    imgs = [make_image(tmp_path / f"i{k}.png") for k in range(6)]
    for k, im in enumerate(imgs):
        d = {"image": im, "key": f"i{k:014x}", "w": 320, "h": 180, "savedAt": 1, "groups": [grp("c1_knot", (.1, .2, .3, .4))], "ignore": [ign((.6, .1, 1, .9))] if k < 3 else []}
        (labels / f"i{k:014x}.json").write_text(json.dumps(d), encoding="utf-8")
    asked = []

    def fake_features(seed_dir, frames, emit=None, device=None, src=None):
        os.makedirs(os.path.join(seed_dir, "feats"), exist_ok=True)
        frames = [f for f in frames if not os.path.exists(seeder.feat_file(seed_dir, f["key"], f["t"], seeder.HYDRA, f.get("ign", "")))]   # as the real one: only what is not cached
        for k, f in enumerate(frames):
            asked.append((f["key"], f.get("ign", "")))
            x, _ = synth(k)
            np.savez(seeder.feat_file(seed_dir, f["key"], f["t"], seeder.HYDRA, f.get("ign", "")), f=x, grid=np.array(GRID))
        return len(frames)
    monkeypatch.setattr(seeder, "ensure_features", fake_features)
    sd = str(tmp_path / "seed")
    r = seeder.train(sd, (), (), labels=str(labels))
    assert r["changed"] and r["frames"] == 6 and sum(1 for _, i in asked if i) == 3 and sum(1 for _, i in asked if not i) == 3
    assert seeder.train(sd, (), (), labels=str(labels))["changed"] is False
    d = json.loads((labels / f"i{0:014x}.json").read_text())
    d["ignore"] = [ign((.5, .1, 1, .9))]
    (labels / f"i{0:014x}.json").write_text(json.dumps(d), encoding="utf-8")
    asked.clear()
    assert seeder.train(sd, (), (), labels=str(labels))["changed"] is True and len(asked) == 1, "a changed region: retrained, new features for that one image only"
