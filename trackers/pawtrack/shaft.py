"""Shaft consumption: how much of the penis is inside (PROTOCOL v4.17: `track.groups[].shaft`).

Owner 2026-11-10: "a shaft consumption sam tracker on TOP of seeded grid tracking, so we have an accurate amount of the
penis that is inside". Runs after a points tracker has tracked a scene, for every painted penis group flagged `shaft`:

 1. points()    CPU. The group's tracked members (pts 6th element = its id) on their reference frame (most of them
                visible, nearest the painted frame) give the shaft's axis and its base end: the end nearest the same
                character's balls / sheath / hips, else the end away from the partner's groups, else the end hidden
                least. Per frame a similarity (members' reference -> current positions) carries the base point and the
                axis direction (the timing backbone stays the points).
 2. SAM 2.1     (pulse.sam_stream) on a crop that follows the group (moved every `shaft_reprompt` frames, each chunk
                started from the last one's mask: v4.50), prompted from the points (a fresh box + positives from the
                visible members, negatives at the other groups' members) at the start and whenever the mask drifts off
                the members (under half of them inside it). Optional `shaft_stride`.
 3. measure()   one mask: its principal axis oriented base -> tip, the visible length L from the tracked base point to
                the entry edge (99th percentile of the mask along the axis), the width w (25th percentile of the slice
                widths: a knot does not count), the width profile, holes along the axis, the mask at the crop edge.
 4. inserted()  L / w (zoom and the body coming toward the camera cancel), against the full length: the 90th percentile
                on frames whose tip is free (no receiving partner member within CONTACT_W widths of the entry edge),
                else the largest seen (`relative`: the shaft was never seen fully out). inserted = 1 - L / L_full,
                clamped. Shortening from the base end or a hole in the middle never reads as insertion (L runs from the
                tracked base point to the far end). Confidence = SAM's x no holes x off the crop edge x base end in place
                x not foreshortened (the members' scale along the axis against the width: a shaft turning toward the
                camera shortens without going in) x 0 where a hand / paw / tail sits at the entry edge.
 5. knot        (scene tagged knotting) on frames with the tip free and L near L_full: a bulge (width >= KNOT_RATIO x w)
                in the base 70 % of the profile -> its place along the shaft. Per frame: out / at the entrance / in;
                events at the state changes held >= HOLD frames. On an external view this is the same event knot.py
                finds from a whole-scene sam2_mask run (an area step: the knot's length leaving the visible part); here
                the bulge is located on the shaft instead, so the state is known between events too.
Without SAM (off, missing, failed): fallback() from the points alone: the visible members' reference places along the
shaft; the farthest visible one / the farthest seen = the visible share (coarse: one member spacing; a member the tracker
calls visible on the partner's surface holds it out).

run_scene() -> {"channels": {suffix: per-frame array}, "record", "events"}; cli adds sem_<name>_<suffix> to the rows.
Pure parts (CPU, tested on rendered clips: tests/test_shaft.py): members, sim_fit, frame_axis, measure, inserted, knot,
fallback, shaft_sign, schedule (with a monkeypatched sam_chunk).
"""
import math
import time
from contextlib import closing

import numpy as np

from pawtrack.registry import param

SHAFT_PARAMS = [
    param("shaft_sam", "Shaft: SAM 2.1 (else the points fallback)", "bool", True),
    param("shaft_model", "Shaft: SAM model size", "choice", "small", choices=["tiny", "small", "base_plus", "large"]),
    param("shaft_reprompt", "Shaft: re-prompt from the points every N frames", "int", 48, 8, 600),
    param("shaft_stride", "Shaft: SAM on every Nth frame (interpolated)", "int", 1, 1, 8),
]
BASE_PARTS = ("sheath", "knot", "balls", "hips", "torso", "body")  # the shaft's own character: where its base is (in trust order)
RECEIVE = ("anus", "slit", "hips", "head", "torso", "body", "sheath", "other")  # the partner's parts it goes into / against
OCCLUDE = ("hand", "paws", "tail", "foot", "feet")              # anyone's: at the entry edge = occlusion, never insertion
CONTACT_W = 2.5      # a receiving member within this many shaft widths of the entry edge = the tip is at the partner
OCCLUDE_W = 1.0      # an occluder member this close to the entry edge (and nearer than the partner) = tip hidden
KNOT_RATIO = 1.3     # a slice this many shaft widths wide is the knot bulge
HOLD = 2             # knot state changes must hold this many frames (one drawing on twos)
MIN_PX = 30          # a smaller mask is lost
MIN_MEMBERS = 3      # visible members needed to prompt SAM / judge drift
DEPLETED = 0.7       # a SAM prompt from under this share of the group's most visible members may be too short (bound)
CONF_MIN = 0.5       # frames below this confidence do not set L_full or the sign
# v4.50 sem_<name>_why per frame (paw-4c48.13 / paw-4c48.3): what the reading is. seen: confident; low: a reading under
# CONF_MIN; bound: SAM was prompted from a box over too few of the group's members (DEPLETED) and its mask has not grown
# past that box (may be too short: in_conf <= 0.3); hidden: a hand / paw / tail at the entry edge (in null); few: under
# MIN_MEMBERS members visible and no mask carried here; lost: SAM found no mask or drifted off the members; points: the
# points fallback (no SAM in this pass)
WHY = {"seen": 0, "low": 1, "bound": 2, "hidden": 3, "few": 4, "lost": 5, "points": 6}
CROP_PAD = 0.6       # crop = the members' path + this many full shaft lengths per side ...
CROP_MIN = 0.12      # ... and at least this share of the frame height


# ---------------------------------------------------------------- the points (CPU)

def members(pts_frames, gid, size):
    """pts per frame (overlay `pts` lists | None) -> X (n, m, 2) frame px of the group's members, NaN where hidden,
    absent or not that group (m = every point index that is ever in group gid)."""
    W, H = size
    ids = sorted({i for f in pts_frames if f for i, q in enumerate(f) if len(q) >= 6 and q[5] == gid})
    X = np.full((len(pts_frames), len(ids), 2), np.nan)
    for t, f in enumerate(pts_frames):
        if not f:
            continue
        for j, i in enumerate(ids):
            q = f[i] if i < len(f) else None
            if q is not None and q[2] and len(q) >= 6 and q[5] == gid:
                X[t, j] = (q[0] * W, q[1] * H)
    return X


def sim_fit(A, B):
    """Similarity B ~ z (A - ca) + cb (complex z = scale x rotation), least squares, refit once without the members
    whose residual is over 3 x the median. A, B (k, 2), k >= 2 -> (z, ca, cb) | None."""
    def fit(a, b):
        ca, cb = a.mean(0), b.mean(0)
        za, zb = (a - ca) @ [1, 1j], (b - cb) @ [1, 1j]
        den = float((np.abs(za) ** 2).sum())
        return None if den < 1e-9 else ((np.conj(za) * zb).sum() / den, ca, cb)
    if len(A) < 2:
        return None
    T = fit(A, B)
    if T is None or len(A) < 4:
        return T
    r = np.abs(apply(T, A) - B).sum(1)
    keep = r <= max(3 * np.median(r), 1.0)
    return fit(A[keep], B[keep]) if keep.sum() >= 2 else T


def apply(T, P):
    z, ca, cb = T
    q = (np.asarray(P, float) - ca) @ [1, 1j] * z
    return np.stack([q.real + cb[0], q.imag + cb[1]], -1)


def centroid_at(X, t):
    """The visible members' centre on frame t, else on the nearest frame with any visible -> (2,) | None."""
    ok = np.isfinite(X[:, :, 0]).any(1)
    if not ok.any():
        return None
    k = np.flatnonzero(ok)
    k = k[np.argmin(np.abs(k - t))]
    return np.nanmean(X[k], 0)


def frame_axis(X, seed, own=(), partner=(), partner_first=False):
    """The shaft's reference geometry from its members X (members()), seed = the painted frame's index; own / partner =
    member arrays of the same character's base parts / the partner's groups. -> {r (reference frame), base (px on r),
    u (unit, base -> tip on r), length (members' extent along u on r, px), s01 (m,) each member's place 0 base .. 1 tip
    (NaN: not visible on r), why (how the base end was chosen)} | None (under MIN_MEMBERS visible anywhere).
    partner_first (v4.52, a depth part): the base is the end away from the partner first, then the own parts."""
    vis = np.isfinite(X[:, :, 0])
    cnt = vis.sum(1)
    if not len(cnt) or cnt.max() < MIN_MEMBERS:
        return None
    good = np.flatnonzero(cnt >= 0.9 * cnt.max())
    r = int(good[np.argmin(np.abs(good - seed))])
    P = X[r][vis[r]]
    c = P.mean(0)
    u = np.linalg.eigh(np.cov(P.T))[1][:, 1]
    s = (X[r] - c) @ u
    lo, hi = np.nanmin(s), np.nanmax(s)
    ends = [c + lo * u, c + hi * u]
    sign, why = 0, ""
    # paw-4c48.7: the first own part (own is in BASE_PARTS order: sheath > knot > balls > hips > torso) whose centre is
    # clearly nearer one end (by over 15 %) decides; the mean of all of them was pulled toward the torso (the base read at
    # the tip on the owner's riding shot)
    for o in ([] if partner_first and any(centroid_at(o, r) is not None for o in partner) else own):
        q = centroid_at(o, r)
        if q is None:
            continue
        d0, d1 = np.linalg.norm(q - ends[0]), np.linalg.norm(q - ends[1])
        if abs(d0 - d1) > 0.15 * max(d0, d1):
            sign, why = (1 if d0 < d1 else -1), "own"
            break
    pc = [q for q in (centroid_at(o, r) for o in partner) if q is not None]
    if sign:
        pass
    elif pc:
        q = np.mean(pc, 0)
        sign, why = (1 if np.linalg.norm(q - ends[1]) <= np.linalg.norm(q - ends[0]) else -1), "partner"
    else:  # the entry end is the one hidden more often
        w = (s - lo) / max(hi - lo, 1e-9)
        hid = (~vis).mean(0)
        top, bot = np.nanmean(np.where(w > 0.75, hid, np.nan)), np.nanmean(np.where(w < 0.25, hid, np.nan))
        sign, why = (1 if not top < bot else -1), "hidden"
    if sign < 0:
        u, s, lo, hi = -u, -s, -hi, -lo
    return {"r": r, "base": c + lo * u, "u": u, "length": float(hi - lo), "s01": (s - lo) / max(hi - lo, 1e-9), "why": why}


def refine_axis(X, ax, masks, T):
    """paw-4c48.7: the reference axis from SAM's outlines of the (nearly) whole shaft: on frames with >= 90 % of the most
    visible members, each mask's principal direction turned back into the reference frame by that frame's similarity;
    their doubled-angle mean (a line), when coherent (resultant >= 0.5 over >= 3 frames) and within 60 deg of the members'
    own axis (oriented like it). A fat painted region's principal direction is weak; the out shaft's outline is not.
    -> ax with u / base / length / s01 recomputed on the reference frame, or ax unchanged."""
    vis = np.isfinite(X[:, :, 0])
    cnt = vis.sum(1)
    acc, k, angs = 0j, 0, []
    for i, mk in enumerate(masks):
        if mk is None or T[i] is None or cnt[i] < 0.9 * cnt.max():
            continue
        ys, xs = np.nonzero(mk[0])
        if len(xs) < MIN_PX:
            continue
        P = np.stack([xs, ys], 1).astype(float)
        d = np.linalg.eigh(np.cov(P.T))[1][:, 1]
        a = math.atan2(d[1], d[0]) - float(np.angle(T[i][0]))
        acc += np.exp(2j * a)
        angs.append(a)
        k += 1
    if k < 3 or abs(acc) < 0.5 * k:
        return ax
    th0 = 0.5 * float(np.angle(acc))   # the doubled-angle mean, then the median of the lines around it (a leaky mask does not pull it)
    th = th0 + float(np.median([(a - th0 + math.pi / 2) % math.pi - math.pi / 2 for a in angs]))
    u = np.array([math.cos(th), math.sin(th)])
    if abs(u @ ax["u"]) < 0.5:
        return ax
    if u @ ax["u"] < 0:
        u = -u
    r = ax["r"]
    P = X[r][vis[r]]
    c = P.mean(0)
    s = (X[r] - c) @ u
    lo, hi = np.nanmin(s), np.nanmax(s)
    return {**ax, "u": u, "base": c + lo * u, "length": float(hi - lo), "s01": (s - lo) / max(hi - lo, 1e-9), "refined": True}


def despike(a, win=2, lim_deg=15.0):
    """Angles a (radians, NaN = none) -> a copy where each one further than lim_deg from the median of its +-win finite
    neighbours (unwrapped against it) is that median (a rotation glitch of a frame or two)."""
    a = np.asarray(a, float)
    out, idx = a.copy(), np.flatnonzero(np.isfinite(a))
    lim = math.radians(lim_deg)
    wrap = lambda x: (x + math.pi) % (2 * math.pi) - math.pi
    for q, i in enumerate(idx):
        w = [a[i] + wrap(a[j] - a[i]) for j in idx[max(0, q - win):q + win + 1]]
        m = float(np.median(w))
        if abs(wrap(a[i] - m)) > lim:
            out[i] = wrap(m)
    return out


def transforms(X, ax):
    """Per frame the similarity from the reference frame's members to that frame's (sim_fit), held over frames with
    fewer than two shared members. -> (list of T | None, held bool per frame)."""
    ref = X[ax["r"]]
    out, held, last = [], np.zeros(len(X), bool), None
    for t in range(len(X)):
        ok = np.isfinite(ref[:, 0]) & np.isfinite(X[t, :, 0])
        T = sim_fit(ref[ok], X[t][ok]) if ok.sum() >= 2 else None
        if T is None:
            T, held[t] = last, True
        out.append(T)
        last = T
    first = next((T for T in out if T is not None), None)  # frames before the first fit: the first one
    return [T if T is not None else first for T in out], held


def fallback(X, ax):
    """Points only: per frame the farthest visible member's reference place (s01) -> (inserted, conf). inserted =
    1 - ext / (90th percentile of ext); conf = the share of hidden members that are hidden from the tip end (beyond
    the farthest visible: a hole below it is a hand, not the partner) x min(1, visible / MIN_MEMBERS)."""
    s01 = ax["s01"]
    known = np.isfinite(s01)
    n = len(X)
    ext, conf = np.full(n, np.nan), np.zeros(n)
    for t in range(n):
        vis = known & np.isfinite(X[t, :, 0])
        if not vis.any():
            continue
        e = float(s01[vis].max())
        hid = known & ~vis
        bad = hid & (s01 < e - 0.05)
        ext[t] = e
        conf[t] = (1 - bad.sum() / max(1, hid.sum())) * min(1.0, vis.sum() / MIN_MEMBERS)
    full = np.nanpercentile(ext, 90) if np.isfinite(ext).any() else np.nan
    ins = np.clip(1 - ext / full, 0, 1) if full > 0 else np.full(n, np.nan)
    return ins, conf, ext / full if full > 0 else ext


# ---------------------------------------------------------------- one mask (CPU)

def measure(mask, base, u_hint):
    """bool mask (h, w), base (px, the tracked base point), u_hint (unit, base -> tip) -> {L (px, base point to the entry
    edge along the axis), w (shaft width px), u, entry (px), prof (slice widths / w, base -> entry, slices of w / 2),
    holes (share of empty slices between the first and the last), gap (where the mask starts, share of L: > 0.2 = the
    base end is hidden), edge (mask on the crop border), area} | None (lost)."""
    ys, xs = np.nonzero(mask)
    if len(xs) < MIN_PX:
        return None
    P = np.stack([xs, ys], 1).astype(float)
    # paw-4c48.7: always along the tracked axis. The mask's own principal axis was taken whenever it was within 45 deg of
    # it; a mask that takes in the balls or the partner at depth tilts it 15-30 deg once per stroke (the owner's "the
    # shaft glitches about"). The tracked axis is the reference axis (refined from the masks, run_scene) carried rigidly.
    u = np.asarray(u_hint, float)
    d = P - base
    s, a = d @ u, d @ [-u[1], u[0]]
    L = float(np.percentile(s, 99))
    if L <= 2:
        return None
    w0 = max(2.0, len(xs) / max(L - max(0.0, float(np.percentile(s, 1))), 1.0))  # mean width: the slice length
    dl = max(1.0, w0 / 2)
    nb = int(math.ceil(L / dl))
    k = np.clip((s / dl).astype(int), 0, nb - 1)
    inside = (s >= 0) & (s <= L)
    hi, lo = np.full(nb, -np.inf), np.full(nb, np.inf)
    np.maximum.at(hi, k[inside], a[inside])
    np.minimum.at(lo, k[inside], a[inside])
    wid = np.where(hi >= lo, hi - lo + 1, 0.0)
    nz = np.flatnonzero(wid > 0)
    if not len(nz):
        return None
    w = float(np.percentile(wid[nz], 25))
    span = wid[nz[0]:nz[-1] + 1]
    h_, w_ = mask.shape
    edge = bool(mask[0].any() or mask[-1].any() or mask[:, 0].any() or mask[:, -1].any())
    start = float(np.percentile(s, 1))
    return {"L": L, "w": w, "u": u, "entry": base + L * u, "prof": wid / max(w, 1e-9), "dl": dl,
            "holes": float((span == 0).mean()), "gap": max(0.0, start) / L, "start": start, "edge": edge,
            "area": float(len(xs))}


def knot_place(meas, lfull):
    """The knot's place along the shaft in widths from the base: on frames whose L is within 15 % of the full length
    (the base 70 % is outside then, inserted or not), the bulge (slices >= KNOT_RATIO x w) in the base 70 % of the
    profile; the median over those frames. -> {at, half} (widths) | None (under two frames show one)."""
    at, half = [], []
    for m in meas:
        if m is None or m["L"] / m["w"] < 0.85 * lfull:
            continue
        p, step = m["prof"], m["dl"] / m["w"]
        cut = max(2, int(0.7 * len(p)))
        big = np.flatnonzero(p[:cut] >= KNOT_RATIO)
        if len(big) >= 2:
            at.append((big[0] + big[-1] + 1) / 2 * step)
            half.append((big[-1] - big[0] + 1) / 2 * step)
    return {"at": float(np.median(at)), "half": float(np.median(half))} if len(at) >= 2 else None


def knot_states(ln, knot):
    """Visible length in widths per frame (NaN = unknown) + knot_place() -> state per frame: 0 out (the whole bulge is
    outside the entry edge), 0.5 at the entrance, 1 in; NaN unknown."""
    ln = np.asarray(ln, float)
    st = np.where(ln > knot["at"] + knot["half"], 0.0, np.where(ln < knot["at"] - knot["half"], 1.0, 0.5))
    st[~np.isfinite(ln)] = np.nan
    return st


def knot_events(t, st, hold=HOLD):
    """Knot state per frame -> [{t_ms, dir in | out}]: in = the first frame of a run of `in` that holds >= hold frames
    after a run of out / at; out = the reverse (the pop)."""
    out, cur, run_s, run_n = [], None, None, 0
    for i, x in enumerate(st):
        if not np.isfinite(x):
            continue
        s = "in" if x == 1 else "out" if x == 0 else None
        if s is None:
            continue
        if s == run_s:
            run_n += 1
        else:
            run_s, run_n, start = s, 1, i
        if run_n == hold and s != cur:
            if cur is not None:
                out.append({"t_ms": int(t[start]), "dir": s})
            cur = s
    return out


# ---------------------------------------------------------------- the series (CPU)

def _medfilt(x, k):
    from scipy.ndimage import median_filter
    from pawtrack.pulse import _fill
    ok = np.isfinite(x)
    if ok.sum() < 2:
        return x
    return median_filter(_fill(x), size=max(1, k | 1), mode="nearest")


def nearest(Q, P):
    """Distance from point Q to the nearest of P (k, 2) (NaN rows ignored) -> float (inf if none)."""
    P = P[np.isfinite(P[:, 0])] if len(P) else P
    return float(np.min(np.linalg.norm(P - Q, axis=1))) if len(P) else math.inf


def mask_axis(mask, away=None):
    """A mask-only shaft (v4.39, no tracked points): its principal axis and base end. away (px, the receiving region's
    centre) -> the base is the axis end farther from it; None -> the end nearer the mask's own centroid of the frame's
    border pixels it touches (a shaft entering from off screen has its base there), else the lower end. -> (base px,
    u unit base -> tip) | None (lost)."""
    ys, xs = np.nonzero(mask)
    if len(xs) < MIN_PX:
        return None
    P = np.stack([xs, ys], 1).astype(float)
    c = P.mean(0)
    u = np.linalg.eigh(np.cov(P.T))[1][:, 1]
    s = (P - c) @ u
    ends = [c + s.min() * u, c + s.max() * u]
    if away is not None and np.isfinite(away).all():
        k = int(np.linalg.norm(ends[0] - away) < np.linalg.norm(ends[1] - away))   # the end nearer `away` is the tip
    else:
        h, w = mask.shape
        rim = (xs <= 0) | (ys <= 0) | (xs >= w - 1) | (ys >= h - 1)
        q = P[rim].mean(0) if rim.any() else np.array([c[0], h])
        k = int(np.linalg.norm(ends[0] - q) > np.linalg.norm(ends[1] - q))
    base = ends[k]
    tip = ends[1 - k]
    v = tip - base
    return base, v / max(np.linalg.norm(v), 1e-9)


def inserted(meas, sam_conf, partner, occluders, fore, fps, calib=None, contact=None):
    """Per-frame measures (measure() | None) -> {in, conf, len (L / L_full), ln (L / w), free, lfull, relative}.
    partner / occluders: per frame (k, 2) px of the receiving partner's / the occluding parts' visible members (or
    None per frame: none in the scene); fore (n,): the members' along-axis scale over the width scale (1 = flat on);
    calib {out: frame index, hilt: frame index}? the owner's marks. contact (n,) (v4.39, a mask-only shaft): the
    distance from the entry edge to the receiving region's mask per frame (same units as L / w; NaN = unknown) in place
    of `partner` (no occluders then)."""
    n = len(meas)
    ln, conf, free, hidden = np.full(n, np.nan), np.zeros(n), np.zeros(n, bool), np.zeros(n, bool)
    if contact is not None:
        contact = np.asarray(contact, float)
        partner, occluders = [None] * n, [None] * n
    contact_known = (np.isfinite(contact).any() if contact is not None
                     else any(p is not None and np.isfinite(p[:, 0]).any() for p in partner))
    w = np.array([m["w"] if m else np.nan for m in meas])
    ws = _medfilt(w, int(round(0.5 * fps)))  # the width changes with zoom only: smoothed over half a second
    for i, m in enumerate(meas):
        if m is None:
            continue
        ln[i] = m["L"] / ws[i]
        c = sam_conf[i] * (1 - m["holes"]) * (0.3 if m["edge"] else 1.0) * (0.6 if m["gap"] > 0.2 else 1.0)
        c *= float(np.clip((fore[i] - 0.6) / 0.3, 0, 1)) if np.isfinite(fore[i]) else 1.0
        dp = (contact[i] if np.isfinite(contact[i]) else math.inf) if contact is not None else \
            nearest(m["entry"], partner[i]) if partner[i] is not None else math.inf
        do = nearest(m["entry"], occluders[i]) if occluders[i] is not None else math.inf
        if do < OCCLUDE_W * ws[i] and do < dp:
            c, hidden[i] = 0.0, True  # a hand / paw / tail at the entry edge: shorter, but not inside (unknown)
        free[i] = contact_known and dp > CONTACT_W * ws[i]
        conf[i] = c
    good = conf >= CONF_MIN
    relative = False
    if calib and calib.get("out") is not None and np.isfinite(ln[calib["out"]]):
        lfull = float(ln[calib["out"]])
    elif (free & good).sum() >= 3:
        lfull = float(np.percentile(ln[free & good], 90))
    else:
        relative, lfull = True, float(np.nanpercentile(ln[good], 98)) if good.any() else float(np.nanmax(ln)) if np.isfinite(ln).any() else np.nan
    lhilt = float(ln[calib["hilt"]]) if calib and calib.get("hilt") is not None and np.isfinite(ln[calib["hilt"]]) else 0.0
    vis = ln / lfull if lfull > 0 else np.full(n, np.nan)
    ins = np.clip((lfull - ln) / max(lfull - lhilt, 1e-9), 0, 1)
    ins[hidden] = np.nan

    short = free & (vis < 0.8)  # the tip free but short: turned toward the camera (foreshortened), not inside
    conf[short] *= 0.3
    return {"in": ins, "conf": conf, "len": vis, "ln": ln, "free": free, "lfull": lfull, "relative": relative}


def frame_measure(mask, recv=None, conf=1.0):
    """v4.39: one frame of a mask-only shaft (a modifier's SAM run: the shaft painted, and the region it goes into)
    -> raw channels {mL, w, holes, gap, edge, dp, bx, by, ex, ey, mconf} in frame heights (positions 0..1), or {}
    (lost). recv: the receiving region's mask on the same frame (None: no region painted, nothing about insertion:
    {}). dp = the entry edge's distance to the region's mask (0 inside it). The frame border is the crop border:
    a shaft cut by it (entering from off screen) gets edge 1 (inserted() trusts it 0.3)."""
    import cv2
    if recv is None or not recv.any():
        return {}
    H, W = mask.shape
    ys, xs = np.nonzero(recv)
    ax = mask_axis(mask, np.array([xs.mean(), ys.mean()]))
    if ax is None:
        return {}
    m = measure(mask, *ax)
    if m is None:
        return {}
    dist = cv2.distanceTransform((~recv).view(np.uint8), cv2.DIST_L2, 3)
    ex, ey = m["entry"]
    dp = float(dist[int(np.clip(round(ey), 0, H - 1)), int(np.clip(round(ex), 0, W - 1))])
    return {"mL": m["L"] / H, "w": m["w"] / H, "holes": m["holes"], "gap": m["gap"], "edge": float(m["edge"]),
            "dp": dp / H, "bx": ax[0][0] / W, "by": ax[0][1] / H, "ex": ex / W, "ey": ey / H, "mconf": float(conf)}


def mask_scene(cols, fps):
    """v4.39: the inside fraction of a mask-only shaft over one scene, from frame_measure()'s columns (name -> (n,) arrays,
    NaN = lost). The full length is the shaft's best visible length, not its first: inserted() takes the 90th percentile
    of L / w over the frames whose tip is free of the region (dp > CONTACT_W widths) and that SAM trusts (not cut by the
    frame border, no holes); a shaft never seen free gets the 98th percentile of its trusted frames (`relative`: 0 %
    inside = the longest it was seen). -> ({in, in_conf, len}, record) | None (no frame measured)."""
    L = np.asarray(cols.get("mL", ()), float)
    if not len(L) or not np.isfinite(L).any():
        return None
    g = lambda k: np.asarray(cols[k], float)
    meas = [None if not np.isfinite(L[i]) else {"L": L[i], "w": g("w")[i], "holes": g("holes")[i], "gap": g("gap")[i],
                                                 "edge": bool(g("edge")[i] > 0.5), "entry": (np.nan, np.nan)} for i in range(len(L))]
    res = inserted(meas, np.nan_to_num(g("mconf")), None, None, np.full(len(L), np.nan), fps, contact=g("dp"))
    ins = np.where(np.isfinite(res["len"]), res["in"], np.nan)
    rec = {"source": "sam", "from": "mask", "full": "relative" if res["relative"] else "seen",
           "l_full_w": round(float(res["lfull"]), 2) if np.isfinite(res["lfull"]) else None,
           "conf_share": round(float((res["conf"] >= CONF_MIN).mean()), 3),
           "edge_share": round(float(np.nanmean(g("edge"))), 3)}
    return {"in": ins, "in_conf": res["conf"], "len": res["len"]}, rec


def shaft_sign(v, length, conf, min_share=0.5, min_r=0.3):
    """Direction from the shaft: the scene's 0..1 signal v (larger = out after the sign) against the visible length
    (larger = out) over the confident frames. -> {sign +1 (v as is) | -1 (flip), r, share, confident}."""
    v, length, conf = (np.asarray(x, float) for x in (v, length, conf))
    ok = np.isfinite(v) & np.isfinite(length) & (conf >= CONF_MIN)
    share = float(ok.mean()) if len(ok) else 0.0
    r = float(np.corrcoef(v[ok], length[ok])[0, 1]) if ok.sum() >= 10 and v[ok].std() > 0 and length[ok].std() > 0 else 0.0
    r = 0.0 if not np.isfinite(r) else r
    return {"sign": 1 if r >= 0 else -1, "r": round(r, 3), "share": round(share, 3),
            "confident": bool(share >= min_share and abs(r) >= min_r)}


# ---------------------------------------------------------------- SAM on a following crop

def sam_chunk(crops, roi, size, p):
    """SAM 2.1 over crops ((key, bgr) pairs, one crop size (w, h)), prompted with roi on the first: yields (key, mask,
    conf). Test seam (monkeypatched on CPU)."""
    from pawtrack.pulse import sam_stream
    yield from sam_stream(crops, roi, size, p.get("shaft_model", "small"), max(16, p.get("shaft_reprompt", 48)))


def _hull(P):
    import cv2
    return cv2.convexHull(np.asarray(P, np.float32)).reshape(-1, 2)


def outline(m, off, size, k=32):
    """v4.44: a crop mask -> its largest outer contour as <= k points [x, y], normalized to the frame (size = (W, H)),
    off = the crop's (x0, y0); [] for an empty mask. What the app draws while the pass runs."""
    import cv2
    cs, _ = cv2.findContours(np.ascontiguousarray(m, np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cs:
        return []
    c = max(cs, key=cv2.contourArea)
    eps = 0.005 * cv2.arcLength(c, True)
    q = cv2.approxPolyDP(c, eps, True)
    while len(q) > k:
        eps *= 1.5
        q = cv2.approxPolyDP(c, eps, True)
    W, H = size
    return [[round((float(x) + off[0]) / W, 4), round((float(y) + off[1]) / H, 4)] for x, y in q.reshape(-1, 2)]


def _cut(img, mask, x0, y0, cw, ch):
    """A full-frame image + bool mask -> their (cw, ch) crop at (x0, y0), moved inside the frame."""
    H, W = mask.shape
    x0, y0 = int(np.clip(x0, 0, W - cw)), int(np.clip(y0, 0, H - ch))
    return img[y0:y0 + ch, x0:x0 + cw], mask[y0:y0 + ch, x0:x0 + cw]


def schedule(frame_at, n, X, others, size, p, extent, emit=lambda d, t, **k: None, show=None, cut=None):
    """SAM over frames 0..n-1 (frame_at(i) -> bgr, frame px = size) on a crop that follows the members X (members()),
    moved every shaft_reprompt frames; every shaft_stride-th frame. others: member arrays of the other groups
    (negatives); extent (n,): the shaft's full length in px per frame (the crop's margin: the members may be few).
    paw-4c48.13: a chunk that ended cleanly hands its last frame + mask to the next as SAM's memory (no prompt of its
    own); a fresh box + positives from the visible members (negatives at the other groups') only on the first frame
    with >= MIN_MEMBERS visible, after a drift (under half the visible members inside the mask, dilated by a few px) and
    after a stretch SAM ran out of. Re-prompting every chunk from the members' box bound the mask to their extent: once
    they bunched at the base or died inside the partner, the mask shrank with them and never grew back.
    A box from a group with under DEPLETED of its most members visible may be too short for the shaft: the frames whose
    mask is no longer than it along the members' axis are `bound` (until the mask grows longer).
    show(k, mask, (x0, y0)) (v4.44, optional): each frame SAM kept, as it comes.
    cut (v4.53, paw-yx6q, optional): (frame index, full-frame bool mask): what the owner erased from the group on its painted
    frame. paw-jyf9: SAM's mask never takes it in on any frame (the erase moved from the painted frame by the members'
    similarity, cut_at); SAM runs on the painted frame whatever the stride, a chunk that reaches it ends there and the next
    starts from its cut mask (SAM's memory), and a fresh prompt on it gets a negative click inside the erase.
    -> (masks: per frame (bool mask (h, w), (x0, y0) crop offset) | None, conf (n,), stats, bound (n,) bool)."""
    import cv2
    from pawtrack.pulse import prompt
    W, H = size
    step, every = int(p.get("shaft_stride", 1)), int(p.get("shaft_reprompt", 48))
    vis = np.isfinite(X[:, :, 0]).sum(1)
    painted, er0 = cut if cut is not None else (None, None)

    def cut_at(k):  # the erase on frame k: moved from the painted frame by the members' similarity (unmoved without one)
        if er0 is None or k == painted:
            return er0
        ok = np.isfinite(X[painted, :, 0]) & np.isfinite(X[k, :, 0])
        T = sim_fit(X[painted][ok], X[k][ok]) if ok.sum() >= 2 else None
        if T is None:
            return er0
        z, ca, cb = T   # p_k = z (p - ca) + cb
        t = np.asarray(cb, float) - [(complex(*ca) * z).real, (complex(*ca) * z).imag]
        M = np.array([[z.real, -z.imag, t[0]], [z.imag, z.real, t[1]]])
        return cv2.warpAffine(er0.astype(np.uint8), M, (W, H), flags=cv2.INTER_NEAREST) > 0
    out, conf, bound = [None] * n, np.zeros(n), np.zeros(n, bool)
    stats = {"chunks": 0, "drift": 0, "frames": 0, "carried": 0}
    prev, cap = None, None   # (full-frame bgr, full-frame bool mask) handed on; a depleted prompt: (members axis, its length px)
    i = 0
    while i < n:
        if prev is None:
            while i < n and vis[i] < MIN_MEMBERS:
                i += 1
            if i >= n:
                break
        ks = list(range(i, min(n, i + 2 * every * step), step))
        if painted is not None and i < painted < min(n, i + 2 * every * step):   # paw-jyf9: end on the painted frame
            ks = [k for k in ks if k < painted] + [painted]
        Q = [X[k][np.isfinite(X[k, :, 0])] for k in ks]
        if prev is not None:
            ys, xs = np.nonzero(prev[1])
            Q.append(np.array([[xs.min(), ys.min()], [xs.max(), ys.max()]], float))
        Q = np.concatenate(Q)
        pad = max(CROP_PAD * float(np.nanmax(extent[ks])), CROP_MIN * H / 2)
        x0, y0 = np.maximum(0, np.floor(Q.min(0) - pad)).astype(int)
        x1, y1 = int(min(W, math.ceil(Q[:, 0].max() + pad))), int(min(H, math.ceil(Q[:, 1].max() + pad)))
        cw, ch = x1 - x0, y1 - y0
        off = np.array([x0, y0], float)
        if prev is not None:
            roi = {"kind": "none", "anchors": [_cut(*prev, x0, y0, cw, ch)]}
            stats["carried"] += 1
        else:
            P0 = X[i][np.isfinite(X[i, :, 0])] - off
            neg = [o[i][np.isfinite(o[i, :, 0])] - off for o in others]
            hull = _hull(P0)
            hull = hull.mean(0) + 1.3 * (hull - hull.mean(0))  # members sit inside the outline: the box a little wider
            roi = prompt(hull, [q for q in neg if len(q)], cw, ch)
            if i == painted:   # paw-jyf9: SAM is told the erased area is not the shaft (its deepest point, a negative click)
                e = np.ascontiguousarray(er0[y0:y1, x0:x1], np.uint8)
                if e.any():
                    d = cv2.distanceTransform(e, cv2.DIST_L2, 3)
                    yx = np.unravel_index(int(np.argmax(d)), d.shape)
                    roi["points"] = roi["points"] + [[yx[1] / cw, yx[0] / ch]]
                    roi["labels"] = roi["labels"] + [0]
            u = np.linalg.eigh(np.cov(hull.T))[1][:, 1] if len(hull) >= 3 else np.array([1.0, 0.0])
            span = float(np.ptp(hull @ u))
            cap = (u, 1.05 * span + 2) if vis[i] < DEPLETED * vis.max() else None   # the prompt's length along the members

        stats["chunks"] += 1
        nxt, last = ks[-1] + step, None
        frames = ((k, frame_at(k)[y0:y1, x0:x1]) for k in ks)
        with closing(sam_chunk(frames, roi, (cw, ch), p)) as it:
            for q, (k, m, c) in enumerate(it):
                ck = cut_at(k)
                if ck is not None:
                    m = m & ~ck[y0:y0 + m.shape[0], x0:x0 + m.shape[1]]
                out[k], conf[k] = (m, (x0, y0)), c
                stats["frames"] += 1
                Pk = X[k][np.isfinite(X[k, :, 0])] - off
                if (q >= 2 or prev is not None) and len(Pk) >= MIN_MEMBERS:
                    mm = cv2.dilate(m.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
                    ij = np.round(Pk).astype(int)
                    okk = (ij[:, 0] >= 0) & (ij[:, 0] < cw) & (ij[:, 1] >= 0) & (ij[:, 1] < ch)
                    inside = mm[ij[okk, 1], ij[okk, 0]].sum() / max(1, len(Pk))
                    if inside < 0.5 or c < 0.5:
                        out[k], conf[k], cap = None, 0.0, None
                        stats["drift"] += 1
                        nxt = k
                        break
                if show is not None:
                    show(k, m, (x0, y0))
                ys, xs = np.nonzero(m)
                if len(xs) >= MIN_PX:
                    last = (k, m)
                    if cap is not None:
                        if np.ptp(np.stack([xs, ys], 1) @ cap[0]) <= cap[1]:
                            bound[k] = True
                        else:
                            cap = None   # grew longer than the prompt: no longer bound by it
                if q >= every and k + step < n:
                    nxt = k + step
                    break
        prev = None
        if last is not None and nxt == last[0] + step and nxt < n:
            img = frame_at(last[0])
            z = np.zeros((H, W), bool)
            z[y0:y0 + last[1].shape[0], x0:x0 + last[1].shape[1]] = last[1]
            prev = (img.copy(), z)
        emit(min(nxt, n), n, stage="shaft")
        i = max(nxt, i + 1)
    return out, conf, stats, bound


def _interp_meas(meas, keys=("L", "w")):
    """Stride: the frames SAM skipped get L / w linearly between their neighbours (entry etc. from the nearer one)."""
    have = [i for i, m in enumerate(meas) if m is not None]
    if len(have) < 2:
        return meas
    out = list(meas)
    for a, b in zip(have[:-1], have[1:]):
        for i in range(a + 1, b):
            f = (i - a) / (b - a)
            m = dict(meas[a] if f < 0.5 else meas[b])
            for k in keys:
                m[k] = meas[a][k] + f * (meas[b][k] - meas[a][k])
            out[i] = m
    return out


# ---------------------------------------------------------------- one scene

def _turn(v, z):
    """Unit vector v turned by the unit complex z."""
    q = (v[0] + 1j * v[1]) * z
    return np.array([q.real, q.imag])


def _part(g):

    return (g.get("part") or str(g.get("name", "")).split("_")[-1]).rstrip("0123456789")


def run_scene(ts, pts_frames, groups, g, size, p, frame_at=None, knot=False, calib=None, emit=lambda d, t, **k: None, show=None,
              part=False):
    """One scene, one shaft group. ts: frame times (ms); pts_frames: the overlay `pts` per frame; groups: the scene's
    groups (cli.parse_groups' shape: name, id, who, part, t_ms); g: the shaft group; size: frame px (W, H) of frame_at
    (frame_at(i) -> bgr; None = no SAM); knot: the scene is tagged knotting; calib {out, hilt}: frame indices.
    -> {"channels": {in, in_conf, len, knot, bx, by, ex, ey, w, why (WHY codes): (n,) arrays (normalized frame units)}, "record", "events"}
    | None (the group has under MIN_MEMBERS visible members anywhere in the scene).
    part (v4.52, paw-4c48.19): g is a depth part the owner turned on (a forearm, a tail, a toy ...), not the penis: the base is
    the end away from the receiver first (the part goes in with its far end), the receiver is the other character's receiving
    parts, else its group nearest the part (record receiver / receiver_from), the part's own hand / paw on the same side is no
    occluder, no knot, and two points readings come too: pn (visible members / their 95th percentile) and pcut (the farthest
    visible member's place along the axis / its 90th percentile); record role "part"."""
    ts = np.asarray(ts, float)
    n, (W, H) = len(ts), size
    fps = 1000.0 / float(np.median(np.diff(ts))) if n > 1 else 30.0
    X = members(pts_frames, g["id"], size)
    who = g.get("who")
    other = [o for o in groups if o is not g and o.get("id") is not None]
    own = sorted((o for o in other if _part(o) in BASE_PARTS and (o.get("who") == who if who else _part(o) in ("balls", "sheath"))),
                 key=lambda o: BASE_PARTS.index(_part(o)))
    rec = [o for o in other if _part(o) in RECEIVE and o not in own and (o.get("who") != who if who else True)]
    occ = [o for o in other if _part(o) in OCCLUDE]
    M = {o["name"]: members(pts_frames, o["id"], size) for o in other}
    seed = int(np.argmin(np.abs(ts - float(g.get("t_ms") or ts[0]))))
    if g.get("knot") and not part and not any(_part(o) == "knot" for o in own):
        # paw-adxi: the penis' own knot section (v4.54) is a base-end hint as a knot group was: its members on the painted frame
        from pawtrack.partlabel import erased_mask
        km = erased_mask({"erased": g["knot"]}, W, H)
        P = X[seed] if km is not None else np.zeros((0, 2))
        ij = np.nan_to_num(P, nan=-1).astype(int)
        cols = np.flatnonzero(np.isfinite(P[:, 0]) & (ij[:, 0] >= 0) & (ij[:, 0] < W) & (ij[:, 1] >= 0) & (ij[:, 1] < H)
                              & km[np.clip(ij[:, 1], 0, H - 1), np.clip(ij[:, 0], 0, W - 1)]) if km is not None else []
        if len(cols):
            M[" knot section"] = X[:, cols]
            own = sorted(own + [{"name": " knot section", "part": "knot"}], key=lambda o: BASE_PARTS.index(_part(o)))
    rec_from = "parts" if rec else "none"
    if part:
        knot = False
        occ = [o for o in occ if not (who and o.get("who") == who and o.get("side") == g.get("side"))]   # its own hand / paw
        if not rec:   # no receiving part painted: the other character's group nearest the part
            c = centroid_at(X, seed)
            far = [(np.linalg.norm(q - c), o) for o in other if who and o.get("who") not in (None, who)
                   for q in [centroid_at(M[o["name"]], seed)] if q is not None and c is not None]
            if far:
                rec, rec_from = [min(far, key=lambda x: x[0])[1]], "nearest"
    ax = frame_axis(X, seed, [M[o["name"]] for o in own], [M[o["name"]] for o in rec], partner_first=part)
    if ax is None:
        return None
    T, held = transforms(X, ax)

    def carry(ax):  # base point and axis per frame: the reference carried by each frame's similarity; axis spikes removed
        b = np.array([apply(Tk, ax["base"]) if Tk else ax["base"] for Tk in T])
        a0 = math.atan2(ax["u"][1], ax["u"][0])
        a = despike([a0 + float(np.angle(Tk[0])) if Tk else a0 for Tk in T])
        return b, np.stack([np.cos(a), np.sin(a)], 1)
    base, uh = carry(ax)
    scale = np.array([abs(Tk[0]) if Tk else np.nan for Tk in T])
    stack = lambda os, i: np.concatenate([M[o["name"]][i] for o in os]) if os else None
    partner = [stack(rec, i) for i in range(n)]
    occluders = [stack(occ, i) for i in range(n)]
    record = {"source": "points", "base_from": ax["why"], "frames": n, "members": int(X.shape[1])}
    if part:
        record.update(role="part", receiver=[o["name"] for o in rec], receiver_from=rec_from)
    meas, sam_conf, bound = [None] * n, np.zeros(n), np.zeros(n, bool)
    if frame_at is not None and p.get("shaft_sam", True):
        try:
            t0 = time.perf_counter()
            ext = ax["length"] * np.where(np.isfinite(scale), scale, np.nanmax(scale) if np.isfinite(scale).any() else 1.0)
            from pawtrack.partlabel import erased_mask
            er = erased_mask(g, W, H)   # v4.53: what the owner erased from the group stays out of the mask on its frame
            masks, sc, st, bound = schedule(frame_at, n, X, [M[o["name"]] for o in other], size, p, ext, emit, show,
                                            cut=None if er is None else (seed, er))
            ax2 = refine_axis(X, ax, masks, T)
            if ax2 is not ax:
                ax = ax2
                base, uh = carry(ax)
                record["axis"] = "refined"

            for i, mk in enumerate(masks):
                if mk is not None:
                    m, (x0, y0) = mk
                    r = measure(m, base[i] - [x0, y0], uh[i])
                    if r is not None:
                        r["entry"] = r["entry"] + [x0, y0]
                        meas[i], sam_conf[i] = r, sc[i] * (0.3 if bound[i] else 1.0)   # bound: never a confident reading
            if int(p.get("shaft_stride", 1)) > 1:
                filled = _interp_meas(meas)
                for i in range(n):
                    if meas[i] is None and filled[i] is not None:
                        meas[i], sam_conf[i] = filled[i], 0.8 * max(sc[max(0, i - 1)], sc[min(n - 1, i + 1)])
            sam_s = time.perf_counter() - t0
            video_s = (ts[-1] - ts[0]) / 1000.0 + 1.0 / fps
            record.update(source="sam", sam_s=round(sam_s, 2), video_s=round(video_s, 2),
                          sam_s_per_s=round(sam_s / max(video_s, 1e-3), 2), **st,
                          lost=round(float(np.mean([m is None for m in meas])), 3), bound=round(float(bound.mean()), 3))
            if sum(m is not None for m in meas) < max(5, 0.2 * n):
                record["note"] = "SAM lost the shaft: points fallback"
                meas = [None] * n
        except ImportError as e:
            record["note"] = f"SAM not available ({e}): points fallback"
        except Exception as e:  # noqa: BLE001 (a SAM failure falls back to the points; the channel is optional)
            record["note"] = f"SAM failed ({type(e).__name__}: {e}): points fallback"
    w_series = np.array([m["w"] if m else np.nan for m in meas])
    if any(m is not None for m in meas):
        # the members sit inside the painted outline: the shaft's own base end is where the mask starts (median over
        # the frames whose start is near the tracked base point; a hidden base end does not move it)
        st = [m["start"] / m["w"] for m in meas if m is not None and abs(m["start"]) < 3 * m["w"]]
        o = float(np.median(st)) if len(st) >= 3 else 0.0
        if o:
            for m in meas:
                if m is not None:
                    m["L"] -= o * m["w"]
        wr = np.nanmedian(w_series)
        fore = (scale / np.nanmedian(scale[np.isfinite(scale)])) / (w_series / wr) if np.isfinite(scale).any() else np.full(n, np.nan)
        fore[held] = np.nan
        res = inserted(meas, sam_conf, partner, occluders, fore, fps, calib)
        ins, conf, vis = res["in"], res["conf"], res["len"]
        entry = np.array([m["entry"] if m else (np.nan, np.nan) for m in meas], float)
        record.update(full="relative" if res["relative"] else "seen", l_full_w=round(res["lfull"], 2),
                      conf_share=round(float((conf >= CONF_MIN).mean()), 3))
        kn = knot_place(meas, res["lfull"]) if knot else None
        if kn:
            kn["at"] -= o  # the profile runs from the tracked base point, the lengths from the mask's own base end

    else:
        record["source"] = "points"
        ins, conf, vis = fallback(X, ax)
        base_len = ax["length"]
        entry = np.array([b + (v * base_len * (abs(Tk[0]) if Tk else 1)) * u if np.isfinite(v) else (np.nan, np.nan)
                          for b, u, v, Tk in zip(base, uh, vis, T)], float)
        record.update(full="relative", conf_share=round(float((conf >= CONF_MIN).mean()), 3))
        kn, res = None, None
    events, kst = [], np.full(n, np.nan)
    if kn is not None:
        kst = knot_states(res["ln"], kn)
        kst[conf < CONF_MIN] = np.nan
        events = [{"t_ms": e["t_ms"], "kind": "knot", "dir": e["dir"], "label": f"knot {e['dir']}", "source": "shaft"}
                  for e in knot_events(ts, kst)]
        record["knot"] = {"at_w": round(kn["at"], 2), "half_w": round(kn["half"], 2)}
    ins = np.where(np.isfinite(vis), ins, np.nan)
    few = np.isfinite(X[:, :, 0]).sum(1) < MIN_MEMBERS
    if res is None:   # points fallback (or no SAM)
        why = np.where(np.isfinite(vis), WHY["points"], WHY["few"])
    else:
        why = np.where(few, WHY["few"], WHY["lost"])
        got = np.isfinite(vis)
        why[got] = np.where(conf[got] >= CONF_MIN, WHY["seen"], WHY["low"])
        why[got & bound] = WHY["bound"]
        why[got & ~np.isfinite(res["in"])] = WHY["hidden"]
    ch = {"in": ins, "in_conf": conf, "len": vis, "knot": kst,
          "bx": base[:, 0] / W, "by": base[:, 1] / H, "ex": entry[:, 0] / W, "ey": entry[:, 1] / H,
          "w": w_series / H, "why": why.astype(float)}
    if part:   # the points readings of the same part (the frontend's "points" reading reads the members itself)
        cnt = np.isfinite(X[:, :, 0]).sum(1).astype(float)
        top = np.percentile(cnt, 95) if cnt.any() else 0.0
        ch["pn"] = cnt / top if top > 0 else np.full(n, np.nan)
        ch["pcut"] = fallback(X, ax)[2]
    return {"channels": ch, "record": record, "events": events}
