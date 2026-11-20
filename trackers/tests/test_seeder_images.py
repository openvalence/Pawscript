"""PROTOCOL v4.24 (paw-714j): the seeder's third label source, the app's still-image labels (<app data>/seeder/labels/<key>.json).
Generated images and label files only; the tagger is replaced by a fake feature function (no model, no GPU)."""
import json
import os

import cv2
import numpy as np

from pawtrack import cli, partlabel, seeder

from test_seeder import GRID, box_mask, rle, synth


def make_image(path, w=320, h=180):
    im = np.full((h, w, 3), 90, np.uint8)
    cv2.rectangle(im, (40, 40), (120, 120), (40, 60, 220), -1)
    assert cv2.imwrite(str(path), im)
    return str(path)


def label(labels, key, image, groups=(), none=False, w=320, h=180):
    d = {"image": image, "key": key, "w": w, "h": h, "groups": list(groups), "savedAt": 1, **({"none": True} if none else {})}
    (labels / f"{key}.json").write_text(json.dumps(d), encoding="utf-8")


def grp(name, box, **kw):
    who, part = name.split("_")[:2]
    return {"name": name, "who": who, "part": part, "poly": [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]],
            "mask": rle(box_mask(*box)), "t_ms": 0, "source": "user", **kw}


def test_image_labels_loader(tmp_path):
    labels = tmp_path / "labels"
    labels.mkdir()
    a, b, c = (make_image(tmp_path / f"{n}.png") for n in "abc")
    label(labels, "iaaaaaaaaaaaaaa", a, [grp("c1_penis", (.1, .2, .3, .5)), grp("c2_thighs_l", (.5, .5, .7, .9)), grp("c1_knot", (.4, .1, .5, .2))])
    label(labels, "ibbbbbbbbbbbbbb", b, none=True)
    label(labels, "icccccccccccccc", c, [grp("unassigned_1", (.1, .1, .2, .2)), grp("c1_body", (0, 0, 1, 1))])   # nothing usable
    label(labels, "idddddddddddddd", str(tmp_path / "gone.png"), [grp("c1_penis", (.1, .2, .3, .5))])             # the image is gone
    (labels / "ieeeeeeeeeeeeee.json").write_text("{", encoding="utf-8")
    fr, sk = seeder.image_labels(str(labels))
    assert [f["key"] for f in fr] == ["iaaaaaaaaaaaaaa", "ibbbbbbbbbbbbbb"] and all(f["image"] and f["t"] == 0 for f in fr)
    assert sorted((g["who"], g["part"]) for g in fr[0]["groups"]) == [("c1", "knot"), ("c1", "penis"), ("c2", "thighs")]
    assert fr[0]["groups"][0]["mask"].shape == (180, 320) and fr[0]["video"] == a and fr[0]["W"] == 320
    assert fr[1]["groups"] == [], "'nothing to label here' is a frame with no parts: every patch a negative"
    assert sk["none"] == 1 and sk["missing"] == 1 and sk["broken"] == 1 and sk["no_parts"] == 1 and sk["unassigned"] == 1 and sk["other"] == 1
    assert seeder.image_labels(str(tmp_path / "no-such"))[0] == [] and seeder.image_labels(None)[0] == []


def test_the_fingerprint_follows_the_image_labels_and_the_part_list(tmp_path):
    labels = tmp_path / "labels"
    labels.mkdir()
    a = make_image(tmp_path / "a.png")
    label(labels, "iaaaaaaaaaaaaaa", a, [grp("c1_penis", (.1, .2, .3, .5))])
    fp = lambda: seeder.fingerprint(seeder.gather((), (), str(labels))[0])
    f0 = fp()
    assert fp() == f0 and f0 != seeder.fingerprint([])
    label(labels, "iaaaaaaaaaaaaaa", a, [grp("c1_penis", (.1, .2, .3, .55))])
    f1 = fp()
    assert f1 != f0, "a repainted label changes it"
    label(labels, "iaaaaaaaaaaaaaa", a, [grp("c1_hips", (.1, .2, .3, .55))])
    assert fp() != f1, "a renamed part changes it"
    label(labels, "ibbbbbbbbbbbbbb", a, none=True)
    f2 = fp()
    os.remove(labels / "ibbbbbbbbbbbbbb.json")
    assert fp() != f2, "a 'nothing here' image counts"
    # the part list is in the fingerprint: a head with another list is stale (Head.load) and the next train retrains
    import hashlib
    old = hashlib.sha1(("v%s|%s|%s|%s" % (seeder.VERSION, seeder.HIDDEN, seeder.EPOCHS, ",".join(seeder.PARTS[:9]))).encode()).hexdigest()
    assert seeder.fingerprint([]) != old


def test_train_takes_the_image_frames_as_sources(tmp_path, monkeypatch):
    labels = tmp_path / "labels"
    labels.mkdir()
    imgs = [make_image(tmp_path / f"i{k}.png") for k in range(7)]
    for k, im in enumerate(imgs[:6]):   # six painted images, each its own source
        label(labels, f"i{k:014x}", im, [grp("c1_knot", (.1, .2, .3, .4)), grp("c1_tongue", (.5, .5, .6, .6))] if k < 5 else [grp("c1_knot", (.1, .2, .3, .4))])
    label(labels, f"i{6:014x}", imgs[6], none=True)
    seen = []

    def fake_features(seed_dir, frames, emit=None, device=None, src=None):   # the tagger mocked; the frames it is asked for are recorded
        seen.extend(frames)
        os.makedirs(os.path.join(seed_dir, "feats"), exist_ok=True)
        for k, f in enumerate(frames):
            x, _ = synth(k)
            np.savez(seeder.feat_file(seed_dir, f["key"], f["t"]), f=x, grid=np.array(GRID))
        return len(frames)
    monkeypatch.setattr(seeder, "ensure_features", fake_features)
    sd = str(tmp_path / "seed")
    r = seeder.train(sd, (), (), labels=str(labels))
    assert r["changed"] and r["frames"] == 7 and r["videos"] == 7 and r["images"] == 7 and r["negatives"] == 1
    assert {f["key"] for f in seen} == {f"i{k:014x}" for k in range(7)} and all(f.get("image") for f in seen), "the image frames reach the feature step"
    assert r["parts"]["knot"] == {"labels": 6, "videos": 6, "use": True}, "6 examples from 6 sources: usable"
    assert r["parts"]["tongue"]["labels"] == 5 and r["parts"]["tongue"]["use"] is True
    assert r["parts"]["thighs"]["use"] is False, "a part nobody painted is simply absent"
    assert seeder.train(sd, (), (), labels=str(labels))["changed"] is False, "unchanged labels: a no-op"
    label(labels, f"i{6:014x}", imgs[6], [grp("c1_knot", (.2, .2, .3, .3))])
    assert seeder.train(sd, (), (), labels=str(labels))["changed"] is True, "a changed label retrains"
    # a head file whose part list does not match its weights is stale, never a crash (paw-5r1: a real older list is widened: test_limb_parts.py)
    import torch
    fn = os.path.join(sd, "head.pt")
    d = torch.load(fn, map_location="cpu", weights_only=False)
    d["parts"] = d["parts"][:9]
    torch.save(d, fn)
    os.utime(fn, (1, 2_000_000_000))
    assert seeder.Head.load(sd) is None
    assert seeder.train(sd, (), (), labels=str(labels))["changed"] is True


def test_read_image_and_cli_request(tmp_path, monkeypatch):
    big = make_image(tmp_path / "wide.png", 2400, 1000)
    assert seeder.read_image(big, 1920).shape[:2] == (800, 1920) and seeder.read_image(big).shape[:2] == (1000, 2400)
    try:
        seeder.read_image(str(tmp_path / "nope.png"))
        raise AssertionError("no error")
    except ValueError:
        pass
    labels = tmp_path / "labels"
    labels.mkdir()
    label(labels, "i" + "0" * 14, make_image(tmp_path / "a.png"), [grp("c1_knot", (.1, .1, .3, .3))])
    got = {}
    monkeypatch.setattr(seeder, "train", lambda d, f, p, emit, force=False, labels=None, features="auto": got.update(labels=labels, d=d) or {"frames": 1})
    monkeypatch.setattr(seeder, "gather", lambda f, p, labels=None: ([], {}))
    cli.cmd_seed_train({"cmd": "seed_train", "dir": str(tmp_path / "s"), "folders": [], "labels": str(labels)}, lambda e: None)
    assert got["labels"] == str(labels)
    try:
        cli.cmd_seed_train({"cmd": "seed_train", "dir": "d", "labels": 3}, lambda e: None)
        raise AssertionError("no error")
    except ValueError:
        pass
