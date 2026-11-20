"""`segment` (PROTOCOL v4.25, paw-liwk): prompted SAM 2 on one frame, for the app's Groups "grow" brush.

Points / box / prior mask in (0..1 of the frame) -> SAM's multi-mask outputs in the groups' mask encoding, smallest first.
The image embedding (the expensive part: ~1 s at 1080p) is computed once per frame / image and kept in a small LRU, so the
second and later prompts on the same frame cost only the mask decoder. SAM is the image predictor partlabel already loads
(`sam_image`, resident through pawtrack/vram.py); in `serve` a `segment` that arrives while a GPU job holds the card is
refused at once (serve.Service.submit), never queued behind a minutes-long Track.
"""
import base64
import time
from collections import OrderedDict

import numpy as np

LEVELS = 15            # the groups' mask levels (src/features/tracking/groups.js LEVELS)
CACHE_MAX = 4          # frames whose embeddings are kept
SEG_GB = 1.0           # what one segment holds of the card: the tiny model + the 1024 px embedding + decode (measured peak 0.58 GB, resident 0.28 GB; PROTOCOL v4.25)
MAX_SIDE = 1024        # frames wider than this are decoded at this width (SAM resizes to 1024 anyway)
LOGIT_STEP = 0.25      # logits are sent as int8 in units of this (SAM's masks swing about +-10: +-31.75 covers them)
MASK_W = 320           # the app's mask width (groups.js MASK_W) when the request does not say
_ATTRS = ("_features", "_orig_hw", "_is_image_set", "_is_batch")   # the embedding SAM2ImagePredictor.set_image leaves on itself
_CACHE = OrderedDict()  # (source, t_ms) -> {attr: value}
_OWNER = [None]         # the predictor the cached embeddings belong to (a dropped / reloaded SAM invalidates them)


def encode_mask(a):
    """float array (h, w) in 0..1 -> {w, h, rle}: the groups' run-length encoding, 15 levels (groups.js encodeMask)."""
    h, w = a.shape
    q = np.rint(np.clip(a, 0, 1).ravel() * LEVELS).astype(np.int64)
    if not len(q):
        return {"w": w, "h": h, "rle": []}
    cut = np.flatnonzero(np.diff(q)) + 1
    starts = np.r_[0, cut]
    runs = np.diff(np.r_[starts, len(q)])
    rle = np.stack([q[starts], runs], 1).ravel().tolist()
    return {"w": w, "h": h, "rle": rle}


def decode_mask(e):
    """{w, h, rle} -> float32 (h, w) in 0..1."""
    a = np.zeros(e["w"] * e["h"], np.float32)
    i = 0
    rle = e.get("rle") or []
    for k in range(0, len(rle) - 1, 2):
        n = int(rle[k + 1])
        a[i:i + n] = rle[k] / LEVELS
        i += n
    return a.reshape(e["h"], e["w"])


def _embed(pred, key, load):
    """Make `pred` hold the embedding of frame `key` (load() -> RGB uint8 array, only called on a miss). -> hit?"""
    if _OWNER[0] is not pred:
        _CACHE.clear()
        _OWNER[0] = pred
    if key in _CACHE:
        _CACHE.move_to_end(key)
        for k, v in _CACHE[key].items():
            setattr(pred, k, v)
        return True
    pred.set_image(load())
    _CACHE[key] = {k: getattr(pred, k) for k in _ATTRS if hasattr(pred, k)}
    while len(_CACHE) > CACHE_MAX:
        _CACHE.popitem(last=False)
    return False


def _frame(req):
    """-> (source key, loader returning an RGB uint8 array)."""
    import cv2
    if req.get("image"):
        path = str(req["image"])

        def load():
            buf = np.fromfile(path, np.uint8)
            img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
            if img is None:
                raise ValueError(f"cannot decode the image {path!r}")
            return _fit(img)
        return (path, 0), load
    video, t = req.get("video"), req.get("t_ms")
    if not video or t is None:
        raise ValueError("segment needs an image path, or a video and t_ms")
    t = int(round(t))
    from pawtrack.frames import grab
    return (str(video), t), (lambda: _fit(grab(video, [t])[0]))


def _fit(bgr):
    import cv2
    h, w = bgr.shape[:2]
    if max(h, w) > MAX_SIDE:
        s = MAX_SIDE / max(h, w)
        bgr = cv2.resize(bgr, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)


def cmd_segment(req, emit, predictor=None):
    """v4.25: {video, t_ms | image, pos: [[x, y]...], neg: [[x, y]...]?, box: [x0, y0, x1, y1]?, mask: {w, h, rle}?, single: bool? (v4.35: ONE mask, SAM's multimask off), logits: bool? (v4.35: each mask also carries SAM's 256 x 256 low-res logits), mask_w?}
    (all 0..1 of the frame) -> {frame_wh, mask_wh, masks: [{mask: {w, h, rle}, score, area}] (smallest area first; `area` the
    share of the frame), cached (the embedding was kept), ms: {embed, decode}}. `predictor`: tests pass a fake."""
    import cv2
    pos = [[float(x), float(y)] for x, y in req.get("pos") or []]
    neg = [[float(x), float(y)] for x, y in req.get("neg") or []]
    box = req.get("box")
    if not pos and not box:
        raise ValueError("segment needs at least one positive point or a box")
    key, load = _frame(req)
    if predictor is None:
        from pawtrack import partlabel, vram
        if not partlabel.sam_ready():
            raise RuntimeError("segment needs SAM 2 (the sam2 extra, its checkpoint on disk and a CUDA GPU)")
        vram.cap("sam_image", SEG_GB)
        predictor = partlabel._sam()
    t0 = time.perf_counter()
    hit = _embed(predictor, key, load)
    t1 = time.perf_counter()
    h, w = predictor._orig_hw[0]
    pts = np.array(pos + neg, np.float32).reshape(-1, 2) * np.array([w, h], np.float32)
    lab = np.array([1] * len(pos) + [0] * len(neg), np.int32)
    kw = {}
    if len(pts):
        kw.update(point_coords=pts, point_labels=lab)
    if box:
        kw["box"] = np.array([box[0] * w, box[1] * h, box[2] * w, box[3] * h], np.float32)
    if req.get("mask"):   # a prior outline: SAM's 256 x 256 logits input
        m = cv2.resize(decode_mask(req["mask"]), (256, 256), interpolation=cv2.INTER_AREA)
        kw["mask_input"] = ((m - 0.5) * 16)[None].astype(np.float32)
    masks, scores, low = predictor.predict(multimask_output=not req.get("single"), **kw)   # v4.35: several positives / a prior outline = one best mask (SAM's own guidance); a lone point is ambiguous: its three levels
    t2 = time.perf_counter()
    mw = int(req.get("mask_w") or MASK_W)
    mh = max(8, round(mw * h / w))
    out = []
    for k, (m, s) in enumerate(zip(masks, scores)):
        a = cv2.resize(np.asarray(m, np.float32), (mw, mh), interpolation=cv2.INTER_AREA)
        o = {"mask": encode_mask(a), "score": round(float(s), 4), "area": round(float((a >= 0.5).mean()), 5)}
        if req.get("logits"):   # v4.35: SAM's own low-res logits of this answer (the app's loosen / tighten dial thresholds them lower / higher)
            q = np.clip(np.rint(np.asarray(low[k], np.float32) / LOGIT_STEP), -127, 127).astype(np.int8)
            o["logits"] = {"w": int(q.shape[1]), "h": int(q.shape[0]), "s": LOGIT_STEP, "b64": base64.b64encode(q.tobytes()).decode("ascii")}
        out.append(o)
    out.sort(key=lambda o: o["area"])
    return {"frame_wh": [int(w), int(h)], "mask_wh": [mw, mh], "masks": out, "cached": bool(hit),
            "ms": {"embed": round(1000 * (t1 - t0), 1), "decode": round(1000 * (t2 - t1), 1)}}
