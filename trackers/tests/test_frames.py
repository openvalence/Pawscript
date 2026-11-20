"""frames: exact frames by time, contact sheets, gold guard."""
import base64

import cv2
import numpy as np
import pytest

import make_video as mv
from pawtrack import frames
from pawtrack.video import open_frames


@pytest.fixture(scope="module")
def video(tmp_path_factory):
    return str(mv.make(tmp_path_factory.mktemp("f") / "syn.mp4"))


def test_grab_nearest_at_or_before(video):
    _, it = open_frames(video)
    ref = dict(it)
    ts = sorted(ref)
    want = [0, 50, 1000, 3333, 9990, 2000, 50]  # unsorted, repeated, between frames, near the end
    got = frames.grab(video, want)
    for t, img in zip(want, got):
        exp = ref[max(x for x in ts if x <= t)]
        assert np.abs(img.astype(int) - exp.astype(int)).mean() < 1.0, t


def test_sheet_dest_and_b64(video, tmp_path):
    dest = tmp_path / "req" / "a" / "sheet.jpg"
    res = frames.cmd_frames({"video": video, "jobs": [
        {"dest": str(dest), "t0": 0, "t1": 3000, "step_ms": 500, "cols": 3, "height": 100, "grid": 0.1,
         "labels": "time+pos", "pos": [0, 10, 20, 30, 40, 50],
         "overlay": [{"t_ms": 500, "points": [[0.5, 0.5]], "boxes": [[0.4, 0.4, 0.2, 0.2]]}]},
        {"dest": None, "times_ms": [1000, 4000], "labels": "AB", "crop": {"x": 0.25, "y": 0.25, "w": 0.5, "h": 0.5},
         "height": 120}]}, lambda e: None)
    a, b = res["images"]
    assert dest.exists() and not dest.with_name("sheet.jpg.tmp").exists() and a["b64"] is None
    img = cv2.imread(str(dest))
    assert img.shape[:2] == (a["h"], a["w"]) and len(a["tiles"]) == 6
    assert a["tiles"][4]["x"] == a["tiles"][1]["x"] and a["tiles"][3]["y"] == a["tiles"][0]["y"] + 102
    assert a["tiles"][1]["label"] == "0:00.5 pos 10"
    assert [t["label"] for t in b["tiles"]] == ["A", "B"] and b["dest"] is None
    im = cv2.imdecode(np.frombuffer(base64.b64decode(b["b64"]), np.uint8), cv2.IMREAD_COLOR)
    assert im.shape[:2] == (b["h"], b["w"]) and b["tiles"][0]["w"] == round(120 * (0.5 * 640) / (0.5 * 360))


def test_gold_guard():
    with pytest.raises(ValueError, match="gold-set video"):
        frames.cmd_frames({"video": r"C:\x\Reference\set\a.mp4", "jobs": [{"times_ms": [0]}]}, lambda e: None)
    assert frames.is_gold("C:/a/reference/b.mp4") and not frames.is_gold("C:/a/References/b.mp4")
