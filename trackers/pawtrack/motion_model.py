"""Bodies -> parts: per-group similarity motion model of a point set (numpy / scipy), used by pawtrack.groups.

Model. Per frame, a group's high-passed displacements d_i are fitted by least squares with a linearised similarity
transform about the members' reference centre c (reference r_i = the low-passed position, i.e. position - d):
    d_i ~ t + a (r_i - c) + b perp(r_i - c),   perp(x, y) = (-y, x)
t = translation, a = relative scale change (~ log scale: > 0 = the group grows on screen, e.g. toward the camera),
b = rotation in radians (> 0 = clockwise on screen). The fit starts from the members' median displacement (an
appendage on the edge would otherwise be absorbed by the first rotation / scale) and refits REFIT_N times without the
members whose residual is > REFIT_K x the inliers' median. residual_i = |d_i - model_i|: how far a point departs from
its body's rigid motion.

Parts (window_parts, per window of groups.group_tracks). A body's members whose RMS residual over the window is
> OUT_K x the body's median are its outliers. The outliers are clustered by the correlation of their residual
series (average linkage, cut CUT); a cluster of >= PART_MIN points whose spread (RMS distance to its centre) is
< PART_SPREAD x the body's becomes a part of the body: a compact piece with its own motion on top of the body's
(a tail, a hand, a flapping penis). The outliers left are split into spatial clumps (points within NEAR_K x the
body's median neighbour spacing linked); a clump that passes the same size / spread test and whose residual is
>= OWN_EXPL explained by a similarity of its own (a contraction or a twist: its points move apart / around, so they
do not correlate) is a part too. At most MAX_PARTS per body; the other outliers are unassigned. With FOLD (off by
default) a smaller group that is compact, sits on the body (one of its points within NEAR_K x the body's median
neighbour spacing of a body member) and carries the body's motion (regression of its displacement on the body
model's prediction at its points: beta in BETA) is first folded into the body, then goes through the same part
test; without it an appendage whose own motion is >~3 x the body's is clustered as a body of its own. The body's
centroid comes from its inliers only (no part, no outlier; on frames where a member's residual is > FRAME_K x the
body's median that frame it is left out too).
"""
import warnings

import numpy as np
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree
from scipy.spatial.distance import squareform

MIN_PTS = 3       # members a frame needs for a fit
REFIT_K, REFIT_N = 3.0, 3  # refits, each without the members whose residual > REFIT_K x the inliers' median
OUT_K = 3.0       # window: RMS residual > this x the body's median -> outlier (part candidate or unassigned)
FRAME_K = 3.0     # window: residual on a frame > this x the body's median that frame -> not in the centroid then
MAX_PARTS = 2     # parts per body (p1, p2)
PART_MIN = 3      # points a part needs
PART_SPREAD = 0.5  # a part's spread < this x its body's
CUT = 0.6         # part clustering cut on 1 - correlation of the residual series (as groups.CORR_CUT)
NEAR_K, BETA = 2.0, (0.5, 1.5)  # folding a small group into a body (docstring)
OWN_EXPL = 0.5    # a spatial clump of outliers is a part when a similarity of its own explains >= this of its residual
FOLD = False      # fold small riding groups into their body (docstring); off: on the gold set it cost label
                  # stability (changes +6 %, extra ids +8 %) for no F1 (experiments/groups/RESULTS.md "Bodies -> parts")


def _nanmed(x, axis):
    """np.nanmedian(x, axis) bit for bit (all-NaN -> NaN, silently) without its per-row python loop (paw-v0oe): one
    sort puts the NaNs last, the median is the middle one / the mean of the middle two of the n real values."""
    x = np.moveaxis(np.asarray(x, float), axis, -1)
    if not x.shape[-1]:
        return np.full(x.shape[:-1], np.nan)
    s = np.sort(x, -1)
    n = x.shape[-1] - np.isnan(s).sum(-1)
    at = lambda i: np.take_along_axis(s, np.asarray(i)[..., None], -1)[..., 0]
    return np.where(n > 0, (at((np.maximum(n, 1) - 1) // 2) + at(n // 2)) / 2, np.nan)


def _rowsum(x, cols, z):
    """x (T, M) summed over axis 1 exactly as the (T, width) array z with x in columns cols and zeros elsewhere is:
    numpy's pairwise sum depends on where the terms sit, so a fit on its member columns only stays bit-identical.
    z: the caller's zero buffer, only ever written at cols."""
    if cols is None:
        return x.sum(1)
    z[:, cols] = x
    return z.sum(1)


def _fit(d, r, w, cols=None, z=None):
    wf = w.astype(float)[..., None]
    n = np.maximum(wf.sum(1), 1e-12)
    c, t = (wf * r).sum(1) / n, (wf * d).sum(1) / n  # (T, M, 2) over axis 1: sequential, zero columns change nothing
    u, e = r - c[:, None], d - t[:, None]
    uu = np.maximum(_rowsum(wf[..., 0] * (u ** 2).sum(2), cols, z), 1e-12)
    a = _rowsum(wf[..., 0] * (e * u).sum(2), cols, z) / uu
    b = _rowsum(wf[..., 0] * (e[..., 1] * u[..., 0] - e[..., 0] * u[..., 1]), cols, z) / uu
    return np.c_[t, a, b], c


def predict(p, c, r):
    """Model displacement at reference positions r (T,M,2) of params p (T,4) about centre c (T,2)."""
    u = r - c[:, None]
    return p[:, None, :2] + p[:, None, 2:3] * u + p[:, None, 3:4] * np.stack([-u[..., 1], u[..., 0]], 2)


def fit(d, r, w):
    """d (T,M,2) displacement, r (T,M,2) reference positions, w (T,M) bool members visible.
    -> params (T,4) [tx, ty, a, b] (NaN on frames with < MIN_PTS members), centre (T,2), resid (T,M) (NaN where
    not w). Computed on the columns that are ever members (a pinned group, a body: a fraction of the scene's points),
    bit-identical to the fit over all of them (paw-v0oe: _rowsum)."""
    w = np.asarray(w, bool)
    width, cols, z = w.shape[1], np.flatnonzero(w.any(0)), None
    if len(cols) < width:
        d, r, w, z = d[:, cols], r[:, cols], w[:, cols], np.zeros((len(w), width))
    else:
        cols = None
    # start: residual to the members' median displacement (robust to leverage: an appendage on the edge would
    # otherwise be absorbed by the first least-squares rotation / scale)
    res = np.linalg.norm(d - _nanmed(np.where(w[..., None], d, np.nan), 1)[:, None], axis=2)
    w2 = w
    for _ in range(REFIT_N + 1):
        med = np.nan_to_num(_nanmed(np.where(w2, res, np.nan), 1), nan=np.inf)
        w2 = w & (res <= REFIT_K * med[:, None] + 1e-9)
        w2 = np.where((w2.sum(1) >= MIN_PTS)[:, None], w2, w)
        p, c = _fit(d, r, w2, cols, z)
        res = np.linalg.norm(d - predict(p, c, r), axis=2)
    p[w.sum(1) < MIN_PTS] = np.nan
    res = np.where(w, res, np.nan)
    if cols is not None:
        full = np.full((len(res), width), np.nan)
        full[:, cols] = res
        res = full
    return p, c, res


def _spread(x):
    return float(np.sqrt(((x - x.mean(0)) ** 2).sum(1).mean())) if len(x) else 0.0


def _corr_clusters(e, w):
    """Average-linkage clusters of series e (W,M,2) on 1 - masked correlation (as groups.cluster) -> labels (M,)."""
    x = e * w[..., None]
    en = (e ** 2).sum(2) * w
    wf = w.astype(float)
    S = np.einsum("tid,tjd->ij", x, x) / (np.sqrt((en.T @ wf) * (wf.T @ en)) + 1e-12)
    S[(wf.T @ wf) < 0.3 * len(e)] = 0.0
    dist = np.clip(1 - S, 0, 2)
    np.fill_diagonal(dist, 0)
    return fcluster(linkage(squareform((dist + dist.T) / 2, checks=False), "average"), CUT, "distance")


def window_parts(d, q, v, w, out, n_groups, memo=None, pos=None):
    """One window: d (W,N,2) high-passed displacement, q (W,N,2) positions (aspect-scaled), v (W,N) visible,
    w (W,N) visible and eligible (the fit's members), out (N,) window labels.
    -> (labels: outliers -1 and folded groups merged into their body, part (N,) 0 / 1..MAX_PARTS window-local part
    ids (largest first), v without parts and per-frame outliers: the body centroids' mask).
    memo: {member indices (bytes): body_parts' answer} computed ahead (groups' pass 1, in parallel, on the clusters'
    member sets; paw-v0oe): a body whose members are one of them is not fitted again (the same answer, bit for bit).
    pos: np.median(q, 0) when the caller has it."""
    out, part, keep = out.copy(), np.zeros(len(out), int), v.copy()
    r = q - d
    pos = np.median(q, 0) if pos is None else pos
    gs = sorted((g for g in range(1, n_groups + 1) if (out == g).sum() > MIN_PTS), key=lambda g: -(out == g).sum())
    done = set()
    for g in gs:
        if g in done:
            continue
        idx = np.flatnonzero(out == g)
        if FOLD:
            p, c, res = fit(d[:, idx], r[:, idx], w[:, idx])
        if FOLD and np.isfinite(p).any():
            sp, tree = _spread(pos[idx]), cKDTree(pos[idx])
            nn = np.median(tree.query(pos[idx], 2)[0][:, 1])
            for h in gs:  # fold small compact groups that ride on this body
                hi = np.flatnonzero(out == h)
                if h == g or h in done or not len(hi) or len(hi) >= len(idx) or _spread(pos[hi]) >= PART_SPREAD * sp:
                    continue
                if tree.query(pos[hi])[0].min() > NEAR_K * nn:
                    continue
                pr = np.nan_to_num(predict(p, c, r[:, hi]))
                m = w[:, hi, None]
                beta = (d[:, hi] * pr * m).sum() / ((pr ** 2 * m).sum() + 1e-12)
                if BETA[0] <= beta <= BETA[1]:
                    out[hi] = g
                    done.add(h)
            if len(np.flatnonzero(out == g)) > len(idx):
                idx = np.flatnonzero(out == g)
        kp, bad, pt = (memo or {}).get(idx.tobytes()) or body_parts(d, r, w, pos, idx)
        keep[:, idx] &= kp
        part[idx] = pt
        out[idx[bad & (pt == 0)]] = -1
    keep[:, part > 0] = False
    return out, part, keep


def body_parts(d, r, w, pos, idx):
    """window_parts for one body (members idx; r = q - d, pos the window-median positions): its fit, its outliers and
    its parts -> (keep (W, len(idx)): the frames each member counts for the centroid, bad (len(idx),) outliers,
    part (len(idx),) 0 / 1..MAX_PARTS)."""
    p, c, res = fit(d[:, idx], r[:, idx], w[:, idx])
    part = np.zeros(len(pos), int)
    sp = _spread(pos[idx])
    with warnings.catch_warnings(), np.errstate(all="ignore"):
        warnings.simplefilter("ignore", RuntimeWarning)
        rms = np.sqrt(np.nanmean(res ** 2, 0))
        bad = np.nan_to_num(rms, nan=0.0) > OUT_K * _nanmed(rms, 0)
        keep = ~(res > FRAME_K * _nanmed(res, 1)[:, None])
    if bad.sum() >= PART_MIN:
        bi = idx[bad]
        cl = _corr_clusters(d[:, bi] - np.nan_to_num(predict(p, c, r[:, bi])), w[:, bi])
        ids, cnt = np.unique(cl, return_counts=True)
        j = 0
        for i in ids[np.argsort(-cnt, kind="stable")]:
            m = bi[cl == i]
            if j < MAX_PARTS and len(m) >= PART_MIN and _spread(pos[m]) < PART_SPREAD * sp:
                j += 1
                part[m] = j
        # outliers left: spatial clumps whose residual is a motion of their own (e.g. a contraction, which
        # cancels in the correlation above: its points move apart / together)
        left = bi[part[bi] == 0]
        if j < MAX_PARTS and len(left) >= PART_MIN:
            nn = np.median(cKDTree(pos[idx]).query(pos[idx], 2)[0][:, 1])
            pr = cKDTree(pos[left]).query_pairs(NEAR_K * nn, output_type="ndarray")
            n = len(left)
            cc = connected_components(coo_matrix((np.ones(len(pr)), (pr[:, 0], pr[:, 1])), (n, n)), False)[1]
            for i in np.argsort(-np.bincount(cc), kind="stable"):
                m = left[cc == i]
                if j >= MAX_PARTS or len(m) < PART_MIN or _spread(pos[m]) >= PART_SPREAD * sp:
                    continue
                e = d[:, m] - np.nan_to_num(predict(p, c, r[:, m]))
                _, _, er = fit(e, r[:, m], w[:, m])
                if np.nansum(er ** 2) <= (1 - OWN_EXPL) * (np.linalg.norm(e, axis=2) ** 2 * w[:, m]).sum():
                    j += 1
                    part[m] = j
    return keep, bad, part[idx]


def body_memo(d, q, w, lab, n_groups, pos):
    """window_parts' memo for a window's cluster labels lab (groups' pass 1): body_parts of every member set it would
    fit (pos = np.median(q, 0))."""
    r = q - d
    sets = [np.flatnonzero(lab == g) for g in range(1, n_groups + 1)]
    return {i.tobytes(): body_parts(d, r, w, pos, i) for i in sets if len(i) > MIN_PTS}


def group_params(d, q, vis, labels, part, n_groups, ex=None):
    """Per frame, over the scene's final labels: each body's similarity fitted on its inliers (no part)
    -> (params (T,G,4) [tx, ty, a, b], rel (T,G,MAX_PARTS,2): each part's mean displacement minus the body model's
    prediction at its points = the part's motion in its body's frame, pscale (T,G,MAX_PARTS): the scale term of a
    similarity fitted to that residual = the part's own contraction / swelling; NaN where absent). ex: a thread pool
    for the bodies (independent)."""
    T = len(d)
    P = np.full((T, n_groups, 4), np.nan)
    rel = np.full((T, n_groups, MAX_PARTS, 2), np.nan)
    pscale = np.full((T, n_groups, MAX_PARTS), np.nan)
    r = q - d

    def one(g):
        body = labels == g
        if not body.any():
            return
        P[:, g - 1], c, _ = fit(d, r, vis & body & (part == 0))
        bc = np.flatnonzero(body.any(0))  # the residual on the body's columns only: nothing else reads it (paw-v0oe)
        e = np.zeros_like(d)
        e[:, bc] = d[:, bc] - predict(np.nan_to_num(P[:, g - 1]), c, r[:, bc])
        for j in range(1, MAX_PARTS + 1):
            m = vis & body & (part == j)
            n = m.sum(1)
            ok = (n > 0) & np.isfinite(P[:, g - 1, 0])
            rel[ok, g - 1, j - 1] = ((e * m[..., None]).sum(1) / np.maximum(n, 1)[:, None])[ok]
            if m.any():
                pscale[ok, g - 1, j - 1] = fit(e, r, m)[0][ok, 2]
    list((ex.map if ex is not None else map)(one, range(1, n_groups + 1)))
    return P, rel, pscale


def carry(sets, slots, last, wi, j_min):
    """Stable ids across windows (as groups' bodies): sets = this window's member sets, slots / last = each id's last
    member set / window (updated in place). Jaccard >= j_min keeps an id (Hungarian); a new set takes a never-used
    id, else the one unseen the longest. -> id per set."""
    from scipy.optimize import linear_sum_assignment
    new = np.full(len(sets), -1)
    if sets:
        J = np.array([[len(s & m) / len(s | m) if m else 0.0 for m in slots] for s in sets])
        for i, j in zip(*linear_sum_assignment(-J)):
            if J[i, j] >= j_min:
                new[i] = j
        free = sorted(set(range(len(slots))) - set(new[new >= 0]), key=lambda j: (slots[j] is not None, last[j]))
        for i in np.flatnonzero(new < 0):
            new[i] = free.pop(0)
    for i, j in enumerate(new):
        slots[j], last[j] = sets[i], wi
    return new
