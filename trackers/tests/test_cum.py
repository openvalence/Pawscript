"""pawtrack/cum.py: onset strength, peak picking, fusion with pulses, thresholds (CPU, synthetic curves); the GPU
detector on a real clip under the CUDA marker."""
import json
import os
import subprocess
import types
import sys

import numpy as np
import pytest

from pawtrack import cum

T = np.arange(0, 6000, 40.0)  # 25 fps, 6 s


def steps(times, t=T, h=1.0):
    """A curve that steps up by h at each time (cum piling up on screen)."""
    return sum(h * (t >= x) for x in times) + 0.01 * np.sin(t / 37.0)


def test_strength_bumps_at_steps_only():
    s = cum.strength(T, steps([1000, 3000]), smooth_ms=80, rise_ms=250)
    assert s.shape == T.shape and 0 <= s.min() and s.max() <= 1.05   # ~1 at the strongest rises (not clipped)
    hi = T[s > 0.5]
    assert hi.size and all(min(abs(x - 1000), abs(x - 3000)) <= 300 for x in hi)
    assert s[(T > 1600) & (T < 2600)].max() < 0.2   # flat between steps
    assert cum.strength(T, 5 - steps([1000]))[(T > 900) & (T < 1400)].max() < 0.2


def test_peaks_min_spacing_keeps_the_higher():
    y = np.zeros(len(T))
    y[50], y[52], y[100] = 0.6, 0.9, 0.5   # 2000 ms, 2080 ms, 4000 ms
    assert [T[i] for i in cum.peaks(T, y, 120)] == [2080, 4000]
    assert [T[i] for i in cum.peaks(T, y, 40)] == [2000, 2080, 4000]


def test_fuse_finds_each_step_with_its_source():
    f, sp = cum.fuse(T, {"tag": steps([1000, 2500, 4000]), "cam": None, "fluid": np.full(len(T), np.nan)}, {})
    assert len(f) == len(T)
    got = [s["t_ms"] for s in sp if s["score"] >= 0.5]
    assert len(got) == 3 and all(abs(a - b) <= 200 for a, b in zip(got, [1000, 2500, 4000]))
    assert {s["source"] for s in sp if s["score"] >= 0.5} == {"tag"}


def test_fuse_weights_and_threshold():
    x = {"tag": steps([1000]), "fluid": np.where(np.abs(T - 3000) < 50, 1.0, 0.0)}   # fluid = an impulse (new pixels)
    _, both = cum.fuse(T, x, {"threshold": 0.3})
    assert sorted(s["source"] for s in both) == ["fluid", "tag"]
    _, only = cum.fuse(T, x, {"threshold": 0.3, "w_fluid": 0})   # weight 0 = the source is left out
    assert [s["source"] for s in only] == ["tag"] and only[0]["score"] > 0.9
    _, none = cum.fuse(T, x, {"threshold": 0.99})
    assert none == []


def test_pulses_boost_an_aligned_onset():
    x = {"tag": steps([1000]), "cam": steps([3000])}
    p = {"threshold": 0.1}
    _, a = cum.fuse(T, x, p)
    _, b = cum.fuse(T, x, p, pulses=[1040, 5000])   # near the 1000 ms onset only
    sa, sb = {s["t_ms"] // 500: s for s in a}, {s["t_ms"] // 500: s for s in b}
    k1, k3 = min(sa, key=lambda k: abs(k - 2)), min(sa, key=lambda k: abs(k - 6))
    assert sb[k1]["score"] > sa[k1]["score"] and sb[k1]["source"].endswith("+pulse")
    assert sb[k3]["score"] == sa[k3]["score"] and "+pulse" not in sb[k3]["source"]
    _, c = cum.fuse(T, x, {**p, "pulse_ms": 0}, pulses=[1040])
    assert c == a


def test_fuse_empty_inputs():
    f, sp = cum.fuse(T, {}, {})
    assert sp == [] and not f.any()
    f, sp = cum.fuse(T[:2], {"tag": [0, 1]}, {})
    assert sp == []


def test_roi_and_fluid():
    assert cum._roi([], (90, 160)) == (0, 90, 0, 160)
    y0, y1, x0, x1 = cum._roi([[0.25, 0.25, 0.5, 0.5]], (100, 200))
    assert (y0, y1, x0, x1) == (12, 87, 25, 175)
    img = np.zeros((4, 4, 3), np.uint8)
    img[0, 0] = (240, 240, 235)   # cum white
    img[1, 1] = (250, 120, 120)   # bright but saturated
    img[2, 2] = (120, 120, 120)   # grey but dark
    assert cum._fluid(img).sum() == 1 and cum._fluid(img)[0, 0]


# a reference clip with spurts at 206.6-210.6 s, outside the repo: set PAWSCRIPT_CUM_REF to its path
REF = os.environ.get("PAWSCRIPT_CUM_REF", "")


@pytest.mark.gpu
@pytest.mark.skipif(not os.path.exists(REF), reason="PAWSCRIPT_CUM_REF (a reference clip) not set")
def test_detect_gpu():
    """Through the CLI in a child process: hydra-core's pytest plugin owns the name `hydra` in this one."""
    torch = pytest.importorskip("torch")
    if not torch.cuda.is_available():
        pytest.skip("CUDA")
    req = {"cmd": "cum", "video": os.path.abspath(REF), "start_ms": 206600, "end_ms": 210600, "params": {}}
    p = subprocess.run([sys.executable, "-m", "pawtrack.cli"], input=json.dumps(req), capture_output=True, text=True,
                       cwd=os.path.join(os.path.dirname(__file__), ".."), timeout=900)
    ev = [json.loads(x) for x in p.stdout.splitlines()]
    assert any(e["type"] == "progress" for e in ev), p.stderr[-2000:]
    r = ev[-1]
    assert r["type"] == "result", p.stderr[-2000:]
    assert r["frames"] > 50 and r["tagged"] >= r["frames"] // 3
    assert len(r["curve"]["t"]) == len(r["curve"]["cum"]) == r["frames"]
    assert all(206600 <= s["t_ms"] <= 210600 and 0 < s["score"] <= 1 for s in r["spurts"])


def test_cli_validates_and_serve_routes_to_the_describe_child(monkeypatch):
    from pawtrack import cli, serve
    with pytest.raises(ValueError):
        cli.cmd_cum({"video": "x", "start_ms": 5, "end_ms": 5}, lambda e: None)
    with pytest.raises(ValueError):
        cli.cmd_cum({"video": "x", "start_ms": 0, "end_ms": 5, "pulses": "no"}, lambda e: None)
    assert cli.COMMANDS["cum"] is cli.cmd_cum
    monkeypatch.delenv("PAWSCRIPT_GPU_FRACTION", raising=False)
    svc, sent = serve.Service(lambda ev: None), []

    class Child:  # the resident describe child (Hydra): cum shares it
        def alive(self):
            return True

        def close(self):
            pass

        def run(self, req, emit):
            sent.append(req["cmd"])
            return {"type": "result", "spurts": []}
    svc.describe = Child()
    assert svc.dispatch({"cmd": "cum", "video": "x", "start_ms": 0, "end_ms": 9}, lambda e: None) == {"spurts": []}
    assert sent == ["cum"]
    assert set(serve.Service(lambda ev: None, role="describe").commands) == {"describe", "cum"}


def test_features_and_detect_with_a_stub_tagger(tmp_path, monkeypatch):
    """The decode / pixel path on a synthetic clip: white splats land at 0.5, 1.5, 2.5 s inside the region the
    (stubbed) tagger's penis CAM gives; detect finds them from the new-fluid pixels."""
    import cv2
    torch = pytest.importorskip("torch")
    from pawtrack import describe as D
    path, fps = str(tmp_path / "splat.mp4"), 30
    vw = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (320, 180))
    rng = np.random.default_rng(3)
    img = np.full((180, 320, 3), 60, np.uint8)
    for i in range(3 * fps):
        if i in (15, 45, 75):
            cv2.circle(img, (120 + 30 * (i // 30), 90), 9, (245, 245, 240), -1)
        vw.write(np.clip(img + rng.normal(0, 2, img.shape), 0, 255).astype(np.uint8))
    vw.release()

    tags = cum.SPURT_TAGS + cum.CAM_TAGS + cum.ROI_TAGS
    m = types.SimpleNamespace(index={t: i for i, t in enumerate(dict.fromkeys(tags))})
    m.forward_head = lambda feats, valid: torch.full((1, len(m.index)), 0.9)
    cam = np.zeros((6, 8), np.float32)
    cam[2:4, 3:5] = 1.0   # the middle of the frame
    monkeypatch.setattr(D, "load", lambda: m)
    monkeypatch.setattr(D, "thresholds", lambda m, c: np.full(len(m.index), 0.5, np.float32))
    monkeypatch.setattr(D, "_features", lambda m, bgr, seqlen: (None, None, (6, 8)))
    monkeypatch.setattr(D, "_cams", lambda m, f, v, g, want: {t: cam for t in want})
    F = cum.features(path, 0, 3000, cum.coerce(cum.PARAMS, {"fps": 10}))
    n = len(F["t"])
    assert n >= 85 and F["tagged"].sum() == len(range(0, n, 3))
    assert np.isnan(F["tag"][1]) and F["tag"][0] == pytest.approx(0.9)
    assert np.nanmax(F["cam"]) > 0 and np.isfinite(F["motion"][1:]).all()
    hot = F["t"][np.nan_to_num(F["fluid"]) > 3e-4]   # share of the region: a splat is a few px in it
    assert len(hot) and all(min(abs(x - c) for c in (500, 1500, 2500)) <= 80 for x in hot)
    _, sp = cum.fuse(F["t"], {"fluid": F["fluid"]}, {"threshold": 0.3})
    assert [round(s["t_ms"] / 1000 - 0.5) for s in sp] == [0, 1, 2]
