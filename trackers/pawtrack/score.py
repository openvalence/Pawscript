"""The yardstick: a candidate funscript vs a reference funscript over [t0, t1).

score(cand, ref, t0, t1, fps) -> dict. Scripts are lists of {"at": ms, "pos": 0..100}.

Steps
1. Both scripts are resampled at RATE Hz by linear interpolation between actions (how a device
   plays them); before the first / after the last action the position is held.
2. Sign: the candidate may be upside down (trackers' sign is arbitrary). Both signs are tried and
   the one with the higher lag-compensated position correlation is kept; `sign` says which (-1 =
   candidate was flipped to 100 - pos). Everything below uses the chosen sign.
3. Lag: Pearson r of position for candidate shifts within +-lag_bound; `lag_ms` > 0 = candidate is
   LATE. lag_bound = min(MAX_LAG_MS, P/4), P = median reference stroke period: beyond a quarter
   period, "late" and "inverted + early" are the same signal, so a wider window makes the sign
   choice a coin flip. Lag is only reported; the `*_lag` fields are recomputed with the candidate
   shifted back by it, every other field is at zero lag.
4. Shape: Pearson r of position and of velocity, at zero lag and at the best lag.
5. Strokes: turning points (peaks/valleys with prominence >= MIN_PROM pos; a flat top counts at its
   arrival) are matched one-to-one, same kind only, within +-tol_ms, closest first.
   -> precision / recall / f1, |dt| median and p90 in ms and frames, dt bias (signed median).
6. Amplitude: at matched turns, |pos_cand - pos_ref| (do they hit the same top/bottom); per stroke
   (two consecutive reference turns both matched to two consecutive candidate turns),
   |amp_cand - amp_ref| and amp_cand / amp_ref. Range usage: p5/p95 of position and the median
   peak / valley position of each script.

f1_sign_oracle: F1 with, per scored range, whichever sign gives more matched turns (an upper
bound that takes the sign choice out; the headline's correlation-picked sign is noisy when r_pos is low).
f1_fixed_sign / r_pos_fixed_sign: the candidate exactly as given, never flipped (zero lag). The headline
lets every range pick its sign for free, so only these show whether the direction was right.

HEADLINE = f1 (zero lag, sign chosen per scored range, tol 150 ms), pooled over scenes as
micro-F1 (sum of tp/fp/fn). It rewards producing a stroke at every human stroke, at the right time
and direction, and nothing else. It ignores amplitude/depth, the shape between turning points and
a constant position offset; those are reported next to it (amp_err, turn_pos_err, r_pos). A late
tracker is penalised by it (lag is a real defect on a device); f1_lag shows what fixing it buys.
"""
import numpy as np
from scipy.signal import find_peaks

RATE = 100         # Hz
TOL_MS = 150
MIN_PROM = 10      # pos units: a reversal smaller than this is not a stroke
MAX_LAG_MS = 500


def resample(actions, t0, t1, rate=RATE):
    t = np.arange(t0, t1, 1000.0 / rate)
    if not actions:
        return t, np.full(len(t), 50.0)  # ponytail: no script = device parked mid-stroke, never moves
    a = sorted(actions, key=lambda a: a["at"])
    return t, np.interp(t, [x["at"] for x in a], [float(x["pos"]) for x in a])


def turns(t, x, min_prom=MIN_PROM):
    """Turning points -> (times ms, kinds +1 peak / -1 valley, positions), sorted by time."""
    out = []
    for k in (1, -1):
        _, pr = find_peaks(k * x, prominence=min_prom, plateau_size=1)
        out += [(t[i], k, x[i]) for i in pr["left_edges"]]  # flat top/bottom: time of arrival
    out.sort()
    return (np.array([o[0] for o in out], float), np.array([o[1] for o in out], int),
            np.array([o[2] for o in out], float))


def match(ta, ka, tb, kb, tol):
    """One-to-one same-kind matching within tol, closest pairs first. -> list of (i, j)."""
    cands = []
    for i, (t, k) in enumerate(zip(ta, ka)):
        lo, hi = np.searchsorted(tb, t - tol), np.searchsorted(tb, t + tol, side="right")
        cands += [(abs(tb[j] - t), i, j) for j in range(lo, hi) if kb[j] == k]
    cands.sort()
    used_a, used_b, pairs = set(), set(), []
    for _, i, j in cands:
        if i not in used_a and j not in used_b:
            used_a.add(i), used_b.add(j), pairs.append((i, j))
    return sorted(pairs)


def pearson(a, b):
    if len(a) < 3 or a.std() < 1e-9 or b.std() < 1e-9:
        return float("nan")
    return float(np.corrcoef(a, b)[0, 1])


def shift(x, n):
    """x delayed by -n samples (n > 0: advance a late signal), edges held."""
    if n == 0:
        return x
    return np.concatenate([x[n:], np.full(n, x[-1])]) if n > 0 else np.concatenate([np.full(-n, x[0]), x[:n]])


def best_lag(r, c, bound):
    """Lag (samples, > 0 = c late) maximising r(pos) within +-bound (ties -> smaller |lag|), and that r."""
    best = (0, float("-inf"))
    for L in sorted(range(-bound, bound + 1), key=abs):
        v = pearson(r[:len(r) - L], c[L:]) if L >= 0 else pearson(r[-L:], c[:L])
        if v > best[1]:
            best = (L, v)
    return best if np.isfinite(best[1]) else (0, float("nan"))


def _strokes(t, x, rt, rk, rp, tol):
    ct, ck, cp = turns(t, x)
    pairs = match(rt, rk, ct, ck, tol)
    tp = len(pairs)
    dts = np.array([ct[j] - rt[i] for i, j in pairs])
    perr = np.array([abs(cp[j] - rp[i]) for i, j in pairs])
    amp_err, amp_ratio = [], []
    pm = dict(pairs)
    for i in range(1, len(rt)):
        if i in pm and i - 1 in pm and pm[i] == pm[i - 1] + 1:
            ar, ac = abs(rp[i] - rp[i - 1]), abs(cp[pm[i]] - cp[pm[i - 1]])
            amp_err.append(abs(ac - ar))
            if ar > 0:
                amp_ratio.append(ac / ar)
    return {"tp": tp, "fp": len(ct) - tp, "fn": len(rt) - tp, "n_cand_turns": len(ct),
            "_dts": dts.tolist(), "_perr": perr.tolist(), "_amp_err": amp_err, "_amp_ratio": amp_ratio,
            "_cand_turns": (ct, ck, cp)}


def _med(v, q=50):
    return float(np.percentile(v, q)) if len(v) else float("nan")


def _prf(tp, fp, fn):
    p = tp / (tp + fp) if tp + fp else (1.0 if fn == 0 else 0.0)
    r = tp / (tp + fn) if tp + fn else (1.0 if fp == 0 else 0.0)
    return p, r, (2 * p * r / (p + r) if p + r else 0.0)


def score(cand, ref, t0, t1, fps=30.0, tol_ms=TOL_MS):
    t, r = resample(ref, t0, t1)
    _, c = resample(cand, t0, t1)
    if len(t) < 3:
        return None
    rt, rk, rp = turns(t, r)
    peaks = rt[rk == 1]
    period = float(np.median(np.diff(peaks))) if len(peaks) >= 2 else float("inf")
    bound = max(1, int(min(MAX_LAG_MS, period / 4) * RATE / 1000))

    # sign: whichever orientation correlates better at its own best lag
    lp, vp = best_lag(r, c, bound)
    ln, vn = best_lag(r, 100 - c, bound)
    sign = -1 if (np.isfinite(vn) and (not np.isfinite(vp) or vn > vp)) else 1
    if sign < 0:
        c, lag = 100 - c, ln
    else:
        lag = lp
    cs = shift(c, lag)
    vr, vc, vcs = np.diff(r), np.diff(c), np.diff(cs)

    s0 = _strokes(t, c, rt, rk, rp, tol_ms)
    s1 = _strokes(t, cs, rt, rk, rp, tol_ms)
    p, rc, f1 = _prf(s0["tp"], s0["fp"], s0["fn"])
    ct, ck, cp = s0.pop("_cand_turns")
    s1.pop("_cand_turns")
    s2 = _strokes(t, 100 - c, rt, rk, rp, tol_ms)  # the other sign, zero lag
    dur_min = (t1 - t0) / 60000
    out = {
        "t0": t0, "t1": t1, "duration_ms": t1 - t0,
        "n_ref_turns": len(rt), "spm_ref": round(len(peaks) / dur_min, 2) if dur_min else 0,
        "spm_cand": round(int((ck == 1).sum()) / dur_min, 2) if dur_min else 0,
        "sign": sign, "lag_ms": lag * 1000 / RATE, "lag_bound_ms": bound * 1000 / RATE,
        "r_pos": pearson(r, c), "r_vel": pearson(vr, vc),
        "r_pos_lag": pearson(r, cs), "r_vel_lag": pearson(vr, vcs),
        **s0, "precision": p, "recall": rc, "f1": f1,
        "f1_lag": _prf(s1["tp"], s1["fp"], s1["fn"])[2],
        "dt_median_ms": _med(np.abs(s0["_dts"])), "dt_p90_ms": _med(np.abs(s0["_dts"]), 90),
        "dt_bias_ms": _med(s0["_dts"]),
        "turn_pos_err": _med(s0["_perr"]), "amp_err": _med(s0["_amp_err"]), "amp_ratio": _med(s0["_amp_ratio"]),
        "range_ref": [_med(r, 5), _med(r, 95)], "range_cand": [_med(c, 5), _med(c, 95)],
        "top_ref": _med(rp[rk == 1]), "bottom_ref": _med(rp[rk == -1]),
        "top_cand": _med(cp[ck == 1]), "bottom_cand": _med(cp[ck == -1]),
        "fps": fps,
    }
    out["dt_median_frames"] = out["dt_median_ms"] * fps / 1000
    out["dt_p90_frames"] = out["dt_p90_ms"] * fps / 1000
    out["_lag_tp"], out["_lag_fp"], out["_lag_fn"] = s1["tp"], s1["fp"], s1["fn"]
    best = s2 if s2["tp"] > s0["tp"] else s0
    out["_or_tp"], out["_or_fp"], out["_or_fn"] = best["tp"], best["fp"], best["fn"]
    out["f1_sign_oracle"] = _prf(best["tp"], best["fp"], best["fn"])[2]
    fx = s0 if sign > 0 else s2  # the candidate as given, never flipped
    out["_fx_tp"], out["_fx_fp"], out["_fx_fn"] = fx["tp"], fx["fp"], fx["fn"]
    out["f1_fixed_sign"] = _prf(fx["tp"], fx["fp"], fx["fn"])[2]
    out["r_pos_fixed_sign"] = sign * out["r_pos"]
    return out


def aggregate(scores):
    """Pool per-scene scores (each with its own sign and lag): micro precision/recall/F1 from summed
    counts, pooled timing/amplitude errors, duration-weighted mean of correlations."""
    scores = [s for s in scores if s]
    if not scores:
        return {}
    sm = lambda k: sum(s[k] for s in scores)
    pool = lambda k: [v for s in scores for v in s[k]]
    p, r, f1 = _prf(sm("tp"), sm("fp"), sm("fn"))
    out = {"scenes": len(scores), "duration_ms": sm("duration_ms"),
           "tp": sm("tp"), "fp": sm("fp"), "fn": sm("fn"), "precision": p, "recall": r, "f1": f1,
           "f1_lag": _prf(sm("_lag_tp"), sm("_lag_fp"), sm("_lag_fn"))[2],
           "f1_sign_oracle": _prf(sm("_or_tp"), sm("_or_fp"), sm("_or_fn"))[2],
           "f1_fixed_sign": _prf(sm("_fx_tp"), sm("_fx_fp"), sm("_fx_fn"))[2]}
    for k in ("r_pos", "r_vel", "r_pos_lag", "r_vel_lag", "lag_ms", "r_pos_fixed_sign"):
        w = [(s[k], s["duration_ms"]) for s in scores if np.isfinite(s[k])]
        out[k] = sum(v * d for v, d in w) / sum(d for _, d in w) if w else float("nan")
    dts = np.abs(pool("_dts"))
    fps = np.average([s["fps"] for s in scores], weights=[s["duration_ms"] for s in scores])
    out.update({"dt_median_ms": _med(dts), "dt_p90_ms": _med(dts, 90), "dt_bias_ms": _med(pool("_dts")),
                "dt_median_frames": _med(dts) * fps / 1000, "dt_p90_frames": _med(dts, 90) * fps / 1000,
                "turn_pos_err": _med(pool("_perr")), "amp_err": _med(pool("_amp_err")),
                "amp_ratio": _med(pool("_amp_ratio")),
                "inverted_share": sum(s["duration_ms"] for s in scores if s["sign"] < 0) / out["duration_ms"]})
    return out


def public(d):
    """Drop the pooled-list helpers (keys starting with '_') for JSON output."""
    return {k: v for k, v in d.items() if not k.startswith("_")}
