"""motion.stats: the pure core on synthetic block flow, and camera-motion detection on synthetic videos."""
import cv2
import numpy as np
import pytest

from pawtrack import motion

HZ, GH, GW = 15, 9, 16


def flows(n, cam=lambda i: (0.0, 0.0), zoom=lambda i: 0.0, blob=lambda i: (0.0, 0.0), rng=None):
    """(t, blocks): camera translation/zoom per step (flow px) everywhere, plus a moving 2x2 blob in the middle."""
    rng = rng or np.random.default_rng(0)
    X, Y = np.meshgrid((np.arange(GW) + 0.5) / GW - 0.5, ((np.arange(GH) + 0.5) / GH - 0.5) * GH / GW)
    B = np.zeros((n, GH, GW, 2), np.float32)
    for i in range(1, n):
        B[i, ..., 0] = cam(i)[0] + zoom(i) * X * 320
        B[i, ..., 1] = cam(i)[1] + zoom(i) * Y * 320
        B[i, 4:6, 7:9] += blob(i)
        B[i] += rng.normal(0, 0.02, B[i].shape)
    return np.arange(n) * (1000 // HZ), B


def sine_step(amp, f):
    """Per-step displacement of a position amp * sin(2 pi f t)."""
    return lambda i: amp * (np.sin(2 * np.pi * f * i / HZ) - np.sin(2 * np.pi * f * (i - 1) / HZ))


def test_static_and_energy():
    t, B = flows(300, blob=lambda i: (0.0, sine_step(8, 1.0)(i)))
    r = motion.stats_from_flow(t, B, None, {"px_scale": 5.0})
    assert r["camera"]["mode"] == "static" and r["camera"]["p95_px"] < 2, r["camera"]
    assert r["start_ms"] == 0 and len(r["energy"]["v"]) == 20 and len(r["global"]["dx"]) == 300
    heat = np.array(r["heat"])
    assert heat.shape == (8, 8) and np.unravel_index(heat.argmax(), heat.shape)[0] in (3, 4)  # the blob rows


def test_rides_with_stroke_lock():
    t, B = flows(450, cam=lambda i: (0.0, sine_step(4, 1.25)(i)), blob=lambda i: (sine_step(6, 0.6)(i), 0.0))
    c = motion.stats_from_flow(t, B, None, {"px_scale": 5.0})["camera"]
    assert c["mode"] == "rides", c
    assert c["stroke_lock"] and abs(c["stroke_lock"]["rate_hz"] - 1.25) < 0.1 and c["stroke_lock"]["cv"] < 0.25
    assert 30 < c["p95_px"] < 45  # 2 x 4 px x 5 (full res) ~ 40


def test_move_zoom():
    t, B = flows(300, zoom=lambda i: 0.004 if 60 <= i < 180 else 0.0)  # +0.4 % per step for 8 s
    c = motion.stats_from_flow(t, B, None, {})["camera"]
    assert c["mode"] == "move" and c["move_spans"], c
    a, b = c["move_spans"][0]
    assert 2500 <= a <= 5000 and 11000 <= b <= 13500 and c["zoom_pct"] > 30  # edges blur by the 2 s trend


def test_sway_everything_moves_together():
    t, B = flows(450, cam=lambda i: (sine_step(3, 0.7)(i), 0.0))
    B[:, 4:6, 7:9] = B[:, :1, :1]  # the "subject" moves exactly with the camera
    c = motion.stats_from_flow(t, B, None, {"px_scale": 5.0})["camera"]
    assert c["mode"] == "sway" and c["turn_share"] >= 0.9, c


def test_native_rate_input_is_rebinned():
    t, B = flows(600, cam=lambda i: (0.5, 0.0))  # 15 Hz steps of 0.5 px
    t30 = np.arange(1200) * (1000 / 30)
    B30 = np.repeat(B, 2, axis=0) / 2  # the same motion at 30 Hz
    r = motion.stats_from_flow(t30, B30, None, {})
    assert abs(r["global"]["hz"] - 15) < 0.5 and abs(np.median(r["global"]["dx"]) - 0.5) < 0.05


# ---------------------------------------------------------------- videos

W, H, FPS = 320, 240, 30


def _video(path, cam_y, blob_y, n=360, seed=1):
    """Textured world 80 px larger than the frame; the frame window moves by cam_y(i) px, a disc moves by blob_y."""
    rng = np.random.default_rng(seed)
    world = cv2.GaussianBlur(rng.integers(0, 256, (H + 80, W + 80, 3), dtype=np.uint8), (0, 0), 1.5)
    vw = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W, H))
    for i in range(n):
        img = world.copy()
        cv2.circle(img, (W // 2 + 40, int(H // 2 + 40 + blob_y(i))), 25, (40, 220, 250), -1)
        oy = int(round(40 + cam_y(i)))
        vw.write(img[oy:oy + H, 40:40 + W])
    vw.release()
    return str(path)


@pytest.fixture(scope="module")
def vids(tmp_path_factory):
    d = tmp_path_factory.mktemp("cam")
    bob = lambda i: 30 * np.sin(2 * np.pi * 0.8 * i / FPS)
    return {"static": _video(d / "static.mp4", lambda i: 0.0, bob),
            "rides": _video(d / "rides.mp4", lambda i: 12 * np.sin(2 * np.pi * 1.25 * i / FPS), bob)}


def test_camera_detection_on_video(vids):
    st = motion.cmd_stats({"video": vids["static"], "ranges": [{"start_ms": 0, "end_ms": 12000}]}, lambda e: None)
    c = st["ranges"][0]["camera"]
    assert c["mode"] == "static" and c["p95_px"] < 2, c
    rd = motion.cmd_stats({"video": vids["rides"], "ranges": [{"start_ms": 0, "end_ms": 12000}]}, lambda e: None)
    c = rd["ranges"][0]["camera"]
    assert c["mode"] == "rides", c
    assert 18 < c["p95_px"] < 30 and abs(c["rate_hz"] - 1.25) < 0.1, c  # p5..p95 of 12 sin = ~23 px
    r = rd["ranges"][0]
    assert r["end_ms"] == 12000 and len(r["seconds"]) == 12 and r["seconds"][0]["black"] is False
