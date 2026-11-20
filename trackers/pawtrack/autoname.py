"""Automatic naming of painted blobs (paw-p9ve, PROTOCOL v4.33): the owner paints a blob, the model PROPOSES its part and character.

Measured by experiments/seeder-probe/autoname.py (RESULTS.md, "paw-p9ve"): naming a region that is already painted is far easier than
finding it (held-out, grouped by source: part top-1 0.86, top-3 0.97). Per image, from the patch features the seeder already cached:
  * region features: the mean patch feature under the blob + simple geometry (area, aspect, position, position relative to the other
    blobs); a colour histogram of the pixels under the mask (who only);
  * part: a softmax regression over those (standardised, L2) -> a probability per part; then a set-wise decode over the picture's blobs
    (a non-paired part at most once per character, paired parts at most twice; blobs the owner already named use up their slot); the
    picker's order = decoded part first, the rest by probability;
  * who: NOT learnable from appearance alone (0.71 of the other blobs right given ONE named blob, chance cold): the blobs are split into
    two characters by appearance + position and the split is named by the blobs that carry a who (propagation); the app uses that as a
    cross-check, never as a name on its own;
  * side (the paired limbs): the image-side rule measured at chance: not proposed (paw-5r1: the side is the character's own left / right,
    the owner's word; the app proposes L, or R when L is painted, and F flips it).
A confidence gate (GATE_PART, from the held-out predictions) says which proposals the confirm-all key may accept.

The model is its own small file. v4.38: ONE namer for every dataset (<seeder>/namer.pt, trained on the named groups of all datasets:
naming a part does not depend on the painting technique), with its held-out accuracy (grouped by source across the union) in namer.json.
Pure numpy / torch CPU, tens of ms per picture.
"""
import hashlib
import itertools
import json
import os
import re

import numpy as np

PAIRED = ("shoulder", "forearm", "hand", "thighs", "shin", "paws")   # = partlabel.PAIRED (test/groups-vocab.test.mjs)
WHOS = ("c1", "c2")
VERSION = 1
RING = 0.05             # ring width (fraction of the mask grid's width) around a blob
WD_PART, WD_WHO = 3e-2, 1e-1    # L2 of the two linear models (per-sample mean loss; set by the probe's grid on the held-out folds)
STEPS = 300
# the confidence gate (probe: the smallest threshold at which the held-out accepted proposals were right >= 95 % of the time)
GATE_PART = 0.90          # the decoded part probability above which the confirm-all key may accept a proposal: held-out, 65 % of blobs at 96 % right
MIN_BLOBS = 20
FOLDS = 5               # the held-out accuracy: grouped k-fold by source
WHO_USE, WHO_W = ("pool", "hist", "geo_xy"), {"hist": 1.0}   # what the character split clusters (the probe's best: colour x2 + features + position)
HIST_BINS = 4           # colour histogram: HIST_BINS ** 3 cells over B, G, R


# ------------------------------------------------------------------ region features (pure)
def colour_hist(bgr, mask):
    """Hellinger-ready colour histogram (HIST_BINS ** 3 cells, sums to 1, sqrt-ed) of the pixels of `bgr` under `mask` (any size)."""
    import cv2
    m = np.asarray(mask, bool)
    if m.shape != bgr.shape[:2]:
        bgr = cv2.resize(bgr, (m.shape[1], m.shape[0]), interpolation=cv2.INTER_AREA)
    px = bgr[m]
    out = np.zeros(HIST_BINS ** 3, np.float32)
    if len(px):
        q = (px.astype(np.int32) * HIST_BINS // 256)
        np.add.at(out, q[:, 0] * HIST_BINS * HIST_BINS + q[:, 1] * HIST_BINS + q[:, 2], 1.0)
        out /= out.sum()
    return np.sqrt(out)


def _pool(F, grid, mask):
    """Mean of the patch features F (S, D) under `mask` (any size) weighted by cover -> (D,) float32 (zeros when empty)."""
    import cv2
    ph, pw = grid
    c = cv2.resize(np.asarray(mask, np.float32), (pw, ph), interpolation=cv2.INTER_AREA).reshape(-1)
    s = float(c.sum())
    if s <= 1e-6:
        return np.zeros(F.shape[1], np.float32)
    return ((np.asarray(F, np.float32) * (c / s)[:, None]).sum(0)).astype(np.float32)


def _unit(x):
    return x / max(float(np.linalg.norm(x)), 1e-6)


def ring_of(mask):
    """The band just outside a mask (bool, any size): dilation by RING of the width, minus the mask."""
    import cv2
    m = np.asarray(mask, bool)
    k = max(3, int(round(RING * m.shape[1]))) | 1
    d = cv2.dilate(m.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))).astype(bool)
    return d & ~m


def geometry(masks, aspect):
    """(n, 12) float32 simple geometry of n blobs of one picture (masks bool, same shape; aspect = W / H of the picture):
    sqrt(area share), area rank share, log bbox aspect (true pixels), cx, cy, bbox w, h, offset of the centre from the other blobs'
    mean centre (x, y, true aspect), distance to it, number of blobs (log)."""
    n = len(masks)
    G = np.zeros((n, 12), np.float32)
    cs, ar = [], []
    for m in masks:
        ys, xs = np.nonzero(m)
        h, w = m.shape
        if not len(xs):
            cs.append((0.5, 0.5, 0.0, 0.0, 0.0))
            ar.append(0.0)
            continue
        cs.append(((xs.mean() + .5) / w, (ys.mean() + .5) / h, (xs.max() - xs.min() + 1) / w, (ys.max() - ys.min() + 1) / h, len(xs) / (w * h)))
        ar.append(len(xs) / (w * h))
    cs = np.array(cs, np.float32)
    order = np.argsort(np.argsort(-np.array(ar)))
    for i in range(n):
        o = np.delete(cs[:, :2], i, 0).mean(0) if n > 1 else cs[i, :2]
        dx, dy = (cs[i, 0] - o[0]) * aspect, cs[i, 1] - o[1]
        G[i] = [np.sqrt(cs[i, 4]), order[i] / max(n - 1, 1), np.log(max(cs[i, 2] * aspect, 1e-3) / max(cs[i, 3], 1e-3)), cs[i, 0], cs[i, 1],
                cs[i, 2], cs[i, 3], dx, dy, np.hypot(dx, dy), np.log(n), 0.0]
    return G


def mask_gaps(masks):
    """(n, n) distance between the blobs' nearest pixels in fractions of the mask width (0 = touching / overlapping)."""
    import cv2
    n = len(masks)
    G = np.zeros((n, n), np.float32)
    dts = [cv2.distanceTransform((~np.asarray(m, bool)).astype(np.uint8), cv2.DIST_L2, 3) / m.shape[1] for m in masks]
    for i in range(n):
        for j in range(n):
            if i != j:
                G[i, j] = float(dts[i][np.asarray(masks[j], bool)].min()) if np.asarray(masks[j]).any() else 1.0
    return np.minimum(G, G.T) if n else G


def blob_features(F, grid, masks, aspect, hists=None):
    """One picture's blobs -> {pool (n, D) L2, ring (n, D) L2, geo (n, 12), hist (n, H) | None, cen (n, 2)} from patch features F."""
    pool = np.array([_unit(_pool(F, grid, m)) for m in masks], np.float32).reshape(len(masks), -1)
    ring = np.array([_unit(_pool(F, grid, ring_of(m))) for m in masks], np.float32).reshape(len(masks), -1)
    geo = geometry(masks, aspect)
    gap = mask_gaps(masks)
    return {"gap": gap, "pool": pool, "ring": ring, "geo": geo, "hist": None if hists is None else np.asarray(hists, np.float32), "cen": geo[:, 3:5].copy()}


# ------------------------------------------------------------------ a linear softmax model (torch CPU)
class Lin:
    """Standardised softmax regression with L2 (the whole model is one matrix: a few hundred blobs train it in a second)."""

    def __init__(self, W=None, b=None, mu=None, sd=None, classes=None):
        self.W, self.b, self.mu, self.sd, self.classes = W, b, mu, sd, classes or []

    @classmethod
    def fit(cls, X, y, classes, wd, steps=STEPS, seed=0):
        import torch
        X = np.asarray(X, np.float32)
        mu, sd = X.mean(0), X.std(0) + 1e-4
        Xt = torch.from_numpy((X - mu) / sd)
        yt = torch.from_numpy(np.array([classes.index(v) for v in y]))
        torch.manual_seed(seed)
        W = torch.zeros(X.shape[1], len(classes), requires_grad=True)
        b = torch.zeros(len(classes), requires_grad=True)
        # class prior balance would help rare parts but flatters the gate; the plain loss keeps probabilities honest
        opt = torch.optim.Adam([W, b], 1e-2)
        for _ in range(steps):
            loss = torch.nn.functional.cross_entropy(Xt @ W + b, yt) + wd * (W * W).sum() / max(len(classes), 1)
            opt.zero_grad()
            loss.backward()
            opt.step()
        return cls(W.detach().numpy(), b.detach().numpy(), mu, sd, list(classes))

    def proba(self, X):
        z = ((np.asarray(X, np.float32) - self.mu) / self.sd) @ self.W + self.b
        z = np.exp(z - z.max(1, keepdims=True))
        return z / z.sum(1, keepdims=True)


# ------------------------------------------------------------------ part: set-wise decode
def decode_parts(P, classes, who=None, named=None, paired=PAIRED):
    """P (n, K) probabilities -> (best (n,) part names, P2 (n, K) probabilities after the set constraint).
    A non-paired part at most once per character (two blobs of the same character never share a hips), a paired part at most twice;
    `who` (n,) cluster / character labels (None: two characters assumed unknown: each part at most twice, paired four times);
    `named` {i: part}: blobs the owner already named, they use up their slot. Greedy on probability (ties are rare; n is small).
    P2 = P with the parts a blob lost to a surer blob removed and renormalised (the ranking the picker shows)."""
    n, K = P.shape
    cap = lambda p: (2 if p in paired else 1)
    used = {}
    best = [None] * n
    key = lambda i: (who[i] if who is not None else 0)
    mult = 1 if who is not None else 2
    for i, p in (named or {}).items():
        used[(key(i), p)] = used.get((key(i), p), 0) + 1
        best[i] = p
    pairs = sorted(((P[i, k], i, k) for i in range(n) if i not in (named or {}) for k in range(K)), reverse=True)
    for pr, i, k in pairs:
        if best[i] is not None:
            continue
        p = classes[k]
        if used.get((key(i), p), 0) < cap(p) * mult:
            best[i] = p
            used[(key(i), p)] = used.get((key(i), p), 0) + 1
    P2 = P.copy()
    for i in range(n):
        if i in (named or {}):
            P2[i] = 0
            P2[i, classes.index(named[i])] = 1
            continue
        for k, p in enumerate(classes):
            if p != best[i] and used.get((key(i), p), 0) >= cap(p) * mult:
                P2[i, k] = 0
        s = P2[i].sum()
        P2[i] = P2[i] / s if s > 0 else P[i]
    return best, P2


# ------------------------------------------------------------------ who: split into two characters
def _std(a):
    a = np.asarray(a, np.float64)
    return a / max(float(a.std()), 1e-6) if a.size else a


def split_two(Z, parts, paired=PAIRED, dup_penalty=1e3):
    """Exhaustive 2-way split of n <= 12 blobs minimising within-group dispersion of Z (n, d), a non-paired part at most once per
    group (a duplicate costs `dup_penalty`). -> (labels (n,) in {0, 1}, margin) with margin = how much better than ONE group
    (1 - cost2 / cost1, 0..1: the cold "do these look like two characters" signal); None when n < 2 or n > 12."""
    n = len(parts)
    if n < 2 or n > 12:
        return None
    Z = np.asarray(Z, np.float64)
    one = ((Z - Z.mean(0)) ** 2).sum() + 1e-9
    best = bl = None
    for bits in itertools.product((0, 1), repeat=n - 1):
        lab = np.r_[0, bits]
        bad = sum(max(0, sum(1 for j in range(n) if parts[j] == p and lab[j] == q) - 1) for p in set(parts) if p not in paired for q in (0, 1))
        cost = sum(((Z[lab == q] - Z[lab == q].mean(0)) ** 2).sum() for q in (0, 1) if (lab == q).any()) + dup_penalty * bad
        if best is None or cost < best:
            best, bl = cost, lab
    return bl, float(max(0.0, 1 - best / one))


def flip_margins(Z, parts, lab, paired=PAIRED, dup_penalty=1e3):
    """Per blob: how much worse the split gets (share of the one-group dispersion) when ONLY that blob changes side: the blob's own
    confidence in the split (0 = it could as well be on the other side; large = it clearly belongs)."""
    Z = np.asarray(Z, np.float64)
    one = ((Z - Z.mean(0)) ** 2).sum() + 1e-9

    def cost(l):
        bad = sum(max(0, sum(1 for j in range(len(parts)) if parts[j] == p and l[j] == q) - 1) for p in set(parts) if p not in paired for q in (0, 1))
        return sum(((Z[l == q] - Z[l == q].mean(0)) ** 2).sum() for q in (0, 1) if (l == q).any()) + dup_penalty * bad
    base = cost(lab)
    out = []
    for k in range(len(lab)):
        l2 = lab.copy()
        l2[k] ^= 1
        out.append((cost(l2) - base) / one)
    return np.array(out)


def who_matrix(ft, use=("pool", "geo_xy", "hist"), w=None):
    """The matrix split_two clusters: each block z-scored as a whole, then weighted (w: {block: weight}).
    blocks: pool (region features), ring, geo_xy (centre x, y), hist (colour histogram)."""
    w = w or {}
    cols = []
    for u in use:
        a = {"pool": ft["pool"], "ring": ft["ring"], "geo_xy": ft["cen"], "hist": ft["hist"]}[u]
        if a is None:
            continue
        cols.append(_std(a - a.mean(0)) * w.get(u, 0.5 if u in ("pool", "hist") else 1.0))
    return np.concatenate(cols, 1)


def propagate_who(lab, known):
    """lab (n,) in {0, 1}; known {i: 'c1' | 'c2'} -> (n,) who names by vote of the named blobs (None where the named blobs disagree
    about the split or nothing is named)."""
    vote = {0: [], 1: []}
    for i, w in known.items():
        vote[int(lab[i])].append(w)
    side = {}
    for q in (0, 1):
        o = 1 - q
        c = [w for w in vote[q]] + [("c2" if w == "c1" else "c1") for w in vote[o]]
        side[q] = c[0] if c and len(set(c)) == 1 else None
    return [side[int(l)] for l in lab]


def side_of(cen, who, paired_idx):
    """'l' | 'r' for each blob index in paired_idx: its centre is left / right of the centre of ITS character's blobs (who (n,) labels)."""
    out = {}
    for i in paired_idx:
        same = [cen[j][0] for j in range(len(cen)) if who[j] == who[i]]
        c = float(np.mean(same))
        out[i] = None if abs(cen[i][0] - c) < 0.01 else ("l" if cen[i][0] < c else "r")
    return out


def role_features(ft, part_probs):
    """The cold who classifier's input per blob: part probabilities, pooled feature, ring, geometry."""
    return np.concatenate([part_probs * 3.0, ft["pool"], ft["geo"], ft["hist"] if ft["hist"] is not None else np.zeros((len(part_probs), 0), np.float32)], 1)


# ------------------------------------------------------------------ the model: train, store, propose
def region_rows(frames, feats):
    """[(frame, X (n, d) the part classifier's input, [part per blob])] for the frames with cached features and painted groups."""
    out = []
    for f in frames:
        z = feats.get((f["key"], f["t"]))
        if z is None or not f["groups"]:
            continue
        ft = blob_features(z[0], z[1], [g["mask"] for g in f["groups"]], f["W"] / f["H"])
        out.append((f, part_input(ft), [g["part"] for g in f["groups"]]))
    return out


def _fit_rows(rows, parts):
    y = [p for r in rows for p in r[2]]
    if not rows or len(y) < MIN_BLOBS or len({*y}) < 3:
        return None
    seen = [p for p in parts if p in set(y)]   # a part with no example is no class (it would only soak up probability)
    return Lin.fit(np.concatenate([r[1] for r in rows]), y, seen, WD_PART)


def fit(frames, feats, parts, fingerprint=None, rows=None):
    """seeder frames ({key, t, W, H, groups: [{part, who, mask}]}) with cached features feats {(key, t): (F, grid)} (or their region_rows)
    -> Namer, or None when there is too little to learn from (< MIN_BLOBS blobs or < 3 parts)."""
    set_parts(parts)
    rows = region_rows(frames, feats) if rows is None else rows
    m = _fit_rows(rows, parts)
    if m is None:
        return None
    return Namer(m, {"fingerprint": fingerprint, "blobs": sum(len(r[2]) for r in rows), "images": len(rows), "parts": m.classes,
                     "trained_on": sorted({"%s_%d" % (r[0]["key"], r[0]["t"]) for r in rows})})


def ranked(P, classes):
    """One picture's probabilities -> per blob the part names in the order propose shows them (set-wise decoded part first)."""
    best, P2 = decode_parts(P, classes)
    out = []
    for i in range(len(P)):
        o = [classes[k] for k in np.argsort(-P2[i]) if P2[i, k] > 0]
        out.append([best[i]] + [p for p in o if p != best[i]])
    return out


def fold_of(key, folds=FOLDS):
    """A source's fold (stable: a picture, and every label of it in any dataset, is on one side)."""
    return int(hashlib.sha1(str(key).encode()).hexdigest()[:8], 16) % folds


def held_out(rows, parts, folds=FOLDS):
    """v4.38: the namer's accuracy on sources it never trained on: grouped k-fold BY SOURCE over region_rows (frames may carry `ds`, their
    dataset); each blob is ranked as propose ranks it. -> {top1, top3, n, images, folds, parts: [[part, n, top1]] weakest first,
    by_ds: {dataset: {top1, top3, n}}} or None (too little to score). A fold whose training side is too small leaves its blobs unscored."""
    hits = []   # (ds, part, top-1 right, in the top 3)
    for k in range(folds):
        te = [r for r in rows if fold_of(r[0]["key"], folds) == k]
        m = _fit_rows([r for r in rows if fold_of(r[0]["key"], folds) != k], parts) if te else None
        if m is None:
            continue
        for r in te:
            for p, o in zip(r[2], ranked(m.proba(r[1]), m.classes)):
                hits.append((r[0].get("ds"), p, o[0] == p, p in o[:3]))
    if not hits:
        return None
    summ = lambda h: {"top1": round(float(np.mean([x[2] for x in h])), 3), "top3": round(float(np.mean([x[3] for x in h])), 3), "n": len(h)}
    per = {}
    for x in hits:
        per.setdefault(x[1], []).append(x[2])
    return {**summ(hits), "images": len({r[0]["key"] for r in rows}), "folds": folds,
            "parts": sorted(([p, len(v), round(float(np.mean(v)), 3)] for p, v in per.items()), key=lambda z: (z[2], -z[1])),
            "by_ds": {d: summ([x for x in hits if x[0] == d]) for d in sorted({x[0] for x in hits if x[0]})}}


def part_input(ft):
    """The part classifier's input per blob: pooled region feature + geometry (the ring was measured and did not help)."""
    return np.concatenate([ft["pool"], ft["geo"]], 1)


class Namer:
    """The part classifier + its record; saved beside the head (namer.pt, fingerprinted with the labels it trained on)."""

    def __init__(self, part, info=None):
        self.part, self.info = part, info or {}

    def save(self, d):
        import torch
        os.makedirs(d, exist_ok=True)
        fn = os.path.join(d, "namer.pt")
        torch.save({"version": VERSION, "part": self.part.__dict__, "info": self.info}, fn + ".tmp")
        os.replace(fn + ".tmp", fn)

    @classmethod
    def load(cls, d, fingerprint=None):
        """The stored namer, or None: missing, another format, or (when `fingerprint` is given) trained on other labels than the head's:
        a stale model answers "unknown", it never guesses."""
        import torch
        fn = os.path.join(d or "", "namer.pt")
        if not d or not os.path.exists(fn):
            return None
        z = torch.load(fn, map_location="cpu", weights_only=False)
        if z.get("version") != VERSION or (fingerprint is not None and z["info"].get("fingerprint") != fingerprint):
            return None
        return cls(Lin(**z["part"]), z["info"])

    def propose(self, F, grid, masks, aspect, hists, named=None, whos=None, top=3, bgr=None, key=None):
        """One picture's blobs -> [{part: [{part, p} x top] (the decoded part first, then by probability), conf (probability of the
        decoded part after the set constraint), auto (conf >= GATE_PART and the blob is unnamed), who: 'c1' | 'c2' | None, who_by, named}].
        named {i: part}: blobs the owner named (their part is fixed and uses up a slot); whos {i: 'c1' | 'c2'}: blobs whose character is
        known (named, or the tool's own): the appearance split of the picture's blobs (<= 12) is named by them (propagation)."""
        parts = self.part.classes
        set_parts(parts)
        named, whos = named or {}, whos or {}
        ft = blob_features(F, grid, masks, aspect, hists)
        P = self.part.proba(part_input(ft))
        best, P2 = decode_parts(P, parts, None, named)
        out = []
        for i in range(len(masks)):
            o = [k for k in np.argsort(-P2[i]) if P2[i, k] > 0] or list(np.argsort(-P[i]))
            if best[i] in parts:   # the decoded part first
                o = [parts.index(best[i])] + [k for k in o if parts[k] != best[i]]
            out.append({"part": [{"part": parts[k], "p": round(float(P2[i, k]), 4)} for k in o[:top]], "conf": round(float(P2[i, parts.index(best[i])]), 4),
                        "auto": i not in named and float(P2[i, parts.index(best[i])]) >= GATE_PART, "who": None, "who_by": None, "named": i in named})
        if len(masks) >= 2 and self._bodies(out, best, parts, masks, F, grid, aspect, hists, whos, bgr, key):
            pass
        elif whos and len(masks) >= 2 and ft["hist"] is not None:
            r = split_two(who_matrix(ft, WHO_USE, WHO_W), best)
            if r is not None:
                lab = r[0]
                for i, w in enumerate(propagate_who(lab, whos)):
                    if i not in whos:
                        out[i]["who"], out[i]["who_by"] = w, "split" if w else None
        for i, w in whos.items():
            out[i]["who"], out[i]["who_by"] = w, "given"
        return out

    @staticmethod
    def _bodies(out, best, parts, masks, F, grid, aspect, hists, whos, bgr, key):
        """paw-svnz: who by bodies first, then roles (partlabel.assign_bodies) over the blobs that have a part (the owner's, else the decoded
        guess): fills each unnamed blob's who / who_by / who_conf. False when it does not apply (the appearance split then answers)."""
        from pawtrack import partlabel
        idx = [i for i in range(len(masks)) if best[i] in parts]
        if len(idx) < 2:
            return False
        gs = [{"name": best[i], "_mask": masks[i], "score": out[i]["conf"] or 1.0} for i in idx]
        try:
            res, rec = partlabel.assign_bodies(gs, aspect, bgr, (F, grid), key, {k: whos[i] for k, i in enumerate(idx) if i in (whos or {})},
                                               hists=[hists[i] for i in idx] if hists is not None else None)
        except Exception:
            return False
        if res is None:
            return False
        for k, i in enumerate(idx):
            if i not in (whos or {}):
                out[i].update({"who": res[k]["who"], "who_by": res[k]["who_by"], "who_conf": res[k]["who_conf"], "bodies": rec["bodies"]})
        for i, w in (whos or {}).items():
            out[i].update({"who": w, "who_by": "given", "who_conf": 1.0})
        return True

    @staticmethod
    def blank(n, why):
        """The answer when there is no usable model (or no features): every blob unknown, with the reason."""
        return [{"part": [], "conf": 0.0, "auto": False, "who": None, "who_by": None, "named": False} for _ in range(n)]


# ------------------------------------------------------------------ who v2: a learned "same character" pair model + joint split
def pair_features(ft, P, aspect=1.0):
    """All blob pairs of one picture -> (idx (m, 2), X (m, d)): similarity scalars (region / ring / cross cosines, colour overlap,
    position, size), the soft same-part indicators (a non-paired part twice = two characters) and the element-wise product of the two
    region features (a learned diagonal metric: which feature dimensions say 'same character'). P (n, K) part probabilities
    (one-hot when the owner named them) with PAIRED / non-paired split by `paired_mask` (K,)."""
    n = len(ft["pool"])
    idx = np.array([(i, j) for i in range(n) for j in range(i + 1, n)], np.int32).reshape(-1, 2)
    if not len(idx):
        return idx, np.zeros((0, 1), np.float32)
    a, b = idx[:, 0], idx[:, 1]
    pool, ring, cen, geo = ft["pool"], ft["ring"], ft["cen"], ft["geo"]
    dx = (cen[a, 0] - cen[b, 0]) * aspect
    dy = cen[a, 1] - cen[b, 1]
    same = (P[a] * P[b])
    sc = np.stack([(pool[a] * pool[b]).sum(1), (ring[a] * ring[b]).sum(1), (pool[a] * ring[b]).sum(1), (pool[b] * ring[a]).sum(1),
                   (ft["hist"][a] * ft["hist"][b]).sum(1) if ft.get("hist") is not None else np.zeros(len(a)),
                   np.abs(dx), np.abs(dy), np.hypot(dx, dy), np.abs(geo[a, 0] - geo[b, 0]),
                   same[:, NONPAIRED_MASK].sum(1), same[:, PAIRED_MASK].sum(1),
                   ft["gap"][a, b], np.log(ft["gap"][a, b] + 0.01), (ft["gap"][a, b] < 0.005).astype(np.float32)], 1)
    K = P.shape[1]
    tab = (P[a][:, :, None] * P[b][:, None, :])
    tab = (tab + tab.transpose(0, 2, 1)).reshape(len(a), K * K)[:, np.triu_indices(K)[0] * K + np.triu_indices(K)[1]]
    return idx, np.concatenate([sc * 3.0, pool[a] * pool[b] * 10.0, tab * 3.0], 1).astype(np.float32)


def split_pairs(n, idx, s, fixed=None, parts=None, paired=PAIRED, dup_penalty=4.0):
    """Joint 2-way split maximising the summed pair score: s[m] = logit(same character) of pair idx[m]; same side earns +s/2, other
    side -s/2 (correlation clustering). fixed {i: 0 | 1}: blobs the owner named (their side is given). A non-paired part twice
    on one side costs dup_penalty. Exhaustive for n <= 14, else greedy flips from the best exhaustive-free start.
    -> (labels (n,), margin = best score - score of everything on one side (0 when no pair), second-best-flip margin)."""
    fixed = fixed or {}
    if n < 2:
        return np.zeros(n, int), 0.0
    S = np.zeros((n, n))
    for (i, j), v in zip(idx, s):
        S[i, j] = S[j, i] = v / 2
    parts = parts or [None] * n

    def score(lab):
        same = lab[:, None] == lab[None, :]
        sc = np.triu(np.where(same, S, -S), 1).sum()
        for p in set(parts) - {None} - set(paired):
            for q in (0, 1):
                sc -= dup_penalty * max(0, sum(1 for j in range(n) if parts[j] == p and lab[j] == q) - 1)
        return sc
    free = [i for i in range(n) if i not in fixed]
    best, bl = None, None
    if len(free) <= 14:
        cands = (np.array([fixed[i] if i in fixed else bits[free.index(i)] for i in range(n)]) for bits in itertools.product((0, 1), repeat=len(free)))
    else:
        def climb():
            lab = np.array([fixed.get(i, 0) for i in range(n)])
            cur = score(lab)
            for _ in range(5):
                for i in free:
                    lab[i] ^= 1
                    v = score(lab)
                    if v > cur:
                        cur = v
                    else:
                        lab[i] ^= 1
            yield lab.copy()
        cands = climb()
    for lab in cands:
        v = score(lab)
        if best is None or v > best:
            best, bl = v, lab.copy()
    one = np.array([fixed.get(i, 0) for i in range(n)])
    return bl, float(best - score(one))


# set by the model that knows the part list (autoname.set_parts); module defaults come from the seeder's PARTS
def set_parts(parts, paired=PAIRED):
    global NONPAIRED_MASK, PAIRED_MASK
    PAIRED_MASK = np.array([p in paired for p in parts])
    NONPAIRED_MASK = ~PAIRED_MASK


NONPAIRED_MASK = PAIRED_MASK = None
