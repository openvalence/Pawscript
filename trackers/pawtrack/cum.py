"""Cumshot proposals over an orgasm range (PROTOCOL `cum`): one proposed spurt time per cumshot, for the owner to accept.

detect(video, start_ms, end_ms, params, emit, pulses=None, groups=None, pulse_range=None)
  -> {"spurts": [{t_ms, score, source, why, strong}], "curve": {t, cum}, "pulse"?, "channels"?, ...}

Signals, per decoded frame of the range (features(); the tagger at ~`fps`, the pixel signals on every frame):
  tag    Hydra 3.5 (pawtrack/describe.py) probability of the spurt tags (ejaculation, cumshot, cum_string ...)
  cam    the tagger's CAM mass of the cum tags (how much of the picture it reads as cum)
  fluid  share of bright, low-saturation pixels that are NEW in this frame, inside the penis / cum CAM region
  pulses (optional, from the caller) contraction peak times, e.g. a points run's sem_balls_scale peaks
  groups (optional, v4.16) painted regions; the pulse ones (anus by default) are tracked by pawtrack/pulse.py (SAM 2.1
         masks over the orgasm span) and each contraction is a cue of its own
Pure part (CPU, tested): strength() turns a curve into an onset strength (rise over its trailing minimum, robustly
scaled), fuse() weights and sums them, picks peaks >= min_gap_ms apart and boosts a peak within pulse_ms of a pulse;
merge() joins those peaks and the contraction cues into one proposal per shot with its evidence (`why`).
"""
import numpy as np

from pawtrack.registry import coerce, param

PARAMS = [
    param("fps", "Tagger frames per second", "float", 12.0, 2.0, 30.0),
    param("seqlen", "Tagger patches (CAM detail vs. speed)", "int", 512, 256, 1024),
    param("min_gap_ms", "Min spacing between spurts (ms)", "int", 120, 40, 2000),
    param("smooth_ms", "Curve smoothing (ms)", "int", 80, 0, 500),
    param("rise_ms", "Onset window: rise over the trailing min (ms)", "int", 250, 40, 1500),
    param("threshold", "Lowest score reported (0..1)", "float", 0.15, 0.0, 1.0),
    param("strong", "Score of a strong proposal (0..1)", "float", 0.5, 0.0, 1.0),
    param("w_tag", "Weight: spurt-tag probability", "float", 1.0, 0.0, 5.0),
    param("w_cam", "Weight: cum CAM mass", "float", 1.0, 0.0, 5.0),
    param("w_fluid", "Weight: new fluid pixels", "float", 1.0, 0.0, 5.0),
    param("pulse_ms", "Pulse alignment window (ms)", "int", 100, 0, 500),
    param("pulse_boost", "Score boost near a contraction pulse", "float", 0.5, 0.0, 3.0),
    # v4.16 pulse groups (pawtrack/pulse.py): a painted region's contractions as their own cue
    param("cue_ms", "Cues within this are one shot (ms)", "int", 200, 0, 1000),
    param("pulse_sam", "Track pulse groups with SAM (else the points fallback)", "bool", True),
    param("pulse_model", "SAM model for pulse groups", "choice", "small", choices=["tiny", "small", "base_plus", "large"]),
    param("pulse_offset_ms", "Spurt time after the contraction appears (ms)", "int", 0, -500, 500),
    param("pulse_sign", "Contraction = smaller (-), larger (+) or the fast phase (auto)", "choice", "auto", choices=["auto", "-", "+"]),
]
# spurt-type tags (a subset of src/features/timeline/acts.js CUM_TAGS: the ones that mean cum leaving the penis now)
SPURT_TAGS = ["ejaculation", "cumshot", "cum_spurt", "cum_string", "cum_from_penis", "cum_explosion", "cum_splatter",
              "orgasm"]
CAM_TAGS = ["cum", "ejaculation", "cumshot"]
ROI_TAGS = ["penis", "balls"]
SOURCES = ("tag", "cam", "fluid")
IMPULSE = {"fluid"}  # sources that are onsets already (fluid = pixels new in this frame); the others are levels
PIX_W = 320  # px width of the pixel signals


# ---------------------------------------------------------------- pure (CPU)

def _smooth(t, x, ms):
    """Centered moving average over ~ms (in samples of the median frame step); NaN-safe (linear fill)."""
    x = np.asarray(x, float)
    ok = np.isfinite(x)
    if ok.sum() < 2:
        return np.zeros_like(x)
    x = np.interp(np.arange(len(x)), np.flatnonzero(ok), x[ok])
    dt = float(np.median(np.diff(t))) if len(t) > 1 else 40.0
    k = int(round(ms / max(dt, 1)))
    if k < 2:
        return x
    w = np.ones(k) / k
    return np.convolve(np.pad(x, (k // 2, k - 1 - k // 2), mode="edge"), w, "valid")


def strength(t, x, smooth_ms=80, rise_ms=250, noise_k=8.0, impulse=False):
    """Onset strength of curve x (any units) on times t (ms): the smoothed curve's rise across a centred rise_ms window,
    s(t + rise/2) - s(t - rise/2), clipped at 0 and divided by max(its p99, noise_k x its noise sigma (1.4826 MAD)), so
    the strongest rises of the range reach ~1 (a few can exceed it; not clipped, so a peak keeps its shape) while a range
    of noise alone stays low. A step up (new cum on screen) gives one bump peaking at the step; flat or falling gives 0.
    impulse: x already is an onset signal (e.g. pixels new in this frame): the smoothed curve itself, scaled the same way."""
    t = np.asarray(t, float)
    s = _smooth(t, x, smooth_ms)
    if len(s) < 3:
        return np.zeros(len(s))
    dt = float(np.median(np.diff(t)))
    h = max(1, int(round(rise_ms / 2 / max(dt, 1))))
    e = np.pad(s, h, mode="edge")
    d = s if impulse else _smooth(t, e[2 * h:] - e[:-2 * h], rise_ms)  # a step's box -> a triangle peaking on it
    sigma = 1.4826 * np.median(np.abs(d - np.median(d)))
    r = np.clip(d, 0, None)
    scale = max(np.percentile(r, 99), noise_k * sigma, 1e-9)
    return r / scale


def peaks(t, y, min_gap_ms, floor=0.0):
    """Local maxima of y (>= floor), greedy by height, >= min_gap_ms apart. -> sorted indices."""
    y = np.asarray(y, float)
    if len(y) < 3:
        return []
    loc = np.flatnonzero((y[1:-1] >= y[:-2]) & (y[1:-1] > y[2:]) & (y[1:-1] >= floor)) + 1
    keep = []
    for i in sorted(loc, key=lambda i: -y[i]):  # ponytail: O(n*k) greedy; k = spurts, small
        if all(abs(t[i] - t[j]) >= min_gap_ms for j in keep):
            keep.append(i)
    return sorted(keep)


def fuse(t, curves, p, pulses=None):
    """curves: {source: raw curve on t}. -> (fused curve on t, clipped to 0..1; [{t_ms, score, source}] with score >=
    threshold).
    fused = sum_i w_i strength_i / sum_i w_i over the sources present (a source that is all NaN / absent is left out,
    not counted as 0). A peak within pulse_ms of a pulse time gets x (1 + pulse_boost), capped at 1. source = the
    strongest contributor at the peak, "+pulse" when boosted."""
    p = coerce(PARAMS, p)
    t = np.asarray(t, float)
    st, ws = {}, {}
    for k, x in curves.items():
        w = p.get(f"w_{k}", 1.0)
        if x is None or w <= 0 or not np.isfinite(np.asarray(x, float)).any():
            continue
        st[k], ws[k] = strength(t, x, p["smooth_ms"], p["rise_ms"], impulse=k in IMPULSE), w
    if not st or len(t) < 3:
        return np.zeros(len(t)), []
    W = sum(ws.values())
    f = sum(ws[k] * st[k] for k in st) / W
    pul = np.asarray(sorted(pulses or []), float)
    out = []
    for i in peaks(t, f, p["min_gap_ms"]):
        sc, src = min(1.0, float(f[i])), max(st, key=lambda k: ws[k] * st[k][i])
        if len(pul) and p["pulse_ms"] > 0 and np.min(np.abs(pul - t[i])) <= p["pulse_ms"]:
            sc, src = min(1.0, sc * (1 + p["pulse_boost"])), src + "+pulse"
        if sc >= p["threshold"]:
            out.append({"t_ms": int(round(t[i])), "score": round(sc, 3), "source": src})
    return np.clip(f, 0, 1), out


def merge(spurts, cues, p):
    """Fuse fuse()'s proposals with pulse cues into one proposal per shot, each with its evidence.
    spurts: [{t_ms, score, source}] (source "tag" | "cam" | "fluid", "+pulse" = an aligned `pulses` time, e.g. balls);
    cues: [{t_ms, score, cue}] (pulse.py contraction events; cue = "anus (Top)").
    Strongest first, each joins the shot whose time is within cue_ms (one entry per cue), else starts one. A shot's
    score = 1 - prod(1 - score) over its cues (agreeing cues raise it; one cue alone keeps its score); its time = its
    strongest contraction cue's (frame-accurate, timed on the drawing), else the visual peak's. -> [{t_ms, score,
    source (the strongest cue), why: [{cue, score?}, ...] strongest first}] by time, score >= threshold."""
    p = coerce(PARAMS, p)
    items = [{"t": s["t_ms"], "s": s["score"], "cue": s["source"].replace("+pulse", ""), "pulse": False,
              "extra": "+pulse" in s["source"]} for s in spurts]
    items += [{"t": c["t_ms"], "s": c["score"], "cue": c["cue"], "pulse": True, "extra": False} for c in cues]
    shots = []
    for it in sorted(items, key=lambda x: -x["s"]):
        sh = next((q for q in shots if abs(q["t"] - it["t"]) <= p["cue_ms"] and it["cue"] not in q["cues"]), None)
        if sh is None:
            shots.append({"t": it["t"], "timed": it["pulse"], "cues": {it["cue"]: it}})
            continue
        sh["cues"][it["cue"]] = it
        if it["pulse"] and not sh["timed"]:
            sh["t"], sh["timed"] = it["t"], True
    out = []
    for sh in shots:
        cs = sorted(sh["cues"].values(), key=lambda x: -x["s"])
        sc = min(1.0, 1 - float(np.prod([1 - min(1.0, c["s"]) for c in cs])))
        if sc < p["threshold"]:
            continue
        why = [{"cue": c["cue"], "score": round(min(1.0, c["s"]), 3)} for c in cs]
        if any(c["extra"] for c in cs):
            why.append({"cue": "balls pulse"})
        out.append({"t_ms": int(round(sh["t"])), "score": round(sc, 3), "source": cs[0]["cue"] + ("+pulse" if cs[0]["extra"] else ""),
                    "why": why})
    return sorted(out, key=lambda s: s["t_ms"])


# ---------------------------------------------------------------- GPU + decode

def _fluid(bgr):
    """Bright, low-saturation pixels (cum white): max channel >= 190 and chroma <= 0.18 x max. -> bool (h, w)."""
    mx, mn = bgr.max(2).astype(np.int16), bgr.min(2).astype(np.int16)
    return (mx >= 190) & (mx - mn <= 0.18 * mx)


def _roi(boxes, shape):
    """Union of normalized boxes, padded 25 % each side -> pixel slice (y0, y1, x0, x1) of shape, or the full frame."""
    h, w = shape
    bs = [b for b in boxes if b]
    if not bs:
        return 0, h, 0, w
    x0, y0 = min(b[0] for b in bs), min(b[1] for b in bs)
    x1, y1 = max(b[0] + b[2] for b in bs), max(b[1] + b[3] for b in bs)
    px, py = 0.25 * (x1 - x0), 0.25 * (y1 - y0)
    return (int(max(0, y0 - py) * h), max(int(max(0, y0 - py) * h) + 1, int(min(1, y1 + py) * h)),
            int(max(0, x0 - px) * w), max(int(max(0, x0 - px) * w) + 1, int(min(1, x1 + px) * w)))


def features(video, start_ms, end_ms, p, emit=lambda d, t, **k: None):
    """Decode [start_ms, end_ms]; the tagger on every k-th frame (k from fps), the pixel signals on every frame.
    -> {"t": [n] ms, "tag": [n], "cam": [n], "fluid": [n], "fluid_all": [n] (fluid share, not only new), "motion" / "motion_vy": [n] (flow
    magnitude / mean vertical flow in the region, px per frame at PIX_W), "tagged": [n] bool,
    "per_tag": {tag: [n]}, "per_cam": {tag: [n]}} (tagger values
    are NaN on frames it skipped; numbers only, no frame or map leaves this function)."""
    import cv2
    import torch
    from pawtrack import describe as D
    from pawtrack.video import open_frames, probe
    m = D.load()
    thr = D.thresholds(m, 0.5)
    have = lambda tags: [x for x in tags if x in m.index]
    sp, ct, rt = have(SPURT_TAGS), have(CAM_TAGS), have(ROI_TAGS)
    fps_v = probe(video).get("fps") or 30
    step = max(1, int(round(fps_v / p["fps"])))
    total, frames = open_frames(video, int(start_ms), int(end_ms), width=768)
    emit(0, total)
    T, tag, cam, fluid, fall, tagged, mot, mvy = [], [], [], [], [], [], [], []
    per, pcam = {x: [] for x in sp}, {x: [] for x in ct}
    boxes, prev, pgray = [], None, None
    for i, (t, bgr) in enumerate(frames):
        T.append(t)
        if i % step == 0:
            feats, valid, grid = D._features(m, bgr, p["seqlen"])
            with torch.no_grad():
                pr = m.forward_head(feats, valid)[0].float().cpu().numpy()
            ratio = {x: float(pr[m.index[x]]) for x in sp}
            for x in sp:
                per[x].append(ratio[x])
            tag.append(max(ratio.values()) if ratio else np.nan)
            cams = D._cams(m, feats, valid, grid, ct + rt)
            n = grid[0] * grid[1]
            for x in ct:
                pcam[x].append(float(cams[x].sum()) / max(1, n) if x in cams else np.nan)
            cam.append(float(sum(cams[x].sum() for x in ct if x in cams)) / max(1, n))
            seen = [x for x in ct + rt if x in cams and pr[m.index[x]] >= 0.5 * thr[m.index[x]]]
            boxes = [D.cam_box(cams[x], 0.3) for x in seen] or boxes  # keep the last region while the tagger is unsure
            tagged.append(True)
        else:
            tag.append(np.nan)
            cam.append(np.nan)
            for x in sp:
                per[x].append(np.nan)
            for x in ct:
                pcam[x].append(np.nan)
            tagged.append(False)
        small = cv2.resize(bgr, (PIX_W, max(2, round(bgr.shape[0] * PIX_W / bgr.shape[1]))), interpolation=cv2.INTER_AREA)
        y0, y1, x0, x1 = _roi(boxes, small.shape[:2])
        fl = _fluid(small[y0:y1, x0:x1])
        fall.append(float(fl.mean()))
        if prev is not None and prev.shape == small.shape[:2]:
            was = cv2.dilate(prev[y0:y1, x0:x1].astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
            fluid.append(float((fl & ~was).mean()))
        else:
            fluid.append(np.nan)
        prev = _fluid(small)
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        if pgray is not None and pgray.shape == gray.shape and y1 - y0 >= 8 and x1 - x0 >= 8:
            fl2 = cv2.calcOpticalFlowFarneback(pgray[y0:y1, x0:x1], gray[y0:y1, x0:x1], None, 0.5, 2, 9, 2, 5, 1.1, 0)
            mot.append(float(np.sqrt((fl2 ** 2).sum(-1)).mean()))
            mvy.append(float(fl2[..., 1].mean()))
        else:
            mot.append(np.nan)
            mvy.append(np.nan)
        pgray = gray
        emit(i + 1, total)
    if not T:
        raise ValueError("no decodable frames in range")
    return {"t": np.array(T, float), "tag": np.array(tag), "cam": np.array(cam), "fluid": np.array(fluid),
            "fluid_all": np.array(fall), "motion": np.array(mot), "motion_vy": np.array(mvy), "tagged": np.array(tagged),
            "per_tag": {k: np.array(v) for k, v in per.items()}, "per_cam": {k: np.array(v) for k, v in pcam.items()}}


def detect(video, start_ms, end_ms, params, emit=lambda d, t, **k: None, pulses=None, groups=None, pulse_range=None):
    """groups (v4.16): the scene's painted groups; the pulse ones (pulse.is_pulse) are tracked over pulse_range (the
    orgasm span, clipped to [start_ms, end_ms]; default the whole range) +- pulse.MARGIN_MS (the margin may reach past
    the range: the trend needs context), and their contractions inside the range join the proposals as cues (merge).
    Their signals come back as channels sem_<name>_pulse."""
    p = coerce(PARAMS, params)
    found = []
    if groups:
        from pawtrack import pulse
        a, b = pulse_range or (start_ms, end_ms)
        a, b = max(start_ms, int(a)), min(end_ms, int(b))
        if b <= a:
            raise ValueError("pulse_range is outside [start_ms, end_ms]")
        a, b = max(0, a - pulse.MARGIN_MS), b + pulse.MARGIN_MS
        found = pulse.run(video, groups, a, b, p, emit)
    F = features(video, start_ms, end_ms, p, emit)
    f, spurts = fuse(F["t"], {k: F[k] for k in SOURCES}, p, pulses)
    cues = [{"t_ms": e["t_ms"], "score": e["score"], "cue": r["label"]} for r in found for e in r["events"]
            if start_ms <= e["t_ms"] < end_ms]
    spurts = merge(spurts, cues, p)
    for s in spurts:
        s["strong"] = s["score"] >= p["strong"]
    out = {"spurts": spurts, "curve": {"t": [int(x) for x in F["t"]], "cum": [round(float(x), 3) for x in f]},
           "frames": int(len(F["t"])), "tagged": int(F["tagged"].sum())}
    if found:
        keys = ("name", "label", "part", "who", "source", "frames", "seed_ms", "sign", "sam_ms", "lost", "crop", "note")
        out["pulse"] = [{**{k: r[k] for k in keys if k in r}, "events": r["events"], "range": [int(r["t"][0]), int(r["t"][-1])]}
                        for r in found]
        out["channels"] = {f"sem_{r['name']}_pulse": r["channel"] for r in found}
    return out
