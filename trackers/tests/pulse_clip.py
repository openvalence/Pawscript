"""A synthetic orgasm clip for pawtrack/pulse.py: a textured body on a textured background, thrusting (translation)
and zooming, with a dark round opening that contracts on known frames (a radial pull of the texture around it: fast
in, slower out), plus per-frame noise; optionally on twos. Numbers only (tests and experiments/pulse)."""
import cv2
import numpy as np

W, H, FPS = 480, 360, 24
AX, AY, R0 = 240.0, 200.0, 11.0   # the opening, in body coordinates (= frame coordinates at rest), radius px


def _texture(rng, h, w, blur, lo, hi):
    x = cv2.GaussianBlur(rng.uniform(0, 1, (h, w)).astype(np.float32), (0, 0), blur)
    x = (x - x.min()) / max(1e-6, np.ptp(x))
    return lo + (hi - lo) * x


def strength(n, onsets, amps, tau_ms=220.0):
    """Contraction strength per frame: a jump to amp on the onset frame, exponential release (fast in, slower out)."""
    s = np.zeros(n)
    t = np.arange(n) * 1000.0 / FPS
    for k, a in zip(onsets, amps):
        s[k:] = np.maximum(s[k:], a * np.exp(-(t[k:] - t[k]) / tau_ms))
    return s


def render(path, n=240, onsets=(), amps=(), thrust_px=25.0, thrust_hz=1.3, zoom=0.25, noise=3.0, twos=False, seed=0):
    """Write the clip; -> times (ms) of the onset frames. zoom: total scale change over the clip (linear)."""
    rng = np.random.default_rng(seed)
    bg = np.dstack([_texture(rng, H, W, 3, 40, 120)] * 3)
    tex = np.dstack([_texture(rng, H, W, 1.5, 120, 220), _texture(rng, H, W, 1.5, 100, 180), _texture(rng, H, W, 1.5, 110, 200)])
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    rr = np.hypot(xx - AX, yy - AY)
    hole = np.clip((R0 - rr) / 2.0 + 0.5, 0, 1)[..., None]
    skin = tex * (1 - hole) + 25 * hole                                     # the opening: dark
    skin = skin * (1 - 0.35 * np.exp(-((rr - R0 * 1.4) / 3.0) ** 2))[..., None]   # a darker rim around it
    body = ((xx - W / 2) / 170) ** 2 + ((yy - H / 2 - 10) / 135) ** 2 <= 1
    st = strength(n, onsets, amps)
    vw = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W, H))
    frame = None
    for i in range(n):
        if not (twos and i % 2):
            g = 1 - st[i] * np.exp(-(rr / (1.6 * R0)) ** 2)                     # radial pull (the pucker, inside POLY): sample farther out
            mx, my = AX + (xx - AX) / g, AY + (yy - AY) / g
            img = np.where(body[..., None], cv2.remap(skin.astype(np.float32), mx.astype(np.float32), my.astype(np.float32), cv2.INTER_LINEAR), bg)
            s = 1 + zoom * i / max(1, n - 1)
            dx = thrust_px * np.sin(2 * np.pi * thrust_hz * i / FPS)
            A = np.array([[s, 0, (1 - s) * W / 2 + dx], [0, s, (1 - s) * H / 2 + 0.4 * dx]], np.float32)
            img = cv2.warpAffine(img.astype(np.float32), A, (W, H), borderMode=cv2.BORDER_REFLECT)
            frame = img
        out = np.clip(frame + rng.normal(0, noise, frame.shape), 0, 255).astype(np.uint8)
        vw.write(out)
    vw.release()
    return [(k + (twos and k % 2)) * 1000.0 / FPS for k in onsets]   # on twos a contraction shows on the next drawing


POLY = [[(AX + 1.6 * R0 * np.cos(a)) / W, (AY + 1.6 * R0 * np.sin(a)) / H] for a in np.linspace(0, 2 * np.pi, 16, endpoint=False)]


def dark_masks(crops, seed, roi, p):
    """A perfect stand-in for SAM on this clip: the dark opening (grey < 70), the component nearest the crop centre."""
    out = []
    for c in crops:
        g = cv2.cvtColor(c, cv2.COLOR_BGR2GRAY)
        m = (g < 70).astype(np.uint8)
        n, lab, stats, cen = cv2.connectedComponentsWithStats(m)
        if n < 2:
            out.append(None)
            continue
        h, w = g.shape
        k = 1 + int(np.argmin([np.hypot(*(cen[j] - [w / 2, h / 2])) for j in range(1, n)]))
        out.append(lab == k)
    return out, np.ones(len(crops))


def score(found, truth, tol_ms):
    """-> (tp, fp, fn, offsets ms of the matched ones); greedy nearest within tol_ms."""
    f, used, off = sorted(found), set(), []
    for t in truth:
        c = [(abs(x - t), j) for j, x in enumerate(f) if j not in used and abs(x - t) <= tol_ms]
        if c:
            j = min(c)[1]
            used.add(j)
            off.append(f[j] - t)
    return len(off), len(f) - len(used), len(truth) - len(off), off
