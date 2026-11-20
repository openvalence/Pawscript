"""Per-scene auto levels for the frames the trackers see (PROTOCOL v4.23, paw-p63x). Photometric only: one adjustment per
scene, computed once from a sample of the scene's frames and applied identically to every frame of it (a tracker reads a
brightness change as motion), so coordinates and overlays are untouched. Mild, global, nothing learned, nothing local:

  luma   black / white points = p1 / p99.5 of the sample's luma (letterbox bars and pure-black frames left out), each
         with a margin (BLACK_MARGIN / WHITE_MARGIN levels left alone, so well-exposed footage stays put), stretched
         linearly; gain capped at MAX_GAIN. Then a gamma that moves the median into [MID_LO, MID_HI] (nothing inside
         it), clamped to GAMMA_RANGE and so that no midtone is lifted by more than MAX_GAIN overall (noise and
         compression blocks in very dark footage are not blown up into texture). One 256-entry LUT on all channels.
  colour HSV saturation x k (hue exact, nothing clips past full saturation) so the sample's median saturation reaches
         SAT_TARGET; k <= MAX_SAT; skipped for near-greyscale footage and when the sample is already saturated enough.
  A result within TOLERANCE levels of the identity is dropped (the frames pass through untouched).
"""
import cv2
import numpy as np

from pawtrack.registry import param

LEVEL_PARAMS = [
    param("input_levels", "Tracker input levels", "choice", "auto", choices=["auto", "off"],
          hint="auto: one mild brightness / contrast / saturation adjustment per scene (black and white points, gamma, "
               "saturation), computed from a sample of the scene and applied to every frame the tracker sees; "
               "well-exposed footage is left alone. off: the frames as decoded. Coordinates are unaffected."),
]

SAMPLE_FRAMES = 24
LO_PCT, HI_PCT = 1.0, 99.5
BLACK_MARGIN, WHITE_MARGIN = 40, 30    # levels beyond the percentiles left untouched
MAX_GAIN = 4.0
GAMMA_RANGE = (0.5, 2.0)
MID_LO, MID_HI = 0.30, 0.55            # the median (after the stretch, 0..1) is moved only as far as this band
SAT_TARGET, MAX_SAT = 0.20, 2.0        # HSV saturation 0..1 of the sample's median colourful pixel
SAT_OK, GREY_P90 = 0.15, 0.06          # above SAT_OK: nothing to do; p90 below GREY_P90: greyscale footage
TOLERANCE = 10                         # max |LUT - identity| (levels) that still counts as unchanged
BAR_MAX = 12                           # an edge row / column that never exceeds this in the sample is a bar
DEAD_MEDIAN = 2.0                      # a frame whose mean luma is below this is a pure-black frame
IDENT = np.arange(256, dtype=np.uint8)


def _luma(img):
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def _crop_bars(grays):
    """Rows / columns at the edges that stay <= BAR_MAX in every sample frame (letterbox / pillarbox), at most 25 %
    of a side each: -> (y0, y1, x0, x1)."""
    mx = np.max([g for g in grays], axis=0) if len(grays) > 1 else grays[0]
    H, W = mx.shape
    rows, cols = mx.max(axis=1) > BAR_MAX, mx.max(axis=0) > BAR_MAX
    def span(m, n):
        if not m.any():
            return 0, n
        a, b = int(np.argmax(m)), int(n - np.argmax(m[::-1]))
        return min(a, n // 4), max(b, n - n // 4)
    (y0, y1), (x0, x1) = span(rows, H), span(cols, W)
    return y0, y1, x0, x1


def auto_levels(frames):
    """frames: BGR uint8 images (a sample of one scene, any size). -> (adj, record). adj = None (nothing to apply) or
    {"lut": uint8[256], "sat": float}; record = the JSON-safe account of what was decided (scenes[].input)."""
    frames = [f for f in frames if f is not None]
    grays = [_luma(f) for f in frames]
    keep = [i for i, g in enumerate(grays) if g.mean() >= DEAD_MEDIAN]
    if not keep:
        return None, {"applied": False, "mode": "auto", "why": "no usable frames", "frames": 0}
    frames, grays = [frames[i] for i in keep], [grays[i] for i in keep]
    y0, y1, x0, x1 = _crop_bars(grays)
    body = np.concatenate([g[y0:y1, x0:x1][::2, ::2].ravel() for g in grays])
    lo, med, hi = (float(v) for v in np.percentile(body, [LO_PCT, 50, HI_PCT]))
    rec = {"mode": "auto", "frames": len(grays), "p1": round(lo), "median": round(med), "p99_5": round(hi), "capped": []}
    if hi - lo < 8:
        return None, {**rec, "applied": False, "why": "flat sample"}
    lo_e, hi_e = max(0.0, lo - BLACK_MARGIN), min(255.0, hi + WHITE_MARGIN)
    gain = 255.0 / (hi_e - lo_e)
    if gain > MAX_GAIN:
        gain = MAX_GAIN
        rec["capped"].append("gain")
    x = np.clip((IDENT.astype(np.float64) - lo_e) * gain / 255.0, 0.0, 1.0)
    m1 = float(np.clip((med - lo_e) * gain / 255.0, 1e-3, 0.999))
    target = float(np.clip(m1, MID_LO, MID_HI))
    g = float(np.log(target) / np.log(m1)) if target != m1 else 1.0
    floor = 4.0 * med / 255.0  # the median's output may not exceed MAX_GAIN x its input
    if floor < 1.0 and m1 ** g > floor:
        g2 = float(np.log(floor) / np.log(m1))
        if g2 > g:
            g = g2
            rec["capped"].append("noise gain")
    g = float(np.clip(g, *GAMMA_RANGE)) if g < 1 else float(np.clip(g, 1.0, GAMMA_RANGE[1]))
    if g <= GAMMA_RANGE[0] + 1e-9 or g >= GAMMA_RANGE[1] - 1e-9:
        rec["capped"].append("gamma")
    lut = np.round(255.0 * x ** g).astype(np.uint8)
    # saturation, measured on the sample as it will look after the LUT
    sat = 1.0
    hsv = np.concatenate([cv2.cvtColor(cv2.LUT(f[y0:y1, x0:x1][::2, ::2], lut), cv2.COLOR_BGR2HSV).reshape(-1, 3) for f in frames])
    s = hsv[hsv[:, 2] >= 40, 1] / 255.0
    if s.size >= 100 and np.percentile(s, 90) >= GREY_P90 and np.median(s) < SAT_OK:
        sat = SAT_TARGET / max(float(np.median(s)), 1e-3)
        if sat > MAX_SAT:
            sat = MAX_SAT
            rec["capped"].append("saturation")
        sat = round(max(1.0, sat), 3)
    ident = int(np.abs(lut.astype(int) - IDENT).max()) <= TOLERANCE
    if ident and sat < 1.05:
        return None, {**rec, "applied": False, "why": "unchanged", "capped": []}
    if ident:
        lut = IDENT
    rec.update(applied=True, black=round(lo_e), white=round(hi_e), gain=round(gain, 3), gamma=round(g, 3), saturation=sat,
               lift=round(float(lut[int(round(med))]) / max(med, 1.0), 2))
    return {"lut": lut, "sat": sat if sat >= 1.05 else 1.0}, rec


def apply_levels(img, adj):
    """The adjustment on one BGR uint8 frame (a new array; img untouched). adj None -> img itself."""
    if adj is None:
        return img
    out = cv2.LUT(img, adj["lut"])
    if adj["sat"] != 1.0:
        hsv = cv2.cvtColor(out, cv2.COLOR_BGR2HSV)
        s = cv2.LUT(hsv[..., 1], np.clip(np.arange(256) * adj["sat"], 0, 255).astype(np.uint8))
        out = cv2.cvtColor(np.dstack([hsv[..., 0], s, hsv[..., 2]]), cv2.COLOR_HSV2BGR)
    return out


def levelled(frames, adj):
    """A (t_ms, BGR) stream with the scene's adjustment applied to every frame."""
    for t, img in frames:
        yield t, apply_levels(img, adj)


def sample_scene(video, start_ms, end_ms, seed_ms=None, n=SAMPLE_FRAMES, width=320):
    """<= n frames spread over [start_ms, end_ms) of the video (one cheap decode at `width`), always the seed frame
    (the last at or before seed_ms) when given. -> list of BGR."""
    from pawtrack.video import open_frames
    total, it = open_frames(video, start_ms, end_ms, width=width)
    stride, keep, seed_img = max(1, total // n), [], None
    for k, (t, img) in enumerate(it):
        if seed_ms is not None and t <= seed_ms:
            seed_img = img
        if k % stride == 0:
            keep.append(img)
            if len(keep) >= 2 * n:  # the estimate was low: thin out, keep going
                keep, stride = keep[::2], stride * 2
    keep = keep[::max(1, len(keep) // n)][:n] if len(keep) > n else keep
    return keep + ([seed_img] if seed_img is not None and not any(seed_img is k for k in keep) else [])


def scene_levels(video, start_ms, end_ms, seed_ms=None):
    """One scene's (adj, record), from a sample of its frames."""
    return auto_levels(sample_scene(video, start_ms, end_ms, seed_ms))


def describe(rec):
    """The one line the app shows is built from the record in JS; this is the same sentence for logs and tests."""
    if not rec.get("applied"):
        return "unchanged"
    return (f"levels {rec['black']}-{rec['white']}, gamma {rec['gamma']}, saturation x{rec['saturation']}"
            + (f" (capped: {', '.join(rec['capped'])})" if rec["capped"] else ""))
