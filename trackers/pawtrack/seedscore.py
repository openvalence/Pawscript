"""The seeder's held-out score (PROTOCOL v4.27, paw-26iv): "is it getting better" as a number the owner sees after every Train.

Grouped k-fold BY SOURCE (a still image is its own source; a video is one source, all its frames together; 5 folds,
leave-one-source-out under LOO_UNDER sources; fixed seed): for each fold a head is fitted on the other folds' frames (the same
`Head.fit`, the same usable-part rule) and the held-out frames are predicted; nothing is ever scored on a frame it trained on.
Definitions are the probe's (experiments/seeder-probe/dino_probe.py evaluate, RESULTS.md):
  found      the matched blob's interior point lies inside the painted region AND within FOUND_D of the painted centroid
             (fraction of the image diagonal); blobs and painted groups matched per part by Hungarian on IoU + found
  overlap    IoU of the matched blob with the painted mask (0 when none)
  centre     distance from the painted centroid to the NEAREST blob of that part's interior point, fraction of the diagonal
  extra      blobs per frame that match no painted group (of a painted part, or of a part nobody painted on that frame)
Only features are needed (cached by `Train`), so scoring refits heads only; `run` gives it BUDGET_S seconds and otherwise lets it
finish in a background thread (the result lands in <seed_dir>/score.json, `pending` meanwhile).
Stored: <seed_dir>/score.json = {latest, history: [the last HISTORY records: at, fingerprint, frames, sources, features,
overall]}; a record for the same fingerprint is never recomputed.
"""
import json
import math
import os
import threading
import time

import numpy as np

FOLDS, LOO_UNDER, SEED = 5, 10, 0
MARGIN = 5.0            # the paint margin (%) the proposals are scored with (the app's near-edge default)
FOUND_D = 0.10          # found: within this fraction of the image diagonal of the painted centroid (the probe's)
HISTORY = 8             # records kept in score.json
BUDGET_S = 20.0         # Train waits this long for the score, then delivers it from the background
_LOCK = threading.Lock()
_RUNNING = {}           # seed_dir -> thread


# ------------------------------------------------------------------ metrics (the probe's evaluate)
def _cen(m):
    ys, xs = np.nonzero(m)
    h, w = m.shape
    return np.array([(xs.mean() + .5) / w, (ys.mean() + .5) / h])


def _inner(m):
    import cv2
    d = cv2.distanceTransform(np.pad(m, 1).astype(np.uint8), cv2.DIST_L2, 3)[1:-1, 1:-1]
    i, j = np.unravel_index(np.argmax(d), d.shape)
    h, w = m.shape
    return np.array([(j + .5) / w, (i + .5) / h])


def evaluate(preds, frames):
    """preds {frame id: [{part, mask (bool, any size), c (x, y)}]}, frames [{id, src, W, H, groups: [{part, mask}]}] ->
    (rows per painted group {id, src, part, found, iou, cerr (None = no blob of that part)}, per frame {id, src, extra, blobs})."""
    import cv2
    from scipy.optimize import linear_sum_assignment
    rows, fr = [], []
    for f in frames:
        P = preds.get(f["id"], [])
        if f.get("ign_mask") is not None:   # paw-855t: a blob centred in an ignore region is nobody's: not matched, not an "extra"
            from pawtrack import seeder
            P = [q for q in P if not seeder.inside(f["ign_mask"], q["c"])]
        asp = f["W"] / f["H"]
        diag = math.hypot(asp, 1.0)
        gts = f["groups"]
        painted = {g["part"] for g in gts}
        extra = dups = 0
        for p in painted:
            G = [g for g in gts if g["part"] == p]
            Q = [q for q in P if q["part"] == p]
            gc = [_cen(g["mask"]) for g in G]
            M = np.zeros((len(G), len(Q)))
            Fd = np.zeros_like(M, bool)
            IoU = np.zeros_like(M)
            D = np.full_like(M, np.inf)
            for i, g in enumerate(G):
                hh, ww = g["mask"].shape
                for j, q in enumerate(Q):
                    qm = q["mask"] if q["mask"].shape == g["mask"].shape else cv2.resize(q["mask"].astype(np.uint8), (ww, hh), interpolation=cv2.INTER_NEAREST).astype(bool)
                    IoU[i, j] = (qm & g["mask"]).sum() / max((qm | g["mask"]).sum(), 1)
                    qc = _inner(qm) if qm.any() else np.array(q["c"])
                    inside = g["mask"][min(hh - 1, int(qc[1] * hh)), min(ww - 1, int(qc[0] * ww))]
                    D[i, j] = math.hypot((qc[0] - gc[i][0]) * asp, qc[1] - gc[i][1]) / diag
                    Fd[i, j] = inside and D[i, j] <= FOUND_D
                    M[i, j] = IoU[i, j] + Fd[i, j]
            ri, ci = linear_sum_assignment(-M) if len(Q) else ([], [])
            mt = dict(zip(ri, ci))
            for i, g in enumerate(G):
                j = mt.get(i)
                rows.append({"id": f["id"], "src": f["src"], "part": p, "found": bool(j is not None and Fd[i, j]),
                             "iou": float(IoU[i, j]) if j is not None else 0.0, "cerr": float(D[i].min()) if len(Q) else None})
            extra += len(Q) - len(mt)
            dups += len(Q) - len(mt)   # v4.34: more blobs of a painted part than painted groups of it: duplicates
        extra += sum(1 for q in P if q["part"] not in painted)
        # strict: every unpainted patch of this picture is a reliable negative (fully labelled / "nothing here"): only there is an extra a false positive
        fr.append({"id": f["id"], "src": f["src"], "extra": extra, "dups": dups, "blobs": len(P), "strict": bool(f.get("complete")) or not gts})
    return rows, fr


def folds(srcs, nfold=FOLDS, seed=SEED):
    """{source: n frames} -> {source: fold}: leave-one-source-out under LOO_UNDER sources, else frames balanced greedily over
    nfold folds with the sources shuffled by `seed` first (a source's frames stay together)."""
    if len(srcs) < LOO_UNDER:
        return {s: i for i, s in enumerate(sorted(srcs))}
    rng = np.random.default_rng(seed)
    order = [str(s) for s in rng.permutation(sorted(srcs))]
    order.sort(key=lambda s: -srcs[s])   # stable: ties keep the shuffled order
    load, fold = [0] * nfold, {}
    for s in order:
        k = int(np.argmin(load))
        fold[s] = k
        load[k] += srcs[s]
    return fold


def _agg(rows, frs):
    cerr = [r["cerr"] for r in rows if r["cerr"] is not None]
    out = {"n": len(rows), "found": float(np.mean([r["found"] for r in rows])) if rows else None,
           "iou": float(np.mean([r["iou"] for r in rows])) if rows else None,
           "cerr": float(np.mean(cerr)) if cerr else None}
    if frs is not None:
        out["extra"] = float(np.mean([x["extra"] for x in frs])) if frs else None   # every picture (partial labels: blobs on unpainted parts count; for reference)
        out["proposals"] = float(np.mean([x["blobs"] for x in frs])) if frs else None   # v4.34: blobs a picture gets
        nb = sum(x["blobs"] for x in frs)
        out["dup_share"] = sum(x["dups"] for x in frs) / nb if nb else None             # ... and the share that are a second blob of a part the owner painted once
        st = [x["extra"] for x in frs if x.get("strict")]
        out["extra_strict"] = float(np.mean(st)) if st else None                      # fully labelled + "nothing here" pictures only: the honest false-positive rate
        out["n_strict"] = len(st)
    # silent: painted parts for which the head produced no blob of that part at all (it found nothing: the failure weak negatives could cause)
    out["silent"] = float(np.mean([r["cerr"] is None for r in rows])) if rows else None
    return out


# ------------------------------------------------------------------ the score
def head_only(f, heat, size, use, thr=None):
    """The default predictor: the head's own blobs (seeder.regions) at threshold `thr` (default seeder.THR)."""
    from pawtrack import seeder
    return seeder.proposals(heat, size, use, thr=seeder.THR if thr is None else thr, margin=MARGIN)


THRS = [round(0.2 + 0.05 * i, 2) for i in range(11)]   # candidate thresholds 0.20 .. 0.70
MIN_STRICT = 5      # fully labelled / "nothing here" pictures needed to calibrate the threshold; fewer: seeder.THR stays
EXTRA_COST = 0.1    # one false positive per fully labelled picture costs this much found


def calibrate(held, predict, scored):
    """The blob threshold with the best found-vs-false-positive trade-off (found - EXTRA_COST x extras per picture on the strict pictures).
    Unknown (unpainted) negatives are weak in training, so the head's heat is lower than a 0.5 threshold assumed: the honest false positives
    are only counted where unpainted really means nothing. held: [(frame, heat, size, use)]. -> (thr, {value, calibrated, n_strict, why?})"""
    from pawtrack import seeder
    strict = sum(1 for f, *_ in held if f.get("complete") or not f["groups"])
    if strict < MIN_STRICT:
        return seeder.THR, {"value": seeder.THR, "calibrated": False, "n_strict": strict, "why": f"needs {MIN_STRICT} fully labelled / nothing-here pictures (has {strict})"}
    best = None
    for thr in sorted(THRS, key=lambda t: abs(t - seeder.THR)):   # ties keep the one nearest the default
        rows, frs = evaluate({f["id"]: predict(f, h, sz, u, thr) for f, h, sz, u in held}, [f for f, *_ in held])
        a = _agg([r for r in rows if r["part"] in scored], frs)
        v = (a["found"] or 0) - EXTRA_COST * (a["extra_strict"] or 0)
        if best is None or v > best[0] + 1e-9:
            best = (v, thr)
    return best[1], {"value": best[1], "calibrated": True, "n_strict": strict}


def score(frames, feats, predict=head_only, seed=SEED, deadline=None, only=None):
    """frames: seeder.gather's frames that have features; feats {(key, t): (f (S, D), grid)}.
    predict(frame, heat, (w, h), use) -> [{part, mask, score, c}] for one held-out frame (default: the head's blobs; commit 3's
    head + SAM passes its own). -> {frames, sources, folds, overall {n, found, iou, cerr, extra}, parts {part: {n, sources,
    found, iou, cerr, too_few}}, ms}. None when fewer than 2 sources (nothing to hold out) or when `deadline` (monotonic) passes."""
    from pawtrack import seeder
    t0 = time.perf_counter()
    F = [{**f, "id": f"{f['key']}_{f['t']}", "src": f["key"]} for f in frames if (f["key"], f["t"]) in feats]
    srcs = {}
    for f in F:
        srcs[f["src"]] = srcs.get(f["src"], 0) + 1
    if len(srcs) < 2:
        return None
    fold = folds(srcs)
    use_all = seeder.usable(F)
    scored = [p for p in seeder.PARTS if use_all[p]["use"] and (only is None or p in only)]   # only: the parts a comparison with other heads is about
    held = []
    for k in sorted(set(fold.values())):
        tr = [f for f in F if fold[f["src"]] != k]
        te = [f for f in F if fold[f["src"]] == k]
        if not te or not tr:
            continue
        if deadline is not None and time.monotonic() > deadline:
            return None
        usable = seeder.usable(tr)
        head = seeder.Head.fit([feats[(f["key"], f["t"])][0] for f in tr], [seeder.targets(f["groups"], feats[(f["key"], f["t"])][1], f.get("ign_mask")) for f in tr], seed=seed,
                               Ws=[seeder.weights(f["groups"], feats[(f["key"], f["t"])][1], f.get("ign_mask"), seeder.strong_frame(f)) for f in tr])
        use = np.array([usable[p]["use"] and head.present[i] and (only is None or p in only) for i, p in enumerate(seeder.PARTS)])
        for f in te:
            fe, grid = feats[(f["key"], f["t"])]
            held.append((f, head.heat(fe, grid), (seeder.MASK_W, max(8, round(seeder.MASK_W * f["H"] / f["W"]))), use))
    thr, cal = calibrate(held, predict, scored)
    rows, frs = evaluate({f["id"]: predict(f, h, sz, u, thr) for f, h, sz, u in held}, [f for f, *_ in held])
    own = [r for r in rows if r["part"] in scored]
    return {"frames": len(F), "sources": len(srcs), "folds": len(set(fold.values())), "seed": seed,
            "overall": _agg(own, frs), "threshold": cal,
            "parts": {p: {"n": use_all[p]["labels"], "sources": use_all[p]["videos"], "too_few": not use_all[p]["use"],
                          **({} if not use_all[p]["use"] else {k: v for k, v in _agg([r for r in own if r["part"] == p], None).items() if k != "n"})}
                      for p in seeder.PARTS if use_all[p]["labels"]},
            "ms": round(1000 * (time.perf_counter() - t0))}


# ------------------------------------------------------------------ the stored trend
def _file(seed_dir):
    return os.path.join(seed_dir, "score.json")


def read(seed_dir):
    """-> {latest, history} or {latest: None, history: []}."""
    try:
        d = json.load(open(_file(seed_dir), encoding="utf-8"))
        return {"latest": d.get("latest"), "history": list(d.get("history") or [])}
    except (OSError, ValueError):
        return {"latest": None, "history": []}


def store(seed_dir, rec):
    """Append rec (an unchanged-fingerprint record replaces the last one) and keep HISTORY of them; rec gains `previous`
    (the headline numbers of the record before it). -> the stored record."""
    with _LOCK:
        d = read(seed_dir)
        hist = [h for h in d["history"] if h.get("fingerprint") != rec["fingerprint"]]
        prev = hist[-1] if hist else None
        rec = {**rec, **({"previous": {**{k: prev["overall"].get(k) for k in ("found", "iou", "cerr", "extra", "extra_strict", "silent", "proposals", "dup_share")}, "at": prev["at"], "frames": prev["frames"], "sources": prev["sources"],
                                       "features": prev.get("features")}} if prev else {})}
        hist = (hist + [rec])[-HISTORY:]
        os.makedirs(seed_dir, exist_ok=True)
        fn = _file(seed_dir)
        with open(fn + ".tmp", "w", encoding="utf-8") as fh:
            json.dump({"latest": rec, "history": hist}, fh, indent=1)
        os.replace(fn + ".tmp", fn)
        return rec


def cached(seed_dir, fingerprint):
    """The stored record of exactly this label set (and feature source), else None."""
    d = read(seed_dir)
    return d["latest"] if d["latest"] and d["latest"].get("fingerprint") == fingerprint else None


def run(seed_dir, frames, feats, fingerprint, features=None, predict=head_only, budget=BUDGET_S, at=None):
    """The score of this label set for Train: the cached record, else computed (<= `budget` s waited for; then
    {"pending": True, fingerprint} and the thread stores the result when it ends). None when there is nothing to hold out."""
    c = cached(seed_dir, fingerprint)
    if c is not None:
        return c
    if seed_dir in _RUNNING and _RUNNING[seed_dir].is_alive():
        return {"pending": True, "fingerprint": fingerprint}
    out = {}

    def job():
        try:
            s = score(frames, feats, predict)
            if s is not None:
                out["rec"] = store(seed_dir, {**s, "at": at or int(time.time() * 1000), "fingerprint": fingerprint, "features": features})
        except Exception as e:  # a failed score never fails a Train
            out["error"] = f"{type(e).__name__}: {e}"

    th = threading.Thread(target=job, daemon=True, name="seed-score")
    _RUNNING[seed_dir] = th
    th.start()
    th.join(budget)
    if th.is_alive():
        return {"pending": True, "fingerprint": fingerprint}
    return out.get("rec") or ({"error": out["error"], "fingerprint": fingerprint} if "error" in out else None)
