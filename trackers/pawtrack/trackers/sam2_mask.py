"""SAM 2.1 (facebookresearch/sam2, Apache-2.0 code and weights) video mask tracker.

Box or positive clicks on the first frame of the scene -> mask propagated by the video predictor
-> shape channels measured on the mask. Needs the `sam2` extra (see README). torch/sam2 are only
imported inside track(), so `list` stays light.

Frames are fed to SAM 2 straight from memory (no JPEG dump), in chunks of `chunk_frames`: each
chunk is a fresh inference state holding [scene's first frame + original prompt, previous chunk's
last frame + its mask, new frames...], so the object keeps its original anchor and continuity while
memory stays bounded by the chunk, not the range. roi["anchors"] [(bgr, mask)] (shaft.py, v4.50): more
conditioning frames ahead of every chunk; roi kind "none": no prompt of its own (the anchors carry the object).
"""
import os
import sys
import urllib.request
from contextlib import nullcontext
from itertools import chain, islice
from pathlib import Path

import cv2
import numpy as np

from pawtrack import MODELS_DIR
from pawtrack.registry import param, register
from pawtrack.trackers import low_motion_note

CHANNELS = ["centroid_x", "centroid_y", "area", "axis_len", "axis_width", "len_over_width", "axis_angle", "bulge", "raw_px"]
MODELS = {  # size -> (config inside the sam2 package, checkpoint file)
    "tiny": ("configs/sam2.1/sam2.1_hiera_t.yaml", "sam2.1_hiera_tiny.pt"),
    "small": ("configs/sam2.1/sam2.1_hiera_s.yaml", "sam2.1_hiera_small.pt"),
    "base_plus": ("configs/sam2.1/sam2.1_hiera_b+.yaml", "sam2.1_hiera_base_plus.pt"),
    "large": ("configs/sam2.1/sam2.1_hiera_l.yaml", "sam2.1_hiera_large.pt"),
}
CKPT_URL = "https://dl.fbaipublicfiles.com/segment_anything_2/092824/"
CACHE = MODELS_DIR / ".cache" / "sam2"  # trackers/.cache/sam2 (gitignored), or the app's models folder (paw-cdot)
MIN_PIXELS = 20  # smaller mask = lost


def mask_stats(mask, base_end, prev_ends=None):
    """Bool mask (H, W) -> (channels dict, ends) or (None, prev_ends) if empty.
    Lengths are in frame heights (normalized frame coords), area in frame fractions.
    axis_len / axis_width: sides of the rectangle with the same second moments (exact for a rectangle).
    bulge: max slice width in the basal third of the axis / shaft width (25th percentile of the slice widths).
    (The old reference, the median width of the middle third, is the knot itself once the visible part is short
    and the knot fills half of it, so bulge read ~1 exactly when the knot was about to pass.)
    base_end: "auto" = the axis end that has moved least so far (tracked across frames via `ends`),
    or "top" / "bottom" / "left" / "right"."""
    H, W = mask.shape
    m = cv2.moments(mask.view(np.uint8), binaryImage=True)
    if m["m00"] < MIN_PIXELS:
        return None, prev_ends
    cx, cy = m["m10"] / m["m00"], m["m01"] / m["m00"]
    cov = np.array([[m["mu20"], m["mu11"]], [m["mu11"], m["mu02"]]]) / m["m00"]
    (l2, l1), vecs = np.linalg.eigh(cov)  # ascending
    u = vecs[:, 1]
    length, width = np.sqrt(12 * max(l1, 0)), np.sqrt(12 * max(l2, 1e-6))

    # which axis end is the base
    c = np.array([cx, cy])
    ends = [c - u * length / 2, c + u * length / 2]
    moved = [0.0, 0.0]
    if prev_ends is not None:
        pe, pm = prev_ends
        if np.linalg.norm(ends[0] - pe[0]) + np.linalg.norm(ends[1] - pe[1]) > \
           np.linalg.norm(ends[0] - pe[1]) + np.linalg.norm(ends[1] - pe[0]):
            ends = ends[::-1]  # keep end identity across frames (u's sign is arbitrary)
        moved = [pm[k] + float(np.linalg.norm(ends[k] - pe[k])) for k in (0, 1)]
    pick = {"auto": lambda e: -moved[e], "top": lambda e: -ends[e][1], "bottom": lambda e: ends[e][1],
            "left": lambda e: -ends[e][0], "right": lambda e: ends[e][0]}[base_end]
    base = ends[max((0, 1), key=pick)]

    # width profile along the axis, oriented base -> tip
    ys, xs = np.nonzero(mask)
    s = (xs - cx) * u[0] + (ys - cy) * u[1]
    if np.dot(base - c, u) > 0:
        s = -s
    nb = 30  # slices; width of a slice = its extent across the axis
    across = (ys - cy) * u[0] - (xs - cx) * u[1]
    b = np.clip(((s / length + 0.5) * nb).astype(int), 0, nb - 1)
    hi, lo = np.full(nb, -np.inf), np.full(nb, np.inf)
    np.maximum.at(hi, b, across)
    np.minimum.at(lo, b, across)
    prof = np.where(hi >= lo, hi - lo + 1, 0)
    shaft = np.percentile(prof[prof > 0], 25) if (prof > 0).any() else 0
    bulge = float(prof[:nb // 3].max() / shaft) if shaft > 0 else None

    ang = float(np.degrees(np.arctan2(-u[1], u[0])))  # screen angle, counter-clockwise, 0 = horizontal
    ang = (ang + 90) % 180 - 90
    ch = {"centroid_x": cx / W, "centroid_y": cy / H, "area": m["m00"] / (W * H),
          "axis_len": length / H, "axis_width": width / H, "len_over_width": length / width,
          "axis_angle": ang, "bulge": bulge}
    return ch, (ends, moved)


def _overlay(mask, W, H):
    cs, _ = cv2.findContours(mask.view(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cs = sorted(cs, key=cv2.contourArea, reverse=True)[:3]
    polys = []
    for c in cs:
        eps = 0.005 * cv2.arcLength(c, True)
        while len(p := cv2.approxPolyDP(c, eps, True)) > 64:  # at most 64 vertices per polygon
            eps *= 1.5
        if len(p) >= 3:
            polys.append((p.reshape(-1, 2) / [W, H]).round(4).tolist())
    boxes = []
    if cs:
        x, y, w, h = cv2.boundingRect(np.concatenate(cs))
        boxes = [[round(x / W, 4), round(y / H, 4), round(w / W, 4), round(h / H, 4)]]
    return {"points": [], "boxes": boxes, "masks": polys}


def _raster(poly, W, H):
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [np.round(np.asarray(poly, float) * [W, H]).astype(np.int32)], 1)
    return m.astype(bool)


def painted(groups, W, H):
    """v4.39 `track.groups` (cli.parse_groups) for sam2_mask: each pinned group with a polygon is one SAM object, its
    polygon the mask prompt on the stream's first frame (the seed: cli runs both ways from roi.t_ms), its `fixes`
    [{t_ms, poly}] (the owner's corrections) more mask prompts on those frames. -> [{name, part, who, mask, fixes: [(t_ms,
    mask)]}] (empty: the box / clicks path as before)."""
    out = []
    for g in groups or ():
        if not g.get("pinned", True) or not g.get("poly"):
            continue
        part = g.get("part") or str(g["name"]).split("_")[-1].rstrip("0123456789")
        from pawtrack.partlabel import erased_mask
        er = erased_mask(g, W, H)   # v4.53: what the owner erased stays out of the seed mask
        out.append({"name": g["name"], "part": part, "who": g.get("who"), "mask": _raster(g["poly"], W, H) & (True if er is None else ~er),
                    "fixes": [(float(f["t_ms"]), _raster(f["poly"], W, H)) for f in g.get("fixes") or ()]})
    return out


def shaft_pair(objs):
    """(shaft index, receiving region index) among the painted objects: the penis / knot, and the region it goes into
    (another character's anus / slit / hips / head ..., else any other group) | (None, None)."""
    from pawtrack.shaft import RECEIVE
    s = next((k for k, o in enumerate(objs) if o["part"] in ("penis", "knot")), None)
    if s is None:
        return None, None
    rest = [k for k in range(len(objs)) if k != s]
    r = next((k for k in rest if objs[k]["part"] in RECEIVE and (not objs[s]["who"] or objs[k]["who"] != objs[s]["who"])), None)
    return s, (r if r is not None else (rest[0] if rest else None))


MASK_RAW = ("mL", "w", "holes", "gap", "edge", "dp", "bx", "by", "ex", "ey", "mconf")  # shaft.frame_measure (cli: inside fraction)


def _track_painted(pred, prep, Frames, frames, objs, p, H, W, torch, dev):
    """The painted-seed path (v4.39). Per frame and object: sem_<name>_{area, x, y (centroid), alen, awid (axis length /
    width), lw (length over width), vis (area / the seed frame's), scale (sqrt(vis) - 1: + = bigger), conf (SAM's
    object score)}; with a shaft and a receiving region, the shaft's raw measure sem_<shaft>_<MASK_RAW> (cli.mask_inside
    turns it into _in / _in_conf / _len). Chunks as the box path; every chunk's head = [the seed frame + the seed masks,
    the latest corrected frame + its masks, the last emitted frame + its masks], so the original seed and the newest
    correction stay anchors while memory stays bounded by the chunk."""
    from pawtrack.shaft import frame_measure
    n, sk = len(objs), shaft_pair(objs)
    it = iter(frames)
    f0 = next(it)
    seed = (prep(f0[1]), [o["mask"] for o in objs])
    ts, body, fixed = [f0[0]], [seed[0]], {}
    fixf, carry, ends, area0, tprev = None, None, [None] * n, [None] * n, f0[0]
    amp = torch.autocast("cuda", dtype=torch.bfloat16) if dev == "cuda" else nullcontext()
    with torch.inference_mode(), amp:
        while True:
            for t, img in islice(it, p["chunk_frames"] - len(body)):
                tol, tprev = 0.5 * abs(t - tprev) or 20, t
                ts.append(t)
                body.append(prep(img))
                fx = {k: m for k, o in enumerate(objs) for tf, m in o["fixes"] if abs(tf - t) <= tol}
                if fx:
                    fixed[len(body) - 1] = fx
            if not body:
                return
            head = [] if carry is None else [seed] + ([fixf] if fixf else []) + [carry]
            state = pred.init_state((Frames([h[0] for h in head] + body), H, W))
            for j, (_, ms) in enumerate(head):
                for k, m in enumerate(ms):
                    if m is not None and (j == 0 or m.any()):
                        pred.add_new_mask(state, frame_idx=j, obj_id=k + 1, mask=torch.from_numpy(m))
            if carry is None:
                for k, m in enumerate(seed[1]):
                    pred.add_new_mask(state, frame_idx=0, obj_id=k + 1, mask=torch.from_numpy(m))
            for i, fx in fixed.items():
                if i or carry is not None:
                    for k, m in fx.items():
                        pred.add_new_mask(state, frame_idx=len(head) + i, obj_id=k + 1, mask=torch.from_numpy(m))
            outs = [state["output_dict_per_obj"][k] for k in range(n)]
            last = carry
            for idx, _, logits in pred.propagate_in_video(state):
                if idx < len(head):
                    continue
                i = idx - len(head)
                masks = [(logits[k, 0] > 0).cpu().numpy() for k in range(n)]
                conf = []
                for k in range(n):
                    o = outs[k]["cond_frame_outputs"].get(idx) or outs[k]["non_cond_frame_outputs"].get(idx)
                    conf.append(float(torch.sigmoid(o["object_score_logits"].float()).max()))
                ch, ov = {}, {"points": [], "boxes": [], "masks": [], "mask_of": []}
                for k, o in enumerate(objs):
                    nm = f"sem_{o['name']}_"
                    st, ends[k] = mask_stats(masks[k], "auto", ends[k])
                    if st is None:
                        ch.update({nm + c: None for c in ("area", "x", "y", "alen", "awid", "lw", "vis", "scale")})
                        ch[nm + "conf"] = conf[k]
                        continue
                    area0[k] = area0[k] or st["area"]  # the stream's first frame is the seed (both halves)
                    v = st["area"] / area0[k]
                    ch.update({nm + "area": st["area"], nm + "x": st["centroid_x"], nm + "y": st["centroid_y"], nm + "alen": st["axis_len"],
                               nm + "awid": st["axis_width"], nm + "lw": st["len_over_width"], nm + "vis": v, nm + "scale": float(np.sqrt(v)) - 1,
                               nm + "conf": conf[k]})
                    po = _overlay(masks[k], W, H)["masks"]
                    ov["masks"] += po
                    ov["mask_of"] += [k] * len(po)
                if sk[1] is not None:
                    fm = frame_measure(masks[sk[0]], masks[sk[1]], conf[sk[0]])
                    ch.update({f"sem_{objs[sk[0]]['name']}_{c}": fm.get(c) for c in MASK_RAW})
                yield ts[i], {"value": ch.get(f"sem_{objs[0]['name']}_vis"), "channels": ch, "confidence": min(conf)}, ov
                last = (body[i], masks)
                if i in fixed:
                    fixf = (body[i], masks)
            done = len(body) < p["chunk_frames"]
            carry, ts, body, fixed = last, [], [], {}
            del state
            if done:
                return


_PRED = {}  # (model, device) -> video predictor; cleared by serve when another GPU tracker loads


def _checkpoint(size):
    path = CACHE / MODELS[size][1]
    if not path.exists():
        url = CKPT_URL + MODELS[size][1]
        print(f"pawtrack: downloading SAM 2.1 {size} checkpoint (Apache-2.0, Meta AI, "
              f"https://github.com/facebookresearch/sam2)\n  {url}\n  -> {path}", file=sys.stderr)
        CACHE.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        urllib.request.urlretrieve(url, tmp)
        tmp.replace(path)
    return path


@register("sam2_mask", "SAM 2.1 mask (box or clicks)", roi="box_or_points", channels=CHANNELS, params=[
    param("primary", "Primary signal", "choice", "len_over_width",
          choices=["len_over_width", "centroid_auto", "centroid_x", "centroid_y", "area",
                   "axis_len", "axis_width", "axis_angle", "bulge"]),
    param("model", "Model size", "choice", "small", choices=list(MODELS)),
    param("bulge_base", "Bulge: base end", "choice", "auto", choices=["auto", "top", "bottom", "left", "right"]),
    param("chunk_frames", "Frames per chunk (memory ceiling)", "int", 150, 16, 2000),
])
def track(frames, roi, p):
    os.environ.setdefault("TQDM_DISABLE", "1")
    import torch
    import sam2.sam2_video_predictor as svp
    from sam2.build_sam import build_sam2_video_predictor

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    from pawtrack import vram; vram.cap(f"sam2_mask:{p['model']}", max(3, 2 + 0.004 * p["chunk_frames"]))  # measured ~1 GiB + 3.9 MB/chunk frame; PAWTRACK_VRAM_GB overrides
    if dev == "cpu":
        print("pawtrack: CUDA not available, SAM 2 runs on CPU (very slow)", file=sys.stderr)
    if (p["model"], dev) not in _PRED:  # one predictor per process (pawtrack serve keeps it between requests)
        from pawtrack.progress import stage; stage("model load")
        vram.evict([f"sam2_mask:{k[0]}" for k in _PRED])
        _PRED.clear()
        with vram.loading(f"sam2_mask:{p['model']}", lambda k=(p["model"], dev): _PRED.pop(k, None)):
            _PRED[p["model"], dev] = build_sam2_video_predictor(MODELS[p["model"]][0], str(_checkpoint(p["model"])), device=dev)
    pred = _PRED[p["model"], dev]
    pred.fill_hole_area = 0  # needs sam2's optional CUDA op (not built); cosmetic only
    # ponytail: init_state() only takes a path; this hands it our in-memory frames instead.
    # Relies on sam2 internals (pinned commit in pyproject.toml): images[i] -> normalized CHW float tensor.
    svp.load_video_frames = lambda video_path, **kw: video_path
    S = pred.image_size
    mean = torch.tensor([0.485, 0.456, 0.406], device=dev)[:, None, None]
    std = torch.tensor([0.229, 0.224, 0.225], device=dev)[:, None, None]

    class Frames(list):  # uint8 (3, S, S) on device; normalized on access
        def __getitem__(self, i):
            return (super().__getitem__(i).float() / 255 - mean) / std

    def prep(bgr):
        rgb = cv2.cvtColor(cv2.resize(bgr, (S, S), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)
        return torch.from_numpy(rgb).to(dev).permute(2, 0, 1)

    it = iter(frames)
    f0 = next(it, None)
    if f0 is None:
        return
    H, W = f0[1].shape[:2]
    objs = painted(p.get("groups"), W, H)
    if objs:  # v4.39: the painted seed (a modifier's own run): one SAM object per group, its mask the prompt
        yield from _track_painted(pred, prep, Frames, chain([f0], it), objs, p, H, W, torch, dev)
        return
    if roi["kind"] == "none":  # paw-4c48.13 (shaft.py): no prompt of its own, the anchors carry the object
        prompt = None
    elif roi["kind"] == "box":
        prompt = {"box": np.array([roi["x"] * W, roi["y"] * H, (roi["x"] + roi["w"]) * W, (roi["y"] + roi["h"]) * H])}
        if roi.get("points"):  # box plus clicks (pawtrack/pulse.py: positives inside the region, negatives on its neighbours)
            prompt.update(points=np.array(roi["points"], np.float32) * [W, H], labels=np.array(roi["labels"], np.int32))
    else:  # clicks; optional roi["labels"]: 1 = positive (default), 0 = negative (exclude this spot)
        pts = np.array(roi["points"], np.float32) * [W, H]
        prompt = {"points": pts, "labels": np.array(roi.get("labels") or [1] * len(pts), np.int32)}
    # paw-4c48.13 (shaft.py): roi["anchors"] [(bgr, bool mask)] = conditioning frames ahead of every chunk (the shaft fully
    # out): SAM keeps the whole object in memory, so a mask that shrank while it was inside grows back when it comes out
    anchors = [(prep(a), torch.from_numpy(np.ascontiguousarray(m))) for a, m in roi.get("anchors") or ()]
    na = len(anchors)
    first = prep(f0[1])
    ts, body = [f0[0]], [first]
    carry, ends = None, None  # (frame tensor, mask) of the last emitted frame
    raws, c0 = [], None
    amp = torch.autocast("cuda", dtype=torch.bfloat16) if dev == "cuda" else nullcontext()
    with torch.inference_mode(), amp:
        while True:
            for t, img in islice(it, p["chunk_frames"] - len(body)):
                ts.append(t)
                body.append(prep(img))
            if not body:
                return
            head = [a for a, _ in anchors] + ([] if carry is None else [first, carry[0]])
            state = pred.init_state((Frames(head + body), H, W))
            for j, (_, m) in enumerate(anchors):
                pred.add_new_mask(state, frame_idx=j, obj_id=1, mask=m)
            if prompt is not None:
                pred.add_new_points_or_box(state, frame_idx=na, obj_id=1, **prompt)
            if carry is not None and carry[1].any():
                pred.add_new_mask(state, frame_idx=na + 1, obj_id=1, mask=torch.from_numpy(carry[1]))
            outs = state["output_dict_per_obj"][0]
            last = carry
            for idx, _, logits in pred.propagate_in_video(state):
                if idx < len(head):
                    continue
                i = idx - len(head)
                mask = (logits[0, 0] > 0).cpu().numpy()
                out = outs["cond_frame_outputs"].get(idx) or outs["non_cond_frame_outputs"].get(idx)
                conf = float(torch.sigmoid(out["object_score_logits"].float()).max())
                ch, ends = mask_stats(mask, p["bulge_base"], ends)
                if ch is None:
                    value, ch = None, dict.fromkeys(CHANNELS)
                elif p["primary"] == "centroid_auto":
                    value = (ch["centroid_x"] * W, ch["centroid_y"] * H)  # core projects on the motion axis
                elif p["primary"] == "centroid_y":
                    value = -ch["centroid_y"]  # up = higher, like the other trackers
                else:
                    value = ch[p["primary"]]
                # raw_px: what the primary measures, in frame px: the centroid coordinate for centroid_x / _y,
                # distance from the first centroid for centroid_auto, else the visible length (axis_len)
                if ch["centroid_x"] is not None:
                    cx, cy = ch["centroid_x"] * W, ch["centroid_y"] * H
                    c0 = c0 or (cx, cy)
                    ch["raw_px"] = {"centroid_x": cx, "centroid_y": -cy, "centroid_auto": float(np.hypot(cx - c0[0], cy - c0[1]))
                                    }.get(p["primary"], ch["axis_len"] * H)
                raws.append(ch.get("raw_px"))
                yield ts[i], {"value": value, "channels": ch, "confidence": conf}, _overlay(mask, W, H)
                last = (body[i], mask)
            done = len(body) < p["chunk_frames"]  # short chunk = frames exhausted
            carry, ts, body = last, [], []
            del state
            if done:
                low_motion_note("sam2_mask", raws)
                return
