"""Camera motion before tracking (CPU, < 1 ms/frame): per consecutive frame pair at the cut detector's 160 px grey, a
global similarity (translation of the frame centre + scale) from Shi-Tomasi corners, pyramidal LK and a RANSAC
partial-affine fit (inlier share = confidence), plus the median motion of the border ring and of the centre (central
half x half); with too few corners (flat animation backgrounds) phase correlation gives the translation (whole frame,
and the centre crop) alone, its response = confidence.

Held frames (animation on twos / threes, or a static shot): a frame whose 99th-percentile grey difference to the last
new drawing is under HELD is not estimated; the next new drawing is compared with that drawing and the motion is spread
evenly over the frames in between, so 0, 0, x stays a steady x / 3 per frame (and a slow pan is measured over a longer,
more precise baseline). The cut detector's frames reset it (cut()).

Two natures (classify()): over a centred NET_MS window (a few stroke periods), the NET displacement (mean velocity, frame
sizes / s; log scale / s for zoom) against the OSCILLATION about it (RMS of the camera path minus its moving average,
frame sizes):
  progressive  net >= its threshold: zoom (radial: scale), orbit (the border streams past while the centre stays put:
               a turntable around the action), pan (border and centre agree; a tilt is a pan 'up' / 'down'). A
               progressive segment that also bobs carries recip_amp.
  reciprocal   no net motion, oscillation >= OSC and periodic (velocity autocorrelation peak >= PERIODIC between 0.2
               and 2.5 s): the camera rides the stroke. Its path IS a stroke signal. Never splits a scene.
  handheld     no net motion, oscillation >= OSC, not periodic.
  static       neither.
A moving kind holds while its measure stays above EXIT x its threshold (hysteresis); runs shorter than MIN_MS merge into
a neighbour. Segments {t0, t1, kind, dir?, amount, recip_amp?}:
  pan / orbit  dir = where the CAMERA goes (content moving left = 'right'), amount = net travel in frame sizes
               (orbit: of the border)
  zoom         dir 'in' | 'out', amount = scale factor over the segment (end / start, > 1 = in)
  reciprocal   dir 'vertical' | 'horizontal' (main axis of the bob), amount = oscillation RMS (frame sizes)
  handheld     amount = oscillation RMS (frame sizes)
  static       amount = mean net speed (frame sizes / s)
Thresholds: tuned on the gold set against the CoTracker grids' camera and the reference scripts (eval/camera_eval.py).
"""
import math

import cv2
import numpy as np

from pawtrack.scenes import SCAN_WIDTH, keep_pixels

HELD = 4.0        # grey levels, 99th pct |diff| (loops.held_from_diffs' floor): below = the same drawing
NET_MS = 1000     # window for net motion and oscillation (a few stroke periods)
PAN = 0.06        # net speed, frame sizes / s
ZOOM = 0.08       # net zoom, log scale / s
ORBIT = 0.4       # orbit: centre speed < ORBIT x border speed
OSC = 0.008       # oscillation RMS, frame sizes (border ring path)
PERIODIC = 0.3    # velocity autocorrelation peak that makes an oscillation reciprocal
EXIT = 0.6        # hysteresis: a moving kind holds above EXIT x its threshold
MIN_MS = 400      # shortest segment
MIN_CONF = 0.25   # estimates below count as no motion
KINDS = ("static", "reciprocal", "pan", "zoom", "orbit", "handheld")
PROGRESSIVE = ("pan", "zoom", "orbit", "handheld")  # these split a scene (handheld too: the shot is not steady)


def _grey(img):
    if img.shape[1] > SCAN_WIDTH:
        img = cv2.resize(img, (SCAN_WIDTH, max(2, img.shape[0] * SCAN_WIDTH // img.shape[1])), interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img


def estimate(a, b, pa=None, keep=None):
    """Grey uint8 frames a -> b: [dx, dy] px of the frame centre (content motion), log scale (> 0 = content grows),
    confidence 0..1 (inlier share of one global similarity), then the median motion [bx, by] of the border ring (outside
    the central half x half) and [cx, cy] of the centre (NaN with < 4 points there). pa = a's corners
    (goodFeaturesToTrack), computed when None; keep (optional, uint8 255 = use, the frame's size): where corners may be."""
    h, w = a.shape
    if pa is None:
        pa = cv2.goodFeaturesToTrack(a, 200, 0.01, 4, blockSize=5, mask=keep)
    if pa is not None and len(pa) >= 12:
        pb, st, _ = cv2.calcOpticalFlowPyrLK(a, b, pa, None, winSize=(15, 15), maxLevel=3)
        ok = st.ravel() == 1
        if ok.sum() >= 12:
            M, inl = cv2.estimateAffinePartial2D(pa[ok], pb[ok], method=cv2.RANSAC, ransacReprojThreshold=1.0)
            if M is not None and inl.sum() >= 8:
                c = np.array([w / 2, h / 2])
                d = M[:, :2] @ c + M[:, 2] - c
                p0, p1 = pa[ok].reshape(-1, 2), pb[ok].reshape(-1, 2)
                mid = (np.abs(p0[:, 0] - w / 2) < w / 4) & (np.abs(p0[:, 1] - h / 2) < h / 4)
                med = lambda s: np.median(p1[s] - p0[s], 0) if s.sum() >= 4 else np.full(2, np.nan)
                return [float(d[0]), float(d[1]), math.log(max(1e-6, math.hypot(M[0, 0], M[1, 0]))),
                        float(inl.sum()) / len(pa), *med(~mid), *med(mid)]
    (dx, dy), r = cv2.phaseCorrelate(a.astype(np.float32), b.astype(np.float32), _hann(a.shape))
    ca, cb = a[h // 4:h - h // 4, w // 4:w - w // 4], b[h // 4:h - h // 4, w // 4:w - w // 4]
    (cx, cy), _ = cv2.phaseCorrelate(ca.astype(np.float32), cb.astype(np.float32), _hann(ca.shape))
    return [float(dx), float(dy), 0.0, float(r), float(dx), float(dy), float(cx), float(cy)]


_HANN = {}


def _hann(shape):
    if shape not in _HANN:
        _HANN[shape] = cv2.createHanningWindow(shape[::-1], cv2.CV_32F)
    return _HANN[shape]


class CameraDetector:
    """Call once per frame, in order (cut() at each hard cut); then segments(t0, t1) per scene."""

    def __init__(self, mask=None):
        """mask: optional ignore grid (scenes.keep_pixels; True = ignore): no corner is taken there, so a burnt-in logo
        never votes "static" during a pan."""
        self.t, self.m = [], []  # m: per frame [dx / w, dy / h, log scale, conf, bx / w, by / h, cx / w, cy / h] (estimate())
        self.ref = self.pa = None
        self.pend = 0
        self.mask, self.keep = mask, None

    def cut(self):
        self.ref = None

    def __call__(self, t_ms, img):
        g = _grey(img)
        self.t.append(t_ms)
        self.m.append([0.0] * 8)
        if self.ref is None or self.ref.shape != g.shape:
            self.ref, self.pa, self.pend = g, None, 0
            return
        self.pend += 1
        if np.percentile(cv2.absdiff(g, self.ref), 99) < HELD:
            return  # held: filled in when the drawing changes
        if self.mask is not None and (self.keep is None or self.keep.shape != g.shape):
            k = keep_pixels(self.mask, g.shape)
            self.keep = None if k is None else k.astype(np.uint8) * 255
        if self.pa is None:
            self.pa = cv2.goodFeaturesToTrack(self.ref, 200, 0.01, 4, blockSize=5, mask=self.keep)
        e = estimate(self.ref, g, self.pa, self.keep)
        h, w = g.shape
        n = self.pend
        row = [e[0] / w / n, e[1] / h / n, e[2] / n, e[3], e[4] / w / n, e[5] / h / n, e[6] / w / n, e[7] / h / n]
        for k in range(len(self.m) - n, len(self.m)):
            self.m[k] = row
        self.ref, self.pa, self.pend = g, None, 0

    def motion(self, t0=-math.inf, t1=math.inf):
        """-> (t (n,), m (n, 8)) of the frames in [t0, t1)."""
        t = np.asarray(self.t, float)
        sel = (t >= t0) & (t < t1)
        return t[sel], np.asarray(self.m, float).reshape(-1, 8)[sel]

    def segments(self, t0, t1):
        t, m = self.motion(t0, t1)
        return classify(t, m, t1)


def _smooth(x, k):
    if k <= 1 or len(x) < 2:
        return x.copy()
    pad = np.pad(x, (k // 2, k - 1 - k // 2), mode="edge")
    return np.convolve(pad, np.ones(k) / k, mode="valid")


def measures(t, m):
    """Per frame, over the NET_MS window: net velocity vx, vy (frame sizes / s) and speed, zoom rate z (log / s), border
    and centre speed, osc (frame sizes), plus dt (s), the per-second velocity v (n, 2) and the camera path."""
    n = len(t)
    dt = float(np.median(np.diff(t))) / 1000 if n > 1 else 1 / 30
    dt = dt if dt > 0 else 1 / 30
    k = max(1, int(round(NET_MS / 1000 / dt)))
    ok = m[:, 3] >= MIN_CONF
    g = np.where(ok[:, None], m[:, :3], 0.0)
    b = np.where(ok[:, None] & np.isfinite(m[:, 4:6]), m[:, 4:6], g[:, :2])
    c = np.where(ok[:, None] & np.isfinite(m[:, 6:8]), m[:, 6:8], g[:, :2])
    sm = lambda x: np.stack([_smooth(x[:, j], k) for j in range(x.shape[1])], 1) / dt
    vs, bs, cs = sm(g), sm(b), sm(c)
    path = np.cumsum(b, 0)  # the camera path: the border ring's (background, more often than the centre)
    trend = np.stack([_smooth(path[:, j], k) for j in range(2)], 1)
    osc = np.sqrt(_smooth(((path - trend) ** 2).sum(1), k))
    return {"vx": vs[:, 0], "vy": vs[:, 1], "z": vs[:, 2], "speed": np.hypot(vs[:, 0], vs[:, 1]),
            "border": np.hypot(bs[:, 0], bs[:, 1]), "centre": np.hypot(cs[:, 0], cs[:, 1]), "bx": bs[:, 0], "by": bs[:, 1],
            "osc": osc, "dt": dt, "v": b / dt, "path": path}


def periodic(v, dt):
    """Velocity (n, 2) -> peak of its normalised autocorrelation (on the main axis) between 0.2 and 2.5 s lag."""
    if len(v) < 8:
        return 0.0
    c = v - v.mean(0)
    u = np.linalg.eigh(c.T @ c)[1][:, -1]
    x = c @ u
    if not x.any():
        return 0.0
    ac = np.correlate(x, x, "full")[len(x) - 1:] / (x @ x)
    lo, hi = max(1, int(0.2 / dt)), min(len(x) - 1, int(2.5 / dt))
    return float(ac[lo:hi + 1].max()) if hi >= lo else 0.0


I = {k: i for i, k in enumerate(KINDS)}


def labels(t, m):
    """Per-frame kind (index into KINDS) with hysteresis and min durations; -> (labels, measures | None)."""
    n = len(t)
    if n == 0:
        return np.zeros(0, int), None
    q = measures(t, m)
    if t[-1] - t[0] < NET_MS:  # shorter than the window: too little to tell a camera move from noise
        return np.zeros(n, int), q
    mov = np.maximum(q["speed"], q["border"]) / PAN
    orbit = (q["centre"] < ORBIT * q["border"]) & (q["border"] >= EXIT * PAN)
    val = {I["zoom"]: np.abs(q["z"]) / ZOOM, I["orbit"]: np.where(orbit, q["border"] / PAN, 0.0),
           I["pan"]: np.where(orbit, 0.0, mov), I["handheld"]: q["osc"] / OSC}
    order = (I["zoom"], I["orbit"], I["pan"], I["handheld"])
    lab, cur = np.zeros(n, int), 0
    for i in range(n):
        if cur and val[cur][i] >= EXIT:
            lab[i] = cur
            continue
        cur = next((k for k in order if val[k][i] >= 1.0), 0)
        lab[i] = cur
    min_n = max(1, int(round(MIN_MS / 1000 / q["dt"])))
    while True:  # merge the shortest too-short run into its longer neighbour
        runs = _runs(lab)
        short = [r for r in runs if r[2] - r[1] < min_n]
        if not short or len(runs) == 1:
            break
        k, a, b = min(short, key=lambda r: r[2] - r[1])
        i = runs.index((k, a, b))
        nb = [runs[j] for j in (i - 1, i + 1) if 0 <= j < len(runs)]
        lab[a:b] = max(nb, key=lambda r: r[2] - r[1])[0]
    for k, a, b in _runs(lab):  # an oscillation without net motion: periodic = reciprocal, else handheld
        if k == I["handheld"] and periodic(q["v"][a:b], q["dt"]) >= PERIODIC:
            lab[a:b] = I["reciprocal"]
    return lab, q


def _runs(lab):
    out, a = [], 0
    for i in range(1, len(lab) + 1):
        if i == len(lab) or lab[i] != lab[a]:
            out.append((int(lab[a]), a, i))
            a = i
    return out


def classify(t, m, t_end=None):
    """Frames t (ms), motion m (n, 8) -> segments [{t0, t1, kind, dir?, amount, recip_amp?}] tiling [t[0], t_end)."""
    lab, q = labels(t, m)
    if q is None:
        return []
    t_end = t_end if t_end is not None else t[-1] + 1000 * q["dt"]
    out, dt = [], q["dt"]
    for k, a, b in _runs(lab):
        kind = KINDS[k]
        s = {"t0": int(t[a]), "t1": int(t[b]) if b < len(t) else int(t_end), "kind": kind}
        osc = round(float(np.sqrt(np.mean(q["osc"][a:b] ** 2))), 4)
        if kind in ("pan", "orbit"):
            vx, vy = (q["bx"], q["by"]) if kind == "orbit" else (q["vx"], q["vy"])
            dx, dy = vx[a:b].sum() * dt, vy[a:b].sum() * dt
            s["dir"] = ("right" if dx < 0 else "left") if abs(dx) >= abs(dy) else ("up" if dy > 0 else "down")
            s["amount"] = round(math.hypot(dx, dy), 3)
        elif kind == "zoom":
            z = q["z"][a:b].sum() * dt
            s["dir"], s["amount"] = ("in" if z > 0 else "out"), round(math.exp(z), 3)
        elif kind == "reciprocal":
            sd = q["path"][a:b].std(0)
            s["dir"], s["amount"] = ("vertical" if sd[1] > sd[0] else "horizontal"), osc
        elif kind == "handheld":
            s["amount"] = osc
        else:
            s["amount"] = round(float(q["speed"][a:b].mean()), 3)
        if kind in ("pan", "zoom", "orbit") and osc >= OSC:
            s["recip_amp"] = osc
        out.append(s)
    return out


def dominant(segs):
    """The kind covering most of the segments' time, None for none."""
    tot = {}
    for s in segs:
        tot[s["kind"]] = tot.get(s["kind"], 0) + s["t1"] - s["t0"]
    return max(tot, key=tot.get) if tot else None


def split_scenes(scenes, cam, min_ms):
    """Scenes [{start_ms, end_ms, kind?, transition?}] (scenes.CutDetector.finish) -> the same split where the camera
    turns progressive or steady again (a boundary between static and reciprocal never splits: a camera riding the
    stroke is the same steady shot), each piece >= min_ms. Each piece: the scene's fields and its camera segments;
    pieces after a scene's first continue it (continues: true, split: 'camera': same shot, the camera moved); the
    scene's transition in stays on its first piece, out on its last, None between pieces."""
    out = []
    for sc in scenes:
        a, b = sc["start_ms"], sc["end_ms"]
        segs = cam.segments(a, b)
        cuts, last = [], a
        for p, s in zip(segs, segs[1:]):
            if (p["kind"] in PROGRESSIVE or s["kind"] in PROGRESSIVE) and s["t0"] - last >= min_ms and b - s["t0"] >= min_ms:
                cuts.append(s["t0"])
                last = s["t0"]
        for j, (x, y) in enumerate(zip([a, *cuts], [*cuts, b])):
            piece = [{**s, "t0": max(s["t0"], x), "t1": min(s["t1"], y)} for s in segs if s["t1"] > x and s["t0"] < y]
            o = {**sc, "start_ms": x, "end_ms": y, "camera": piece, **({"continues": True, "split": "camera"} if j else {})}
            if "transition" in sc and cuts:
                tr = dict(sc["transition"])
                if j:
                    tr["in"] = None
                    tr.pop("in_ms", None)
                if j < len(cuts):
                    tr["out"] = None
                    tr.pop("out_ms", None)
                o["transition"] = tr
            out.append(o)
    return out
