import numpy as np

from pawtrack.knot import knot_passes


def test_knot_passes():  # self-check on a synthetic area trace: 24 fps on twos, knot-stroke-like depth
    fps, t = 24.0, np.arange(0, 6300, 1000 / 24)  # ends > HOLD_MS after the 6th out-pop
    pos = np.interp(t % 1083, [0, 292, 375, 542, 792, 1000, 1042, 1083], [0, 17, 64, 80, 33, 20, 0, 0])
    pos = pos[(np.arange(len(t)) // 2) * 2]  # held frames
    # visible area vs depth, shaped like clip04's (the knot behind the rim below pos ~18.5 halves the area)
    area = np.interp(pos, [0, 17, 18.5, 20, 30, 64, 80], [0.007, 0.009, 0.016, 0.017, 0.0175, 0.025, 0.031])
    ev = knot_passes({"area": area}, fps)
    want_in = [1083 * c + 1042 for c in range(5)]
    got_in = [e["t_ms"] for e in ev if e["kind"] == "in"]
    assert len(got_in) == len(want_in) and all(abs(g - w) <= 100 for g, w in zip(got_in, want_in)), ev
    assert sum(e["kind"] == "out" for e in ev) == 6, ev  # out-pops at 292 + 1083 c, c = 0..5
    assert knot_passes({"area": 0.01 + 0.002 * np.sin(t / 300)}, fps) == []  # smooth strokes: nothing
    lost = area.copy()
    lost[40:44] = np.nan
    assert all(not (t[39] <= e["t_ms"] <= t[47]) for e in knot_passes({"area": lost}, fps))
    flick = area.copy()
    flick[100] *= 3  # one-frame mask flicker: a jump up then straight back down
    assert len(knot_passes({"area": flick}, fps)) == len(ev)
    bad = area.copy()
    bad[::7] *= 40  # a mask jumping between objects: the scene gate refuses it
    assert knot_passes({"area": bad}, fps) == []
