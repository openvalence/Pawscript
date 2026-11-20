"""v4.18 learned seeder (pawtrack/seeder.py): labels from projects, the head on synthetic features, regions, C1/C2 by
appearance, seed_train / suggest_groups wiring. No models, no GPU (the tagger is mocked)."""
import json
import os

import numpy as np
import pytest

from pawtrack import cli, partlabel, seeder

GRID = (9, 16)
D = 1152


def rle(mask):
    """bool (h, w) -> the app's stored soft mask {w, h, rle} (levels 0 / 15)."""
    a = mask.reshape(-1).astype(int) * 15
    out, v, n = [], a[0], 0
    for x in a:
        if x == v:
            n += 1
        else:
            out += [int(v), n]
            v, n = x, 1
    out += [int(v), n]
    return {"w": mask.shape[1], "h": mask.shape[0], "rle": out}


def box_mask(x0, y0, x1, y1, w=320, h=180):
    m = np.zeros((h, w), bool)
    m[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)] = True
    return m


def write_proj(path, groups, key="q1-1-abc", video="v.mp4"):
    d = {"media": {"path": video, "width": 320, "height": 180, "hash": {"value": key}},
         "scenes": [{"start_ms": 0, "end_ms": 5000, "shots": [{"start_ms": 0, "end_ms": 5000}], "groups": groups}]}
    path.write_text(json.dumps(d), encoding="utf-8")
    return str(path)


def G(name, box, t=1000, **kw):
    return {"name": name, "poly": [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]], "t_ms": t,
            "mask": rle(box_mask(*box)), **kw}


def test_project_labels_keeps_painted_groups_only(tmp_path):
    p = write_proj(tmp_path / "a.pawproj", [
        G("c1_penis", (.1, .1, .3, .4), source="user"), G("c1_penis", (.1, .1, .3, .4), source="user"),  # duplicate
        G("c2_hips", (.5, .5, .8, .9)), G("c1_head", (.6, .1, .7, .2), source="tagger"),  # suggestion: not a label
        G("unassigned_1", (.4, .4, .5, .5)), G("c1_body", (0, 0, 1, 1)), G("c2_tail", (.2, .6, .3, .9), off=True),
        G("c1_hand_l", (.0, .0, .1, .1), t=2000),
        G("c1_penis", (.1, .1, .3, .4), t=3000, source="repeat"), G("c1_hips", (.1, .1, .3, .4), t=3000, source="run")])  # paw-8mf4 copies
    fr, sk = seeder.project_labels(p)
    assert [f["t"] for f in fr] == [1000, 2000] and fr[0]["key"] == "q1-1-abc"
    assert sorted((g["who"], g["part"]) for g in fr[0]["groups"]) == [("c1", "penis"), ("c2", "hips")]
    assert fr[1]["groups"][0]["part"] == "hand" and fr[0]["groups"][0]["mask"].shape == (180, 320)
    assert sk == {"dup": 1, "suggested": 1, "unassigned": 1, "other": 1, "off": 1, "copied": 2}
    # the video beside the project when the stored path is gone
    assert fr[0]["video"] == str(tmp_path / "v.mp4") or fr[0]["video"] == "v.mp4"


def test_library_and_fingerprint(tmp_path):
    (tmp_path / "sub").mkdir()
    a = write_proj(tmp_path / "a.pawproj", [G("c1_penis", (.1, .1, .3, .4))])
    write_proj(tmp_path / "sub" / "b.pawproj", [G("c1_hips", (.1, .1, .3, .4))])
    assert seeder.library([str(tmp_path)], [a, a.upper() if os.name == "nt" else a]) == [a]   # not recursive, each once
    f1 = seeder.fingerprint(seeder.gather([str(tmp_path)])[0])
    write_proj(tmp_path / "a.pawproj", [G("c1_penis", (.1, .1, .3, .45))])
    assert seeder.fingerprint(seeder.gather([str(tmp_path)])[0]) != f1
    assert seeder.gather([str(tmp_path / "nope")]) == ([], {})


def synth(seed, part_box=(4, 6, 2, 5), hips_box=(5, 9, 10, 14)):
    """Synthetic patch features: background noise, a 'penis' look in part_box rows/cols, a 'hips' look in hips_box."""
    r = np.random.default_rng(seed)
    f = r.normal(0, 1, (GRID[0], GRID[1], D)).astype(np.float32)
    a, b, c, d = part_box
    f[a:b, c:d, :8] += 6
    a, b, c, d = hips_box
    f[a:b, c:d, 8:16] += 6
    pen = np.zeros((180, 320), bool)
    pen[part_box[0] * 20:part_box[1] * 20, part_box[2] * 20:part_box[3] * 20] = True
    hips = np.zeros((180, 320), bool)
    hips[hips_box[0] * 20:hips_box[1] * 20, hips_box[2] * 20:hips_box[3] * 20] = True
    return f.reshape(-1, D).astype(np.float16), [{"part": "penis", "who": "c1", "mask": pen}, {"part": "hips", "who": "c2", "mask": hips}]


def test_head_learns_and_regions_find_the_part(tmp_path):
    data = [synth(s) for s in range(6)]
    h = seeder.Head.fit([f for f, _ in data], [seeder.targets(g, GRID) for _, g in data])
    assert h.info["steps"] == 10 and h.present[seeder.PI["penis"]] and not h.present[seeder.PI["tail"]]
    f, _ = synth(99, part_box=(1, 3, 10, 13))   # the part elsewhere on a new frame
    heat = h.heat(f, GRID)
    assert heat[1:3, 10:13, seeder.PI["penis"]].mean() > 0.5 > heat[6:9, 0:4, seeder.PI["penis"]].mean()
    assert heat[..., seeder.PI["tail"]].max() == 0   # never saw a tail
    use = np.zeros(len(seeder.PARTS), bool)
    use[seeder.PI["penis"]] = True
    reg = seeder.regions(heat, (320, 180), use)
    assert [r["part"] for r in reg] == ["penis"] and 0.6 < reg[0]["c"][0] < 0.85 and reg[0]["c"][1] < 0.35
    assert seeder.regions(heat, (320, 180), use, box=(0, 0.5, 1, 1)) == []   # peak outside the roi
    h.use = use
    h.save(str(tmp_path), {"frames": 6})
    h2 = seeder.Head.load(str(tmp_path))
    assert np.allclose(h2.heat(f, GRID), heat) and h2.info == {"frames": 6} and h2.use.tolist() == use.tolist()
    assert seeder.Head.load(str(tmp_path / "none")) is None


def test_train_uses_cached_features_and_skips_unchanged(tmp_path, monkeypatch):
    lib = tmp_path / "lib"
    lib.mkdir()
    for v in range(2):
        write_proj(lib / f"p{v}.pawproj", [G("c1_penis", (.1, .2, .25, .3), t=t) for t in (1000, 2000, 3000)], key=f"q1-{v}")
    calls = []

    def fake_features(seed_dir, frames, emit=None, device=None, src=None):  # the tagger mocked: synthetic features per frame
        calls.append(len(frames))
        os.makedirs(os.path.join(seed_dir, "feats"), exist_ok=True)
        for k, f in enumerate(frames):
            x, _ = synth(k, part_box=(4, 6, 2, 5))
            np.savez(seeder.feat_file(seed_dir, f["key"], f["t"]), f=x, grid=np.array(GRID))
        return len(frames)
    monkeypatch.setattr(seeder, "ensure_features", fake_features)
    sd = str(tmp_path / "seed")
    r = seeder.train(sd, [str(lib)])
    assert r["changed"] and r["frames"] == 6 and r["videos"] == 2 and r["parts"]["penis"] == {"labels": 6, "videos": 2, "use": True}
    assert r["parts"]["hips"]["use"] is False and os.path.exists(os.path.join(sd, "head.json"))
    again = seeder.train(sd, [str(lib)])
    assert again["changed"] is False and again["fingerprint"] == r["fingerprint"] and len(calls) == 1
    assert seeder.train(sd, [str(lib)], force=True)["changed"] and seeder.Head.load(sd).use[seeder.PI["penis"]]
    assert seeder.train(str(tmp_path / "empty"), [str(tmp_path / "nothing")])["frames"] == 0


def test_split_who_by_appearance_and_one_part_each():
    f = np.random.default_rng(0).normal(0, 1, (GRID[0] * GRID[1], D)).astype(np.float32).reshape(GRID[0], GRID[1], D)
    f[:, :8, :8] += 5    # character A's look (left half)
    f[:, 8:, 8:16] += 5  # character B's look (right half)
    f = f.reshape(-1, D)
    # A's penis reaches right into B's hips (position alone would call it B's); appearance says A
    masks = [box_mask(.05, .2, .3, .8), box_mask(.4, .4, .49, .6), box_mask(.55, .2, .95, .8), box_mask(.6, .1, .7, .3)]
    parts = ["hips", "penis", "hips", "head"]
    cen = [[(.175) * 16 / 9, .5], [(.445) * 16 / 9, .5], [(.75) * 16 / 9, .5], [(.65) * 16 / 9, .2]]
    lab = seeder.split_who(masks, parts, cen, f, GRID)
    assert lab[0] == lab[1] != lab[2] == lab[3], lab
    ref = {"c1": seeder.region_feature(f, GRID, box_mask(.55, 0, 1, 1)), "c2": seeder.region_feature(f, GRID, box_mask(0, 0, .45, 1))}
    assert seeder.name_by_refs(masks, lab, f, GRID, ref) == lab[2]   # the painted Bottom looks like the right one
    assert seeder.split_who(masks[:1], parts[:1], cen[:1], f, GRID) is None


def test_assign_who_appearance_keeps_a_solo_character_whole():
    f = np.zeros((GRID[0] * GRID[1], D), np.float32)
    sq = lambda x0, y0, x1, y1: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    solo = [{"name": "penis", "poly": sq(.4, .4, .45, .5)}, {"name": "balls", "poly": sq(.42, .5, .47, .55)}]
    out = partlabel.assign_who(solo, (), 16 / 9, feats=(f, GRID))
    assert {g["who"] for g in out} == {"c1"} and "named" not in out[0]
    # two hips close together: two characters anyway (one of each part per character)
    two = [{"name": "hips", "poly": sq(.4, .4, .5, .6)}, {"name": "hips", "poly": sq(.5, .4, .6, .6)}]
    out = partlabel.assign_who(two, (), 16 / 9, feats=(f, GRID))
    assert [g["who"] for g in out] == ["c1", "c2"] and out[0]["named"] == "left"
    # without feats: v4.17 (position only) -> one character
    assert {g["who"] for g in partlabel.assign_who(two, (), 16 / 9)} == {"c1"}


def test_suggest_uses_the_head_for_its_parts(monkeypatch):
    pen, tail = np.zeros(GRID, np.float32), np.zeros(GRID, np.float32)
    pen[4:6, 3:5], tail[1:3, 11:14] = 1.0, 1.0

    def heat(frames, probs=None, vocab=None, feats=None):
        probs.update({"penis": [0.7], "tail": [0.55]})
        feats.append((np.zeros((GRID[0] * GRID[1], D), np.float16), GRID))
        return [{"penis": pen, "tail": tail}]

    class FakeHead:
        features = seeder.HYDRA
        use = np.array([p in ("penis", "hips") for p in seeder.PARTS])

        def heat(self, f, grid):
            h = np.zeros((grid[0], grid[1], len(seeder.PARTS)), np.float32)
            h[1:3, 1:4, seeder.PI["penis"]] = 0.95   # the head puts the penis elsewhere than the CAM
            h[6:8, 8:12, seeder.PI["hips"]] = 0.6    # a weak hips: tentative
            return h
    monkeypatch.setattr(partlabel, "heat_maps", heat)
    monkeypatch.setattr(partlabel, "sam_ready", lambda: False)
    out = partlabel.suggest(np.zeros((90, 160, 3), np.uint8), shape="cam", head=FakeHead())
    by = {g["part"]: g for g in out}
    assert set(by) == {"penis", "tail", "hips"} and by["tail"]["source"] == "tagger" and by["penis"]["source"] == "seeder"
    assert max(y for _, y in by["penis"]["poly"]) < 0.4 and by["penis"]["score"] >= seeder.CONFIDENT and "tentative" not in by["penis"]
    assert by["hips"]["tentative"] and by["hips"]["outline"] == "head"
    plain = {g["part"]: g for g in partlabel.suggest(np.zeros((90, 160, 3), np.uint8), shape="cam")}
    assert set(plain) == {"penis", "tail"} and plain["penis"]["source"] == "tagger"   # no head: v4.17


def _cli_mocks(monkeypatch):
    import torch
    import pawtrack.vram as V
    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    monkeypatch.setattr(partlabel, "hydra_ready", lambda: True)
    monkeypatch.setattr(V, "cap", lambda *a: None)
    monkeypatch.setattr(cli, "_describe_module", lambda: type("M", (), {"_MODEL": object()}))


def test_suggest_groups_picks_the_best_candidate_frame(tmp_path, monkeypatch):
    import make_video as mv
    v = str(mv.make(tmp_path / "s.mp4"))
    _cli_mocks(monkeypatch)
    seen = {}
    monkeypatch.setattr(partlabel, "frame_parts", lambda frames, head=None: [{0: 2, 400: 4, 800: 4}.get(t, 1) for t, _ in frames])

    def sug(bgr, box, shape, head=None, who_split="appearance", who_ref=None, who_left="head", **kw):
        seen.update(head=head, who_split=who_split, who_left=who_left)
        return []
    monkeypatch.setattr(partlabel, "suggest", sug)
    r = cli.cmd_suggest_groups({"video": v, "t_ms": 0, "candidates": [0, 400, 800], "seed": {"dir": str(tmp_path / "none"), "key": "k"}}, lambda e: None)
    assert r["t_ms"] == 400 and r["frame"] == "best" and r["candidates"] == [{"t_ms": 0, "parts": 2}, {"t_ms": 400, "parts": 4}, {"t_ms": 800, "parts": 4}]
    assert r["seeder"] is None and seen == {"head": None, "who_split": "bodies", "who_left": "head"}
    r = cli.cmd_suggest_groups({"video": v, "t_ms": 400, "params": {"who_split": "position", "who_left": "parts"}}, lambda e: None)
    assert r["frame"] == "given" and "candidates" not in r and "seeder" not in r and seen["who_split"] == "position" and seen["who_left"] == "parts"


def test_seed_train_request_checks(tmp_path, monkeypatch):
    with pytest.raises(ValueError, match="dir"):
        cli.cmd_seed_train({"folders": []}, lambda e: None)
    with pytest.raises(ValueError, match="paths"):
        cli.cmd_seed_train({"dir": str(tmp_path), "folders": [3]}, lambda e: None)
    r = cli.cmd_seed_train({"dir": str(tmp_path / "s"), "folders": [str(tmp_path)]}, lambda e: None)
    assert r["frames"] == 0 and r["changed"] is False
    assert "seed_train" in cli.COMMANDS


def test_extra_labels_train_as_their_own_who_and_suggest_stays_two_way(tmp_path):
    p = write_proj(tmp_path / "x.pawproj", [G("c1_hips", (.1, .5, .4, .9), source="user"), G("c2_hips", (.5, .5, .8, .9), source="user"),
                                            G("x_penis", (.4, .1, .5, .3), source="user"), G("x_paws_l", (.0, .0, .1, .1), source="user"),
                                            G("x_penis2", (.6, .1, .7, .3), source="user")])
    fr, sk = seeder.project_labels(p)
    assert sorted((g["who"], g["part"]) for g in fr[0]["groups"]) == [("c1", "hips"), ("c2", "hips"), ("x", "paws"), ("x", "penis"), ("x", "penis")]
    # the reference features name Bottom / Top only: an Extra is no third reference
    feats = {(f["key"], f["t"]): (np.random.default_rng(1).random((GRID[0] * GRID[1], D)).astype(np.float32), GRID) for f in fr}
    refs = seeder.who_refs(fr, feats)
    assert set(next(iter(refs.values()))) == {"c1", "c2"}
    assert "x" not in {w for d in refs.values() for w in d}
    # Suggest never invents an Extra, whatever the picture holds
    gs = [{"name": "penis", "poly": [[.1, .1], [.2, .1], [.2, .2]]}, {"name": "hips", "poly": [[.7, .5], [.9, .5], [.9, .9]]},
          {"name": "penis", "poly": [[.7, .1], [.8, .1], [.8, .2]]}, {"name": "hips", "poly": [[.1, .5], [.3, .5], [.3, .9]]}]
    assert {g["who"] for g in partlabel.assign_who(gs)} <= {"c1", "c2"}
