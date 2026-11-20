"""The point trackers' shared body (tapnext_points, and the optional cotracker_points): seeding (grid, lines, motion
layout, pinned groups), re-seeding (Reseed), seed frame, channels, overlay, and wrap() that turns any point runner's
per-point results into channels. No model code: a tracker module brings its runner and calls wrap().

Moved out of cotracker_points.py unchanged (paw-vdr4), so TAPNext++, the tagger and naming paths never need CoTracker3.
ROI: clicked points (tracked as given) or a box (auto-seeded with a grid or lines of points inside it). Per frame every
point gets a position and a visibility; the channels summarize them (units in the PROTOCOL-style table in README).
"""
import math
import sys
import urllib.request
from collections import deque
from itertools import chain, islice
from pathlib import Path

import cv2
import numpy as np

from pawtrack import MODELS_DIR
from pawtrack.motion_model import MAX_PARTS
from pawtrack import partlabel
from pawtrack.partlabel import fit_mask, texture
from pawtrack.progress import beat, pulling, stage, steps, sub
from pawtrack.registry import param

CACHE = MODELS_DIR / ".cache"  # trackers/.cache (gitignored), or the app's models folder (paw-cdot)
MAX_P = 4  # p0..p3 channels
BASE_CH = ["proj", "proj_cam", "vis_frac", "vis_extent", "vis_len", "dist01", "centroid_x", "centroid_y"] + \
          [f"p{k}_{a}" for k in range(MAX_P) for a in "xy"] + ["raw_px_cam", "raw_px", "primary_used"]
GROUP_CH = [f"g{g}_{a}" for g in range(1, 5) for a in "xyn"] + ["n_groups", "pair_dist", "cam_x", "cam_y", "cam_conf"]  # pawtrack.groups
GROUP_PROJ = [f"g{g}_proj" for g in range(1, 5)] + ["pair_proj"]
PART_CH = [f"g{g}_{a}" for g in range(1, 5) for a in ("scale", "rot")] + \
          [f"g{g}p{j}_{a}" for g in range(1, 5) for j in range(1, MAX_PARTS + 1) for a in ("x", "y", "n", "proj", "rel", "scale")]
SEM = ("penis", "balls", "hips")  # pinned semantic groups 1..3 (box_seeds; pts 6th element, sem_<name>_* channels)
SEM_CH = [f"sem_{s}_{a}" for s in SEM for a in ("x", "y", "n", "proj", "rel", "scale", "area")]
CHANNELS = BASE_CH + GROUP_CH + GROUP_PROJ + PART_CH + SEM_CH
PRIMARIES = ["auto", "centroid_auto", *BASE_CH[:-3], *GROUP_PROJ, *(f"sem_{s}_{a}" for a in ("proj", "area") for s in SEM)]
USED = {"proj": 0, "dist01": 1}  # primary_used channel: 0 = proj, 1 = dist01, 2 = anything else
HIPS_MIN = 0.5  # auto: sem_hips_proj when the pinned hips are present (n > 0) and _proj finite on >= this share of frames
DIST_RATIO = 0.5  # auto: dist01 when std(distance of clicks 0-1) >= this x std(centroid travel on the axis)
# re-seeding (Reseed): voids in the tracked cloud get fresh points mid-scene, in the same model stream
RESEED_CELLS = 64   # void lattice: at most this many cells over the ROI box (a box uses its seed grid's own layout)
RESEED_TEX = 6.0    # grey std (0..255) of a cell's central patch below which it is not seeded (flat: lost first)
RESEED_WHOLE = 0.8  # a box covering >= this share of the frame re-seeds anywhere; else inside the visible points' hull
RESEED_TRAVEL = True  # also check for voids as soon as the cloud has travelled one void cell (pans, orbits)
TRAVEL_LAG_MS = (500, 1000)  # ... net over every lag in this range (a reciprocal bob comes back within it: no check)
TRAVEL_GAP_MS = 250  # ... at most one check per this
# pinned groups (box_seeds' sem): at every check, members that do not move with their group over the last PRUNE_MS are
# retired and re-seeded inside the hull of the members that do (motion_outliers; the seed positions count as the first
# window's first sample)
PRUNE = True
PRUNE_MS = 1500        # window
PRUNE_SAMPLES = 4      # samples (Reseed calls: CoTracker3 online every 8 frames, TAPNext++ every chunk) a window needs
PRUNE_MIN = 5          # members judged (visible at the window's ends and on >= 3/4 of it) before a group is pruned
PRUNE_K = 3.0          # outlier: RMS residual to the group's similarity > this x the members' median ...
PRUNE_FLOOR = 1 / 384  # ... and > this (frame heights: 1 px at CoTracker3's 384 px input)
PRUNE_CORR = 0.3       # ... or, while the group moves, displacement correlation with the group's < this
PRUNE_MOVE = 3 / 384   # the group moves: RMS median displacement over the window >= this (frame heights)
FIT_MIN = 4            # paw-bs1o: visible members with a reference a pinned group's fit needs ...
FIT_INLIERS = 0.6      # ... of them inliers of the robust similarity ...
FIT_STEP = (1.25, 25.0)  # ... and its size / turn within this factor / degrees of the group's last fit ...
FIT_HOLD_MS = 3000     # ... that recent (older: any change is believed)
FIT_NEAR = 3           # a re-seed's place shows when one of its this many nearest layout neighbours is visible
GROUP_FLOOR = 0.6      # ... used while fewer than this share of a pinned group's initial members are visible (else the hull pick)
# paw-9qim: the hull pick puts every re-seed between the centroid and a member (0.3 .. 0.85 of the way), so a group's
# points contract re-seed by re-seed (owner runs: hull / painted 0.58 at the seed frame, 0.36 at the shot's end while
# the part kept its size). Re-seeding where the group's fit puts the lost point (group_fit's refit) keeps the hull
# (synthetic: 0.83 vs 0.44 at the end) but more re-seeds land off the part and the centres got worse (median error
# +35 %): left opt-in (group_fit); the app draws a group as its painted outline carried by its points instead.
# Seeding nearer the outline (a 640 px grid without the extra 1 px erode, 40 % of the points on the inset outline) put
# the hull at 0.71 on the seed frame but small parts' centres went 0.0095 -> 0.016 (real TAPNext++, generated clip):
# not taken (owner runs: points seeded < 0.5 % of the width inside the outline survive 0.45-0.57 vs 0.68-0.76 deeper).


# ---------------------------------------------------------------- shared helpers (also used by tapnext_points)

def point_cap(n, p, grow=1.0):
    """Most points a run tracks at once: the initial n x grow (a tracker whose memory barely depends on n gives
    re-seeds room; TAPNext++ stays at 1.0 = constant VRAM), or max_points when the user opts in to more."""
    return max(int(round(n * grow)), p.get("max_points") or 0)


class Reseed:
    """Single-pass re-seeding. The point runner calls it before a forward step with that step's first frame:
    rs(t, img (H, W, 3) RGB at the model's input res, xy (M, 2), vis (M,)) -> (slots, new): new = (K, 2)
    normalized seeds on that frame, slots (K,) = the active slots they take: a retired point's slot (its model
    state is reset in place), or M, M+1, ... (appended; only below an opted-in max_points). xy / vis: the latest
    tracked positions of the active slots (may lag a few frames). ids: global output index of each slot (-1 =
    support point, never output); it is replaced (not mutated) on a change, so the rows a runner yields belong to
    the ids current when they are received.
    Void = a lattice cell (RESEED_CELLS over the ROI box, extended over the frame; clicks: 8 x 8 over the frame)
    whose centre lies in the region (whole frame for a box >= RESEED_WHOLE, else the hull of the visible points)
    and holds no visible point. Checked every reseed_every_ms; fires only when there are more voids than the
    seed layout itself leaves (lines, clicks), seeds the textured void cells at their centres, most textured
    first, into the slots of retired points: hidden > retire_ms or off-frame (off-frame first, then longest
    hidden; clicks never). The active count stays the initial n (constant VRAM) unless max_points opts in to more.
    Nothing is retired unless a seed takes the slot, so a scene without voids is untouched.
    Travel (RESEED_TRAVEL): between the timed checks a check also runs when the cloud's net displacement (median over
    the points visible on both calls) is at least one void cell since the last check AND over every lag of
    TRAVEL_LAG_MS (a progressive pan / orbit; a reciprocal bob returns within that window, so it does not trigger).
    lattice: (cell count, base) for a box from box_seeds (default: min(RESEED_CELLS, n) cells, base = the voids the
    seeds leave); the motion layout passes its lattice's flat cells as base, so every textured empty cell is a void.
    sem (n,): pinned group per seed (box_seeds; 0 = free). A pinned point is never retired for a void; when it is
    retirable, or (PRUNE) a motion outlier of its group over the last PRUNE_MS (prune), it is re-seeded inside the
    convex hull of its group's visible inliers (>= 3), on textured pixels first, keeping its group: sem_out (per output
    index) carries it; pruned[s] counts group s's pruned points. aspect: W / H of the frame (the similarity fit).
    masks: t -> {group id: bool (h, w) mask over the frame} (partlabel.track_masks) or None. A group with a mask is
    judged by it instead of by its motion: a member outside its mask (or hidden) for longer than retire_ms is retired
    and re-seeded on the current mask's pixels (pick_in, textured first); an empty mask re-seeds nothing.
    Soft cuts (PROTOCOL v4.9; soft: their times in this pass's clock, redetect: img -> {group id: bool mask over the
    frame} (the tagger's CAM regions) or None): the first call at or after a soft cut runs a check whatever the clock,
    with three differences: every hidden or off-frame point is retirable at once (not after retire_ms); the void region
    also takes the ROI box's own cells (the box re-applied where the frame now shows it); and where redetect finds a
    pinned group's region while fewer than half of the group's initial members are visible, the group is refilled on
    that region (pick_in, textured first) up to its initial count, keeping its group id (its own retired slots first,
    then free retired ones). Visible points, their ids and their groups are kept; the count stays the cap
    (retire-before-admit: off-frame first, then longest hidden); voids beyond the free slots wait for the next check.
    v4.14 group_fit (p): a pinned point to re-seed (no mask) goes where the similarity from its group's visible slots'
    references to now puts its own reference (refit; the hull pick when that is off-frame); ref keeps it per slot.
    paw-bs1o (v4.51): the same for any pinned group while under GROUP_FLOOR of its initial members show, from a robust,
    change-capped fit (refit), only where a layout neighbour is visible (free_near) and off the other character's
    groups (over_other; whos: group id -> who of the painted groups); a pruned member still gets the hull pick.
    paw-adxi: sections [(group id, bool mask (h, w) over the seed frame)] are the knot sections (knot_members), hold (n,)
    each seed's section (1-based, 0 = none). A section member waits for its section instead of a hull pick or a pick on
    its group's mask (the knot goes inside the partner: a re-seed onto the rest of the shaft lost it for good); the
    own-place re-seed (under the floor) keeps it. Every re-seed whose place in its group's layout (its reference, else
    its birth position) is inside a section of its group joins it; hold_out carries the section per output index."""

    def __init__(self, roi, seed, n_click, n_support, p, t0, grow=1.0, lattice=None, sem=None, aspect=1.0, masks=None,
                 soft=(), redetect=None, whos=None, sections=(), hold=None):
        n = len(seed)
        self.ids = np.r_[np.arange(n), np.full(n_support, -1)]
        self.n_out, self.n_click, self.born, self.dropped = n, n_click, {}, 0  # born: output index -> (t, (x, y))
        self.every, self.retire, self.cap = p["reseed_every_ms"], p["retire_ms"], point_cap(n, p, grow)
        sem = np.zeros(n, int) if sem is None else np.asarray(sem, int)
        self.sem, self.sem_out = np.r_[sem, np.zeros(n_support, int)], list(sem)  # per slot / per output index
        x, y, w, h = (float(roi[k]) for k in "xywh") if roi["kind"] == "box" else (0.0, 0.0, 1.0, 1.0)
        k, base = lattice or (None, None)
        k = (k or min(RESEED_CELLS, n)) if roi["kind"] == "box" else RESEED_CELLS
        nx, ny = _cells(k, w, h)
        self.half = np.array([w / nx, h / ny]) / 2
        cx, cy = (np.arange(np.floor(-o / s), np.ceil((1 - o) / s)) * s + o + s / 2 for o, s in ((x, w / nx), (y, h / ny)))
        c = np.stack(np.meshgrid(cx, cy), -1).reshape(-1, 2)
        self.cells = c[((c >= 0) & (c <= 1)).all(1)]
        self.whole = roi["kind"] == "box" and w * h >= RESEED_WHOLE
        self.last = np.full(len(self.ids), float(t0))  # last time each active slot was visible
        self.next = t0 + self.every
        self.base = len(self.voids(seed, np.ones(n, bool))) if base is None else base
        self.hist, self.chk, self.t_chk, self.travel_checks = deque(maxlen=64), None, float(t0), 0  # (t, ids, xy, vis)
        self.aspect, self.pruned, self.masks = aspect, {}, masks
        self.last_in = self.last.copy()  # last time each active slot was visible inside its group's mask (masks)
        self.seed_sample = (float(t0), self.ids.copy(), np.r_[np.asarray(seed, float), np.full((n_support, 2), np.nan)],
                            np.r_[np.ones(n, bool), np.zeros(n_support, bool)])
        self.soft, self.redetect, self.soft_checks, self.refilled = sorted(c for c in soft if c > t0), redetect, 0, {}
        self.n0 = {int(g): int((sem == g).sum()) for g in np.unique(sem[sem > 0])}  # initial members per pinned group
        self.box = (x, y, x + w, y + h) if roi["kind"] == "box" else None
        # v4.14 group_fit: each slot's reference position (aspect-scaled; the seed, or where the group's fit put its
        # re-seed), so a lost pinned point is re-seeded where the group's similarity from those references puts it
        self.fit = bool(p.get("group_fit"))   # v4.14 group_fit: every lost pinned member goes to its fitted place (not only under the floor)
        self.whos, self.fits = dict(whos or {}), {}   # paw-bs1o: pinned group id -> its character; id -> (a, b, t) last fit
        self.inset = float(p.get("seed_inset", SEED_INSET) or 0)   # v4.33: re-seeds on a tracked mask keep off its outline too
        self.ref = np.r_[np.asarray(seed, float), np.full((n_support, 2), np.nan)] * [aspect, 1.0]
        hold = np.zeros(n, int) if hold is None else np.asarray(hold, int)
        self.sections, self.hold, self.hold_out = list(sections), np.r_[hold, np.zeros(n_support, int)], list(hold)

    def section_of(self, P, grp):
        """paw-adxi: the knot section (1-based, 0 = none) of layout places P (k, 2) normalized, of groups grp (k,)."""
        out = np.zeros(len(P), int)
        P = np.asarray(P, float).reshape(-1, 2)
        for s, (gid, m) in enumerate(self.sections):
            h, w = m.shape
            ij = np.clip(np.floor(np.nan_to_num(P, nan=-1.0) * [w, h]).astype(int), 0, [w - 1, h - 1])
            inside = (np.asarray(grp) == gid) & np.isfinite(P).all(1) & ((P >= 0) & (P <= 1)).all(1) & m[ij[:, 1], ij[:, 0]]
            out[inside & (out == 0)] = s + 1
        return out

    def shift(self, a, xy, vis):
        """Net displacement in void cells (max over x / y of the median) from sample a = (t, ids, xy, vis) to now,
        over the slots that hold the same point and are visible on both; None below 3 such points."""
        _, ia, xa, va = a
        k = len(ia)
        ok = (ia == self.ids[:k]) & (ia >= 0) & va & vis[:k]
        if ok.sum() < 3:
            return None
        return float(np.max(np.abs(np.median(xy[:k][ok] - xa[ok], 0)) / (2 * self.half)))

    def travelled(self, t, xy, vis):
        lag = [h for h in self.hist if TRAVEL_LAG_MS[0] <= t - h[0] <= TRAVEL_LAG_MS[1]]
        ref = self.chk or (self.hist[0] if self.hist else None)  # the last check, else the oldest sample
        since = None if ref is None else self.shift(ref, xy, vis)
        if not lag or since is None or since < 1:
            return False
        d = [self.shift(h, xy, vis) for h in lag]
        return all(x is not None and x >= 1 for x in d)

    def voids(self, xy, vis, box=False):
        ok = vis[:len(xy)] & (self.ids[:len(xy)] >= 0) & ((xy >= 0) & (xy <= 1)).all(1)
        pts = xy[ok]
        occ = (np.abs(pts[None] - self.cells[:, None]) <= self.half).all(2).any(1)
        inbox = np.zeros(len(self.cells), bool)
        if box and self.box is not None:  # soft cut: the ROI box re-applied
            x0, y0, x1, y1 = self.box
            inbox = (self.cells[:, 0] >= x0) & (self.cells[:, 0] <= x1) & (self.cells[:, 1] >= y0) & (self.cells[:, 1] <= y1)
        if self.whole:
            region = np.ones(len(self.cells), bool)
        elif len(pts) >= 3 and np.ptp(pts, 0).min() > 1e-6:
            hull = cv2.convexHull(pts.astype(np.float32))
            region = np.array([cv2.pointPolygonTest(hull, (float(a), float(b)), False) >= 0 for a, b in self.cells])
        elif inbox.any():
            region = np.zeros(len(self.cells), bool)
        else:
            return np.zeros(0, int)
        return np.flatnonzero((region | inbox) & ~occ)

    def prune(self, s, t):
        """Slots of pinned group s that are motion outliers (motion_outliers) over the samples of the last PRUNE_MS
        (the latest is the current one), worst first, at most half of the members judged."""
        smp = [h for h in [self.seed_sample, *self.hist] if t - h[0] <= PRUNE_MS]
        if len(smp) < PRUNE_SAMPLES:
            return np.zeros(0, int)
        ids = smp[-1][1]
        k = np.flatnonzero((self.sem[:len(ids)] == s) & (ids >= 0))
        X, V = np.full((len(smp), len(k), 2), np.nan), np.zeros((len(smp), len(k)), bool)
        for i, (_, ia, xa, va) in enumerate(smp):
            j = k < len(ia)
            kk = k[j]
            ok = (ia[kk] == ids[kk]) & va[kk]
            X[i, j] = np.where(ok[:, None], xa[kk], np.nan)
            V[i, j] = ok
        judged = V[0] & V[-1] & (V.mean(0) >= 0.75)
        if judged.sum() < PRUNE_MIN:
            return np.zeros(0, int)
        bad, order = motion_outliers(X[:, judged], V[:, judged], self.aspect)
        drop = k[judged][order][:max(0, int(judged.sum()) // 2)]
        self.pruned[int(s)] = self.pruned.get(int(s), 0) + len(drop)
        return drop

    def refit(self, m, xy, s=None, t=None):
        """v4.14: the similarity (groups.robust_sim) from the references of the slots m (visible members) to xy now, as
        complex (a, b) in aspect-scaled coordinates; None with < FIT_MIN references, under FIT_INLIERS of them inliers,
        or (group s at time t, paw-bs1o) a size / turn change from the group's last accepted fit beyond FIT_STEP within
        FIT_HOLD_MS (one bad check cannot throw the group's place)."""
        from pawtrack.groups import robust_sim
        k = m[np.isfinite(self.ref[m, 0])]
        if len(k) < FIT_MIN:
            return None
        z = lambda a: a[:, 0] + 1j * a[:, 1]
        a, b, inl = robust_sim(z(self.ref[k]), z(xy[k] * [self.aspect, 1.0]), np.ones(len(k)))
        if inl.mean() < FIT_INLIERS:
            return None
        last = self.fits.get(s)
        if last is not None and t - last[2] < FIT_HOLD_MS:
            q = a / last[0]
            if abs(math.log(abs(q))) > math.log(FIT_STEP[0]) or abs(math.degrees(np.angle(q))) > FIT_STEP[1]:
                return None
        if s is not None:
            self.fits[s] = (a, b, t)
        return a, b

    def free_near(self, s, r, vis, M):
        """paw-bs1o: per slot of r (group s) whether one of its FIT_NEAR nearest members in the group's reference layout
        (ties included) is visible now: its place shows, so a re-seed there lands on the part, not on what covers it."""
        g = np.flatnonzero((self.sem == s) & np.isfinite(self.ref[:, 0]))
        v = np.zeros(len(self.ids), bool)
        v[:M] = vis[:M]
        out = np.zeros(len(r), bool)
        for j, i in enumerate(r):
            o = g[g != i]
            if np.isfinite(self.ref[i, 0]) and len(o):
                d = np.linalg.norm(self.ref[o] - self.ref[i], axis=1)
                out[j] = v[o[d <= 1.01 * np.sort(d)[min(FIT_NEAR, len(d)) - 1]]].any()   # ties count (a regular layout)
        return out

    def over_other(self, s, P, xy, vis, M):
        """paw-bs1o: per point of P (normalized) whether it lies in the hull of the visible members of a pinned group of
        the other character (whos), where a re-seed of group s must never land."""
        out = np.zeros(len(P), bool)
        w = self.whos.get(int(s))
        for s2, w2 in self.whos.items():
            if not w or not w2 or w2 == w:
                continue
            k = np.flatnonzero((self.sem[:M] == s2) & (self.ids[:M] >= 0) & vis[:M])
            if len(k) < 3:
                continue
            hull = cv2.convexHull((xy[k] * [self.aspect, 1.0]).astype(np.float32))
            out |= np.array([cv2.pointPolygonTest(hull, (float(x * self.aspect), float(y)), False) >= 0 for x, y in P], bool)
        return out

    def __call__(self, t, img, xy, vis):
        xy, vis = np.asarray(xy, float), np.asarray(vis, bool)
        self.last[vis] = t
        mk = self.masks(t) if self.masks else {}
        M = len(xy)
        inside = vis[:M] & (self.sem[:M] == 0)
        for s, m in mk.items():
            k = np.flatnonzero(self.sem[:M] == s)
            inside[k] = vis[k] & in_mask(m, xy[k])
        self.last_in[:M][inside | (vis[:M] & ~np.isin(self.sem[:M], list(mk)))] = t
        none = np.zeros(0, int), np.zeros((0, 2))
        moved = (RESEED_TRAVEL and t < self.next and t - self.t_chk >= TRAVEL_GAP_MS and self.travelled(t, xy, vis))
        self.hist.append((t, self.ids.copy(), xy.copy(), vis.copy()))
        soft = bool(self.soft) and t >= self.soft[0]  # a soft cut since the last call (v4.9)
        while self.soft and t >= self.soft[0]:
            self.soft.pop(0)
        if t < self.next and not moved and not soft:
            return none
        self.next, self.t_chk, self.chk = t + self.every, t, self.hist[-1]
        self.travel_checks += moved
        self.soft_checks += soft
        M = len(xy)
        off = np.zeros(len(self.ids), bool)
        off[:M] = ((xy < -0.02) | (xy > 1.02)).any(1)  # off-frame (TAPNext++ coordinates reach 1.002)
        hidden = np.ones(len(self.ids), bool)
        hidden[:M] = ~vis[:M]
        gone = (self.ids >= self.n_click) & ((t - self.last > self.retire) | off | (soft & hidden))
        slots, new, grp = [np.zeros(0, int)], [np.zeros((0, 2))], [np.zeros(0, int)]
        refs = {}  # v4.14: slot -> reference of a pinned re-seed placed by its group's fit (others: none)
        used = np.zeros(len(self.ids), bool)
        tx = None
        found = {}
        if soft and self.redetect is not None and self.n0:
            try:
                found = self.redetect(img) or {}
            except Exception as e:  # optional: a tagger failure costs the refill, never the track
                print(f"pawtrack: soft cut re-detect skipped: {type(e).__name__}: {e}", file=sys.stderr)
        for s, m in found.items():  # soft cut: a pinned group whose region is back but whose points are not
            s = int(s)
            if s in mk or s not in self.n0 or not np.any(m):
                continue
            live = int(((self.sem[:M] == s) & (self.ids[:M] >= 0) & vis[:M] & ~off[:M]).sum())
            if live * 2 >= self.n0[s]:
                continue
            own = np.flatnonzero(gone & (self.sem == s) & ~used)
            free = np.flatnonzero(gone & (self.sem == 0) & ~used)
            free = free[np.argsort(np.where(off[free], -np.inf, self.last[free]), kind="stable")]
            sl = np.r_[own, free][:self.n0[s] - live].astype(int)
            g = cv2.resize(img.astype(np.float32).mean(2), m.shape[::-1], interpolation=cv2.INTER_AREA)
            a = pick_in(inset_mask(m, self.inset, len(sl))[0], texture(g) >= RESEED_TEX, len(sl), np.random.default_rng(int(t)))
            slots.append(sl[:len(a)])
            new.append(a)
            grp.append(np.full(len(a), s))
            used[sl[:len(a)]] = True
            self.refilled[s] = self.refilled.get(s, 0) + len(a)
        for s in np.unique(self.sem[self.sem > 0]):  # pinned: re-seeded inside the hull of the group's visible inliers
            if s in mk:  # ... or on its current mask
                r = np.flatnonzero((self.sem == s) & ((t - self.last_in > self.retire) | off) & (self.hold == 0))   # paw-adxi: a knot member waits
                if len(r) and mk[s].any():
                    m = mk[s]
                    g = cv2.resize(img.astype(np.float32).mean(2), m.shape[::-1], interpolation=cv2.INTER_AREA)
                    a = pick_in(inset_mask(m, self.inset, len(r))[0], texture(g) >= RESEED_TEX, len(r), np.random.default_rng(int(t)))
                    slots.append(r[:len(a)])
                    new.append(a)
                    grp.append(np.full(len(a), s))
                continue
            if int(s) in found and used[self.sem == s].any():
                continue  # refilled on its region at this soft cut
            bad = self.prune(s, t) if PRUNE else np.zeros(0, int)
            gone[bad] = True
            r = np.flatnonzero(gone & (self.sem == s) & ~used)
            m = np.flatnonzero((self.sem[:M] == s) & (self.ids[:M] >= 0) & vis[:M] & ~off[:M] & ~gone[:M])
            if not len(r) or len(m) < 3:
                continue
            ab = self.refit(m, xy, int(s), t)
            if not self.fit and len(m) >= GROUP_FLOOR * self.n0.get(int(s), 0):
                ab = None   # a healthy group: the hull pick (on the part more often; it only shrinks the group slowly)
            hull_r = r[(self.hold[r] == 0) | np.isin(r, bad)]   # paw-adxi: a lost knot member waits for its section
            if ab is not None:
                # paw-bs1o: below the floor a lost member goes back to its own place in the group's layout under its robust fit
                # (the group keeps its extent; hull picks shrank it re-seed by re-seed to a sliver), only where a layout
                # neighbour shows (a place under an occluder waits), in frame and off the other character's groups. A
                # pruned member (it did not move with the group: its place is off the part) still gets a hull pick.
                fr = r[~np.isin(r, bad)]
                hull_r = r[np.isin(r, bad)]
                a, b = ab
                pos = a * (self.ref[fr, 0] + 1j * self.ref[fr, 1]) + b
                pos = np.c_[pos.real / self.aspect, pos.imag]
                ok = np.isfinite(pos[:, 0]) & ((pos >= 0) & (pos <= 1)).all(1) & self.free_near(s, fr, vis, M)
                ok[ok] = ~self.over_other(s, pos[ok], xy, vis, M)
                if ok.any():
                    refs.update({int(i): tuple(self.ref[i]) for i in fr[ok]})
                    slots.append(fr[ok])
                    new.append(pos[ok])
                    grp.append(np.full(int(ok.sum()), s))
            if len(hull_r):   # convex mixes of the centroid and each member (inside the hull), textured pixels first
                P = xy[m]
                c = P.mean(0)
                cand = (c + np.array([0.6, 0.3, 0.85])[:, None, None] * (P - c)[None]).reshape(-1, 2)
                if tx is None:
                    tx = texture(img.astype(np.float32).mean(2)) >= RESEED_TEX
                H, W = tx.shape
                on = tx[np.clip((cand[:, 1] * H).astype(int), 0, H - 1), np.clip((cand[:, 0] * W).astype(int), 0, W - 1)]
                cand = cand[np.argsort(~on, kind="stable")]
                pos = cand[np.arange(len(hull_r)) % len(cand)]
                last = self.fits.get(int(s))
                if last is not None:   # their place in the reference by the group's last fit (the layout stays whole)
                    zr = ((pos[:, 0] * self.aspect + 1j * pos[:, 1]) - last[1]) / last[0]
                    refs.update({int(i): (q.real, q.imag) for i, q in zip(hull_r, zr)})
                slots.append(hull_r)
                new.append(pos)
                grp.append(np.full(len(hull_r), s))
        v = self.voids(xy, vis, box=soft)
        if len(v) > self.base:
            g = img.astype(np.float32).mean(2)
            H, W = g.shape
            rx, ry = (max(2, int(r * s / 2)) for r, s in zip(self.half, (W, H)))  # central half of the cell
            tex = np.array([g[max(0, int(b * H) - ry):int(b * H) + ry, max(0, int(a * W) - rx):int(a * W) + rx].std()
                            for a, b in self.cells[v]])
            o = np.argsort(-tex, kind="stable")
            v = v[o][tex[o] >= RESEED_TEX]
            c = np.flatnonzero(gone & (self.sem == 0) & ~used)
            c = c[np.argsort(np.where(off[c], -np.inf, self.last[c]), kind="stable")]  # retire-before-admit
            grow = max(0, self.cap - int((self.ids >= 0).sum()))  # opted-in slots above the initial count
            sl = np.r_[c, len(self.ids) + np.arange(grow)][:len(v)].astype(int)
            slots.append(sl)
            new.append(self.cells[v[:len(sl)]])
            grp.append(np.zeros(len(sl), int))
        slots, new, grp = np.concatenate(slots).astype(int), np.concatenate(new), np.concatenate(grp)
        if not len(slots):
            return none
        k = self.n_out + np.arange(len(new))
        self.born.update({int(i): (t, tuple(s)) for i, s in zip(k, new)})
        self.dropped += int((slots < len(self.ids)).sum())
        a = int((slots >= len(self.ids)).sum())
        self.ids, self.last = np.r_[self.ids, np.zeros(a, int)], np.r_[self.last, np.zeros(a)]
        self.last_in = np.r_[self.last_in, np.zeros(a)]
        self.sem = np.r_[self.sem, np.zeros(a, int)]
        self.ref = np.r_[self.ref, np.full((a, 2), np.nan)]
        self.hold = np.r_[self.hold, np.zeros(a, int)]
        self.ids[slots], self.last[slots], self.sem[slots], self.n_out = k, float(t), grp, k[-1] + 1
        self.ref[slots] = [refs.get(int(i), (np.nan, np.nan)) for i in slots]
        self.last_in[slots] = float(t)
        self.sem_out += grp.tolist()
        if self.sections:   # paw-adxi: a re-seed whose layout place (its reference, else where it was born) is in a section joins it
            place = np.where(np.isfinite(self.ref[slots]), self.ref[slots] / [self.aspect, 1.0], new)
            self.hold[slots] = self.section_of(place, grp)
        else:
            self.hold[slots] = 0
        self.hold_out += self.hold[slots].tolist()
        return slots, new


def in_mask(m, xy):
    """bool mask (h, w) over the frame, xy (k, 2) normalized -> (k,) inside."""
    h, w = m.shape
    return m[np.clip((xy[:, 1] * h).astype(int), 0, h - 1), np.clip((xy[:, 0] * w).astype(int), 0, w - 1)]


def motion_outliers(X, V, aspect=1.0):
    """X (K, m, 2) normalized positions of a pinned group's members over a window, V (K, m) visible (V[0] all True).
    -> (bad (m,) bool, worst-first indices of the bad: static members, then by correlation, then by residual).
    bad: RMS residual to the group's robust similarity motion (motion_model.fit on the displacement from the first
    sample, aspect-scaled) > PRUNE_K x the members' median and > PRUNE_FLOOR; or, while the group moves (RMS of the
    members' median displacement >= PRUNE_MOVE), displacement correlation with that median < PRUNE_CORR (a member
    moving < 1/4 as much as the group: static, correlation 0)."""
    from pawtrack.motion_model import _nanmed, fit
    q = np.where(V[..., None], X, np.nan) * [aspect, 1.0]
    d = q - q[0]
    _, _, res = fit(np.nan_to_num(d), np.broadcast_to(np.nan_to_num(q[0]), q.shape), V)
    with np.errstate(all="ignore"):
        rms = np.sqrt(np.nanmean(np.where(V, res, np.nan) ** 2, 0))
    bad = np.nan_to_num(rms) > max(PRUNE_K * float(np.nanmedian(rms)), PRUNE_FLOOR)
    D = _nanmed(d, 1)  # (K, 2) the group's displacement
    mv = float(np.sqrt(np.nanmean((D ** 2).sum(1))))
    dz, Dz = np.nan_to_num(d), np.nan_to_num(D)[:, None]
    e = (dz ** 2).sum(2) * V
    corr = (dz * Dz).sum(2).sum(0) / np.sqrt(e.sum(0) * ((Dz ** 2).sum(2) * V).sum(0) + 1e-18)
    static = np.sqrt(e.sum(0) / np.maximum(V.sum(0), 1)) < 0.25 * mv
    if mv >= PRUNE_MOVE:
        corr = np.where(static, 0.0, corr)
        bad |= corr < PRUNE_CORR
    else:
        static[:], corr = False, np.ones(len(corr))
    o = np.lexsort((-np.nan_to_num(rms), corr, ~static))
    return bad, o[bad[o]]


def common_params():
    return [
        param("primary", "Primary signal", "choice", "auto", choices=PRIMARIES),
        param("box_seed", "Seed layout in the box", "choice", "grid",
              choices=["grid", "line", "motion"], hint="motion: more points where a quick flow pass sees motion"),
        param("box_points", "Points in the box", "int", 64, 4, 4096),
        param("group_points", "Points per group (0 = auto: 16+, more for bigger parts)", "int", 0, 0, 256,
              hint="0: the groups share the box's points, each at least 16 and more for a bigger part (all together at "
                   "most 3/4 of the box; total = box points). Above 0: every group gets this many points of its own on "
                   "top of the box's; total = box points + groups x this"),
        param("group_seed", "Group points placement", "choice", "spread", choices=["spread", "corners"],
              hint="spread: textured pixels 1 px inside the outline; corners: the strongest corners well inside it, "
                   "spread evenly (parts-first)"),
        param("seed_inset", "Seed inset (% of the part's width)", "float", SEED_INSET, 0.0, 40.0,
              hint="Points of a painted group go this far inside its outline: this share of the part's own narrower "
                   "dimension, within about 5-10 px at 1080p (0 = anywhere on the painted shape). The painted shape "
                   "itself is never changed"),
        param("group_fit", "Group motion from a rigid fit", "bool", False,
              hint="Parts-first: a pinned group's centre, size and rotation from a robust similarity fit over its points "
                   "(outliers down-weighted, lost points re-seeded where the fit puts them); adds sem_*_size / _rot / _fit"),
        param("axis", "Stroke axis for proj", "choice", "auto", choices=["auto", "vertical", "horizontal", "custom"]),
        param("axis_x0", "Custom axis: out end x (0-1)", "float", 0.5, 0.0, 1.0),
        param("axis_y0", "Custom axis: out end y (0-1)", "float", 0.3, 0.0, 1.0),
        param("axis_x1", "Custom axis: in end x (0-1)", "float", 0.5, 0.0, 1.0),
        param("axis_y1", "Custom axis: in end y (0-1)", "float", 0.7, 0.0, 1.0),
        param("gap_ms", "Bridge occlusion gaps up to (ms)", "int", 1000, 0, 10000, hint="The stroke-axis (proj) signals"),
        param("held_input", "Track new drawings only (twos/threes)", "choice", "auto", choices=["off", "auto", "on"]),
        param("reseed_every_ms", "Re-seed voids every (ms, 0 = off)", "int", 1000, 0, 10000),
        param("retire_ms", "Retire points hidden longer than (ms)", "int", 2000, 100, 60000),
        param("max_points", "Max active points (0 = the initial count)", "int", 0, 0, 4096,
              hint="CoTracker3 online: 1.5 x the initial count"),
        param("group_labels", "Name motion groups (tagger: penis, balls, tail, ...)", "bool", True),
        param("seed_frame", "Seed frame", "choice", "first", choices=["first", "auto"],
              hint="A drawn ROI seeds its own scene where it was drawn"),
        param("sem_groups", "Pin penis / balls / hips groups", "bool", True,
              hint="Box ROI: the tagger finds them on the seed frame"),
        param("sem_shape", "Pinned group outline at the seed frame", "choice", partlabel.SHAPE,
              choices=["cam", "grabcut", "sam"]),
        param("sem_track", "Follow pinned parts with SAM 2 masks", "bool", partlabel.SEM_TRACK,
              hint="Membership + sem_*_area; unmeasured, costs VRAM next to the tracker"),
    ]


HELD_LOOKAHEAD = 150  # frames buffered (at working res) to set the held_input threshold and the auto decision
# 99.9th, not loops' 99th: at 256-512 px a small moving part is < 1 % of the pixels (dev clip: 0.6 %), p99 sat in
# codec noise and hit the static guard on a clip on twos; p99.9 found step 2 / ratio 0.5 there and step 1 / 0.0 on ones
HELD_PCT = 99.9


def _work_frames(frames, wh):
    """(t, BGR) -> (t, BGR at the tracker's working res (same nearest resize as the tracker), HELD_PCT pct
    |grey diff| vs the previous frame (inf for the first))."""
    prev = None
    for t, bgr in frames:
        img = cv2.resize(bgr, wh, interpolation=cv2.INTER_NEAREST)
        g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
        yield t, img, np.inf if prev is None else float(np.percentile(np.abs(g - prev), HELD_PCT))
        prev = g


def drawings(frames, wh, mode, st):
    """held_input: yields only the frames that show a new drawing. Fills st: ts / new / d (every video frame),
    thr (None = nothing dropped). Threshold and auto decision (step >= 2) from the first HELD_LOOKAHEAD frames.
    ponytail: one lookahead calibration per scene; a scene that starts static and goes on twos is tracked on ones."""
    from pawtrack.loops import held_from_diffs
    it = _work_frames(frames, wh)
    head = list(islice(it, HELD_LOOKAHEAD))
    h = held_from_diffs([d for *_, d in head[1:]])
    st["thr"] = h["thr"] if mode == "on" or h["step"] >= 2 else None
    for t, img, d in chain(head, it):
        st["ts"].append(t)
        st["d"].append(d)
        st["new"].append(st["thr"] is None or d > st["thr"])
        if st["new"][-1]:
            yield t, img


def seed_points(roi, p):
    """ROI -> (N, 2) normalized seed points, number of user clicks (0 for a box).
    box/grid: nx x ny cell centres, nx / ny ~ box aspect, nx * ny ~ box_points.
    box/line: 3 lines along the box's long side (centre and +-25 % of the short side)."""
    if roi["kind"] == "points":
        pts = np.asarray(roi["points"], float).reshape(-1, 2)
        if not len(pts):
            raise ValueError("points roi needs at least one point")
        return np.clip(pts, 0, 1), len(pts)
    x, y, w, h = (float(roi[k]) for k in "xywh")
    n = p["box_points"]
    if p["box_seed"] != "line":  # grid (motion: its fallback without a buffered scene; box_seeds lays it on a frame)
        nx, ny = _cells(n, w, h)
        gx, gy = np.meshgrid((np.arange(nx) + 0.5) / nx, (np.arange(ny) + 0.5) / ny)
        uv = np.stack([gx.ravel(), gy.ravel()], 1)
    else:
        k = max(2, n // 3)
        along = (np.arange(k) + 0.5) / k
        lines = [np.stack([along, np.full(k, c)], 1) for c in (0.25, 0.5, 0.75)]
        uv = np.concatenate(lines)
        if h > w:
            uv = uv[:, ::-1]
    return np.clip(np.c_[x + uv[:, 0] * w, y + uv[:, 1] * h], 0, 1), 0


def _cells(n, w, h):
    """The grid layout: (nx, ny) with nx * ny ~ n, nx / ny ~ the box aspect (normalized units)."""
    ny = max(1, int(round(np.sqrt(n * h / max(w, 1e-6)))))
    return max(1, int(round(n / ny))), ny


# ---------------------------------------------------------------- motion-weighted box seeds (experiments/seedmotion)
# box_seed motion: a cheap CPU flow pass over the buffered scene says where things move; the box gets a uniform floor
# over its textured cells and spends the rest of its points there. Semantic regions (partlabel.sem_regions: penis,
# balls, hips from the tagger's CAM on the seed frame) get a pinned share of their own on top of any layout.
FLOW_W = 256        # px: the motion pass's width (aspect restored from the squashed buffer)
FLOW_FPS = 10       # pairs sampled per second of scene
FLOW_PRESET = cv2.DISOPTICAL_FLOW_PRESET_ULTRAFAST  # DIS preset (fast: 2.2x the cost, cell maps r 0.97 apart)
FLOW_HELD = 4.0     # a sampled pair whose p99.9 |grey diff| is below this is a held drawing: skipped
SEED_FLOOR = 0.25   # share of n laid as the uniform floor (at least 16 cells)
SEED_GAMMA = 0.5    # importance weight = capped motion energy ** gamma (0.5 / 1 / 2 within noise; 0.5 best F1)
SEED_CAP_PCT = 90   # energy capped at this percentile of the textured cells: one flapping part cannot take everything
SEED_FINE = 1024    # fine cells over the box (each >= 4 x 4 flow px) ...
SEED_SUB = 3        # ... each holding at most SEED_SUB^2 points on a jittered sub-lattice (minimum spacing)
SEED_TEX_MIN = 0.25  # share of textured lattice cells below which the motion layout ignores texture (dark / fading frame)
SEM_SHARE, SEM_MIN = 0.10, 6  # pinned semantic group: this share of n (at least SEM_MIN points), at most half of n in all


def group_total(p, k):
    """v4.14: points a box run seeds with k groups: box_points plus k x group_points (0 = the groups share the box)."""
    return int(p["box_points"]) + k * int(p.get("group_points") or 0)


def sem_budget(n, k):
    """Points per pinned group, k groups in a box of n points (v4.12): SEM_SHARE n each (>= SEM_MIN), all of them
    together at most n // 2: with many groups every share shrinks evenly to (n // 2) // k, which keeps SEM_MIN while
    n >= 2 SEM_MIN k (1024 points: 16 groups get 32 each; 64 points: 5 groups get 6, 16 groups 2); never below 1.
    Before v4.46 (group_counts); kept for reference and the tests."""
    return max(1, min(max(SEM_MIN, int(round(SEM_SHARE * n))), (n // 2) // max(k, 1)))


GROUP_MIN = 16      # v4.46 group_counts: every pinned group gets at least this many points (when the budget allows) ...
GROUPS_MAX = 0.75   # ... the groups together at most this share of the box's n (the grid keeps the rest: camera, voids)


def group_counts(n, areas):
    """v4.46: points per pinned group when group_points is 0 (paw-9qim). areas {name: the region's area (any unit)}.
    The groups' budget = SEM_SHARE n per group (the v4.12 average), at most GROUPS_MAX n, at least GROUP_MIN per group
    while that fits; each group gets GROUP_MIN (or an even share of a smaller budget), the rest of the budget split by
    sqrt(area) (largest remainder). Before (sem_budget) every group got the same share, at most n // 2 in all: 17
    painted parts in 512 points got 15 each, a hand like the hips. The total stays n (the grid takes the rest).
    Measured (real TAPNext++ 256 on a generated clip, 8 parts, 256 points: the grid 128 -> 64): small parts' centre
    error 0.0095 -> 0.0077 frame heights, p90 0.0117 -> 0.0111, image-space median unchanged; large parts 0.0067 ->
    0.0076 camera-relative (the smaller grid's camera)."""
    k = len(areas)
    if not k:
        return {}
    total = min(int(GROUPS_MAX * n), max(k * GROUP_MIN, k * int(round(SEM_SHARE * n))))
    base = max(1, min(GROUP_MIN, total // k))
    names = list(areas)
    w = np.sqrt(np.maximum([float(areas[s]) for s in names], 0.0))
    extra = max(0, total - base * k)
    share = extra * w / w.sum() if w.sum() > 0 else np.full(k, extra / k)
    got = np.floor(share).astype(int)
    for i in np.argsort(-(share - got), kind="stable")[:extra - int(got.sum())]:
        got[i] += 1
    return {s: base + int(g) for s, g in zip(names, got)}


def flow_grey(img, aspect):
    """BGR frame (any res, maybe squashed) -> grey uint8 at the motion pass's res (FLOW_W wide, aspect restored)."""
    wh = FLOW_W, max(8, int(round(FLOW_W / aspect)))
    return cv2.cvtColor(cv2.resize(img, wh, interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)


def flow_energy(imgs, ts, aspect):
    """One scene's frames (BGR, any res) -> per-pixel motion energy (h, FLOW_W) float32: mean |DIS flow (FLOW_PRESET)|
    between frames ~1 / FLOW_FPS s apart with the camera (the pair's median flow) removed; held pairs skipped."""
    dt = (ts[-1] - ts[0]) / max(1, len(ts) - 1) if len(ts) > 1 else 1000 / 30
    step = max(1, int(round(1000 / FLOW_FPS / max(dt, 1e-3))))
    dis = cv2.DISOpticalFlow_create(FLOW_PRESET)
    acc, k, prev = None, 0, None
    for i in range(0, len(imgs), step):
        g = flow_grey(imgs[i], aspect)
        if acc is None:
            acc = np.zeros(g.shape, np.float32)
        if prev is not None and np.percentile(cv2.absdiff(g, prev), HELD_PCT) >= FLOW_HELD:
            f = dis.calc(prev, g, None)
            f -= np.median(f.reshape(-1, 2), 0)
            acc += np.hypot(f[..., 0], f[..., 1])
            k += 1
        prev = g
    return acc / max(k, 1)


def box_seeds(roi, p, grey, energy=None, regions=None, seed=0, ids=None, fine=None, fixed=None, rec=None):
    """Box seeds on the seed frame. grey (h, w): the frame at the motion pass's res; energy (h, w): flow_energy (motion
    layout) or None (grid / line); regions {name in SEM: (ph, pw) bool mask over the frame} (pinned groups).
    -> (seed (n, 2) normalized, sem (n,) int 0 = free / 1..3 = SEM id, Reseed lattice (cells, base | None)).
    Layout: grid / line = seed_points with the pinned points taken off n; motion = a floor (the grid layout with
    max(16, SEED_FLOOR n) cells, a point at each textured cell's centre) + importance: the rest drawn without
    replacement over the free sub-lattice slots of the textured fine cells, weight (energy capped at SEED_CAP_PCT) **
    SEED_GAMMA (a static textured cell keeps a 1e-3 weight; flat cells only when nothing else is left). A pinned
    region (any res, resized to grey's) takes group_counts' share of n (v4.46; v4.14: group_points > 0 = that many, on top of n)
    points on its pixels inside the box, 1 px off its
    outline when enough textured pixels are left there, textured pixels (texture >= RESEED_TEX) first (pick_in).
    Order: layout points, then the pinned ones by SEM id. Deterministic (rng seed).
    ids {region name: id} (v4.11 user groups; default SEM's 1..3): the region's points get that id (0 = a `body` seed hull:
    free points), and user regions are not clipped to the box (the owner drew them).
    v4.14 group_seed corners: the groups' points come from pick_corners on fine (a grey of the frame at a higher res, aspect
    restored; default grey) instead of pick_in.
    v4.21 fixed {region name: (k, 2) normalized points}: that group's points are exactly these (k of them, its share of
    n taken by k; not clipped to the box) instead of any placement: a group carried over from a stored run's seeds.
    v4.33 seed_inset (p, % of the part's narrower dimension, default SEED_INSET): a group's mask (less its children's: `own`)
    is eroded by inset_mask before its points are placed (spread and corners alike); the stored shape is untouched. rec (a dict,
    optional) gets {group name: inset_mask's info} for every group seeded on its mask."""
    rng = np.random.default_rng(seed)
    n = int(p["box_points"])
    x, y, w, h = (float(roi[k]) for k in "xywh")
    H, W = grey.shape
    x0, y0 = int(np.clip(x * W, 0, W - 1)), int(np.clip(y * H, 0, H - 1))
    x1, y1 = max(x0 + 1, min(W, int(round((x + w) * W)))), max(y0 + 1, min(H, int(round((y + h) * H))))
    g = grey[y0:y1, x0:x1].astype(np.float32)
    fx, fy = _cells(min(SEED_FINE, max(1, g.size // 16)), w, h)
    S = max(SEED_SUB, int(np.ceil(np.sqrt(2 * n / (fx * fy))))) ** 2  # slots per fine cell (capacity >= 2 n)
    cellmap = lambda a, nx, ny: cv2.resize(a, (nx, ny), interpolation=cv2.INTER_AREA)  # mean per cell of the crop

    def tex(nx, ny):  # grey std per cell
        m = cellmap(g, nx, ny)
        return np.sqrt(np.maximum(cellmap(g * g, nx, ny) - m * m, 0)).ravel()

    # texture is judged on the void lattice's cells (Reseed's scale: a 4 x 4 px fine cell of a smooth render is "flat")
    sub = int(round(np.sqrt(S)))
    cy, cx = np.divmod(np.arange(fx * fy), fx)
    mx, my = _cells(min(RESEED_CELLS, n), w, h)
    mid = (cy * my // fy) * mx + cx * mx // fx  # fine cell -> lattice cell
    mt = tex(mx, my) >= RESEED_TEX
    ft = mt[mid]
    # slots of fine cell c: a jittered sub x sub lattice, centre slot first, the rest in a random order
    si, sj = np.divmod(np.argsort(rng.random((fx * fy, S)) - (np.arange(S) == S // 2), 1), sub)
    jit = (rng.random((fx * fy, S, 2)) - 0.5) * 0.5
    pos = np.stack([x + (cx[:, None] + (sj + 0.5 + jit[..., 0]) / sub) * w / fx,
                    y + (cy[:, None] + (si + 0.5 + jit[..., 1]) / sub) * h / fy], -1)
    used = np.zeros(fx * fy, int)  # slots taken per cell, in slot order

    def take(pts):  # layout points occupy their fine cell's next slot (so no drawn slot lands on them)
        np.add.at(used, np.clip(((pts[:, 1] - y) / h * fy).astype(int), 0, fy - 1) * fx +
                  np.clip(((pts[:, 0] - x) / w * fx).astype(int), 0, fx - 1), 1)

    def draw(k, wt):  # k free slots without replacement, cells weighted wt (0 = never)
        free = np.repeat(np.arange(fx * fy), S)[(np.arange(S)[None] >= used[:, None]).ravel()]
        pw = wt[free]
        k = min(k, int((pw > 0).sum()))
        if k <= 0:
            return np.zeros((0, 2))
        out = []
        for c in free[rng.choice(len(free), k, replace=False, p=pw / pw.sum())]:
            out.append(pos[c, used[c]])
            used[c] += 1
        return np.array(out)

    clip = ids is None
    ids = {s: k + 1 for k, s in enumerate(SEM)} if ids is None else ids
    regions = {s: m for s, m in (regions or {}).items() if s in ids and m is not None and np.any(m)}
    fixed = {s: np.asarray(v, float).reshape(-1, 2) for s, v in (fixed or {}).items() if s in ids and len(v)}
    regions.update({s: True for s in fixed if s not in regions})  # a group seeded on its points needs no outline
    gp = int(p.get("group_points") or 0)  # v4.14: a fixed count per group on top of the box's n, else a share of n
    auto = {} if gp else group_counts(n - sum(len(v) for v in fixed.values()),   # v4.46: by size, at least GROUP_MIN
                                      {s: fit_mask(m, W, H).sum() for s, m in regions.items() if s not in fixed})
    k_sem = {s: len(fixed[s]) if s in fixed else gp or auto[s] for s in regions}
    n_lay = 0 if p.get("groups_only") else n if gp else n - sum(k_sem.values())  # v4.45 groups_only: no layout points
    if energy is None:
        base = seed_points(roi, p | {"box_points": n_lay})[0] if n_lay > 0 else np.zeros((0, 2))
        lattice = (min(RESEED_CELLS, len(base)), None)
    else:
        gate = mt.mean() >= SEED_TEX_MIN  # a dark / fading seed frame: no texture gate (it would pile up on a patch)
        ft = ft | (not gate)
        kx, ky = _cells(min(n_lay, max(16, int(round(SEED_FLOOR * n)))), w, h)
        gx, gy = np.meshgrid((np.arange(kx) + 0.5) / kx, (np.arange(ky) + 0.5) / ky)
        base = np.c_[x + gx.ravel() * w, y + gy.ravel() * h][(tex(kx, ky) >= RESEED_TEX) | (not gate)][:n_lay]
        lattice = (mx * my, int((~mt).sum()) if gate else 0)  # the grid's lattice; flat cells are not voids
    take(base)
    pts, sem = [base], [np.zeros(len(base), int)]
    if energy is not None:
        e = cellmap(np.ascontiguousarray(energy[y0:y1, x0:x1], np.float32), fx, fy).ravel()
        e = np.minimum(e, np.percentile(e[ft], SEED_CAP_PCT)) if ft.any() else e
        e = e / (e.max() + 1e-12)
        # moving tier: one point in every moving cell of the void lattice (energy above the median) that has none yet,
        # at its most energetic textured fine cell, strongest cells first
        me = np.bincount(mid, e, mx * my) / np.maximum(np.bincount(mid, minlength=mx * my), 1)
        has = np.bincount(mid, used, mx * my) > 0
        tier = []
        for m in np.argsort(-me, kind="stable")[:int((me > np.median(me)).sum())]:
            c = np.flatnonzero((mid == m) & ft)
            if not has[m] and len(c) and len(tier) < n_lay - len(base):
                c = c[np.argmax(e[c])]
                tier.append(pos[c, used[c]])
                used[c] += 1
        tier = np.array(tier).reshape(-1, 2)
        imp = draw(n_lay - len(base) - len(tier), np.where(ft, e ** SEED_GAMMA + 1e-3, 0.0))
        rest = draw(n_lay - len(base) - len(tier) - len(imp), np.where(ft, 0.0, 1.0))  # flat: only when the rest is full
        pts += [tier, imp, rest]
        sem += [np.zeros(len(tier) + len(imp) + len(rest), int)]
    tx = texture(grey) >= RESEED_TEX
    inbox = np.zeros((H, W), bool)
    inbox[y0:y1, x0:x1] = True
    from pawtrack.partlabel import sits_on

    def own(s, m, mw, mh):  # paw-noy2: where a part with parts on top of it seeds: its area less theirs (no point is in two groups)
        kids = [t for t in regions if t != s and isinstance(regions[t], np.ndarray) and sits_on(t, s)]
        if not kids:
            return m
        top = np.zeros_like(m)
        for t in kids:
            top |= fit_mask(regions[t], mw, mh)
        rest = m & ~top
        return rest if rest.sum() >= max(4, k_sem[s]) else m   # nothing left of it: it seeds under them as before

    corners = p.get("group_seed") == "corners"
    inset = float(p.get("seed_inset", SEED_INSET) or 0)
    if corners:
        fine = grey if fine is None else fine
        fh, fw = fine.shape
        finbox = np.zeros((fh, fw), bool)
        finbox[int(y0 * fh / H):int(np.ceil(y1 * fh / H)), int(x0 * fw / W):int(np.ceil(x1 * fw / W))] = True
    for s in sorted(k_sem, key=lambda s: ids[s]):
        if s in fixed:  # v4.21: exactly the given points
            pts.append(np.clip(fixed[s], 0, 1))
            sem.append(np.full(len(fixed[s]), ids[s]))
            continue
        if corners:
            mf, info = inset_mask(own(s, fit_mask(regions[s], fw, fh), fw, fh) & (finbox if clip else True), inset, k_sem[s])
            if rec is not None:
                rec[s] = info
            a = pick_corners(mf, fine, k_sem[s])
            pts.append(a)
            sem.append(np.full(len(a), ids[s]))
            continue
        m, info = inset_mask(own(s, fit_mask(regions[s], W, H), W, H) & (inbox if clip else True), inset, k_sem[s])
        if rec is not None:
            rec[s] = info
        e = (cv2.erode(m.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0) & m  # its outline holds background
        a = pick_in(e if (e & tx).sum() >= k_sem[s] else m, tx, k_sem[s], rng)
        pts.append(a)
        sem.append(np.full(len(a), ids[s]))
    xy, sem = np.concatenate(pts), np.concatenate(sem)
    short = n_lay + sum(k_sem.values()) - len(xy)
    if short > 0:  # a region smaller than its share, or a flat box: free slots anywhere fill the count
        ex = draw(short, np.ones(fx * fy))
        xy, sem = np.r_[xy, ex], np.r_[sem, np.zeros(len(ex), int)]
    order = np.argsort(sem > 0, kind="stable")  # layout points first, pinned last
    return np.clip(xy[order], 0, 1), sem[order], lattice


SEED_INSET = 15.0                  # v4.33 seed_inset: % of the part's narrower dimension (4 x its mean depth) points keep off its outline ...
INSET_FLOOR, INSET_CEIL = 0.0025, 0.005   # ... within these x the frame width (about 5 .. 10 px at 1080p: the old fixed painted margin)
INSET_KEEP = 0.25                  # the eroded mask must keep this share of the part's area ...
INSET_PTS = 2                      # ... and this many pixels per point asked, else the inset is halved (relaxed) until it does


def inset_mask(m, pct, k=0):
    """v4.33: the mask m (h, w bool) eroded by the seeding inset, where points for a group go. The inset = pct % of the part's
    narrower dimension (4 x the mean depth of its pixels: a bar's width, 2/3 of a disc's diameter), within INSET_FLOOR ..
    INSET_CEIL x the mask's width. It never erodes a part to nothing: while the eroded mask keeps less than INSET_KEEP of the
    area or fewer than INSET_PTS x k pixels the inset is halved (relaxed); under half a pixel the mask is used whole.
    -> (mask, {"px": the inset used, "want": the inset asked, "relaxed": bool, "kept": share of the area left})."""
    m = np.asarray(m, bool)
    area = int(m.sum())
    if pct <= 0 or not area:
        return m, {"px": 0.0, "want": 0.0, "relaxed": False, "kept": 1.0}
    d = cv2.distanceTransform(np.pad(m, 1).astype(np.uint8), cv2.DIST_L2, cv2.DIST_MASK_PRECISE)[1:-1, 1:-1]
    want = px = float(np.clip(pct / 100 * 4 * d[m].mean(), INSET_FLOOR * m.shape[1], INSET_CEIL * m.shape[1]))
    while px >= 0.5:
        e = d >= px + 0.5   # a pixel centre's depth is its distance to the nearest outside centre less half a pixel
        if e.sum() >= max(INSET_KEEP * area, INSET_PTS * k):
            return e, {"px": round(px, 2), "want": round(want, 2), "relaxed": px < want, "kept": round(float(e.sum()) / area, 3)}
        px /= 2
    return m, {"px": 0.0, "want": round(want, 2), "relaxed": True, "kept": 1.0}


CORNER_INSET = 0.2  # group_seed corners: points >= this x the region's equivalent radius inside its outline
FINE_W = 640        # ... picked on the seed frame at its own width, at most this (the trackers' inputs are <= 512)


def pick_corners(m, grey, k):
    """v4.14 group_seed corners: k points (normalized, pixel centres) on mask m (h, w bool) of grey (h, w): trackable
    texture away from the outline (where a point slides onto the background). Inset: the pixels >= CORNER_INSET x the
    region's equivalent radius from its edge or the frame's (>= 1 px; halved while fewer than 4 k are left; the whole
    mask when fewer than k are); of those
    the textured half (Shi-Tomasi min eigenvalue >= its median there) are the candidates, spread by farthest-point
    sampling from the strongest corner, each step's distance weighted by the candidate's response rank (0.25 .. 1), so
    strong corners win among equally far ones. Deterministic; fewer than k only when the mask has fewer pixels."""
    m = np.asarray(m, bool)
    if k <= 0 or not m.any():
        return np.zeros((0, 2))
    d = cv2.distanceTransform(np.pad(m, 1).astype(np.uint8), cv2.DIST_L2, cv2.DIST_MASK_PRECISE)[1:-1, 1:-1]
    inset = max(1.0, CORNER_INSET * np.sqrt(m.sum() / np.pi))
    while inset > 1 and (d >= inset).sum() < 4 * k:
        inset = max(1.0, inset / 2)
    pool = d >= inset
    pool = pool if pool.sum() >= k else m
    resp = cv2.cornerMinEigenVal(np.ascontiguousarray(grey, np.float32), 5, 3)
    ys, xs = np.nonzero(pool)
    r = resp[ys, xs]
    tex = r >= np.median(r)
    if tex.sum() >= k:
        ys, xs, r = ys[tex], xs[tex], r[tex]
    P = np.c_[xs, ys].astype(float)
    rank = 0.25 + 0.75 * np.argsort(np.argsort(r, kind="stable"), kind="stable") / max(1, len(r) - 1)
    i = int(np.argmax(r))
    take, dist = [i], np.hypot(*(P - P[i]).T)
    for _ in range(min(k, len(P)) - 1):
        i = int(np.argmax(dist * rank))
        take.append(i)
        dist = np.minimum(dist, np.hypot(*(P - P[i]).T))
    return (P[take] + 0.5) / [m.shape[1], m.shape[0]]


def pick_in(m, tx, k, rng):
    """k points (normalized, pixel centres) on mask m (h, w bool): textured pixels (tx) first, in a random order, each
    kept >= half the mean spacing sqrt(area / k) from those taken (then the closest left fill the count)."""
    ys, xs = np.nonzero(m)
    if not len(ys) or k <= 0:
        return np.zeros((0, 2))
    o = np.argsort(-rng.random(len(ys)) ** (1 / np.where(tx[ys, xs], 1.0, 1e-3)), kind="stable")
    P = np.c_[xs[o], ys[o]].astype(float)
    dmin, acc = 0.5 * np.sqrt(len(P) / k), []
    for i, q in enumerate(P):
        if len(acc) == k:
            break
        if not acc or np.hypot(*(P[acc] - q).T).min() >= dmin:
            acc.append(i)
    take = acc + [i for i in np.setdiff1d(np.arange(len(P)), acc)][:k - len(acc)]
    return (P[take] + 0.5) / [m.shape[1], m.shape[0]]


# ---------------------------------------------------------------- seed frame (experiments/seedframe)
# The ROI is seeded on one frame per scene and tracked both ways from it (bidirectional: forward to the scene end, the
# reversed buffer back to its start). The frame: the scene's first (seed_frame first, the old behaviour), the frame the
# ROI was drawn on (roi.t_ms, in its scene), or an auto pick from the scene's 64 px grey thumbnails (cheap, CPU).
SEED_RULES = {
    "medoid": "the scene's most typical frame (thumbnail medoid)",
    "far_first": "the frame least like the scene's first",
    "texture": "the frame with the most edges in the ROI",
    "keyframe": "the stroke turn nearest the middle of the scene (cadence_turns)",
    "cells": "the frame with the most textured cells in the ROI",
}
AUTO_RULE = "medoid"  # seed_frame auto (experiments/seedframe/RESULTS.md)
PICK_MAX = 400  # ponytail: medoid over at most 400 evenly spaced frames (O(n^2) distances); fine for any scene length


def roi_region(roi):
    """ROI -> (x0, y0, x1, y1) normalized: the box; clicks: their bounding box padded by 0.1; else the whole frame."""
    if roi and roi.get("kind") == "box":
        x, y, w, h = (float(roi[k]) for k in "xywh")
        return max(0.0, x), max(0.0, y), min(1.0, x + w), min(1.0, y + h)
    if roi and roi.get("kind") == "points" and roi.get("points"):
        p = np.asarray(roi["points"], float).reshape(-1, 2)
        return (*np.clip(p.min(0) - 0.1, 0, 1), *np.clip(p.max(0) + 0.1, 0, 1))
    return 0.0, 0.0, 1.0, 1.0


def medoid(X):
    """Row of X (n, D) with the least summed euclidean distance to the others."""
    sq = (X ** 2).sum(1)
    return int(np.argmin(np.sqrt(np.maximum(sq[:, None] + sq[None] - 2 * X @ X.T, 0)).sum(1)))


def seed_candidates(ts, thumbs, roi):
    """One scene's grey thumbnails (T, h, w) (loops.thumb) -> {rule: frame index} for every SEED_RULES rule."""
    th = np.asarray(thumbs, np.float32)
    T, h, w = th.shape
    X = th.reshape(T, -1).astype(np.float64)
    sub = np.unique(np.linspace(0, T - 1, min(T, PICK_MAX)).round().astype(int))
    out = {"medoid": int(sub[medoid(X[sub])]), "far_first": int(np.argmax(np.linalg.norm(X - X[0], axis=1)))}
    x0, y0, x1, y1 = roi_region(roi)
    c = th[:, int(y0 * h):max(int(round(y1 * h)), int(y0 * h) + 2), int(x0 * w):max(int(round(x1 * w)), int(x0 * w) + 2)]
    out["texture"] = int(np.argmax(np.abs(np.diff(c, axis=1)).mean((1, 2)) + np.abs(np.diff(c, axis=2)).mean((1, 2))))
    ny, nx = (max(1, min(8, d // 3)) for d in c.shape[1:])
    sd = np.stack([b.std((1, 2)) for r in np.array_split(c, ny, 1) for b in np.array_split(r, nx, 2)], 1)  # (T, cells)
    out["cells"] = int(np.argmax((sd >= RESEED_TEX).sum(1) + sd.mean(1) / (sd.mean(1).max() + 1e-9) / 2))
    from pawtrack.pipeline import cadence_turns
    turns = cadence_turns(ts, th)
    ts = np.asarray(ts, float)
    out["keyframe"] = (int(np.argmin(np.abs(ts - turns[np.argmin(np.abs(turns - (ts[0] + ts[-1]) / 2))])))
                       if len(turns) else out["medoid"])  # no motion period: the medoid
    return out


def seed_frame(ts, thumbs, roi, mode, scene_ts):
    """-> (index into ts of the seed frame, the decision record {frame_ms, mode, reason}). ts / thumbs: the frames the
    tracker gets (held_input: the drawings); scene_ts: every frame of the scene (roi.t_ms is matched against it)."""
    t_roi = roi.get("t_ms") if roi else None
    dt = (scene_ts[-1] - scene_ts[0]) / max(1, len(scene_ts) - 1)
    if t_roi is not None and scene_ts[0] <= t_roi < scene_ts[-1] + max(dt, 1):
        s = max(0, int(np.searchsorted(np.asarray(ts, float), float(t_roi), "right")) - 1)
        return s, {"frame_ms": int(ts[s]), "mode": "roi", "reason": f"the ROI was drawn at {int(t_roi)} ms"}
    if mode == "auto" and len(ts) >= 2:
        s = seed_candidates(ts, thumbs, roi)[AUTO_RULE]
        return s, {"frame_ms": int(ts[s]), "mode": "auto", "reason": f"{AUTO_RULE}: {SEED_RULES[AUTO_RULE]}"}
    return 0, {"frame_ms": int(ts[0]), "mode": "first", "reason": "the scene's first frame"}


def merge_passes(fwd, bwd, t_seed, n):
    """Two causal passes from the seed frame -> one time-ordered scene, as one pass's (rows, alive, anchors).
    fwd: from the seed frame to the scene end; bwd: the reversed buffer from the seed frame to the scene start, its
    times mirrored (2 t_seed - t) so they rise. Each: (rows [(t, xy (N, 2), vis, vp, cf)], alive (T, N) | None, anchors
    (N, 2)), the first n points being the shared seeds. Points out: the seeds, fwd's re-seeds, bwd's re-seeds; a pass's
    re-seeds are not alive (invisible, at their birth position) in the other pass's frames. The seed frame's row is
    fwd's. Anchors stay per pass: both passes measure displacement from the same seeds on the seed frame."""
    (rf, af, cf), (rb, ab, cb) = fwd, bwd
    kf, kb = len(cf) - n, len(cb) - n  # re-seeds of each pass
    pf, pb = rf[0][1][n:], rb[0][1][n:]  # unborn re-seeds sit at their birth position (reseed_rows)
    zf, zb = np.zeros(kf, bool), np.zeros(kb, bool)
    nf, nb = np.full(kf, np.nan), np.full(kb, np.nan)  # vp / cf of the other pass's re-seeds: not alive
    rows = [(2 * t_seed - t, np.r_[xy[:n], pf, xy[n:]], np.r_[v[:n], zf, v[n:]], np.r_[vp[:n], nf, vp[n:]],
             np.r_[c[:n], nf, c[n:]]) for t, xy, v, vp, c in rb[:0:-1]]
    rows += [(t, np.r_[xy, pb], np.r_[v, zb], np.r_[vp, nb], np.r_[c, nb]) for t, xy, v, vp, c in rf]
    alive = None
    if af is not None or ab is not None:
        af = np.ones((len(rf), n + kf), bool) if af is None else af
        ab = np.ones((len(rb), n + kb), bool) if ab is None else ab
        alive = np.r_[np.c_[ab[:0:-1, :n], np.zeros((len(rb) - 1, kf), bool), ab[:0:-1, n:]],
                      np.c_[af, np.zeros((len(rf), kb), bool)]]
    return rows, alive, np.r_[cf, cb[n:]]


def seed_axis(seed, aspect):
    """Rest-frame coordinate of every seed point along the seed cloud's principal axis (frame heights)."""
    q = seed * [aspect, 1.0]
    q = q - q.mean(0)
    if len(q) < 2:
        return np.zeros(len(q))
    u = np.linalg.eigh(q.T @ q)[1][:, -1]
    return q @ u


def channels(xy, vis, s_rest, n_click, aspect, alive=None):
    """One frame. xy (N, 2) normalized, vis (N,) bool, s_rest (N,) seed_axis. -> channels dict.
    vis_frac: share of points visible (alive: of the alive ones, re-seeding). vis_extent: share of the seed cloud's long axis (rest frame) that the
    visible points span (0..1). vis_len: span of the visible points along their own principal axis now,
    frame heights. dist01: distance of points 0 and 1 (clicks only), frame heights. centroid: visible points (the scene
    pass replaces it with translation(): seed-anchored)."""
    ch = dict.fromkeys(CHANNELS)
    N = len(xy)
    v = np.asarray(vis, bool)
    ch["vis_frac"] = (float(v.mean()) if alive is None else float(v[alive].mean())) if N else None
    span = s_rest.max() - s_rest.min() if N else 0.0
    if v.any():
        ch["vis_extent"] = float((s_rest[v].max() - s_rest[v].min()) / span) if span > 1e-9 else 1.0
        q = xy[v] * [aspect, 1.0]
        ch["centroid_x"], ch["centroid_y"] = (float(c) for c in xy[v].mean(0))
        if v.sum() >= 2:
            qc = q - q.mean(0)
            u = np.linalg.eigh(qc.T @ qc)[1][:, -1]
            s = qc @ u
            ch["vis_len"] = float(s.max() - s.min())
        else:
            ch["vis_len"] = 0.0
    else:
        ch["vis_extent"], ch["vis_len"] = 0.0, 0.0
    if n_click >= 2:
        ch["dist01"] = float(np.hypot(*((xy[0] - xy[1]) * [aspect, 1.0])))
    for k in range(min(MAX_P, N)):
        ch[f"p{k}_x"], ch[f"p{k}_y"] = float(xy[k, 0]), float(xy[k, 1])
    return ch


def translation(xy, vis, seed, base=None):
    """(T, N, 2) tracks -> (T, 2) centroid of the cloud as a translation of the seed: seed centroid (or base) + mean
    displacement of the VISIBLE points, so it does not jump when a subset gets hidden. NaN: none visible."""
    w = vis.astype(float)[..., None]
    n = w.sum(1)
    d = ((xy - seed[None]) * w).sum(1) / np.maximum(n, 1)
    return np.where(n > 0, (seed.mean(0) if base is None else base) + d, np.nan)


def anchors(xy, vis, seed, born_row):
    """Re-seeded points' anchors for translation(): a point born on row k is anchored at its position there minus
    the mean displacement of the older points visible on that row (else the last row that had one), so it enters
    carrying the cloud's displacement and steps nothing. seed (n, 2) = the original points; born_row (N,), -1 =
    original. -> (N, 2)."""
    anc = np.r_[seed, xy[0, len(seed):]]
    for k in np.unique(born_row[born_row >= 0]):
        old = born_row < k
        for j in range(k, -1, -1):
            o = old & vis[j]
            if o.any():
                d = (xy[j, o] - anc[o]).mean(0)
                break
        else:
            d = np.zeros(2)
        anc[born_row == k] = xy[k, born_row == k] - d
    return anc


def stroke_proj(t, c, aspect, p):
    """Centroid track (T, 2) normalized -> (proj (T,) 0..1 or NaN, travel std in frame heights, bridged (T,) bool,
    raw (T,) the un-normalized projection in frame heights, same orientation as proj).
    axis: auto = principal axis of the centroid's motion (up / right = higher, like centroid_auto); vertical =
    up is higher; horizontal = right is higher; custom = from (axis_x0, axis_y0) to (axis_x1, axis_y1) is
    out -> in, so moving toward (x1, y1) LOWERS the value (pos 0 = deepest). Gaps (no visible point) up to gap_ms
    are interpolated (bridged), longer ones stay NaN."""
    from pawtrack.pipeline import project_auto
    t = np.asarray(t, float)
    q = np.asarray(c, float) * [aspect, 1.0]
    ok = np.isfinite(q[:, 0])
    if ok.sum() < 2:
        return np.full(len(t), np.nan), 0.0, np.zeros(len(t), bool), np.full(len(t), np.nan)
    qf = np.stack([np.interp(t, t[ok], q[ok, k]) for k in (0, 1)], 1)
    gap = np.zeros(len(t), bool)
    bad = ~ok
    i = 0
    while i < len(t):  # runs of missing frames: bridge if short and inside the track
        if bad[i]:
            j = i
            while j < len(t) and bad[j]:
                j += 1
            inside = i > 0 and j < len(t)
            span = (t[j] if j < len(t) else t[-1]) - (t[i - 1] if i > 0 else t[0])
            gap[i:j] = inside and span <= p["gap_ms"]
            i = j
        else:
            i += 1
    keep = ok | gap
    a = p["axis"]
    if a == "auto":
        s = np.full(len(t), np.nan)
        s[keep] = project_auto(qf[keep])
    else:
        if a == "vertical":
            u = np.array([0.0, -1.0])
        elif a == "horizontal":
            u = np.array([1.0, 0.0])
        else:
            d = np.array([(p["axis_x1"] - p["axis_x0"]) * aspect, p["axis_y1"] - p["axis_y0"]])
            if np.hypot(*d) < 1e-6:
                raise ValueError("custom axis needs two distinct points")
            u = -d / np.hypot(*d)  # toward (x1, y1) = in = lower
        s = np.where(keep, qf @ u, np.nan)
    sd = float(np.nanstd(s)) if keep.sum() >= 2 else 0.0
    lo, hi = np.nanmin(s), np.nanmax(s)
    return (s - lo) / (hi - lo) if hi - lo > 1e-12 else np.where(keep, 0.5, np.nan), sd, gap, s


def overlay(xy, vis, lab=None, alive=None, part=None, sem=None):
    """Visible points as points; occluded points as small boxes. pts (v3.1): every point in seed order
    [x, y, 1 visible | 0 occluded(, motion group: -1 unassigned, 0 static, 1..4(, part 1..MAX_PARTS of that body: only
    on points in a part, v3.4(, pinned group 1..3 = SEM: only on pinned points, the part then 0, v4.6)))], same index
    in every frame. alive (re-seeding): False = not born yet / retired: v 0 in pts, no box."""
    xy = np.clip(xy, 0, 1).round(4)
    d = 0.006
    vis = np.asarray(vis, bool)
    # python numbers, not numpy scalars, in the per-point loops: ~3x faster on a 1024+ point frame (paw-iyl3)
    q, vl, n = xy.tolist(), vis.astype(np.int8).tolist(), len(xy)
    if lab is None:
        pts = [[a, b, v] for (a, b), v in zip(q, vl)]
    else:
        pl = [0] * n if part is None else np.asarray(part)[:n].tolist()
        sl = [0] * n if sem is None else np.asarray(sem)[:n].tolist()
        pts = [[a, b, v, g, p, s] if s > 0 else [a, b, v, g, p] if p > 0 else [a, b, v, g]
               for (a, b), v, g, p, s in zip(q, vl, np.asarray(lab).tolist(), pl, sl)]
    return {"points": xy[vis].tolist(),
            "boxes": [[round(a - d, 4), round(b - d, 4), 2 * d, 2 * d]
                      for a, b in xy[~vis if alive is None else ~vis & alive].tolist()],
            "pts": pts}


def support(clicks, local, r=0.04, k=5):
    """Support points tracked with clicks and then dropped (TAPNext++ only): a 6 x 6 grid over the frame plus,
    if local, a k x k patch of +-r (frame units) around every click (TAPNext++'s VOTS tracker uses 64 local
    points per query). Measured on the synthetic rod (README): TAPNext++ loses a lone click under occlusion
    without the patch (86 px -> 2.6 px with it); CoTracker3 online does best with NO support points (0.4 px;
    grid only: median 2.9 px, p90 500 px; grid + patch: 97 px), so cotracker_points tracks the clicks alone."""
    glob = (np.stack(np.meshgrid(np.arange(6), np.arange(6)), -1).reshape(-1, 2) + 0.5) / 6
    if not local:
        return glob
    g = (np.arange(k) / (k - 1) - 0.5) * 2 * r
    pts = (clicks[:, None, None, :] + np.stack(np.meshgrid(g, g), -1)[None]).reshape(-1, 2)
    return np.clip(np.r_[pts, glob], 0, 1)


def wrap(run, roi, frames, p, conf_of, local_support, work_wh=None, grow=1.0):  # local_support: None = no support points
    """Shared body of track(): seed, run the point tracker, turn per-point results into channels.
    run(frames, seed (N,2) normalized) yields (t, xy (N,2) normalized, vis (N,) bool, vis_p (N,), conf (N,)).
    proj needs the whole scene (axis, 0..1 range, auto choice), so the scene is buffered and its frames are
    yielded at the end of the scene (live frame events arrive in one burst per scene).
    held_input (needs work_wh, the tracker's input (W, H)): run gets only the frames with a new drawing; a held
    frame takes its drawing's result (hold), the group pass runs on the drawings.
    Seed frame (needs work_wh): seed_frame first and no roi.t_ms = the scene's first frame, streamed (the old path);
    else the scene is buffered at work_wh, seeded on seed_frame()'s pick and tracked both ways (merge_passes).
    Soft cuts (PROTOCOL v4.9, p["soft_cuts"] ms, set by cli): the run goes on through them; each pass's Reseed runs its
    soft-cut check there (needs reseed_every_ms > 0), the pinned groups re-detected by the tagger on that frame."""
    from pawtrack import partlabel
    tap = partlabel.Tap() if p.get("group_labels") else None  # keeps a few frames for the group names
    it = iter(frames if tap is None else tap(frames))
    f0 = next(it, None)
    if f0 is None:
        return
    H, W = f0[1].shape[:2]
    aspect = W / H
    seed, n_click = seed_points(roi, p)
    n = len(seed)
    extra = n_click and local_support is not None
    q = np.r_[seed, support(seed, local_support)] if extra else seed
    mode = p.get("held_input", "off") if work_wh else "off"
    st = {"ts": [], "new": [], "d": [], "thr": None}
    src = chain([f0], it) if mode == "off" else drawings(chain([f0], it), work_wh, mode, st)

    box = (roi or {}).get("kind") == "box"
    lay = p.get("box_seed", "grid") if box and work_wh else None
    want_sem = bool(box and work_wh and p.get("sem_groups") and partlabel.hydra_ready())
    # v4.11 user groups (cli.parse_groups): those of this scene (t_ms inside it, or no t_ms) replace the tagger's
    ug = (p.get("groups") or []) if box and work_wh else []
    if p.get("groups") and not ug:
        from pawtrack.trackers import note
        note("groups", "user groups skipped: they need a box ROI and a points tracker")
    mine, sid = [], {s: k + 1 for k, s in enumerate(SEM)}  # this scene's user groups; pinned group name -> id
    track_sem = want_sem and p.get("sem_track", partlabel.SEM_TRACK) and partlabel.sam_ready()  # outlines through the scene (buffers it)
    sem, lattice, sem_rec, lay_rec, outline = np.zeros(n, int), None, {}, {}, {}
    knots = []  # v4.54 (paw-njnf): [(channel stem, point indices, group id, mask)]: a group's knot section = its points inside it

    def lay_box(img, imgs=None, ts_=None):  # box seeds on img (BGR, any res) with the motion pass over imgs
        nonlocal seed, q, n, sem, lattice, sem_rec, lay_rec, outline
        import time
        t0 = time.perf_counter()
        energy = flow_energy(imgs, ts_, aspect) if lay == "motion" else None
        lay_rec = {"layout": lay} | ({"flow_ms": int(round(1000 * (time.perf_counter() - t0)))} if energy is not None else {})
        regions, ids = {}, None
        if mine:  # the owner's polygons, on the seed grid; no tagger
            gh = max(8, round(partlabel.SEED_W / aspect))
            regions = {g["name"]: partlabel.poly_mask(g["poly"], partlabel.SEED_W, gh) for g in mine}
            for g in mine:  # v4.53 (paw-yx6q): nothing is seeded where the owner erased (a hole inside the outline included)
                er = partlabel.erased_mask(g, partlabel.SEED_W, gh)
                if er is not None:
                    regions[g["name"]] = regions[g["name"]] & ~er
            ids = {g["name"]: g["id"] or 0 for g in mine}
            sem_rec = {g["name"]: {"label": g["name"], "source": "user", "id": g["id"]} for g in mine if g["pinned"]}
            lay_rec["groups"] = [g["name"] for g in mine]
            outline = {k: m for k, m in regions.items() if k in sem_rec}
        elif want_sem:
            from pawtrack.trackers import note
            h = img.shape[0]
            timg = cv2.resize(img, (int(round(h * aspect)), h))
            heat = {}
            try:
                regions, sem_rec = partlabel.sem_regions(timg, roi_region(roi), heat=heat)
            except Exception as e:  # optional: a tagger failure costs the pinned groups, never the track
                note("sem_groups", f"pinned groups skipped: {type(e).__name__}: {e}")
            t1 = time.perf_counter()
            try:  # the outlines (SAM 2 / GrabCut) from the CAM blobs; a failure keeps the blobs
                regions = (partlabel.shape_regions(timg, regions, sem_rec, heat, shape=p.get("sem_shape", partlabel.SHAPE))
                           if regions else regions)
            except Exception as e:
                note("sem_groups", f"pinned outlines skipped (CAM blobs kept): {type(e).__name__}: {e}")
            if regions:
                lay_rec["shape_ms"] = int(round(1000 * (time.perf_counter() - t1)))
                outline = regions
        fine = None  # v4.14 group_seed corners: the frame at its own width (<= FINE_W), aspect restored
        if p.get("group_seed") == "corners":
            fw = min(img.shape[1], FINE_W)
            fine = cv2.cvtColor(cv2.resize(img, (fw, max(8, round(fw / aspect))), interpolation=cv2.INTER_AREA),
                                cv2.COLOR_BGR2GRAY)
        fixed = {g["name"]: g["points"] for g in mine if g.get("points")}  # v4.21: seeded on the given points
        ins = {}
        seed, sem, lattice = box_seeds(roi, p, flow_grey(img, aspect), energy, regions, ids=ids, fine=fine, fixed=fixed, rec=ins)
        q, n = seed, len(seed)
        knots[:] = knot_members(mine, seed, sem, aspect)
        for k, r in sem_rec.items():
            r["points"] = int((sem == sid[k]).sum())
            if k in ins:  # v4.33: the seeding inset used for this group (relaxed: the part was too small for the asked one)
                r["seed_inset"] = ins[k]
        late = [k for k, v in ins.items() if v["relaxed"]]
        if late:
            from pawtrack.trackers import note
            note("seed_inset", "seeding inset relaxed (the part is too small for it): " + ", ".join(f"{k} {ins[k]['want']} -> {ins[k]['px']} px" for k in late))

    def redetect(img):  # soft cut: the pinned groups' CAM regions on this frame (RGB at the model's input res)
        h = img.shape[0]
        regions, _ = partlabel.sem_regions(cv2.resize(img[..., ::-1], (int(round(h * aspect)), h)), roi_region(roi))
        return {SEM.index(k) + 1: m for k, m in regions.items()}

    def one(fr, t0, masks=None, soft=None, tick=None):  # one causal pass from fr's first frame -> (rows over its output points, alive | None, anchors, Reseed)
        soft = p.get("soft_cuts") or () if soft is None else soft
        rs = (Reseed(roi, seed, n_click, len(q) - n, p, t0, grow, lattice, sem, aspect, masks, soft,
                     redetect if want_sem and not mine and sem.any() else None,
                     {g["id"]: g.get("who") for g in mine if g.get("id")}, [(gid, m) for _, _, gid, m in knots], knot_hold(knots, n))
              if p.get("reseed_every_ms") else None)
        out = run(fr, q) if rs is None else ((*r, rs.ids) for r in run(fr, q, rs))  # ids current on receipt
        rows = list(out if tick is None else (tick() or r for r in out))  # tick: one output frame (v4.43)
        if rs is None or not rs.born or not rows:
            return [(t, xy[:n], vis[:n], vp[:n], cf[:n]) for t, xy, vis, vp, cf, *_ in rows], None, seed, rs
        return (*reseed_rows(rows, rs, seed), rs)

    seed_rec = {"frame_ms": int(f0[0]), "mode": "first", "reason": "the scene's first frame"}
    seed_t = f0[0]  # the frame the points were laid on (v4.15 lost_stop walks away from it)
    mask_at = None  # t (ms) -> {group id: bool mask} (track_sem)
    later = any(g["t_ms"] is None or g["t_ms"] >= f0[0] - 50 for g in ug)  # a user group may be in this scene: buffer it
    if not work_wh or (p.get("seed_frame", "first") == "first" and (roi or {}).get("t_ms") is None and lay != "motion"
                       and not track_sem and not later):
        if p.get("groups_only"):  # v4.45: no group of this call is drawn in this scene: nothing to track here
            return
        if want_sem:
            lay_box(f0[1])  # grid / line + the pinned groups, on the first frame
        # the scene's first frame, streamed (no buffer); paw-eeod: each output frame is a heartbeat for the app's stall
        # watchdog (the rows go out after the scene: on the CPU a 150-frame scene was 4 min without an event)
        rows, alive, anc, rs = one(src, f0[0], tick=beat)
        rss = [rs]
    else:  # buffer the scene at the tracker's input res (its own nearest resize is then a no-op), seed on frame s
        from pawtrack.loops import thumb
        # ponytail: ~0.6 MB a buffered frame at 512 x 384 (1 min at 30 fps ~ 1 GB of RAM); spill to disk if scenes get long
        pulling("reading")  # v4.43: these pulls only decode (the tracker runs after the buffer is full)
        buf = list(src if mode != "off" else ((t, cv2.resize(b, work_wh, interpolation=cv2.INTER_NEAREST)) for t, b in src))
        ts_b = [t for t, _ in buf]
        sc_ts = st["ts"] if mode != "off" else ts_b
        half = (sc_ts[-1] - sc_ts[0]) / max(1, len(sc_ts) - 1) / 2 if sc_ts else 0
        mine = [g for g in ug if g["t_ms"] is None or sc_ts[0] - half <= g["t_ms"] < sc_ts[-1] + half] if sc_ts else []
        tg = next((g["t_ms"] for g in mine if g["t_ms"] is not None), None)  # the frame the groups were drawn on seeds
        if p.get("groups_only") and not mine:  # v4.45: none of this call's groups is drawn in this scene
            return
        if mine:
            sid = {g["name"]: g["id"] for g in mine if g["pinned"]}
        s, seed_rec = seed_frame(ts_b, [thumb(img) for _, img in buf],
                                 roi if tg is None else {**roi, "t_ms": max(tg, sc_ts[0])}, p.get("seed_frame", "first"), sc_ts)
        if tg is not None:
            seed_rec["reason"] = f"the groups were drawn at {int(tg)} ms"
        if lay == "motion" or want_sem or mine:
            lay_box(buf[s][1], [b for _, b in buf], ts_b)
        tS = seed_t = buf[s][0]
        if track_sem and outline:
            import time
            t1 = time.perf_counter()
            try:
                ml = partlabel.track_masks([b for _, b in buf[s:]], outline)
                ml = (partlabel.track_masks([b for _, b in buf[s::-1]], outline)[:0:-1] if s > 0 else []) + ml

                def mask_at(t):  # the buffered frame at or before t (held frames: their drawing)
                    i = min(len(ml) - 1, max(0, int(np.searchsorted(ts_b, t, "right")) - 1))
                    return {sid[k]: m for k, m in ml[i].items() if k in sid}
                lay_rec["track_ms"] = int(round(1000 * (time.perf_counter() - t1)))
                for k, r in sem_rec.items():
                    r["tracked"] = k in ml[s]
            except Exception as e:  # optional: a failure keeps the seed outlines + motion pruning
                from pawtrack.trackers import note
                note("sem_groups", f"pinned outlines not tracked: {type(e).__name__}: {e}")
        # v4.43: stage "inference" counts the frames both passes have produced (out of STEPS), so the bar moves while
        # the buffered scene is tracked; a first-time model load inside it names itself, then "inference" comes back
        with steps("inference") as frac:
            n_out, k_out = len(buf) - s + (s + 1 if s > 0 else 0), [0]

            def tick():
                k_out[0] += 1
                frac(k_out[0] / n_out)
            rows, alive, anc, rs = one(buf[s:], tS, mask_at, tick=tick)
            rss = [rs]
            if s > 0:  # and back: the reversed buffer, times mirrored so Reseed's clocks run forward
                back = one([(2 * tS - t, img) for t, img in buf[s::-1]], tS, mask_at and (lambda t: mask_at(2 * tS - t)),
                           [2 * tS - c for c in p.get("soft_cuts") or () if c < tS], tick=tick)  # the soft cuts behind the seed, mirrored
                rows, alive, anc = merge_passes((rows, alive, anc), back[:3], tS, n)
                rss.append(back[3])
    if not rows:
        return
    semof = lambda r: sem if r is None or not r.born else np.asarray(r.sem_out, int)  # pinned group per output point
    sem_all = np.r_[semof(rss[0]), *(semof(r)[n:] for r in rss[1:])]
    if knots:  # paw-adxi: a section's members are every output point re-seeded into it too (Reseed.hold_out)
        hold0 = knot_hold(knots, n)
        holdof = lambda r: hold0 if r is None or not r.born else np.asarray(r.hold_out, int)
        hold_all = np.r_[holdof(rss[0]), *(holdof(r)[n:] for r in rss[1:])]
        knots[:] = [(stem, np.flatnonzero(hold_all == s + 1), gid, m) for s, (stem, _, gid, m) in enumerate(knots)]
    born = [r for r in rss if r is not None and r.born]
    for k, r in sem_rec.items():  # pinned points retired as motion outliers (both passes)
        r["pruned"] = sum(x.pruned.get(sid[k], 0) for x in rss if x is not None)
        refill = sum(x.refilled.get(sid[k], 0) for x in rss if x is not None)
        if refill:
            r["refilled"] = refill  # v4.9: points re-laid on the re-detected region at soft cuts
    if born:
        from pawtrack.trackers import note
        sc = sum(r.soft_checks for r in born)
        note("reseed", f"re-seeded {sum(len(r.born) for r in born)} points into voids "
                       f"({sum(r.dropped for r in born)} retired, cap {born[0].cap})"
                       + (f"; {sc} soft-cut pass{'es' if sc > 1 else ''}" if sc else ""))
    s_rest = seed_axis(anc, aspect)
    new = None
    if mode != "off":
        from pawtrack.loops import held_from_diffs
        from pawtrack.trackers import note
        new = np.array(st["new"])
        assert len(rows) == new.sum(), (len(rows), new.sum())
        rows = [(t, *rows[k][1:]) for t, k in zip(st["ts"], np.cumsum(new) - 1)]  # held frame = its drawing
        alive = None if alive is None else alive[np.cumsum(new) - 1]
        h = held_from_diffs(st["d"][1:])
        note("held_input", f"held input {mode}: scene step {h['step']} ratio {h['ratio']}, "
                           f"tracked {int(new.sum())}/{len(rows)} frames"
                           f"{'' if st['thr'] is not None else ' (all: no twos/threes in the lookahead)'}",
             {"mode": mode, "step": int(h["step"]), "ratio": float(h["ratio"]), "tracked": int(new.sum()),
              "frames": len(rows)})
    if p.get("groups_only"):  # v4.45: both ways from the groups' frame, each way stops where their points are lost
        vis_, ts_ = [r[2] for r in rows], [r[0] for r in rows]
        kb, kf = lost_stop(vis_, ts_, seed_t, "backward", sem_all, n), lost_stop(vis_, ts_, seed_t, "forward", sem_all, n)
        a, b = kb[0] if kb else 0, kf[1] if kf else len(rows)
        if (a, b) != (0, len(rows)):
            from pawtrack.trackers import note
            note("lost", f"group points lost: kept {int(rows[a][0])}..{int(rows[b - 1][0])} ms ({len(rows) - (b - a)} frames dropped)",
                 {"t0_ms": int(rows[a][0]), "t1_ms": int(rows[b - 1][0]), "dropped": len(rows) - (b - a)})
            rows = rows[a:b]
            alive = None if alive is None else alive[a:b]
    if p.get("direction") in ("forward", "backward"):  # v4.15: stop where the tracked points are lost
        keep = lost_stop([r[2] for r in rows], [r[0] for r in rows], seed_t, p["direction"], sem_all, n)
        if keep is not None:
            a, b = keep
            from pawtrack.trackers import note
            note("lost", f"points lost {'before' if p['direction'] == 'backward' else 'after'} {int(rows[a if p['direction'] == 'backward' else b - 1][0])} ms: "
                         f"the run stops there ({len(rows) - (b - a)} frames dropped)",
                 {"t_ms": int(rows[a if p["direction"] == "backward" else b - 1][0]), "dropped": len(rows) - (b - a)})
            rows = rows[a:b]
            alive = None if alive is None else alive[a:b]
    ts = [r[0] for r in rows]
    tr = translation(np.array([r[1] for r in rows]), np.array([r[2] for r in rows]), anc, seed.mean(0))
    proj, travel, bridged, raw = stroke_proj(ts, tr, aspect, p)
    alive = [None] * len(rows) if alive is None else alive
    chs = [channels(xy, vis, s_rest, n_click, aspect, al) for (_, xy, vis, _, _), al in zip(rows, alive)]
    for ch, c in zip(chs, tr):  # the seed-anchored centroid: a point dropping out does not move it (not the visible mean)
        if ch["centroid_x"] is not None:
            ch["centroid_x"], ch["centroid_y"] = float(c[0]), float(c[1])
    if mask_at is not None:  # a pinned point counts for its group only while inside its part's mask
        def member(t, xy, vis):
            v = vis.copy()
            for gid, m in mask_at(t).items():
                k = np.flatnonzero(sem_all == gid)
                v[k] &= in_mask(m, xy[k])
            return v
        rows = [(t, xy, member(t, xy, vis), vp, cf) for t, xy, vis, vp, cf in rows]
        for (t, *_), ch in zip(rows, chs):
            mk = mask_at(t)
            for k, gid in sid.items():
                if sem_rec.get(k, {}).get("tracked"):
                    ch[f"sem_{k}_area"] = float(mk[gid].mean()) if gid in mk else 0.0
    g = group_channels(rows, chs, ts, aspect, p, new, sem_all, {i: k for k, i in sid.items()}, {x["id"]: x for x in mine if x["id"]})
    if knots:
        knot_channels(rows, chs, ts, aspect, p, g["cam"], knots, sem_all, anc)
    if tap is not None or sem_rec:
        with sub("labels"):  # v4.43: the tagger names the groups (its first load inside: stage "tagger")
            partlabel.scene_labels(tap, np.array(ts), np.array([r[1] for r in rows]), np.array([r[2] for r in rows]), g, aspect,
                                   {f"sem_{k}": r for k, r in sem_rec.items()})
    # proj_cam: proj's pipeline on the centroid in the background frame (groups' cam: cent + cam = image position)
    proj_cam, _, _, raw_cam = stroke_proj(ts, tr - g["cam"], aspect, p)
    prim = p["primary"]
    if prim == "auto":
        prim, rule = "proj", f"auto: {f'{n_click} click' if n_click == 1 else 'box'} → proj"
        if n_click >= 2:
            d = np.array([c["dist01"] for c in chs], float)
            sd = float(np.nanstd(d))
            if sd >= DIST_RATIO * travel:  # the clicks move against each other: two bodies
                prim = "dist01"
            two = prim == "dist01"
            rule = (f"auto: clicks move {'against each other' if two else 'together'} (std dist01 {sd:.3g} "
                    f"{'≥' if two else '<'} {DIST_RATIO:g} × travel {travel:.3g}) → {prim}")
        hips = hips_presence(g, chs)
        if prim != "dist01" and hips is not None and min(hips[:2]) >= HIPS_MIN:  # clicks on two bodies stay ahead
            prim = f"sem_{hips[2]}_proj"
            rule = f"auto: pinned {hips[2]} found on {round(100 * hips[0])} % of frames → {prim}"
    else:
        rule = f"explicit: {prim}"
    from pawtrack.trackers import note
    note("primary", f"points primary {p['primary']} -> {prim} (clicks {n_click}, axis {p['axis']})",
         primary_record(prim, rule, ts, tr, raw, raw_cam, chs, g, aspect, p) | {"seed": seed_rec | lay_rec})
    used = USED.get(prim, 2)
    raw_px = raw * H  # proj before normalization, frame px (dist01 / proj_cam in px when that is the primary)
    if prim == "proj_cam":
        raw_px = raw_cam * H
    if prim == "dist01":
        raw_px = np.array([np.nan if c["dist01"] is None else c["dist01"] * H for c in chs])
    from pawtrack.trackers import low_motion_note
    low_motion_note("points", [float(r) if np.isfinite(r) else None for r in raw_px])
    num = lambda x: float(x) if np.isfinite(x) else None
    for (t, xy, vis, vp, cf), ch, pj, pc, rc, br, rp, lab, al, pt in zip(rows, chs, proj, proj_cam, raw_cam * H, bridged,
                                                                         raw_px, g["labels"], alive, g["part"]):
        ch["proj"], ch["proj_cam"], ch["raw_px_cam"], ch["raw_px"] = num(pj), num(pc), num(rc), num(rp)
        ch["primary_used"] = used
        if prim == "centroid_auto":
            value = None if ch["centroid_x"] is None else (ch["centroid_x"] * W, ch["centroid_y"] * H)
        elif prim in ("centroid_y", "p0_y", "p1_y", "p2_y", "p3_y"):
            value = None if ch[prim] is None else -ch[prim]  # image-up = higher, like the other trackers
        else:
            value = ch[prim]
        conf = conf_of(vp, cf) * (0.1 if br else 1.0)  # bridged occlusion gap: low confidence
        yield t, {"value": value, "channels": ch, "confidence": conf}, overlay(xy, vis, lab, al, part=pt, sem=sem_all)


LOST_FRAC = 0.25  # v4.15 direction runs: the tracked points are lost when fewer than this share is visible ...
LOST_MS = 500     # ... for this long


def lost_stop(vis, ts, seed_t, direction, sem=None, n=None):
    """v4.15: where a one-way run (direction forward / backward from the seed frame) loses its points. vis: per row
    the visibility of every output point (rows sorted forward in time); the tracked points are the pinned ones (sem > 0)
    when there are any, else the n original seed points. Walking from the seed away in the direction, the first span of
    at least LOST_MS where their visible share is below LOST_FRAC: the run stops at its start. -> (a, b) the rows to keep
    (backward: a > 0, b = len; forward: a = 0, b < len), or None (never lost)."""
    if not len(vis):
        return None
    V = np.array([np.asarray(v, bool) for v in vis])
    sem = None if sem is None else np.asarray(sem)[:V.shape[1]]
    idx = np.flatnonzero(sem > 0) if sem is not None and (sem > 0).any() else np.arange(min(n or V.shape[1], V.shape[1]))
    if not len(idx):
        return None
    share = V[:, idx].mean(1)
    ts = np.asarray(ts, float)
    s = int(np.argmin(np.abs(ts - seed_t)))
    order = range(s, -1, -1) if direction == "backward" else range(s, len(ts))
    run0 = None
    for k in order:
        if share[k] < LOST_FRAC:
            run0 = k if run0 is None else run0
            if abs(ts[k] - ts[run0]) >= LOST_MS:
                if run0 == s:
                    return None   # lost at the seed itself: keep everything (the seeding failed, not the tracking)
                keep = (run0 + 1, len(ts)) if direction == "backward" else (0, run0)
                return keep if keep[1] - keep[0] >= 2 else None
        else:
            run0 = None
    return None


def reseed_rows(rows, rs, seed):
    """Runner rows + the ids they were received with (re-seeding) -> (rows over every output point (n + born) with
    vp / cf per output point (NaN where not alive), alive (T, N) bool, anchors (N, 2)). A point is padded invisible at its seed before its
    birth row and held at its last position, invisible, after it was retired."""
    T, N = len(rows), rs.n_out
    X, V, A = np.full((T, N, 2), np.nan), np.zeros((T, N), bool), np.zeros((T, N), bool)
    VP, CF = np.full((T, N), np.nan), np.full((T, N), np.nan)
    ts = np.array([r[0] for r in rows], float)
    for k, (_, xy, vis, vp, cf, ids) in enumerate(rows):
        m = ids >= 0
        X[k, ids[m]], V[k, ids[m]], A[k, ids[m]] = xy[m], vis[m], True
        VP[k, ids[m]], CF[k, ids[m]] = vp[m], cf[m]
    born_row = np.full(N, -1)
    for j, (tb, s) in rs.born.items():
        pre = ts < tb
        X[pre, j], V[pre, j], A[pre, j] = s, False, False
        born_row[j] = min(int(np.searchsorted(ts, tb)), T - 1)
    ok = np.isfinite(X[..., 0])
    X = X[np.maximum.accumulate(np.where(ok, np.arange(T)[:, None], 0), 0), np.arange(N)]
    out = [(t, X[k], V[k], VP[k], CF[k]) for k, t in enumerate(ts)]
    return out, A, anchors(X, V, seed, born_row)


def knot_members(groups, seed, sem, aspect):
    """v4.54 (paw-njnf): the knot is a section of a pinned group (the penis), not a group: its points are the group's seeded
    points inside the section's outlines (`knot`), a labelled subset that is tracked, fitted and re-placed as the group's own.
    groups: cli.parse_groups' entries; seed (n, 2) normalized; sem (n,) ids -> [(channel stem "<who>_knot" | "knot", indices,
    group id, the section's bool mask on the seed grid)] (none: a group without a section, or a section no point landed in;
    a stem a group of that name already uses is skipped: an old separate knot group keeps its channels)."""
    gh = max(8, round(partlabel.SEED_W / aspect))
    names, out = {g["name"] for g in groups}, []
    ij = np.clip(np.floor(np.asarray(seed, float).reshape(-1, 2) * [partlabel.SEED_W, gh]).astype(int), 0, [partlabel.SEED_W - 1, gh - 1])
    for g in groups:
        stem = f"{g['who']}_knot" if g.get("who") else "knot"
        if not g.get("knot") or not g.get("id") or stem in names:
            continue
        m = partlabel.erased_mask({"erased": g["knot"]}, partlabel.SEED_W, gh)
        idx = np.flatnonzero((np.asarray(sem) == g["id"]) & m[ij[:, 1], ij[:, 0]]) if m is not None else []
        if len(idx):
            out.append((stem, idx, g["id"], m))
            names.add(stem)
    return out


def knot_hold(knots, n):
    """paw-adxi: each of the n seeds' knot section (1-based, 0 = none) for Reseed's hold."""
    hold = np.zeros(n, int)
    for s, (_, idx, _, _) in enumerate(knots):
        hold[idx[idx < n]] = s + 1
    return hold


def knot_channels(rows, chs, ts, aspect, p, cam, knots, sem=None, anc=None):
    """v4.54: sem_<stem>_x / _y / _n / _proj for each knot section (knot_members) from its members, as a pinned group's
    (the seed-anchored centroid of the visible ones, camera removed; _n = visible members / all points): the names an old
    separate knot group had, so every reader (lib/shaft.js knotAt, fusion's knot part) reads the section the same way.
    paw-adxi: on a frame with none of its members visible (the knot inside the partner) the section's centre is carried
    by its group's fit (groups.robust_sim from the visible members' anchors anc (N, 2) to their places now; sem (N,) the
    group per point), with _n 0: the knot keeps its place on the shaft instead of vanishing and coming back."""
    from pawtrack.groups import centroid, robust_sim
    X, V = np.array([r[1] for r in rows], float), np.array([r[2] for r in rows], bool)
    num = lambda x: float(x) if np.isfinite(x) else None
    asp = np.array([aspect, 1.0])
    z = lambda a: a[:, 0] + 1j * a[:, 1]
    for stem, idx, gid, _ in knots:
        idx = idx[idx < V.shape[1]]
        c = centroid(X * asp, V, idx)
        share = V[:, idx].sum(1) / V.shape[1]
        if sem is not None and anc is not None and len(idx):
            grp = np.flatnonzero(np.asarray(sem)[:V.shape[1]] == gid)
            home = complex(*(np.asarray(anc, float)[idx] * asp).mean(0))
            for i in np.flatnonzero(share == 0):
                k = grp[V[i, grp]]
                if len(k) >= FIT_MIN:
                    a, b, _ = robust_sim(z(np.asarray(anc, float)[k] * asp), z(X[i, k] * asp), np.ones(len(k)))
                    q = a * home + b
                    c[i] = (q.real, q.imag)
        c = (c - np.asarray(cam, float) * asp) / asp
        pj = stroke_proj(ts, c, aspect, p)[0]
        for i, ch in enumerate(chs):
            ch[f"sem_{stem}_x"], ch[f"sem_{stem}_y"] = (num(v) for v in c[i])
            ch[f"sem_{stem}_n"], ch[f"sem_{stem}_proj"] = float(share[i]), num(pj[i])


def group_channels(rows, chs, ts, aspect, p, new=None, sem=None, names=None, meta=None):
    """Motion groups of the scene's points (pawtrack.groups) into the g*/n_groups/pair_dist/cam channels of chs.
    new: held_input mask (group pass on the drawings). sem (N,): pinned group per point (sem_* channels); names {id:
    name} of the pinned groups (default SEM's; v4.11 user groups: any name), kept in the result as sem_names.
    meta {id: parsed user group} (v4.12): who / part of each pinned group -> the characters' who_* channels
    (who_channels), their raw signals kept as who_sig (primary_record's candidates), parts as sem_parts.
    -> group_tracks' dict (labels (T, N) for the overlay, cam)."""
    from pawtrack.groups import group_tracks
    fps = 1000 * (len(ts) - 1) / (ts[-1] - ts[0]) if len(ts) > 1 and ts[-1] > ts[0] else 30.0
    axis = None
    if p["axis"] == "custom":
        axis = np.array([(p["axis_x1"] - p["axis_x0"]) * aspect, p["axis_y1"] - p["axis_y0"]])
        axis = axis if np.hypot(*axis) > 1e-6 else None
    vis = np.array([r[2] for r in rows])
    conf = np.array([np.asarray(r[4], float) for r in rows]) if rows and all(len(r[4]) == vis.shape[1] for r in rows) else None
    with steps("groups") as tick:  # v4.42: the pass's own share done; all CPU cores (groups.default_threads, paw-v0oe)
        g = group_tracks(np.array([r[1] for r in rows]), vis, fps, aspect=aspect, axis=axis, new=new,
                         pinned=sem if sem is not None and np.any(sem) else None, conf=conf, group_fit=bool(p.get("group_fit")),
                         tick=tick)
    num = lambda x: float(x) if np.isfinite(x) else None
    # g*_proj: each centroid through proj's own path (axis, sign, gap bridging, 0..1 per scene); pair_proj: pair_dist
    # (already the signed projection, sign fixed so > 0 on average) scaled 0..1 per scene, larger = farther apart
    gp = [stroke_proj(ts, g["cent"][:, k], aspect, p)[0] for k in range(4)]
    pd = g["pair_dist"]
    lo, hi = (np.nanmin(pd), np.nanmax(pd)) if np.isfinite(pd).any() else (0.0, 0.0)
    pp = (pd - lo) / (hi - lo) if hi - lo > 1e-12 else np.where(np.isfinite(pd), 0.5, np.nan)
    for i, ch in enumerate(chs):
        for k in range(4):
            ch[f"g{k + 1}_proj"] = num(gp[k][i])
        ch["pair_proj"] = num(pp[i])
        for k in range(4):
            on = g["share"][i, k] > 0
            ch[f"g{k + 1}_x"], ch[f"g{k + 1}_y"] = (num(c) if on else None for c in g["cent"][i, k])
            ch[f"g{k + 1}_n"] = float(g["share"][i, k])
        ch["n_groups"], ch["pair_dist"] = int(g["n_groups"][i]), num(g["pair_dist"][i])
        ch["cam_x"], ch["cam_y"] = (float(c) for c in g["cam"][i])
        ch["cam_conf"] = float(g["cam_conf"][i])
    # bodies -> parts (pawtrack.motion_model): g*_scale / g*_rot raw; a part's centroid / share, its centroid and its
    # motion in its body's frame (rel) through proj's path, its own scale term (raw); None for a part that never
    # exists in the scene
    pp = {(k, j): [stroke_proj(ts, g[c][:, k, j], aspect, p)[0] for c in ("part_cent", "part_rel")]
          for k in range(4) for j in range(MAX_PARTS) if g["part_share"][:, k, j].any()}
    for i, ch in enumerate(chs):
        for k in range(4):
            ch[f"g{k + 1}_scale"], ch[f"g{k + 1}_rot"] = num(g["scale"][i, k]), num(g["rot"][i, k])
        for (k, j), (pj, rl) in pp.items():
            n, on = f"g{k + 1}p{j + 1}", g["part_share"][i, k, j] > 0
            ch[n + "_x"], ch[n + "_y"] = (num(c) if on else None for c in g["part_cent"][i, k, j])
            ch[n + "_n"], ch[n + "_proj"], ch[n + "_rel"] = float(g["part_share"][i, k, j]), num(pj[i]), num(rl[i])
            ch[n + "_scale"] = num(g["part_scale"][i, k, j])
    # pinned semantic groups (box_seeds): like a part, but with a fixed membership; rel to the body around them
    g["sem_names"] = names = names or {k + 1: s for k, s in enumerate(SEM)}
    if "sem_cent" in g:
        sp = {k: [stroke_proj(ts, g[c][:, k], aspect, p)[0] for c in ("sem_cent", "sem_rel")]
              for k in range(g["sem_share"].shape[1]) if k + 1 in names and g["sem_share"][:, k].any()}
        for i, ch in enumerate(chs):
            for k, (pj, rl) in sp.items():
                n, on = f"sem_{names[k + 1]}", g["sem_share"][i, k] > 0
                ch[n + "_x"], ch[n + "_y"] = (num(c) if on else None for c in g["sem_cent"][i, k])
                ch[n + "_n"], ch[n + "_proj"], ch[n + "_rel"] = float(g["sem_share"][i, k]), num(pj[i]), num(rl[i])
                ch[n + "_scale"] = num(g["sem_scale"][i, k])
                for x in ("size", "rot", "fit"):  # v4.14 group_fit
                    if f"sem_{x}" in g:
                        ch[f"{n}_{x}"] = num(g[f"sem_{x}"][i, k]) if on else None
    g["sem_parts"] = {i: (meta or {}).get(i, {}).get("part") or s for i, s in names.items()}
    g["who_sig"] = who_channels(rows, chs, ts, aspect, p, g, sem, meta or {}, axis)
    return g


def who_channels(rows, chs, ts, aspect, p, g, sem, meta, axis):
    """v4.12 characters (PROTOCOL): per character c1 / c2 with pinned groups, who_<c>_x / _y / _n (its seed-anchored
    centre, groups.who_cent) and who_<c>_proj (through proj's path); between them, on the stroke axis
    (groups.axis_dist, frame heights, smaller = closer) and scaled 0..1 per scene: who_pair_* (Bottom centre to Top centre),
    who_p1h2_* (Bottom's penis to Top's hips), who_p2h1_* (Top's penis to Bottom's hips), each where both ends exist.
    -> {channel: raw signal} for the primary record's candidates."""
    from pawtrack.groups import axis_dist, who_cent
    whos = {}
    for i, m in meta.items():
        if m.get("who") and "sem_cent" in g and i - 1 < g["sem_cent"].shape[1]:
            whos.setdefault(m["who"], []).append(i)
    if not whos:
        return {}
    num = lambda x: float(x) if np.isfinite(x) else None
    xy, vis, sig, cents = np.array([r[1] for r in rows]), np.array([r[2] for r in rows]), {}, {}
    for w, ids in sorted(whos.items()):
        c, sh = who_cent(xy, vis, np.asarray(sem), ids, g["cam"], aspect)
        c[sh == 0] = np.nan
        pj, _, _, sig[f"who_{w}_proj"] = stroke_proj(ts, c, aspect, p)
        cents[w] = c
        for i, ch in enumerate(chs):
            ch[f"who_{w}_x"], ch[f"who_{w}_y"] = num(c[i, 0]), num(c[i, 1])
            ch[f"who_{w}_n"], ch[f"who_{w}_proj"] = float(sh[i]), num(pj[i])
    of = lambda w, part: next((i for i in sorted(whos.get(w, ())) if meta[i].get("part") == part), None)
    pairs = {"pair": ("c1", "c2")} if "c1" in cents and "c2" in cents else {}   # v4.30: an Extra (x) has a centre, no pair channel
    for k, (a, b) in (("p1h2", ("c1", "c2")), ("p2h1", ("c2", "c1"))):
        if of(a, "penis") and of(b, "hips"):
            pairs[k] = (of(a, "penis"), of(b, "hips"))
    for k, (a, b) in pairs.items():
        A, B = (cents[a], cents[b]) if k == "pair" else (g["sem_cent"][:, a - 1], g["sem_cent"][:, b - 1])
        d = sig[f"who_{k}_proj"] = axis_dist(A, B, aspect, axis)
        lo, hi = (np.nanmin(d), np.nanmax(d)) if np.isfinite(d).any() else (0.0, 0.0)
        pp = (d - lo) / (hi - lo) if hi - lo > 1e-12 else np.where(np.isfinite(d), 0.5, np.nan)
        for i, ch in enumerate(chs):
            ch[f"who_{k}_dist"], ch[f"who_{k}_proj"] = num(d[i]), num(pp[i])
    return sig


def hips_presence(g, chs):
    """(share of frames with pinned hips members visible, share with its sem_<name>_proj finite, name) | None without
    the group. The hips group = the lowest id whose part is hips: the tagger's / a user group named hips (id 3), else
    (v4.12) the first character's hips in request order (c1_hips, c2_hips)."""
    parts = g.get("sem_parts") or g["sem_names"]
    k = next((i - 1 for i in sorted(g["sem_names"]) if parts.get(i) == "hips"), None)
    if k is None or "sem_share" not in g or k >= g["sem_share"].shape[1] or not g["sem_share"][:, k].any():
        return None
    s = g["sem_names"][k + 1]
    return float(np.mean(g["sem_share"][:, k] > 0)), float(np.mean([c.get(f"sem_{s}_proj") is not None for c in chs])), s


def primary_record(prim, rule, ts, tr, raw, raw_cam, chs, g, aspect, p):
    """data of the `primary` note (PROTOCOL notes): the pick, its rule, and for every primary this run offers a few
    numbers: std and travel (p95 - p5) of the signal in frame heights, valid = share of frames with a value
    (+ cam_conf for proj_cam, share for g*). axis.deg = screen direction of rising value (0 right, 90 up).
    Reporting only: changes nothing."""
    from pawtrack.pipeline import pca_axis, sig3
    col = lambda k: np.array([np.nan if c[k] is None else c[k] for c in chs], float)
    sig = {"proj": raw, "proj_cam": raw_cam}
    if any(c["dist01"] is not None for c in chs):
        sig["dist01"] = col("dist01")
    for k in range(4):
        if g["share"][:, k].any():
            sig[f"g{k + 1}_proj"] = stroke_proj(ts, g["cent"][:, k], aspect, p)[3]
    if np.isfinite(g["pair_dist"]).any():
        sig["pair_proj"] = g["pair_dist"]
    for i, s in g["sem_names"].items():
        k = i - 1
        if "sem_share" in g and k < g["sem_share"].shape[1] and g["sem_share"][:, k].any():
            sig[f"sem_{s}_proj"] = stroke_proj(ts, g["sem_cent"][:, k], aspect, p)[3]
    sig.update(g.get("who_sig") or {})  # v4.12: the characters' centres and the Bottom / Top distances
    c = np.c_[col("centroid_x") * aspect, col("centroid_y")]
    sig["centroid_x"], sig["centroid_y"] = c[:, 0], c[:, 1]
    ok = np.isfinite(c[:, 0])
    if ok.sum() >= 2:
        sig["centroid_auto"] = np.where(ok, (c - c[ok].mean(0)) @ pca_axis(c[ok]), np.nan)
    for k in range(MAX_P):
        if any(ch[f"p{k}_x"] is not None for ch in chs):
            sig[f"p{k}_x"], sig[f"p{k}_y"] = col(f"p{k}_x") * aspect, col(f"p{k}_y")
    cand = {}
    for k, x in sig.items():
        x = np.asarray(x, float)
        x = x[np.isfinite(x)]
        cand[k] = {"std": sig3(np.std(x)) if len(x) >= 2 else None,
                   "travel": sig3(np.subtract(*np.percentile(x, [95, 5]))) if len(x) >= 2 else None,
                   "valid": sig3(len(x) / max(len(chs), 1))}
    cam_conf = float(np.mean(g["cam_conf"])) if len(chs) else None
    cand["proj_cam"]["cam_conf"] = sig3(cam_conf)
    for k in range(4):
        if f"g{k + 1}_proj" in cand:
            cand[f"g{k + 1}_proj"]["share"] = sig3(g["share"][:, k].mean())
    for i, s in g["sem_names"].items():
        k = i - 1
        if f"sem_{s}_proj" in cand:  # + present = share of frames with a visible member (auto's hips rule)
            cand[f"sem_{s}_proj"] |= {"share": sig3(g["sem_share"][:, k].mean()), "present": sig3(np.mean(g["sem_share"][:, k] > 0))}
    a = p["axis"]
    if a == "auto":
        q = (tr - g["cam"] if prim == "proj_cam" else tr) * [aspect, 1.0]
        q = q[np.isfinite(q[:, 0])]
        u = pca_axis(q) if len(q) >= 2 else None
    elif a == "custom":
        u = -np.array([(p["axis_x1"] - p["axis_x0"]) * aspect, p["axis_y1"] - p["axis_y0"]])
    else:
        u = np.array([0.0, -1.0] if a == "vertical" else [1.0, 0.0])
    cam = g["cam"] * [aspect, 1.0]
    return {"chosen": prim, "rule": rule, "candidates": cand,
            "axis": {"mode": a, "deg": None if u is None else sig3(np.degrees(np.arctan2(-u[1], u[0])))},
            "camera": {"cam_conf": sig3(cam_conf), "std": sig3(np.hypot(*np.std(cam, 0))) if len(cam) >= 2 else None}}


def fetch(url, path, what):
    if not path.exists():
        print(f"pawtrack: downloading {what}\n  {url}\n  -> {path}", file=sys.stderr)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        urllib.request.urlretrieve(url, tmp)
        tmp.replace(path)
    return path


def resize(bgr, wh):
    """BGR frame -> RGB at wh (nearest; frames arrive at up to 1920 wide, models work at 256-512)."""
    return cv2.cvtColor(cv2.resize(bgr, wh, interpolation=cv2.INTER_NEAREST), cv2.COLOR_BGR2RGB)
