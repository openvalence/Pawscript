"""Camera and motion facts for the director (src/lib/director/README.md §8.2-8.4).

  motion.stats    per range: camera dx/dy/zoom (full-res px), camera verdict, 1 Hz energy with the camera removed,
                  still spans, 8x8 heat map, per-second brightness/black/credits_like
  motion.compare  pure: per tracker series turns/rate/regularity/coverage/camera share, pairwise agreement
  motion.propose  the moving part: block flow minus the camera, power at the loop period -> box, axis, points, pair

Flow is dense DIS optical flow between frames sampled at `fps`, averaged into a 16-column block grid (rows follow
the aspect), the same grid the eval caches (trackers/eval/inventory.py, Farneback per native frame). The camera
is the robust fit flow = d + s * (p - centre) over the reference blocks: the caller's boxes, else the textured
blocks of the border ring (incl. corners) with the calmest 40% of flow variance (bodies reach into the ring;
flat paint has no flow): d = translation, s = zoom per step.
Measured on the owner-approved trace-2 video (4 scenes; trace verdicts in brackets): s0 sway 15 px
[static < 2 px: the ring there is flat paint and bodies], s1 rides 37 px at 1.25 Hz, CV 0.18 [34 px, 2.51 turns/s,
CV 0.18], s2 move 40.4-55.2 s [push-in 40.5-50 s], s3 sway 7 px [sway, ~7 px]; ~10 s CPU for 104 s of 1600x1400.

Pure cores, importable without a video: stats_from_flow(t_ms, block_flow, thumbs, params), compare(...).
"""
import math

import cv2
import numpy as np
from scipy.ndimage import median_filter, uniform_filter1d
from scipy.signal import savgol_filter

from pawtrack.frames import sampled
from pawtrack.loops import thumb
from pawtrack.pipeline import local_normalize, motion_energy
from pawtrack.progress import Progress
from pawtrack.score import MIN_PROM, match as match_turns, turns as find_turns
from pawtrack.video import probe

GRID_W = 16
STATS_DEFAULTS = {"width": 320, "fps": 15, "grid": 8, "border": 0.12, "boxes": None}
PROPOSE_DEFAULTS = {"width": 256, "max": 3}
# camera verdict thresholds (DESIGN §4.2); every raw number is returned too, so rules can re-threshold
STATIC_PX = 2.0      # p5..p95 of the camera position (4 s detrended), full-res px
STATIC_ZOOM = 1.0    # zoom range, percent
MOVE_MIN_MS = 3000   # sustained translation / zoom
MOVE_SHIFT = 0.03    # net translation (share of the frame width) or zoom (share) over a move span
SWAY_SHARE = 0.9     # interior tiles share this many of their turns with the camera -> the bob is the camera
RIDES_CV = 0.25      # stroke_lock regular enough (half-cycle CV) to call the camera "riding" the strokes
LOCK_SHARE = 0.25    # spectral share of the camera oscillation at its peak -> stroke_lock reported
MATCH_MS = 120
STILL_GREY = 4.0     # = pipe_gate_motion: 2 s median of the thumbnail motion energy below this is still
STILL_MIN_MS = 1000
STILL_FLOW = 4.0     # and the p95 block residual below this many flow px per second (at the 320 px flow width)
GRID_MS = 10.0       # compare resamples every series at 100 Hz, like pawtrack.score


# ---------------------------------------------------------------- flow

def _gray(bgr):
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)


def block_texture(gray, gh, gw):
    """Mean gradient magnitude per block of one grey frame (flat paint gives optical flow nothing to lock on)."""
    g = np.hypot(cv2.Sobel(gray, cv2.CV_32F, 1, 0), cv2.Sobel(gray, cv2.CV_32F, 0, 1))
    return cv2.resize(g, (gw, gh), interpolation=cv2.INTER_AREA)


def decode_flow(video, t0, t1, width, fps, emit=None, base=0, total_all=None):
    """[t0, t1) sampled at fps, decoded at `width` -> dict t (N,), blocks (N, gh, GRID_W, 2) flow px at `width`
    (block i = motion from sample i-1 to i; block 0 = 0), thumbs (N, 64 px grey), first (grey of sample 0), w, h,
    texture (gh, GRID_W) median block texture over the range (a first frame may be a fade)."""
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    total, frames = sampled(video, t0, t1, fps, width)
    ts, blocks, thumbs, texs, prev, first = [], [], [], [], None, None
    prog = Progress(emit) if emit else None
    for t, bgr in frames:
        g = _gray(bgr)
        gh = max(1, round(GRID_W * g.shape[0] / g.shape[1]))
        if prev is None:
            first = g
            b = np.zeros((gh, GRID_W, 2), np.float32)
        else:
            b = cv2.resize(dis.calc(prev, g, None), (GRID_W, gh), interpolation=cv2.INTER_AREA)
        if len(ts) % 15 == 0:
            texs.append(block_texture(g, gh, GRID_W))
        prev = g
        ts.append(t)
        blocks.append(b)
        thumbs.append(thumb(bgr))
        if prog:
            prog(base + len(ts), max(total_all or total, base + len(ts)))
    if len(ts) < 2:
        raise ValueError(f"motion: fewer than 2 frames in [{t0}, {t1})")
    return {"t": np.array(ts, np.int64), "blocks": np.array(blocks, np.float32), "thumbs": np.array(thumbs),
            "first": first, "w": first.shape[1], "h": first.shape[0], "texture": np.median(np.array(texs), 0)}


def _centres(gh, gw):
    """Block centres, normalized 0..1 -> (X, Y) each (gh, gw)."""
    return np.meshgrid((np.arange(gw) + 0.5) / gw, (np.arange(gh) + 0.5) / gh)


def ref_mask(gh, gw, border=0.12, boxes=None):
    """Reference blocks for the camera: centres inside the caller's boxes, else the border ring (incl. corners)."""
    X, Y = _centres(gh, gw)
    if boxes:
        m = np.zeros((gh, gw), bool)
        for b in boxes:
            m |= (X >= b["x"]) & (X <= b["x"] + b["w"]) & (Y >= b["y"]) & (Y <= b["y"] + b["h"])
    else:
        m = (X < border) | (X > 1 - border) | (Y < border) | (Y > 1 - border)
    return m if m.sum() >= 3 else np.ones((gh, gw), bool)


KEEP_REF = 0.4      # of the reference ring, the calmest share (lowest flow variance) is the background
MIN_TEXTURE = 0.5   # blocks with less than this share of the median block texture are skipped (flat = no flow)


def pick_ref(blocks, mask, texture=None, keep=KEEP_REF):
    """The border ring catches bodies too: keep its textured blocks with the lowest flow variance over the range
    (a static background, or the background moving rigidly with the camera). At least 3 blocks."""
    m = mask.copy()
    if texture is not None:
        tex = np.asarray(texture, float)
        m &= tex >= MIN_TEXTURE * float(np.median(tex))
        if m.sum() < 3:
            m = mask.copy()
    var = blocks.std(0).sum(-1)
    lim = np.quantile(var[m], keep)
    sel = m & (var <= lim)
    return sel if sel.sum() >= 3 else m


def fit_camera(blocks, mask, aspect):
    """blocks (N, gh, gw, 2) -> (d (N, 2) translation, s (N,) zoom per step, residual (N, gh, gw) magnitude),
    all in the blocks' px, over the reference blocks `mask`. Robust: alternate a median translation and a
    least-squares zoom, 3 rounds; no zoom when the blocks do not surround the centre (zoom = translation then).
    aspect = h / w of the frame (block coordinates in px of the flow frame)."""
    n, gh, gw, _ = blocks.shape
    X, Y = _centres(gh, gw)
    P = np.stack([(X - 0.5), (Y - 0.5) * aspect], -1)  # frame-width units, centred
    F = blocks[:, mask]          # (N, M, 2)
    Pm = P[mask]                 # (M, 2)
    s = np.zeros(n)
    d = np.zeros((n, 2))
    r2 = max(float((Pm ** 2).sum()), 1e-9)
    spread = np.linalg.eigvalsh(np.cov(Pm.T)) if len(Pm) >= 3 else np.zeros(2)
    zoom_ok = spread.min() > 0.02 and np.linalg.norm(Pm.mean(0)) < 0.15
    for _ in range(3 if zoom_ok else 1):
        d = np.median(F - s[:, None, None] * Pm[None], axis=1)
        if zoom_ok:
            s = ((F - d[:, None]) * Pm[None]).sum((1, 2)) / r2
    return d, s, residual(blocks, d, s, aspect)


def residual(blocks, d, s, aspect):
    """|block flow - camera| per block (N, gh, gw); s in flow px per frame-width unit (zoom = s / flow width)."""
    _, gh, gw, _ = blocks.shape
    X, Y = _centres(gh, gw)
    P = np.stack([(X - 0.5), (Y - 0.5) * aspect], -1)
    return np.linalg.norm(blocks - d[:, None, None] - s[:, None, None, None] * P[None], axis=-1)


def _rebin(t, hz, *series):
    """Native-rate per-step series -> sums per 1000/hz bin (motion is additive). Leaves it alone when the input
    is already at (or below) ~hz. -> (t_bins, [series...], hz_out)."""
    t = np.asarray(t, float)
    dt = float(np.median(np.diff(t))) if len(t) > 1 else 1000.0 / hz
    if dt >= 0.75 * 1000.0 / hz:
        return t, list(series), 1000.0 / dt
    step = 1000.0 / hz
    k = np.floor((t - t[0]) / step).astype(int)
    nb = int(k[-1]) + 1
    out = []
    for x in series:
        x = np.asarray(x, float)
        acc = np.zeros((nb, *x.shape[1:]))
        np.add.at(acc, k, x)
        out.append(acc)
    return t[0] + np.arange(nb) * step, out, float(hz)


def _runs(mask):
    """Boolean array -> [(i0, i1)) runs of True."""
    m = np.concatenate([[False], np.asarray(mask, bool), [False]])
    e = np.flatnonzero(np.diff(m.astype(int)))
    return list(zip(e[::2], e[1::2]))


def _turn_series(t, x, smooth_ms=150.0, win_ms=3000.0):
    """Any signal on a uniform grid -> (turn times, kinds) through pawtrack.score's turn finder, after the
    pipeline's smoothing and rolling robust range (0..100)."""
    x = np.asarray(x, float)
    if len(x) < 5 or np.ptp(x) < 1e-9:
        return np.zeros(0), np.zeros(0, int)
    dt = float(np.median(np.diff(t)))
    win = int(smooth_ms / dt) | 1
    if win >= 5 and win <= len(x):
        x = savgol_filter(x, win, 2)
    x = local_normalize(x, max(3, int(win_ms / dt))) * 100
    tt, kk, _ = find_turns(np.asarray(t, float), x, MIN_PROM)
    return tt, kk


def _share(ta, ka, tb, kb, tol):
    """Best of same-kind and flipped matching (signs are arbitrary) -> (pairs, flipped)."""
    a = match_turns(ta, ka, tb, kb, tol)
    b = match_turns(ta, ka, tb, -kb, tol)
    return (b, True) if len(b) > len(a) else (a, False)


def _halves(tt, gaps=()):
    """Turn times -> half-cycle intervals (ms), dropping intervals that span a gap or are > 3x the median."""
    h = np.diff(tt)
    if gaps:
        keep = [not any(a < g1 and b > g0 for g0, g1 in gaps) for a, b in zip(tt[:-1], tt[1:])]
        h = h[np.array(keep, bool)] if len(h) else h
    if len(h) >= 3:
        h = h[h <= 3 * np.median(h)]
    return h


# ---------------------------------------------------------------- motion.stats

def _oscillation(t, px, py, hz, start_ms):
    """Detrended camera position (full-res px) -> (axis-projected signal, amplitude, stroke_lock|None, turns)."""
    q = np.stack([px, py], 1)
    c = q - q.mean(0)
    _, vecs = np.linalg.eigh(c.T @ c)
    s = c @ vecs[:, -1]
    amp = float(np.percentile(s, 95) - np.percentile(s, 5)) if len(s) else 0.0
    if len(s) < 3 * hz or amp < STATIC_PX:
        return s, amp, None, (np.zeros(0), np.zeros(0, int))
    f = np.fft.rfftfreq(len(s), 1.0 / hz)
    pw = np.abs(np.fft.rfft(s * np.hanning(len(s)))) ** 2
    band = (f >= 0.3) & (f <= min(6.0, hz / 2))
    if not band.any() or pw[band].sum() <= 0:
        return s, amp, None, (np.zeros(0), np.zeros(0, int))
    f0 = float(f[band][np.argmax(pw[band])])
    share = float(pw[(f >= 0.85 * f0) & (f <= 1.15 * f0)].sum() / pw[band].sum())
    tt, kk = _turn_series(t, s)
    h = _halves(tt)
    if share < LOCK_SHARE or len(h) < 4:
        return s, amp, None, (tt, kk)
    cyc = 2 * float(np.median(h))
    valleys = tt[kk == -1]
    ang = 2 * np.pi * ((valleys - start_ms) % cyc) / cyc
    phase = (math.atan2(np.sin(ang).mean(), np.cos(ang).mean()) % (2 * np.pi)) / (2 * np.pi) * cyc if len(ang) else None
    lock = {"rate_hz": round(1000.0 / cyc, 3), "cv": round(float(h.std() / h.mean()), 3),
            "phase_ms": None if phase is None else int(round(phase)), "share": round(share, 3), "f0_hz": round(f0, 3)}
    return s, amp, lock, (tt, kk)


def stats_from_flow(t_ms, block_flow, thumbs, params=None):
    """Pure core of motion.stats over one range.
    t_ms (N,) sample times; block_flow (N, gh, gw, 2) flow px per step (block i = motion from sample i-1 to i)
    at the flow width; thumbs (N, h, 64) grey or None. params: STATS_DEFAULTS keys plus
      px_scale  full-res px per flow px (full width / flow width; default 1)
      aspect    frame h / w (default gh / gw)
      start_ms, end_ms  the range (default t[0], t[-1] + one step)
      flow_w    flow frame width in px (default `width`, 320 = the eval cache)
      texture   (gh, gw) block texture of a frame (block_texture), optional: flat blocks are not camera references
    Input at a native frame rate (the eval cache) is summed into 1000/fps bins first.
    -> one `ranges` entry of motion.stats (README §8.2), plus raw extras."""
    p = {**STATS_DEFAULTS, **(params or {})}
    t = np.asarray(t_ms, float)
    B = np.asarray(block_flow, np.float32)
    n, gh, gw, _ = B.shape
    scale = float(p.get("px_scale") or 1.0)
    aspect = float(p.get("aspect") or gh / gw)
    ring = ref_mask(gh, gw, p["border"], p["boxes"])
    ref = ring if p["boxes"] else pick_ref(B, ring, p.get("texture"))
    d, s, res = fit_camera(B, ref, aspect)
    flow_w = float(p.get("flow_w") or p["width"])  # the eval cache is 320 px wide = the default width
    zoom = s / flow_w                    # fraction per step (s is px per frame-width unit of P)
    energy_px = res.mean((1, 2)) * scale
    dt_in = float(np.median(np.diff(t))) if n > 1 else 1000.0 / p["fps"]
    hot = np.percentile(res.reshape(n, -1), 95, axis=1) * (1000.0 / dt_in) * (320.0 / float(p.get("flow_w") or p["width"]))
    tb, (dx, dy, zm, en, heat_b), hz = _rebin(t, p["fps"], d[:, 0] * scale, d[:, 1] * scale, zoom, energy_px, res)
    step = 1000.0 / hz
    start = float(p.get("start_ms", t[0]))
    end = float(p.get("end_ms", t[-1] + step))
    X, Y, Z = np.cumsum(dx), np.cumsum(dy), np.cumsum(zm)
    win = max(3, int(round(4 * hz)))
    PX, PY = X - uniform_filter1d(X, win, mode="nearest"), Y - uniform_filter1d(Y, win, mode="nearest")
    p95 = max(float(np.percentile(PX, 95) - np.percentile(PX, 5)), float(np.percentile(PY, 95) - np.percentile(PY, 5)))
    zr = float(np.percentile(Z, 95) - np.percentile(Z, 5)) * 100

    # move: sustained translation or zoom with a real net change
    full_w = flow_w * scale
    # the 2 s trend of the camera position: an oscillation (rides / sway, >= 1 Hz) averages out, a pan or zoom does not
    TX, TY, TZ = (uniform_filter1d(a, max(3, win // 2), mode="nearest") for a in (X, Y, Z))
    vx, vy, vz = (np.gradient(a) * hz for a in (TX, TY, TZ))
    moving = (np.hypot(vx, vy) > MOVE_SHIFT * full_w / (MOVE_MIN_MS / 1000)) | (np.abs(vz) > MOVE_SHIFT / (MOVE_MIN_MS / 1000))
    X, Y, Z = TX, TY, TZ  # net change of a span on the trend
    runs = []
    for a, b in _runs(moving):  # merge runs less than 1 s apart, then keep >= 3 s with a real net change
        if runs and (a - runs[-1][1]) * step < 1000:
            runs[-1][1] = b
        else:
            runs.append([a, b])
    spans = []
    for a, b in runs:
        b1 = min(b, len(tb)) - 1
        net = max(abs(X[b1] - X[a]) / full_w, abs(Y[b1] - Y[a]) / full_w, abs(Z[b1] - Z[a]))
        if tb[b1] + step - tb[a] >= MOVE_MIN_MS and net >= MOVE_SHIFT:
            spans.append([int(round(tb[a])), int(round(tb[b1] + step))])

    sig, amp, lock, (ct, ck) = _oscillation(tb, PX, PY, hz, start)
    # sway: do the interior tiles turn exactly when the camera does (raw motion, camera included)?
    share = None
    if len(ct) >= 4:
        inner = ~ring
        _, (Bb,), _ = _rebin(t, p["fps"], B)
        Xc, Yc = _centres(gh, gw)
        Pc = np.stack([(Xc - 0.5), (Yc - 0.5) * aspect], -1)
        own = Bb - np.stack([dx, dy], -1)[:, None, None] / scale - (zm * flow_w)[:, None, None, None] * Pc[None]  # flow px
        mot = heat_b.mean(0)  # |own motion|, flow px per step
        cam_speed = float(np.hypot(dx, dy).mean()) / scale
        top = float(mot[inner].max()) if inner.any() else 0.0
        # the interior blocks that move on their own; none (vs the camera's speed) = everything rides the camera
        idx = np.argwhere(inner & (mot >= 0.5 * top)) if top >= 0.3 * cam_speed else []
        sh = [] if len(idx) else [1.0]
        for i, j in idx:  # raw motion (camera included) along the block's own axis: same turns = the camera
            q = np.cumsum(own[:, i, j], 0)
            q = q - q.mean(0)
            ax = np.linalg.eigh(q.T @ q)[1][:, -1]
            r = np.cumsum(Bb[:, i, j] @ ax)
            r = r - uniform_filter1d(r, win, mode="nearest")
            bt, bk = _turn_series(tb, r)
            if len(bt) >= 4:
                pairs, _ = _share(bt, bk, ct, ck, MATCH_MS)
                sh.append(len(pairs) / len(bt))
        share = round(float(np.median(sh)), 3) if sh else None
    move_ms = sum(b - a for a, b in spans)
    if p95 < STATIC_PX and zr < STATIC_ZOOM and not spans:
        mode = "static"
    elif share is not None and share >= SWAY_SHARE:
        mode = "sway"
    elif lock and lock["cv"] < RIDES_CV:  # a regular stroke-locked bob wins over drift (move_spans still reported)
        mode = "rides"
    elif move_ms >= MOVE_MIN_MS:
        mode = "move"
    else:
        mode = "sway" if p95 >= STATIC_PX else "static"
    camera = {"mode": mode, "p95_px": round(p95, 2), "zoom_pct": round(zr, 3),
              "rate_hz": lock["rate_hz"] if lock else None, "phase_ms": lock["phase_ms"] if lock else None,
              "move_spans": spans, "stroke_lock": {k: lock[k] for k in ("rate_hz", "cv", "phase_ms")} if lock else None,
              # extras (raw, for re-thresholding): oscillation amplitude on its axis, spectral share, tile turn share
              "osc_px": round(amp, 2), "lock_share": lock["share"] if lock else None, "turn_share": share}

    # 1 Hz energy (camera removed), heat, seconds
    nsec = max(1, int(math.ceil((end - start) / 1000)))
    ks = np.clip(((tb - start) // 1000).astype(int), 0, nsec - 1)
    ev = [float(en[ks == k].mean()) if (ks == k).any() else None for k in range(nsec)]
    heat = cv2.resize(heat_b.mean(0).astype(np.float32) * scale, (p["grid"], p["grid"]), interpolation=cv2.INTER_AREA)
    still, seconds = [], []
    if thumbs is not None and len(thumbs):
        th = np.asarray(thumbs, np.float32)
        e = motion_energy(t, th)
        e = np.where(np.isfinite(e), e, np.nanmedian(e) if np.isfinite(e).any() else 0.0)
        k2 = max(1, int(round(2000 / max(1.0, dt_in)))) | 1
        med = median_filter(e, size=k2, mode="nearest")
        quiet = median_filter(hot, size=k2, mode="nearest") < STILL_FLOW
        for a, b in _runs((med < STILL_GREY) & quiet):
            t1_ = t[b] if b < len(t) else end
            if t1_ - t[a] >= STILL_MIN_MS:
                still.append([int(t[a]), int(t1_)])
        kt = np.clip(((t - start) // 1000).astype(int), 0, nsec - 1)
        for k in range(nsec):
            f = th[kt == k]
            if not len(f):
                seconds.append({"t": int(start + 1000 * k), "bright": None, "black": None, "credits_like": None})
                continue
            m = float(f.mean())
            medv = float(np.median(f))
            text = float((f > medv + 80).mean())
            cred = (1.0 if medv < 40 else max(0.0, (70 - medv) / 30)) * min(1.0, text / 0.03) * (text < 0.3)
            seconds.append({"t": int(start + 1000 * k), "bright": round(m, 1), "black": bool(m < 12 and f.std() < 6),
                            "credits_like": round(float(cred), 2)})
    return {"start_ms": int(round(start)), "end_ms": int(round(end)), "camera": camera,
            "global": {"hz": round(hz, 3), "dx": [round(float(x), 2) for x in dx], "dy": [round(float(x), 2) for x in dy],
                       "zoom": [round(float(x), 5) for x in zm]},
            "energy": {"t": [int(start + 1000 * k) for k in range(nsec)], "v": [None if v is None else round(v, 3) for v in ev]},
            "still": still, "heat": [[round(float(x), 3) for x in row] for row in heat], "seconds": seconds}


def cmd_stats(req, emit):
    p = {**STATS_DEFAULTS, **(req.get("params") or {})}
    unknown = set(p) - set(STATS_DEFAULTS)
    if unknown:
        raise ValueError(f"unknown params: {sorted(unknown)}")
    media = probe(req["video"])
    ranges = req.get("ranges") or [{"start_ms": 0, "end_ms": media["duration_ms"]}]
    total = sum(max(1, int((r["end_ms"] - r["start_ms"]) * p["fps"] / 1000)) for r in ranges)
    out, base = [], 0
    for r in ranges:
        a, b = int(r["start_ms"]), int(r["end_ms"])
        fl = decode_flow(req["video"], a, b, p["width"], p["fps"], emit, base, total)
        base += len(fl["t"])
        out.append(stats_from_flow(fl["t"], fl["blocks"], fl["thumbs"],
                                   {**p, "px_scale": media["width"] / fl["w"], "aspect": fl["h"] / fl["w"],
                                    "texture": fl["texture"],
                                    "flow_w": fl["w"], "start_ms": a, "end_ms": b}))
        emit({"type": "progress", "done": base, "total": max(total, base)})
    return {"ranges": out, "media": media}


# ---------------------------------------------------------------- motion.compare (pure)

def _series(t, v, t0, t1):
    """-> (grid, values, gaps [(a, b)] >= 200 ms, coverage) over [t0, t1); None/NaN = lost."""
    t = np.asarray(t, float)
    v = np.array([np.nan if x is None else x for x in v], float)
    m = (t >= t0) & (t < t1)
    t, v = t[m], v[m]
    grid = np.arange(t0, t1, GRID_MS)
    ok = np.isfinite(v)
    if ok.sum() < 2:
        return grid, None, [[int(t0), int(t1)]], 0.0
    lost = []  # [a, b) times with no valid sample: edges and runs of lost samples
    tg = t[ok]
    if tg[0] - t0 > GRID_MS * 5:
        lost.append((t0, tg[0]))
    for a, b in _runs(~ok):
        lost.append((t[a], t[b] if b < len(t) else t1))
    if t1 - tg[-1] > max(GRID_MS * 5, 2 * float(np.median(np.diff(tg))) if len(tg) > 1 else 0):
        lost.append((tg[-1], t1))
    cov = 1.0 - sum(b - a for a, b in lost) / max(1.0, t1 - t0)
    gaps = [[int(a), int(b)] for a, b in lost if b - a >= 200]
    return grid, np.interp(grid, tg, v[ok]), gaps, round(max(0.0, cov), 4)


def _cam_track(camera, t0, t1):
    """camera {t, dx, dy} (per-step displacements) -> position on its dominant axis, resampled to the grid."""
    t = np.asarray(camera["t"], float)
    q = np.stack([np.cumsum(np.asarray(camera["dx"], float)), np.cumsum(np.asarray(camera["dy"], float))], 1)
    c = q - q.mean(0)
    s = c @ np.linalg.eigh(c.T @ c)[1][:, -1]
    grid = np.arange(t0, t1, GRID_MS)
    return grid, np.interp(grid, t, s)


def compare(series, t0, t1, loop_period_ms=None, match_ms=MATCH_MS, camera=None):
    """README §8.3. series: [{id, role?, tracker?, channel?, t, v}] -> {"series": [...], "pairs": [...]}."""
    t0, t1 = float(t0), float(t1)
    cam = None
    if camera and len(camera.get("t") or []) >= 3:
        g, cs = _cam_track(camera, t0, t1)
        cam = _turn_series(g, cs)
    prep, out = [], []
    for s in series:
        grid, x, gaps, cov = _series(s["t"], s["v"], t0, t1)
        tt, kk = _turn_series(grid, x) if x is not None else (np.zeros(0), np.zeros(0, int))
        if gaps and len(tt):
            keep = np.array([not any(a <= u < b for a, b in gaps) for u in tt], bool)
            tt, kk = tt[keep], kk[keep]
        h = _halves(tt, [tuple(g) for g in gaps])
        covered_s = max(1e-3, (t1 - t0) / 1000 * cov)
        cyc = 2 * float(np.median(h)) if len(h) >= 2 else None
        row = {"id": s["id"], "role": s.get("role"), "tracker": s.get("tracker"), "channel": s.get("channel"),
               "turns": int(len(tt)), "turns_per_s": round(len(tt) / covered_s, 3),
               "half_cv": round(float(h.std() / h.mean()), 3) if len(h) >= 3 else None,
               "coverage": cov, "gaps": gaps, "cycle_ms": None if cyc is None else int(round(cyc)),
               "vs_loop": round(cyc / loop_period_ms, 3) if cyc and loop_period_ms else None,
               "camera_share": None, "camera_offset_ms": None}
        if cam is not None and len(tt) >= 2 and len(cam[0]) >= 2:
            pairs, flip = _share(tt, kk, cam[0], cam[1], match_ms)
            row["camera_share"] = round(len(pairs) / len(tt), 3)
            if pairs:
                row["camera_offset_ms"] = int(round(np.median([abs(cam[0][j] - tt[i]) for i, j in pairs])))
        prep.append((s["id"], grid, x, tt, kk))
        out.append(row)
    pairs_out = []
    for i in range(len(prep)):
        for j in range(i + 1, len(prep)):
            a, b = prep[i], prep[j]
            corr = None
            if a[2] is not None and b[2] is not None and np.std(a[2]) > 1e-9 and np.std(b[2]) > 1e-9:
                corr = round(float(np.corrcoef(a[2], b[2])[0, 1]), 3)
            pr, _ = _share(a[3], a[4], b[3], b[4], match_ms) if len(a[3]) and len(b[3]) else ([], False)
            n = len(a[3]) + len(b[3])
            pairs_out.append({"a": a[0], "b": b[0], "corr": corr, "match": round(2 * len(pr) / n, 3) if n else 0.0,
                              "median_offset_ms": int(round(np.median([b[3][q] - a[3][k] for k, q in pr]))) if pr else None})
    return {"series": out, "pairs": pairs_out}


def cmd_compare(req, emit):
    return compare(req.get("series") or [], req["t0"], req["t1"], req.get("loop_period_ms"),
                   req.get("match_ms") or MATCH_MS, req.get("camera"))


# ---------------------------------------------------------------- motion.propose

def propose_from_flow(fl, period_ms=None, boxes=None, k_max=3, border=0.12):
    """Decoded flow (decode_flow) -> candidates (README §8.4). Pure apart from the first frame's corners."""
    t, B = fl["t"].astype(float), fl["blocks"]
    n, gh, gw, _ = B.shape
    W, H = fl["w"], fl["h"]
    hz = 1000.0 / float(np.median(np.diff(t)))
    d, s, _ = fit_camera(B, pick_ref(B, ref_mask(gh, gw, border), fl.get("texture")), H / W)
    X, Y = _centres(gh, gw)
    P = np.stack([(X - 0.5) * W, (Y - 0.5) * H], -1)
    R = B - d[:, None, None] - (s / W)[:, None, None, None] * P[None]   # residual flow, px
    Q = np.cumsum(R, 0)
    win = max(3, int(round(4 * hz)))
    Q = Q - uniform_filter1d(Q, win, axis=0, mode="nearest")
    # per block: principal axis, projection, amplitude, spectral share at the stroke frequency
    C = np.einsum("nijk,nijl->ijkl", Q, Q)
    _, vecs = np.linalg.eigh(C)
    ax = vecs[..., -1]                                                  # (gh, gw, 2)
    S = np.einsum("nijk,ijk->nij", Q, ax)                               # (n, gh, gw)
    amp = np.percentile(S, 95, 0) - np.percentile(S, 5, 0)
    f = np.fft.rfftfreq(n, 1.0 / hz)
    pw = np.abs(np.fft.rfft(S * np.hanning(n)[:, None, None], axis=0)) ** 2
    band = (f >= 0.3) & (f <= min(6.0, hz / 2))
    if period_ms:
        f0 = 1000.0 / period_ms
    else:
        tot = pw[band].sum((1, 2))
        f0 = float(f[band][np.argmax(tot)]) if band.any() else 1.0
    near = (f >= 0.85 * f0) & (f <= 1.15 * f0)
    share = pw[near].sum(0) / np.maximum(pw[band].sum(0), 1e-12)
    score = share * amp / max(float(amp.max()), 1e-9)
    if boxes:
        inside = np.zeros((gh, gw), bool)
        for b in boxes:
            inside |= (X >= b["x"]) & (X <= b["x"] + b["w"]) & (Y >= b["y"]) & (Y <= b["y"] + b["h"])
        score = np.where(inside, score, 0.0)
    cam = np.cumsum(d, 0)
    cam = cam - uniform_filter1d(cam, win, axis=0, mode="nearest")
    if score.max() <= 0:
        return []
    m = (score >= 0.5 * score.max()).astype(np.uint8)
    nlab, lab, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    comps = sorted(range(1, nlab), key=lambda c: -score[lab == c].sum())[:k_max]
    order = np.argsort(-share.ravel())[:20]
    top = [(int(i // gw), int(i % gw)) for i in order]
    out = []
    for c in comps:
        sel = lab == c
        w8 = score[sel]
        cx, cy = float((X[sel] * w8).sum() / w8.sum()), float((Y[sel] * w8).sum() / w8.sum())
        a0 = ax[sel][np.argmax(w8)]
        al = np.where((ax[sel] @ a0)[:, None] < 0, -ax[sel], ax[sel])
        u = (al * w8[:, None]).sum(0)
        u = u / max(np.linalg.norm(u), 1e-9)                            # px direction
        x0, y0, bw, bh = st[c, 0], st[c, 1], st[c, 2], st[c, 3]
        box = {"x": round(max(0.0, (x0 - 0.5) / gw), 4), "y": round(max(0.0, (y0 - 0.5) / gh), 4),
               "w": round(min(1.0, (bw + 1) / gw), 4), "h": round(min(1.0, (bh + 1) / gh), 4)}
        box["w"], box["h"] = round(min(box["w"], 1 - box["x"]), 4), round(min(box["h"], 1 - box["y"]), 4)
        # "in" points toward the other figure's box, else toward the frame centre
        tgt = None
        if boxes and len(boxes) >= 2:
            others = [b for b in boxes if not (b["x"] <= cx <= b["x"] + b["w"] and b["y"] <= cy <= b["y"] + b["h"])]
            if others:
                b = max(others, key=lambda b: b["w"] * b["h"])
                tgt = (b["x"] + b["w"] / 2, b["y"] + b["h"] / 2)
        tgt = tgt or (0.5, 0.5)
        if (tgt[0] - cx) * W * u[0] + (tgt[1] - cy) * H * u[1] < 0:
            u = -u
        half = max(0.03 * W, float(np.median(amp[sel])) / 2)              # px
        axis = [round(cx - u[0] * half / W, 4), round(cy - u[1] * half / H, 4),
                round(cx + u[0] * half / W, 4), round(cy + u[1] * half / H, 4)]
        mask = np.zeros_like(fl["first"])
        mask[int(box["y"] * H):int((box["y"] + box["h"]) * H), int(box["x"] * W):int((box["x"] + box["w"]) * W)] = 255
        pts = cv2.goodFeaturesToTrack(fl["first"], 4, 0.01, max(3, W // 64), mask=mask)
        pts = [] if pts is None else [[round(float(p[0][0]) / W, 4), round(float(p[0][1]) / H, 4)] for p in pts]
        while len(pts) < 4:
            k = len(pts)
            pts.append([round(cx + (k % 2 - 0.5) * box["w"] / 3, 4), round(cy + (k // 2 - 0.5) * box["h"] / 3, 4)])
        sig = (S[:, sel] * np.sign(ax[sel] @ u)[None] * w8[None]).sum(1)  # the candidate's motion on its axis
        cam_s = cam @ u
        cc = float(abs(np.corrcoef(sig, cam_s)[0, 1])) if np.std(sig) > 1e-9 and np.std(cam_s) > 1e-9 else 0.0
        # pair: the most anti-phase pair among the strongest periodic blocks, one of them in this candidate
        pair, best = None, -0.3
        proj = np.einsum("nijk,k->nij", Q, u)
        for ia in range(len(top)):
            for ib in range(ia + 1, len(top)):
                (i1, j1), (i2, j2) = top[ia], top[ib]
                if not (sel[i1, j1] or sel[i2, j2]) or max(abs(i1 - i2), abs(j1 - j2)) < 2:
                    continue
                a, b = proj[:, i1, j1], proj[:, i2, j2]
                if np.std(a) < 1e-9 or np.std(b) < 1e-9:
                    continue
                r = float(np.corrcoef(a, b)[0, 1])
                if r < best:
                    best, pair = r, [[round(float(X[i1, j1]), 4), round(float(Y[i1, j1]), 4)],
                                     [round(float(X[i2, j2]), 4), round(float(Y[i2, j2]), 4)]]
        out.append({"box": box, "axis": axis, "points": pts[:4], "pair": pair,
                    "power": round(float(share[sel].mean()), 3), "cam_corr": round(cc, 3)})
    return out


def cmd_propose(req, emit):
    p = {**PROPOSE_DEFAULTS, **(req.get("params") or {})}
    unknown = set(p) - set(PROPOSE_DEFAULTS)
    if unknown:
        raise ValueError(f"unknown params: {sorted(unknown)}")
    fl = decode_flow(req["video"], int(req["start_ms"]), int(req["end_ms"]), p["width"], 15, emit)
    return {"candidates": propose_from_flow(fl, req.get("period_ms"), req.get("boxes"), int(p["max"]))}
