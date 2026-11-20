"""Dataset comparison for the learned seeder (PROTOCOL v4.32, paw-855t): held-out scores of different label sets are not comparable (v1 and v2
have different labels), so every dataset's head is ALSO scored on the ACTIVE dataset's labels - "on my new labels: the v2 head found 62 %, the
v1 head 44 %". Never on a picture that head trained on: a head's record keeps the pictures it trained on (head.json `trained_on`); a picture in
both datasets is left out of that head's cross score (n_frames says how many were scored, `excluded` how many were left out). A head with no
such record (trained before v4.32) uses the labels its dataset has now. The ACTIVE dataset's own row is its grouped-k-fold held-out score
(each picture scored by a model that did not train on it), on the same parts. Only the parts EVERY compared head answers for are scored, so
one head knowing more parts is not a lead. CPU only (forward passes on cached features; the active row refits a few small heads): a few
seconds, not backgrounded. Cached in <active dataset>/cross.json by a fingerprint of the labels and every head."""
import hashlib
import json
import os

import numpy as np

from pawtrack import seeder, seedscore


def _trained(head, ds):
    t = head.info.get("trained_on")
    if t is not None:
        return set(t), "recorded"
    fr, _ = seeder.gather(ds.get("folders") or [], [], ds.get("labels"))   # old head: the labels its dataset has now
    return {f"{f['key']}_{f['t']}" for f in fr}, "its dataset's current labels"


def _row(ds, own, how, a, n, excluded, note=None):
    return {"id": ds["id"], "name": ds.get("name", ds["id"]), "own": own, "how": how, "n_frames": n, "excluded": excluded,
            **{k: a.get(k) for k in ("found", "iou", "cerr", "extra", "extra_strict", "n_strict", "silent")}, **({"note": note} if note else {})}


def compare(req, emit=lambda e: None):
    d, active = req.get("dir"), req.get("active")
    datasets = [x for x in req.get("datasets") or [] if isinstance(x, dict) and isinstance(x.get("dir"), str) and x.get("id")]
    act = next((x for x in datasets if x["id"] == active), None)
    if not d or not act:
        raise ValueError("seed_compare needs dir, active and datasets")
    folders = req.get("folders") or []
    frames, _ = seeder.gather(folders if act.get("projects") else [], [], act.get("labels"))
    heads = {x["id"]: seeder.Head.load(x["dir"]) for x in datasets}
    heads = {k: h for k, h in heads.items() if h is not None}
    fp = hashlib.sha1(seeder.fingerprint(frames).encode())
    for k in sorted(heads):
        fp.update(f"|{k}|{heads[k].info.get('fingerprint')}|{heads[k].info.get('trained_at')}|{heads[k].thr}".encode())
    fp = fp.hexdigest()
    cache = os.path.join(act["dir"], "cross.json")
    try:
        c = json.load(open(cache, encoding="utf-8"))
        if c.get("fingerprint") == fp:
            return c
    except (OSError, ValueError):
        pass
    common = None
    for h in heads.values():
        u = {p for p, on in zip(seeder.PARTS, h.use) if on}
        common = u if common is None else common & u
    out = {"active": active, "frames": len(frames), "common": sorted(common or []), "rows": [], "fingerprint": fp, "at": int(__import__("time").time() * 1000)}
    if len(heads) < 2 or not common or active not in heads or not frames:
        out["note"] = ("fewer than two trained datasets" if len(heads) < 2 else "the active dataset has no head or labels yet" if active not in heads or not frames
                       else "no part is learned by every head yet")
        return out
    only = np.array([p in common for p in seeder.PARTS])
    for ds in datasets:
        h = heads.get(ds["id"])
        if h is None:
            out["rows"].append({"id": ds["id"], "name": ds.get("name", ds["id"]), "own": ds["id"] == active, "error": "not trained yet"})
            continue
        feats = seeder.load_all(d, frames, h.features)
        have = [f for f in frames if (f["key"], f["t"]) in feats]
        if ds["id"] == active:
            s = seedscore.score(have, feats, only=common)
            out["rows"].append(_row(ds, True, "held-out", (s or {}).get("overall") or {}, len(have), 0, None if s else "too few pictures to hold out"))
            continue
        seen, how = _trained(h, ds)
        test = [{**f, "id": f"{f['key']}_{f['t']}", "src": f["key"]} for f in have if f"{f['key']}_{f['t']}" not in seen]
        use = h.use & only
        preds = {}
        for f in test:
            fe, grid = feats[(f["key"], f["t"])]
            size = (seeder.MASK_W, max(8, round(seeder.MASK_W * f["H"] / f["W"])))
            preds[f["id"]] = seeder.regions(h.heat(fe, grid), size, use, thr=h.thr)
        rows, frs = seedscore.evaluate(preds, test)
        a = seedscore._agg([r for r in rows if r["part"] in common], frs)
        miss = len(frames) - len(have)
        out["rows"].append(_row(ds, False, "never saw", a, len(test), len(have) - len(test),
                                (f"{miss} picture(s) without cached features for this head's source; " if miss else "") + (f"its training set: {how}" if how != "recorded" else "") or None))
    try:
        os.makedirs(act["dir"], exist_ok=True)
        json.dump(out, open(cache + ".tmp", "w", encoding="utf-8"), indent=1)
        os.replace(cache + ".tmp", cache)
    except OSError:
        pass
    return out
