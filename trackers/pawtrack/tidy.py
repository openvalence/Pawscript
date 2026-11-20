"""Fewer, cleaner proposals (PROTOCOL v4.34, paw-r6t0): everything between "the head found blobs" and "the groups Suggest returns".

Before who (per part, on the working mask grid, `size` = (w, h) of seeder.MASK_W):
  merge_near   blobs of one part that touch / nearly touch (MERGE_GAP px) are one blob
  clean        every blob goes through the app's cleanMask (seedsam.clean_mask: one piece, holes filled, smooth boundary, the paint
               margin), whoever drew it (the head's blob, a SAM mask, a tagger CAM blob)
  slivers      a cleaned blob under SLIVER_FRAC of the picture is dropped
After who (`finish`, on groups carrying an internal `_mask`):
  one per thing   per character: one group per unpaired part, one per side of a paired part (the best score); other blobs of that
                  part merge into it when they touch, are kept as `...2` ONLY as the other HALF of the same part (both >= HALF_BAR,
                  close, something else lies between them), else are dropped
  isolation       a part far from every other part of its character is penalised (score x ISO_PENALTY)
  overlap         unrelated parts (not parent / child) do not overlap: the lower score gives up the shared area (dropped if little is left)
  cap             at most MAX_TOTAL groups, best first
The colour-vs-character filter of the brief is NOT here: it needs the picture's pixels and the held-out scorer works on cached features
only, so it could not be justified (see PROTOCOL.md v4.34).
"""
import numpy as np

from pawtrack import seedsam

MERGE_GAP = 4          # px on the working grid (320 wide): blobs of one part closer than this are one blob
SLIVER_FRAC = 0.001    # a cleaned blob smaller than this share of the picture is a sliver (~8 x 8 px at 320 wide)
HALF_BAR = 0.7         # both pieces of a part seen in two halves score at least this
HALF_NEAR = 1.5        # ... and are no further apart (gap) than this x the larger piece's equivalent diameter
OCC_STEPS = 9          # the line between the two pieces' centres is sampled here (middle 70 %) for something lying between them
ISO_D = 0.45           # a part this far (share of the picture diagonal) from every other part of its character is isolated ...
ISO_PENALTY = 0.75     # ... and its score is multiplied by this
ISO_MIN_PARTS = 4      # (needs this many parts on the character to say anything)
MAX_TOTAL = 14         # proposals per image (two characters)
OVERLAP_KEEP = seedsam.OVERLAP_KEEP


# ------------------------------------------------------------------ pieces
def clean_blob(m, margin=0.0, pos=()):
    """Blob (bool / coverage) -> cleaned bool mask (seedsam.clean_mask >= HIT); an empty result is empty."""
    return seedsam.clean_mask(np.asarray(m, np.float32), pos, margin) >= seedsam.HIT


def _box(m):
    ys, xs = np.nonzero(m)
    return xs.min(), xs.max(), ys.min(), ys.max()


def gap(a, b, limit=None):
    """Distance (px) between two bool masks (0 when they touch / overlap); with `limit`, anything further is returned as inf
    without the distance transform (bounding boxes first: most pairs are far apart)."""
    from scipy.ndimage import distance_transform_edt
    if not a.any() or not b.any():
        return float("inf")
    (ax0, ax1, ay0, ay1), (bx0, bx1, by0, by1) = _box(a), _box(b)
    if limit is not None and (max(ax0, bx0) - min(ax1, bx1) > limit or max(ay0, by0) - min(ay1, by1) > limit):
        return float("inf")
    x0, x1, y0, y1 = min(ax0, bx0), max(ax1, bx1) + 1, min(ay0, by0), max(ay1, by1) + 1   # the pair's joint box only
    return float(distance_transform_edt(~a[y0:y1, x0:x1])[b[y0:y1, x0:x1]].min())


def eqd(m):
    """Equivalent diameter (px) of a mask."""
    return float(2 * np.sqrt(m.sum() / np.pi))


def close_union(a, b, g=MERGE_GAP):
    """a | b with the gap between them bridged (a morphological closing of g / 2 + 1 px)."""
    from scipy.ndimage import binary_closing
    u = a | b
    return binary_closing(np.pad(u, g), iterations=g // 2 + 1)[g:-g, g:-g] | u


def centre(m):
    ys, xs = np.nonzero(m)
    h, w = m.shape
    return ((xs.mean() + .5) / w, (ys.mean() + .5) / h)


def merge_near(regs, margin=0.0):
    """regs [{part, mask, score, ...}] -> the same where blobs of one part within MERGE_GAP px of each other are one (best score
    first; the merged blob is re-cleaned, takes the higher score and the first one's peak)."""
    out = []
    for r in sorted(regs, key=lambda r: -r["score"]):
        for o in out:
            if o["part"] == r["part"] and gap(o["mask"], r["mask"], MERGE_GAP) <= MERGE_GAP:
                u = clean_blob(close_union(o["mask"], r["mask"]), margin, [(o["peak"][0] * o["mask"].shape[1], o["peak"][1] * o["mask"].shape[0])]) if "peak" in o else close_union(o["mask"], r["mask"])
                if u.any():
                    o["mask"] = u
                break
        else:
            out.append(dict(r))
    return out


def sliver(m):
    return m.sum() < SLIVER_FRAC * m.size


def drop_overlap(items, margin=0.0):
    """items [{part, mask (bool), score}] -> the same without overlap between unrelated parts (parent / child may overlap): best
    score first, a lower one gives up the shared pixels (re-cleaned to one piece; dropped when less than OVERLAP_KEEP of it is left
    or what is left is a sliver)."""
    out = []
    for r in sorted(items, key=lambda r: -r["score"]):
        m, taken = r["mask"], np.zeros_like(r["mask"])
        for o in out:
            if not seedsam.related(r["part"], o["part"]):
                m = m & ~o["mask"]
                taken |= o["mask"]
        if m.sum() != r["mask"].sum():
            if m.sum() < OVERLAP_KEEP * r["mask"].sum():
                continue
            m = clean_blob(m, 0.0) & ~taken   # the area-keeping smoothing may grow the cut edge back a pixel
            if m.sum() < OVERLAP_KEEP * r["mask"].sum():
                continue
        if m.any() and not sliver(m):
            out.append({**r, "mask": m})
    return out


def tidy_regions(regs, margin=0.0):
    """The head's blobs (seeder.regions) -> merged, cleaned, sliver-free, overlap-free blobs (the head-only shipped path)."""
    regs = merge_near(regs, margin)
    out = []
    for r in regs:
        h, w = r["mask"].shape
        pk = [(r["peak"][0] * w, r["peak"][1] * h)] if "peak" in r else ()
        m = clean_blob(r["mask"], margin, pk)
        if m.any() and not sliver(m):
            out.append({**r, "mask": m, "c": centre(m)})
    return drop_overlap(out)


# ------------------------------------------------------------------ after who
def between(a, b, others):
    """Does any mask of `others` lie on the line between the centres of a and b (its middle 70 %)?"""
    h, w = a.shape
    (ax, ay), (bx, by) = centre(a), centre(b)
    for t in np.linspace(0.15, 0.85, OCC_STEPS):
        x, y = min(w - 1, int((ax + t * (bx - ax)) * w)), min(h - 1, int((ay + t * (by - ay)) * h))
        if any(o[y, x] for o in others):
            return True
    return False


def other_half(p, o, others):
    """Is blob o the other half of part blob p (seen in two pieces because something is in front of it)? Both score well, they
    are close (within HALF_NEAR x the part's size) and something else lies between their centres."""
    return (p["score"] >= HALF_BAR and o["score"] >= HALF_BAR and gap(p["_mask"], o["_mask"]) <= HALF_NEAR * max(eqd(p["_mask"]), eqd(o["_mask"]))
            and between(p["_mask"], o["_mask"], others))


def select(groups, margin=0.0):
    """Per (who, part, side): the best group; the others merge into it (touching), are the `...2` half (other_half) or are dropped.
    A group without `_mask` (a SAM `body`) passes untouched."""
    gs = sorted(groups, key=lambda g: -g["score"])
    out, rest = [], [g for g in gs if "_mask" not in g]
    cand = [g for g in gs if "_mask" in g]
    for g in cand:
        key = (g.get("who"), g.get("part"), g.get("side"))
        same = [o for o in out if (o.get("who"), o.get("part"), o.get("side")) == key]
        if not same:
            out.append(dict(g))
            continue
        p = same[0]
        if gap(p["_mask"], g["_mask"], MERGE_GAP) <= MERGE_GAP:
            p["_mask"] = clean_blob(close_union(p["_mask"], g["_mask"]), margin)
            p.pop("sam", None)   # paw-om3e: a merged outline is no longer SAM's single answer
            continue
        occ = [o["_mask"] for o in cand if o is not g and o["_mask"] is not p["_mask"] and (o.get("who"), o.get("part"), o.get("side")) != key]
        if len(same) == 1 and other_half(p, g, occ):
            out.append({**g, "half": True})
    return out + rest


def isolate(groups, aspect):
    """Score x ISO_PENALTY for a part whose centre is further than ISO_D (of the diagonal) from every other part of its character."""
    diag = float(np.hypot(aspect, 1.0))
    for g in groups:
        if "_mask" not in g or not g.get("who"):
            continue
        mates = [o for o in groups if o is not g and "_mask" in o and o.get("who") == g["who"]]
        if len(mates) + 1 < ISO_MIN_PARTS:
            continue
        cx, cy = centre(g["_mask"])
        d = min(np.hypot((cx - centre(o["_mask"])[0]) * aspect, cy - centre(o["_mask"])[1]) for o in mates) / diag
        if d > ISO_D:
            g["score"] = round(g["score"] * ISO_PENALTY, 3)
            g["isolated"] = True
    return groups


def finish(groups, aspect, margin=0.0, poly=None):
    """suggest()'s groups after assign_who (each with `_mask`) -> the returned list: selected, penalised, overlap-free, sliver-free,
    capped, polygons from the final masks, `_mask` removed. poly(mask) -> [[x, y], ...] | None."""
    gs = isolate(select(groups, margin), aspect)
    keep = drop_overlap([{**g, "part": g.get("part") or g["name"], "mask": g["_mask"]} for g in gs if "_mask" in g])
    out = []
    for r in keep:
        g = {k: v for k, v in r.items() if k not in ("mask", "_mask")}
        g["poly"] = poly(r["mask"]) if poly else g.get("poly")
        if g["poly"]:
            out.append(g)
    out.sort(key=lambda g: -g["score"])
    return out[:MAX_TOTAL] + [g for g in gs if "_mask" not in g]
