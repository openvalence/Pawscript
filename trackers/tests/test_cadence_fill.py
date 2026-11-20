"""pipe_cadence_fill: strokes a point tracker missed come back from the picture's own rhythm (no ROI, no point lock).
Probe and numbers: trackers/experiments/fastmotion/RESULTS.md."""
import numpy as np

from pawtrack.cli import process_scene
from pawtrack.loops import FOLD_PARAMS
from pawtrack.pipeline import PIPE_PARAMS, cadence_fill, cadence_turns
from pawtrack.registry import coerce

P = coerce(PIPE_PARAMS + FOLD_PARAMS, {})


def zigzag(times):
    return [{"at": int(t), "pos": 100 if i % 2 else 0} for i, t in enumerate(times)]


def alternates(pts):
    d = np.sign(np.diff([q["pos"] for q in pts]))
    return bool(np.all(d != 0) and np.all(d[1:] != d[:-1]))


def test_fill_restores_a_missed_stroke():
    turns = np.arange(0, 5000, 250)  # 4 turns/s
    pts = zigzag(turns)
    missed = [q for i, q in enumerate(pts) if i not in (8, 9)]  # one whole stroke lost (a valley and a peak)
    out = cadence_fill(missed, turns + 10)
    assert len(out) == len(pts) and alternates(out)
    assert [q["at"] for q in out][8:10] == [2010, 2260]


def test_fill_single_turn_and_parity():
    turns = np.arange(0, 5000, 250)
    pts = zigzag(turns)
    one = [q for i, q in enumerate(pts) if i != 8]  # a lone valley lost between two peaks: put back
    assert cadence_fill(one, turns) == pts
    # a peak, then (one empty cadence cell) a valley: inserting one turn would break the zigzag, so nothing is added
    odd = pts[:8] + [{"at": 2250, "pos": 0}] + [{"at": int(t), "pos": 100 if i % 2 == 0 else 0} for i, t in enumerate(turns[10:])]
    assert cadence_fill(odd, turns) == odd


def test_fill_is_a_noop_when_nothing_is_missing():
    turns = np.arange(0, 5000, 250)
    pts = zigzag(turns)
    assert cadence_fill(pts, turns + 30) == pts
    assert cadence_fill(pts, []) == pts


def blob(n=240, fps=24.0, hz=2.0):
    """64 x 36 grey thumbs, a bright square bobbing vertically at hz."""
    t = np.arange(n) * 1000 / fps
    th = np.zeros((n, 36, 64), np.float32)
    for i, ti in enumerate(t):
        y = int(round(14 + 8 * np.sin(2 * np.pi * hz * ti / 1000)))
        th[i, y:y + 6, 28:36] = 200
    return t, list(th)


def test_cadence_turns_find_the_rhythm():
    t, th = blob()
    ct = cadence_turns(t, th)
    true = (np.arange(40) + 0.5) * 250  # sin extremes every 250 ms
    inner = ct[(ct > 500) & (ct < 9000)]
    assert len(inner) >= 30
    assert np.median(np.abs(inner[:, None] - true[None]).min(1)) <= 1000 / 24 + 1


def test_cadence_turns_empty_without_rhythm():
    t = np.arange(240) * 1000 / 24
    assert len(cadence_turns(t, [np.zeros((36, 64), np.float32)] * 240)) == 0


def test_process_scene_off_by_default_and_opt_in_fills_the_gap():
    t, th = blob()
    v = (np.sin(2 * np.pi * 2 * t / 1000) + 1) / 2
    v[100:112] = v[100]  # the tracker lost lock for half a second: one stroke flat
    _, dflt, _ = process_scene(list(t), v.copy(), th, P, [])
    _, off, _ = process_scene(list(t), v.copy(), th, {**P, "pipe_cadence_fill": False}, [])
    dec = {}
    _, on, _ = process_scene(list(t), v.copy(), th, {**P, "pipe_cadence_fill": True}, [], dec)
    assert dflt == off and dec["cadence_fill"]["inserted"] == len(on) - len(off) and "applied" in dec["sign"]   # opt-in (paw-dnrv)
    assert len(on) > len(off) and alternates(on[1:-1])
