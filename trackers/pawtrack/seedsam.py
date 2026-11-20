"""The head LOCATES, SAM DRAWS (PROTOCOL v4.29, paw-26iv): a part the seeder found no longer returns the head's coarse
16 px blob as its mask. The head's heat gives SAM its prompts, SAM's mask is cleaned to one smooth piece, and the blob stays
only as the fallback (`mask_from` "head" vs "sam" says which is which).

Per part found (a blob of seeder.regions or a tagger CAM region):
  prompts   positive: the blob's heat peak, and for an elongated blob up to two more well-separated high points along its axis;
            negative: the peaks of the OTHER confident blobs that are not in a parent / child relation with this part
            (partlabel.ON_PART: a knot's peak is no negative for the penis and the penis' none for the knot); optionally the
            blob's loose box (BOX_PAD, None = no box)
  choose    paw-om3e: the owner's dab's rule (grow.js pickMask, one policy: walk_up): of SAM's masks (multimask, smallest first) those holding
            the most positives, minus the ones the sanity guards refuse (over BLOB_MAX x the blob, over ABSURD_IMAGE of the picture, holding
            another unrelated part's peak), walk UP from the smallest while the next is <= LEVEL_MAX x larger and scored >= SCORE_FLOOR. The
            head's blob is a guard at the extremes only, never the size to match (it is coarse, usually smaller than the part: matching
            its area picked SAM's sub-part). Cleaned (clean_mask: the app's grow.js cleanMask)
  fallback  none acceptable: the head's own blob, cleaned and smoothed (`mask_from` "head"): a part the head found is never lost to SAM
  resolve   a mask that is almost the same as an already accepted one (IoU > DUP_IOU) of an unrelated part loses (lower score
            goes); unrelated parts do not overlap (the lower score gives up the shared pixels); parent / child may overlap.
One image embedding per frame is shared by every part (segment.py's embedding cache when the frame has a key), then ~8 ms a part.
Painted regions are for TRACKING and are never touched: these masks are only suggestions.
"""
import numpy as np

# ------------------------------------------------------------------ constants (named; measured in experiments/seeder-probe/RESULTS.md)
INNER_REL = 0.5        # extra positives lie in the blob's interior: edge distance >= this x its maximum
SEP_INT = 0.5          # ... and at least this x sqrt(blob area) from the points already taken
LEVEL_MAX = 10         # grow.js LEVEL_MAX: walk up to the next candidate while it is at most this x the current one (the same number, tested against the JS)
SCORE_FLOOR = 0.05     # grow.js SCORE_FLOOR: ... and SAM's own score of it is at least this (its score favours the small sub-parts: no ranking)
ABSURD_IMAGE = 0.5     # grow.js ABSURD_IMAGE: a candidate over this share of the picture swallowed the scene
BLOB_MAX = 8.0         # Suggest only: a candidate over this x the head's blob is refused (the blob is coarse and small, so a generous multiple)
MAX_POS = 3
NEG_CONF = 0.7         # another blob's peak is a negative when its heat is at least this (seeder.CONFIDENT)
NEG_MIN = 0.05         # ... and lies this far (fraction of the mask diagonal) from every positive
SINGLE = False         # SAM's multimask on (the spec: walk up its levels); True = one best mask from the spread points (SAM's own advice for several points; measured in experiments/seeder-probe/suggest_sam_ratio.py)
# paw-0u0d, Suggest only (the dab keeps walk_up for every part): part -> which SAM level to take. "part" = walk_up (the default for a part not listed),
# "sub" = the smallest candidate holding the points, "single" = one best mask (multimask off), "head" = keep the head's cleaned blob (SAM not asked).
# Chosen per part from the held-out image labels (experiments/seeder-probe/RESULTS.md, v2 first). Parts with too few samples to measure (sheath, tongue,
# bulges: small parts that sit ON a larger one) take "sub" by the same reasoning; knot and balls stay on "part" (no level beat it).
POLICY = {"penis": "sub", "hips": "head", "head": "single", "hand": "sub", "paws": "sub", "tail": "single", "torso": "sub", "thighs": "sub",
          "sheath": "sub", "tongue": "sub", "stomachbulge": "sub", "neckbulge": "sub", "shoulder": "sub", "forearm": "sub", "shin": "sub"}   # paw-5r1: limb segments, unmeasured: sub as their neighbours
CENTRE_MAX = 0.06      # Suggest only: a SAM mask whose interior point drifted more than this (fraction of the mask diagonal) from the head blob's is refused (the head blob is kept): found fell because SAM masks moved off the locator (None = off)
BOX_PAD = None         # no box: a box around the head's blob clips whatever would grow past the blob (the dab's measurement: IoU 0.94 without, 0.58 with)
# paw-4fne, Suggest only, needs `area` (part -> the labels' median painted share of the picture: head.json `area`, seeder.area_prior; None = off):
HIPS_AREA = 2.0        # hips (the head's blob: no SAM level fits the owner's narrow hip) minus every unrelated part's mask, then its hottest pixels up to this x the typical hips share
SIZE_GUARD = 2.0       # a proposal of GUARD_PARTS over this x its part's typical share keeps only its hottest pixels up to that size
GUARD_PARTS = ("balls", "paws", "torso")   # measured: these gain on both label sets; penis / hand / head / thighs lost IoU on v1
DUP_IOU = 0.85         # two unrelated parts' masks this alike: the lower score is dropped
OVERLAP_KEEP = 0.4     # an unrelated part that loses shared pixels keeps at least this share of its mask, else it is dropped
# grow.js cleanMask constants (src/features/tracking/grow.js, snap.js): the same numbers, tested against the JS in test_seedsam.py
HOLE_FRAC, SMOOTH_FRAC, SMOOTH_MAX, PIECE_FRAC, HIT = 0.08, 0.12, 6, 0.05, 0.5
MARGIN_DEFAULT, MARGIN_FRAC, MARGIN_MAX = 15.0, 0.15, 3.0   # snap.js marginFor: the paint margin (setting in %, x the part's width, mask px)


# ------------------------------------------------------------------ cleanMask (port of grow.js / snap.js)
def _label(b):
    from scipy.ndimage import label
    lab, n = label(b)   # 4-connected, like fill.js components
    return lab, np.bincount(lab.ravel(), minlength=n + 1)


def keep_one(b, pos):
    """One component of a 0/1 mask: the one holding the most prompt points (ties and none: the largest). -> (mask bool, far)."""
    h, w = b.shape
    lab, sizes = _label(b)
    n = len(sizes)
    held = np.zeros(n, int)
    for x, y in pos:
        i = lab[min(max(int(y), 0), h - 1), min(max(int(x), 0), w - 1)]
        if i:
            held[i] += 1
    best = 0
    for k in range(1, n):
        if not best or held[k] > held[best] or (held[k] == held[best] and sizes[k] > sizes[best]):
            best = k
    out = (lab == best) if best else np.zeros_like(b, bool)
    far = any(k != best and (held[k] > 0 or sizes[k] >= PIECE_FRAC * sizes[best]) for k in range(1, n))
    return out, far


def fill_holes(reg, frac):
    """Holes (background not connected to the border) up to `frac` of the region's area are filled."""
    area = int(reg.sum())
    lab, sizes = _label(~reg)
    edge = set(lab[0].tolist()) | set(lab[-1].tolist()) | set(lab[:, 0].tolist()) | set(lab[:, -1].tolist())
    out = reg.copy()
    for k in range(1, len(sizes)):
        if k not in edge and sizes[k] <= frac * area:
            out[lab == k] = True
    return out


def signed_distance(a):
    """snap.js signedDistance: distance (px; < 0 inside) from the mask's 0.5 level, sub-pixel next to the outline."""
    from scipy.ndimage import distance_transform_edt
    a = np.asarray(a, np.float32)
    ins = a >= 0.5
    big = 1e4
    di = distance_transform_edt(ins) if (~ins).any() else np.full(a.shape, big)    # inside px: distance to an outside px
    do = distance_transform_edt(~ins) if ins.any() else np.full(a.shape, big)
    v = np.where(ins, -(di - 0.5), do - 0.5).astype(np.float32)
    p = np.pad(a, 1, mode="edge")
    gx = (p[1:-1, 2:] - p[1:-1, :-2]) / 2
    gy = (p[2:, 1:-1] - p[:-2, 1:-1]) / 2
    g = np.hypot(gx, gy)
    near = (np.abs(v) <= 1.5) & (g > 0.05)
    u = np.where(near, (0.5 - a) / np.where(g > 0.05, g, 1), 0)
    take = near & ((u * v >= 0) | (np.abs(u) < 0.5))
    return np.where(take, np.clip(u, -1.5, 1.5), v).astype(np.float32)


def box_blur(f, r, passes=2):
    """snap.js boxBlur: separable box blur of radius r, edges clamped."""
    from scipy.ndimage import uniform_filter1d
    for _ in range(passes):
        f = uniform_filter1d(uniform_filter1d(f, 2 * r + 1, axis=1, mode="nearest"), 2 * r + 1, axis=0, mode="nearest")
    return f.astype(np.float32)


def inset_outline(s, margin):
    """snap.js insetOutline: the outline of s pulled `margin` px inside, except where the shape is thin."""
    from scipy.ndimage import maximum_filter
    if not margin > 0:
        return s.copy()
    r = int(np.ceil(3 * margin))
    m = maximum_filter(np.maximum(0, -s), size=2 * r + 1, mode="nearest")
    return (s + margin * np.clip((m - margin) / margin, 0, 1)).astype(np.float32)


def part_width(s):
    """snap.js partWidth: 4 x the mean depth of the pixels inside (s < 0)."""
    inside = s < 0
    return float(4 * -s[inside].mean()) if inside.any() else 0.0


def margin_for(s, pct=MARGIN_DEFAULT):
    """snap.js marginFor: the paint margin (mask px) of the part whose signed distance field is s: pct % x min(MARGIN_MAX, MARGIN_FRAC x width)."""
    return min(max(pct, 0.0), 100.0) / 100 * min(MARGIN_MAX, MARGIN_FRAC * part_width(s))


def clean_mask(a, pos=(), margin=MARGIN_DEFAULT, others=()):
    """grow.js cleanMask: SAM's coverage mask (h, w; mask px) -> the group's blob as float coverage: ONE connected piece (the one
    holding the prompts `pos` [(x, y) mask px]), holes under HOLE_FRAC filled, the boundary smoothed (signed distance blurred over
    SMOOTH_FRAC of the equivalent radius), the paint margin `margin` (% setting, snap.js marginFor) inside, one piece again, never into `others` (bool masks). -> float32 (h, w)."""
    a = np.asarray(a, np.float32)
    one, _ = keep_one(a >= 0.5, pos)
    filled = fill_holes(one, HOLE_FRAC)
    f = filled.astype(np.float32)
    px = float(f.sum())
    if not px:
        return f
    r = int(min(max(round(SMOOTH_FRAC * np.sqrt(px / np.pi)), 1), SMOOTH_MAX))
    s1 = box_blur(signed_distance(f), r, 2)
    srt = np.sort(s1.ravel())   # grow.js areaKeep: the blur rounds the fringe, it must not shrink the part; ties pick the level leaving the closest count inside
    L = float(srt[min(int(px), srt.size - 1)])
    lo, le = int(np.searchsorted(srt, L, "left")), int(np.searchsorted(srt, L, "right"))
    s1 = s1 - float(np.clip(L - 1e-4 if px - lo < le - px else L, -r, r))
    s2 = inset_outline(s1, margin_for(s1, margin))
    blocked = np.zeros(a.shape, bool)
    for o in others:
        blocked |= np.asarray(o) >= 0.5
    cov = np.where(blocked, 0, np.clip(0.5 - s2, 0, 1)).astype(np.float32)
    two, _ = keep_one(cov >= 0.5, pos)
    from scipy.ndimage import binary_dilation
    rim = (cov > 0) & (cov < 0.5) & binary_dilation(two, structure=np.array([[0, 1, 0], [1, 0, 1], [0, 1, 0]], bool))
    return np.where(two | rim, cov, 0).astype(np.float32)


# ------------------------------------------------------------------ prompts
def related(a, b):
    """Parent / child (partlabel.ON_PART either way): they may overlap, and neither's peak is a negative for the other."""
    from pawtrack import partlabel
    return b in partlabel.ON_PART.get(a, ()) or a in partlabel.ON_PART.get(b, ())


def positives(r):
    """A blob -> [(x, y)] in its mask px, the way the owner's dab prompts SAM: the heat peak, then up to MAX_POS - 1 more points
    well spread over the blob's interior (deepest third: distance to the edge >= INNER_REL x the maximum), each at least SEP_INT x
    the blob's size from the ones already taken (farthest-point order). A compact blob keeps one point."""
    from scipy.ndimage import distance_transform_edt
    m = r["mask"]
    h, w = m.shape
    pts = [(r["peak"][0] * w, r["peak"][1] * h)]
    if m.sum() < 20:
        return pts
    d = distance_transform_edt(m)
    ys, xs = np.nonzero(d >= INNER_REL * d.max())
    size = float(np.sqrt(m.sum()))
    for _ in range(MAX_POS - 1):
        far = np.min([np.hypot(xs - px, ys - py) for px, py in pts], 0)
        i = int(np.argmax(far))
        if far[i] < SEP_INT * size:
            break
        pts.append((float(xs[i]), float(ys[i])))
    return pts


def negatives(i, regs, pos, size):
    """Peaks of the OTHER confident blobs (every other blob: another part, or another blob of this one) that are not in a parent /
    child relation with blob i and not within NEG_MIN of its positives. -> [(x, y)] mask px."""
    w, h = size
    diag = np.hypot(w, h)
    out = []
    for j, o in enumerate(regs):
        if j == i or o["score"] < NEG_CONF or related(regs[i]["part"], o["part"]):
            continue
        p = (o["peak"][0] * w, o["peak"][1] * h)
        if all(np.hypot(p[0] - q[0], p[1] - q[1]) >= NEG_MIN * diag for q in pos):
            out.append(p)
    return out


# ------------------------------------------------------------------ choosing and resolving
def walk_up(areas, scores):
    """THE shared candidate rule (grow.js pickMask's dab branch; test_seedsam.py runs both on the same sets). areas / scores of the
    candidates in play, smallest area first -> the index to take: from the smallest, step up while the next is at most LEVEL_MAX x the
    current one's area and scored at least SCORE_FLOOR."""
    s = 0
    while s + 1 < len(areas) and areas[s + 1] <= LEVEL_MAX * areas[s] and scores[s + 1] >= SCORE_FLOOR:
        s += 1
    return s


def choose(masks, scores, blob, pos, neg=(), level="part"):
    """SAM's masks (n, h, w) coverage 0..1 at mask px -> (index, why): the dab's choice. Candidates are those holding the most positives
    (none holds one: 'none'), minus the refused: over ABSURD_IMAGE of the picture, over BLOB_MAX x the head's blob, or covering a negative
    (another unrelated part's confident peak: it swallowed that part). None left: 'size' (the whole scene / far too large) or 'swallow'.
    Of the rest walk_up. The head's blob is only this guard: never the size to match."""
    h, w = blob.shape
    nb = max(int(blob.sum()), 1)
    at = lambda m, x, y: bool(m[min(max(int(y), 0), h - 1), min(max(int(x), 0), w - 1)])
    info = []
    for k in range(len(masks)):
        m = masks[k] >= HIT
        info.append((k, m, sum(at(m, x, y) for x, y in pos), int(m.sum())))
    most = max([c[2] for c in info] + [0])
    held = [c for c in info if c[2] == most and most > 0 and c[3] > 0]
    if not held:
        return None, "none"
    why = "size"
    fit = []
    for k, m, _, n in held:
        if n > ABSURD_IMAGE * h * w or n > BLOB_MAX * nb:
            why = "size"
        elif any(at(m, x, y) for x, y in neg):
            why = "swallow"
        else:
            fit.append((n, k))
    if not fit:
        return None, why
    fit.sort()
    s = 0 if level == "sub" else walk_up([n for n, _ in fit], [float(scores[k]) for _, k in fit])
    return fit[s][1], ""


def _inner(m):
    """The interior point of a mask: the deepest pixel (x, y) of its distance transform (the scorer's 'found' point)."""
    from scipy.ndimage import distance_transform_edt
    d = distance_transform_edt(np.pad(m, 1))[1:-1, 1:-1]
    i, j = np.unravel_index(int(np.argmax(d)), d.shape)
    return j + .5, i + .5


def _drift(a, b):
    """Distance between the interior points of two masks, as a fraction of the mask diagonal."""
    (ax, ay), (bx, by) = _inner(a), _inner(b)
    return float(np.hypot(ax - bx, ay - by) / np.hypot(*a.shape))


def resolve(accepted, margin=MARGIN_DEFAULT):
    """accepted [{part, mask (bool), score, mask_from}] -> the list without near-duplicates of unrelated parts (lower score goes)
    and without overlap between unrelated parts (the lower score gives up the shared pixels; dropped when too little is left)."""
    acc = sorted(accepted, key=lambda r: -r["score"])
    out = []
    for r in acc:
        m = r["mask"].copy()
        ok = True
        for o in out:
            if related(r["part"], o["part"]):
                continue
            inter = (m & o["mask"]).sum()
            if not inter:
                continue
            if inter / max((m | o["mask"]).sum(), 1) > DUP_IOU:
                ok = False
                break
            m &= ~o["mask"]
        if ok and m.sum() >= OVERLAP_KEEP * r["mask"].sum():
            keep = clean_mask(m.astype(np.float32), [(r["peak"][0] * m.shape[1], r["peak"][1] * m.shape[0])], margin) >= HIT if m.sum() != r["mask"].sum() else m
            if keep.any():
                out.append({**r, "mask": keep})
    return out


def hottest(m, heat, n=None):
    """The mask's `n` hottest pixels by `heat` (None or more than it has: all of them), the piece holding its hottest one."""
    k = int(m.sum())
    if not k:
        return m
    n = k if n is None else min(max(int(n), 1), k)
    t = np.partition(heat[m], k - n)[k - n]
    i = int(np.argmax(np.where(m, heat, -np.inf)))
    return keep_one(m & (heat >= t), [(i % m.shape[1] + .5, i // m.shape[1] + .5)])[0]


def fit_size(out, area):
    """paw-4fne: the owner's sizes. hips: the blob minus every unrelated part's mask (thighs, torso, tail ... beside it), then its hottest
    pixels up to HIPS_AREA x the typical hips share; GUARD_PARTS over SIZE_GUARD x their typical share: their hottest pixels up to that.
    area: part -> median painted share of the picture (None / empty: unchanged); a proposal without heat is left as it is."""
    if not area:
        return out
    res = []
    for r in out:
        if r["part"] == "hips" and r.get("heat") is not None:
            others = [o["mask"] for o in out if o["part"] != "hips" and not related("hips", o["part"])]
            m = r["mask"] & ~np.any(others, 0) if others else r["mask"]
            m = hottest(m, r["heat"]) if m.sum() >= 0.1 * r["mask"].sum() else r["mask"]   # the piece holding the hottest pixel
            if area.get("hips"):
                m = hottest(m, r["heat"], HIPS_AREA * area["hips"] * m.size)
            r = {**r, "mask": m}
        res.append(r)
    out, res = res, []
    for r in out:
        a = area.get(r["part"])
        if r["part"] in GUARD_PARTS and a and r.get("heat") is not None and r["mask"].mean() > SIZE_GUARD * a:
            r = {**r, "mask": hottest(r["mask"], r["heat"], SIZE_GUARD * a * r["mask"].size)}
        res.append(r)
    return res


# ------------------------------------------------------------------ the step
def refine(regs, size, predict, rgb=None, margin=MARGIN_DEFAULT, area=None):
    """regs: [{part, mask (bool (h, w) = size), score, peak (x, y 0..1), heat (h, w)?}] (the head's blobs or the CAM regions) ->
    ([the same with SAM's drawn mask, mask_from 'sam' | 'head', sam_score?]) and a record {sam, head, dropped, ms_prompt}.
    predict(points (n, 2) 0..1, labels (n,), box (4,) 0..1 | None, single=False) -> (masks (3, h, w) coverage at `size`, scores (3,)): one
    frame's SAM (the embedding already set); see `sam_predict`."""
    import time
    t0 = time.perf_counter()
    w, h = size
    accepted, rec = [], {"sam": 0, "head": 0, "dropped": 0, "why": {}}
    for i, r in enumerate(regs):
        pos = positives(r)
        neg = negatives(i, regs, pos, size)
        box = None
        if BOX_PAD is not None:
            ys, xs = np.nonzero(r["mask"])
            gx, gy = BOX_PAD * (xs.max() - xs.min() + 1), BOX_PAD * (ys.max() - ys.min() + 1)
            box = np.array([max(xs.min() - gx, 0) / w, max(ys.min() - gy, 0) / h, min(xs.max() + 1 + gx, w) / w, min(ys.max() + 1 + gy, h) / h])
        pts = np.array([[x / w, y / h] for x, y in pos + neg], np.float32)
        lab = np.array([1] * len(pos) + [0] * len(neg), np.int32)
        level = POLICY.get(r["part"], "part")
        if level == "head":
            k, why = None, "policy"
        else:
            masks, scores = predict(pts, lab, box, SINGLE or level == "single")
            k, why = choose(masks, scores, r["mask"], pos, neg, level)
        if k is not None:
            c = clean_mask(masks[k], pos, margin) >= HIT
            if c.any() and CENTRE_MAX is not None and _drift(c, r["mask"]) > CENTRE_MAX:
                c, why = np.zeros_like(c), "drift"
            if c.any():
                # paw-om3e: the prompts and SAM's chosen mask travel with the proposal, so the owner's loosen / dab tools work on it at once
                accepted.append({**r, "mask": c, "mask_from": "sam", "sam_score": float(scores[k]),
                                 "sam": {"pos": [(x / w, y / h) for x, y in pos], "neg": [(x / w, y / h) for x, y in neg], "raw": np.asarray(masks[k], np.float32)}})
                continue
            why = why if why == "drift" else "empty"
        rec["why"][why] = rec["why"].get(why, 0) + 1
        # v4.34: never lose a part the head found because SAM disagrees: the head's own blob, cleaned and smoothed
        hm = clean_mask(r["mask"].astype(np.float32), pos[:1], margin) >= HIT
        accepted.append({**r, "mask": hm if hm.any() else r["mask"], "mask_from": "head"})   # (no SAM state: nothing of SAM's drew it)
    out = fit_size(resolve(accepted, margin), area)
    rec["dropped"] += len(accepted) - len(out)
    rec["sam"] = sum(1 for r in out if r["mask_from"] == "sam")
    rec["head"] = len(out) - rec["sam"]
    rec["ms_prompt"] = round(1000 * (time.perf_counter() - t0), 1)
    return out, rec


def sam_predict(pred, rgb, size, key=None):
    """-> predict(points, labels, box) for refine: SAM 2's image predictor `pred` holds the embedding of `rgb` (RGB uint8; the
    frame's key shares it through segment.py's cache), masks returned as coverage at `size` (w, h)."""
    import cv2
    import torch
    from pawtrack import segment
    if key is not None:
        segment._embed(pred, key, lambda: rgb)
    else:
        pred.set_image(rgb)
    H, W = pred._orig_hw[0]

    def predict(pts, lab, box, single=False):
        kw = {"point_coords": pts * np.array([W, H], np.float32), "point_labels": lab}
        if box is not None:
            kw["box"] = box * np.array([W, H, W, H], np.float32)
        with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
            ms, sc, _ = pred.predict(multimask_output=not single, **kw)
        return np.stack([cv2.resize(np.asarray(m, np.float32), size, interpolation=cv2.INTER_AREA) for m in ms]), np.asarray(sc, float)
    return predict
