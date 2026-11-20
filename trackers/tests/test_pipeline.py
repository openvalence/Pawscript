"""Points pipeline: local range (and its floor), sub-frame turns, invert, activity gate flags, span labels; the score command."""
import numpy as np
import pytest

from pawtrack.cli import process_scene
from pawtrack.loops import FOLD_PARAMS
from pawtrack.pipeline import PIPE_PARAMS, _subframe, apply_gate, finish_range, gate_states, to_points
from pawtrack.registry import coerce
from test_cli import run

P = coerce(PIPE_PARAMS + FOLD_PARAMS, {})
T = np.arange(0, 60000, 1000 / 24)  # 60 s at 24 fps


def strokes(pts):
    d = np.sign(np.diff([q["pos"] for q in pts]))
    d = d[d != 0]
    return int(np.count_nonzero(d[1:] != d[:-1]))


def test_local_range_keeps_small_strokes():
    """2 Hz strokes riding on a big slow drift: one global min-max squashes them under the
    prominence, a 3 s local range doesn't."""
    v = 0.012 * np.sin(2 * np.pi * 2 * T / 1000) + np.clip(T - 30000, 0, None) / 30000  # 2.4% p-p
    v = (v - v.min()) / np.ptp(v)
    n_turns = 2 * 2 * 60  # peaks + valleys
    glob = strokes(to_points(T, v, {**P, "pipe_norm_window_ms": 0}))
    loc = strokes(to_points(T, v, P))
    assert glob < 0.3 * n_turns and loc > 0.9 * n_turns, (glob, loc)


def test_local_range_floor_keeps_a_hold_still():
    """paw-dnrv: strokes, then a hold whose jitter is 1 % of them. The 3 s range alone stretches the jitter to full
    strokes; with the floor (a share of the scene's median stroke) it stays a few pos wide."""
    v = np.where(T < 30000, 0.5 + 0.5 * np.sin(2 * np.pi * T / 800), 0.2 + 0.005 * np.sin(2 * np.pi * T / 300))
    tail = lambda pts: [q["pos"] for q in pts if q["at"] > 34000]
    off = tail(to_points(T, v, {**P, "pipe_norm_floor": 0.0}))
    on = tail(to_points(T, v, P))
    assert P["pipe_norm_floor"] > 0 and max(off) - min(off) > 60 and max(on) - min(on) < 10, (max(off) - min(off), max(on) - min(on))


def test_subframe_turn_time():
    t = np.arange(10) * 100.0  # 10 fps
    y = -((t - 437.0) ** 2)
    assert abs(_subframe(t, y, int(np.argmax(y))) - 437.0) < 1.0
    assert _subframe(t, y, 0) == 0.0


def test_invert_flips_samples_and_points():
    v = 0.5 + 0.5 * np.sin(2 * np.pi * T[:240] / 1000)
    a, pa, sa = process_scene(list(T[:240]), v, [], P, [])
    b, pb, sb = process_scene(list(T[:240]), v, [], {**P, "pipe_invert": True}, [])
    assert (sa["sign"], sb["sign"]) == (1, -1)
    assert np.allclose(a, 1 - b)
    assert [q["at"] for q in pa] == [q["at"] for q in pb]
    assert all(abs(x["pos"] + y["pos"] - 100) <= 1 for x, y in zip(pa, pb))


def energy():
    """still 0-5 s, active 5-20 s, still 20-24 s, active 24-50 s, still 50-60 s"""
    e = np.full(len(T), 20.0)
    e[(T < 5000) | ((T >= 20000) & (T < 24000)) | (T >= 50000)] = 0.5
    return e


def test_gate_states():
    st = gate_states(T, energy(), P)
    at = lambda ms: st[np.searchsorted(T, ms)]
    assert (at(1000), at(10000), at(22000), at(30000), at(55000)) == ("idle", "active", "still", "active", "idle")
    st = gate_states(T, energy(), {**P, "pipe_gate_min_ms": 6000})  # inside span too short now
    assert st[np.searchsorted(T, 22000)] == "active" and st[np.searchsorted(T, 55000)] == "idle"
    st = gate_states(T, energy(), P, [{"start_ms": 0, "end_ms": 5000, "state": "carry"},
                                      {"start_ms": 30000, "end_ms": 31000, "state": "idle"}])
    assert st[np.searchsorted(T, 1000)] == "carry" and st[np.searchsorted(T, 30500)] == "idle"
    assert set(gate_states(T, energy(), {**P, "pipe_gate": "off"})) == {"active"}
    with pytest.raises(ValueError):
        gate_states(T, energy(), P, [{"start_ms": 0, "end_ms": 1, "state": "nope"}])


def strokes800():
    return [{"at": int(a), "pos": 90 if k % 2 else 10} for k, a in enumerate(np.arange(0, 60000, 400))]


def moving():
    return [np.full((4, 4), 100.0) + (i % 7) * 10 for i in range(len(T))]  # always "moving": no still spans


def test_automatic_spans_only_flag():
    """paw-dnrv: the gate's own idle / still spans are events; the points stay as tracked."""
    pts = strokes800()
    ev = []
    out = apply_gate(pts, T, gate_states(T, energy(), P), ev)
    assert [e["kind"] for e in ev] == ["idle", "still", "idle"] and all(e["end_ms"] > e["t_ms"] for e in ev)
    assert out == pts


def test_labelled_idle_holds_and_carry_keeps_the_rhythm():
    pts = strokes800()
    ev = []
    labels = [{"start_ms": 0, "end_ms": 5000, "state": "idle"}, {"start_ms": 20000, "end_ms": 24000, "state": "carry"}]
    gap = [q for q in pts if not 20000 <= q["at"] < 24000]
    out = finish_range([(list(T), moving())], gap, P, labels, ev)
    assert [e["kind"] for e in ev] == ["idle", "carry"]
    assert len({q["pos"] for q in out if q["at"] < 5000}) == 1  # a hold
    car = [q for q in out if 20000 < q["at"] < 24000]
    assert len(car) >= 6 and abs(np.median(np.diff([q["at"] for q in car])) - 400) <= 2  # the neighbour's rhythm
    assert {q["pos"] for q in car} <= {10, 90}
    ats = [q["at"] for q in out]
    assert ats == sorted(set(ats))


def test_a_stroke_gap_is_left_as_tracked():
    """paw-dnrv: no automatic carry: a 6 s gap between turns is not filled with a guessed rhythm."""
    pts = [q for q in strokes800() if not 20000 < q["at"] < 26000]
    ev = []
    assert finish_range([(list(T), moving())], pts, P, None, ev) == pts and ev == []


def test_score_command():
    ref = [{"at": int(a), "pos": 0 if k % 2 else 100} for k, a in enumerate(range(0, 20000, 400))]
    code, ev, err = run({"cmd": "score", "candidate": ref, "reference": ref, "start_ms": 0, "end_ms": 20000})
    assert code == 0, err
    o = ev[-1]["overall"]
    assert o["f1"] == 1 and o["sign"] == 1 and o["r_pos"] > 0.999 and "scenes" not in ev[-1]
    flipped = [{"at": q["at"], "pos": 100 - q["pos"]} for q in ref]
    code, ev, err = run({"cmd": "score", "candidate": flipped, "reference": ref, "start_ms": 0, "end_ms": 20000,
                         "scenes": [{"start_ms": 0, "end_ms": 8000}, {"start_ms": 8000, "end_ms": 20000}]})
    assert code == 0, err
    r = ev[-1]
    assert len(r["scenes"]) == 2 and all(s["sign"] == -1 for s in r["scenes"]) and r["overall"]["f1"] == 1
    code, ev, _ = run({"cmd": "score", "candidate": [], "reference": ref, "start_ms": 0, "end_ms": 20000})
    assert code == 0 and ev[-1]["overall"]["f1"] == 0 and ev[-1]["overall"]["r_pos"] is None  # NaN -> null


def test_orgasm_and_climax_labels_only_flag():
    """climax (the fast run-in) and orgasm (v4.62: no more synthesized pulses) keep the tracked points."""
    pts = strokes800()
    ev = []
    labels = [{"start_ms": 24000, "end_ms": 30000, "state": "climax"}, {"start_ms": 30000, "end_ms": 40000, "state": "orgasm"}]
    out = finish_range([(list(T), moving())], pts, P, labels, ev)
    assert [e["kind"] for e in ev] == ["climax", "orgasm"] and ev[1]["t_ms"] == pytest.approx(30000, abs=42)
    assert out == pts


def test_rdp_terminates_on_nan_repeated_and_reversed_times():
    """paw-ol1x: the recursive RDP never returned when the farthest index was an end point (NaN, repeated times)."""
    from pawtrack.pipeline import _rdp
    t = np.arange(10.0)
    y = np.sin(t)
    assert _rdp(t, y, 0.0)[0] == 0 and _rdp(t, y, 0.0)[-1] == 9
    yn = y.copy()
    yn[-1] = np.nan
    assert _rdp(t, yn, 1.0)[-1] == 9
    assert _rdp(np.zeros(10), y, 0.1)[-1] == 9                    # all times equal
    assert _rdp(t[::-1], y, 0.1)[-1] == 9                         # reversed times
    n = 20000                                                      # depth is no limit
    assert len(_rdp(np.arange(float(n)), np.where(np.arange(n) % 2, 1.0, 0.0), 0.5)) == n


def test_to_points_repairs_bad_samples_instead_of_recursing(capfd):
    t = np.arange(0, 6000, 1000 / 30)
    v = 0.5 + 0.5 * np.sin(2 * np.pi * 1.0 * t / 1000)
    good = to_points(t, v, P)
    k = np.r_[3, 2, 1, 0, np.arange(4, len(t))]                   # a B-frame-like shuffle of the first frames
    bad_v = v.copy()
    bad_v[50] = np.nan
    pts = to_points(np.r_[t[k], t[100]], np.r_[bad_v[k], v[100]], P)
    assert pts and [q["at"] for q in pts] == sorted({q["at"] for q in pts})
    assert abs(len(pts) - len(good)) <= 2
    assert "dropped" in capfd.readouterr().err
