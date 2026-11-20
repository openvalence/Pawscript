"""pawtrack: one JSON request on stdin -> JSON Lines events on stdout. See PROTOCOL.md.
`pawtrack serve` is the long-lived variant (one request per line, models kept loaded): pawtrack/serve.py.
"""
import json
from itertools import chain
import os
import sys
import time
import traceback

import numpy as np

from pawtrack import director, frames, motion, progress
from pawtrack.progress import Progress
from pawtrack.loops import FOLD_PARAMS, LOOP_PARAMS, THUMB_W, detect_period, fold, held_frames, retime, thumb
from pawtrack.pipeline import (PIPE_PARAMS, cadence_fill, cadence_turns, cam_detrend, energy_sign, finish_range,
                               normalize, project_auto, to_points)
from pawtrack.registry import coerce, load
from pawtrack.levels import LEVEL_PARAMS, apply_levels, levelled, scene_levels
from pawtrack.scenes import SCAN_WIDTH, SCENE_PARAMS, CutDetector
from pawtrack.camera import CameraDetector, split_scenes
from pawtrack.knot import knot_passes
from pawtrack import shaft


def _knot_tagged(tags):
    """Any knot-related e621 tag (describe.KNOT: knot, knotted_penis, knotting, anal_knotting ...), without importing the tagger."""
    return any(t == "knot" or "knot" in t for t in tags)
from pawtrack.trackers import NOTES
from pawtrack.score import aggregate, public, score
from pawtrack.video import open_frames, probe


def _describe_module():
    """pawtrack/describe.py is written separately: describe(video, start_ms, end_ms, params,
    emit_progress(done, total)) -> dict of result fields, and PARAMS (param schema)."""
    try:
        from pawtrack import describe
    except ImportError as e:
        raise RuntimeError(f"describe is not available: {e}") from e
    return describe


def cmd_list(req, emit):
    try:
        describe_params = _describe_module().PARAMS
    except Exception:  # a missing or broken describe must not break list
        traceback.print_exc()
        describe_params = None
    from pawtrack import gpu
    from pawtrack.serve import GPU_TRACKERS
    return {"trackers": [{"id": t.id, "name": t.name, "roi": t.roi, "channels": t.channels, "gpu": t.id in GPU_TRACKERS,  # v4.56
                          "params": t.params + PIPE_PARAMS + SCENE_PARAMS + FOLD_PARAMS + LEVEL_PARAMS}
                         for t in load().values()],
            "scene_params": SCENE_PARAMS, "loop_params": LOOP_PARAMS, "describe_params": describe_params,
            "gpu": gpu.state(probe=False)}  # v4.56 (paw-k97q); paw-1dt4: a listed card is probed at its first use


def cmd_probe(req, emit):
    return {"media": probe(req["video"])}


def cmd_scenes(req, emit):
    p = coerce(SCENE_PARAMS, req.get("params"))
    media = probe(req["video"])
    scenes, cam = _scan(req["video"], 0, None, p, Progress(emit), media["duration_ms"])
    if p["cut_camera"]:  # PROTOCOL v4.4: a camera move inside a shot splits it; the pieces continue one action
        return {"scenes": split_scenes(scenes, cam, p["cut_min_scene_ms"]), "media": media}
    return {"scenes": [{**s, "camera": cam.segments(s["start_ms"], s["end_ms"])} for s in scenes], "media": media}


def _scan(video, start_ms, end_ms, p, prog, range_end_ms, stage=None, mask=None):
    """One 160 px pass: the CutDetector (hard cuts, blanks / fades, dissolves, flashes, stills: pawtrack/scenes.py) and
    the camera. mask: optional ignore grid (scenes.keep_pixels; True = ignore), for both. -> (scenes [{start_ms, end_ms,
    kind, transition}] over [start_ms, range_end_ms], camera)."""
    total, frames = open_frames(video, start_ms, end_ms, width=SCAN_WIDTH)
    cut = CutDetector(p, mask)
    det, cam = _with_camera(cut, mask)
    prog(0, total, stage=stage)
    n = 0
    for t, img in frames:
        det(t, img)
        n += 1
        prog(n)
    if n == 0:
        raise ValueError("no decodable video frames")
    prog(n, n, force=True)
    return cut.finish(start_ms, range_end_ms), cam


def _with_camera(det, mask=None):
    """A cut detector (t, img) -> bool that also feeds a CameraDetector (pawtrack/camera.py; mask: its optional ignore
    grid), reset at each cut. -> (detector, camera)."""
    cam = CameraDetector(mask)

    def both(t, img):
        cut = det(t, img)
        if cut:
            cam.cut()
        cam(t, img)
        return cut
    return both, cam


def cmd_loop(req, emit):
    p = coerce(LOOP_PARAMS, req.get("params"))
    total, frames = open_frames(req["video"], int(req["start_ms"]), int(req["end_ms"]), width=THUMB_W)
    ts, thumbs, prog = [], [], Progress(emit, total)
    for t, img in frames:
        ts.append(t)
        thumbs.append(thumb(img))
        prog(len(ts))
    emit({"type": "progress", "done": len(ts), "total": len(ts)})
    per, held = detect_period(thumbs), held_frames(thumbs)
    m = per["period_frames"]
    n = m if per["confidence"] >= p["loop_min_confidence"] else None
    ms = lambda k: round(k * (ts[-1] - ts[0]) / (len(ts) - 1), 3) if k else None
    return {"period_ms": ms(n), "period_frames": n, "confidence": per["confidence"], "cycles": per["cycles"] if n else 0,
            "kind": per["kind"], "prominence": per["prominence"], "motion_period_frames": m,
            "motion_period_ms": ms(m), "held": {"step": held["step"], "ratio": held["ratio"]},
            "media": probe(req["video"])}


def cmd_describe(req, emit):
    """One range (start_ms, end_ms), or v4.2 `ranges`: [[start_ms, end_ms], ...] in one process and one model load.
    With ranges: progress carries `range` (index) and `ranges` (count), done/total count frames over all ranges; each
    range's result (or {"error"}) is sent as a `described` event as soon as it is done, and again in `results`."""
    d = _describe_module()
    p = coerce(d.PARAMS, req.get("params"))
    grid = req.get("grid")
    if grid is not None:  # v4.49: frames on a time grid (or exact `times`), per-sample scores; see PROTOCOL describe
        d.check_grid(grid)
        try:
            import torch
            if not torch.cuda.is_available():
                raise RuntimeError("describe needs a CUDA GPU (no CPU fallback)")
            if d._MODEL is None:
                emit({"type": "progress", "done": 0, "total": 0, "stage": "model load"})
                d.load()
            return _json_safe({**d.describe_grid(req["video"], grid, p, emit), "media": probe(req["video"])})
        except ImportError as e:
            raise RuntimeError(f"describe dependencies are not installed: {e}") from e
    ranges = req.get("ranges")
    if ranges is not None and not (isinstance(ranges, list) and ranges
                                   and all(isinstance(r, list) and len(r) == 2 and r[1] > r[0] for r in ranges)):
        raise ValueError("ranges: a non-empty list of [start_ms, end_ms] with end_ms > start_ms")
    try:
        import torch
        if not torch.cuda.is_available():
            raise RuntimeError("describe needs a CUDA GPU (no CPU fallback)")
        spans = [(int(a), int(b)) for a, b in ranges] if ranges else [(int(req["start_ms"]), int(req["end_ms"]))]
        n, f = len(spans), p["frames"]
        if d._MODEL is None:
            emit({"type": "progress", "done": 0, "total": n * f, "stage": "model load"})
            d.load()
        if ranges is None:
            res = d.describe(req["video"], *spans[0], p,
                             lambda done, total: emit({"type": "progress", "done": int(done), "total": int(total)}))
            return {**res, "media": probe(req["video"])}
        results = []
        for i, (a, b) in enumerate(spans):
            ev = lambda done, total, i=i: emit({"type": "progress", "done": i * f + int(done), "total": n * f,
                                                "stage": "describe", "range": i, "ranges": n})
            try:
                r = d.describe(req["video"], a, b, p, ev)
            except Exception as e:  # one bad range (no decodable frames) must not lose the others
                traceback.print_exc()
                r = {"error": f"{type(e).__name__}: {e}"}
            emit({"type": "described", "range": i, **_json_safe(r)})
            results.append(r)
    except ImportError as e:  # its heavy deps are imported lazily inside describe()
        raise RuntimeError(f"describe dependencies are not installed: {e}") from e
    return {"results": _json_safe(results), "media": probe(req["video"])}


def cmd_tag_image(req, emit):
    """v4.40: the Hydra tagger on ONE still image (`image`: a file path): {scores: {tag: p}} of the count tags (solo / duo / trio / group)
    and the best gender pairings, raw probabilities (the labelling workspace's "duos first"). CUDA only; the describe child runs it."""
    img = req.get("image")
    if not isinstance(img, str) or not img:
        raise ValueError("tag_image needs image (a file path)")
    try:
        import torch
        if not torch.cuda.is_available():
            raise RuntimeError("tag_image needs a CUDA GPU (no CPU fallback)")
        return _describe_module().tag_image(img, int(req.get("seqlen") or 512))
    except ImportError as e:
        raise RuntimeError(f"tag_image dependencies are not installed: {e}") from e


def cmd_cum(req, emit):
    """Cumshot proposals over [start_ms, end_ms] (pawtrack/cum.py; the describe tagger, so CUDA only). Optional `pulses`:
    contraction peak times (ms) from the caller (e.g. a points run's sem_balls_scale peaks) that boost aligned onsets.
    v4.16, optional: `groups` (the scene's painted groups; the pulse ones are tracked, pawtrack/pulse.py) and
    `pulse_range` [a, b] (ms; where to track them: the orgasm span)."""
    from pawtrack import cum
    a, b = int(req["start_ms"]), int(req["end_ms"])
    if b <= a:
        raise ValueError("end_ms must be > start_ms")
    pulses = req.get("pulses")
    if pulses is not None and not (isinstance(pulses, list) and all(isinstance(x, (int, float)) for x in pulses)):
        raise ValueError("pulses: a list of times in ms")
    groups, pr = req.get("groups"), req.get("pulse_range")
    if groups is not None and not (isinstance(groups, list) and all(isinstance(g, dict) for g in groups)):
        raise ValueError("groups: a list of {name, poly, t_ms, ...}")
    if pr is not None and not (isinstance(pr, list) and len(pr) == 2 and all(isinstance(x, (int, float)) for x in pr)):
        raise ValueError("pulse_range: [start_ms, end_ms]")
    d = _describe_module()
    try:
        import torch
        if not torch.cuda.is_available():
            raise RuntimeError("cum needs a CUDA GPU (the describe tagger; no CPU fallback)")
        if d._MODEL is None:
            emit({"type": "progress", "done": 0, "total": 1, "stage": "model load"})
            d.load()
        res = cum.detect(req["video"], a, b, req.get("params"),
                         lambda done, total, stage="cum": emit({"type": "progress", "done": int(done), "total": int(total), "stage": stage}),
                         pulses, groups, pr)
    except ImportError as e:
        raise RuntimeError(f"describe dependencies are not installed: {e}") from e
    return _json_safe({**res, "media": probe(req["video"])})


def _json_safe(x):
    """NaN/inf -> null, numpy scalars -> python, recursively (json.dumps would emit bare NaN)."""
    if isinstance(x, dict):
        return {k: _json_safe(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_json_safe(v) for v in x]
    if isinstance(x, (float, np.floating)):
        return float(x) if np.isfinite(x) else None
    return x.item() if isinstance(x, np.generic) else x


def dumps(obj):
    """One JSONL line of obj, as json.dumps(_json_safe(obj)) gives it. Plain JSON (no NaN / inf, no numpy scalar other
    than float64, which json writes as float) skips the walk: a points frame is ~75 KB of lists and the walk was ~2/3 of
    the time spent sending a TAPNext scene's frames (paw-iyl3)."""
    try:
        return json.dumps(obj, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError):
        return json.dumps(_json_safe(obj), separators=(",", ":"))


def cmd_score(req, emit):
    """Candidate script vs reference script (pawtrack/score.py). No video decode."""
    acts = lambda k: sorted(({"at": int(a["at"]), "pos": float(a["pos"])} for a in req[k]), key=lambda a: a["at"])
    cand, ref = acts("candidate"), acts("reference")
    t0, t1, fps = int(req["start_ms"]), int(req["end_ms"]), float(req.get("fps") or 30.0)
    if t1 <= t0:
        raise ValueError("end_ms must be > start_ms")
    spans = [(int(s["start_ms"]), int(s["end_ms"])) for s in req.get("scenes") or []] or [(t0, t1)]
    rows = []
    for a, b in spans:
        s = score(cand, ref, max(a, t0), min(b, t1), fps)
        if s:
            rows.append(s)
    out = {"overall": public(aggregate(rows)) if req.get("scenes") else public(rows[0]) if rows else {}}
    if req.get("scenes"):
        out["scenes"] = [public(s) for s in rows]
    return _json_safe(out)


def _scalar(vals):
    """Tracker values (floats or (dx, dy) tuples, no None) -> 0..1 over this scene."""
    return normalize(project_auto(vals) if isinstance(vals[0], tuple) else vals)


def _unpack(val, p):
    """Plug-in value -> (primary value, channels dict | None, confidence | None).
    Forms: float | (dx, dy) | None, or {"channels": {...}, "confidence": c, "value": optional}
    (without "value", the channel named by the "primary" param is the primary signal)."""
    if not isinstance(val, dict):
        return val, None, None
    ch = val.get("channels") or {}
    return (val["value"] if "value" in val else ch.get(p["primary"])), ch, val.get("confidence")


def _r(v, nd=4):
    return None if v is None or not np.isfinite(v) else round(float(v), nd)


def _fixed_cuts(cuts):
    """v3.1 `cuts` in place of the CutDetector: a frame starts a scene iff it is the first frame >= a cut.
    The first call (the range's first frame) swallows every cut at or before it."""
    pending = sorted(float(c) for c in cuts)

    def det(t, img):
        hit = bool(pending) and t >= pending[0]
        while pending and t >= pending[0]:
            pending.pop(0)
        return hit
    return det


def parse_cuts(cuts):
    """v4.9 `cuts`: numbers (hard) or {"t_ms", "kind": "hard" | "soft", "why"?} -> (hard [ms], soft [ms] sorted)."""
    hard, soft = [], []
    for c in cuts:
        if isinstance(c, (int, float)) and not isinstance(c, bool):
            hard.append(float(c))
            continue
        t = c.get("t_ms") if isinstance(c, dict) else None
        if not isinstance(t, (int, float)) or isinstance(t, bool) or c.get("kind", "hard") not in ("hard", "soft"):
            raise ValueError(f'cuts: a number or {{"t_ms": ms, "kind": "hard" | "soft"}}, got {c!r}')
        (soft if c.get("kind") == "soft" else hard).append(float(t))
    return hard, sorted(soft)


SEM_IDS = {"penis": 1, "balls": 2, "hips": 3}  # points.SEM: old clients' pts 6th element stays these


def parse_groups(groups):
    """v4.11 `track.groups`: [{name, poly: [[x, y], ...] (0..1, >= 3 vertices), pinned?: bool, t_ms?: ms}] -> the same
    validated: name lower-cased to [a-z0-9] ("other" if nothing is left; a repeat gets 2, 3, ...), pinned default true
    (false = a `body` seed hull), t_ms float | None, poly a list of [x, y] clipped to 0..1, and id: the pts 6th element
    of a pinned group (penis / balls / hips 1 / 2 / 3, any other name 4, 5, ... in request order; None unpinned).
    v4.12: optional who ("c1" = Bottom | "c2" = Top | v4.30 "x" = Extra), part (a name as above) and side ("l" | "r"): with a who or a part the name is
    derived, who_part_side ("c1_penis", "c2_hand_l"; underscores kept), and who / part / side come back (None when
    absent); without them the v4.11 rules apply unchanged.
    v4.21: optional points ([[x, y], ...], >= 1, 0..1 frame, clipped) on a pinned group: Track seeds exactly these points
    for it on its frame instead of laying them inside the polygon (points.box_seeds `fixed`)."""
    import re
    from pawtrack.partlabel import WHOS
    if not isinstance(groups, list):
        raise ValueError("groups: a list")
    out, seen, nxt = [], set(), 4
    for g in groups:
        poly = g.get("poly") if isinstance(g, dict) else None
        if not (isinstance(poly, list) and len(poly) >= 3 and all(
                isinstance(q, (list, tuple)) and len(q) == 2 and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in q)
                for q in poly)):
            raise ValueError(f'groups: {{"name", "poly": [[x, y], ...] (>= 3 vertices)}}, got {g!r}'[:300])
        t = g.get("t_ms")
        if t is not None and (not isinstance(t, (int, float)) or isinstance(t, bool)):
            raise ValueError("groups: t_ms must be a number")
        clean = lambda v: re.sub(r"[^a-z0-9]", "", str(v or "").lower())
        who, part, side = g.get("who"), g.get("part"), g.get("side")
        if who is not None and who not in WHOS or side not in (None, "l", "r"):
            raise ValueError(f'groups: who "c1" | "c2" | "x", side "l" | "r", got {who!r} / {side!r}')
        if who or part:
            part = clean(part) or clean(g.get("name")) or "other"
            base = "_".join(x for x in (who, part, side) if x)
        else:
            base = clean(g.get("name")) or "other"
        name, k = base, 2
        while name in seen:
            name, k = f"{base}{k}", k + 1
        seen.add(name)
        pts = g.get("points")
        if pts is not None and not (isinstance(pts, list) and pts and all(
                isinstance(q, (list, tuple)) and len(q) == 2 and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in q)
                for q in pts)):
            raise ValueError(f'groups: points must be [[x, y], ...] (>= 1), got {pts!r}'[:300])
        pinned = bool(g.get("pinned", True))
        gid = None
        if pinned:
            gid = SEM_IDS.get(name)
            if gid is None:
                gid, nxt = nxt, nxt + 1
        out.append({"name": name, "poly": [[min(1.0, max(0.0, float(x))), min(1.0, max(0.0, float(y)))] for x, y in poly],
                    "pinned": pinned, "t_ms": None if t is None else float(t), "id": gid,
                    "who": who, "part": part or None, "side": side,
                    **({"shaft": True} if g.get("shaft") is True else {}),  # v4.17: shaft consumption pass
                    **({"depth": True} if g.get("depth") is True and pinned else {}),  # v4.52: the same pass on any part (opt-in)
                    **({"points": [[min(1.0, max(0.0, float(x))), min(1.0, max(0.0, float(y)))] for x, y in pts]}
                       if pts and pinned else {}),  # v4.21: seed exactly these
                    **({"fixes": _fixes(g.get("fixes"))} if g.get("fixes") and pinned else {}),  # v4.39: sam2_mask corrections
                    **({"erased": er} if (er := _erased(g.get("erased"))) else {}),  # v4.53: what the owner erased on its frame
                    **({"knot": kn} if pinned and (kn := _erased(g.get("knot"))) else {})})  # v4.54: the group's knot section (outlines)
    return out


def _erased(polys):
    """v4.53 (paw-yx6q) a group's `erased` [[[x, y], ...] (>= 3), ...]: what the owner erased from it on its frame (0..1);
    v4.54 (paw-njnf) the same shape for a group's `knot` section. Malformed outlines are skipped, never an error (an old
    client never sends them; a bad one costs only the cut / the section)."""
    ok = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool)
    return [[[min(1.0, max(0.0, float(x))), min(1.0, max(0.0, float(y)))] for x, y in q] for q in polys or ()
            if isinstance(q, list) and len(q) >= 3 and all(isinstance(v, (list, tuple)) and len(v) == 2 and all(ok(c) for c in v) for v in q)] \
        if isinstance(polys, list) else []


def _fixes(fixes):
    """v4.39 a group's `fixes` [{t_ms, poly}] (the owner's mask corrections on later frames; sam2_mask prompts them)."""
    ok = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool)
    if not isinstance(fixes, list) or not all(isinstance(f, dict) and ok(f.get("t_ms")) and isinstance(f.get("poly"), list) and len(f["poly"]) >= 3
                                              and all(isinstance(q, (list, tuple)) and len(q) == 2 and all(ok(v) for v in q) for q in f["poly"]) for f in fixes):
        raise ValueError(f'groups: fixes must be [{{"t_ms", "poly": [[x, y], ...] (>= 3)}}], got {fixes!r}'[:300])
    return [{"t_ms": float(f["t_ms"]), "poly": [[min(1.0, max(0.0, float(x))), min(1.0, max(0.0, float(y)))] for x, y in f["poly"]]} for f in fixes]


def mask_inside(rows, fps):
    """v4.39: a sam2_mask run on a painted shaft + the region it goes into: per scene, the shaft's raw measure
    (sem_<name>_mL ..., sam2_mask.MASK_RAW) -> sem_<name>_in / _in_conf / _len in the rows (shaft.mask_scene), the record
    for scenes[].shaft. -> {records, sign_from: None} | None (no such shaft)."""
    names = sorted({c[4:-3] for r in rows for c in (r[2] or ()) if c.startswith("sem_") and c.endswith("_mL")})
    recs = {}
    for nm in names:
        col = lambda k: np.array([np.nan if not r[2] or r[2].get(f"sem_{nm}_{k}") is None else r[2][f"sem_{nm}_{k}"] for r in rows], float)
        res = shaft.mask_scene({k: col(k) for k in ("mL", "w", "holes", "gap", "edge", "dp", "mconf")}, fps)
        if res is None:
            recs[nm] = {"source": "none", "from": "mask", "note": "the shaft or the region was never measured together"}
            continue
        ch, recs[nm] = res
        for k, x in ch.items():
            for row, val in zip(rows, x):
                if row[2] is not None:
                    row[2][f"sem_{nm}_{k}"] = None if not np.isfinite(val) else float(val)
    return {"records": recs, "sign_from": None} if recs else None


SUGGEST_PARAMS = None


def cmd_suggest_groups(req, emit):
    """v4.11: the groups the points trackers would pin on a frame, as polygons (partlabel.suggest). t_ms = that frame (the
    one at or before it); without t_ms, start_ms / end_ms = a scene and params.seed_frame picks its frame as the tracker
    would (first, or auto: the thumbnail medoid). roi (optional box): only regions peaking inside it.
    v4.13: prior (optional, [{name, who?, part?, side?, poly?}]: the previous shot's groups after a hard cut inside one
    scene): the suggestions that re-find a prior identity take it, flagged unconfirmed (partlabel.match_prior); the
    result's `missing` lists the prior names not found.
    v4.18: seed {dir, key} (optional): the learned part head under dir (pawtrack/seeder.py, trained by `seed_train`)
    answers for the parts it has enough painted examples of, and key (the video's media hash) names the characters
    from that video's painted Bottom / Top; candidates (optional, [ms]: frames near the start of the shot): every one is
    scored (parts shown confidently, partlabel.frame_parts) and the best is suggested on (ties: the first listed),
    frame "best" with `candidates` [{t_ms, parts}]. param who_split: appearance (default) | position (v4.17).
    v4.19: param who_left: head (default: Bottom = the character whose head is further left, else its parts') | parts (v4.18).
    v4.20: candidate_bonus (optional, [float] parallel to candidates): added to a candidate's parts when picking the best
    (pick_candidate); result candidates carry `bonus`.
    v4.29: param head_shape (sam | head): the learned parts' and the CAM parts' outlines are drawn by SAM from the head's peak (groups carry
    `mask_from` sam | head | cam; result `sam` = the step's counts and ms); see PROTOCOL.
    v4.26: image (optional, a file path) in place of video: the still is the one frame (t_ms 0, frame "image", no candidates);
    everything else answers as on a video frame (learned head where it has enough examples, the tagger's CAMs for the rest)."""
    global SUGGEST_PARAMS
    import time
    from pawtrack import partlabel
    from pawtrack.frames import grab
    from pawtrack.registry import coerce, param
    from pawtrack.points import AUTO_RULE, roi_region, seed_candidates
    SUGGEST_PARAMS = SUGGEST_PARAMS or [
        param("seed_frame", "Seed frame", "choice", "first", choices=["first", "auto"]),
        param("sem_shape", "Outline", "choice", partlabel.SHAPE, choices=["cam", "grabcut", "sam"]),
        param("head_shape", "Seeded parts drawn by", "choice", partlabel.HEAD_SHAPE, choices=["sam", "head"],
              hint="sam: the learned head (or the tagger's heat) locates a part and SAM 2 draws it, from the head's peak (v4.29); head: the head's own coarse blob"),
        param("paint_margin", "Paint margin (%)", "float", 15.0, 0.0, 100.0,
              hint="v4.33: SAM-drawn parts are pulled this far inside their edge, the app's own paint margin (a share of the part's size; 0 = at the edge)"),
        param("who_split", "Bottom / Top split", "choice", "bodies", choices=["bodies", "appearance", "position"],
              hint="bodies (v4.36): the distinct heads are the characters, every part goes to a body with one of each part per character, a second head never becomes 'head 2'; appearance: v4.18's split"),
        param("who_left", "Bottom = the left one, by", "choice", "head", choices=["head", "parts"],
              hint="Without painted scenes of the video to name the characters from, Bottom is the character further left: by its head (default; in contact both hips sit at one place) or by the mean of all its parts (v4.18)")]
    p = coerce(SUGGEST_PARAMS, req.get("params"))
    video, roi, t, image = req.get("video"), req.get("roi"), req.get("t_ms"), req.get("image")
    if image is not None and not isinstance(image, str):
        raise ValueError("image is a file path")
    media = None if image else probe(req["video"])
    if image:
        t, how = 0, "image"
    elif t is None:
        a, b = int(req["start_ms"]), int(req["end_ms"])
        if b <= a:
            raise ValueError("end_ms must be > start_ms")
        t, how = a, "first"
        if p["seed_frame"] == "auto":
            _, fr = open_frames(video, a, b, width=THUMB_W)
            ts, th = [], []
            for tt, img in fr:
                ts.append(tt)
                th.append(thumb(img))
            if len(ts) >= 2:
                t, how = ts[seed_candidates(ts, th, roi)[AUTO_RULE]], "auto"
            elif ts:
                t = ts[0]
    else:
        how = "given"
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError("suggest_groups needs a CUDA GPU (the describe tagger; no CPU fallback)")
    if not partlabel.hydra_ready():
        raise RuntimeError("suggest_groups needs the describe extra's tagger weights")
    from pawtrack import seeder
    seed = req.get("seed") or {}
    head = seeder.Head.load(seed.get("dataset") or seed.get("dir")) if seed.get("dir") else None   # v4.32: the active dataset's head
    prefer = seed.get("features") if seed.get("features") in ("auto", "hydra") else "auto"
    asked, why = head, None
    head, why = seeder.usable_head(head, prefer)   # v4.28: a head is used only with the feature source it was trained on
    width = 1920 if image or (media["width"] or 0) > 1920 else None
    t0 = time.perf_counter()
    if _describe_module()._MODEL is None:
        emit({"type": "progress", "done": 0, "total": 1, "stage": "model load"})
    cands = None
    want = [int(round(c)) for c in req.get("candidates") or [] if isinstance(c, (int, float))]
    bonus = candidate_bonus(req.get("candidates"), req.get("candidate_bonus"))
    if want and how == "given":
        ts = [int(round(t))] + [c for c in want if c != int(round(t))]
        n = partlabel.frame_parts(list(zip(ts, grab(video, ts, width=width))), head)
        cands = [{"t_ms": a, "parts": b, **({"bonus": bonus[a]} if a in bonus else {})} for a, b in zip(ts, n)]
        best = pick_candidate(ts, n, bonus)
        if best:
            t, how = ts[best], "best"
    bgr = seeder.read_image(image, 1920) if image else grab(video, [t], width=width)[0]
    ign = seeder.request_ignore(req.get("ignore"))   # v4.31: regions the owner marked ignore on this picture: blanked as in training, nothing proposed inside
    bgr = seeder.blank(bgr, ign)
    groups = partlabel.suggest(bgr, roi_region(roi), p["sem_shape"], head=head, who_split=p["who_split"], who_left=p["who_left"], head_shape=p["head_shape"], margin=p["paint_margin"],
                               key=(str(image), 0) if image else (str(video), int(round(t))),
                               who_ref=head.refs.get(seed.get("key")) if head is not None else None)
    groups = seeder.drop_ignored(groups, ign)
    groups, missing = partlabel.match_prior(groups, req.get("prior") or [], bgr.shape[1] / bgr.shape[0])
    return {"t_ms": int(round(t)), "frame": how, "groups": groups, **({"missing": missing} if req.get("prior") else {}), "frame_wh": [int(bgr.shape[1]), int(bgr.shape[0])],
            "ms": int(round(1000 * (time.perf_counter() - t0))), "media": media or {"width": int(bgr.shape[1]), "height": int(bgr.shape[0])},
            **({"candidates": cands} if cands is not None else {}), **({"sam": partlabel.LAST["sam"]} if partlabel.LAST.get("sam") else {}), **({"who": partlabel.LAST["who"]} if partlabel.LAST.get("who") else {}),
            **({"seeder": seeder_record(asked, prefer, why)} if seed.get("dir") else {})}


def candidate_bonus(candidates, bonus):
    """v4.20: candidate_bonus [float] parallel to candidates -> {t_ms: bonus} (non-numbers and missing entries left out)."""
    num = lambda x: isinstance(x, (int, float)) and not isinstance(x, bool)
    return {int(round(c)): float(b) for c, b in zip(candidates or [], bonus or []) if num(c) and num(b)}


def pick_candidate(ts, parts, bonus):
    """Index of the frame to suggest on: the most parts shown confidently plus the frame's v4.20 bonus (the app's weight
    for a frame that repeats elsewhere / the owner's loop frame); ties: the first listed."""
    return max(range(len(ts)), key=lambda i: (parts[i] + bonus.get(ts[i], 0.0), -i))


def seeder_record(head, prefer="auto", why=None):
    """What Suggest says about the learned head (v4.18): null when none is trained yet. v4.28: `features` (seeder.status) and,
    when the head could not be used with its own feature source here, `unused` (a plain reason: the tagger's heat answered)."""
    from pawtrack import seeder
    if head is None:
        return None
    i = head.info
    return {"frames": i.get("frames"), "videos": i.get("videos"), "trained_at": i.get("trained_at"), "fingerprint": i.get("fingerprint"),
            "parts": [p for p, u in zip(seeder.PARTS, head.use) if u] if not why else [],
            "features": seeder.status(head, prefer), **({"unused": why} if why else {})}


def cmd_seed_train(req, emit):
    """v4.18: (re)train the learned part head (pawtrack/seeder.py) from the painted groups of the library: the *.pawproj
    in `folders` (not recursive) and the `projects` paths, stored under `dir`. A no-op when the painted groups did not
    change since the stored head (`changed` false), unless `force`. v4.24: `labels` = the app's still-image labels folder
    (seeder.image_labels): each labelled image is a frame of its own source. Frames without cached features go through the tagger
    (CUDA; progress stage "features"), then the head trains on CPU (stage "training", seconds).
    v4.27: the result carries `score`, the held-out score of the label set (seedscore.py, stage "scoring"; cached by the fingerprint)."""
    from pawtrack import seeder
    d = req.get("dir")
    if not d or not isinstance(d, str):
        raise ValueError("seed_train needs dir")
    folders, projects = req.get("folders") or [], req.get("projects") or []
    if not all(isinstance(x, str) for x in [*folders, *projects]):
        raise ValueError("folders / projects are paths")
    labels = req.get("labels")
    if labels is not None and not isinstance(labels, str):
        raise ValueError("labels is a folder path")
    prefer = req.get("features", "auto")
    if prefer not in ("auto", "hydra"):
        raise ValueError("features is auto | hydra")
    ds = req.get("dataset")
    if ds is not None and not isinstance(ds, str):
        raise ValueError("dataset is a folder path")
    nm = req.get("namer")   # v4.38: the shared namer's scope {labels: {dataset id: folder}, folders?, projects?}
    if nm is not None and not (isinstance(nm, dict) and isinstance(nm.get("labels") or {}, dict) and all(isinstance(x, str) for x in [*(nm.get("labels") or {}).values(), *(nm.get("folders") or []), *(nm.get("projects") or [])])):
        raise ValueError("namer is {labels: {id: folder}, folders?, projects?}")
    frames, _ = seeder.gather(folders, projects, labels)
    src, _ = seeder.pick_source(prefer)
    if any(not os.path.exists(seeder.feat_file(d, f["key"], f["t"], src, f.get("ign", ""))) for f in frames):
        import torch
        from pawtrack import partlabel
        if not torch.cuda.is_available():
            raise RuntimeError("seed_train needs a CUDA GPU for frames not seen yet (the describe tagger)")
        if src["source"] == "hydra" and not partlabel.hydra_ready():
            raise RuntimeError("seed_train needs the describe extra's tagger weights")
    return seeder.train(d, folders, projects, emit, force=bool(req.get("force")), labels=labels, features=prefer, **({"dataset": ds} if ds else {}), **({"namer": nm} if nm else {}))


def cmd_seed_compare(req, emit):
    """v4.32: every dataset's head scored on the ACTIVE dataset's labels (pawtrack/seedcompare.py); CPU, cached by a fingerprint."""
    from pawtrack import seedcompare
    return seedcompare.compare(req, emit)


def cmd_name_groups(req, emit):
    """v4.34 (paw-p9ve): propose names for blobs the owner painted. image (a file path) or video + t_ms; masks [{w, h, rle, part?, who?}]
    (the groups' mask encoding; part / who when the blob is already named: they fix their blob and are the context of the others);
    seed {dir, dataset?, key, features?} as suggest_groups. -> {blobs: [{part: [{part, p} x 3], conf, auto, who, who_by, named}], model,
    seen, ms, note?}: one entry per mask. `auto`: conf >= the gate (autoname.GATE_PART) on an unnamed blob, what a confirm-all may accept;
    `who` / `who_by`: the character by the appearance split named by the blobs that carry a who (never a guess without one). A stale or
    missing model, or no features here, answers every blob unknown (empty part list) with a `note`. Cached features: tens of ms; an
    uncached picture takes the backbone once (CUDA)."""
    import time
    from pawtrack import autoname, seeder
    t0 = time.perf_counter()
    seed, masks = req.get("seed") or {}, req.get("masks")
    image, video = req.get("image"), req.get("video")
    if not isinstance(masks, list) or not masks:
        raise ValueError("name_groups needs masks")
    if not seed.get("dir") or not seed.get("key") or not (isinstance(image, str) or isinstance(video, str)):
        raise ValueError("name_groups needs image or video, and seed {dir, key}")
    ds = seed.get("dataset") or seed["dir"]
    t = 0 if image else int(round(req.get("t_ms", 0)))
    ms = [seeder.decode_mask(m) >= 0.5 for m in masks]
    named = {i: m["part"] for i, m in enumerate(masks) if m.get("part") in seeder.PI}
    whos = {i: m["who"] for i, m in enumerate(masks) if m.get("who") in autoname.WHOS}
    done = lambda blobs, note=None, **kw: {"blobs": blobs, "ms": int(round(1000 * (time.perf_counter() - t0))), **({"note": note} if note else {}), **kw}
    namer = autoname.Namer.load(seed["dir"])   # v4.38: the one namer of every dataset, whichever is active; its own feature source
    src = (namer.info.get("features") if namer is not None else None)
    if src is None:   # none trained yet since v4.38: the dataset's own (v4.34), on its head's features
        head = seeder.Head.load(ds)
        namer = autoname.Namer.load(ds, head.info.get("fingerprint")) if head is not None else None
        if namer is None:
            return done(autoname.Namer.blank(len(ms), "no model"), "no naming model for these labels yet: Train", model=None)
        head, why = seeder.usable_head(head, seed.get("features") if seed.get("features") in ("auto", "hydra") else "auto")
        if head is None:
            return done(autoname.Namer.blank(len(ms), why), why, model=None)
        src = head.features
    bgr = seeder.read_image(image, 1000) if image else __import__("pawtrack.frames", fromlist=["grab"]).grab(video, [t], width=1000)[0]
    f = {"key": seed["key"], "video": image or video, "t": t, "W": int(bgr.shape[1]), "H": int(bgr.shape[0]),
         "groups": [{"mask": m} for m in ms], **({"image": True} if image else {})}
    ign = seeder.request_ignore(req.get("ignore"))
    f = seeder.with_ignore(f, [ign] if ign is not None else [])
    z = seeder.load_features(seed["dir"], f["key"], f["t"], src, f.get("ign", ""))
    if z is None:
        import torch
        if not torch.cuda.is_available():
            return done(autoname.Namer.blank(len(ms), "no features"), "this picture has no cached features and there is no CUDA GPU to compute them", model=None)
        try:
            seeder.ensure_features(seed["dir"], [f], emit, None, src)
        except seeder.FeatureSourceUnavailable as e:
            return done(autoname.Namer.blank(len(ms), str(e)), str(e), model=None)
        z = seeder.load_features(seed["dir"], f["key"], f["t"], src, f.get("ign", ""))
        if z is None:
            return done(autoname.Namer.blank(len(ms), "no features"), "the picture could not be read", model=None)
    hists = [autoname.colour_hist(bgr, m) for m in ms]   # v4.36: always (the bodies split uses colour)
    blobs = namer.propose(z[0], z[1], ms, bgr.shape[1] / bgr.shape[0], hists, named, whos, bgr=bgr)
    return done(blobs, model={"blobs": namer.info.get("blobs"), "images": namer.info.get("images"), "gate": autoname.GATE_PART},
                seen="%s_%d" % (f["key"], f["t"]) in set(namer.info.get("trained_on") or []))


DIRECTIONS = ("both", "forward", "backward")
REV_CHUNK = 32  # v4.22: frames re-decoded at a time for a backward half (one chunk in memory: ~200 MB at 1080p)


def seeds_itself(tracker):
    """The points trackers pick / honour their seed frame and track a buffered scene both ways themselves (wrap)."""
    return any(q["key"] == "seed_frame" for q in tracker.params)


def reverse_frames(video, ts, width=None, chunk=REV_CHUNK):
    """v4.22: (t_ms, BGR) of the frames at times ts (ascending) in reverse order: the video played backwards, re-decoded
    `chunk` frames at a time from the last chunk back (open_frames: the same frames, scaled the same, as the forward
    decode), so only one chunk is in memory."""
    for k in range(len(ts), 0, -chunk):
        part = ts[max(0, k - chunk):k]
        want = set(part)
        _, it = open_frames(video, part[0], part[-1], width=width)
        yield from reversed([f for f in it if f[0] in want])


def both_ways(track, frames, roi, p, seed, rev, tick=None):
    """v4.22: every tracker runs both ways from its seed frame (owner: "just play the video in reverse"). frames = a
    scene's (t_ms, BGR) stream; the seed frame = its last frame at or before `seed` (roi.t_ms). When that is not the
    scene's first frame, `track` (a tracker's track(frames, roi, p)) runs from it backward to the first frame on the
    frames played in reverse (rev(ts) -> reverse_frames), then forward from it to the scene's end on the rest of the
    stream: one after the other, so a pass's state (the model's caches, VRAM) is gone before the next starts. Rows (t,
    value, overlay) come back in time order as one run; the seed frame is in both halves (the same picture, the same
    seed: the same row) and the forward half's row is kept. Seeded on the first frame: exactly track(frames).
    tick(k): called with the backward half's row count as it goes (progress)."""
    it = iter(frames)
    ts, seedf, nxt = [], None, None
    for f in it:
        if seedf is not None and f[0] > seed:
            nxt = f
            break
        ts.append(f[0])
        seedf = f
    rest = chain([seedf], [nxt] if nxt is not None else [], it)
    if len(ts) <= 1:
        yield from track(rest, roi, p)
        return
    back = []  # the frames before the seed, newest first; the rows only are kept
    for r in track(rev(ts), roi, p):
        back.append(r)
        if tick:
            tick(len(back))
    yield from back[:0:-1]
    yield from track(rest, roi, p)


def clamp_direction(req, tracker, roi, p):
    """v4.15 `direction` / `seed_ms` on track: -> (start_ms, end_ms, roi, p). both (default): the request's range as
    given. forward / backward: the range is cut at the seed (seed_ms, else roi.t_ms): forward = [seed, end_ms),
    backward = [start_ms, seed] (the seed frame included: end = seed + 1 ms), so start_ms / end_ms are the outer limits
    (a previous hard cut, the owner's range) and the run never crosses the seed. The roi's t_ms becomes the seed, and
    p["direction"] lets a points tracker stop where the tracked points are lost (points.lost_stop). v4.22:
    backward works with every tracker (the others run on the video played backwards from the seed: both_ways)."""
    a, b = int(req["start_ms"]), int(req["end_ms"])
    d = req.get("direction") or "both"
    if d not in DIRECTIONS:
        raise ValueError(f"direction: one of {DIRECTIONS}, got {d!r}")
    if d == "both":
        return a, b, roi, p
    seed = req.get("seed_ms", (roi or {}).get("t_ms"))
    if not isinstance(seed, (int, float)) or isinstance(seed, bool):
        raise ValueError(f"direction {d} needs seed_ms (or roi.t_ms)")
    seed = int(round(seed))
    if not a <= seed < b:
        raise ValueError(f"seed_ms {seed} outside [start_ms, end_ms) = [{a}, {b})")
    a, b = (seed, b) if d == "forward" else (a, seed + 1)
    return a, b, ({**roi, "t_ms": seed} if roi else roi), {**p, "direction": d}


def cmd_track(req, emit):
    prog = progress.CURRENT = Progress(emit)
    try:
        return _track(req, emit, prog)
    finally:
        progress.CURRENT = None
        # paw-mhme: each stage's wall time (summed over scenes) in the sidecar log; the app keeps its own per label
        print("pawtrack: stage times " + ", ".join(f"{k} {s:.1f} s" for k, s in prog.table()), file=sys.stderr)


def _track(req, emit, prog):
    tracker = load().get(req.get("tracker"))
    if tracker is None:
        if req.get("tracker") == "cotracker_points":   # paw-vdr4 / paw-uekm: its module and package are in no public build
            raise ValueError("CoTracker3 is not installed (an optional, non-commercial add-on); track with tapnext_points")
        raise ValueError(f"unknown tracker {req.get('tracker')!r}")
    p = coerce(tracker.params + PIPE_PARAMS + SCENE_PARAMS + FOLD_PARAMS + LEVEL_PARAMS + shaft.SHAFT_PARAMS, req.get("params"))
    roi = req.get("roi")
    if tracker.roi != "none" and (not roi or roi.get("kind") not in tracker.roi.split("_or_")):
        raise ValueError(f"tracker {tracker.id} needs a {tracker.roi!r} roi")
    media = probe(req["video"])
    start, end, roi, p = clamp_direction(req, tracker, roi, p)
    want_thumbs = (p["loop_fold"] != "off" or p["held_retime"] != "off" or p["pipe_gate"] != "off"
                   or p["pipe_sign"] == "auto")
    # No tracker here uses more than ~1080p (SAM 2 resizes to 1024); 4K only costs decode time and memory.
    # ROI and overlays are normalized, so the cap is invisible to the caller.
    width = 1920 if (media["width"] or 0) > 1920 else None
    # [start, end): open_frames includes its end, and end is the next shot's first frame (cuts sit on frame starts)
    total, frames = open_frames(req["video"], start, end - 1, width=width)
    cuts = req.get("cuts")
    if cuts is None:  # the sidecar's own cuts: the `scenes` detector (fades / dissolves need the whole range first)
        found, fcam = _scan(req["video"], start, end, p, prog, end, "scenes")
        cuts = [s["start_ms"] for s in found[1:]]
        if p["cut_camera"]:  # v4.9: its camera splits are soft cuts (one run through them, a normalisation boundary)
            cuts += [{"t_ms": s["start_ms"], "kind": "soft"} for s in split_scenes(found, fcam, p["cut_min_scene_ms"])
                     if s.get("split") == "camera"]
    if not isinstance(cuts, list):
        raise ValueError("cuts: a list")
    cuts, soft = parse_cuts(cuts)
    # v4.9: soft cuts never stop the run; points trackers re-seed there (wrap), the pipeline normalises per segment
    # v4.11: user groups replace the tagger's pinned groups in their scenes (points trackers, wrap)
    p = {**p, "soft_cuts": soft, "groups": parse_groups(req["groups"]) if req.get("groups") is not None else []}
    if req.get("groups_only"):  # v4.45: only the groups' own points (no box layout, no re-seeding into voids, no motion-group names)
        if not p["groups"]:
            raise ValueError("groups_only needs groups")
        p.update(groups_only=True, box_seed="grid", reseed_every_ms=0, group_labels=False)
    det, cam = _with_camera(_fixed_cuts(cuts))
    want_pts = any((g.get("shaft") or g.get("depth")) and g["id"] is not None for g in p["groups"])  # v4.17: the shaft pass reads the pts (v4.52: a depth part too)
    ptss = []  # per scene: the overlay `pts` per frame (only with a shaft group)
    from pawtrack.serve import GPU_TRACKERS
    cpu = tracker.id in GPU_TRACKERS and not __import__("torch").cuda.is_available()  # v4.56 (paw-eeod): said, not silent
    prog(0, total, stage="starting", extra={"device": "cpu"} if cpu else None)
    NOTES.clear()
    it = iter(frames)
    nxt = next(it, None)
    if nxt is not None:
        det(*nxt)
    levels_rec = []  # per scene: what the input adjustment did (scenes[].input)
    segs, done = [], 0  # per scene: (rows [(t, value, channels, confidence)], thumbs)
    while nxt is not None:  # one tracker run per scene: a cut stops the run and re-seeds from the roi
        first, nxt, thumbs, tthumb = nxt, None, [], []

        def scene():
            # the tracker pulls frames from here: one that buffers the scene (the point trackers, SAM's chunks) reports its
            # progress by the frames it has taken until its first output, then `inference` while it finishes the scene
            nonlocal nxt
            f, pulled = first, 0
            try:
                while True:
                    if want_thumbs:
                        thumbs.append(thumb(f[1]))
                        tthumb.append(f[0])
                    yield f[0], apply_levels(f[1], adj)  # v4.23: the scene's one adjustment, every frame alike
                    pulled += 1
                    if not rows and pulled > 1:
                        prog(done + pulled, stage=prog.pull)  # v4.43: "reading" while a points tracker buffers
                    f = next(it, None)
                    if f is None:
                        return
                    if det(*f):
                        nxt = f
                        return
            finally:
                if not rows:
                    held.append(True)
                    prog(stage="inference")

        rows, hist, n0, held = [], [], len(NOTES), []  # held: the tracker took the whole scene before its first row
        ptss.append([])
        seed, end_sc = (roi or {}).get("t_ms"), min([c for c in cuts if c > first[0]], default=float("inf"))
        # v4.23: one auto-levels adjustment per scene from a sample of its frames (the seed frame among them), applied to
        # every frame the tracker gets, both halves alike; scene detection, thumbs and the other passes see raw frames
        if p["input_levels"] == "off":
            adj, lrec = None, {"applied": False, "mode": "off"}
        else:
            prog(stage="levels")  # v4.43: the sample of the scene's frames is decoded here
            in_sc = isinstance(seed, (int, float)) and not isinstance(seed, bool) and first[0] <= seed < end_sc
            adj, lrec = scene_levels(req["video"], first[0], min(end_sc, end), seed if in_sc else None)
        levels_rec.append(lrec)
        prog.pull = "tracking"
        prog(stage="tracking")
        # v4.22: the scene holding the roi's frame (not its first frame) runs both ways from it; the points trackers do
        # that themselves (wrap), the others through both_ways on the video played backwards
        two = (isinstance(seed, (int, float)) and not isinstance(seed, bool) and first[0] < seed < end_sc
               and not seeds_itself(tracker))
        ps = {**p, "scene_ms": (first[0], min(end_sc, end))}  # v4.55: tapnext_points' auto size reads this scene's groups
        rows_in = (both_ways(tracker.track, scene(), roi, ps, seed, lambda ts: levelled(reverse_frames(req["video"], ts, width), adj),
                             tick=lambda k, d=done: prog(d + k, stage="tracking backward"))
                   if two else tracker.track(scene(), roi, ps))
        for t, val, overlay in rows_in:
            if want_pts:
                ptss[-1].append((overlay or {}).get("pts"))
            val, ch, cf = _unpack(val, p)
            if segs and not rows:
                val, ch, cf = None, None, None  # cut frame: flagged, tracker re-seeded here
            rows.append((t, val, ch, cf))
            live = None
            if val is not None:
                hist.append(val)
                # ponytail: O(n) per frame live re-normalization; fine for minutes, incremental if hours
                live = round(float(_scalar(hist)[-1]), 4)
            emit({"type": "frame", "t_ms": t, "value": live, "overlay": overlay})
            done += 1
            prog(done, stage="frames" if held else "tracking")  # v4.41: a buffered scene's rows go out in one burst
        rec = next((n["data"] for n in NOTES[n0:] if n["code"] == "primary" and "data" in n), None)
        for n in NOTES[n0:]:
            n["scene_index"] = len(segs)
            if rec is not None and n["code"] in ("low_motion", "held_input"):
                rec[n["code"]] = n.get("data", n["message"])
        if len(thumbs) != len(rows):  # paw-o74b.1: a run that stops where its points are lost (groups_only, one-way) keeps
            keep = {r[0] for r in rows}  # fewer rows than the scene's frames: the thumbs of the frames it kept, in step
            thumbs = [th for th, t in zip(thumbs, tthumb) if t in keep]
            if len(thumbs) != len(rows):
                thumbs = []  # still out of step: the picture passes (gate, loop, sign, cadence) skip this scene
        segs.append((rows, thumbs))
    prog(done, done, stage="points", force=True)

    samples, points, events, confidence, signs = [], [], [], [], []
    shafts = [_shaft_scene(req["video"], media, rows, ptss[sc], p, req.get("tags") or [], prog, events) if want_pts else None
              for sc, (rows, _) in enumerate(segs)]  # v4.17: before the channel list (it adds sem_<name>_in ...)
    if tracker.id == "sam2_mask" and p["groups"]:  # v4.39: a painted shaft and its region: the inside fraction per scene
        shafts = [mask_inside(rows, media["fps"] or 30) for rows, _ in segs]
    prog(stage="points")  # after a shaft pass (stage "shaft"): the points pipeline again
    channels = {c: [] for c in tracker.channels}
    for rows, _ in segs:  # v4.11: user groups' sem_<name>_* channels (any name) beyond the tracker's fixed list
        for r in rows:
            for c in r[2] or ():
                if c.startswith(("sem_", "who_")) and c not in channels:  # v4.12: characters' who_* channels
                    channels[c] = []
    for sc, (rows, thumbs) in enumerate(segs):
        ts = [r[0] for r in rows]
        good = [i for i, r in enumerate(rows) if r[1] is not None]
        v = np.full(len(rows), np.nan)
        if len(good) >= 2:
            v[good] = _scalar([rows[i][1] for i in good])
        dec = {}
        chans = None
        if any(r[2] and r[2].get("cam_conf") is not None for r in rows):  # points trackers: the groups' camera path
            col = lambda k: [np.nan if not r[2] or r[2].get(k) is None else r[2][k] for r in rows]
            chans = {k: col(k) for k in ("cam_x", "cam_y", "cam_conf", "raw_px")}
        soft = [c for c in p["soft_cuts"] if ts and ts[0] < c <= ts[-1]]
        v, pts, si = process_scene(ts, v, thumbs, p, events, dec, soft=soft,
                                   camera=cam.segments(ts[0], ts[-1] + 1) if ts else None, chans=chans,
                                   shaft_len=shafts[sc]["sign_from"] if shafts[sc] else None)
        if shafts[sc]:
            si["shaft"] = shafts[sc]["records"]  # scenes[].shaft (v4.17)
        if dec.get("segments"):
            si["segments"] = dec["segments"]  # scenes[].segments (v4.9)
        for n in NOTES:  # the scene's decision record (points trackers): + sign / cadence fill
            if n["code"] == "primary" and n.get("scene_index") == sc and "data" in n:
                n["data"].update(dec)
            if n["code"] == "group_labels" and n.get("scene_index") == sc and "data" in n:
                si["groups"] = n["data"]["groups"]  # scenes[].groups (PROTOCOL v3.3)
        if tracker.id == "sam2_mask" and _knot_tagged(req.get("tags") or []) and len(ts) >= 3:
            for e in knot_passes({"area": [(r[2] or {}).get("area") for r in rows], "confidence": [r[3] for r in rows]},
                                 media["fps"] or 30, ts):  # the scene gate (area p95/p5 <= 10) is inside
                events.append({"t_ms": e["t_ms"], "kind": "knot", "dir": e["kind"], "score": e["score"], "label": f"knot {e['kind']}"})
        si["input"] = levels_rec[sc]  # PROTOCOL v4.23
        signs.append(si)
        samples += [[t, _r(x)] for t, x in zip(ts, v)]
        points += [q for q in pts if not points or q["at"] > points[-1]["at"]]
        for t, _, ch, cf in rows:
            for c in channels:
                channels[c].append([t, _r((ch or {}).get(c), 5)])
            confidence.append([t, _r(cf, 3)])
    points = finish_range([([r[0] for r in rows], th) for rows, th in segs], points, p, req.get("spans"), events,
                          req.get("activity"))
    events.sort(key=lambda e: e["t_ms"])
    starts = [rows[0][0] for rows, _ in segs if rows]
    if starts:  # last scene ends one mean frame interval after its last frame
        ends = starts[1:] + [round(samples[-1][0] + (samples[-1][0] - samples[0][0]) / max(1, len(samples) - 1))]
    else:
        ends = []
    res = {"samples": samples, "points": points, "events": events, "media": media,
           "scenes": [{"start_ms": a, "end_ms": b, **si, "camera": cam.segments(a, b)}  # camera: v4.4, never splits a run
                      for a, b, si in zip(starts, ends, [si for (r, _), si in zip(segs, signs) if r])]}
    res["notes"] = list(NOTES)
    if cpu:
        res["device"] = "cpu"
    if channels:
        res["channels"] = channels
    if any(c is not None for _, c in confidence):
        res["confidence"] = [[t, c or 0.0] for t, c in confidence]
    prog(stage="result")  # v4.41: the result line is being written (several MB with a points tracker's channels)
    return res


SHOW_HZ = 15  # v4.44: the shaft pass's outline events per second, at most
DEPTH_MAX = 3  # v4.52: depth parts measured per scene (each one more SAM pass: ~1 s per s of video, ~1 GiB peak, not summed)


def _shaft_scene(video, media, rows, pts, p, tags, prog, events):
    """v4.17: the shaft consumption pass (pawtrack/shaft.py) of one scene, for each shaft group painted in it: its
    channels sem_<name>_in / _in_conf / _len / _knot / _bx / _by / _ex / _ey / _w go into the rows (cut frames stay
    out), knot events into events. -> {records: {name: record}, sign_from: (len, conf) of the most confident SAM group
    | None} | None (no shaft group in this scene)."""

    ts = [r[0] for r in rows]
    if not ts or len(pts) != len(rows):
        return None
    mine = [g for g in p["groups"] if g.get("t_ms") is not None and ts[0] - 1 <= g["t_ms"] <= ts[-1] + 1]
    todo = [g for g in mine if g.get("shaft") and g["id"] is not None]
    # v4.52 (paw-4c48.19): the parts the owner turned on (`depth`), at most DEPTH_MAX a scene (each costs a SAM pass)
    parts = [g for g in mine if g.get("depth") and not g.get("shaft") and g["id"] is not None]
    skipped = parts[DEPTH_MAX:]
    todo += parts[:DEPTH_MAX]
    if not todo:
        return None
    buf = _SceneFrames(video, ts, min(1280, media.get("width") or 1280)) if p["shaft_sam"] else None
    records, best = {g["name"]: {"source": "none", "role": "part", "note": f"over {DEPTH_MAX} depth parts in one scene"} for g in skipped}, None
    for g in todo:
        part = not g.get("shaft")
        size = buf.size if buf else (media.get("width") or 16, media.get("height") or 9)
        try:
            # v4.44: stage "shaft" counts the scene's frames SAM went through (out of 1000) and, at most SHOW_HZ times a
            # second, carries the frame's t_ms and the outline SAM just made (the app shows that frame with it)
            with progress.steps("shaft") as tick:
                last = [float("-inf")]

                def show(k, m, off):
                    now = time.perf_counter()
                    if now - last[0] >= 1 / SHOW_HZ:
                        last[0] = now
                        tick((k + 1) / len(ts), t_ms=int(ts[k]), outline=shaft.outline(m, off, size))
                r = shaft.run_scene(ts, pts, mine, g, size, p, frame_at=buf, knot=_knot_tagged(tags),
                                    emit=lambda d, t, **k: tick(d / max(1, t)), show=show, **({"part": True} if part else {}))
        except Exception as e:  # noqa: BLE001 (the pass is extra: a failure is a note, the run goes on)
            records[g["name"]] = {"source": "none", "note": f"shaft pass failed ({type(e).__name__}: {e})", **({"role": "part"} if part else {})}
            continue
        if r is None:
            records[g["name"]] = {"source": "none", "note": "under 3 of its members visible anywhere in the scene", **({"role": "part"} if part else {})}
            continue
        records[g["name"]] = r["record"]
        for k, x in r["channels"].items():
            for row, val in zip(rows, x):
                if row[2] is not None:
                    row[2][f"sem_{g['name']}_{k}"] = None if not np.isfinite(val) else float(val)
        events += [{**e, "label": f"{e['label']} ({g['name']})"} for e in r["events"]]
        share = r["record"].get("conf_share", 0)
        # the points fallback never sets the direction: on the owner's runs the tracker keeps the penis members
        # "visible" while they slide over the partner (no signal), and a hand on the shaft reads as confident
        if r["record"]["source"] == "sam" and not part and (best is None or share > best[0]):   # a depth part never sets the sign
            best = (share, (r["channels"]["len"], r["channels"]["in_conf"]))
    return {"records": records, "sign_from": best[1] if best else None}


class _SceneFrames:
    """frame_at(i) for shaft.schedule: the scene's frames decoded once, in order, at <= width px, matched to the rows'
    times; frames more than a re-prompt window behind the newest asked are dropped (schedule only moves forward)."""

    def __init__(self, video, ts, width):
        self.ts = np.asarray(ts, float)
        _, self.it = open_frames(video, int(self.ts[0]), int(self.ts[-1]) + 1, width=width)
        self.buf, self.top, self.done = {}, -1, False
        self._pull()
        f = next(iter(self.buf.values()), None)
        self.size = (f.shape[1], f.shape[0]) if f is not None else (width, width * 9 // 16)

    def _pull(self):
        nxt = next(self.it, None)
        if nxt is None:
            self.done = True
            return
        j = int(np.argmin(np.abs(self.ts - nxt[0])))
        self.buf[j] = nxt[1]
        self.top = max(self.top, j)

    def __call__(self, i):
        while i > self.top and not self.done:
            self._pull()
        for k in [k for k in self.buf if k < i - 200]:
            del self.buf[k]
        if i in self.buf:
            return self.buf[i]
        return self.buf[min(self.buf, key=lambda k: abs(k - i))]


def process_scene(ts, v, thumbs, p, events, dec=None, soft=(), camera=None, chans=None, shaft_len=None):
    """One scene, after the tracker: 0..1 primary values (NaN = cut/lost) -> (samples, points,
    sign). sign = pipe_sign auto decision (energy_sign, +1 if keep/undecided) x pipe_invert.
    dec (dict, optional) gets the decision record's "sign" and "cadence_fill" (PROTOCOL notes, code primary), and
    "segments" (v4.9, pipeline.cam_detrend's per-piece record).
    v4.9: soft (ms, inside the scene) = soft cuts, each a normalisation boundary; camera = the camera detector's
    segments of the scene; chans = per-frame cam_x / cam_y / cam_conf / raw_px lists (points trackers) -> the camera
    trend is removed in progressive pieces first (pipeline.cam_detrend). Without them: the v4.8 path.
    The eval (trackers/eval/baselines.py) calls exactly this, so it scores what track returns."""
    v = np.asarray(v, float)
    if np.isfinite(v).sum() < 2:
        return v, [], {"sign": -1 if p["pipe_invert"] else 1, "auto_sign": None}
    rec = []
    v = cam_detrend(ts, v, soft, camera, chans, p, rec)
    if rec:
        ok = np.isfinite(v)
        v[ok] = normalize(v[ok])
        if dec is not None:
            dec["segments"] = rec
    if thumbs:
        v = _loop_post(ts, v, thumbs, p, events)
    info = {}
    auto = energy_sign(ts, v, thumbs, p, info) if p["pipe_sign"] == "auto" and thumbs else None
    sh = None
    if shaft_len is not None:  # v4.17: the shaft's visible length (larger = out) sets the direction where it is confident
        sh = shaft.shaft_sign(v, *shaft_len)
    sign = (sh["sign"] if sh and sh["confident"] else auto or 1) * (-1 if p["pipe_invert"] else 1)
    if dec is not None:
        dec["sign"] = {"mode": "shaft" if sh and sh["confident"] else p["pipe_sign"], "auto": auto,
                       "invert": bool(p["pipe_invert"]), "applied": sign, **info, **({"shaft": sh} if sh else {})}

    if sign < 0:
        v = 1 - v
    ok = np.isfinite(v)
    pts = to_points(np.asarray(ts, float)[ok], v[ok], p, soft) if ok.sum() >= 2 else []
    if p["pipe_cadence_fill"] and thumbs and pts:  # strokes the tracker missed, from the picture's own rhythm
        n_pts = len(pts)
        pts = cadence_fill(pts, cadence_turns(ts, thumbs), p["pipe_min_interval_ms"])
        if dec is not None:
            dec["cadence_fill"] = {"inserted": len(pts) - n_pts}
    return v, pts, {"sign": sign, "auto_sign": auto}


def _loop_post(ts, v, thumbs, p, events):
    """held_retime, then loop_fold, on one scene's 0..1 signal (NaN = lost). Appends cycle events."""
    if p["held_retime"] != "off":
        h = held_frames(thumbs)
        print(f"pawtrack: held frames step={h['step']} ratio={h['ratio']}", file=sys.stderr)
        if p["held_retime"] == "on" or h["step"] >= 2:
            v = retime(ts, v, h["new"])
    if p["loop_fold"] != "off":
        per = detect_period(thumbs)
        n = per["period_frames"]
        print(f"pawtrack: loop {per}", file=sys.stderr)
        # auto: exact loops only (confidence = exactness); on: any period, also periodic motion
        if n and per["cycles"] >= 2 and (p["loop_fold"] == "on" or per["confidence"] >= p["loop_min_confidence"]):
            v = fold(v, n)
            events += [{"t_ms": ts[i], "kind": "cycle", "label": f"cycle {k + 1}"}
                       for k, i in enumerate(range(0, len(ts), n))]
    ok = np.isfinite(v)
    if ok.sum() >= 2:
        v[ok] = normalize(v[ok])
    return v


def _safe(fn):
    return lambda req, emit: _json_safe(fn(req, emit))


# the dispatch table of one-shot requests and of `pawtrack serve` (README of src/lib/director §8)
COMMANDS = {"list": cmd_list, "probe": cmd_probe, "scenes": cmd_scenes, "track": cmd_track,
            "loop": cmd_loop, "describe": cmd_describe, "score": cmd_score,
            "frames": _safe(frames.cmd_frames), "motion.stats": _safe(motion.cmd_stats),
            "motion.compare": _safe(motion.cmd_compare), "motion.propose": _safe(motion.cmd_propose),
            "director.ask": _safe(director.cmd_ask), "cum": cmd_cum, "tag_image": cmd_tag_image,
            "suggest_groups": _safe(cmd_suggest_groups), "seed_train": _safe(cmd_seed_train), "seed_compare": _safe(cmd_seed_compare), "name_groups": _safe(cmd_name_groups),
            "segment": _safe(lambda req, emit: __import__("pawtrack.segment", fromlist=["cmd_segment"]).cmd_segment(req, emit))}


def main():
    if sys.argv[1:2] == ["serve"]:  # long-lived JSONL session (pawtrack/serve.py)
        from pawtrack import serve
        return serve.main(sys.argv[2:])
    # Only JSONL events may reach the real stdout: keep a private handle to it and point fd 1
    # (and sys.stdout) at stderr, so stray prints from us or native libs can't corrupt the stream.
    out = os.fdopen(os.dup(1), "w", encoding="utf-8", newline="\n")
    os.dup2(2, 1)
    sys.stdout = sys.stderr

    def emit(obj):
        out.write(json.dumps(obj, separators=(",", ":")) + "\n")
        out.flush()

    try:
        sys.stdin.reconfigure(encoding="utf-8")
        req = json.loads(sys.stdin.read())
        fn = COMMANDS.get(req.get("cmd"))
        if fn is None:
            raise ValueError(f"unknown cmd {req.get('cmd')!r}")
        from pawtrack import gpu, vram  # a CUDA out-of-memory error ends in words (what was loaded, what was needed)
        gpu.install()  # paw-k97q: the first torch.cuda.is_available() probes the card
        emit({"type": "result", **vram.run(lambda: fn(req, emit), lambda: False)})
    except Exception as e:
        traceback.print_exc()
        from pawtrack import gpu, vram
        emit({"type": "error", "message": vram.FATAL + gpu.hint() if vram.is_fatal(e) else str(e) if getattr(e, "relayed", False) else f"{type(e).__name__}: {e}"})
        sys.exit(1)


if __name__ == "__main__":  # python -m pawtrack.cli [serve]
    main()
