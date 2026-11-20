"""Signal -> funscript points (design outline §9): smooth, turning points, map, simplify, caps."""
import sys

import numpy as np
from scipy.ndimage import median_filter, percentile_filter, uniform_filter1d
from scipy.signal import find_peaks, savgol_filter

from pawtrack.registry import param

PIPE_PARAMS = [
    param("pipe_smooth_ms", "Smoothing window (ms)", "int", 150, 0, 2000),
    param("pipe_min_prominence", "Min stroke size (0-1)", "float", 0.04, 0.0, 1.0),
    param("pipe_norm_window_ms", "Local range window (ms, 0 = whole scene)", "int", 3000, 0, 60000),
    param("pipe_norm_floor", "Local range floor (x median stroke)", "float", 0.75, 0.0, 2.0,   # measured: PROTOCOL v4.62
          hint="Near-still windows are not stretched (0 = off)"),
    param("pipe_pos_min", "Output min pos", "int", 0, 0, 100),
    param("pipe_pos_max", "Output max pos", "int", 100, 0, 100),
    param("pipe_rdp_epsilon", "Simplify tolerance (pos, 100 = extremes only)", "float", 100.0, 0.0, 100.0),
    param("pipe_hold_ms", "Min hold at a turn (ms, 0 = off)", "int", 0, 0, 10000),
    param("pipe_min_interval_ms", "Min point spacing (ms)", "int", 60, 0, 2000),
    param("pipe_max_speed", "Max speed (pos/s, 0 = off)", "float", 500.0, 0.0, 5000.0),
    param("pipe_snap_frames", "Turning points on frame timestamps", "bool", False),
    param("pipe_invert", "Invert (flip deep / out; pos 0 = deepest)", "bool", False),
    param("pipe_cadence_fill", "Fill strokes the tracker missed from the picture's rhythm", "bool", False),
    param("pipe_cam_detrend", "Remove the camera trend (pan / zoom / orbit / handheld)", "bool", True),   # v4.9 (experiments/softcuts)
]


HOLD_TOL = 0.05  # share of the (local) range
BLEND_MS = 500   # soft cut: the two segments' ranges cross-fade over this (no step at the cut)
SEG_MIN_MS = 1500  # soft cut: a normalisation segment shorter than this joins the one before (its own range would be noise)


def normalize(v):
    v = np.asarray(v, float)
    lo, hi = v.min(), v.max()
    return np.full_like(v, 0.5) if hi - lo < 1e-9 else (v - lo) / (hi - lo)


def local_normalize(v, win, starts=(), blend=1, floor=0.0):
    """Rolling robust range (p5..p95 over `win` samples, smoothed) -> 0..1, so a stroke counts by
    its size relative to the strokes around it, not to the scene's whole range (drift, camera
    residue or one big move would otherwise squash every other stroke under the prominence).
    starts (sample indices, v4.9 soft cuts): each segment gets its own range (no window reaches across a start; win 0 =
    the segment's p5..p95), the ranges cross-faded over `blend` samples at each start so the output does not step.
    floor (v4.62, units of v): a range under it counts as `floor` wide, so a near-still window is not stretched to
    full strokes."""
    starts = sorted(i for i in set(starts) if 0 < i < len(v))
    if not starts:
        lo, hi = _range(v, win)
    else:
        parts = [_range(v[a:b], win) for a, b in zip([0, *starts], [*starts, len(v)])]
        lo, hi = (np.concatenate([q[k] for q in parts]) for k in (0, 1))
        if blend > 1:  # a moving average of a step is a ramp: only near the starts
            near = np.zeros(len(v), bool)
            for i in starts:
                near[max(0, i - blend // 2):i + blend // 2 + 1] = True
            lo, hi = (np.where(near, uniform_filter1d(x, blend, mode="nearest"), x) for x in (lo, hi))
    return np.clip(0.5 + (v - (hi + lo) / 2) / np.maximum(hi - lo, max(floor, 1e-9)), 0.0, 1.0)


def _alternate(v, peaks, valleys):
    """Turning points [(index, +1 peak / -1 valley)], forced to alternate (the more extreme of a same-kind run)."""
    turns = []
    for i, k in sorted([(i, 1) for i in peaks] + [(i, -1) for i in valleys]):
        if turns and turns[-1][1] == k:
            if k * v[i] > k * v[turns[-1][0]]:
                turns[-1] = (i, k)
        else:
            turns.append((i, k))
    return turns


def stroke_amp(v, prom):
    """Median stroke size of v (units of v): turns at prom x the whole signal's p5..p95, so the jitter of a hold is
    no stroke. 0 with under two strokes."""
    lo, hi = np.percentile(v, [5, 95])
    q = prom * max(hi - lo, 1e-9)
    turns = _alternate(v, find_peaks(v, prominence=q)[0], find_peaks(-v, prominence=q)[0])
    d = np.abs(np.diff([v[i] for i, _ in turns]))
    return float(np.median(d)) if len(d) >= 2 else 0.0


def _range(v, win):
    if win <= 0:
        return np.full(len(v), np.percentile(v, 5)), np.full(len(v), np.percentile(v, 95))
    win = min(win, len(v))
    lo = uniform_filter1d(percentile_filter(v, 5, size=win, mode="nearest"), win, mode="nearest")
    hi = uniform_filter1d(percentile_filter(v, 95, size=win, mode="nearest"), win, mode="nearest")
    return lo, hi


def pca_axis(xy):
    """Unit principal axis of 2D points (PCA), signed so that up (or right) is positive."""
    c = xy - xy.mean(0)
    ax = np.linalg.eigh(c.T @ c)[1][:, -1]
    if (abs(ax[1]) >= abs(ax[0]) and ax[1] > 0) or (abs(ax[0]) > abs(ax[1]) and ax[0] < 0):
        ax = -ax  # image y grows downward: make "up" positive, else "right" positive
    return ax


ROLL_WIN, ROLL_HOP, ROLL_DEG = 120, 30, 20.0  # frames (4 s / 1 s at 30 fps), degrees
ROLL_Q = 90  # a clear window's variance >= 1/4 of this percentile of the windows' (median: a pair run that holds
             # a sync stretch, no relative motion, let its noise windows turn the axis; experiments/groups/RESULTS.md)


def rolling_axes(xy, win=ROLL_WIN, hop=ROLL_HOP, deg=ROLL_DEG):
    """Principal axis per sliding window (win frames, hop apart; each window's sign kept continuous with the one before)
    -> per frame (axis (n, 2) unit, centre (n, 2)), cross-faded with triangular weights; None when one scene-wide axis
    will do: fewer than two windows, or the clear windows' axes (anisotropy >= 2, variance >= 1/4 of the windows'
    ROLL_Q percentile) span <= deg degrees. A turntable / orbit shot turns the stroke axis in the image; this follows it
    (groups.pair_dist uses it).
    Overall sign: pca_axis's convention on the mean axis (up, else right = positive)."""
    xy = np.asarray(xy, float)
    n = len(xy)
    if n < 2 * win:
        return None
    starts = list(range(0, n - win + 1, hop))
    if starts[-1] + win < n:
        starts.append(n - win)
    ax, mu, ev = [], [], []
    for a in starts:
        w = xy[a:a + win]
        m = w.mean(0)
        e, V = np.linalg.eigh((w - m).T @ (w - m))
        ax.append(V[:, -1]), mu.append(m), ev.append(e)
    ax, mu, ev = np.array(ax), np.array(mu), np.array(ev)
    good = (ev[:, 1] >= 2 * ev[:, 0]) & (ev[:, 1] >= 0.25 * np.percentile(ev[:, 1], ROLL_Q)) & (ev[:, 1] > 0)
    if good.sum() < 2:
        return None
    gi = np.flatnonzero(good)
    for a, b in zip(gi, gi[1:]):  # sign continuity through the clear windows
        if ax[b] @ ax[a] < 0:
            ax[b] = -ax[b]
    ang = np.degrees(np.unwrap(np.arctan2(ax[gi, 1], ax[gi, 0])))
    if np.ptp(ang) <= deg:
        return None
    for k in np.flatnonzero(~good):  # an unclear window takes its nearest clear one's axis
        ax[k] = ax[gi[np.argmin(np.abs(gi - k))]]
    if (pca_axis(np.array([[0.0, 0.0], ax.mean(0)])) @ ax.mean(0)) < 0:
        ax = -ax
    num_a, num_m, den = np.zeros((n, 2)), np.zeros((n, 2)), np.zeros(n)
    tri = 1.0 - np.abs(np.arange(win) - (win - 1) / 2) / (win / 2) + 1e-3
    for a, u, m in zip(starts, ax, mu):
        num_a[a:a + win] += tri[:, None] * u
        num_m[a:a + win] += tri[:, None] * m
        den[a:a + win] += tri
    axes = num_a / np.maximum(np.hypot(num_a[:, 0], num_a[:, 1]), 1e-12)[:, None]
    return axes, num_m / den[:, None]


def project_auto(xy):
    """Project 2D displacements onto their principal axis (PCA). Sign: up (or right) = higher.
    Scene-wide on purpose: a rolling axis here (rolling_axes) lost on the gold set (largest body's centroid F1 0.555 ->
    0.518, groups probe); only groups.pair_dist rolls."""
    xy = np.asarray(xy, float)
    return (xy - xy.mean(0)) @ pca_axis(xy)


def sig3(x):
    """Number for a decision record (the `primary` note): 3 significant figures, None if missing / not finite."""
    return None if x is None or not np.isfinite(x) else float(f"{float(x):.3g}")


def _subframe(t, y, i):
    """Time of the extremum of the parabola through samples i-1, i, i+1 (within half a frame)."""
    if not 0 < i < len(y) - 1:
        return t[i]
    den = y[i - 1] - 2 * y[i] + y[i + 1]
    off = 0.0 if abs(den) < 1e-12 else float(np.clip(0.5 * (y[i - 1] - y[i + 1]) / den, -0.5, 0.5))
    return t[i] + off * (t[i + 1 - (off < 0)] - t[i - (off < 0)])


def _rdp(t, y, eps):
    """Indices kept by Ramer-Douglas-Peucker, using vertical (pos) distance to the chord. Iterative (no depth limit) and
    it only splits at an interior index, so it terminates whatever it is given (NaN, repeated or reversed times)."""
    t, y = np.asarray(t, float), np.asarray(y, float)
    keep, todo = {0, len(t) - 1}, [(0, len(t) - 1)]
    while todo:
        a, b = todo.pop()
        if b - a < 2:
            continue
        ts, ys = t[a:b + 1], y[a:b + 1]
        chord = ys[0] + (ys[-1] - ys[0]) * (ts - ts[0]) / max(ts[-1] - ts[0], 1e-9)
        d = np.nan_to_num(np.abs(ys - chord), nan=0.0)
        i = int(np.argmax(d[1:-1])) + 1
        if d[i] > eps:
            keep.add(a + i)
            todo += [(a, a + i), (a + i, b)]
    return sorted(keep) if len(t) > 1 else list(range(len(t)))


def to_points(t, v, p, bounds=()):
    """t: ms (sorted), v: 0..1 -> [{"at", "pos"}]. bounds (ms, v4.9): soft cuts, each starts its own normalisation
    segment (local_normalize starts)."""
    t = np.asarray(t, float)
    v = np.asarray(v, float)
    ok = np.isfinite(t) & np.isfinite(v)
    if not ok.all() or (np.diff(t[ok]) <= 0).any():  # a tracker's rows out of order / repeated / not finite: repair, say so
        order = np.argsort(t[ok], kind="stable")
        t, v = t[ok][order], v[ok][order]
        first = np.r_[True, np.diff(t) > 0]
        print(f"pawtrack: to_points: {len(ok) - int(first.sum())} of {len(ok)} samples dropped (not finite, out of time order "
              "or repeated times)", file=sys.stderr)
        t, v = t[first], v[first]
    n = len(t)
    if n == 0:
        return []
    # ponytail: smoothing assumes roughly uniform frame spacing (VFR drift ignored); resample first if that bites
    if n > 3:
        dt = float(np.median(np.diff(t))) or 1.0
        win = min(int(p["pipe_smooth_ms"] / dt) | 1, n if n % 2 else n - 1)
        if win >= 5:
            v = savgol_filter(v, win, 2)
    vs = v
    v = np.clip(v, 0.0, 1.0)
    starts = []
    for i in (np.searchsorted(t, sorted(bounds)) if len(bounds) and n > 3 else ()):
        if 0 < i < n and t[i] - t[starts[-1] if starts else 0] >= SEG_MIN_MS and t[-1] - t[i] >= SEG_MIN_MS:
            starts.append(int(i))
    if (p.get("pipe_norm_window_ms", 0) > 0 or starts) and n > 3:
        w, fl = p.get("pipe_norm_window_ms", 0), p.get("pipe_norm_floor", 0)
        floor = fl * stroke_amp(v, p["pipe_min_prominence"]) if fl > 0 else 0.0
        v = local_normalize(v, max(3, int(w / dt)) if w > 0 else 0, starts, max(1, int(BLEND_MS / dt)), floor)

    turns = _alternate(v, find_peaks(v, prominence=p["pipe_min_prominence"])[0],
                       find_peaks(-v, prominence=p["pipe_min_prominence"])[0])
    pos = p["pipe_pos_min"] + v * (p["pipe_pos_max"] - p["pipe_pos_min"])
    # holds: a turn whose signal stays within HOLD_TOL of it for >= pipe_hold_ms becomes two points
    # (arrival and departure, same pos), like a scripter's hold at the top / bottom
    edges = {}
    if p.get("pipe_hold_ms", 0) > 0:
        for i, _ in turns:
            a, b = i, i
            while a > 0 and abs(v[a - 1] - v[i]) <= HOLD_TOL:
                a -= 1
            while b < n - 1 and abs(v[b + 1] - v[i]) <= HOLD_TOL:
                b += 1
            if t[b] - t[a] >= p["pipe_hold_ms"]:
                edges[i] = (a, b)
                pos[a] = pos[b] = pos[i]
    idx = sorted({0, n - 1, *(j for i, _ in turns for j in edges.get(i, (i,)))})

    # RDP between consecutive turning points: extrema always survive, eps adds shape detail
    keep = [idx[0]]
    for a, b in zip(idx, idx[1:]):
        keep += [a + j for j in _rdp(t[a:b + 1], pos[a:b + 1], p["pipe_rdp_epsilon"])[1:]]

    turn_set = {i for i, _ in turns}
    out = []
    for i in keep:
        at, ps = int(round(t[i] if p["pipe_snap_frames"] or i not in turn_set else _subframe(t, vs, i))), float(pos[i])
        if out:
            dt = at - out[-1][0]
            if dt < max(p["pipe_min_interval_ms"], 1):
                continue
            if p["pipe_max_speed"] > 0:
                lim = p["pipe_max_speed"] * dt / 1000
                ps = out[-1][1] + float(np.clip(ps - out[-1][1], -lim, lim))
        out.append((at, ps))
    return [{"at": at, "pos": int(round(ps))} for at, ps in out]


# ---------------------------------------------------------------- activity gate (whole track range)

GATE_PARAMS = [
    param("pipe_gate", "Activity gate", "choice", "motion", choices=["off", "motion"]),
    param("pipe_gate_motion", "Min motion (grey levels)", "float", 4.0, 0.0, 100.0),
    param("pipe_gate_min_ms", "Min still span (ms)", "int", 2000, 0, 600000),
]
STATES = ("active", "idle", "carry", "climax", "orgasm")


# ---------------------------------------------------------------- cadence fill (experiments/fastmotion)

def cadence_turns(ts, thumbs):
    """ROI-free stroke turn times (ms) of one scene, no point lock: the first principal component of the 64 px
    thumbnails (2 s moving average removed), one sample per drawing when on twos/threes, band-passed around the
    scene's motion period (loops.detect_period, f0 / 2.5 .. 2.5 f0); every local max / min. Empty without a period.
    The eval's keyframe detector d_period_pcahp, which beat every point-track signal on stroke timing in fast and
    normal windows (experiments/fastmotion/RESULTS.md)."""
    from scipy.ndimage import gaussian_filter1d
    from scipy.signal import butter, sosfiltfilt
    from scipy.sparse.linalg import svds

    from pawtrack.loops import detect_period, held_frames, retime
    ts = np.asarray(ts, float)
    n = len(ts)
    none = np.zeros(0)
    if n < 16 or ts[-1] <= ts[0]:
        return none
    P = detect_period(thumbs)["period_frames"]
    if not P or n < 3 * P:
        return none
    fps = 1000 * (n - 1) / (ts[-1] - ts[0])
    X = np.asarray(thumbs, np.float32).reshape(n, -1)
    X = X - uniform_filter1d(X, max(3, int(round(2 * fps))), axis=0, mode="nearest")
    X = X - X.mean(0)
    if X.std() < 1e-6:
        return none
    u, s, _ = svds(X.astype(np.float64), k=1, random_state=0)
    x = u[:, 0] * s[0]
    h = held_frames(list(thumbs))
    if h["step"] >= 2:
        x = retime(ts, x, h["new"])
    x = gaussian_filter1d(x, max(0.5, 0.06 * fps), mode="nearest")
    f0 = fps / P
    lo, hi = f0 / 2.5, min(f0 * 2.5, 0.45 * fps)
    if hi <= lo:
        return none
    xb = sosfiltfilt(butter(2, [lo, hi], "bandpass", fs=fps, output="sos"), x)
    return ts[np.sort(np.r_[find_peaks(xb)[0], find_peaks(-xb)[0]]).astype(int)]


def cadence_fill(points, cad, min_gap_ms=60):
    """Add the strokes a tracker missed. points: one scene's extremes-only points; cad: cadence_turns. A cadence turn
    whose cell (halfway to its neighbour cadence turns) holds no point is a missed turn. A run of m missed turns
    between two points becomes alternating extremes (the opposite side of the point before first), cut to the
    parity that keeps the points alternating (both neighbours on one side -> odd, else even). Positions: the 10th /
    90th percentile of the points' pos within 3 s; nothing closer than min_gap_ms to a point. Pure: no thumbs."""
    if len(points) < 3 or len(cad) < 2:
        return points
    at = np.array([q["at"] for q in points], float)
    pos = np.array([q["pos"] for q in points], float)
    cad = np.sort(np.asarray(cad, float))
    mid = (cad[1:] + cad[:-1]) / 2
    lo, hi = np.r_[cad[0] - (mid[0] - cad[0]), mid], np.r_[mid, cad[-1] + (cad[-1] - mid[-1])]
    miss = (np.searchsorted(at, hi) - np.searchsorted(at, lo) == 0) & (cad > at[0]) & (cad < at[-1])
    gap = np.searchsorted(at, cad)  # a missed turn lies between points gap-1 and gap
    add = []
    for g in np.unique(gap[miss]):
        run = cad[miss & (gap == g)]
        a, b = g - 1, g
        near = np.abs(at - run.mean()) <= 3000
        near[[a, b]] = True
        low, high = np.percentile(pos[near], 10), np.percentile(pos[near], 90)
        c = (low + high) / 2
        up_a, up_b = pos[a] >= c, pos[b] >= c
        m = len(run) if (len(run) % 2 == 1) == (up_a == up_b) else len(run) - 1
        side = not up_a
        for t in run[:m]:
            add.append({"at": int(round(t)), "pos": int(round(high if side else low))})
            side = not side
    if not add:
        return points
    out = sorted(points + add, key=lambda q: q["at"])
    keep = [out[0]]
    for q in out[1:]:
        if q["at"] - keep[-1]["at"] >= max(min_gap_ms, 1):
            keep.append(q)
    return keep


def motion_energy(ts, thumbs):
    """Per frame: RMS grey-level difference to the frame ~125 ms earlier (so animation on twos/
    threes doesn't read as still), on the 64 px loop thumbnails. NaN for the first frames of a scene."""
    e = np.full(len(thumbs), np.nan)
    if len(thumbs) < 2:
        return e
    k = max(1, round(125 / (float(np.median(np.diff(ts))) or 1.0)))
    th = np.asarray(thumbs, np.float32)
    if len(th) > k:
        e[k:] = np.sqrt(((th[k:] - th[:-k]) ** 2).mean(axis=(1, 2)))
    return e


def gate_states(t, e, p, labels=()):
    """Per frame "active" | "still" | "idle" over the whole track range (cuts don't matter: the action often
    carries on through a cut-away). Motion: the 2 s median of `e` below pipe_gate_motion is still; still runs >=
    pipe_gate_min_ms are "idle" where they touch the start or end of the range (intros, outros), else "still". Flags
    only: apply_gate never moves points for them. `labels` [{"start_ms","end_ms","state"}] (the UI or a story
    timeline) override everything they cover.
    ponytail: absolute grey-level threshold on 64 px thumbs; per-clip calibration if it misfires."""
    t = np.asarray(t, float)
    st = np.array(["active"] * len(t), dtype=object)
    if p["pipe_gate"] == "motion" and len(t) > 2 and np.isfinite(e).any():
        dt = float(np.median(np.diff(t))) or 1.0
        x = np.asarray(e, float)
        ok = np.isfinite(x)
        x = np.interp(t, t[ok], x[ok])  # cut frames take their neighbours' value
        win = max(1, int(2000 / dt)) | 1
        still = median_filter(x, win, mode="nearest") < p["pipe_gate_motion"]
        edges = np.flatnonzero(np.diff(np.r_[0, still.astype(int), 0]))
        for a, b in zip(edges[::2], edges[1::2]):  # still run [a, b)
            if t[b - 1] - t[a] + dt >= p["pipe_gate_min_ms"]:
                st[a:b] = "idle" if a == 0 or b == len(t) else "still"
    for lab in labels or ():
        if lab["state"] not in STATES:
            raise ValueError(f"span state {lab['state']!r} not in {STATES}")
        st[(t >= lab["start_ms"]) & (t < lab["end_ms"])] = lab["state"]
    return st


def _turns(pts):
    """Turning points of a point list -> (times, positions, kinds +1/-1)."""
    a = np.array([q["at"] for q in pts], float)
    x = np.array([q["pos"] for q in pts], float)
    if len(x) < 3:
        return a[:0], x[:0], x[:0]
    d = np.sign(np.diff(x))
    i = np.flatnonzero(d[1:] * d[:-1] < 0) + 1
    return a[i], x[i], -d[i]


def apply_gate(points, t, st, events, held=None, context_ms=10000):
    """Appends one event per non-active span: {"t_ms", "end_ms", "kind": "idle"|"carry"|"still"|"climax"|"orgasm",
    "label"}. Points change only where a span label set the state (held, per frame): "idle" -> hold at the position
    where the span starts; "carry" -> continue the rhythm of the nearest active stretch (median period and median top
    / bottom of its strokes within context_ms, earlier side preferred), starting from the position at the span start.
    Every other span, and every automatic one, only flags.
    ponytail: carry keeps the rate, not the phase; the reference scripts carry the rate through
    cut-aways but their phase is unrelated (measured), so nothing better is known."""
    t = np.asarray(t, float)
    if not len(points):
        return points
    held = np.zeros(len(t), bool) if held is None else held
    pos_at = lambda x: float(np.interp(x, [q["at"] for q in points], [q["pos"] for q in points]))
    edges = np.flatnonzero(np.r_[True, (st[1:] != st[:-1]) | (held[1:] != held[:-1]), True])
    out = list(points)
    for a, b in zip(edges[:-1], edges[1:]):
        kind = st[a]
        if kind == "active":
            continue
        t0, t1 = int(t[a]), int(t[b]) if b < len(t) else int(t[-1]) + 1
        events.append({"t_ms": t0, "end_ms": t1, "kind": kind, "label": f"{kind} {(t1 - t0) / 1000:.1f} s"})
        if kind not in ("idle", "carry") or not held[a]:
            continue
        new = [{"at": t0, "pos": round(pos_at(t0))}]
        if kind == "carry":
            near = [q for q in points if t0 - context_ms <= q["at"] < t0 and st[min(np.searchsorted(t, q["at"]), len(t) - 1)] == "active"]
            near = near if len(near) >= 5 else [q for q in points if t1 <= q["at"] < t1 + context_ms]
            tt, xx, kk = _turns(near)
            if (kk > 0).sum() >= 2 and (kk < 0).sum() >= 1:
                half = float(np.median(np.diff(tt[kk > 0]))) / 2
                top, bot = float(np.median(xx[kk > 0])), float(np.median(xx[kk < 0]))
                up = new[0]["pos"] < (top + bot) / 2
                at = t0 + half
                while at < t1 - half / 2:
                    new.append({"at": int(at), "pos": round(top if up else bot)})
                    up, at = not up, at + half
        new.append({"at": t1 - 1, "pos": new[-1]["pos"] if kind == "idle" else round(pos_at(t1 - 1))})
        out = [q for q in out if not t0 <= q["at"] < t1] + [q for q in new if q["at"] >= t0]
    out.sort(key=lambda q: q["at"])
    return [q for i, q in enumerate(out) if i == 0 or q["at"] > out[i - 1]["at"]]


PIPE_PARAMS += GATE_PARAMS  # listed and coerced with the other pipe_* params


def finish_range(segs, points, p, labels, events):
    """Whole track range, after every scene went through process_scene: the activity gate's flags and the span labels.
    segs: [(t_ms list, thumbs list)] per scene. Returns the points (moved only under an "idle" / "carry" label)."""
    if p["pipe_gate"] == "off" and not labels:
        return points
    t = np.concatenate([np.asarray(ts, float) for ts, _ in segs])
    e = np.concatenate([motion_energy(ts, th) if th else np.full(len(ts), np.nan) for ts, th in segs])
    held = np.zeros(len(t), bool)
    for lab in labels or ():
        held[(t >= lab["start_ms"]) & (t < lab["end_ms"])] = True
    return apply_gate(points, t, gate_states(t, e, p, labels), events, held)


# ---------------------------------------------------------------- camera trend (v4.9, experiments/softcuts)

PROGRESSIVE = ("pan", "zoom", "orbit", "handheld")  # camera.PROGRESSIVE (not imported: camera pulls cv2)
CAM_CONF_MIN = 0.3  # mean cam_conf over a piece for the tracker's camera path to be trusted
TREND_K = 1.5       # a trend travelling more than this x the stroke amplitude is removed (and makes a piece progressive)
SHARE_MAX = 0.5     # ... and only where the strokes are drowned: stroke amplitude / piece range below this
PERIODIC = 0.3      # ... and only where there are strokes: velocity autocorrelation peak (stroke_period) at least this


def stroke_period(x, dt, min_ac=0.1):
    """Samples per stroke of x from its velocity autocorrelation (highest peak at 0.2..2.5 s, >= min_ac); None if none.
    Velocity, not position: a pan's ramp is a constant there."""
    x = np.asarray(x, float)
    k = max(1, int(round(100 / dt)))
    d = np.diff(uniform_filter1d(x, k, mode="nearest"))
    d = d - d.mean()
    lo, hi = max(2, int(200 / dt)), min(len(d) // 2, int(2500 / dt))
    if hi <= lo + 1 or d.std() < 1e-12:
        return None
    f = np.fft.rfft(d, 2 * len(d))
    ac = np.fft.irfft(f * np.conj(f))[:len(d)] / (d.var() * len(d))
    j = lo + int(np.argmax(ac[lo:hi]))
    return j if ac[j] >= min_ac else None


def trend(x, per):
    """Robust low-pass: median over one stroke period (spikes go), then the mean over one period (a periodic stroke
    averages out exactly, a ramp passes)."""
    per = max(3, int(per)) | 1
    return uniform_filter1d(median_filter(x, per, mode="nearest"), per, mode="nearest")


def _p90(x):
    return float(np.subtract(*np.percentile(x, [95, 5]))) if len(x) >= 2 else 0.0


def cam_detrend(t, v, soft=(), camera=None, chans=None, p=None, rec=None):
    """One scene's primary (0..1, NaN = lost) with the camera's trend removed where the camera travels. Pieces: the
    scene split at the soft cuts (ms) and at the camera detector's segment starts (camera: [{t0, t1, kind}]). A piece
    is progressive when its camera kind is pan / zoom / orbit / handheld, or when the tracker's camera path (chans
    cam_x / cam_y, cam_conf) moves the primary by more than TREND_K x the stroke amplitude; and only when its strokes
    are periodic (stroke_period at PERIODIC) and drowned (stroke amplitude < SHARE_MAX x the piece's range: a piece
    whose strokes already fill it is left alone, detrending there only adds noise turns). In a progressive piece:
    when its mean cam_conf >= CAM_CONF_MIN the camera path is regressed onto the primary (least squares on cam_x /
    cam_y, so its axis and scale need not be known; a primary the camera does not move gets ~0) and subtracted; a
    trend still travelling > TREND_K x the stroke amplitude (no camera reference, a zoom) then goes too (trend(): one
    stroke period). Removal is relative to the piece's first frame and its end offset is carried to the rest of the
    scene, so the signal never steps. rec (list) gets one record per piece when there are several pieces or anything
    was removed: {t0, t1, kind, detrend: cam | trend | cam+trend | None, why, trend (removed travel, share of the scene
    range), trend_px?, amp (stroke amplitude, scene range), share_before / share_after (stroke amplitude / piece range)}.
    -> v (same shape)."""
    v = np.asarray(v, float)
    t = np.asarray(t, float)
    ok = np.isfinite(v)
    n = len(v)
    if ok.sum() < 8 or (p is not None and not p.get("pipe_cam_detrend", True)):
        return v
    x = np.interp(t, t[ok], v[ok])
    dt = float(np.median(np.diff(t))) or 1.0
    camera = camera or []
    cuts = sorted({float(c) for c in soft} | {float(s["t0"]) for s in camera})
    starts = sorted({0, *(int(i) for i in np.searchsorted(t, cuts) if 0 < i < n)})
    ch = None
    if chans is not None and chans.get("cam_x") is not None:
        ch = {k: np.asarray(chans[k], float) for k in ("cam_x", "cam_y", "cam_conf")}
    px = None  # frame px per unit of v: when raw_px is the primary before its 0..1 scaling
    if chans is not None and chans.get("raw_px") is not None:
        r = np.asarray(chans["raw_px"], float)
        m = ok & np.isfinite(r)
        if m.sum() >= 8 and r[m].std() > 1e-9 and abs(np.corrcoef(r[m], v[m])[0, 1]) > 0.99:
            px = abs(float(np.polyfit(v[m], r[m], 1)[0]))
    D = np.zeros(n)
    carry, out, did = 0.0, [], False
    for a, b in zip(starts, [*starts[1:], n]):
        xs = x[a:b]
        kinds = {}
        for s in camera:
            kinds[s["kind"]] = kinds.get(s["kind"], 0) + max(0.0, min(s["t1"], t[b - 1] + dt) - max(s["t0"], t[a]))
        kind = max(kinds, key=kinds.get) if kinds and max(kinds.values()) > 0 else None
        r = {"t0": int(t[a]), "t1": int(t[b - 1] + dt) if b == n else int(t[b]), "kind": kind, "detrend": None}
        per = stroke_period(xs, dt, PERIODIC) if b - a >= 16 else None
        d = np.zeros(b - a)
        if per and b - a >= 2 * per:
            amp = _p90(xs - trend(xs, per))
            ct, why = None, None
            if ch is not None:
                c = ch["cam_conf"][a:b]
                cx, cy = ch["cam_x"][a:b], ch["cam_y"][a:b]
                m = ok[a:b] & np.isfinite(cx) & np.isfinite(cy)
                if np.nanmean(c) >= CAM_CONF_MIN and m.sum() >= 8:
                    A = np.c_[np.ones(m.sum()), cx[m] - cx[m][0], cy[m] - cy[m][0]]
                    beta = np.linalg.lstsq(A, xs[m], rcond=None)[0]
                    ct = np.c_[np.nan_to_num(cx - cx[m][0]), np.nan_to_num(cy - cy[m][0])] @ beta[1:]
            drowned = amp < SHARE_MAX * _p90(xs)
            prog = kind in PROGRESSIVE and drowned
            if prog:
                why = f"camera {kind}"
            elif drowned and ct is not None and _p90(ct) > TREND_K * amp:
                prog, why = True, "camera travel"
            if prog:
                y = xs
                if ct is not None:
                    d, y, r["detrend"] = ct - ct[0], xs - (ct - ct[0]), "cam"
                tr = trend(y, per)
                if _p90(tr) > TREND_K * _p90(y - tr):
                    d = d + tr - tr[0]
                    r["detrend"] = "cam+trend" if r["detrend"] else "trend"
                if r["detrend"]:
                    did = True
                    r |= {"why": why, "trend": sig3(_p90(d))}
                    if px:
                        r["trend_px"] = int(round(_p90(d) * px))
            y = xs - d
            r |= {"amp": sig3(amp), "share_before": sig3(amp / max(_p90(xs), 1e-9)),
                  "share_after": sig3(_p90(y - trend(y, per)) / max(_p90(y), 1e-9))}
        D[a:b] = carry + d
        carry = D[b - 1]
        out.append(r)
    if rec is not None and (len(out) > 1 or did):
        rec += out
    return np.where(ok, v - D, np.nan) if did else v
