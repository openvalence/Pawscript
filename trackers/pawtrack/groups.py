"""Motion groups of a point-track cloud: the post-pass of cotracker_points / tapnext_points (numpy / scipy only).

Points that keep similar trajectories are bucketed. Per sliding window (8 s, or 6 x the loop period; step 0.5 s):
the camera (median displacement of the visible points) is removed from high-passed positions, the moving points are
clustered by the correlation of their 2-D displacement series (average linkage, as experiments/zones), and a point
that does not follow its 6 nearest moving neighbours (window-median positions; median correlation < 0.5) is
unassigned. Ids (sticky: moving in sync is not evidence of being one body). Pass 1 clusters every window; the ids are
seeded on the window with the most groups (ties: the lowest correlation between two groups) and carried forward to
the scene's end, then backward to its start (offline: the whole scene is buffered). Each point remembers its last id.
A cluster that holds >= PIECE_MIN points of two or more live ids is split along them, never merged: each id keeps its
points, a point without one here takes the id of its nearest member (window-median positions). An id's piece that is
the only id in a cluster of its own is a split: a NEW id (a never-used one, else a dead one, else one with no moving
member in this window; never one that has members here); a piece inside another id's cluster keeps its id point by
point unless it correlates with that id's motion by > HYST more than with its own id's main piece. An id dies only
when no eligible point holds it or it had no moving member for DORMANT_S. A new id is young for CONFIRM_S: in one
cluster with an older id meanwhile it folds back (noise splits do not live on). Two established ids merge only after
MERGE_SYNC_S in one cluster, with touching hulls (>= PIECE_MIN of one's members have the other among their 6 nearest
eligible points: no static / unassigned gap) and one similarity fit (motion_model.fit) whose median residual is
<= MERGE_RES x the worse body's own (on the gold set it never fires at 30 s; experiments/groups/RESULTS.md "Sticky
identities"). Pinned semantic groups (penis / balls / hips) stay outside the clustering and are not used as anchors:
one hips group per scene says nothing about which character a body is. Every frame's label is the weighted vote of the
windows covering it (triangular weights, as the centroid cross-fade; only windows where the point is eligible
vote), so one window's re-clustering does not flip the labels at a step boundary.
Bodies -> parts (pawtrack.motion_model.window_parts, per window after the ids): each group's rigid-motion
outliers are unassigned or, when compact and moving together, become a part of the group (ids carried per body by
member overlap, Jaccard >= J_MIN, Hungarian; labels voted like the groups'); the group centroid comes from its inliers only.

Camera (cam, cam_conf): per frame, the median frame-to-frame motion of a reference set of co-visible points, summed.
"raw amp" = a point's RMS high-passed displacement in IMAGE coordinates (no camera removed) over its window: small =
the point does not move at stroke frequencies on screen (camera motion slower than the 1.5 s high-pass, i.e. pans
and drift, does not count). Reference = the static group (label 0) when it has >= 3 co-visible points, a moving
group is present and the static points' median raw amp <= the moving points' (so a camera that rides the stroke is
still removed); otherwise the co-visible points whose raw amp < max(0.0025, 0.25 x p90) (cluster's floor), when >= 3;
otherwise no step (cam holds). The guard is for "everything moves": a box on one body (all points one group, which
cluster calls static) or a body covering most of the frame (the body becomes the window median, i.e. "static", and the
background a moving group); both used to put the stroke into cam. cam_conf = reference points / co-visible points.
"""
import copy
import os
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager

import numpy as np
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.ndimage import uniform_filter1d
from scipy.spatial import cKDTree
from scipy.spatial.distance import squareform

from pawtrack.motion_model import MAX_PARTS, _nanmed, body_memo, carry, fit, group_params, predict, window_parts
from pawtrack.pipeline import rolling_axes

MAX_G = 4        # moving groups g1..g4
CORR_CUT = 0.6   # average-linkage cut on 1 - correlation (groups correlate >= 0.4 inside)
K_NB, NB_MIN = 6, 0.5  # neighbour rule
ELIG = 0.6       # a point takes part in a window when visible on >= this share of its frames
HYST = 0.3       # a point keeps its group unless its correlation with another beats it by more than this
J_MIN = 0.2      # parts: a window's part keeps an id when its members overlap that id's last members by >= this Jaccard
PIECE_MIN = 3    # a cluster holds an id when >= this many of its points last held it
DORMANT_S = 8.0  # an id with no moving member for longer than this dies (its static members are no body any more)
CONFIRM_S = 2.0  # a new id is young this long: in one cluster with an older id meanwhile, it folds back into it
MERGE_SYNC_S = 30.0  # two established ids merge only after this long in one cluster, with touching hulls and
MERGE_RES = 1.5      # a joint similarity fit whose median residual is <= this x the worse body's own
stats = {"merges": 0}  # diagnostics: established-id merges since import (experiments/groups/probe.py)


def cluster(dd, vis, elig, pos):
    """dd (m,N,2) camera-compensated high-passed displacement, vis (m,N), elig (N,), pos (N,2) aspect-scaled.
    -> labels (N,): -2 not eligible, -1 unassigned, 0 static, 1..MAX_G moving groups (largest first)."""
    N = dd.shape[1]
    lab = np.full(N, -2)
    if elig.sum() < 8:
        return lab
    w = vis & elig
    amp = np.sqrt((w[..., None] * dd ** 2).sum((0, 2)) / np.maximum(w.sum(0), 1))
    floor = max(0.0025, 0.25 * np.percentile(amp[elig], 90))
    mov = elig & (amp >= floor)
    lab[elig] = -1
    lab[elig & ~mov] = 0
    k = np.flatnonzero(mov)
    if len(k) < 4:
        return lab
    x = dd[:, k] * w[:, k, None]
    e = (dd[:, k] ** 2).sum(2) * w[:, k]
    wf = w[:, k].astype(float)
    S = np.einsum("tid,tjd->ij", x, x) / (np.sqrt((e.T @ wf) * (wf.T @ e)) + 1e-12)
    S[(wf.T @ wf) < 0.3 * len(dd)] = 0.0  # pairs seen together on < 30 % of the window: no evidence
    dist = np.clip(1 - S, 0, 2)
    np.fill_diagonal(dist, 0)
    cl = fcluster(linkage(squareform((dist + dist.T) / 2, checks=False), "average"), CORR_CUT, "distance")
    ids, cnt = np.unique(cl, return_counts=True)
    keep = [i for i, c in sorted(zip(ids, cnt), key=lambda a: -a[1]) if c >= max(4, 0.03 * len(k))][:MAX_G]
    for g, i in enumerate(keep, 1):
        lab[k[cl == i]] = g
    nb = min(K_NB, len(k) - 1)  # neighbour rule: median correlation with the nearest moving neighbours
    j = cKDTree(pos[k]).query(pos[k], nb + 1)[1][:, 1:]
    lab[k[np.median(np.take_along_axis(S, j, 1), 1) < NB_MIN]] = -1
    return lab


def _corr(d, w, pts, mem):
    """Correlation of each point's displacement series (pts) with the summed series of the members mem."""
    x = d[:, pts] * w[:, pts, None]
    M = (d[:, mem] * w[:, mem, None]).sum(1)[:, None]
    return (x * M).sum((0, 2)) / (np.sqrt((x ** 2).sum((0, 2)) * (w[:, pts, None] * M ** 2).sum((0, 2))) + 1e-12)


def _contrast(d, w, lab):
    """A window's motion contrast: (moving groups, - the highest correlation between two groups' mean series)."""
    m = [(d * (w & (lab == g))[..., None]).sum(1) for g in range(1, MAX_G + 1) if (lab == g).any()]
    c = [(a * b).sum() / (np.sqrt((a ** 2).sum() * (b ** 2).sum()) + 1e-12) for i, a in enumerate(m) for b in m[i + 1:]]
    return len(m), -max(c, default=1.0)


def _mergeable(j, k, out, d, w, pos, r):
    """Two ids' hulls touch (>= PIECE_MIN of j's members have a k member among their K_NB nearest eligible points: no
    gap of static / unassigned points between them) and one similarity fit explains both like a single body."""
    J, K, e = np.flatnonzero(out == j), np.flatnonzero(out == k), np.flatnonzero(out > -2)
    nb = out[e][cKDTree(pos[e]).query(pos[J], min(K_NB + 1, len(e)))[1][:, 1:]]
    if (nb == k).any(1).sum() < PIECE_MIN:
        return False
    med = lambda i: np.nanmedian(fit(d[:, i], r[:, i], w[:, i])[2])
    return med(np.r_[J, K]) <= MERGE_RES * max(med(J), med(K))


def sticky(lab, d, w, pos, r, st, seeding, conf_w, merge_w, dorm_w):
    """One window's ids from its clusters (module docstring): identity is sticky, sync is not sameness.
    lab = cluster's labels, d / w / pos the window's displacement / members / positions, r reference positions,
    st the scene state (mem = each point's last id, updated by the caller). -> labels (N,) with ids."""
    mem, wi = st["mem"], st["wi"]
    out = np.where(lab > 0, -1, lab)
    alive = [k for k in range(1, MAX_G + 1) if st["used"][k - 1] and abs(wi - st["last"][k - 1]) <= dorm_w
             and ((lab > -2) & (mem == k)).any()]
    rank = lambda k: (not st["est"][k - 1], st["born"][k - 1])
    pieces, cand = {}, []
    for c in range(1, MAX_G + 1):
        m = np.flatnonzero(lab == c)
        if not len(m):
            continue
        ks = sorted((k for k in alive if (mem[m] == k).sum() >= PIECE_MIN), key=rank)
        if not ks:
            cand.append(m)
            continue
        lk = np.where(np.isin(mem[m], ks), mem[m], 0)
        for k in ks[1:]:
            if not st["est"][k - 1]:
                lk[lk == k] = ks[0]  # a young id in one cluster with an older one: it folds back
        if (lk == 0).any():  # points without an id here: the id of their nearest member
            lk[lk == 0] = lk[lk > 0][cKDTree(pos[m[lk > 0]]).query(pos[m[lk == 0]])[1]]
        for k in np.unique(lk):
            pieces.setdefault(int(k), []).append((c, m[lk == k]))
    for k, ps in pieces.items():
        ps.sort(key=lambda p: -(mem[p[1]] == k).sum())
        out[ps[0][1]] = k  # the piece with most of the id's members
        for c, m in ps[1:]:
            oth = [(j, p) for j, pj in pieces.items() if j != k for cc, p in pj if cc == c]
            if oth:  # moves with another id: each point keeps k unless it follows that id clearly better
                j, jm = max(oth, key=lambda x: len(x[1]))
                out[m] = np.where(_corr(d, w, m, jm) > _corr(d, w, m, ps[0][1]) + HYST, j, k)
            elif len(m) >= 4:
                cand.append(m)  # a cluster of its own: the id split, the piece is a new body
            else:
                out[m] = k
    for m in cand:  # new bodies: a never-used id, else a dead one, else a dormant one (no moving member in this
        # window), unseen the longest; never one with members here
        free = sorted((k for k in range(1, MAX_G + 1) if not (out == k).any()),
                      key=lambda k: (k in alive, st["used"][k - 1], st["last"][k - 1]))
        if len(m) >= 4 and free:
            k = free[0]
            mem[mem == k] = 0
            out[m] = k
            st["used"][k - 1], st["est"][k - 1], st["born"][k - 1] = True, seeding, wi
    pres = [k for k in range(1, MAX_G + 1) if (out == k).any()]
    for k in pres:
        st["last"][k - 1] = wi
        st["est"][k - 1] |= wi - st["born"][k - 1] >= conf_w
    together = np.zeros((MAX_G, MAX_G), bool)
    for c in range(1, MAX_G + 1):
        ks = [k - 1 for k in np.unique(out[lab == c]) if k > 0 and st["est"][k - 1]]
        together[np.ix_(ks, ks)] = True
    st["sync"] = np.where(together, st["sync"] + 1, 0)
    for j in pres:
        for k in pres:
            if j < k and st["sync"][j - 1, k - 1] >= merge_w and (out == j).any() and (out == k).any() \
                    and _mergeable(j, k, out, d, w, pos, r):
                big, small = (j, k) if (out == j).sum() >= (out == k).sum() else (k, j)
                out[out == small], mem[mem == small], st["used"][small - 1] = big, big, False
                st["sync"][small - 1], st["sync"][:, small - 1] = 0, 0
                stats["merges"] += 1
    st["wi"] = wi + 1
    return out


def centroid(xy, vis, idx):
    """Seed-anchored centroid of members idx: mean member position + mean displacement of the visible ones."""
    if len(idx) == 0:
        return np.full((len(xy), 2), np.nan)
    p = xy[:, idx]
    ref = np.median(p, 0)
    v = vis[:, idx]
    c = (np.where(v[..., None], p - ref, 0).sum(1) / np.maximum(v.sum(1), 1)[:, None]) + ref.mean(0)
    c[v.sum(1) == 0] = np.nan
    return c


def default_threads():
    """PAWTRACK_THREADS (env, > 0), else OMP_NUM_THREADS (a script that limits its threads), else all logical cores:
    the motion-groups pass may pin the CPU (owner, paw-v0oe)."""
    try:
        n = int(os.environ.get("PAWTRACK_THREADS") or os.environ.get("OMP_NUM_THREADS") or 0)
    except ValueError:
        n = 0
    return n if n > 0 else os.cpu_count() or 1


_BLAS = []


def _blas():
    """(get, set) of numpy's OpenBLAS thread count (the scipy-openblas wheel, through ctypes), or None (another BLAS)."""
    if not _BLAS:
        import ctypes
        import glob
        f = None
        root = os.path.dirname(os.path.dirname(np.__file__))
        for lib in glob.glob(os.path.join(root, "numpy.libs", "*openblas*")) + glob.glob(os.path.join(os.path.dirname(np.__file__), ".dylibs", "*openblas*")):
            try:
                dll = ctypes.CDLL(lib)
                f = dll.scipy_openblas_get_num_threads64_, dll.scipy_openblas_set_num_threads64_
                f[0].restype, f[1].argtypes = ctypes.c_int, [ctypes.c_int]
                break
            except (OSError, AttributeError):
                f = None
        _BLAS.append(f)
    return _BLAS[0]


@contextmanager
def blas_threads(n):
    """numpy's BLAS on n threads inside (no pool x BLAS oversubscription), the previous count restored after."""
    b = _blas()
    old = b[0]() if b else None
    if b:
        b[1](n)
    try:
        yield old
    finally:
        if b:
            b[1](old)


def group_tracks(xy, vis, fps, period_frames=None, aspect=1.0, axis=None, new=None, pinned=None, conf=None, group_fit=False,
                 threads=None, tick=None):
    """xy (T,N,2) normalized tracks of one scene, vis (T,N) bool, axis: unit vector (aspect-scaled) for pair_dist,
    None = principal axis of the relative motion (per 4 s window, pipeline.rolling_axes, when it turns > 20 deg over the run). new (T,) bool, optional: animation on twos/threes, True on the
    frames that show a new drawing; the pass then runs on the drawings only (windows, high-pass and correlations
    in drawing time) and every output is held over the held frames. -> dict:
      labels (T,N) int8   -1 unassigned / not eligible, 0 static, 1..4 moving groups (ids stable over the scene)
      cent (T,4,2)        group centroids, normalized, camera removed (background frame; + cam = image position)
      share (T,4)         member share of all points; n_groups (T,) moving groups present
      pair_dist (T,)      centroid distance of the two largest moving groups on the axis (frame heights, > 0 on
                          average: smaller = closer), NaN with < 2 groups
      cam (T,2)           cumulative background motion since the first frame (normalized x, y)
      cam_conf (T,)       share of the co-visible points the camera step came from (0 = no reference, cam held)
      scale, rot (T,4)    each body's similarity fit on its inliers (motion_model): relative scale change (> 0 =
                          bigger on screen), rotation (radians, > 0 = clockwise on screen); NaN when absent
      part (T,N) int8     0 / 1..MAX_PARTS: the point's part of its body (labels keeps the body)
      part_cent (T,4,MAX_PARTS,2), part_share (T,4,MAX_PARTS)  parts' centroids (camera removed) and member shares
      part_rel (T,4,MAX_PARTS,2)  each part's mean displacement minus its body's fitted motion (high-passed)
      part_scale (T,4,MAX_PARTS)  scale term of a similarity fitted to that residual: the part's own contraction
    pinned (N,) int, optional: pinned semantic group per point (points.box_seeds; 0 = free). Pinned points
    stay out of the clustering (labels -1, part 0; shares are of all points) and form fixed groups: sem_tracks' keys.
    conf (T, N) / group_fit: v4.14, passed to sem_tracks.
    threads: the pass's thread pool (default_threads(): all logical cores; the owner waits on it, paw-v0oe), BLAS on one
    thread meanwhile, the caller's BLAS setting restored after. tick(frac 0..1): progress, called on the caller's thread.
    The output does not depend on threads."""
    with ThreadPoolExecutor(threads or default_threads()) as ex, blas_threads(1):
        return _tracks(xy, vis, fps, period_frames, aspect, axis, new, pinned, conf, group_fit, ex, tick or (lambda f: None))


def _tracks(xy, vis, fps, period_frames, aspect, axis, new, pinned, conf, group_fit, ex, tick):
    xy, vis = np.asarray(xy, float), np.asarray(vis, bool)
    if pinned is not None:
        pinned = np.asarray(pinned, int)
        free = pinned == 0
        g = _tracks(xy[:, free], vis[:, free], fps, period_frames, aspect, axis, new, None, None, False, ex, lambda f: tick(0.9 * f))
        lab, part = np.full(vis.shape, -1, np.int8), np.zeros(vis.shape, np.int8)
        lab[:, free], part[:, free] = g["labels"], g["part"]
        g["labels"], g["part"], g["share"], g["part_share"] = lab, part, g["share"] * free.mean(), g["part_share"] * free.mean()
        g |= sem_tracks(xy, vis, fps, aspect, pinned, lab, part, g["cam"], conf, group_fit, ex)
        tick(1.0)
        return g
    if new is not None and not np.all(new):
        new = np.asarray(new, bool)
        r = new.mean()
        g = _tracks(xy[new], vis[new], fps * r, period_frames and period_frames * r, aspect, axis, None, None, None, False, ex, tick)
        return {k: v[np.cumsum(new) - 1] for k, v in g.items()}
    T, N = vis.shape
    q = xy * [aspect, 1.0]
    P = period_frames
    # 8 s windows: the gold-set probe (experiments/groups/RESULTS.md) puts 1.5 s worst, 8 s+ flat
    W = max(8, int(round(6 * P if P else 8 * fps)))
    L = int(np.clip(1.5 * P if P else 1.5 * fps, 0.6 * fps, 3 * fps))
    dd = q - uniform_filter1d(q, max(3, min(L, T)), axis=0, mode="nearest")
    if T <= W:
        W, starts = T, [0]
    else:
        starts = list(range(0, T - W + 1, max(1, int(round(0.5 * fps)))))
        if starts[-1] + W < T:
            starts.append(T - W)
    hop = max(1, int(round(0.5 * fps)))

    def prep(a, cam=None, pos=None):
        v = vis[a:a + W]
        elig = v.mean(0) >= ELIG
        w = v & elig
        if cam is None:  # per frame the median displacement of the window's members (np.median of each frame's, vectorised)
            x = dd[a:a + W]
            cam = np.where(w.any(1)[:, None], _nanmed(np.where(w[..., None], x, np.nan), 1), 0.0)
            cam[(w[..., None] & np.isnan(x)).any(1)] = np.nan
        return v, elig, w, dd[a:a + W] - cam[:, None], np.median(q[a:a + W], 0) if pos is None else pos, cam

    def first(a):  # pass 1 for one window (independent of the others: the thread pool's unit)
        v, elig, w, d, pos, cam = prep(a)
        lab = cluster(d, v, elig, pos)
        amp0 = np.sqrt((v[..., None] * dd[a:a + W] ** 2).sum((0, 2)) / np.maximum(v.sum(0), 1))  # raw amp (docstring)
        # ahead of pass 2 (sequential): the bodies' fits on these clusters' member sets, which sticky mostly keeps
        return lab, _contrast(d, w, lab), (cam, pos, amp0), body_memo(dd[a:a + W], q[a:a + W], w, lab, MAX_G, pos)
    labs, score, keep, memos = [], [], [], []
    for k, (lab, sc, kp, mo) in enumerate(ex.map(first, starts)):  # pass 1: cluster every window; the seed window =
        labs.append(lab)                                           # the clearest motion contrast
        score.append(sc)
        keep.append(kp)
        memos.append(mo)
        tick(0.6 * (k + 1) / len(starts))
    s0 = max(range(len(starts)), key=lambda i: score[i])
    st = {"mem": np.zeros(N, int), "used": np.zeros(MAX_G, bool), "est": np.zeros(MAX_G, bool),
          "born": np.zeros(MAX_G, int), "last": np.full(MAX_G, -1), "sync": np.zeros((MAX_G, MAX_G), int), "wi": 0,
          "pslots": [[None] * MAX_PARTS for _ in range(MAX_G)], "plast": np.full((MAX_G, MAX_PARTS), -1)}
    conf_w, merge_w, dorm_w = (max(1, round(x * fps / hop)) for x in (CONFIRM_S, MERGE_SYNC_S, DORMANT_S))
    wins, snap = {}, None
    for n_done, wi in enumerate(list(range(s0, len(starts))) + list(range(s0 - 1, -1, -1))):  # forward from the seed,
        if wi == s0 - 1:                                                                        # then backward
            st = snap
        a = starts[wi]
        cam, pos, amp0 = keep[wi]
        v, elig, w, d, pos, _ = prep(a, cam, pos)
        tick(0.6 + 0.3 * n_done / len(starts))
        out = sticky(labs[wi], d, w, pos, q[a:a + W] - dd[a:a + W], st, wi == s0, conf_w, merge_w, dorm_w)
        out, prt, vc = window_parts(dd[a:a + W], q[a:a + W], v, w, out, MAX_G, memos[wi], pos)  # bodies -> parts
        memos[wi] = None
        st["mem"][out > 0] = out[out > 0]
        pout = np.zeros(N, int)
        for g in range(1, MAX_G + 1):
            loc = [j for j in range(1, MAX_PARTS + 1) if ((out == g) & (prt == j)).any()]
            for j, k in zip(loc, carry([set(np.flatnonzero((out == g) & (prt == j))) for j in loc], st["pslots"][g - 1], st["plast"][g - 1], st["wi"], J_MIN)):
                pout[(out == g) & (prt == j)] = k + 1

        def cents(a, v, vc, out, pout):  # the window's centroids: nothing in pass 2 reads them (the pool's)
            pcs = [[centroid(q[a:a + W], v, np.flatnonzero((out == g) & (pout == j))) for j in range(1, MAX_PARTS + 1)] for g in range(1, MAX_G + 1)]
            return [centroid(q[a:a + W], vc, np.flatnonzero(out == g)) for g in range(1, MAX_G + 1)], pcs
        wins[wi] = (a, out, amp0, pout, ex.submit(cents, a, v, vc, out, pout))
        if wi == s0:
            snap = copy.deepcopy(st)
    for i in range(len(starts)):
        a, o, amp0, po, f = wins[i]
        cs, pcs = f.result()
        wins[i] = a, o, cs, amp0, po, pcs
    wins = [wins[i] for i in range(len(starts))]
    A = np.array([w[0] for w in wins])
    t = np.arange(T)
    pick = np.argmin(np.where((A[None] <= t[:, None]) & (t[:, None] < A[None] + W), np.abs(t[:, None] - A[None] - W / 2), np.inf), 1)
    amp0 = np.array([wins[k][3] for k in pick])
    # labels and centroids: vote / cross-fade of the covering windows (triangular weights), so a window change does
    # not step them; a window votes only for the points eligible in it
    num, den = np.zeros((T, MAX_G, 2)), np.zeros((T, MAX_G, 1))
    vote = np.zeros((T, N, MAX_G + 2), np.float32)
    pnum, pden = np.zeros((T, MAX_G, MAX_PARTS, 2)), np.zeros((T, MAX_G, MAX_PARTS, 1))
    pvote = np.zeros((T, N, MAX_PARTS + 1), np.float32)
    for a, o, cs, _, po, pcs in wins:
        wt = (1 + 1e-3 - np.abs(np.arange(W) + 0.5 - W / 2) / (W / 2))[:, None, None]
        e = np.flatnonzero(o > -2)
        vote[a:a + W, e, o[e] + 1] += wt[:, :, 0]
        c = np.stack(cs, 1)
        ok = np.isfinite(c[..., :1])
        num[a:a + W] += np.where(ok, c, 0) * wt
        den[a:a + W] += ok * wt
        e = np.flatnonzero(o > 0)  # parts: voted by the windows where the point is in a body
        pvote[a:a + W, e, po[e]] += wt[:, :, 0]
        c = np.array(pcs).transpose(2, 0, 1, 3)
        ok = np.isfinite(c[..., :1])
        pnum[a:a + W] += np.where(ok, c, 0) * wt[..., None]
        pden[a:a + W] += ok * wt[..., None]
    cent = np.where(den > 0, num / np.maximum(den, 1e-12), np.nan)
    labels = np.where(vote.any(2), vote.argmax(2) - 1, -1).astype(np.int8)
    # ponytail: a point that changed body keeps its part votes from the old one; parts are per body slot
    part = np.where((labels > 0) & pvote.any(2), pvote.argmax(2), 0).astype(np.int8)
    pcent = np.where(pden > 0, pnum / np.maximum(pden, 1e-12), np.nan)
    # camera: reference set per frame (module docstring)
    cam, cam_conf = np.zeros((T, 2)), np.zeros(T)
    co = vis[1:] & vis[:-1]
    for i in range(1, T):
        c, a = co[i - 1], amp0[i]
        s, m = c & (labels[i] == 0), c & (labels[i] > 0)
        if not (s.sum() >= 3 and m.any() and np.median(a[s]) <= np.median(a[m])):
            s = c & (a < max(0.0025, 0.25 * np.percentile(a[c], 90))) if c.any() else c
        if s.sum() >= 3:
            cam[i], cam_conf[i] = np.median(q[i, s] - q[i - 1, s], 0), s.sum() / c.sum()
    cam_conf[0] = cam_conf[min(1, T - 1)]
    cam = np.cumsum(cam, 0)
    cent = cent - cam[:, None]
    share = np.stack([(labels == g).mean(1) for g in range(1, MAX_G + 1)], 1)
    cent[share == 0] = np.nan
    pshare = np.stack([np.stack([((labels == g) & (part == j)).mean(1) for j in range(1, MAX_PARTS + 1)], 1)
                       for g in range(1, MAX_G + 1)], 1)
    pcent = pcent - cam[:, None, None]
    pcent[pshare == 0] = np.nan
    n_groups = (share > 0).sum(1)
    pair_dist = np.full(T, np.nan)
    rank = share.sum(0) + 1e-9 * np.arange(MAX_G, 0, -1)  # "largest" by scene total, so the pair only changes
    order = np.argsort(-np.where(share > 0, rank, -1), 1)[:, :2]  # when a group comes or goes
    key = np.where(n_groups >= 2, np.sort(order, 1) @ [MAX_G, 1], -1)
    rel = np.take_along_axis(cent, np.sort(order, 1)[..., None], 1)
    rel = rel[:, 0] - rel[:, 1]
    i = 0
    while i < T:  # runs of the same pair: one axis per run
        j = i
        while j < T and key[j] == key[i]:
            j += 1
        r = rel[i:j]
        ok = np.isfinite(r[:, 0])
        roll = rolling_axes(r[ok], max(8, int(round(4 * fps))), max(1, int(round(fps)))) if key[i] >= 0 and axis is None and ok.sum() else None
        if roll is not None:  # the axis turns over the run (orbit / turntable): each frame its own window's axis
            s = np.full(j - i, np.nan)
            s[ok] = (r[ok] * roll[0]).sum(1)
            pair_dist[i:j] = s if np.nanmean(s) >= 0 else -s
        elif key[i] >= 0 and ok.any():
            u = axis
            if u is None:
                c = r[ok] - r[ok].mean(0)
                u = np.linalg.eigh(c.T @ c)[1][:, -1] if ok.sum() >= 3 else r[ok].mean(0)
            u = np.asarray(u, float) / (np.hypot(*u) + 1e-12)
            s = np.where(ok, r @ u, np.nan)
            pair_dist[i:j] = s if np.nanmean(s) >= 0 else -s
        i = j
    sim, prel, pscale = group_params(dd, q, vis, labels, part, MAX_G, ex)
    tick(1.0)
    return {"labels": labels, "cent": cent / [aspect, 1.0], "share": share, "n_groups": n_groups,
            "pair_dist": pair_dist, "cam": cam / [aspect, 1.0], "cam_conf": cam_conf,
            "scale": sim[..., 2], "rot": sim[..., 3], "part": part, "part_cent": pcent / [aspect, 1.0],
            "part_share": pshare, "part_rel": prel / [aspect, 1.0], "part_scale": pscale}


N_SEM = 3  # pinned groups (points.SEM: penis, balls, hips)
# v4.14 rigid fit per pinned group (group_fit): robust similarity from the members' reference configuration
FIT_FLOOR = 1 / 384  # residual scale floor (frame heights: 1 px at CoTracker3's 384 px input)
FIT_K = 3.0          # Tukey cut = FIT_K x max(1.4826 x median residual, FIT_FLOOR)
FIT_ITERS = 6
FIT_GOOD = 0.5       # a frame teaches members seen for the first time (re-seeds) their reference only with this inlier share
SIZE_RANGE = (0.25, 4.0)  # a fitted scale outside this is degenerate: the previous scale is kept


def _wmed(x, w):
    """Weighted median of the real values x."""
    o = np.argsort(x)
    c = np.cumsum(w[o])
    return float(x[o][np.searchsorted(c, c[-1] / 2)])


def robust_sim(R, Q, w, a0=1.0):
    """Q ~ a R + b, complex points (x + i y, aspect-scaled), weights w > 0, by IRLS: start = a0 with b the weighted median
    offset (outliers below half never drag it), then Tukey-biweighted least squares (cut FIT_K x the robust residual scale,
    >= FIT_FLOOR). One point: a0 and the offset. -> (a, b, inlier (n,) bool)."""
    R, Q, w = np.asarray(R, complex), np.asarray(Q, complex), np.asarray(w, float)
    a = complex(a0)
    e = Q - a * R
    b = complex(_wmed(e.real, w), _wmed(e.imag, w))
    if len(R) < 2:
        return a, b, np.ones(len(R), bool)
    for _ in range(FIT_ITERS):
        r = np.abs(Q - a * R - b)
        u = np.minimum(r / (FIT_K * max(1.4826 * float(np.median(r)), FIT_FLOOR)), 1.0)
        ww = w * (1 - u ** 2) ** 2
        sw = ww.sum()
        if (ww > 0).sum() < 2 or sw <= 0:
            break
        rm, qm = (ww * R).sum() / sw, (ww * Q).sum() / sw
        den = (ww * np.abs(R - rm) ** 2).sum()
        an = (ww * np.conj(R - rm) * (Q - qm)).sum() / den if den > 1e-12 else a
        a = an if SIZE_RANGE[0] <= abs(an) <= SIZE_RANGE[1] else a
        b = qm - a * rm
    r = np.abs(Q - a * R - b)
    return a, b, r < FIT_K * max(1.4826 * float(np.median(r)), FIT_FLOOR)


def rigid_fit(q, vis, w=None):
    """v4.14 group_fit: a pinned group's motion as a robust similarity from its reference configuration.
    q (T, m, 2) aspect-scaled member positions, vis (T, m), w (T, m) per-point confidence (NaN / None = 1).
    Reference: the frame with the most visible members (t0) gives each member visible there its reference position;
    frames are walked outward from t0 (forward, then backward), each fitted by robust_sim (started from the previous
    frame's a) on the visible members with a reference, weighted by w; a member first seen later (a re-seed) gets the fit
    inverted at its first frame with >= 3 inliers and an inlier share >= FIT_GOOD as its reference. -> (centre (T, 2): the
    fit applied to the reference centroid, so a member dropping out or sliding off does not move it; size (T,) |a| (1 = as
    on t0); rot (T,) angle of a (radians, > 0 = clockwise on screen); fit (T,) inlier share of the visible members'
    weight); all NaN on frames without a visible member with a reference."""
    q, vis = np.asarray(q, float), np.asarray(vis, bool)
    T, m = vis.shape
    out = np.full((T, 2), np.nan), np.full(T, np.nan), np.full(T, np.nan), np.full(T, np.nan)
    if not m or not vis.any():
        return out
    Z = q[..., 0] + 1j * q[..., 1]
    W = np.ones((T, m)) if w is None else np.where(np.isfinite(w), np.clip(np.nan_to_num(w), 1e-3, None), 1.0)
    t0 = int(np.argmax(vis.sum(1)))
    R = np.full(m, np.nan, complex)
    R[vis[t0]] = Z[t0, vis[t0]]
    c0 = R[vis[t0]].mean()
    cent, size, rot, fit = out
    a = 1.0
    for t in [*range(t0, T), *range(t0 - 1, -1, -1)]:
        if t == t0 - 1:
            a = 1.0
        k = vis[t] & np.isfinite(R)
        if not k.any():
            continue
        a, b, inl = robust_sim(R[k], Z[t, k], W[t, k], a)
        fit[t] = (W[t, k] * inl).sum() / W[t, k].sum()
        z = a * c0 + b
        cent[t], size[t], rot[t] = (z.real, z.imag), abs(a), np.angle(a)
        new = vis[t] & ~np.isfinite(R)
        if new.any() and inl.sum() >= 3 and fit[t] >= FIT_GOOD:
            R[new] = (Z[t, new] - b) / a
    return out


def sem_tracks(xy, vis, fps, aspect, pinned, labels, part, cam, conf=None, group_fit=False, ex=None):
    """Pinned semantic groups (fixed members, pinned == s, s = 1..max(N_SEM, pinned.max())) -> dict:
      sem_cent (T,S,2)   centroid of the visible members (seed-anchored, as the groups'), camera removed, normalized
      sem_share (T,S)    visible members / all points (0 = none visible: the group is absent on that frame)
      sem_body (S,)      the body around the group: the scene's most frequent moving label among the 6 nearest free
                         visible points of its centroid (sampled twice a second), 0 = none
      v4.14 group_fit (conf (T, N): per-point confidence weights or None): sem_cent comes from rigid_fit instead of
      the seed-anchored centroid, and sem_size / sem_rot / sem_fit (T,S) are its size (1 = as on its reference frame),
      rotation (radians, > 0 = clockwise on screen) and inlier share
      sem_rel (T,S,2)    the members' mean high-passed displacement minus the body's similarity model there (as a
                         part's rel); NaN without a body
      sem_scale (T,S)    scale term of a similarity fitted to that residual (to the high-passed motion without a body):
                         the group's own contraction / swelling (NaN with < 3 visible members)"""
    T, N = vis.shape
    q = xy * [aspect, 1.0]
    L = int(np.clip(1.5 * fps, 0.6 * fps, 3 * fps))
    dd = q - uniform_filter1d(q, max(3, min(L, T)), axis=0, mode="nearest")
    r = q - dd
    S = max(N_SEM, int(pinned.max()))  # v4.11: user groups take ids 4, 5, ...
    out = {"sem_cent": np.full((T, S, 2), np.nan), "sem_share": np.zeros((T, S)), "sem_body": np.zeros(S, int),
           "sem_rel": np.full((T, S, 2), np.nan), "sem_scale": np.full((T, S), np.nan)}
    if group_fit:
        out |= {k: np.full((T, S), np.nan) for k in ("sem_size", "sem_rot", "sem_fit")}
    free = pinned == 0
    pc = np.flatnonzero(pinned > 0)
    run = ex.map if ex is not None else map
    sems, todo, trees = [], {}, {}  # (s, w, body | None); body label -> its members (fitted once for every group on it)
    for s in range(1, S + 1):
        idx = np.flatnonzero(pinned == s)
        if not len(idx):
            continue
        w = vis & (pinned == s)
        c = centroid(q, vis, idx)
        if group_fit:
            c, *sr = rigid_fit(q[:, idx], vis[:, idx], None if conf is None else conf[:, idx])
            for k, x in zip(("sem_size", "sem_rot", "sem_fit"), sr):
                out[k][:, s - 1] = x
        out["sem_cent"][:, s - 1] = c - cam * [aspect, 1.0]
        out["sem_share"][:, s - 1] = w.sum(1) / N
        votes = []
        for i in range(0, T, max(1, int(round(fps / 2)))):
            f = np.flatnonzero(free & vis[i])
            if len(f) >= 3 and np.isfinite(c[i, 0]):
                if i not in trees:  # the frame's free points: one tree for every group
                    trees[i] = cKDTree(q[i, f])
                nb = labels[i, f[trees[i].query(c[i], min(K_NB, len(f)))[1]]]
                if (nb > 0).sum() * 2 > len(nb):
                    votes.append(np.bincount(nb[nb > 0]).argmax())
        b = None
        if votes:
            b = out["sem_body"][s - 1] = int(np.bincount(votes).argmax())
            todo.setdefault(b, vis & (labels == b) & (part == 0))
        sems.append((s, w, b))

    def body(m):  # the body's fit and the residual dd - its model, on the pinned columns only (nothing else reads it)
        P, cc, _ = fit(dd, r, m)
        e = np.zeros_like(dd)
        e[:, pc] = dd[:, pc] - predict(np.nan_to_num(P), cc, r[:, pc])
        return P, cc, e
    bodies = dict(zip(todo, run(body, todo.values())))  # paw-iyl3: was ~3 s each at 3000 frames x 2458 points

    def one(sw):
        s, w, b = sw
        e, rel = dd, None
        if b is not None:
            P, cc, e = bodies[b]
            n = w.sum(1)
            ok = (n > 0) & np.isfinite(P[:, 0])
            rel = ok, ((e * w[..., None]).sum(1) / np.maximum(n, 1)[:, None])[ok]
        return rel, fit(e, r, w)[0][:, 2]
    for (s, _, _), (rel, sc) in zip(sems, run(one, sems)):
        if rel is not None:
            out["sem_rel"][rel[0], s - 1] = rel[1]
        out["sem_scale"][:, s - 1] = sc
    out["sem_cent"] /= [aspect, 1.0]
    out["sem_rel"] /= [aspect, 1.0]
    return out


def who_cent(xy, vis, pinned, ids, cam, aspect):
    """v4.12: one character's centre from its pinned groups (ids: their pts ids) -> (cent (T, 2) normalized, camera
    removed: the seed-anchored centroid of all their members, as a group's, so a member or a whole group dropping out
    does not move it; share (T,) of all points visible in them)."""
    T, N = vis.shape
    idx = np.flatnonzero(np.isin(pinned, list(ids)))
    q = np.asarray(xy, float) * [aspect, 1.0]
    c = centroid(q, vis, idx) - cam * [aspect, 1.0]
    return c / [aspect, 1.0], vis[:, idx].sum(1) / max(N, 1)


def axis_dist(a, b, aspect, axis=None):
    """v4.12: a - b (two (T, 2) normalized centres) on the stroke axis (axis: unit vector, aspect-scaled; None = the
    principal axis of their relative motion), frame heights, sign fixed so > 0 on average (like pair_dist: smaller =
    closer). NaN where either is absent; all NaN with < 2 shared frames."""
    r = (np.asarray(a, float) - np.asarray(b, float)) * [aspect, 1.0]
    ok = np.isfinite(r).all(1)
    out = np.full(len(r), np.nan)
    if ok.sum() < 2:
        return out
    u = axis
    if u is None:
        c = r[ok] - r[ok].mean(0)
        u = np.linalg.eigh(c.T @ c)[1][:, -1] if ok.sum() >= 3 else r[ok].mean(0)
    u = np.asarray(u, float) / (np.hypot(*u) + 1e-12)
    out[ok] = r[ok] @ u
    return out if np.nanmean(out) >= 0 else -out
