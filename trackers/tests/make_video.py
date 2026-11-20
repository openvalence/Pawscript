"""Synthesize the test clip: textured blob bobbing vertically (sinusoid) over a static textured
background with per-frame noise; hard cut to a different scene at CUT_FRAME.
Run directly to write tests/synthetic.mp4:  uv run --project trackers python trackers/tests/make_video.py"""
import sys
from pathlib import Path

import cv2
import numpy as np

W, H, FPS, N = 640, 360, 30, 300
CUT_FRAME = 150
FREQ, AMP, CX, CY, R = 0.8, 70, 320, 180, 40
ANCHOR = (320, 30)  # static background point used by the two-point test


def blob_y(t_s):
    return CY + AMP * np.sin(2 * np.pi * FREQ * t_s)


def _texture(rng, h, w, tint):
    tex = cv2.GaussianBlur(rng.integers(0, 256, (h, w, 3), dtype=np.uint8), (0, 0), 2)
    return np.clip(tex * 0.6 + np.array(tint) * 0.4, 0, 255).astype(np.uint8)


def make(path):
    rng = np.random.default_rng(1)
    scenes = [(_texture(rng, H, W, (200, 120, 60)), _texture(rng, 2 * R, 2 * R, (40, 200, 240))),
              (_texture(rng, H, W, (30, 60, 220)), _texture(rng, 2 * R, 2 * R, (240, 240, 40)))]
    disk = np.zeros((2 * R, 2 * R), np.uint8)
    cv2.circle(disk, (R, R), R, 255, -1)
    vw = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W, H))
    assert vw.isOpened()
    for i in range(N):
        bg, blob = scenes[i >= CUT_FRAME]
        img = bg.copy()
        y = int(round(blob_y(i / FPS)))
        roi = img[y - R:y + R, CX - R:CX + R]
        roi[disk > 0] = blob[disk > 0]
        noise = rng.normal(0, 4, img.shape)
        vw.write(np.clip(img + noise, 0, 255).astype(np.uint8))
    vw.release()
    return path


def make_vfr(src, dst, drop=range(30, 60)):
    """Re-encode src without the frames in `drop`, keeping original PTS -> a 1 s timestamp gap
    (variable frame rate). PyAV, because cv2.VideoWriter can only write constant frame rate."""
    import av
    from fractions import Fraction
    with av.open(str(src)) as i, av.open(str(dst), "w") as o:
        s = o.add_stream("mpeg4", rate=FPS)
        s.width, s.height, s.pix_fmt = W, H, "yuv420p"
        s.codec_context.time_base = Fraction(1, FPS)
        for n, f in enumerate(i.decode(video=0)):
            if n in drop:
                continue
            g = av.VideoFrame.from_ndarray(f.to_ndarray(format="bgr24"), format="bgr24")
            g.pts, g.time_base = n, Fraction(1, FPS)
            o.mux(s.encode(g))
        o.mux(s.encode())
    return dst


LOOP_P, LOOP_CYCLES, LOOP_FPS = 24, 10, 24  # 24-frame cycle = 12 drawings shown on twos


def loop_y(i):
    """Blob centre y at frame i of the loop clip: drawing d = (i mod P) // 2 (held for 2 frames)."""
    return CY + AMP * np.sin(2 * np.pi * ((i % LOOP_P) // 2) / (LOOP_P // 2))


def make_loop(path, frame_noise=0.0):
    """Perfect loop animated on twos: every drawing is pixel-identical in every cycle (its noise is
    seeded by the drawing), so only the codec makes cycles differ. frame_noise > 0 adds fresh noise
    to every frame (cycles and held frames no longer identical) for the folding test."""
    rng = np.random.default_rng(2)
    bg, blob = _texture(rng, H, W, (90, 160, 90)), _texture(rng, 2 * R, 2 * R, (230, 80, 200))
    disk = np.zeros((2 * R, 2 * R), np.uint8)
    cv2.circle(disk, (R, R), R, 255, -1)
    vw = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), LOOP_FPS, (W, H))
    assert vw.isOpened()
    for i in range(LOOP_P * LOOP_CYCLES):
        d = (i % LOOP_P) // 2
        img = bg.copy()
        y = int(round(loop_y(i)))
        roi = img[y - R:y + R, CX - R:CX + R]
        roi[disk > 0] = blob[disk > 0]
        cv2.rectangle(img, (40 + 30 * d, 300), (70 + 30 * d, 330), (20, 20, 20), -1)  # 2nd part, breaks symmetry
        img = img + np.random.default_rng(100 + d).normal(0, 3, img.shape)
        if frame_noise:
            img = img + rng.normal(0, frame_noise, img.shape)
        vw.write(np.clip(img, 0, 255).astype(np.uint8))
    vw.release()
    return path


ROD_W, ROD_L, OCC_X, ROD_Y = 30, 240, 420, 180  # rod slides right, under an opaque occluder at x >= OCC_X


def rod_left(i):
    return 200 + 110 * np.sin(2 * np.pi * FREQ * i / FPS)  # 90..310 px


def rod_visible_len(i):
    return float(np.clip(OCC_X - round(rod_left(i)), 0, ROD_L))


def make_rod(path):
    """Textured rod sliding into an occluder: its visible length (rod_visible_len) is known."""
    rng = np.random.default_rng(3)
    bg, rod = _texture(rng, H, W, (200, 120, 60)), _texture(rng, ROD_W, ROD_L, (40, 200, 240))
    occ = _texture(rng, H, W - OCC_X, (60, 60, 200))
    vw = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W, H))
    assert vw.isOpened()
    for i in range(N // 2):
        img = bg.copy()
        x = int(round(rod_left(i)))
        img[ROD_Y - ROD_W // 2:ROD_Y + ROD_W // 2, x:x + ROD_L] = rod
        img[:, OCC_X:] = occ
        vw.write(np.clip(img + rng.normal(0, 4, img.shape), 0, 255).astype(np.uint8))
    vw.release()
    return path


if __name__ == "__main__":
    print(make(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name("synthetic.mp4")))
