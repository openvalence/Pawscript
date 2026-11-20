"""Loop period, held frames (animation on twos/threes), loop folding and retiming. No ML.

Everything works on tiny grey thumbnails (THUMB_W wide), so it costs nothing next to decoding."""
import warnings

import cv2
import numpy as np
from scipy.signal import find_peaks

from pawtrack.registry import param

THUMB_W = 64
MAX_FRAMES = 4000  # ponytail: only the first 4000 frames are analysed (period up to ~66 s at 30 fps); band-limited diffs if longer
LOOP_PARAMS = [
    param("loop_min_confidence", "Min loop confidence", "float", 0.5, 0.0, 1.0),
]
# shared by every tracker, like pipe_* / cut_*
FOLD_PARAMS = [
    param("loop_fold", "Fold perfect loops", "choice", "off", choices=["off", "auto", "on"]),
    param("held_retime", "Retime held frames (twos/threes)", "choice", "auto", choices=["off", "auto", "on"]),
    *LOOP_PARAMS,
]


def thumb(bgr):
    """Full or small BGR frame -> THUMB_W-wide grey float32."""
    h, w = bgr.shape[:2]
    if w != THUMB_W:
        bgr = cv2.resize(bgr, (THUMB_W, max(2, round(h * THUMB_W / w))), interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)


def lag_curve(thumbs, max_lag):
    """RMS difference between frame i and i+lag, averaged over i, for lag 0..max_lag.
    RMS (not mean abs) so it falls out of one Gram matrix: |a-b|^2 = a.a + b.b - 2 a.b."""
    f = np.asarray(thumbs, np.float64).reshape(len(thumbs), -1)
    f -= f.mean(0)
    g = f @ f.T
    sq = np.diag(g)
    n = len(f)
    d = [0.0] + [float(np.mean(sq[:n - L] + sq[L:] - 2 * np.diagonal(g, L))) for L in range(1, max_lag + 1)]
    return np.sqrt(np.maximum(d, 0) / f.shape[1])


MIN_LAG = 4          # frames; a shorter "period" (>= 6 Hz at 24 fps) is flicker, not a stroke
PERIODIC_PROM = 0.1  # valley prominence / median difference for "clearly periodic motion"
EXACT_REL = 0.4      # d(period) / median at which exactness confidence reaches 0


def detect_period(thumbs):
    """Periodic motion from the lag curve d(L) (RMS frame difference at lag L).

    The period is a real valley of d, not "the smallest lag near the floor": on real footage d
    rises with the lag (drift, slow motion), so its floor is lag 2 and the old rule always said 2.
    Valleys with prominence >= 3% of median(d) are candidates; the first one at least 0.8x as
    prominent as the best is the period (the best may be a multiple of it).
    Returns {"period_frames": int|None, "kind": "exact"|"periodic"|None, "confidence": 0..1,
    "prominence": valley prominence / median(d), "rel": d(period) / median(d), "cycles": int}.
    confidence = how close to an exact loop (frames repeat to codec noise), confirmed by the
    multiples: 1 - rel / EXACT_REL, times the share of confirmed multiples. kind "exact" if it is
    >= 0.5, else "periodic" if prominence >= PERIODIC_PROM (same rhythm, cycles differ), else None."""
    thumbs = thumbs[:MAX_FRAMES]
    n = len(thumbs)
    none = {"period_frames": None, "kind": None, "confidence": 0.0, "prominence": 0.0, "rel": None, "cycles": 0}
    if n < 2 * MIN_LAG + 2:
        return none
    d = lag_curve(thumbs, n // 2)  # d[L] = lag L; up to n/2 so >= 2 cycles are seen
    med = float(np.median(d[1:]))
    if med < 0.5:  # ~static scene (grey levels)
        return none
    pk, pr = find_peaks(-d, prominence=0.03 * med)
    prom = pr["prominences"][pk >= MIN_LAG] / med
    pk = pk[pk >= MIN_LAG]
    if not len(pk):
        return none
    k = next(i for i in range(len(pk)) if prom[i] >= 0.8 * prom.max())
    L, rel = int(pk[k]), float(d[pk[k]] / med)
    mult = range(2 * L, len(d) - 1, L)
    ok = sum(d[m - 1:m + 2].min() <= d[L] + 0.25 * (med - d[L]) for m in mult)  # +-1 frame
    conf = float(np.clip((1 - rel / EXACT_REL) * (ok + 1) / (len(mult) + 1), 0, 1))
    kind = "exact" if conf >= 0.5 else "periodic" if prom[k] >= PERIODIC_PROM else None
    return {"period_frames": L if kind else None, "kind": kind, "confidence": round(conf, 3),
            "prominence": round(float(prom[k]), 3), "rel": round(rel, 3), "cycles": n // L if kind else 0}


def held_frames(thumbs):
    """Animation on twos/threes: which frames show a new drawing. Returns
    {"step": dominant frames per drawing (1 = every frame new), "ratio": fraction of held frames,
     "new": bool array, True where a frame differs from the previous one}."""
    # per pair: 99th percentile of |diff|, so a small moving part still counts as change
    return held_from_diffs([np.percentile(np.abs(a - b), 99) for a, b in zip(thumbs[1:], thumbs[:-1])])


def held_from_diffs(c):
    """c: per pair (frame i vs i-1) 99th percentile |diff|, len = frames - 1. -> held_frames' dict plus
    "thr": the new-drawing threshold on c (None: too short or static scene, every frame new).
    Shared by the thumb path above and the point trackers' working-res held_input."""
    c = np.asarray(c, float)
    new = np.ones(len(c) + 1, bool)
    flat = {"step": 1, "ratio": 0.0, "new": new, "thr": None}
    if len(c) < 2:
        return flat
    hi = float(np.percentile(c, 90))
    # ponytail: fixed noise floor (8 grey levels at the 99th pct, 64 px wide); a calibrated codec noise model if it misfires
    if hi < 8:
        return flat  # static scene
    thr = max(4.0, 0.3 * hi)
    new[1:] = c > thr
    starts = np.flatnonzero(new)
    runs = np.diff(starts)
    step = int(np.bincount(runs).argmax()) if len(runs) else 1
    return {"step": step, "ratio": round(float(1 - new.mean()), 3), "new": new, "thr": thr}


def retime(t, v, new):
    """Keep one sample per drawing (where it first appears) and interpolate between them,
    instead of a staircase. NaN (lost) samples stay NaN."""
    t, v = np.asarray(t, float), np.asarray(v, float)
    keep = new & np.isfinite(v)
    if keep.sum() < 2:
        return v
    out = np.interp(t, t[keep], v[keep])
    out[~np.isfinite(v)] = np.nan
    return out


def fold(v, period):
    """Median of every phase over all cycles (NaN ignored), tiled back: all cycles identical.
    ponytail: phase = frame index mod period, i.e. assumes constant frame rate inside the range (true for rendered loops)."""
    v = np.asarray(v, float)
    n = len(v)
    cyc = np.concatenate([v, np.full(-n % period, np.nan)]).reshape(-1, period)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # a phase lost in every cycle stays NaN
        med = np.nanmedian(cyc, axis=0)
    return np.tile(med, len(cyc))[:n]
