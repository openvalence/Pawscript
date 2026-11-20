"""detect_period on synthetic thumbnails: the lag-2 trap (rising lag curve), periodic vs exact."""
import numpy as np

from pawtrack.loops import detect_period, lag_curve

H, W = 36, 64
YY, XX = np.mgrid[0:H, 0:W]
RNG = np.random.default_rng(1)


def blob(x, y, r=5.0):
    return 40 + 180 * np.exp(-((XX - x) ** 2 + (YY - y) ** 2) / (2 * r * r))


def on(step, frames):
    """Animation on twos/threes: every drawing held for `step` frames."""
    return [frames[i - i % step] for i in range(len(frames))]


def noisy(frames, sd=1.5):
    return [f + RNG.normal(0, sd, f.shape) for f in frames]


def test_rising_curve_is_not_a_period():
    """A slow pan over texture on twos: d(L) rises with L, lag 2 is its floor. No period."""
    tex = np.kron(RNG.uniform(0, 255, (H // 4 + 1, 200)), np.ones((4, 4)))[:H]
    frames = on(2, noisy([tex[:, i // 2:i // 2 + W].astype(float) for i in range(300)]))
    d = lag_curve(frames, 150)
    assert np.all(np.diff(d[2:40]) > -0.5)  # rising: the old rule picked lag 2 here
    r = detect_period(frames)
    assert r["kind"] is None and r["period_frames"] is None, r


def test_periodic_motion_on_threes_with_varying_cycles():
    """Same rhythm (30 frames), every cycle a different depth, slow drift, on threes -> periodic."""
    amp = np.repeat(RNG.uniform(6, 14, 12), 30)
    t = np.arange(360)
    frames = on(3, noisy([blob(20 + i * 0.04, 18 + a * np.sin(2 * np.pi * i / 30)) for i, a in zip(t, amp)]))
    r = detect_period(frames)
    assert r["kind"] == "periodic" and abs(r["period_frames"] - 30) <= 1 and r["confidence"] < 0.5, r


def test_exact_loop_on_twos():
    cyc = [blob(32 + 12 * np.cos(2 * np.pi * i / 24), 18 + 10 * np.sin(2 * np.pi * i / 24)) for i in range(24)]
    frames = noisy(on(2, cyc * 10), sd=1.0)
    r = detect_period(frames)
    assert r["kind"] == "exact" and r["period_frames"] == 24 and r["confidence"] > 0.8 and r["cycles"] == 10, r


def test_static_and_short():
    assert detect_period([np.full((H, W), 100.0)] * 50)["kind"] is None
    assert detect_period([blob(10, 10)] * 3)["period_frames"] is None
