"""pawtrack/pulse.py (contraction pulses -> spurt cues) and cum.merge, on CPU: synthetic signals, then a rendered clip
(tests/pulse_clip.py: a thrusting, zooming body whose opening contracts on known frames) through run_group with a
perfect stand-in for SAM and with the points fallback."""
import numpy as np
import pytest

import pulse_clip as pc
from pawtrack import cum, pulse

T = np.arange(0, 12000, 1000 / 24)  # 24 fps, 12 s


def pulses(onsets, amps, t=T, tau=220.0, noise=1.0, seed=0):
    """A contraction signal in sigma units: jumps on the onsets, exponential release, unit noise."""
    x = np.random.default_rng(seed).normal(0, noise, len(t))
    for o, a in zip(onsets, amps):
        x += np.where(t >= o, a * np.exp(-(t - o) / tau), 0)
    return x


def near(found, truth, tol=1000 / 24 + 1):
    return all(min(abs(f - x) for f in found) <= tol for x in truth) and len(found) == len(truth)


def test_events_time_a_train_on_its_onsets():
    on = [2000, 3900, 6000, 8500]
    ev = pulse.events(T, pulses(on, [40, 30, 25, 20]))
    assert near([e["t_ms"] for e in ev], on)
    assert all(e["score"] == 1.0 and not e["weak"] for e in ev)
    assert [e["t_ms"] for e in pulse.events(T, pulses(on, [40, 30, 25, 20]), offset_ms=80)] == [e["t_ms"] + 80 for e in ev]


def test_events_noise_slow_swells_and_lone_blips_give_nothing():
    for s in range(5):
        assert pulse.events(T, pulses([], [], seed=s)) == []
    slow = 30 * np.exp(-((T - 6000) / 700) ** 2) + np.random.default_rng(1).normal(0, 1, len(T))
    assert pulse.events(T, slow) == []                              # a swell, not a contraction
    assert pulse.events(T, pulses([6000], [40])) == []               # one strong pulse alone: a blip
    assert pulse.events(T, pulses([1000, 9000], [40, 40])) == []     # 8 s apart: two blips, no train


def test_events_train_keeps_a_weak_later_shot_that_fits_the_rhythm_only():
    on, amp = [2000, 3800, 5800], [30, 25, 20]
    weak = pulses(on + [8200], amp + [5.5])                          # 2.4 s after 2.0 s: fits, weaker
    got = pulse.events(T, weak)
    assert near([e["t_ms"] for e in got], on + [8200]) and got[-1]["weak"]
    off_beat = pulses(on + [6400], amp + [4.5])                      # 0.6 s after a 2 s interval: not the rhythm
    assert near([e["t_ms"] for e in pulse.events(T, off_beat)], on)


def test_events_snap_to_the_new_drawing():
    on = [2000, 4000]
    x = pulses(on, [40, 30], noise=0.2)
    k = [int(np.argmin(np.abs(T - o))) for o in on]
    held = x.copy()
    for i in range(1, len(T), 2):
        held[i] = held[i - 1]                                        # on twos: odd frames repeat
    new = np.arange(len(T)) % 2 == 0
    ev = pulse.events(T, held, new)
    assert all(int(np.argmin(np.abs(T - e["t_ms"]))) % 2 == 0 for e in ev)
    assert near([e["t_ms"] for e in ev], [T[q + q % 2] for q in k])


def test_signal_removes_zoom_and_picks_the_fast_phase():
    s = 1 + 0.3 * T / T[-1]                                          # zoom: area ~ s^2, no contraction
    rng = np.random.default_rng(0)
    area = 400 * s ** 2 * np.exp(rng.normal(0, 0.005, len(T)))
    c, _ = pulse.signal(T, area, scale=s)
    assert np.nanmax(np.abs(c)) < 6 and pulse.events(T, c) == []
    k = (T >= 3000) & (T < 3000 + 1000)
    shrink = area.copy()
    shrink[k] *= 1 - 0.4 * np.exp(-(T[k] - 3000) / 200)             # fast smaller, slower back
    c, sign = pulse.signal(T, shrink, scale=s)
    assert sign == "-" and c[np.argmin(np.abs(T - 3000))] > 20
    grow = area.copy()
    grow[k] *= 1 + 0.4 * np.exp(-(T[k] - 3000) / 200)               # an animator who draws it pushing out
    assert pulse.signal(T, grow, scale=s)[1] == "+"
    assert pulse.signal(T, grow, scale=s, sign="-")[1] == "-"
    lost = shrink.copy()
    lost[100:110] = np.nan
    c, _ = pulse.signal(T, lost, scale=s)
    assert np.isnan(c[100:110]).all() and np.isfinite(c[:100]).all()


def test_crop_box_and_prompt():
    sq = [[100, 100], [120, 100], [120, 120], [100, 120]]
    x0, y0, x1, y1 = pulse.crop_box([sq, [[p[0] + 30, p[1]] for p in sq]], 640, 360)
    assert x0 <= 80 and x1 >= 170 and y1 - y0 >= 0.12 * 360 and x0 >= 0
    r = pulse.prompt([[20, 20], [60, 20], [60, 40], [20, 40]], [[[70, 70], [80, 70], [80, 80]], [[30, 25], [40, 25], [35, 35]]], 100, 100)
    assert r["kind"] == "box" and abs(r["x"] - 0.2) < 0.02 and abs(r["w"] - 0.4) < 0.03
    assert r["labels"].count(0) == 1 and r["labels"][0] == 1              # the neighbour inside the region is no negative
    assert all(0 <= a <= 1 and 0 <= b <= 1 for a, b in r["points"])
    with pytest.raises(ValueError):
        pulse.prompt([[200, 200], [210, 200], [210, 210]], [], 100, 100)


def test_held_new_finds_twos_around_the_region():
    rng = np.random.default_rng(0)
    base = (rng.uniform(0, 1, (120, 160)) > 0.5).astype(np.uint8) * 200   # sharp lines, like a drawing
    frames = [np.roll(base, i // 2 * 2, axis=1) for i in range(40)]        # a new drawing every 2 frames
    M = np.tile(np.array([[1.0, 0, 0], [0, 1.0, 0]]), (40, 1, 1))
    poly = [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]]
    new = pulse.held_new(frames, poly, M)
    assert new[0] and new[2] and not new[1] and not new[3]
    assert pulse.held_new([np.roll(base, i, 1) for i in range(40)], poly, M).all()   # on ones: every frame new


def test_is_pulse_and_label():
    assert pulse.is_pulse({"name": "c2_anus", "part": "anus"}) and pulse.is_pulse({"name": "anus2"})
    assert not pulse.is_pulse({"name": "c1_balls", "part": "balls"})
    assert pulse.is_pulse({"name": "c1_balls", "part": "balls", "pulse": True})
    assert not pulse.is_pulse({"name": "c2_anus", "part": "anus", "pulse": False})
    assert pulse.label({"name": "c2_anus", "who": "c2", "part": "anus"}) == "anus (Top)" and pulse.label({"name": "x_anus", "who": "x", "part": "anus"}) == "anus (Extra)"


ONS, AMPS = [48, 93, 143, 203], [0.4, 0.33, 0.27, 0.2]


@pytest.mark.parametrize("sam", [True, False])
def test_run_group_on_a_rendered_clip(tmp_path, monkeypatch, sam):
    monkeypatch.setattr(pulse, "sam_masks", pc.dark_masks)
    g = {"name": "c2_anus", "poly": pc.POLY, "t_ms": 1000, "who": "c2", "part": "anus"}
    dur = 260 * 1000 / pc.FPS
    path = tmp_path / "o.mp4"
    truth = pc.render(path, n=260, onsets=ONS, amps=AMPS, thrust_px=45, thrust_hz=2.0)
    r = pulse.run_group(str(path), g, [], 0, dur, {"pulse_sam": sam})
    assert r["source"] == ("sam" if sam else "points") and len(r["t"]) == len(r["pulse"]) == r["frames"]
    tp, fp, fn, off = pc.score([e["t_ms"] for e in r["events"]], truth, 1000 / pc.FPS + 1)
    assert (tp, fp, fn) == (4, 0, 0) and max(map(abs, off)) <= 1000 / pc.FPS + 1
    if sam:
        assert r["crop"][2] > r["crop"][0] and r["lost"] == 0
    still = tmp_path / "t.mp4"
    pc.render(still, n=260, onsets=[], amps=[], thrust_px=45, thrust_hz=2.0, noise=8)
    assert pulse.run_group(str(still), g, [], 0, dur, {"pulse_sam": sam})["events"] == []   # thrusting alone


def test_run_reports_channels_and_falls_back_when_sam_fails(tmp_path, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("no GPU")
    monkeypatch.setattr(pulse, "sam_masks", boom)
    path = tmp_path / "o.mp4"
    pc.render(path, n=120, onsets=[40, 85], amps=[0.4, 0.3], thrust_px=45, thrust_hz=2.0)
    groups = [{"name": "c2_anus", "poly": pc.POLY, "t_ms": 500, "who": "c2", "part": "anus"},
              {"name": "c1_penis", "poly": [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]], "t_ms": 500}]
    res = pulse.run(str(path), groups, 0, 5000, {})
    assert len(res) == 1 and res[0]["source"] == "points" and "no GPU" in res[0]["note"]
    assert res[0]["label"] == "anus (Top)" and len(res[0]["channel"]) == res[0]["frames"]
    with pytest.raises(ValueError):
        pulse.run(str(path), [{"name": "anus", "poly": [[0, 0]], "t_ms": 0}], 0, 5000, {})


def test_merge_joins_cues_and_keeps_old_proposals_as_they_were():
    vis = [{"t_ms": 1000, "score": 0.4, "source": "tag"}, {"t_ms": 3000, "score": 0.6, "source": "fluid+pulse"}]
    old = cum.merge(vis, [], {})
    assert [(s["t_ms"], s["score"], s["source"]) for s in old] == [(1000, 0.4, "tag"), (3000, 0.6, "fluid+pulse")]
    assert old[1]["why"] == [{"cue": "fluid", "score": 0.6}, {"cue": "balls pulse"}]
    cues = [{"t_ms": 1083, "score": 0.5, "cue": "anus (Top)"}, {"t_ms": 5000, "score": 0.7, "cue": "anus (Top)"},
            {"t_ms": 5040, "score": 0.3, "cue": "balls (Bottom)"}]
    m = cum.merge(vis, cues, {})
    assert [s["t_ms"] for s in m] == [1083, 3000, 5000]               # a shot takes its contraction's time
    assert m[0]["score"] == pytest.approx(1 - 0.6 * 0.5) and m[0]["source"] == "anus (Top)"
    assert [w["cue"] for w in m[0]["why"]] == ["anus (Top)", "tag"]
    assert m[2]["score"] == pytest.approx(1 - 0.3 * 0.7) and [w["cue"] for w in m[2]["why"]] == ["anus (Top)", "balls (Bottom)"]
    assert [s["t_ms"] for s in cum.merge(vis, cues, {"threshold": 0.65})] == [1083, 5000]
    assert len(cum.merge(vis, cues, {"cue_ms": 0})) == 5


def test_cli_validates_groups():
    from pawtrack import cli
    with pytest.raises(ValueError):
        cli.cmd_cum({"video": "x", "start_ms": 0, "end_ms": 5, "groups": "no"}, lambda e: None)
    with pytest.raises(ValueError):
        cli.cmd_cum({"video": "x", "start_ms": 0, "end_ms": 5, "pulse_range": [1]}, lambda e: None)
