"""PROTOCOL v4.32 (paw-855t): label DATASETS. Each has its own labels folder, head, score and trend; feature caches are shared (per picture);
the comparison scores every head on the active dataset's labels without ever scoring a head on a picture it trained on. Generated images and
label files; the backbone is a fake feature function (no model, no GPU)."""
import json
import os

import numpy as np

from pawtrack import cli, seeder

from test_seeder import GRID, synth
from test_seeder_images import grp, label, make_image

BOX = (0.125, 0.444, 0.3125, 0.667)   # where synth() puts its "penis" look (rows 4-6, cols 2-5 of the 9 x 16 grid)


def mk(tmp, name, keys, images):
    d = tmp / "seeder" / "datasets" / name
    (d / "labels").mkdir(parents=True)
    for k in keys:
        label(d / "labels", k, images[k], [grp("c1_penis", BOX)])
    return str(d)


def setup(tmp_path, monkeypatch):
    keys = [f"i{k:014x}" for k in range(10)]
    images = {k: make_image(tmp_path / f"{k}.png") for k in keys}
    calls = []

    def fake_features(seed_dir, frames, emit=None, device=None, src=None):   # shared caches: only what is not there yet
        os.makedirs(os.path.join(seed_dir, "feats"), exist_ok=True)
        for f in frames:
            fn = seeder.feat_file(seed_dir, f["key"], f["t"], seeder.HYDRA, f.get("ign", ""))
            if not os.path.exists(fn):
                calls.append(f["key"])
                np.savez(fn, f=synth(int(f["key"][1:], 16))[0], grid=np.array(GRID))
        return len(frames)
    monkeypatch.setattr(seeder, "ensure_features", fake_features)
    return keys, images, calls


def test_datasets_keep_their_own_labels_head_and_score_and_share_the_features(tmp_path, monkeypatch):
    keys, images, calls = setup(tmp_path, monkeypatch)
    seed = str(tmp_path / "seeder")
    a, b = mk(tmp_path, "v1", keys[:8], images), mk(tmp_path, "v2", keys[4:10], images)
    ra = seeder.train(seed, (), (), labels=os.path.join(a, "labels"), dataset=a)
    rb = seeder.train(seed, (), (), labels=os.path.join(b, "labels"), dataset=b)
    assert ra["frames"] == 8 and rb["frames"] == 6
    for d in (a, b):
        assert all(os.path.exists(os.path.join(d, f)) for f in ("head.pt", "head.json", "score.json")), d
    assert not os.path.exists(os.path.join(seed, "head.pt")), "the shared folder holds no head"
    assert sorted(json.load(open(os.path.join(a, "head.json")))["trained_on"]) == sorted(f"{k}_0" for k in keys[:8])
    assert json.load(open(os.path.join(b, "head.json")))["frames"] == 6
    assert seeder.Head.load(a).info["frames"] == 8 and seeder.Head.load(b).info["frames"] == 6
    assert len(calls) == 10 and set(calls) == set(keys), "a picture in both datasets has its features made once"
    assert seeder.train(seed, (), (), labels=os.path.join(a, "labels"), dataset=a)["changed"] is False, "an unchanged dataset is a no-op"
    label(__import__("pathlib").Path(b) / "labels", keys[9], images[keys[9]], [grp("c1_penis", (.1, .1, .2, .2))])
    assert seeder.train(seed, (), (), labels=os.path.join(b, "labels"), dataset=b)["changed"] is True
    assert seeder.Head.load(a).info["fingerprint"] == ra["fingerprint"], "retraining v2 left v1's head alone"
    s1, s2 = json.load(open(os.path.join(a, "score.json"))), json.load(open(os.path.join(b, "score.json")))
    assert s1["latest"]["frames"] == 8 and s2["latest"]["frames"] == 6 and len(s2["history"]) == 2 and len(s1["history"]) == 1, "each its own trend"


def test_the_include_projects_flag_is_the_callers_folders(tmp_path):
    from test_seeder import G, write_proj
    p = write_proj(tmp_path / "a.pawproj", [G("c1_penis", (.1, .1, .3, .4), source="user")])
    assert len(seeder.gather([str(tmp_path)], (), None)[0]) == 1, "projects on (v1): the library folders are read"
    assert seeder.gather([], (), None)[0] == [], "projects off (a new dataset): no folders, only its image labels"
    assert p


def test_cli_seed_train_takes_the_dataset(tmp_path, monkeypatch):
    got = {}
    monkeypatch.setattr(seeder, "train", lambda d, f, p, emit, force=False, labels=None, features="auto", dataset=None: got.update(d=d, ds=dataset) or {"frames": 1})
    monkeypatch.setattr(seeder, "gather", lambda f, p, labels=None: ([], {}))
    cli.cmd_seed_train({"dir": str(tmp_path), "folders": [], "dataset": str(tmp_path / "datasets" / "v2")}, lambda e: None)
    assert got["ds"].endswith("v2") and got["d"] == str(tmp_path)
    try:
        cli.cmd_seed_train({"dir": str(tmp_path), "dataset": 3}, lambda e: None)
        raise AssertionError("no error")
    except ValueError:
        pass
    assert "seed_compare" in cli.COMMANDS


def test_cross_score_never_scores_a_head_on_pictures_it_trained_on(tmp_path, monkeypatch):
    from pawtrack import seedcompare
    keys, images, calls = setup(tmp_path, monkeypatch)
    seed = str(tmp_path / "seeder")
    new, old = mk(tmp_path, "v2", keys[:8], images), mk(tmp_path, "v1", keys[4:10] + keys[:2], images)   # v1 trained on 4..9 and 0, 1
    for d in (new, old):
        seeder.train(seed, (), (), labels=os.path.join(d, "labels"), dataset=d)
    req = {"dir": seed, "active": "v2", "datasets": [{"id": "v1", "name": "v1", "dir": old, "labels": os.path.join(old, "labels"), "projects": False},
                                                     {"id": "v2", "name": "v2", "dir": new, "labels": os.path.join(new, "labels"), "projects": False}]}
    r = seedcompare.compare(req)
    assert r["common"] == ["penis"] and r["frames"] == 8
    by = {x["id"]: x for x in r["rows"]}
    assert by["v2"]["own"] and by["v2"]["how"] == "held-out" and by["v2"]["found"] is not None, "the active head: its grouped held-out score"
    v1 = by["v1"]
    assert not v1["own"] and v1["how"] == "never saw"
    assert v1["n_frames"] == 2 and v1["excluded"] == 6, "v2's labels are pictures 0..7; v1 trained on 0, 1, 4..7: only 2 and 3 were never seen"
    assert v1["found"] is not None and 0 <= v1["found"] <= 1
    assert os.path.exists(os.path.join(new, "cross.json"))
    assert seedcompare.compare(req) == r, "cached by the fingerprint: the same answer"
    # a changed label of the active dataset changes the fingerprint (recomputed)
    label(__import__("pathlib").Path(new) / "labels", keys[7], images[keys[7]], [grp("c1_penis", (.2, .2, .3, .3))])
    assert seedcompare.compare(req)["fingerprint"] != r["fingerprint"]
    # fewer than two trained datasets: a plain note, no rows
    one = seedcompare.compare({**req, "datasets": req["datasets"][1:]})
    assert one["rows"] == [] and "fewer than two" in one["note"]
