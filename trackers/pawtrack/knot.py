"""Knot passes from sam2_mask per-frame mask area (experiments/knot/RESULTS.md: 21/21 at +-100 ms on the one knot scene,
false alarms where SAM loses the object, so cli only calls it for scenes tagged knotting)."""
import numpy as np

JUMP = 0.55       # |log area change| within ~83 ms; clip04: pops 0.69..1.02, everything else <= 0.43
HOLD_MS = 125     # the step must hold this long on both sides (no mask flicker / no lost frame): decision latency
MIN_GAP_MS = 250  # one pass per this window
MIN_CONF = 0.5
MAX_RANGE = 10.0  # scene gate: area p95 / p5 above this = the mask is not following one object (clip04 4.5, failed clip05 track 129)


def knot_passes(stats, fps, t=None, jump=JUMP):
    """Knot passes from sam2_mask channels of ONE scene.
    stats: {"area": [...], optional "confidence": [...]} per frame (None/NaN = lost); fps used when t is None.
    A pass = a step in the mask area: a change by a factor >= e^jump (1.73x) within ~83 ms (one drawing on
    twos), shrink = 'in' (the knot pops in, the visible part drops), grow = 'out'. The step must be clean:
    no lost / low-confidence frame within HOLD_MS on either side, and the area must not swing back by more
    than half the jump within HOLD_MS before or after (that is mask flicker, not a pass).
    Causal apart from the HOLD_MS look-ahead: an event at t_ms is final once the frame at t_ms + HOLD_MS is in.
    -> [{"t_ms", "kind": "in"|"out", "score"}], t_ms = halfway into the frame step, score = |log area change|."""
    a = np.asarray([np.nan if v is None else v for v in stats["area"]], float)
    t = np.arange(len(a)) * 1000.0 / fps if t is None else np.asarray(t, float)
    if len(a) < 3:
        return []
    cf = stats.get("confidence")
    if cf is not None:
        a[np.asarray([0 if c is None else c for c in cf], float) < MIN_CONF] = np.nan
    a[~(a > 0)] = np.nan
    if np.isfinite(a).sum() < 3 or np.nanpercentile(a, 95) > MAX_RANGE * np.nanpercentile(a, 5):
        return []  # ponytail: one scene-level gate fitted on 3 scenes; a per-window track-quality gate if this misfires
    dt = np.median(np.diff(t))
    k, m = max(1, round(83 / dt)), max(1, round(HOLD_MS / dt))
    la = np.log(a)
    d = np.full(len(a), np.nan)
    d[k:] = la[k:] - la[:-k]
    out = []
    for i in np.flatnonzero(np.abs(np.nan_to_num(d)) >= jump):
        lo, hi = i - k - m, i + m
        if lo < 0 or hi >= len(a) or not np.isfinite(la[lo:hi + 1]).all():
            continue
        s = np.sign(d[i])
        if ((la[i:hi + 1] - la[i]) * s).min() < -abs(d[i]) / 2 or ((la[i - k] - la[lo:i - k + 1]) * s).min() < -abs(d[i]) / 2:
            continue
        ev = {"t_ms": int(round(t[i] - (t[i] - t[i - 1]) / 2)), "kind": "in" if s < 0 else "out", "score": round(float(abs(d[i])), 3)}
        if out and ev["t_ms"] - out[-1]["t_ms"] < MIN_GAP_MS:
            if ev["kind"] == out[-1]["kind"] and ev["score"] > out[-1]["score"]:
                out[-1] = ev
            continue
        out.append(ev)
    return out
