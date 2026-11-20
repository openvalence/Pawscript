"""suggest_groups on a still image (PROTOCOL v4.25): the request path with a fake tagger (no GPU, no model), and the
hygiene rule: only painted / accepted (source user) groups of an image label are training data."""
import json
import sys

import numpy as np
import pytest

from pawtrack import cli, partlabel, seeder


def test_image_is_the_one_frame(tmp_path, monkeypatch):
    cv2 = pytest.importorskip("cv2")
    torch = pytest.importorskip("torch")
    img = tmp_path / "pic.png"
    cv2.imwrite(str(img), np.zeros((300, 400, 3), np.uint8))
    seen = {}
    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    monkeypatch.setattr(partlabel, "hydra_ready", lambda: True)
    monkeypatch.setattr(cli, "_describe_module", lambda: type("M", (), {"_MODEL": object()}))
    monkeypatch.setattr(cli, "probe", lambda v: pytest.fail("an image is not probed as a video"))
    def fake(bgr, roi, shape, **kw):
        seen["shape"] = bgr.shape
        return [{"name": "c1_penis", "poly": [[0.1, 0.1], [0.4, 0.1], [0.4, 0.4]], "score": 0.9, "source": "tagger"}]
    monkeypatch.setattr(partlabel, "suggest", fake)
    r = cli.cmd_suggest_groups({"image": str(img), "seed": {}}, lambda e: None)
    assert seen["shape"] == (300, 400, 3)
    assert r["frame"] == "image" and r["t_ms"] == 0 and r["frame_wh"] == [400, 300] and r["media"] == {"width": 400, "height": 300}
    assert [g["name"] for g in r["groups"]] == ["c1_penis"] and "candidates" not in r
    with pytest.raises(ValueError):
        cli.cmd_suggest_groups({"image": 5}, lambda e: None)


def test_a_suggestion_is_not_a_training_label(tmp_path):
    cv2 = pytest.importorskip("cv2")
    img = tmp_path / "pic.png"
    cv2.imwrite(str(img), np.zeros((40, 40, 3), np.uint8))
    m = {"w": 8, "h": 8, "rle": [0, 16, 16, 32]}
    def lab(key, groups):
        (tmp_path / "labels").mkdir(exist_ok=True)
        (tmp_path / "labels" / f"{key}.json").write_text(json.dumps({"image": str(img), "key": key, "w": 40, "h": 40, "groups": groups}))
    box = [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5], [0.1, 0.5]]
    g = lambda name, src, **x: {"name": name, "who": "c1", "part": name.split("_")[1], "poly": box, "mask": m, "source": src, "t_ms": 0, **x}
    lab("ia", [g("c1_penis", "user"), g("c1_hips", "seeder"), g("c1_head", "tagger")])
    lab("ib", [g("c1_hips", "seeder")])
    lab("ic", [g("c1_knot", "user", **{"from": "suggest"})])
    frames, skipped = seeder.image_labels(str(tmp_path / "labels"))
    got = {f["key"]: [x["part"] if "part" in x else x["name"] for x in f["groups"]] for f in frames}
    assert set(got) == {"ia", "ic"}, "an image with only suggestions is no label"
    assert len(got["ia"]) == 1 and len(got["ic"]) == 1, "a shown (unaccepted) suggestion is not a training group; an accepted one is"
