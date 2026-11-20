"""paw-fc0r: hard cuts inside fast loops (pawtrack/scenes.py cut_repeat). A fast cycle makes every step big, so the
adaptive rule (3 x the window max) misses a cut between two loops of similar colour; the cycle-aware rule (a cut's first
frame has no near twin one cycle back) finds it at its exact frame, and stays quiet where a loop continues under a pan
or stops into free motion. Synthetic 160 px frames, CPU only."""
import numpy as np
import pytest
import cv2

from test_scenes import H, W, DT, texture, run, starts, ms

BG = texture(7, (90, 150, 110))          # one set, similar colours for both angles
BLOBS = [texture(8 + k, (210, 190, 170)) for k in range(2)]


def drawing(angle, d, period=8, pan=0, free=None):
    """Frame of a loop drawn in `period` drawings (d = drawing index, or free = a non-repeating phase), seen from camera
    angle 0 (wide) or 1 (closer, offset): the same set and characters, so the colours barely change at a cut."""
    ox, oy, z = (30 + pan, 20, 1.0) if angle == 0 else (120 + pan, 60, 1.8)
    crop = BG[oy:oy + int(H / z), ox:ox + int(W / z)]
    img = cv2.resize(crop, (W, H), interpolation=cv2.INTER_AREA)
    ph = (d / period) if free is None else free
    for k, blob in enumerate(BLOBS):   # two big bodies moving fast, a large step every frame
        x = int(W * (0.3 + 0.4 * k) + 40 * np.sin(2 * np.pi * ph + k + 2 * angle))
        y = int(H * 0.5 + 25 * np.cos(2 * np.pi * ph + 2 * k))
        r = int(20 * z)
        x0, y0 = max(0, x - r), max(0, y - r)
        img[y0:y + r, x0:x + r] = blob[:min(H, y + r) - y0, :min(W, x + r) - x0]
    return img


def loop(angle, n, start=0, period=8, **kw):
    return [drawing(angle, (start + i) % period, period, **kw) for i in range(n)]


def test_cut_between_two_fast_loops_of_similar_colour():
    fr = loop(0, 8 * 12) + loop(1, 8 * 12, start=3)
    sc, _ = run(fr, cut_repeat=False)
    assert len(sc) == 1, "the adaptive rule alone misses it (the paw-fc0r case)"
    sc, _ = run(fr)
    assert starts(sc) == [ms(96)]


def test_cut_between_two_fast_loops_on_twos():
    fr = [f for f in loop(0, 4 * 12) for _ in (0, 1)] + [f for f in loop(1, 4 * 12, start=1) for _ in (0, 1)]
    sc, _ = run(fr)
    assert starts(sc) == [ms(96)]


def test_loop_under_a_pan_is_no_cut():
    fr = [drawing(0, i % 8, pan=i // 3) for i in range(8 * 20)]   # the camera travels; no cycle repeats exactly
    sc, _ = run(fr)
    assert len(sc) == 1


def test_loop_stopping_into_free_motion_is_no_cut():
    rng = np.random.default_rng(5)
    ph = np.cumsum(rng.uniform(0.05, 0.2, 100))
    fr = loop(0, 8 * 12) + [drawing(0, 0, free=p) for p in ph]
    sc, _ = run(fr)
    assert len(sc) == 1


@pytest.mark.parametrize("at", [40, 100])
def test_flash_inside_a_fast_loop_is_still_no_cut(at):
    fr = loop(0, 8 * 18)
    fr[at] = np.full((H, W, 3), 255, np.float32)
    sc, found = run(fr, cut_min_scene_ms=0)
    assert len(sc) == 1 and found["flash"] == 1


def test_numbers_of_the_case():
    """The step inside the loop is big and the cut's step under 3 x it (why the old rule missed it); the cut's novelty
    is far above the loop's (its frames repeat a cycle back)."""
    from pawtrack.registry import coerce
    from pawtrack.scenes import SCENE_PARAMS, CutDetector
    det = CutDetector(coerce(SCENE_PARAMS, {}))
    for i, f in enumerate(loop(0, 96) + loop(1, 96, start=3)):
        det(ms(i), np.clip(f, 0, 255).astype(np.uint8))
    d, nov = det.d, det.nov
    assert 15 <= d[96] < 3 * (max(d[88:96]) + 1)
    assert nov[96] >= 5 * (max(nov[88:96]) + 1)


def test_scenes_command_finds_the_loop_cut(tmp_path):
    """End to end: the encoded clip through the `scenes` command (the CLI the app runs): the cut at its exact frame."""
    from test_cli import run as cli
    from test_scenes import FPS
    path = str(tmp_path / "loops.mp4")
    vw = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), FPS, (2 * W, 2 * H))
    for f in loop(0, 96) + loop(1, 96, start=3):
        vw.write(cv2.resize(np.clip(f, 0, 255).astype(np.uint8), (2 * W, 2 * H)))
    vw.release()
    code, ev, err = cli({"cmd": "scenes", "video": path, "params": {}})
    assert code == 0, err
    sc = ev[-1]["scenes"]
    assert [round(s["start_ms"] / DT) for s in sc[1:] if s.get("split") != "camera"] == [96], sc


def test_ignore_mask_none_is_today_and_a_logo_no_longer_hides_a_blank():
    """paw-fc0r: the optional ignore grid (True = ignore). A bright burnt-in logo on every frame keeps a black stretch
    from reading as blank (its luma spread); masked, the black is a blank again. mask=None is exactly today."""
    from test_scenes import A, B, shot
    def logo(f):
        f = f.copy()
        f[70:86, 130:156] = 255.0
        return f
    fr = [shot(A, i) for i in range(60)] + [np.zeros((H, W, 3), np.float32)] * 15 + [shot(B, i) for i in range(60)]
    fr = [logo(f) for f in fr]
    grid = np.zeros((18, 32), bool)
    grid[13:18, 25:32] = True   # the logo's corner, in picture coordinates
    sc, _ = run(fr)
    assert [s["kind"] for s in sc] == [None, None, None]   # two cuts, the black not blank
    assert run_masked(fr, None) == run(fr)
    sc, found = run_masked(fr, grid)
    assert [s["kind"] for s in sc] == [None, "blank", None] and found["blank"] == 1


def run_masked(frames, grid):
    from pawtrack.registry import coerce
    from pawtrack.scenes import SCENE_PARAMS, CutDetector
    det = CutDetector(coerce(SCENE_PARAMS, {}), grid)
    rng = np.random.default_rng(0)
    for i, f in enumerate(frames):
        det(round(i * DT), np.clip(f + rng.normal(0, 1, f.shape), 0, 255).astype(np.uint8))
    return det.finish(0, round(len(frames) * DT)), det.found
