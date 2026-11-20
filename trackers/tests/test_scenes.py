"""Scene detector (pawtrack/scenes.py) on synthetic 160 px clips: hard cut, fade out / in through black, dissolve,
flash, still, a fast pan, and the same on twos. CPU only, no video files."""
import numpy as np
import pytest
import cv2

from pawtrack.registry import coerce
from pawtrack.scenes import SCENE_PARAMS, CutDetector

W, H, FPS = 160, 90, 30
DT = 1000 / FPS


def texture(seed, tint):
    rng = np.random.default_rng(seed)
    tex = cv2.GaussianBlur(rng.integers(0, 256, (H * 2, W * 2, 3), dtype=np.uint8), (0, 0), 5).astype(np.float32)
    return tex * 0.6 + np.array(tint, np.float32) * 0.4


A, B = texture(1, (200, 120, 60)), texture(2, (30, 60, 220))


def shot(bg, i, moving=True):
    """A frame of a shot: a crop of bg drifting slowly (1 px / 4 frames), a bright disk bobbing (the action)."""
    k = i % 160 if moving else 0
    img = bg[20 + k // 8:20 + k // 8 + H, 30 + k // 4:30 + k // 4 + W].copy()
    if moving:
        y = int(45 + 15 * np.sin(2 * np.pi * i / 24))
        cv2.circle(img, (80, y), 12, (250, 250, 250), -1)
    return img


def run(frames, twos=False, **params):
    p = coerce(SCENE_PARAMS, params)
    det = CutDetector(p)
    rng = np.random.default_rng(0)
    for i, f in enumerate(frames):
        if twos and i % 2:
            f = frames[i - 1]
        det(round(i * DT), np.clip(f + rng.normal(0, 1, f.shape), 0, 255).astype(np.uint8))
    out = det.finish(0, round(len(frames) * DT))
    return out, det.found


def starts(sc):
    return [s["start_ms"] for s in sc[1:]]


def ms(i):
    return round(i * DT)


@pytest.mark.parametrize("twos", [False, True])
def test_hard_cut(twos):
    sc, found = run([shot(A, i) for i in range(60)] + [shot(B, i) for i in range(60)], twos)
    assert starts(sc) == [ms(60)]
    assert sc[0]["transition"] == {"in": None, "out": "cut"} and sc[1]["transition"] == {"in": "cut", "out": None}
    assert all(s["kind"] is None for s in sc)


@pytest.mark.parametrize("twos", [False, True])
def test_fade_through_black(twos):
    fr = [shot(A, i) for i in range(60)]
    fr += [shot(A, 60 + k) * (1 - (k + 1) / 18) for k in range(18)]       # fade out: 60..77, 77 is black
    fr += [np.zeros((H, W, 3), np.float32)] * 15                          # black 78..92
    fr += [shot(B, k) * ((k + 1) / 18) for k in range(18)]                # fade in: 93..110, 110 full
    fr += [shot(B, 18 + k) for k in range(60)]
    sc, found = run(fr, twos)
    assert [s["kind"] for s in sc] == [None, "blank", None]
    a, b = sc[1]["start_ms"], sc[2]["start_ms"]
    assert abs(a - ms(60)) <= DT * (1 + twos) and abs(b - ms(110)) <= DT * (1 + twos)
    assert sc[0]["transition"]["out"] == "fade" and sc[1]["transition"]["in"] == "fade"
    assert sc[1]["transition"]["out"] == "fade" and sc[2]["transition"]["in"] == "fade"
    assert 300 <= sc[1]["transition"]["in_ms"] <= 650 and sc[0]["transition"]["out_ms"] == sc[1]["transition"]["in_ms"]
    assert found["blank"] == 1 and found["fade"] == 2


def test_hard_cut_to_black_has_no_fade():
    fr = [shot(A, i) for i in range(60)] + [np.zeros((H, W, 3), np.float32)] * 10 + [shot(B, i) for i in range(60)]
    sc, found = run(fr)
    assert starts(sc) == [ms(60), ms(70)] and [s["kind"] for s in sc] == [None, "blank", None]
    assert sc[1]["transition"] == {"in": "cut", "out": "cut"} and found["fade"] == 0


def test_short_black_is_not_blank():
    fr = [shot(A, i) for i in range(60)] + [np.zeros((H, W, 3), np.float32)] * 3 + [shot(B, i) for i in range(60)]
    sc, found = run(fr)
    assert all(s["kind"] is None for s in sc) and found["blank"] == 0 and len(sc) == 2


@pytest.mark.parametrize("twos", [False, True])
def test_dissolve(twos):
    fr = [shot(A, i) for i in range(60)]
    fr += [shot(A, 60 + k) * (1 - (k + 1) / 19) + shot(B, k) * ((k + 1) / 19) for k in range(18)]  # 60..77
    fr += [shot(B, 18 + k) for k in range(60)]
    sc, found = run(fr, twos)
    assert len(sc) == 2 and found["dissolve"] == 1
    assert abs(sc[1]["start_ms"] - ms(69)) <= 2 * DT
    assert sc[0]["transition"]["out"] == "dissolve" and sc[1]["transition"]["in"] == "dissolve"
    assert 400 <= sc[1]["transition"]["in_ms"] <= 800


def test_dissolve_off_is_today():
    fr = [shot(A, i) for i in range(60)]
    fr += [shot(A, 60 + k) * (1 - (k + 1) / 19) + shot(B, k) * ((k + 1) / 19) for k in range(18)]
    fr += [shot(B, 18 + k) for k in range(60)]
    sc, _ = run(fr, cut_dissolve=False)
    assert len(sc) == 1


def test_flash_is_no_cut():
    fr = [shot(A, i) for i in range(120)]
    fr[60] = np.full((H, W, 3), 255, np.float32)
    sc, found = run(fr, cut_min_scene_ms=0)
    assert len(sc) == 1 and found["flash"] == 1
    fr[61] = fr[60]  # two frames at 30 fps = 67 ms: still a flash
    sc, found = run(fr, cut_min_scene_ms=0)
    assert len(sc) == 1 and found["flash"] == 1


def test_still_title_card_between_cuts():
    fr = [shot(A, i) for i in range(60)] + [shot(B, 0, moving=False)] * 75 + [shot(A, i) for i in range(60)]
    sc, found = run(fr)
    assert starts(sc) == [ms(60), ms(135)] and [s["kind"] for s in sc] == [None, "still", None]


def test_frozen_start_splits_off():
    fr = [shot(A, 0)] * 75 + [shot(A, i) for i in range(1, 90)]  # the opening pose held 2.5 s, then the action
    sc, found = run(fr)
    assert [s["kind"] for s in sc] == ["still", None] and abs(sc[1]["start_ms"] - ms(75)) <= DT
    assert found["still"] == 1


def test_short_hold_is_no_still():
    fr = [shot(A, i) for i in range(60)] + [shot(A, 60)] * 30 + [shot(A, i) for i in range(61, 120)]
    sc, found = run(fr)
    assert len(sc) == 1 and found["still"] == 0


def test_fast_pan_is_no_dissolve():
    big = texture(3, (120, 160, 90))
    fr = [big[30:30 + H, 2 * i:2 * i + W] for i in range(80)]
    sc, found = run(fr)
    assert len(sc) == 1 and found["dissolve"] == 0


def test_online_return_is_the_hard_cut_test():
    p = coerce(SCENE_PARAMS, {})
    det = CutDetector(p)
    fr = [shot(A, i) for i in range(60)] + [shot(B, i) for i in range(60)]
    flags = [det(ms(i), f.astype(np.uint8)) for i, f in enumerate(fr)]
    assert [i for i, x in enumerate(flags) if x] == [60]


def test_cut_disabled_is_one_scene():
    sc, _ = run([shot(A, i) for i in range(60)] + [shot(B, i) for i in range(60)], cut_enabled=False)
    assert sc == [{"start_ms": 0, "end_ms": ms(120), "kind": None, "transition": {"in": None, "out": None}}]


def test_scenes_and_track_commands_share_the_detector(tmp_path):
    """End to end on an encoded clip: `scenes` reports the blank and its fades; track without `cuts` cuts at the same
    starts (one detector, run over the range first)."""
    from test_cli import run as cli
    fr = [shot(A, i) for i in range(60)] + [shot(A, 60 + k) * (1 - (k + 1) / 18) for k in range(18)]
    fr += [np.zeros((H, W, 3), np.float32)] * 15 + [shot(B, k) * ((k + 1) / 18) for k in range(18)] + [shot(B, 18 + k) for k in range(60)]
    path = str(tmp_path / "fade.mp4")
    vw = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), FPS, (2 * W, 2 * H))
    for f in fr:
        vw.write(cv2.resize(np.clip(f, 0, 255).astype(np.uint8), (2 * W, 2 * H)))
    vw.release()
    code, ev, err = cli({"cmd": "scenes", "video": path, "params": {}})
    assert code == 0, err
    sc = ev[-1]["scenes"]
    assert [s["kind"] for s in sc] == [None, "blank", None], sc
    assert sc[0]["transition"]["out"] == "fade" and sc[2]["transition"]["in"] == "fade"
    assert sc[0]["transition"]["in"] is None and sc[-1]["transition"]["out"] is None
    code, ev, err = cli({"cmd": "track", "video": path, "tracker": "lk_box", "start_ms": 0, "end_ms": sc[-1]["end_ms"],
                         "roi": {"kind": "box", "x": 0.4, "y": 0.3, "w": 0.2, "h": 0.4}, "params": {}})
    assert code == 0, err
    assert [s["start_ms"] for s in ev[-1]["scenes"]] == [s["start_ms"] for s in sc]
    assert any(e.get("stage") == "scenes" for e in ev if e["type"] == "progress")
