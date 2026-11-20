"""Bodies first, then roles (paw-svnz): WHICH CHARACTER a part belongs to.

A character has exactly one head, one torso, one tail, one pair of hips ..., so the parts of a picture are divided between the
characters with those capacities, never `head 2` on one of them:
  1. units     parts that are halves of one thing (touching / the other half behind something) are ONE unit;
  2. anchors   the characters = the distinct heads (else torsos, hips, tail); one anchor = one character (solo);
  3. bodies    SAM's whole-object mask from each anchor (positive: its interior point; negative: the other's), the overlap of the
               two split by the distance to each anchor; internal, never a proposal or a label;
  4. assign    every unit to a body with the capacities (unpaired part: one per body, paired: two) solved jointly: cost = share of
               the unit outside the body + distance to the body + appearance unlike the body's anchor; exhaustive (<= 14 units);
  5. roles     which body is Bottom (c1, receiving or alone) learned from body-level cues (Role: a ridge logistic regression on
               antisymmetric differences of the two bodies' cues), the left-head rule only as the fallback.
Pure numpy / scipy / cv2; SAM comes in as a callable, so everything is testable on synthetic layouts.
"""
import itertools
import json
import os

import numpy as np

PAIRED = ("shoulder", "forearm", "hand", "thighs", "shin", "paws")   # = partlabel.PAIRED (test/groups-vocab.test.mjs)
ANCHOR_PARTS = ("head", "torso", "hips", "tail", "penis", "balls", "knot", "sheath")   # in this order; a doubled one founds the second character
MERGE_GAP = 4          # px on the working grid (320 wide): blobs of one part this close are one unit (tidy.MERGE_GAP)
BODY_MAX = 0.85        # a body mask covering more of the picture than this is the whole scene, not a character
W_OV, W_DIST, W_APP = 1.0, 2.0, 0.5   # the assignment cost: outside share, distance (picture width), appearance (1 - cos)
BIG = 1e3              # a capacity violation
VERSION = 1
GATE = 0.95            # who confidence at which the app may apply the sidecar's who by itself: no way of naming measured held-out reaches it (RESULTS.md, paw-svnz)
SOLO_CONF = 0.87       # one body = Bottom: right for 0.873 of the blobs of the owner's pictures that show one character (painted masks)
LEFT_CONF = 0.5        # the left-head rule on two bodies: 0.53 of the blobs / 0.48 of the pictures held out, i.e. chance (the old 0.745 was on a different split)


# ------------------------------------------------------------------ units and anchors
def _gap(a, b):
    from pawtrack import tidy
    return tidy.gap(a, b)


def units(parts):
    """parts [{part, mask (bool, h, w), score?, feat?, hist?}] -> [{part, ids, mask, score, feat, hist}]: blobs of one UNPAIRED part
    that touch (gap <= MERGE_GAP) or are the two halves of one thing (tidy.other_half: both score well, near, something between)
    are one unit; everything else is its own unit."""
    from pawtrack import tidy
    n = len(parts)
    root = list(range(n))

    def find(i):
        while root[i] != i:
            root[i] = root[root[i]]
            i = root[i]
        return i
    ms = [np.asarray(p["mask"], bool) for p in parts]
    for i, j in itertools.combinations(range(n), 2):
        if parts[i]["part"] != parts[j]["part"] or parts[i]["part"] in PAIRED or parts[i]["part"] == "head":   # two heads are two characters, whatever lies between
            continue
        near = _gap(ms[i], ms[j]) <= MERGE_GAP
        if not near:
            a = {"score": parts[i].get("score", 1.0), "_mask": ms[i]}
            b = {"score": parts[j].get("score", 1.0), "_mask": ms[j]}
            others = [ms[k] for k in range(n) if parts[k]["part"] != parts[i]["part"]]
            near = tidy.other_half(a, b, others)
        if near:
            root[find(i)] = find(j)
    out = {}
    for i in range(n):
        out.setdefault(find(i), []).append(i)
    us = []
    for ids in out.values():
        m = np.any([ms[i] for i in ids], 0)
        u = {"part": parts[ids[0]]["part"], "ids": ids, "mask": m, "score": max(parts[i].get("score", 1.0) for i in ids)}
        for k in ("feat", "hist"):
            v = [parts[i][k] for i in ids if parts[i].get(k) is not None]
            u[k] = (lambda x: x / max(float(np.linalg.norm(x)), 1e-6))(np.mean(v, 0)) if v else None
        us.append(u)
    return us


def centre(m):
    ys, xs = np.nonzero(m)
    h, w = m.shape
    return ((xs.mean() + .5) / w, (ys.mean() + .5) / h) if len(xs) else (0.5, 0.5)


def interior(m):
    """The deepest point of a mask (normalized x, y): where SAM is asked about it."""
    from scipy.ndimage import distance_transform_edt
    d = distance_transform_edt(m)
    y, x = np.unravel_index(int(np.argmax(d)), d.shape)
    return ((x + .5) / m.shape[1], (y + .5) / m.shape[0])


def anchors(us, aspect=1.0):
    """The characters of a picture as anchor unit sets: [[unit idx, ...], ...]. Two heads (else torsos, hips, tail) = two characters;
    one head and a doubled torso / hips / tail: the nearer one joins the head, the other founds the second character; no doubled
    anchor part = ONE character ([[]]: everything). More than two of an anchor part -> None (not a two-character picture: the caller
    keeps its old split; never an invented Extra)."""
    by = {p: sorted([i for i, u in enumerate(us) if u["part"] == p], key=lambda i: -us[i]["score"]) for p in ANCHOR_PARTS}
    if any(len(by[p]) > 2 for p in ANCHOR_PARTS[:4]):
        return None
    if len(by["head"]) == 2:
        return [[by["head"][0]], [by["head"][1]]]
    for p in ANCHOR_PARTS[1:]:
        if len(by[p]) == 2:
            a, b = by[p]
            if by["head"]:
                h = centre(us[by["head"][0]]["mask"])
                d = lambda i: np.hypot((centre(us[i]["mask"])[0] - h[0]) * aspect, centre(us[i]["mask"])[1] - h[1])
                a, b = (a, b) if d(a) <= d(b) else (b, a)
                return [[by["head"][0], a], [b]]
            return [[a], [b]]
    return [[]]


# ------------------------------------------------------------------ bodies (SAM, internal)
def body_mask(cov, scores, pos, neg, pick="largest"):
    """SAM's candidates cov (k, h, w) coverage -> the whole-object mask: of those holding every positive, none of the negatives and
    covering <= BODY_MAX of the picture, the largest ('largest') or the best scoring ('score'); None when no candidate is valid."""
    best = None
    h, w = cov.shape[1:]
    at = lambda m, p: m[min(h - 1, int(p[1] * h)), min(w - 1, int(p[0] * w))]
    for k in range(len(cov)):
        m = cov[k] >= 0.5
        if not m.any() or m.mean() > BODY_MAX or not all(at(m, p) for p in pos) or any(at(m, p) for p in neg):
            continue
        key = float(m.sum()) if pick == "largest" else float(scores[k])
        if best is None or key > best[0]:
            best = (key, m)
    return None if best is None else best[1]


def bodies(us, sets, sam, pick="largest"):
    """Anchor sets -> [bool mask (h, w) | None] one per set, the overlap of two bodies split by the distance to each one's anchor
    units. sam(points (n, 2) normalized, labels (n,)) -> (coverage (k, h, w), scores (k,)). A single set has no body (None)."""
    if len(sets) < 2 or not all(sets):
        return [None] * len(sets)
    pts = [[interior(us[i]["mask"]) for i in s] for s in sets]
    out = []
    for k, s in enumerate(sets):
        pos, neg = pts[k], [p for j, q in enumerate(pts) if j != k for p in q]
        cov, sc = sam(np.array(pos + neg, np.float32), np.array([1] * len(pos) + [0] * len(neg), np.int32))
        out.append(body_mask(np.asarray(cov), sc, pos, neg, pick))
    if out[0] is not None and out[1] is not None:
        both = out[0] & out[1]
        if both.any():
            from scipy.ndimage import distance_transform_edt
            d = [distance_transform_edt(~np.any([us[i]["mask"] for i in s], 0)) for s in sets]
            near0 = d[0] <= d[1]
            out = [out[0] & ~(both & ~near0), out[1] & ~(both & near0)]
    return out


# ------------------------------------------------------------------ joint assignment
def cost_matrix(us, sets, bods, aspect=1.0, w=(W_OV, W_DIST, W_APP)):
    """(n_units, n_bodies) cost of a unit being on a body: share outside the body mask (1 without a body: then distance and appearance
    decide), distance of its centre to the body's anchor centre (x true aspect, picture heights), 1 - cos of its feature (and colour)
    to the anchors' mean. Anchor units cost 0 on their own body and BIG on the other."""
    n, nb = len(us), len(sets)
    C = np.zeros((n, nb))
    anc = [[us[i] for i in s] for s in sets]
    cen = np.array([centre(u["mask"]) for u in us])
    for k in range(nb):
        ac = np.mean([centre(a["mask"]) for a in anc[k]], 0) if anc[k] else cen.mean(0)
        for i, u in enumerate(us):
            ov = 1.0 if bods[k] is None else 1.0 - float((u["mask"] & bods[k]).sum()) / max(float(u["mask"].sum()), 1.0)
            d = float(np.hypot((cen[i, 0] - ac[0]) * aspect, cen[i, 1] - ac[1]))
            app = []
            for key in ("feat", "hist"):
                ref = [a[key] for a in anc[k] if a.get(key) is not None]
                if ref and u.get(key) is not None:
                    r = np.mean(ref, 0)
                    app.append(1.0 - float(u[key] @ r) / max(float(np.linalg.norm(r)), 1e-6))
            C[i, k] = w[0] * ov + w[1] * d + w[2] * (np.mean(app) if app else 0.0)
    for k, s in enumerate(sets):
        for i in s:
            C[i] = BIG
            C[i, k] = 0.0
    return C


def assign(us, C, caps=True):
    """Joint assignment of the units to the two bodies of cost matrix C (n, 2) under the capacities: one unit of an unpaired part and two
    blobs of a paired part per body (a violation costs BIG). The capacities only couple the units of one part, so each part is solved
    exhaustively on its own (<= 2^m options, m = its units) and the sum is the joint optimum. -> (labels (n,) in {0, 1}, margin (n,):
    the extra cost of moving only that unit, 0 = it could as well be on the other body)."""
    n = len(us)
    lab, marg = np.zeros(n, int), np.zeros(n)
    for p in {u["part"] for u in us}:
        ix = [i for i, u in enumerate(us) if u["part"] == p]
        m = len(ix)
        if m > 12:   # a doubled-up part of this size is not one character's: nearest body each (no capacity)
            for i in ix:
                lab[i], marg[i] = int(C[i, 1] < C[i, 0]), abs(C[i, 0] - C[i, 1])
            continue
        bits = ((np.arange(2 ** m)[:, None] >> np.arange(m)[None, :]) & 1).astype(np.int8)
        tot = C[np.array(ix)[None, :], bits].sum(1)
        if caps:
            cap = 2 if p in PAIRED else 1
            w = np.array([len(us[i]["ids"]) for i in ix])
            for q in (0, 1):
                tot = tot + BIG * np.maximum(0, ((bits == q) * w).sum(1) - cap)
        b = int(np.argmin(tot))
        for j, i in enumerate(ix):
            lab[i] = bits[b, j]
            marg[i] = float(tot[bits[:, j] != bits[b, j]].min() - tot[b])
    return lab, marg


def refine(us, sets, bods, lab, aspect=1.0, rounds=2, w=(W_OV, W_DIST, W_APP)):
    """Re-solve with each body's reference (centre, appearance) = ALL the units currently on it, not only its anchors."""
    C = cost_matrix(us, sets, bods, aspect, w)
    lab, marg = assign(us, C)
    for _ in range(rounds):
        sets2 = [[i for i in range(len(us)) if lab[i] == k] or sets[k] for k in (0, 1)]
        C = cost_matrix(us, sets2, bods, aspect, w)
        for k, s in enumerate(sets):   # the anchors stay put
            for i in s:
                C[i] = BIG
                C[i, k] = 0.0
        new, marg = assign(us, C)
        if (new == lab).all():
            break
        lab = new
    return lab, marg


# ------------------------------------------------------------------ roles
CUES = ("dx", "dy", "penis", "balls", "reach", "reachany", "rear", "area", "n")
USE = ("reach", "reachany", "penis")   # what the shipped Role looks at (the probe: LOO over the owner's pictures)


def _body_cues(us, mine, other, aspect):
    """The cues of one body (unit indices `mine`) against the other (`other`): where it is (head x, else the parts' mean), how low,
    penis / knot present, balls present, how close its penis lies to the other's hips / thighs / tail (0 none .. 1 touching), whether its
    own hips lie toward the other body from its head (its rear presented), its parts' area, how many parts."""
    P = lambda ix, names: [us[i] for i in ix if us[i]["part"] in names]
    cen = lambda ix: np.mean([centre(us[i]["mask"]) for i in ix], 0) if ix else np.array([0.5, 0.5])
    head = P(mine, ("head",))
    mc, oc = cen(mine), cen(other)
    mx = centre(head[0]["mask"])[0] if head else mc[0]
    ohead = P(other, ("head",))
    ox = centre(ohead[0]["mask"])[0] if ohead else oc[0]
    pen = P(mine, ("penis", "knot"))
    rear = [u["mask"] for u in P(other, ("hips", "thighs", "tail"))]
    reach = reachany = 0.0
    if pen:
        pm = np.any([u["mask"] for u in pen], 0)
        if rear:
            reach = float(np.exp(-_gap(pm, np.any(rear, 0)) / (0.1 * pm.shape[1])))
        if other:
            reachany = float(np.exp(-_gap(pm, np.any([us[i]["mask"] for i in other], 0)) / (0.1 * pm.shape[1])))
    hips = P(mine, ("hips",))
    toward = 0.0
    if hips and head:
        toward = float(np.clip((centre(hips[0]["mask"])[0] - centre(head[0]["mask"])[0]) * aspect * np.sign(ox - mx) * 4, -1, 1))
    return np.array([mx * aspect, mc[1], float(bool(pen)), float(bool(P(mine, ("balls",)))), reach, reachany, toward,
                     float(sum(u["mask"].mean() for u in (us[i] for i in mine))), float(len(mine))])


def role_cues(us, lab, aspect=1.0):
    """The antisymmetric cue vector d = cues(body 0) - cues(body 1) of a two-body split (lab (n,) in {0, 1}), len(CUES)."""
    a = [i for i in range(len(us)) if lab[i] == 0]
    b = [i for i in range(len(us)) if lab[i] == 1]
    if not a or not b:
        return np.zeros(len(CUES))
    return _body_cues(us, a, b, aspect) - _body_cues(us, b, a, aspect)


class Role:
    """Which of two bodies is Bottom: p(body 0 is Bottom) = sigmoid(w . (d - 0) / sd), a ridge logistic regression with no intercept on the
    cue differences (antisymmetric by construction: swapping the bodies negates d). Saved beside the head (role.json, fingerprinted with the
    labels it trained on); a stale or missing one answers None and the caller falls back to the left-head rule."""

    def __init__(self, w=None, sd=None, info=None):
        self.w = np.zeros(len(CUES)) if w is None else np.asarray(w, float)
        self.sd = np.ones(len(CUES)) if sd is None else np.asarray(sd, float)
        self.info = info or {}

    @classmethod
    def fit(cls, D, y, wd=0.3, info=None, steps=200, use=USE):
        """D (m, len(CUES)) cue differences, y (m,) 1 = body 0 is Bottom. Both orders are added (D, y), (-D, 1 - y). Only the cues in `use`
        count (the others get weight 0)."""
        D = np.asarray(D, float) * np.array([c in use for c in CUES], float)
        y = np.asarray(y, float)
        D2, y2 = np.r_[D, -D], np.r_[y, 1 - y]
        sd = D2.std(0)
        sd = np.where(sd < 1e-6, 1.0, sd)
        keep = np.array([c in use for c in CUES], float)
        X = D2 / sd
        w = np.zeros(X.shape[1])
        ridge = np.where(keep > 0, 1.0, 1e6)   # a cue not in use is pinned at 0
        for _ in range(steps):   # Newton on the ridge-penalised logistic loss (tiny: a few dozen pictures)
            p = 1 / (1 + np.exp(-X @ w))
            g = X.T @ (p - y2) / len(X) + wd * ridge * w / len(X) * 10
            H = (X.T * (p * (1 - p))) @ X / len(X) + np.diag(wd * ridge / len(X) * 10) + 1e-6 * np.eye(X.shape[1])
            w = w - np.linalg.solve(H, g)
        return cls(w, sd, {**(info or {}), "n": int(len(D))})

    def p_first_bottom(self, d):
        return float(1 / (1 + np.exp(-(np.asarray(d, float) / self.sd) @ self.w)))

    def save(self, folder):
        os.makedirs(folder, exist_ok=True)
        fn = os.path.join(folder, "role.json")
        with open(fn + ".tmp", "w", encoding="utf-8") as fh:
            json.dump({"version": VERSION, "cues": list(CUES), "w": self.w.tolist(), "sd": self.sd.tolist(), "info": self.info}, fh)
        os.replace(fn + ".tmp", fn)

    @classmethod
    def load(cls, folder, fingerprint=None):
        fn = os.path.join(folder or "", "role.json")
        try:
            z = json.load(open(fn, encoding="utf-8"))
        except (OSError, ValueError):
            return None
        if z.get("version") != VERSION or z.get("cues") != list(CUES) or (fingerprint is not None and z["info"].get("fingerprint") != fingerprint):
            return None
        return cls(z["w"], z["sd"], z["info"])


def left_first(us, lab, aspect=1.0):
    """The old rule as a probability: 1.0 when body 0's head (else the mean of its parts) is further left than body 1's, else 0.0."""
    d = role_cues(us, lab, aspect)
    return 1.0 if d[0] < 0 else 0.0


def name(us, lab, role=None, aspect=1.0):
    """The final who for each unit: -> (who list 'c1' | 'c2', by, confidence 0..1). One body: c1 (solo = Bottom), by 'solo'. Two bodies: by 'role'
    when a trained Role answers (measured, not shipped: no better than the rule), else the left-head rule ('left'); confidence = the held-out
    accuracy of how it was decided (SOLO_CONF, LEFT_CONF, the role's probability)."""
    if len(set(lab)) < 2:
        return ["c1"] * len(us), "solo", SOLO_CONF
    p = None
    if role is not None:
        p = role.p_first_bottom(role_cues(us, lab, aspect))
        by = "role"
    if p is None or abs(p - 0.5) < 1e-6:   # no model, or no cue says anything (no penis / rear parts): the old rule decides
        p, by = (0.75 if left_first(us, lab, aspect) else 0.25), "left"
    first = p >= 0.5
    conf = LEFT_CONF if by == "left" else max(p, 1 - p)
    return [("c1" if (l == 0) == first else "c2") for l in lab], by, conf
