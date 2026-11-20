"""Semantic names for motion groups (bodies g1..g4 and their parts g1p1..) from the Hydra tagger's CAM heat maps.

Per scene, K frames spread over it (a tap on the tracker's frame stream keeps an evenly decimated subset). Per frame,
one Hydra pass (pawtrack.describe): for every vocabulary tag that passes its threshold at CONF, the CAM over the
patch grid (3x3 blurred as describe.cam_box, divided by its frame max); a label's heat = max over its tags. A group's
mass for a label = the mean heat (bilinear) at its visible members' positions. Over the K frames the masses are
averaged (frames where the group has >= MIN_PTS visible members). Decision: label = argmax if its mass >= BODY (the
"body" fallback: no part tag lights the group up) and beats the runner-up by >= MARGIN, else "body". Geometry: a
SMALL label (penis, balls, ...) needs the group's spread < SMALL_FRAC x its parent's (a part's parent = its body, a
body's = all visible points); otherwise "body" and `suspect` names the tag. Labels and masses go into a `group_labels`
note and track result scenes[].groups (PROTOCOL); never into the frame events.
"""
import sys
from contextlib import contextmanager

import numpy as np

# label -> real Hydra 3.5 tag names (checked against the model's label list). No e621 tag for head/face/muzzle or
# plain hands: head = mouth parts, hand = fingers ("paws" also fires on hindpaws, so it is left out).
VOCAB = {
    "penis": ("penis", "glans", "knotted_penis"),
    "balls": ("balls",),
    "knot": ("knot",),
    "anus": ("anus",),
    "pussy": ("vulva", "genital_slit", "cloaca"),
    "tail": ("tail",),
    "hand": ("fingers",),
    "head": ("snout", "open_mouth", "tongue", "teeth"),
    "breasts": ("breasts", "nipples"),
    "butt": ("butt", "wide_hips", "thick_thighs"),
    "feet": ("feet", "hindpaw", "pawpads", "toes"),
}
SMALL = {"penis", "balls", "knot", "anus", "pussy"}
K = 5             # frames per scene
CONF = 0.25       # describe confidence slider for "tag present in the frame" (0 = F4 speculative, 0.5 = F1)
BODY = 0.3        # a label needs this mean heat on the group (else "body")
MARGIN = 0.1      # ... and this much over the runner-up
SMALL_FRAC = 0.5  # spread ratio below which a SMALL label is plausible
MIN_PTS = 3
KEEP_W = 768      # tap: frames kept at this width (Hydra's input is ~672x384 at seqlen 1024)
HYDRA_GB = 1.8    # measured peak 1.76 GiB reserved; added to the process's VRAM cap when the tagger loads next to a tracker (no PAWSCRIPT_GPU_FRACTION)


class Tap:
    """Wraps a frame iterator of unknown length; keeps an evenly spaced subset (<= 2 x cap frames, KEEP_W wide)."""
    def __init__(self, cap=4 * K):
        self.cap, self.step, self.buf = cap, 1, []

    def __call__(self, frames):
        import cv2
        for i, (t, bgr) in enumerate(frames):
            if i % self.step == 0:
                h, w = bgr.shape[:2]
                self.buf.append((t, cv2.resize(bgr, (KEEP_W, round(h * KEEP_W / w)), interpolation=cv2.INTER_AREA)
                                 if w > KEEP_W else bgr.copy()))
                if len(self.buf) > 2 * self.cap:
                    self.buf, self.step = self.buf[::2], self.step * 2
            yield t, bgr

    def pick(self, k=K):
        """k kept frames nearest the centres of k equal slices of the kept range (no repeats)."""
        if not self.buf:
            return []
        t = np.array([f[0] for f in self.buf], float)
        want = t[0] + (np.arange(k) + 0.5) * (t[-1] - t[0]) / k
        return [self.buf[i] for i in sorted(set(np.abs(t[:, None] - want).argmin(0)))]


def masks(g):
    """group_tracks' dict -> {"g1": (T,N) bool, ..., "g1p1": ...}: bodies from labels, parts from `part` if present."""
    lab, part = g["labels"], g.get("part")
    out = {}
    for b in range(1, 5):
        m = lab == b
        if not m.any():
            continue
        out[f"g{b}"] = m
        if part is not None:
            for j in range(1, int(part.max()) + 1):
                if (m & (part == j)).any():
                    out[f"g{b}p{j}"] = m & (part == j)
    return out


def parent(name):
    return name.split("p")[0] if "p" in name else None


def spread(x):
    return float(np.sqrt(((x - x.mean(0)) ** 2).sum(1).mean())) if len(x) else 0.0


def frame_masses(heat, xy, members):
    """heat {label: (ph, pw) 0..1}, xy (N,2) normalized image coords, members (N,) bool -> {label: mean heat}."""
    from scipy.ndimage import map_coordinates
    p = xy[members]
    out = {}
    for lab, h in heat.items():
        ph, pw = h.shape
        out[lab] = float(map_coordinates(h, [p[:, 1] * ph - 0.5, p[:, 0] * pw - 0.5], order=1, mode="nearest").mean())
    return out


def decide(mass, ratio):
    """mass {label: mean heat}, ratio = group spread / parent spread -> (label, score, suspect tag or None)."""
    r = sorted(mass.items(), key=lambda a: -a[1]) + [("body", 0.0)] * 2
    (best, m1), (_, m2) = r[0], r[1]
    if m1 < BODY or m1 - m2 < MARGIN:
        return "body", 0.0, None
    if best in SMALL and ratio >= SMALL_FRAC:
        return "body", 0.0, best
    return best, round(m1 - max(m2, BODY), 3), None


def label(heats, xys, viss, sets, aspect=1.0):
    """heats: per sampled frame {label: (ph,pw)}; xys (K,N,2) / viss (K,N) the tracks at those frames; sets {name:
    (K,N) bool members}. -> {name: {"label", "score", "tags": {label: mass}, "frames": n, "stable": share of frames
    whose own decision equals the scene label, "suspect"?}}"""
    out = {}
    for name, S in sets.items():
        acc, per, ratios = {}, [], []
        for k, heat in enumerate(heats):
            m = S[k] & viss[k]
            if m.sum() < MIN_PTS:
                continue
            q = xys[k] * [aspect, 1.0]
            pm = (sets[parent(name)][k] if parent(name) else np.ones(len(m), bool)) & viss[k]
            ratio = spread(q[m]) / max(spread(q[pm]), 1e-9)
            fm = frame_masses(heat, xys[k], m)
            for lab, v in fm.items():
                acc[lab] = acc.get(lab, 0.0) + v
            per.append(decide(fm, ratio)[0])
            ratios.append(ratio)
        if not per:
            continue
        mean = {lab: v / len(per) for lab, v in acc.items()}
        lab, score, sus = decide(mean, float(np.mean(ratios)))
        out[name] = {"label": lab, "score": score, "tags": {k: round(v, 3) for k, v in sorted(mean.items(), key=lambda a: -a[1])},
                     "frames": len(per), "stable": round(per.count(lab) / len(per), 3), **({"suspect": sus} if sus else {})}
    return out


# ------------------------------------------------------------------ GPU side (Hydra)

_TAGGER = {}  # the tagger's own `hydra` package, swapped in only while it runs (sam2 needs hydra-core's `hydra`)


@contextmanager
def _tagger_modules():
    from pawtrack import describe as D
    mine = lambda: {k: sys.modules.pop(k) for k in list(sys.modules) if k == "hydra" or k.startswith("hydra.")}
    other = mine()
    sys.modules.update(_TAGGER)
    sys.path.insert(0, str(D.MODEL_DIR))
    try:
        yield D
    finally:
        sys.path.remove(str(D.MODEL_DIR))
        _TAGGER.update(mine())
        sys.modules.update(other)


def heat_maps(frames, seqlen=1024, probs=None, vocab=None, feats=None):
    """frames [(t, bgr)] -> [{label: (ph, pw) float32 0..1}] (labels whose tags pass at CONF in that frame).
    probs (dict, optional): filled with {tag: [per frame tagger probability]} for the vocabulary tags and any tag
    already a key in it (when the model has it). vocab: {label: tags} (default VOCAB; suggest uses SUGGEST_VOCAB).
    feats (list, optional, v4.18): gets (patch features (S, 1152) float16, (ph, pw)) per frame (the seeder's input)."""
    import cv2
    import torch
    with _tagger_modules() as D:
        m = D.load(gb=HYDRA_GB)  # the cap: whatever else is resident + this job's tracker (if any) + the tagger
        thr = D.thresholds(m, CONF)
        vocab = VOCAB if vocab is None else vocab
        tags = [t for ts in vocab.values() for t in ts]
        out = []
        for _, bgr in frames:
            fx, valid, grid = D._features(m, bgr, seqlen)
            with torch.no_grad():
                p = m.forward_head(fx, valid)[0].float().cpu().numpy()
            if feats is not None:
                feats.append((fx[0, :grid[0] * grid[1]].float().cpu().numpy().astype(np.float16), (int(grid[0]), int(grid[1]))))
            on = [t for t in tags if t in m.index and p[m.index[t]] >= thr[m.index[t]]]
            if probs is not None:
                for t in set(tags) | set(probs):
                    if t in m.index:
                        probs.setdefault(t, []).append(round(float(p[m.index[t]]), 3))
            cams = {t: cv2.blur(c, (3, 3)) for t, c in D._cams(m, fx, valid, grid, on).items()}
            heat = {}
            for lab, ts in vocab.items():
                hs = [c / c.max() for t, c in cams.items() if t in ts and c.max() > 0]
                if hs:
                    heat[lab] = np.max(hs, 0)
            out.append(heat)
    return out


# ------------------------------------------------------------------ pinned semantic groups (points.box_seeds)
SEM_LABEL = {"penis": "penis", "balls": "balls", "hips": "butt"}  # pinned group -> VOCAB label (butt = butt / wide_hips / thick_thighs)
SEM_REL = 0.5  # region = the CAM blob >= this x its peak that holds the peak (as describe.cam_box)


def hydra_ready():
    """The tagger can run here without a download: weights present and a CUDA device."""
    from pawtrack import describe as D
    if not (D.MODEL_DIR / D.WEIGHTS).exists():
        return False
    import torch
    return torch.cuda.is_available()


def sem_regions(bgr, box=(0.0, 0.0, 1.0, 1.0), probs=None, heat=None, labels=None, vocab=None, feats=None):
    """One tagger pass on the seed frame (BGR, true aspect) -> ({name: (ph, pw) bool mask over the frame}, {name:
    record}) for the SEM_LABEL groups whose tags pass at CONF and whose peak lies in box (x0, y0, x1, y1) normalized:
    the blob >= SEM_REL x the peak inside the box, 4-connected to it. record: label, source 'cam', score = the best
    tag probability, peak [x, y], cells = patches in the region. probs: as heat_maps. heat (dict, optional): filled
    with {name: (ph, pw) float32 CAM inside the box, 1 at the region's peak} (shape_regions' prompts).
    labels {name: VOCAB label} / vocab {label: tags}: default SEM_LABEL / VOCAB (suggest: SUGGEST / SUGGEST_VOCAB).
    feats (list, optional, v4.18): heat_maps' out-param."""
    from scipy.ndimage import label as blobs
    probs = {} if probs is None else probs
    labels, kw = labels or SEM_LABEL, ({} if vocab is None else {"vocab": vocab}) | ({} if feats is None else {"feats": feats})
    vocab = VOCAB if vocab is None else vocab
    hm = heat_maps([(0, bgr)], probs=probs, **kw)[0]
    heat = {} if heat is None else heat
    regions, rec = {}, {}
    for name, lab in labels.items():
        h = hm.get(lab)
        if h is None:
            continue
        ph, pw = h.shape
        cy, cx = ((np.arange(k) + 0.5) / k for k in (ph, pw))
        inb = ((cy >= box[1]) & (cy <= box[3]))[:, None] & ((cx >= box[0]) & (cx <= box[2]))[None]
        hb = np.where(inb, h, 0.0)
        if hb.max() <= 0:
            continue
        i, j = np.unravel_index(np.argmax(hb), hb.shape)
        lb, _ = blobs(hb >= SEM_REL * hb[i, j])
        regions[name] = lb == lb[i, j]
        heat[name] = (hb / hb[i, j]).astype(np.float32)
        rec[name] = {"label": name, "source": "cam", "score": max(probs[t][-1] for t in vocab[lab] if t in probs),
                     "peak": [round(float(cx[j]), 3), round(float(cy[i]), 3)], "cells": int(regions[name].sum())}
    return regions, rec


# ------------------------------------------------------------------ outline of a pinned region (points.wrap)
# The CAM blob is 16 px patches on a ~512 px input: coarse, and its edge cells hold background or the other body, whose
# points do not move with the part. The seed frame's own picture gives the outline: SAM 2 prompted from the CAM, else
# GrabCut inside the blob, else the blob itself. Masks come back on the seed grid (SEED_W wide, box_seeds' grid).
SHAPE = "grabcut"   # "grabcut" (then cam) | "sam" (opt-in, unmeasured on gold: then grabcut, then cam) | "cam" (the blob)
SAM_MODEL = "tiny"  # SAM 2.1 image predictor (sam2 extra, sam2_mask's checkpoint)
SAM_GB = 0.6        # added to the process's VRAM cap when SAM loads next to a tracker (no PAWSCRIPT_GPU_FRACTION)
SAM_BG = 2          # negatives at low-CAM cells (< 0.1 x peak, >= 2 cells off the blob) besides the other regions' peaks
SHAPE_MAX = 3.0     # a SAM mask > this x the blob's area swallowed the body: rejected (-> GrabCut)
SHAPE_MIN = 6       # a mask with fewer textured seed-grid pixels: rejected (-> the blob)
CORE_REL = 0.8      # CAM core (GrabCut sure foreground, SAM's extra positives): >= this x the peak
GC_W, GC_ITERS = 320, 5
SEED_W, TEX_MIN, TEX_K = 256, 6.0, 5  # seed grid width (= points.FLOW_W); textured = grey std >= TEX_MIN
                                      # (= RESEED_TEX) over TEX_K x TEX_K px
APPEAR, APPEAR_D = False, 2.0  # appearance gate: drop mask pixels > APPEAR_D (Mahalanobis) off the core's descriptor
_SAM = {}


def texture(grey, k=TEX_K):
    """Local grey std over k x k px (float32, same shape)."""
    import cv2
    g = grey.astype(np.float32)
    m = cv2.blur(g, (k, k))
    return np.sqrt(np.maximum(cv2.blur(g * g, (k, k)) - m * m, 0))


def fit_mask(m, w, h):
    """Bool mask -> (h, w): area vote >= 0.5 when shrinking, nearest when growing."""
    import cv2
    m = np.asarray(m, bool)
    if m.shape[1] >= w:
        return cv2.resize(m.astype(np.float32), (w, h), interpolation=cv2.INTER_AREA) >= 0.5
    return cv2.resize(m.astype(np.uint8), (w, h), interpolation=cv2.INTER_NEAREST) > 0


def sam_ready():
    """SAM 2 can run here without a download: the sam2 extra, the checkpoint and a CUDA device."""
    import importlib.util
    if importlib.util.find_spec("sam2") is None:
        return False
    from pawtrack.trackers.sam2_mask import CACHE, MODELS
    if not (CACHE / MODELS[SAM_MODEL][1]).exists():
        return False
    import torch
    return torch.cuda.is_available()


def _sam():
    from pawtrack import vram
    vram.cap("sam_image", SAM_GB)
    if "p" not in _SAM:
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor
        from pawtrack.trackers.sam2_mask import MODELS, _checkpoint
        with vram.loading("sam_image", _SAM.clear):
            _SAM["p"] = SAM2ImagePredictor(build_sam2(MODELS[SAM_MODEL][0], str(_checkpoint(SAM_MODEL)), device="cuda"))
    return _SAM["p"]


def sam_prompt(blob, h, raw, others):
    """CAM cells -> (points (k, 2) as (row, col) cells, labels 1 / 0). Positives: the peak of h (the CAM inside the blob,
    1 at the peak) and up to 2 more core cells (>= CORE_REL; a core under 3 cells: the 4 hottest blob cells), farthest-point
    picks. Negatives: the other regions'
    peaks outside the blob, and SAM_BG cells of raw (the label's CAM over the frame) < 0.1 that are >= 2 cells off the
    blob: the one nearest the blob, then the nearest on its other side."""
    from scipy.ndimage import distance_transform_cdt
    pos = [np.array(np.unravel_index(np.argmax(h), h.shape))]
    core = np.argwhere(blob & (h >= CORE_REL))
    if len(core) < 3:  # a one-cell core: the hottest blob cells instead
        b = np.argwhere(blob)
        core = b[np.argsort(-h[blob], kind="stable")[:4]]
    for _ in range(2):
        d = np.min([np.abs(core - p).max(1) for p in pos], 0)
        if not len(d) or d.max() < 1:
            break
        pos.append(core[np.argmax(d)])
    neg = [np.asarray(c) for c in others if not blob[tuple(c)]]
    low = np.argwhere((raw < 0.1) & (distance_transform_cdt(~blob, "chessboard") >= 2))
    if len(low) and SAM_BG:
        c = np.argwhere(blob).mean(0)
        o = low[np.argsort(np.hypot(*(low - c).T), kind="stable")]
        bg = [o[0]] + [q for q in o[1:] if np.dot(q - c, o[0] - c) <= 0][:1]
        neg += bg[:SAM_BG]
    return np.array(pos + neg, float), np.r_[np.ones(len(pos), int), np.zeros(len(neg), int)]


def grabcut(bgr, blob, core, other_cores=()):
    """GrabCut at GC_W px, GC_ITERS iterations: the blob probable foreground, its core sure foreground, a one-cell ring
    around it probable background, the rest (and the other regions' cores) sure background -> bool mask at GC_W (the
    components touching the core) or None."""
    import cv2
    from scipy.ndimage import label as blobs
    H, W = bgr.shape[:2]
    gw, gh = GC_W, max(8, round(GC_W * H / W))
    img = cv2.resize(bgr, (gw, gh), interpolation=cv2.INTER_AREA)
    b, c = fit_mask(blob, gw, gh), fit_mask(core, gw, gh)
    r = max(1, round(gw / blob.shape[1]))
    ring = (cv2.dilate(b.astype(np.uint8), np.ones((2 * r + 1, 2 * r + 1), np.uint8)) > 0) & ~b
    m = np.full((gh, gw), cv2.GC_BGD, np.uint8)
    m[ring], m[b], m[c] = cv2.GC_PR_BGD, cv2.GC_PR_FGD, cv2.GC_FGD
    for oc in other_cores:
        m[fit_mask(oc, gw, gh) & ~c] = cv2.GC_BGD
    if not (m == cv2.GC_BGD).any() or not c.any():
        return None
    cv2.grabCut(img, m, None, np.zeros((1, 65)), np.zeros((1, 65)), GC_ITERS, cv2.GC_INIT_WITH_MASK)
    fg = (m == cv2.GC_FGD) | (m == cv2.GC_PR_FGD)
    lb, _ = blobs(fg)
    return np.isin(lb, lb[c & fg]) & (lb > 0)


def appear(small, mask, core):
    """Appearance gate on the seed grid: per pixel (mean r / g chromaticity, grey std) over TEX_K px; mask pixels >
    APPEAR_D (Mahalanobis) from the core's median are dropped (core: mask & CAM core if >= 10 px, else the mask)."""
    import cv2
    f = small.astype(np.float32) + 1
    s = f.sum(2)
    k = (TEX_K, TEX_K)
    d = np.stack([cv2.blur(f[..., 2] / s, k), cv2.blur(f[..., 1] / s, k),
                  texture(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)) / 64], -1)
    x = d[mask & core if (mask & core).sum() >= 10 else mask]
    if len(x) < 4:
        return mask
    e = d[mask] - np.median(x, 0)
    keep = np.zeros_like(mask)
    keep[mask] = np.einsum("ij,jk,ik->i", e, np.linalg.inv(np.cov(x.T) + np.diag([1e-4, 1e-4, 1e-3])), e) <= APPEAR_D ** 2
    return keep


def shape_regions(bgr, regions, rec, heat=None, shape=None):
    """Seed-frame outlines of sem_regions' CAM blobs. bgr: the seed frame (true aspect); regions / rec: sem_regions';
    heat: its heat out-param (absent: the blob is its own core). -> {name: bool mask on the seed grid (SEED_W wide)}.
    Each record gains source 'sam' | 'grabcut' | 'cam', mask_px / blob_px (seed-grid pixels in the mask / the blob) and
    sam_reject 'big' | 'small' when SAM's mask was refused (big: > SHAPE_MAX x the blob -> GrabCut; small: fewer than
    SHAPE_MIN textured pixels -> the blob). shape (the tracker param sem_shape; default SHAPE) picks the first method tried."""
    import cv2
    if not regions:
        return {}
    H, W = bgr.shape[:2]
    gh = max(8, round(SEED_W * H / W))
    small = cv2.resize(bgr, (SEED_W, gh), interpolation=cv2.INTER_AREA)
    tex = texture(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)) >= TEX_MIN
    heat = heat or {}
    bl, raw, hs, cores = {}, {}, {}, {}
    for name, b in regions.items():
        b = np.asarray(b, bool)
        r = np.asarray(heat[name], np.float32) if name in heat and np.shape(heat[name]) == b.shape else b.astype(np.float32)
        h = np.where(b, r, 0)
        h = h / max(float(h.max()), 1e-9)
        bl[name], raw[name], hs[name], cores[name] = b, r, h, b & (h >= CORE_REL)
    shape = SHAPE if shape is None else shape
    sam = shape == "sam" and sam_ready()
    if sam:
        import torch
        pred = _sam()
        with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
            pred.set_image(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
    out = {}
    for name, b in bl.items():
        bg = fit_mask(b, SEED_W, gh)
        bpx = int(bg.sum())
        mask, src, why = None, "cam", None
        if sam:
            pts, lab = sam_prompt(b, hs[name], raw[name],
                                  [np.unravel_index(np.argmax(hs[o]), hs[o].shape) for o in bl if o != name])
            ph, pw = b.shape
            xy = np.c_[(pts[:, 1] + 0.5) / pw * W, (pts[:, 0] + 0.5) / ph * H]
            with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
                ms, _, _ = pred.predict(point_coords=xy, point_labels=lab, multimask_output=True)
            m = max((fit_mask(c > 0, SEED_W, gh) for c in ms), key=lambda c: (c & bg).sum() / max((c | bg).sum(), 1))
            if m.sum() > SHAPE_MAX * bpx:
                why = "big"
            elif (m & tex).sum() < SHAPE_MIN:
                why = "small"
            else:
                mask, src = m, "sam"
        if mask is None and shape in ("sam", "grabcut") and why != "small":
            m = grabcut(bgr, b, cores[name], [cores[o] for o in bl if o != name])
            if m is not None and (fit_mask(m, SEED_W, gh) & tex).sum() >= SHAPE_MIN:
                mask, src = fit_mask(m, SEED_W, gh), "grabcut"
        if mask is None:
            mask = bg
        if APPEAR:
            g = appear(small, mask, fit_mask(cores[name], SEED_W, gh))
            mask = g if (g & tex).sum() >= SHAPE_MIN else mask
        rec[name] = rec.get(name, {}) | {"source": src, "mask_px": int(mask.sum()), "blob_px": bpx} | (
            {"sam_reject": why} if why else {})
        out[name] = mask
    return out


# ------------------------------------------------------------------ outlines through the scene (points.wrap)
# The seed-frame outlines propagated by the SAM 2 video predictor (sam2_mask's model files): per frame a membership
# oracle for the pinned groups (a point counts only while inside its part's mask; one outside longer than retire_ms is
# re-seeded inside the current mask) and the sem_<name>_area channel.
SEM_TRACK = False              # opt-in, unmeasured on gold: propagate (needs sam_ready(); else the seed outline + pruning)
TRACK_PARTS = ("penis", "balls", "hips")  # parts propagated (the others keep the seed outline + motion pruning)
TRACK_SIZE = 512               # SAM's input side for propagation (the model's own is 1024)
TRACK_STEP = 2                 # every k-th frame is propagated, masks held in between
TRACK_CHUNK = 120              # propagated frames per inference state (memory bound; the seed frame anchors each)
_VID = {}


def _video():
    from pawtrack import vram
    vram.cap("sam_video", SAM_GB)
    if "p" not in _VID:
        from sam2.build_sam import build_sam2_video_predictor
        from pawtrack.trackers.sam2_mask import MODELS, _checkpoint
        with vram.loading("sam_video", _VID.clear):
            p = build_sam2_video_predictor(MODELS[SAM_MODEL][0], str(_checkpoint(SAM_MODEL)), device="cuda",
                                           hydra_overrides_extra=[f"++model.image_size={TRACK_SIZE}"])
            p.fill_hole_area = 0  # needs sam2's optional CUDA op (not built)
            _VID["p"] = p
    return _VID["p"]


def track_masks(frames, masks0, step=None):
    """frames: [BGR] from the seed frame on, one direction (reverse the list for the way back); masks0 {name: bool (h, w)}
    on frames[0] (shape_regions'). -> [{name: bool (h, w)} per frame] for the TRACK_PARTS names with a non-empty mask
    (every step-th frame propagated by the SAM 2 video predictor at TRACK_SIZE, chunks of TRACK_CHUNK anchored on the
    seed frame + the previous chunk's last masks; the frames between hold the last mask)."""
    import cv2
    import torch
    import sam2.sam2_video_predictor as svp
    step = step or TRACK_STEP
    names = [n for n, m in masks0.items() if n in TRACK_PARTS and np.any(m)]
    if not names or not frames:
        return [{} for _ in frames]
    pred = _video()
    S = pred.image_size
    h, w = np.shape(masks0[names[0]])
    svp.load_video_frames = lambda video_path, **kw: video_path  # in-memory frames (as sam2_mask)
    mean = torch.tensor([0.485, 0.456, 0.406], device="cuda")[:, None, None]
    std = torch.tensor([0.229, 0.224, 0.225], device="cuda")[:, None, None]

    class Frames(list):  # uint8 (3, S, S) on device; normalized on access
        def __getitem__(self, i):
            return (super().__getitem__(i).float() / 255 - mean) / std

    def prep(bgr):
        rgb = cv2.cvtColor(cv2.resize(bgr, (S, S), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)
        return torch.from_numpy(rgb).cuda().permute(2, 0, 1)

    keys = list(range(0, len(frames), step))
    got = {0: {n: np.asarray(masks0[n], bool) for n in names}}
    first, carry, todo = prep(frames[0]), None, keys[1:]
    with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
        while todo:
            chunk, todo = todo[:TRACK_CHUNK], todo[TRACK_CHUNK:]
            head = [first] + ([carry[0]] if carry else [])
            body = [prep(frames[i]) for i in chunk]
            state = pred.init_state((Frames(head + body), h, w))
            for j, n in enumerate(names):
                pred.add_new_mask(state, 0, j + 1, torch.from_numpy(got[0][n]))
                if carry and carry[1].get(n) is not None and carry[1][n].any():
                    pred.add_new_mask(state, 1, j + 1, torch.from_numpy(carry[1][n]))
            for idx, ids, logits in pred.propagate_in_video(state):
                if idx >= len(head):
                    ms = (logits[:, 0] > 0).cpu().numpy()
                    got[chunk[idx - len(head)]] = {names[o - 1]: ms[i] for i, o in enumerate(ids)}
            carry = (body[-1], got[chunk[-1]])
            del state, body
    return [got[i - i % step] for i in range(len(frames))]


def scene_labels(tap, ts, xy, vis, g, aspect, extra=None):
    """Wrap's hook: tap (Tap) or None (no motion-group names), ts (T,) row times, xy (T,N,2) / vis (T,N) rows, g
    group_tracks' dict, aspect = W / H, extra {key: record} added as is (the pinned groups' sem_<name> records).
    -> label()'s dict for the scene (also sent as note `group_labels`)."""
    import time
    from pawtrack.trackers import note
    t0 = time.perf_counter()
    fr = tap.pick() if tap is not None else []
    sets = masks(g) if tap is not None else {}
    res = {}
    if fr and sets:  # no moving group: no tagger pass, an empty note
        k = np.clip(np.searchsorted(ts, [f[0] for f in fr]), 0, len(ts) - 1)
        try:
            heats = heat_maps(fr)
        except Exception as e:  # optional: a tagger failure costs the names, never the track
            note("group_labels", f"group labels skipped: {type(e).__name__}: {e}", {"groups": dict(extra or {})} if extra else None)
            return dict(extra or {})
        res = label(heats, xy[k], vis[k], {n: s[k] for n, s in sets.items()}, aspect)
    res |= extra or {}
    dt = time.perf_counter() - t0
    msg = ", ".join(f"{n} = {r['label']}" + (f" ({r['suspect']}? too big)" if "suspect" in r else "")
                    + (f" (seeded, {r['source']})" if "source" in r else "") for n, r in res.items())
    note("group_labels", f"group labels ({len(fr)} frames, {dt:.1f} s): {msg or 'no groups'}", {"groups": res, "s": round(dt, 2)})
    return res


# ------------------------------------------------------------------ suggested groups (cli suggest_groups, PROTOCOL v4.11)
# What the tracker would pin on a frame, as polygons the owner refines before Track: the pinned three plus any other
# part the tagger has a CAM for (checked against Hydra 3.5's label list: no head / hand / torso tag, so head = mouth
# parts, hand = fingers, paws = feet / hindpaw / pawpads / toes, torso = abs / navel / pecs), outlined like the pinned
# groups (sem_shape); with SAM also the two largest bodies (SAM's widest mask at each part's peak), unpinned.
SUGGEST = {"penis": "penis", "balls": "balls", "sheath": "sheath", "slit": "slit", "anus": "anus", "hips": "butt",
           "tail": "tail", "head": "head", "hand": "hand", "paws": "feet", "torso": "torso",
           # v4.24: tagger tags exist for these (checked against the Hydra 3.5 tag list: knot, tongue / tongue_out, abdominal_bulge,
           # neck_bulge); thighs has none of its own (thick_thighs belongs to butt): seeder-only
           "knot": "knot", "tongue": "tongue", "stomachbulge": "stomachbulge", "neckbulge": "neckbulge"}
# v4.12: sheath and slit get their own CAMs (slit = genital_slit / cloaca; VOCAB keeps them under pussy for the labels)
# v4.16: anus (the spurt pulse part, pawtrack/pulse.py): Hydra 3.5's anus tags that name the visible opening
SUGGEST_VOCAB = {**VOCAB, "torso": ("abs", "navel", "pecs"), "sheath": ("sheath",), "slit": ("genital_slit", "cloaca"),
                 "anus": ("anus", "presenting_anus", "puffy_anus", "spread_anus", "gaping_anus"),
                 "tongue": ("tongue", "tongue_out"), "stomachbulge": ("abdominal_bulge",), "neckbulge": ("neck_bulge",)}
WHOS = ("c1", "c2", "x")  # the characters' ids (paw-uzzr): Bottom, Top, Extra (groups.js WHOS; test/groups-vocab.test.mjs keeps them equal)
# parts that get a side: l / r = the CHARACTER's own left / right (paw-5r1: body side, not the picture's half; the owner's word). A suggestion
# only proposes one (pair_sides: a character's first of a part l, its second r; the app shows it, F flips it before Enter); the old rule (the
# image side of the character's centre) was measured at chance for body side (paw-38ht) and is gone.
PAIRED = ("shoulder", "forearm", "hand", "thighs", "shin", "paws")
# Parts that LIVE ON another part (paw-noy2: a knot is seeded on top of the penis): child -> the parts it may overlap. The app's
# groups.js ON_PART says the same (test/groups-vocab.test.mjs). In an overlap the seed points belong to the child only.
ON_PART = {
    "knot": ("penis",),
    "sheath": ("penis", "hips"),
    "tongue": ("head",),
    "stomachbulge": ("torso", "hips"),
    "neckbulge": ("head", "torso"),
    "balls": ("hips",),
    "thighs": ("hips",),
    "paws": ("thighs", "shin", "hips"),
    "shoulder": ("torso",),
    "forearm": ("shoulder",),
    "hand": ("forearm",),
    "shin": ("thighs",),
}


def _who_part(name):
    import re
    t = str(name or "").split("_")
    who = t[0] if t[0] in WHOS else None
    return who, re.sub(r"\d+$", "", (t[1] if who and len(t) > 1 else t[0] if not who else ""))


def sits_on(child, parent):
    """Does group name `child` live on group name `parent` (the same character, or none named, and a part of ON_PART)?"""
    (cw, cp), (pw, pp) = _who_part(child), _who_part(parent)
    return bool(cp and pp and (not cw or not pw or cw == pw) and pp in ON_PART.get(cp, ()))
SPLIT_MIN = 0.2                 # proximity split: two clusters closer than this (frame heights) are one character


def pair_sides(rows):
    """paw-5r1: [(who, part)] in the suggestion's order -> the side each is proposed with: a character's first of a paired part l (the owner
    paints the character's left first), its second r, any further none; unpaired parts none. Never from where the part sits in the picture."""
    seen, out = {}, []
    for who, part in rows:
        if part not in PAIRED:
            out.append(None)
            continue
        k = seen[(who, part)] = seen.get((who, part), 0) + 1
        out.append({1: "l", 2: "r"}.get(k))
    return out
POLY_EPS_REL = 0.02  # v4.33: ... and at most this x the part's equivalent radius (px)
POLY_MAX, POLY_EPS = 64, 0.004  # vertices; RDP tolerance in frame heights (grown x1.5 until <= POLY_MAX)
BODY_MAX = 0.9                  # a SAM body mask over this share of the frame is the background: dropped


def mask_poly(m):
    """bool mask (h, w) -> [[x, y], ...] normalized (0..1, pixel centres): its largest outer contour, RDP-simplified
    (POLY_EPS frame heights, grown until <= POLY_MAX vertices); None for an empty mask or < 3 vertices."""
    import cv2
    m = np.asarray(m, np.uint8)
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not cs:
        return None
    c, (h, w) = max(cs, key=cv2.contourArea), m.shape
    eps = min(POLY_EPS * h, POLY_EPS_REL * float(np.sqrt(m.sum() / np.pi)))   # v4.33: a small part's tolerance is relative to it (groups.js POLY_EPS_REL)
    a = cv2.approxPolyDP(c, eps, True)[:, 0]
    while len(a) > POLY_MAX:
        eps *= 1.5
        a = cv2.approxPolyDP(c, eps, True)[:, 0]
    return [[round((x + 0.5) / w, 4), round((y + 0.5) / h, 4)] for x, y in a] if len(a) >= 3 else None


def poly_mask(poly, w, h):
    """[[x, y], ...] normalized -> bool (h, w), filled (the inverse of mask_poly)."""
    import cv2
    m = np.zeros((h, w), np.uint8)
    cv2.fillPoly(m, [np.round(np.asarray(poly, float) * [w, h] - 0.5).astype(np.int32)], 1)
    return m > 0


def erased_mask(g, w, h):
    """v4.53 (paw-yx6q): a track group's `erased` outlines (what the owner erased from it on its frame) at w x h ->
    bool (h, w) | None (nothing erased)."""
    m = np.zeros((h, w), bool)
    for q in (g or {}).get("erased") or ():
        m |= poly_mask(q, w, h)
    return m if m.any() else None


def sam_bodies(bgr, rec, k=2):
    """SAM 2 at each region's peak (one positive click, widest of its 3 masks) -> up to k bodies [(mask on the seed grid,
    SAM score)], largest first, near-duplicates (IoU > 0.5) merged, background-sized masks (> BODY_MAX) dropped."""
    import cv2
    import torch
    H, W = bgr.shape[:2]
    gh = max(8, round(SEED_W * H / W))
    pred, out = _sam(), []
    with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
        pred.set_image(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
        for r in rec.values():
            ms, sc, _ = pred.predict(point_coords=np.array([[r["peak"][0] * W, r["peak"][1] * H]]),
                                     point_labels=np.array([1]), multimask_output=True)
            j = int(np.argmax([c.sum() for c in ms]))
            m = fit_mask(ms[j] > 0, SEED_W, gh)
            if not m.any() or m.mean() > BODY_MAX:
                continue
            dup = next((i for i, (o, _) in enumerate(out) if (m & o).sum() > 0.5 * (m | o).sum()), None)
            if dup is None:
                out.append((m, float(sc[j])))
            elif m.sum() > out[dup][0].sum():
                out[dup] = (m, float(sc[j]))
    return sorted(out, key=lambda b: -b[0].sum())[:k]


HEAD_SHAPE = "sam"   # v4.34 default sam (the owner: the head says where and how big, SAM draws; never drops a part). v4.29: who DRAWS the parts the head / the CAM found: "head" (the blob) | "sam" (the head locates, SAM draws: seedsam.py). Default head: on the owner's labels SAM
                     # lowered found (0.595 -> 0.530) without raising IoU (0.336 -> 0.340, noise) - experiments/seeder-probe/RESULTS.md; opt in with tracking.seeder.sam
LAST = {}            # the last suggest()'s SAM step record (seedsam.refine's: sam / head / dropped counts, why, ms), for the answer's `sam`


def suggest(bgr, box=(0.0, 0.0, 1.0, 1.0), shape=None, head=None, who_split="bodies", who_ref=None, who_left="head", head_shape=None, key=None, margin=None):
    """One tagger pass on bgr (true aspect) -> [{name, poly, score, source 'tagger' | 'seeder' | 'sam', outline, mask_from,
    pinned}]: the SUGGEST parts found (score = the best tag probability; outline = shape_regions' source), then with
    shape 'sam' (and SAM installed) up to two `body` groups (score = SAM's own mask score; pinned false).
    v4.18: head (seeder.Head, optional): the parts it answers for (head.use) come from its heat on the same pass's patch
    features instead of the tag CAM: source 'seeder', outline 'head' (the blob), score = the blob's peak heat,
    `tentative` when below seeder.CONFIDENT. who_split 'bodies' (default, paw-svnz) | 'appearance' (v4.18) | 'position' (v4.17) and who_ref
    ({c1, c2} mean features of the video's painted characters), who_left 'head' (default) | 'parts' (v4.18): see
    assign_who.
    v4.29: head_shape 'sam' (v4.34: the default, HEAD_SHAPE; needs SAM, else the cleaned blobs with a note in LAST['sam']): the head LOCATES, SAM DRAWS (seedsam.refine, one image
    embedding for every part; `key` = the frame's (source, t_ms) shares it with `segment`'s cache): each learned part's and each
    CAM part's outline is SAM's mask from the head's peak (outline / `mask_from` 'sam'), the head's blob where SAM gave nothing
    acceptable (a confident one; `mask_from` 'head' | 'cam' for the CAM part's own outline), tentative blobs SAM cannot confirm
    and near-duplicates of unrelated parts are dropped. v4.33 margin (the app's paint margin, %, default seedsam.MARGIN_DEFAULT): SAM's drawn masks are pulled that far inside by clean_mask, as every aid of the app does. head_shape 'head': the blobs, as v4.28 (`mask_from` 'head' | 'cam')."""
    import cv2
    from pawtrack import seeder, seedsam, tidy
    probs, heat, fx = {}, {}, []
    regions, rec = sem_regions(bgr, box, probs, heat, SUGGEST, SUGGEST_VOCAB, feats=fx)
    if head is not None and head.features["source"] != "hydra":   # v4.28: the head's own feature source (never Hydra's features into it)
        fx = [seeder.head_features(head, bgr)]
    learned = {p for i, p in enumerate(seeder.PARTS) if head is not None and head.use[i]}
    for n in [n for n in regions if n in learned]:  # the head answers for these parts: no CAM blob for them
        regions.pop(n)
        rec.pop(n, None)
    masks = shape_regions(bgr, regions, rec, heat, shape) if regions else {}
    H, W = bgr.shape[:2]
    size = (seeder.MASK_W, max(8, round(seeder.MASK_W * H / W)))
    mg = seedsam.MARGIN_DEFAULT if margin is None else margin
    hregs = seeder.proposals(head.heat(*fx[0]), size, head.use, box=box, thr=getattr(head, "thr", seeder.THR), margin=mg) if learned and fx else []   # v4.34: smooth, merged, cleaned
    LAST.clear()
    cams = {n: tidy.clean_blob(cv2.resize(np.asarray(m, np.float32), size, interpolation=cv2.INTER_LINEAR) >= 0.5, mg) for n, m in masks.items()}   # CAM parts: the same cleaning
    drawn, states = {}, {}   # CAM part name -> 'sam' when SAM drew it; -> its SAM state (seedsam.refine's `sam`)
    if (HEAD_SHAPE if head_shape is None else head_shape) == "sam" and (hregs or cams):
        try:
            if not sam_ready():
                raise RuntimeError("SAM 2 is not installed")
            from pawtrack import segment, vram
            vram.cap("sam_image", segment.SEG_GB)
            regs = [{**r, "src": "seeder"} for r in hregs]
            for n, cm in cams.items():   # the tagger's own parts go through the same step from their CAM peak
                sc = float(rec[n]["score"])
                regs.append({"part": n, "mask": cm, "score": sc, "peak": tuple(rec[n]["peak"]), "heat": cv2.resize(np.asarray(heat[n], np.float32), size, interpolation=cv2.INTER_LINEAR) * sc,
                             "src": "tagger", "keep": True, "name": n})
            res, LAST["sam"] = seedsam.refine(regs, size, seedsam.sam_predict(_sam(), segment._fit(bgr), size, key), margin=mg,
                                              area=(getattr(head, "info", None) or {}).get("area"))   # paw-4fne: the labels' sizes
            hregs, kept = [], {}
            for r in res:
                (hregs.append(r) if r["src"] == "seeder" else kept.__setitem__(r["name"], r))
            cams = {n: kept[n]["mask"] for n in cams if n in kept}
            drawn = {n: kept[n]["mask_from"] for n in cams}
            states = {n: kept[n]["sam"] for n in cams if "sam" in kept[n]}
        except Exception as e:   # SAM cannot run (no VRAM, not installed): the cleaned head blobs, with a quiet note
            LAST["sam"] = {"fallback": f"{type(e).__name__}: {str(e)[:120]}"}
    out = []
    for n, m in cams.items():
        out.append({"name": n, "score": round(float(rec[n]["score"]), 3), "source": "tagger", "_mask": m,
                    "outline": "sam" if drawn.get(n) == "sam" else rec[n]["source"], "mask_from": "sam" if drawn.get(n) == "sam" else "cam", "pinned": True, **({"sam": states[n]} if n in states else {})})
    for r in hregs:
        mf = r.get("mask_from", "head")
        out.append({"name": r["part"], "score": round(r["score"], 3), "source": "seeder", "outline": mf, "mask_from": mf, "_mask": r["mask"],
                    "pinned": True, **({"tentative": True} if r["score"] < seeder.CONFIDENT else {}), **({"sam": r["sam"]} if "sam" in r else {})})
    for g in out:
        g["poly"] = mask_poly(g["_mask"])
    out = [g for g in out if g["poly"]]
    bodies = []
    if (SHAPE if shape is None else shape) == "sam" and rec and sam_ready():
        for m, sc in sam_bodies(bgr, rec):
            poly = mask_poly(m)
            if poly:
                bodies.append(m)
                out.append({"name": "body", "poly": poly, "score": round(sc, 3), "source": "sam", "outline": "sam", "pinned": False})
    asp = bgr.shape[1] / bgr.shape[0]
    gs = None
    if who_split == "bodies" and out and not bodies:   # paw-svnz: bodies first (a second head founds the other character), the one-per-part rule per body
        gs, LAST["who"] = assign_bodies(out, asp, bgr, fx[0] if fx else None, key, ref=who_ref)
    if gs is None:   # no body split here (more than two heads ...): the old split
        gs = assign_who(out, bodies, asp, feats=fx[0] if fx and who_split in ("appearance", "bodies") else None, ref=who_ref, left_by=who_left)
    res = tidy.finish(gs, asp, mg, mask_poly)   # v4.34: one per thing, isolation, overlap, slivers, cap
    for g in res:   # v4.37 (paw-om3e): the SAM state of a SAM-drawn proposal in the wire's encoding (prompts 0..1, SAM's chosen mask run-length coded)
        if "sam" in g:
            from pawtrack import segment
            st = g["sam"]
            g["sam"] = {"pos": [[round(float(x), 5), round(float(y), 5)] for x, y in st["pos"]], "neg": [[round(float(x), 5), round(float(y), 5)] for x, y in st["neg"]], "mask": segment.encode_mask(st["raw"])}
    return res


def frame_parts(frames, head=None):
    """v4.18 seed frame: [(t, bgr)] -> [n] how many parts each frame shows confidently: the head's parts with peak heat
    >= seeder.CONFIDENT plus the CAM parts (all of SUGGEST without a head) whose tags pass at CONF. One tagger pass a
    frame, no CAMs."""
    from pawtrack import seeder
    learned = {p for i, p in enumerate(seeder.PARTS) if head is not None and head.use[i]}
    out = []
    with _tagger_modules() as D:
        m = D.load()
        thr = D.thresholds(m, CONF)
        for _, bgr in frames:
            f, grid, p, _ = seeder.frame_features(D, m, bgr)
            if learned and head.features["source"] != "hydra":   # v4.28: the tag logits stay Hydra's, the head's features are its own
                f, grid = seeder.head_features(head, bgr)
            n = seeder.confident_parts(head.heat(f, grid), head.use) if learned else 0
            for name, lab in SUGGEST.items():
                if name not in learned and any(t in m.index and p[m.index[t]] >= thr[m.index[t]] for t in SUGGEST_VOCAB[lab]):
                    n += 1
            out.append(n)
    return out


def assign_who(groups, bodies=(), aspect=16 / 9, feats=None, ref=None, left_by="head"):
    """v4.12: a character (who c1 | c2), part and side for each suggested group; name = who_part_side (cli.parse_groups'
    rule). A starting point the owner corrects with the brush, not a detector:
      bodies (SAM masks on the seed grid, suggest's `body` groups in order): a part goes to the body whose mask holds
        its centre (else the body with the nearest mask centroid); each body is its own character;
      no bodies: the parts' centres split in two by 2-means (seeded on the farthest pair, true aspect); clusters closer
        than SPLIT_MIN frame heights, or < 2 parts: one character. Parts touching across the two bodies (a penis inside
        the other's hips) can land on the wrong side: the owner swaps or repaints.
      v4.18 feats ((S, 1152) patch features, (ph, pw)) given and no bodies: two characters (2-means says so, or a
        non-paired part appears twice) are split by appearance + position with every non-paired part at most once per
        character (seeder.split_who; the probe's 0.84 vs 0.68 on painted parts); one character stays one.
    Bottom = the character further left in the picture: v4.19 left_by 'head' (default) by its head when it has one, else
    the mean of its parts' centres (paw-cq4); 'parts' = the mean of its parts' centres (v4.18); v4.18 with ref ({c1, c2}: the video's painted
    characters' mean features) the group nearer the painted Bottom in appearance (with feats, each group of a two-character
    split gets `named` "painted" | "left"). Paired parts get a proposed side (pair_sides: the character's first l, second r; paw-5r1)."""
    if not groups:
        return groups
    cen = np.array([np.mean(np.asarray(g["poly"], float), 0) for g in groups]) * [aspect, 1.0]
    lab = np.zeros(len(groups), int)
    first = None
    if len(bodies):
        bc = []
        for m in bodies:
            ys, xs = np.nonzero(m)
            bc.append([(xs.mean() + 0.5) / m.shape[1] * aspect, (ys.mean() + 0.5) / m.shape[0]])
        bodies_k = [g for g in range(len(groups)) if groups[g]["name"] == "body"]
        for g, c in enumerate(cen):
            if g in bodies_k:
                lab[g] = bodies_k.index(g)
                continue
            hit = [k for k, m in enumerate(bodies) if m[min(m.shape[0] - 1, int(c[1] * m.shape[0])), min(m.shape[1] - 1, int(c[0] / aspect * m.shape[1]))]]
            lab[g] = hit[0] if hit else int(np.argmin(np.hypot(*(np.array(bc) - c).T)))
    elif len(cen) >= 2:
        d = np.hypot(*(cen[:, None] - cen[None]).transpose(2, 0, 1))
        a, b = np.unravel_index(np.argmax(d), d.shape)
        mu = cen[[a, b]].copy()
        for _ in range(10):
            lab = np.argmin(np.hypot(*(cen[:, None] - mu[None]).transpose(2, 0, 1)), 1)
            mu = np.array([cen[lab == k].mean(0) if (lab == k).any() else mu[k] for k in (0, 1)])
        if np.hypot(*(mu[0] - mu[1])) < SPLIT_MIN:
            lab[:] = 0
        parts = [g["name"] for g in groups]
        twice = any(parts.count(p) > 1 for p in set(parts) if p not in PAIRED)
        if feats is not None and (lab.any() or twice):
            from pawtrack import seeder
            f, grid = feats
            masks = [poly_mask(g["poly"], grid[1] * 4, grid[0] * 4) for g in groups]
            sp = seeder.split_who(masks, parts, cen, f, grid, PAIRED)
            if sp is not None:
                lab = np.asarray(sp)
                first = seeder.name_by_refs(masks, lab, f, grid, ref)
    def left_x(k):  # where character k is: its head, else its parts' mean (paw-cq4: in contact the hips / penis of both
        ix = lab == k  # sit at one x and stray parts pull the mean; the heads stay apart)
        hd = ix & np.array([g["name"] == "head" and left_by == "head" for g in groups])
        return float(cen[hd if hd.any() else ix, 0].mean())
    ks = sorted(set(lab), key=left_x)  # Bottom = the left one
    if first is not None and len(ks) == 2:
        ks = [first, 1 - first]  # Bottom = the group nearer the video's painted Bottom
    out = []
    sides = pair_sides([(f"c{ks.index(k) + 1}", g["name"]) for g, k in zip(groups, lab)])
    for g, k, side in zip(groups, lab, sides):
        who, part = f"c{ks.index(k) + 1}", g["name"]
        named = {"named": "painted" if first is not None else "left"} if feats is not None and len(ks) == 2 else {}
        out.append({**g, "name": "_".join(x for x in (who, part, side) if x), "who": who, "part": part, "side": side, **named})
    return out


def assign_bodies(groups, aspect, bgr, fx, key, whos=None, sam=True, hists=None, ref=None):
    """paw-svnz: who for suggest()'s groups by BODIES first, then ROLES (pawtrack/bodies.py): the distinct heads (else torsos / hips ...) are
    the characters, SAM's whole-object mask from each anchor is its body, every part goes to a body under the capacities (one of each
    unpaired part, two of a paired one; halves count once), then the bodies are named: one body = Bottom, two = the left-head rule (who_conf says how little that is worth). `groups` carry `_mask` on the seed grid; fx = (patch features, grid) of the picture; `whos` {group index:
    'c1' | 'c2'} the owner's own choice for some (names the bodies by vote). -> (groups with who / part / side / name / who_by / who_conf,
    record {by, bodies, conf, sam, ms}) or (None, record with `fallback`) when it is no one- or two-character picture here."""
    import time
    from pawtrack import autoname, bodies
    t0 = time.perf_counter()
    idx = [i for i, g in enumerate(groups) if "_mask" in g and g.get("name") != "body"]
    rec = {"bodies": 0}
    if not idx:
        return None, {**rec, "fallback": "nothing to place"}
    parts = []
    for i in idx:
        m = np.asarray(groups[i]["_mask"], bool)
        parts.append({"part": groups[i]["name"], "mask": m, "score": float(groups[i].get("score", 1.0)),
                      "feat": autoname._unit(autoname._pool(fx[0], fx[1], m)) if fx is not None else None,
                      "hist": hists[i] if hists is not None else autoname.colour_hist(bgr, m) if bgr is not None else None})
    us = bodies.units(parts)
    sets = bodies.anchors(us, aspect)
    if sets is None:
        return None, {**rec, "fallback": "more than two heads / torsos: not split"}
    bods, used = [None] * len(sets), False
    if len(sets) == 2 and sam:
        try:
            from pawtrack import seedsam, segment, vram
            if not sam_ready():
                raise RuntimeError("SAM 2 is not installed")
            vram.cap("sam_image", segment.SEG_GB)
            m0 = parts[0]["mask"]
            predict = seedsam.sam_predict(_sam(), segment._fit(bgr), (m0.shape[1], m0.shape[0]), key)
            bods = bodies.bodies(us, sets, lambda pts, lab: predict(pts, lab, None))
            used = any(b is not None for b in bods)
        except Exception as e:   # no VRAM / a Track running / not installed: the joint assignment still runs on distance + appearance
            rec["sam"] = f"{type(e).__name__}: {str(e)[:100]}"
    if len(sets) == 1:
        lab = np.zeros(len(us), int)
    else:
        lab, _ = bodies.refine(us, sets, bods, None, aspect)
    blob = np.zeros(len(parts), int)
    for u, l in zip(us, lab):
        for j in u["ids"]:
            blob[j] = l
    who, by, conf = bodies.name(us, lab, None, aspect)   # ponytail: the learned Role did not beat the left-head rule held out (RESULTS.md), so it is not wired in
    if len(set(lab)) == 2 and ref and fx is not None:   # the video's painted Bottom / Top (v4.18 refs) name the bodies by appearance
        from pawtrack import seeder
        k = seeder.name_by_refs([p["mask"] for p in parts], blob, fx[0], fx[1], ref)
        if k is not None:
            who, by, conf = [("c1" if l == k else "c2") for l in lab], "painted", 0.7
    given = {}
    for gi, w in (whos or {}).items():
        if gi in idx:
            given.setdefault(int(blob[idx.index(gi)]), []).append(w)
    if len(set(lab)) == 2 and given:   # the owner named some blobs: they name the bodies (a vote), nothing guessed
        vote = {k: max(set(v), key=v.count) for k, v in given.items()}
        if len(vote) == 2 and vote[0] != vote[1] or len(vote) == 1:
            k0, w0 = next(iter(vote.items()))
            first = (k0 == 0) == (w0 == "c1")
            who = [("c1" if (l == 0) == first else "c2") for l in lab]
            by, conf = "given", 0.8   # the grouping alone is right for ~0.77-0.81 of the blobs held out
    if len(set(lab)) == 1 and given:   # one body and the owner already named a blob of it: that character, not the solo = Bottom default
        w0 = max((w for v in given.values() for w in v), key=lambda w: sum(w in v for v in given.values()))
        who, by, conf = [w0] * len(us), "given", 0.8
    wb = {j: who[int(np.flatnonzero([j in u["ids"] for u in us])[0])] for j in range(len(parts))}
    out = [dict(g) for g in groups]
    sides = pair_sides([(wb[j], groups[i]["name"]) for j, i in enumerate(idx)])
    for j, i in enumerate(idx):
        g, part, w, side = out[i], groups[i]["name"], wb[j], sides[j]
        g.update({"name": "_".join(x for x in (w, part, side) if x), "who": w, "part": part, "side": side, "who_by": by, "who_conf": round(float(conf), 3)})
    rec.update({"bodies": len(sets), "by": by, "conf": round(float(conf), 3), "sam": rec.get("sam", "used" if used else "none"), "ms": int(round(1000 * (time.perf_counter() - t0)))})
    return out, rec


def match_prior(groups, prior, aspect=16 / 9):
    """v4.13: the previous shot's groups as a clue (a hard cut inside one scene: the seeds are not where they were).
    groups = suggest()'s (who / part / side set), prior = [{name, who?, part?, side?, poly?}] (the identities to find
    again). -> (groups, missing): a suggestion that matches a prior identity takes that identity (its name, who, part,
    side) and gets "prior" = the prior name and "unconfirmed" = True (the owner accepts or repaints); prior identities
    with no suggestion of their part are returned in `missing` (names). Unmatched suggestions are returned unchanged.
    Matching: the characters may swap sides at a cut, so first Bottom / Top of the suggestions are swapped when that makes
    more parts agree with the prior's who; then per part (and side for hand / paws, when both have one) the pairs are
    taken nearest first (the prior polygon's centre, true aspect; without a polygon: any order), same who preferred.
    ponytail: greedy nearest pairs, no appearance model; a part the tagger misses at the new framing is just missing."""
    if not prior:
        return groups, []
    import re
    def split_name(n):  # 'c1_hand_l' -> (c1, hand, l); a plain name -> (None, name without digits, None) (groups.js splitName)
        m = re.match(r"^(c[12]|x)_([a-z0-9]+?)(?:_([lr]))?\d*$", n or "")
        return (m.group(1), m.group(2), m.group(3)) if m else (None, re.sub(r"\d+$", "", n or ""), None)
    pri = []
    for q in prior:
        w, pt, sd = q.get("who"), q.get("part"), q.get("side")
        if not pt:
            w2, pt, sd2 = split_name(q.get("name", ""))
            w, sd = w or w2, sd or sd2
        poly = q.get("poly")
        c = np.mean(np.asarray(poly, float), 0) * [aspect, 1.0] if poly and len(poly) >= 3 else None
        pri.append({"name": q.get("name") or "_".join(x for x in (w, pt, sd) if x), "who": w, "part": pt, "side": sd, "c": c})
    cen = [np.mean(np.asarray(g["poly"], float), 0) * [aspect, 1.0] for g in groups]
    swap = lambda w: {"c1": "c2", "c2": "c1"}.get(w, w)
    agree = lambda f: sum(1 for p in pri for g in groups if g.get("part") == p["part"] and p["who"] and f(g.get("who")) == p["who"])
    flip = agree(swap) > agree(lambda w: w)
    out = [dict(g) for g in groups]
    if flip:
        for g in out:
            if g.get("who"):
                g["who"] = swap(g["who"])
                g["name"] = "_".join(x for x in (g["who"], g.get("part"), g.get("side")) if x)
    pairs = []
    for i, p in enumerate(pri):
        for j, g in enumerate(out):
            if g.get("part") != p["part"] or (p["side"] and g.get("side") and p["side"] != g.get("side")):
                continue
            d = float(np.hypot(*(cen[j] - p["c"]))) if p["c"] is not None else 0.0
            pairs.append((g.get("who") != p["who"], d, i, j))
    used_p, used_g = set(), set()
    for _, _, i, j in sorted(pairs):
        if i in used_p or j in used_g:
            continue
        used_p.add(i)
        used_g.add(j)
        p = pri[i]
        out[j].update({"name": p["name"], "who": p["who"] or out[j].get("who"), "part": p["part"], "side": p["side"] or out[j].get("side"),
                       "prior": p["name"], "unconfirmed": True})
    return out, [pri[i]["name"] for i in range(len(pri)) if i not in used_p]
