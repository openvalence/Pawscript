"""Contraction pulses of a painted region -> spurt evidence (PROTOCOL v4.16: `cum` with `groups`).

Owner 2026-11-09: "anus contraction with sam to track spurts too". In an orgasm the anus (also balls, sheath) visibly
contracts once per spurt. For each pulse group (a Groups-tool polygon on one frame), over the pulse range only (the
orgasm span + MARGIN_MS each side; SAM is the expensive part, never the whole video):

 1. body()   CPU. Lucas-Kanade at BODY_W px wide from the painted frame across the range. The corners in a ring around
             the region (the body it sits on) give a similarity per frame: where the region went, and how much the
             camera zoomed / the body came closer (its scale). The region's own corners, against that motion, give its
             residual log scale (mean radial convergence): the CPU fallback signal. Plus held-frame flags.
 2. sam()    SAM 2.1 video propagation (trackers/sam2_mask.track) on a fixed crop around the region's path, seeded on
             the range frame nearest the painted one with the polygon (moved there by step 1) as box + positive points
             inside, negatives at the neighbouring groups' centres; forward and backward from that frame. Per frame:
             mask area, the dark interior (pixels under the seed frame's Otsu split inside the mask: the opening),
             compactness.
 3. signal() log area (and log dark area when an opening is visible) minus 2 log body scale, minus a moving median
             over TREND_MS (the region's own slow trend), over its robust sigma; averaged; signed so the fast phase
             (the contraction) is positive.
 4. events() peaks of that signal, prominent against the local noise, with a fast rise, at most one per MIN_INTERVAL_MS,
             timed on the drawing where the contraction appears (+ offset_ms), then the train rule (TRAIN_*).

run() -> per group {name, source "sam" | "points", t, pulse, events, ...}; cum.merge fuses the events with the other cues.
Pure parts (CPU, tested on synthetic clips): body, signal, events, crop_box, prompt.
"""
import math

import numpy as np

WHO_NAME = {"c1": "Bottom", "c2": "Top", "x": "Extra"}  # the stored ids as people read them (groups.js WHO_NAME)
MARGIN_MS = 1000        # pulse range = the orgasm span +- this (the trend needs context on both sides)
BODY_W = 640            # px width of the LK pass
RES_PX = 24             # the fallback's dense flow runs at >= this many px per region radius (upsampled crop)
RING = (2.0, 4.0)       # the body ring around the region: from / to these multiples of its equivalent radius (clear of the pucker)
CROP_PAD = 1.0          # SAM crop = the region's path + this many region sizes on each side ...
CROP_MIN = 0.12         # ... and at least this share of the frame height per side
CROP_W = 512            # crops are resized to at most this many px per side before SAM (it resamples to 1024 anyway)
TREND_MS = 1500         # moving median: the region's slow trend (a contraction lasting < TREND_MS / 2 stays out of it)
NOISE_MS = 4000         # window of the local noise (MAD) the prominence is measured against
# Spurt rates. The brief said roughly 0.5..3 Hz; the one clip with hand-placed spurts (the trace-2 clip, 7 shots) has intervals
# 1.8..3.5 s (0.29..0.55 Hz), so the band runs down to 0.25 Hz. Above 3 Hz two peaks are one contraction.
MIN_INTERVAL_MS = 333   # 3 Hz
MAX_INTERVAL_MS = 4000  # 0.25 Hz
RISE_MAX_MS = 400       # the contraction (fast phase): at least half of the rise within this before the peak
K_WEAK = 3.5            # height over the trend, in local sigma: a candidate ...
K_STRONG = 5.0          # ... a shot on its own (inside a train) ...
K_FULL = 10.0           # ... score 1
TRAIN_GAP_MS = 5000     # shots further apart than this are separate trains
MIN_TRAIN = 2           # a lone strong pulse (no other candidate within TRAIN_GAP_MS) is a blip, not a shot
WEAK_GROW = (0.8, 1.6)  # a weak candidate continues a train when its gap is this x the train's last interval (trace-2 clip: x0.9..1.25) ...
WEAK_DECAY = 1.5        # ... and it is at most this x the last shot's height (spurts weaken)
SKEW_MIN = 0.3          # sign auto: flip only when the step distribution says so clearly
PULSE_PARTS = ("anus", "balls", "sheath", "penis")  # parts the Groups tool lets the owner flag as pulse (anus by default)


# ---------------------------------------------------------------- pure (CPU)

def _fill(x):
    """NaN -> linear interpolation (edges held); all-NaN -> zeros."""
    x = np.asarray(x, float)
    ok = np.isfinite(x)
    if ok.sum() < 2:
        return np.zeros_like(x)
    return np.interp(np.arange(len(x)), np.flatnonzero(ok), x[ok])


def _dt(t):
    return float(np.median(np.diff(t))) if len(t) > 1 else 40.0


def moving_median(t, x, ms):
    from scipy.ndimage import median_filter
    k = max(3, int(round(ms / max(_dt(t), 1))) | 1)
    return median_filter(_fill(x), size=k, mode="reflect")


def robust_sigma(x):
    x = np.asarray(x, float)
    x = x[np.isfinite(x)]
    return max(1.4826 * float(np.median(np.abs(x - np.median(x)))) if len(x) else 0.0, 1e-9)


def local_sigma(t, x, ms=NOISE_MS):
    """Robust sigma (1.4826 MAD about the local median) in a centred window of ms, per sample."""
    from scipy.ndimage import median_filter
    x = _fill(x)
    k = max(3, int(round(ms / max(_dt(t), 1))) | 1)
    dev = np.abs(x - median_filter(x, size=k, mode="reflect"))
    return np.maximum(1.4826 * median_filter(dev, size=k, mode="reflect"), 0.2 * robust_sigma(x) + 1e-9)


def signal(t, area, dark=None, scale=None, sign="auto"):
    """Per-frame contraction signal (sigma units, > 0 = contracted) from mask area (any units, > 0; NaN = lost), the
    dark interior area (optional) and the body scale (linear, 1 = as on the seed frame; area ~ scale^2). sign: 'auto'
    = the fast phase is the contraction (skew of the frame steps), '-' = smaller is contracted, '+' = larger.
    -> (signal, sign used '-' | '+')."""
    t = np.asarray(t, float)
    parts = []
    for x in (area, dark):
        if x is None:
            continue
        x = np.asarray(x, float).copy()
        x[~(x > 0)] = np.nan
        if not np.isfinite(x).any():
            continue
        x = np.log(x)
        if scale is not None:
            s = np.asarray(scale, float)
            x = x - 2 * np.log(np.where(s > 0, s, np.nan))
        lost = ~np.isfinite(x)
        x = _fill(x) - moving_median(t, x, TREND_MS)
        x = x / robust_sigma(x)
        x[lost] = np.nan
        parts.append(x)
    if not parts:
        return np.full(len(t), np.nan), "-"
    with np.errstate(all="ignore"):
        x = np.nanmean(np.vstack(parts), 0) if len(parts) > 1 else parts[0]
    c = -x
    used = "-"
    if sign == "+" or (sign == "auto" and _skew(np.diff(_fill(c))) < -SKEW_MIN):
        c, used = x, "+"
    return c, used


def _skew(d):
    d = d[np.isfinite(d)]
    if len(d) < 8:
        return 0.0
    s = d.std()
    return float(((d - d.mean()) ** 3).mean() / s ** 3) if s > 0 else 0.0


def events(t, c, new=None, offset_ms=0.0):
    """Contraction events on signal c (signal()) at times t (ms). new: bool per frame, True where a new drawing appears
    (loops.held_frames; None = every frame new). -> [{"t_ms", "score" 0..1, "z" (height in local sigma), "weak"}] by time.
    A candidate = a peak of c (scipy find_peaks, >= MIN_INTERVAL_MS apart) whose height over the trend (c is detrended)
    is >= K_WEAK local sigma and that rises fast (>= half of its height within RISE_MAX_MS before it). Height, not
    peak-to-trough prominence: in noise alone a 4 s window's peak-to-trough reaches 4-6 sigma every few seconds.
    Its time = the drawing where the contraction appears: the frame of the steepest rise before the peak, moved to the
    new-drawing frame with the biggest step within one drawing of it, + offset_ms.
    Train rule: strong candidates (>= K_STRONG) within TRAIN_GAP_MS of each other form a train; a train needs MIN_TRAIN
    shots (a weak candidate within TRAIN_GAP_MS counts as the second); a train is continued, forward and backward, by
    weak candidates whose gap is WEAK_GROW x the neighbouring interval and that are not stronger than WEAK_DECAY x the
    shot next to them. Nothing is added that is not a candidate. score = z / K_FULL, capped at 1."""
    from scipy.signal import find_peaks
    t = np.asarray(t, float)
    raw = np.asarray(c, float)
    if len(t) < 5 or not np.isfinite(raw).any():
        return []
    x = _fill(raw)
    dt = _dt(t)
    sig = local_sigma(t, x)
    pk, _ = find_peaks(x, distance=max(1, int(round(MIN_INTERVAL_MS / dt))))
    new = np.ones(len(t), bool) if new is None else np.asarray(new, bool)
    rise_n = max(1, int(round(RISE_MAX_MS / dt)))
    step = np.r_[0.0, np.diff(x)]
    cand = []
    for i in pk:
        k = x[i] / sig[i]
        if k < K_WEAK or not np.isfinite(raw[i]):
            continue
        lo = max(0, i - rise_n)
        if x[i] - x[lo:i + 1].min() < 0.5 * x[i]:
            continue  # a slow swell, not a contraction
        j = lo + 1 + int(np.argmax(step[lo + 1:i + 1])) if i > lo else i
        nb = [q for q in range(max(1, j - 2), min(len(t), j + 3)) if new[q]]
        if nb:
            j = max(nb, key=lambda q: step[q])
        if cand and cand[-1]["t"] == float(t[j]):  # two peaks on one rise: the stronger
            cand[-1]["k"] = max(cand[-1]["k"], float(k))
            continue
        cand.append({"i": i, "t": float(t[j]), "k": float(k)})
    return _train(cand, offset_ms)


def _train(cand, offset_ms=0.0):
    cand = sorted(cand, key=lambda c: c["t"])
    n = len(cand)
    keep = {i for i in range(n) if cand[i]["k"] >= K_STRONG and
            any(j != i and abs(cand[j]["t"] - cand[i]["t"]) <= TRAIN_GAP_MS for j in range(n))}
    changed = True
    while changed:  # continue each train by the next candidate beyond its ends while it fits the rhythm
        changed = False
        ks = sorted(keep)
        runs = [[ks[0]]] if ks else []
        for i in ks[1:]:
            (runs[-1].append(i) if cand[i]["t"] - cand[runs[-1][-1]]["t"] <= TRAIN_GAP_MS else runs.append([i]))
        for r in runs:
            for end, nxt, ref in ((r[-1], r[-1] + 1, r[-2] if len(r) > 1 else None),
                                  (r[0], r[0] - 1, r[1] if len(r) > 1 else None)):
                if not 0 <= nxt < n or nxt in keep:
                    continue
                g = abs(cand[nxt]["t"] - cand[end]["t"])
                if g > TRAIN_GAP_MS:
                    continue
                if ref is None:  # a lone strong shot: its nearest candidate is the second of the train
                    ok = True
                elif nxt > end:  # later: spurts slow down and weaken
                    g0 = cand[end]["t"] - cand[ref]["t"]
                    ok = WEAK_GROW[0] * g0 <= g <= WEAK_GROW[1] * g0 and cand[nxt]["k"] <= WEAK_DECAY * cand[end]["k"]
                else:  # earlier: a shorter interval
                    g0 = cand[ref]["t"] - cand[end]["t"]
                    ok = g <= WEAK_GROW[1] * g0 / 1.5
                if ok:
                    keep.add(nxt)
                    changed = True
    return [{"t_ms": int(round(cand[i]["t"] + offset_ms)), "score": round(min(1.0, cand[i]["k"] / K_FULL), 3),
             "z": round(cand[i]["k"], 2), "weak": cand[i]["k"] < K_STRONG} for i in sorted(keep)]


def crop_box(polys, W, H, pad=CROP_PAD, min_frac=CROP_MIN):
    """Polygons in frame px (the region moved through the range) -> the crop (x0, y0, x1, y1) in px: their union box
    plus pad x the region's size on each side, at least min_frac x H per side, clamped to the frame."""
    P = np.concatenate([np.asarray(p, float) for p in polys])
    x0, y0 = P.min(0)
    x1, y1 = P.max(0)
    sz = max(np.ptp(np.asarray(polys[0], float)[:, 0]), np.ptp(np.asarray(polys[0], float)[:, 1]), 1.0)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    hw = max((x1 - x0) / 2 + pad * sz, min_frac * H / 2)
    hh = max((y1 - y0) / 2 + pad * sz, min_frac * H / 2)
    return (int(max(0, cx - hw)), int(max(0, cy - hh)), int(min(W, math.ceil(cx + hw))), int(min(H, math.ceil(cy + hh))))


def prompt(poly, others, w, h):
    """The SAM prompt on a crop of w x h px: poly (crop px) -> {"kind": "box", x, y, w, h (0..1), "points", "labels"}:
    the polygon's box, positives at the deepest interior point and halfway to each end of its long axis (when inside),
    negatives at the centres of the other groups' polygons (crop px) that fall inside the crop and outside the region."""
    import cv2
    m = np.zeros((h, w), np.uint8)
    cv2.fillPoly(m, [np.round(np.asarray(poly, float)).astype(np.int32)], 1)
    if not m.any():
        raise ValueError("pulse group polygon is empty on the crop")
    ys, xs = np.nonzero(m)
    d = cv2.distanceTransform(m, cv2.DIST_L2, 3)
    pos = [np.unravel_index(int(np.argmax(d)), d.shape)[::-1]]
    c = np.array([xs.mean(), ys.mean()])
    cov = np.cov(np.vstack([xs, ys])) if len(xs) > 2 else np.eye(2)
    u = np.linalg.eigh(cov)[1][:, 1]
    half = 0.5 * np.sqrt(max(np.linalg.eigvalsh(cov)[1], 0) * 3)
    for s in (-1, 1):
        q = np.round(c + s * half * u).astype(int)
        if 0 <= q[0] < w and 0 <= q[1] < h and m[q[1], q[0]]:
            pos.append(tuple(q))
    neg = []
    for o in others:
        q = np.asarray(o, float).mean(0)
        if 0 <= q[0] < w and 0 <= q[1] < h and not m[int(q[1]), int(q[0])]:
            neg.append(tuple(q))
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    pts = [[float(a) / w, float(b) / h] for a, b in pos + neg]
    return {"kind": "box", "x": x0 / w, "y": y0 / h, "w": (x1 - x0) / w, "h": (y1 - y0) / h,
            "points": pts, "labels": [1] * len(pos) + [0] * len(neg)}


def body(grays, seed, poly):
    """LK pass. grays: uint8 frames (h, w) in time order; seed: index of the painted frame; poly: normalized polygon.
    -> {"M": (n, 2, 3) seed px -> frame px similarity per frame (NaN where unknown), "scale": (n,) its scale,
        "rscale": (n,) the region's own log scale against the body (cumulative; the fallback signal)}.
    Body: LK corners in the ring around the region, RANSAC similarity per frame step. Region: dense flow (Farneback) on
    a crop around it, the next frame first warped by the body step, at >= RES_PX px per region radius; its mean radial
    component over the region / radius = the region's own scale step (a contraction pulls the texture in)."""
    import cv2
    from pawtrack.partlabel import poly_mask
    n, (h, w) = len(grays), grays[0].shape
    reg = poly_mask(poly, w, h).astype(np.uint8)
    if not reg.any():
        raise ValueError("pulse group polygon is empty")
    r = max(2.0, math.sqrt(reg.sum() / math.pi))
    ys, xs = np.nonzero(reg)
    c0 = np.array([xs.mean(), ys.mean(), 1.0])
    disk = lambda k: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * int(k) + 1, 2 * int(k) + 1))
    ring = cv2.dilate(reg, disk(RING[1] * r)) & ~cv2.dilate(reg, disk((RING[0] - 1) * r))
    I = np.array([[1.0, 0, 0], [0, 1.0, 0]])
    M = np.full((n, 2, 3), np.nan)
    rs = np.full(n, np.nan)
    M[seed], rs[seed] = I, 0.0
    lk = dict(winSize=(15, 15), maxLevel=3, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 20, 0.03))

    def corners(img, mask, k):
        p = cv2.goodFeaturesToTrack(img, k, 0.005, 2, mask=mask)
        return np.zeros((0, 2), np.float32) if p is None else p.reshape(-1, 2)

    def track(a, b, p):
        if len(p) == 0:
            return p, np.zeros(0, bool)
        q, st, _ = cv2.calcOpticalFlowPyrLK(a, b, p.reshape(-1, 1, 2), None, **lk)
        back, st2, _ = cv2.calcOpticalFlowPyrLK(b, a, q, None, **lk)
        ok = (st.ravel() == 1) & (st2.ravel() == 1) & (np.linalg.norm(back.reshape(-1, 2) - p, axis=1) < 1.0)
        return q.reshape(-1, 2), ok

    def compose(S, A):
        return S[:, :2] @ A + np.c_[np.zeros((2, 2)), S[:, 2]]

    def radial(a, b, S, A):
        """Mean radial flow / radius over the region between frame a and frame b warped back by the body step S."""
        s = math.sqrt(abs(np.linalg.det(A[:, :2])))
        cx, cy = A @ c0
        u = min(4.0, max(1.0, RES_PX / (r * s)))
        hs = max(12.0, 2.0 * r * s)
        size = int(round(2 * hs * u))
        D = np.array([[1 / u, 0, cx - hs], [0, 1 / u, cy - hs]])  # crop px -> frame a px
        pa = cv2.warpAffine(a, D, (size, size), flags=cv2.WARP_INVERSE_MAP | cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        pb = cv2.warpAffine(b, np.c_[S[:, :2] @ D[:, :2], S[:, :2] @ D[:, 2] + S[:, 2]], (size, size),
                            flags=cv2.WARP_INVERSE_MAP | cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        f = cv2.calcOpticalFlowFarneback(pa, pb, None, 0.5, 4, 15, 3, 5, 1.2, 0)  # window 15: a one-frame contraction moves the rim several px
        yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) - (size - 1) / 2
        d2 = xx * xx + yy * yy
        m = (d2 >= (2 * u) ** 2) & (d2 <= (r * s * u) ** 2)
        return float(((f[..., 0] * xx + f[..., 1] * yy)[m] / d2[m]).mean()) if m.any() else 0.0

    for d in (1, -1):
        A, ls, prev = I.copy(), 0.0, seed
        pb = corners(grays[seed], ring, 300)
        nb0 = max(len(pb), 1)
        for i in range(seed + d, n if d > 0 else -1, d):
            qb, okb = track(grays[prev], grays[i], pb)
            S, inl = None, None
            if okb.sum() >= 4:
                S, inl = cv2.estimateAffinePartial2D(pb[okb], qb[okb], method=cv2.RANSAC, ransacReprojThreshold=1.5)
            if S is None:
                S, inl = I.copy(), None
            ls += math.log(max(1e-3, 1 + radial(grays[prev], grays[i], S, A)))
            A = compose(S, A)
            M[i], rs[i] = A, ls
            pb = qb[okb][inl.ravel() == 1] if inl is not None else qb[okb]
            if len(pb) < 0.5 * nb0:
                pb = corners(grays[i], cv2.warpAffine(ring, A, (w, h), flags=cv2.INTER_NEAREST), 300)
            prev = i
    scale = np.sqrt(np.abs(M[:, 0, 0] * M[:, 1, 1] - M[:, 0, 1] * M[:, 1, 0]))
    return {"M": M, "scale": scale, "rscale": rs}


def move_poly(poly_px, M):
    P = np.asarray(poly_px, float)
    return P @ M[:, :2].T + M[:, 2]


def mask_measures(mask, gray, thr):
    """bool mask + grey crop + the dark threshold (None: no opening) -> (area px, dark px (NaN without one), compactness)."""
    import cv2
    a = float(mask.sum())
    if a < 3:
        return np.nan, np.nan, np.nan
    m8 = mask.astype(np.uint8)
    cs, _ = cv2.findContours(m8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    per = sum(cv2.arcLength(c, True) for c in cs)
    dark = float(((gray < thr) & (cv2.dilate(m8, np.ones((3, 3), np.uint8)) > 0)).sum()) if thr is not None else np.nan
    return a, dark, 4 * math.pi * a / max(per, 1.0) ** 2


def dark_threshold(mask, gray):
    """Otsu split of the grey values inside the seed mask -> threshold, or None when the dark side is < 5 % or > 80 %
    of the mask (no opening to measure)."""
    import cv2
    v = gray[mask]
    if len(v) < 16:
        return None
    thr, _ = cv2.threshold(v.reshape(-1, 1).astype(np.uint8), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    share = float((v < thr).mean())
    return float(thr) if 0.05 <= share <= 0.8 else None


# ---------------------------------------------------------------- decode + SAM

def _gray_frames(video, a, b, width):
    import cv2
    from pawtrack.video import open_frames
    _, it = open_frames(video, int(a), int(b), width=width)
    ts, gs = [], []
    for t, bgr in it:
        ts.append(t)
        gs.append(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY))
    return np.array(ts, float), gs


def held_new(grays, poly, M):
    """Held frames (animation on twos / threes) around the region: loops.held_from_diffs on the 99th percentile |diff|
    of a crop (4 region radii across, at BODY_W) following the region (M: body()'s transforms). -> bool per frame,
    True = a new drawing; all True unless the dominant step is >= 2 frames (a whole-frame test misses new drawings at
    a thrust's turning points, where little moves)."""
    import cv2
    from pawtrack.loops import held_from_diffs
    n = len(grays)
    if n < 3:
        return np.ones(n, bool)
    h, w = grays[0].shape
    P = np.asarray(poly, float) * [w, h]
    c0, r = P.mean(0), max(4.0, 0.5 * float(np.ptp(P, 0).max()))
    I = np.array([[1.0, 0, 0], [0, 1.0, 0]])
    crops = []
    for g, m in zip(grays, M):
        A = m if np.isfinite(m).all() else I
        cx, cy = A[:, :2] @ c0 + A[:, 2]
        sz = int(max(8, 4 * r * math.sqrt(abs(np.linalg.det(A[:, :2])))))
        crops.append(cv2.resize(cv2.getRectSubPix(g, (sz, sz), (float(cx), float(cy))), (64, 64), interpolation=cv2.INTER_AREA).astype(np.float32))
    hf = held_from_diffs([np.percentile(np.abs(a - b), 99) for a, b in zip(crops[1:], crops[:-1])])
    return hf["new"] if hf["step"] >= 2 else np.ones(n, bool)


def sam_stream(items, roi, size, model="small", chunk=64):
    """SAM 2.1 (trackers/sam2_mask.track) over items ((key, bgr crop) pairs, every crop size = (w, h)), prompted with
    roi on the first -> yields (key, bool mask (h, w), confidence). Shared by sam_masks and shaft.py (which stops early
    to re-prompt: close the generator). sam2_mask's "no motion" note is a stroke's: muted while it runs."""
    import cv2
    from pawtrack.trackers import sam2_mask
    w, h = size
    sp = {"primary": "area", "model": model, "bulge_base": "auto", "chunk_frames": chunk}
    quiet, sam2_mask.low_motion_note = sam2_mask.low_motion_note, lambda *a, **k: None
    try:
        for k, res, ov in sam2_mask.track(items, roi, sp):
            m = np.zeros((h, w), np.uint8)
            for poly in ov.get("masks") or []:
                cv2.fillPoly(m, [np.round(np.asarray(poly) * [w, h]).astype(np.int32)], 1)
            yield k, m > 0, float(res.get("confidence") or 0)
    finally:
        sam2_mask.low_motion_note = quiet


def sam_masks(crops, seed, roi, p):
    """SAM 2.1 over crops (bgr list, one crop box), seeded on crops[seed] with roi (prompt()); forward and backward.
    -> (list of bool masks (h, w) | None per crop, confidence per crop). Test seam: monkeypatched on CPU."""
    h, w = crops[0].shape[:2]
    masks, conf = [None] * len(crops), np.zeros(len(crops))
    for d in (1, -1):
        idx = list(range(seed, len(crops))) if d > 0 else list(range(seed, -1, -1))
        if len(idx) < 2:
            continue
        for i, m, c in sam_stream(((k, crops[k]) for k in idx), roi, (w, h), p.get("pulse_model", "small")):
            if masks[i] is None:  # the seed frame: the forward pass has it
                masks[i], conf[i] = m, c
    return masks, conf


def _crops(video, t, box, size):
    """Full-resolution decode over t's span, each frame cropped to box (x0, y0, x1, y1) and resized to size (w, h) ->
    (bgr crops, grey crops), one per t (the decoded frame nearest each t)."""
    import cv2
    from pawtrack.video import open_frames
    x0, y0, x1, y1 = box
    _, it = open_frames(video, int(t[0]), int(t[-1]))
    ts, cs = [], []
    for tt, bgr in it:
        ts.append(tt)
        cs.append(cv2.resize(bgr[y0:y1, x0:x1], size, interpolation=cv2.INTER_AREA))
    if not cs:
        raise ValueError("no frames decoded for the SAM crop")
    k = np.abs(np.asarray(ts, float)[None, :] - np.asarray(t, float)[:, None]).argmin(1)
    crops = [cs[i] for i in k]
    return crops, [cv2.cvtColor(c, cv2.COLOR_BGR2GRAY) for c in crops]


def is_pulse(g):
    """A pulse group: its own `pulse` flag, else its part is anus (balls / sheath / penis only when flagged)."""
    part = (g.get("part") or str(g.get("name", "")).split("_")[-1]).rstrip("0123456789")
    return bool(g["pulse"]) if "pulse" in g else part == "anus"


def run_group(video, g, others, a, b, p, emit=lambda d, t, **k: None):
    """One pulse group over [a, b] ms. g = {name, poly, t_ms}; others = the polygons of the groups painted on the same
    frame (normalized; SAM negatives). -> {name, source "sam" | "points", t, pulse, sign, events, scale, seed_ms,
    frames, and with SAM: area, dark, compact, crop, sam_ms, lost; note when SAM was skipped or failed}."""
    import time
    from pawtrack.video import probe
    tg = float(g["t_ms"])
    T, G = _gray_frames(video, min(a, tg), max(b, tg), BODY_W)
    if len(T) < 5:
        raise ValueError(f"pulse group {g['name']}: under 5 frames in range")
    seed = int(np.argmin(np.abs(T - tg)))
    B = body(G, seed, g["poly"])
    inr = (T >= a) & (T <= b)
    t, scale, M = T[inr], B["scale"][inr], B["M"][inr]
    gh, gw = G[0].shape
    new = held_new([x for x, k in zip(G, inr) if k], g["poly"], M)
    del G
    out = {"name": g["name"], "t": t, "scale": scale, "seed_ms": int(T[seed]), "frames": int(len(t)), "new": new}
    off, sgn = p.get("pulse_offset_ms", 0), p.get("pulse_sign", "auto")
    emit(1, 3, stage="pulse")
    if p.get("pulse_sam", True):
        try:
            t0 = time.perf_counter()
            media = probe(video)
            W, H = int(media.get("width") or gw), int(media.get("height") or gh)
            f = W / gw
            px = np.asarray(g["poly"], float) * [gw, gh]
            path = [move_poly(px, M[k]) * f for k in range(len(t)) if np.isfinite(M[k]).all()]
            if not path:
                raise ValueError("region lost in the LK pass")
            box = crop_box(path, W, H)
            x0, y0, x1, y1 = box
            s = min(1.0, CROP_W / max(x1 - x0, y1 - y0))
            cw, ch = max(16, round((x1 - x0) * s)), max(16, round((y1 - y0) * s))
            crops, grays = _crops(video, t, box, (cw, ch))
            emit(2, 3, stage="pulse")
            k0 = int(np.argmin(np.abs(t - tg)))
            Mk = M[k0] if np.isfinite(M[k0]).all() else np.array([[1.0, 0, 0], [0, 1.0, 0]])
            to_crop = lambda P: (np.asarray(P, float) * f - [x0, y0]) * [cw / (x1 - x0), ch / (y1 - y0)]
            neg = [to_crop(move_poly(np.asarray(o, float) * [gw, gh], Mk)) for o in others]
            masks, conf = sam_masks(crops, k0, prompt(to_crop(move_poly(px, Mk)), neg, cw, ch), p)
            thr = dark_threshold(masks[k0], grays[k0]) if masks[k0] is not None else None
            meas = np.array([mask_measures(m, gr, thr) if m is not None and cf >= 0.5 else (np.nan,) * 3
                             for m, gr, cf in zip(masks, grays, conf)], float).reshape(-1, 3)
            area, dark, comp = meas[:, 0], (meas[:, 1] if thr is not None else None), meas[:, 2]
            c, sign = signal(t, area, dark, scale, sgn)
            out.update(source="sam", area=area, dark=dark, compact=comp, crop=list(box),
                       sam_ms=int((time.perf_counter() - t0) * 1000), lost=round(float(np.mean(~np.isfinite(area))), 3))
            if np.isfinite(c).sum() >= 5:
                out.update(pulse=c, sign=sign, events=events(t, c, new, off))
                emit(3, 3, stage="pulse")
                return out
            out["note"] = "SAM lost the region: points fallback"
        except ImportError as e:
            out["note"] = f"SAM not available ({e}): points fallback"
        except Exception as e:  # noqa: BLE001 (a SAM failure falls back to the points; the cue is optional)
            out["note"] = f"SAM failed ({type(e).__name__}: {e}): points fallback"
    c, sign = signal(t, np.exp(2 * B["rscale"][inr]), sign=sgn)
    out.update(source="points", pulse=c, sign=sign, events=events(t, c, new, off))
    emit(3, 3, stage="pulse")
    return out


def label(g):
    """'c2_anus' -> 'anus (Top)'; plain 'anus' -> 'anus'. c1 = Bottom, c2 = Top, x = Extra (paw-uzzr; the app reads a stored
    'anus (C2)' as Top too)."""
    who, part = g.get("who"), g.get("part") or g["name"]
    return f"{part} ({WHO_NAME.get(who, who)})" if who else part


def run(video, groups, a, b, p, emit=lambda d, t, **k: None):
    """The pulse groups among `groups` (is_pulse) over [a, b] ms; the others only give SAM negatives.
    -> [{name, label, part, who, source, events, channel: [[t, v], ...], ...}]."""
    res = []
    for g in groups:
        if not isinstance(g, dict) or not is_pulse(g):
            continue
        if not (isinstance(g.get("poly"), list) and len(g["poly"]) >= 3 and isinstance(g.get("t_ms"), (int, float))):
            raise ValueError(f"pulse group {g.get('name')!r}: needs poly (>= 3 points) and t_ms")
        others = [o["poly"] for o in groups if o is not g and isinstance(o, dict) and o.get("t_ms") == g["t_ms"]
                  and len(o.get("poly") or []) >= 3]
        r = run_group(video, g, others, a, b, p, emit)
        r.update(label=label(g), part=g.get("part") or g["name"], who=g.get("who"))
        r["channel"] = [[int(x), None if not np.isfinite(v) else round(float(v), 3)] for x, v in zip(r["t"], r["pulse"])]
        res.append(r)
    return res
