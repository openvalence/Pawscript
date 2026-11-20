"""Points pipeline: local range, sub-frame turns, invert, activity gate; the score command."""
import numpy as np
import pytest

from pawtrack.cli import process_scene
from pawtrack.loops import FOLD_PARAMS
from pawtrack.pipeline import PIPE_PARAMS, _subframe, apply_gate, gate_states, to_points
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
    st = gate_states(T, energy(), {**P, "pipe_gate_inside": "carry"})
    assert st[np.searchsorted(T, 22000)] == "carry"
    st = gate_states(T, energy(), {**P, "pipe_gate_min_ms": 6000})  # inside span too short now
    assert st[np.searchsorted(T, 22000)] == "active" and st[np.searchsorted(T, 55000)] == "idle"
    st = gate_states(T, energy(), P, [{"start_ms": 0, "end_ms": 5000, "state": "carry"},
                                      {"start_ms": 30000, "end_ms": 31000, "state": "idle"}])
    assert st[np.searchsorted(T, 1000)] == "carry" and st[np.searchsorted(T, 30500)] == "idle"
    assert set(gate_states(T, energy(), {**P, "pipe_gate": "off"})) == {"active"}
    with pytest.raises(ValueError):
        gate_states(T, energy(), P, [{"start_ms": 0, "end_ms": 1, "state": "nope"}])


def test_apply_gate_idle_carry_still():
    period = 800  # ms, strokes 10..90
    pts = [{"at": int(a), "pos": 90 if k % 2 else 10} for k, a in enumerate(np.arange(0, 60000, period / 2))]
    st = gate_states(T, energy(), {**P, "pipe_gate_inside": "carry"})
    ev = []
    out = apply_gate(pts, T, st, ev)
    assert [e["kind"] for e in ev] == ["idle", "carry", "idle"]
    assert all(e["end_ms"] > e["t_ms"] for e in ev)
    idle = [q["pos"] for q in out if q["at"] < 5000]
    assert len(set(idle)) == 1  # a hold
    car = [q for q in out if 20000 < q["at"] < 24000]
    gaps = np.diff([q["at"] for q in car])
    assert len(car) >= 6 and abs(np.median(gaps) - period / 2) <= 2  # the neighbour's rhythm
    assert {q["pos"] for q in car} <= {10, 90}
    ats = [q["at"] for q in out]
    assert ats == sorted(set(ats))
    ev = []
    assert apply_gate(pts, T, gate_states(T, energy(), P), ev) is not None
    assert "still" in [e["kind"] for e in ev]


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


def test_carry_through_stroke_gap():
    from pawtrack.pipeline import finish_range
    pts = [{"at": int(a), "pos": 90 if k % 2 else 10} for k, a in enumerate(np.arange(0, 60000, 400))
           if not 20000 < a < 26000]  # a 6 s gap in 800 ms strokes
    th = [np.full((4, 4), 100.0) + (i % 7) * 10 for i in range(len(T))]  # always "moving": no still spans
    ev = []
    out = finish_range([(list(T), th)], pts, {**P, "pipe_carry_gaps": True}, None, ev)
    assert [e["kind"] for e in ev] == ["carry"] and 19000 < ev[0]["t_ms"] < 21000
    gap = [q["at"] for q in out if 20500 < q["at"] < 25500]
    assert len(gap) >= 10 and abs(np.median(np.diff(gap)) - 400) <= 2
    ev = []
    finish_range([(list(T), th)], pts, {**P, "pipe_carry_gaps": False}, None, ev)
    assert ev == []


def test_energy_sign():
    from pawtrack.pipeline import energy_sign
    rng = np.random.default_rng(0)
    t = T[:720]
    v = 0.5 + 0.5 * np.sin(2 * np.pi * t / 1000)
    th = [rng.normal(0, 1 + 20 * (1 - x), (8, 8)) for x in v]  # the picture churns at the low end
    info = {}
    assert energy_sign(t, v, th, P, info) == 1 and energy_sign(t, 1 - v, th, P) == -1
    assert info["score"] > 0 and info["energy_top"] < info["energy_bottom"]


def test_orgasm_and_climax_labels():
    """orgasm label -> synthesized deep pulses (what the v3 "climax" label did); climax label -> the fast run-in:
    points kept as tracked, only the event."""
    from pawtrack.pipeline import finish_range
    pts = [{"at": int(a), "pos": 90 if k % 2 else 10} for k, a in enumerate(np.arange(0, 60000, 400))]
    th = [np.full((4, 4), 100.0) + (i % 7) * 10 for i in range(len(T))]
    ev = []
    labels = [{"start_ms": 24000, "end_ms": 30000, "state": "climax"}, {"start_ms": 30000, "end_ms": 40000, "state": "orgasm"}]
    out = finish_range([(list(T), th)], pts, P, labels, ev)
    assert [e["kind"] for e in ev] == ["climax", "orgasm"] and ev[1]["t_ms"] == pytest.approx(30000, abs=42)
    c = [q for q in out if 30100 < q["at"] < 39800]
    assert {q["pos"] for q in c} == {1, 34} and abs(np.median(np.diff([q["at"] for q in c])) - 1000 / 6.8) <= 2
    r = [q for q in out if 24100 < q["at"] < 29900]
    assert {q["pos"] for q in r} == {10, 90}  # run-in: the tracked strokes


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
