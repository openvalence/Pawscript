"""Per-shot content tagger: RedRocket Hydra 3.5 (successor of JTP-3, e621 tags, SigLIP2-so400m NaFlex).

describe(video, start_ms, end_ms, params, emit_progress) -> {"tags": [{"tag","score","box"}], "summary": {...}, ...}

Model code + weights are fetched once from huggingface.co/RedRocket/Hydra (Apache-2.0) at a pinned
revision into trackers/.models/hydra/ (must be gitignored) and imported from there. Heavy deps
(torch, pyvips, einops, safetensors) are imported lazily, so importing this module stays cheap.

Boxes come from the model's own CAM (as in upstream gui.pyw): gradient of the tag logit w.r.t. the
final per-patch SigLIP features, dotted with sign(features). One value per 16x16 px patch of the
~512x512-equivalent model input (e.g. 42x24 patches for 16:9 at seqlen 1024), so boxes are coarse.
"""
import hashlib
import os
import sys
import urllib.request
from pathlib import Path

from pawtrack import MODELS_DIR
from pawtrack.registry import param

REPO = "RedRocket/Hydra"  # formerly RedRocket/JTP-3 (that URL redirects here)
REVISION = "cfa9b0a1ffcf2b8df8553be7673210fd60fba23b"
WEIGHTS = "models/hydra-3.5.safetensors"
WEIGHTS_SHA256 = "5e9337c21019c51f2bb5b33d053ea3e2c0412e5ca972b5ea3c4c21e6987452ca"
CODE = [f"hydra/{m}.py" for m in ("__init__", "classification", "cufork", "glu", "head", "image",
                                  "label", "model", "pool", "siglip2")]
MODEL_DIR = MODELS_DIR / ".models" / "hydra"  # or the app's models folder (paw-cdot)

PARAMS = [
    param("frames", "Frames sampled", "int", 5, 1, 32),
    # Raw scores are not comparable across tags (noise gets 0.5+ on many species), so tags use the
    # model's per-tag thresholds calibrated on its embedded validation data, exactly like upstream's
    # GUI slider: 0 = speculative (F4), 0.5 = F1 (upstream default), 1 = confident (F0.25).
    param("confidence", "Tag confidence (0 = more tags, 1 = fewer)", "float", 0.5, 0.0, 1.0),
    param("box_thresh", "Box: heatmap level (x max)", "float", 0.5, 0.1, 0.95),
    param("seqlen", "Model patches (CAM detail vs. speed)", "int", 1024, 256, 2048),
    param("localize", "Compute boxes", "bool", True),
]

# --- rule table: real Hydra 3.5 tag names. Edit by hand. -------------------------------------
COUNT = {"solo": "solo", "duo": "duo", "trio": "trio", "group": "group"}
RATING = ["safe", "questionable", "explicit"]
ACTS = [
    "sex", "penetration", "anal", "anal_penetration", "vaginal", "vaginal_penetration", "oral",
    "oral_penetration", "fellatio", "deep_throat", "irrumatio", "cunnilingus", "rimming", "ball_lick",
    "penis_lick", "double_penetration", "spitroast", "handjob", "footjob", "tailjob", "titfuck",
    "thigh_sex", "frottage", "grinding", "tribadism", "humping", "masturbation", "fingering",
    "anal_fingering", "vaginal_fingering", "fisting", "knotting", "anal_knotting", "vaginal_knotting",
    "oral_knotting", "dildo_insertion", "sex_toy_insertion", "kissing", "licking", "thrusting",
]
POSITIONS = [
    "from_behind_position", "doggystyle", "standing_doggystyle", "missionary_position",
    "reverse_missionary_position", "cowgirl_position", "reverse_cowgirl_position", "mating_press",
    "prone_bone_position", "spoon_position", "stand_and_carry_position",
    "reverse_stand_and_carry_position", "amazon_position", "piledriver_position", "69_position",
    "kneeling_oral_position", "facesitting", "knot_sitting", "dildo_sitting", "standing_sex",
    "all_fours", "bent_over", "on_back", "on_front", "on_top", "riding",
]
VIEWS = ["side_view", "front_view", "rear_view", "high-angle_view", "low-angle_view", "close-up",
         "genital_close-up", "x-ray_view", "internal", "penetrating_pov", "receiving_pov"]
PARTS = [
    "penis", "knot", "knotted_penis", "sheath", "balls", "vulva", "anus", "cloaca", "genital_slit",
    "butt", "breasts", "nipples", "tongue", "open_mouth", "tail", "paws", "hindpaw", "pawpads",
    "feet", "hooves", "canine_penis", "equine_penis", "feline_penis", "humanoid_penis",
    "tapering_penis", "flared_penis",
]
KNOT = ["knot", "knotted_penis", "knotting", "anal_knotting", "vaginal_knotting", "oral_knotting",
        "knot_sitting", "big_knot", "huge_knot", "imminent_knotting", "knot_hanging", "knotted_dildo"]
# Tags that get a CAM box by default (others: box None).
LOCALIZABLE = frozenset(ACTS + PARTS + KNOT + ["internal", "x-ray_view", "bulge"]) - {"sex"}
# ---------------------------------------------------------------------------------------------

_MODEL = None


def _download(rel, sha256=None):
    dst = MODEL_DIR / rel
    if dst.exists():
        return
    url = f"https://huggingface.co/{REPO}/resolve/{REVISION}/{rel}"
    print(f"pawtrack.describe: downloading {url}", file=sys.stderr)
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp, h = dst.with_suffix(dst.suffix + ".part"), hashlib.sha256()
    with urllib.request.urlopen(url) as r, open(tmp, "wb") as f:
        while chunk := r.read(1 << 22):
            h.update(chunk)
            f.write(chunk)
    if sha256 and h.hexdigest() != sha256:
        tmp.unlink()
        raise RuntimeError(f"checksum mismatch for {rel}")
    os.replace(tmp, dst)


def _forget():
    global _MODEL
    _MODEL = None


def load(device="cuda", gb=3):
    """Hydra model on device (cached per process). Downloads ~1.1 GB on first use. gb: this job's VRAM need for it
    (describe 3 GB; partlabel / the seeder ask for HYDRA_GB beside a tracker); counted every job (pawtrack/vram.py)."""
    global _MODEL
    from pawtrack import vram
    vram.cap("hydra", gb)
    if _MODEL is not None:
        return _MODEL
    if not (MODEL_DIR / WEIGHTS).exists():
        print(f"pawtrack.describe: first run, fetching Hydra 3.5 (https://huggingface.co/{REPO}, "
              "Apache-2.0; base google/siglip2-so400m-patch16-naflex, Apache-2.0) "
              f"into {MODEL_DIR}", file=sys.stderr)
    from pawtrack.progress import sub
    with sub("tagger"):  # v4.43: a track's first tagger load names itself (~4.5 s: code import + 1 GB of weights)
        for rel in CODE:
            _download(rel)
        _download(WEIGHTS, WEIGHTS_SHA256)
        sys.path.insert(0, str(MODEL_DIR))
        try:
            from hydra.model import load_model
        finally:
            sys.path.remove(str(MODEL_DIR))
        with vram.loading("hydra", _forget):
            m = load_model(str(MODEL_DIR / WEIGHTS)).to(device)
            m.index = {l.label: i for i, l in enumerate(m.labels)}
            _MODEL = m
    return m


def thresholds(m, confidence):
    """Per-tag thresholds (ndarray, len(m.labels)) for the upstream confidence slider. Tags without
    validation data get inf (never reported)."""
    import numpy as np
    from hydra import simple_slider
    cache = m.__dict__.setdefault("_thr", {})
    if confidence not in cache:
        thr = np.array(m.calibrate(simple_slider(confidence)).as_thresholds(), np.float32)
        cache[confidence] = np.where(np.isnan(thr), np.inf, thr)
    return cache[confidence]


def _features(m, bgr, seqlen):
    """BGR frame -> (features [1,S,1152] bf16, valid, (ph, pw) patch grid). Upstream preprocessing."""
    import pyvips
    import torch
    from hydra import image
    from hydra.model import open_image
    img = pyvips.Image.new_from_array(bgr[..., ::-1].copy(), interpretation="srgb")
    t = image.as_tensor(open_image(img, m.image_config, seqlen))
    patches, sizes = image.stack([t], 16, seqlen, device=m.embeds.proj.weight.device)
    with torch.no_grad():
        f = m.forward_features(m.from_srgb(patches), sizes)
    return f["features"], f["valid"], (t.shape[0] // 16, t.shape[1] // 16)


def _cams(m, feats, valid, grid, tags):
    """{tag: positive CAM (ph, pw) float32 ndarray}. One small head pass over just these tags."""
    import torch
    if not tags:
        return {}
    ph, pw = grid
    m.select_labels(tags)  # restricts class-dim params to `tags`, in m.labels order
    order = [l.label for l in m.labels if l.label in set(tags)]
    m.head.logit = True
    try:
        x = feats.detach().requires_grad_(True)
        with torch.enable_grad():
            logits = m.forward_head(x, valid)[0]
            out = {}
            for i, tag in enumerate(order):
                g, = torch.autograd.grad(logits[i], x, retain_graph=i < len(order) - 1)
                cam = torch.linalg.vecdot(g[0, :ph * pw], x.detach()[0, :ph * pw].sign()).float()
                out[tag] = cam.clamp(min=0).reshape(ph, pw).cpu().numpy()
    finally:
        m.select_labels(None)
        m.head.logit = False
    return out


def cam_box(cam, rel=0.5, pad=1):
    """Heatmap (ph, pw) -> normalized [x, y, w, h] of the blob >= rel*max that holds the peak,
    padded by `pad` patches; None if the map is empty.
    The raw CAM is speckled and often peaks on a lone background/edge patch (ViT artifact token,
    e.g. the same cell for "blue_eyes" on unrelated images), so it is 3x3-blurred first: a lone
    patch then loses to a coherent region. Peak blob, not largest: the largest is often diffuse
    background evidence."""
    import cv2
    import numpy as np
    cam = cv2.blur(np.asarray(cam, np.float32), (3, 3))
    if cam.max() <= 0:
        return None
    ph, pw = cam.shape
    _, lab, st, _ = cv2.connectedComponentsWithStats((cam >= rel * cam.max()).astype(np.uint8), connectivity=8)
    x, y, w, h, _ = st[lab.flat[cam.argmax()]]
    x0, y0 = max(0, x - pad), max(0, y - pad)
    x1, y1 = min(pw, x + w + pad), min(ph, y + h + pad)
    return [round(x0 / pw, 4), round(y0 / ph, 4), round((x1 - x0) / pw, 4), round((y1 - y0) / ph, 4)]


def _closure(m, tag, seen=None):
    seen = set() if seen is None else seen
    lab = m.labels[m.index[tag]] if tag in m.index else None
    for t in (lab.implies if lab else ()):
        if t not in seen:
            seen.add(t)
            _closure(m, t, seen)
    return seen


def summarize(m, scores, on):
    """Rule table over aggregated scores {tag: p} and the set of tags that passed -> summary dict."""
    pick = lambda lst: [t for t in sorted(lst, key=lambda t: -scores.get(t, 0)) if t in on]
    counts = pick(COUNT)
    species = [t for t in on if m.labels[m.index[t]].category == "species"]
    implied = set().union(*(_closure(m, t) for t in species)) if species else set()
    return {
        "count": COUNT[counts[0]] if counts else "unknown",
        "species": pick(set(species) - implied),  # most specific only (wolf, not canine/mammal)
        "acts": pick(ACTS), "positions": pick(POSITIONS), "views": pick(VIEWS),
        "visible_parts": pick(PARTS),
        "knot": any(t in on for t in KNOT),
        "rating": max(RATING, key=lambda t: scores.get(t, 0)),
    }


def describe_frames(frames, params, emit_progress=lambda d, t: None, localize=LOCALIZABLE, keep_maps=False):
    """frames: list of (t_ms, bgr). Same output as describe(); keep_maps adds "heatmaps"
    {tag: ndarray (ph, pw)} (mean of per-frame max-normalized CAMs; not JSON-serializable)."""
    import numpy as np
    import torch
    m = load()
    thr, total = thresholds(m, params["confidence"]), len(frames)
    probs, maps, per_box = [], {}, []
    for i, (t, bgr) in enumerate(frames):
        feats, valid, grid = _features(m, bgr, params["seqlen"])
        with torch.no_grad():
            p = m.forward_head(feats, valid)[0].float().cpu().numpy()
        probs.append(p)
        boxes = {}
        if params["localize"]:
            want = [l.label for l, s, th in zip(m.labels, p, thr) if s >= th and l.label in localize]
            for tag, cam in _cams(m, feats, valid, grid, want).items():
                boxes[tag] = cam_box(cam, params["box_thresh"])
                if cam.max() > 0:
                    maps.setdefault(tag, []).append(cam / cam.max())
        per_box.append(boxes)
        emit_progress(i + 1, total)
    mean = np.mean(probs, 0)
    keep = [i for i in np.argsort(-mean) if mean[i] >= thr[i]]
    names = [m.labels[i].label for i in keep]
    heat = {t: np.mean(v, 0) for t, v in maps.items()}  # all frames share one grid (same video)
    tags = [{"tag": n, "score": round(float(mean[i]), 4),
             "box": cam_box(heat[n], params["box_thresh"]) if n in heat else None}
            for n, i in zip(names, keep)]
    out = {
        "tags": tags,
        "summary": summarize(m, {n: float(mean[i]) for n, i in zip(names, keep)}, set(names)),
        "per_frame": [{"t_ms": t, "scores": {n: round(float(p[i]), 4) for n, i in zip(names, keep)},
                       "boxes": b} for (t, _), p, b in zip(frames, probs, per_box)],
        "model": f"{REPO}@{REVISION[:8]} hydra-3.5",
    }
    if keep_maps:
        out["heatmaps"] = heat
    return out


def sample_frames(video, start_ms, end_ms, n):
    """n frames at evenly spaced timestamps (centres of n equal slices of the range)."""
    from pawtrack.video import open_frames
    # ponytail: decodes every frame in the range; fine for shots, seek per sample if ranges get long
    targets = [start_ms + (k + 0.5) * (end_ms - start_ms) / n for k in range(n)]
    out = []
    _, frames = open_frames(video, start_ms, end_ms)
    for t, bgr in frames:
        while len(out) < n and t >= targets[len(out)]:
            out.append((t, bgr))
        if len(out) == n:
            break
    if not out:
        raise ValueError("no decodable frames in range")
    return out


def describe(video: str, start_ms: int, end_ms: int, params: dict, emit_progress) -> dict:
    from pawtrack.registry import coerce
    p = coerce(PARAMS, params)
    frames = sample_frames(video, int(start_ms), int(end_ms), p["frames"])
    return describe_frames(frames, p, emit_progress)


# --- v4.49 grid describe (paw-2lp7.3): tag frames on a time grid; the app builds action ranges from the samples ---------
GRID_STEP = 12    # frames between samples (0.5 s at 24 fps)
GRID_FLOOR = 0.2  # lowest score returned (the app's hysteresis needs the scores under the on-threshold)
GRID_BATCH = 2    # frames per tagger pass: each more frame costs ~0.47 GB at seqlen 1024 for ~3 % speed (RESULTS.md); 2 fits the 3 GB describe child
GRID_CHUNK = 64   # frames decoded per pass over the file (memory: 64 frames at the tagger's input size)


def frame_times(video):
    """Every frame's start (ms) on open_frames' rebased PTS clock, sorted. Demux only (no decode)."""
    import av
    with av.open(str(video)) as c:
        s = c.streams.video[0]
        t0_us = c.start_time or 0
        return sorted({round(float(p.pts * s.time_base) * 1000 - t0_us / 1000) for p in c.demux(s) if p.pts is not None})


def grid_plan(ts, step, shots=None, start_ms=0, end_ms=None):
    """Indices into ts (sorted frame starts, ms) to tag: every `step`-th frame of each shot counted from its first frame
    (a cut is a sample boundary), plus its first, middle and last frame (a short shot keeps 3 samples). shots: [[start_ms,
    end_ms], ...] or None (the span is one shot); a stretch no shot covers is a shot of its own. Frames in [start_ms,
    end_ms) only (end_ms None = to the end)."""
    import bisect
    lo = bisect.bisect_left(ts, start_ms or 0)
    hi = len(ts) if end_ms is None else bisect.bisect_left(ts, end_ms)
    if hi <= lo:
        return []
    cuts = {lo, hi}
    for a, b in shots or ():
        for t in (a, b):
            k = bisect.bisect_left(ts, t)
            if lo < k < hi:
                cuts.add(k)
    cuts, out = sorted(cuts), set()
    for a, b in zip(cuts, cuts[1:]):  # the frames [a, b) of one shot
        out.update(range(a, b, max(1, int(step))))
        out.update((a, (a + b - 1) // 2, b - 1))
    return sorted(out)


def _probs(m, bgrs, seqlen):
    """[bgr] (one video: one size) -> ndarray (len, labels) of tag probabilities, one batched pass."""
    import pyvips
    import torch
    from hydra import image
    from hydra.model import open_image
    ts = [image.as_tensor(open_image(pyvips.Image.new_from_array(b[..., ::-1].copy(), interpretation="srgb"), m.image_config, seqlen))
          for b in bgrs]
    patches, sizes = image.stack(ts, 16, seqlen, device=m.embeds.proj.weight.device)
    with torch.no_grad():
        f = m.forward_features(m.from_srgb(patches), sizes)
        return m.forward_head(f["features"], f["valid"]).float().cpu().numpy()


def _wanted(names, only):
    """Label mask: every label, or those matching `only` (patterns as the app's vocabulary writes them: 'x*' prefix,
    '*x' suffix, else exact)."""
    import numpy as np
    if not only:
        return np.ones(len(names), bool)
    hit = lambda p, n: n.startswith(p[:-1]) if p.endswith("*") else n.endswith(p[1:]) if p.startswith("*") else n == p
    return np.array([any(hit(p, n) for p in only) for n in names])


def check_grid(grid):
    """ValueError unless grid is a well-formed v4.49 request part."""
    num = lambda x: isinstance(x, (int, float)) and not isinstance(x, bool)
    ok = isinstance(grid, dict)
    times, shots = (grid.get("times"), grid.get("shots")) if ok else (None, None)
    ok = ok and (times is None or (isinstance(times, list) and times and all(map(num, times))))
    ok = ok and (shots is None or (isinstance(shots, list) and all(isinstance(s, list) and len(s) == 2 and all(map(num, s)) and s[1] > s[0] for s in shots)))
    ok = ok and all(grid.get(k) is None or num(grid[k]) for k in ("step", "start_ms", "end_ms", "floor", "batch", "width"))
    ok = ok and (grid.get("only") is None or (isinstance(grid["only"], list) and all(isinstance(x, str) for x in grid["only"])))
    if not ok:
        raise ValueError("grid: {step?, start_ms?, end_ms?, shots?: [[start_ms, end_ms], ...], times?: [ms, ...], floor?, batch?, only?: [name patterns]}")


def describe_grid(video, grid, params, emit=lambda e: None, tagger=None):
    """PROTOCOL v4.49: the tagger on frames sampled across a span (grid_plan), or on exact frames (`times`: the app's edge
    refinement). grid: {step?, start_ms?, end_ms?, shots?, times?, floor?, batch?, only?}. Streams {"type": "samples",
    "samples": [...]} per batch and progress (stage "grid"). tagger: (label names, [bgr] -> (len, labels) probabilities)
    (tests stub it; default: Hydra). -> {"samples": [{"t_ms", "frame", "tags": {name: score >= floor}}], "step", "frames" (in the video),
    "thresholds": {name: the confidence slider's per-tag threshold, for every name returned}, "model", "timing", "vram_mib"}."""
    import bisect
    import time
    import numpy as np
    from pawtrack.frames import grab
    from pawtrack.registry import coerce
    check_grid(grid)
    p = coerce(PARAMS, params)
    step = int(grid.get("step") or GRID_STEP)
    floor, batch = float(grid.get("floor", GRID_FLOOR)), max(1, int(grid.get("batch") or GRID_BATCH))
    ts = frame_times(video)
    if not ts:
        raise ValueError("no video frames")
    if grid.get("times") is not None:  # each time -> the frame showing at it (the frame at or before it)
        idx = sorted({max(0, bisect.bisect_right(ts, float(t)) - 1) for t in grid["times"]})
    else:
        idx = grid_plan(ts, step, grid.get("shots"), grid.get("start_ms") or 0, grid.get("end_ms"))
    torch = None
    if tagger is None:
        import torch
        m = load()
        names, thr = [l.label for l in m.labels], thresholds(m, p["confidence"])
        tag = lambda bgrs: _probs(m, bgrs, p["seqlen"])
        model = f"{REPO}@{REVISION[:8]} hydra-3.5"
        if torch.cuda.is_available():
            torch.cuda.reset_peak_memory_stats()
    else:
        names, tag = tagger
        thr, model = np.full(len(names), 0.5), "stub"
    keep = _wanted(names, grid.get("only"))
    width = grid.get("width")  # decode size: default twice the tagger's input width (its own resize does the last step)
    if width is None and "hydra.model" in sys.modules:  # the tagger is loaded (a stub tagger: full size)
        import av
        from hydra.model import get_image_size_for_seq
        with av.open(str(video)) as c:
            cc = c.streams.video[0].codec_context
            width = 2 * get_image_size_for_seq((cc.height, cc.width), 16, p["seqlen"])[1]
    samples, seen, t_dec, t_tag, t0 = [], set(), 0.0, 0.0, time.perf_counter()
    emit({"type": "progress", "done": 0, "total": len(idx), "stage": "grid"})
    for c in range(0, len(idx), GRID_CHUNK):
        part = idx[c:c + GRID_CHUNK]
        a = time.perf_counter()
        frames = grab(video, [ts[i] for i in part], width)
        t_dec += time.perf_counter() - a
        for b in range(0, len(part), batch):
            a = time.perf_counter()
            P = np.asarray(tag(frames[b:b + batch]))
            t_tag += time.perf_counter() - a
            new = []
            for i, r in zip(part[b:b + batch], P):
                on = np.flatnonzero((r >= floor) & keep)
                seen.update(on.tolist())
                new.append({"t_ms": ts[i], "frame": i, "tags": {names[j]: round(float(r[j]), 3) for j in on}})
            samples += new
            emit({"type": "samples", "samples": new})
            emit({"type": "progress", "done": len(samples), "total": len(idx), "stage": "grid"})
    n = max(1, len(samples))
    return {"samples": samples, "step": step, "frames": len(ts), "model": model,
            "thresholds": {names[j]: round(float(thr[j]), 4) for j in sorted(seen) if np.isfinite(thr[j])},
            "timing": {"decode_ms": round(t_dec * 1000), "tag_ms": round(t_tag * 1000), "wall_ms": round((time.perf_counter() - t0) * 1000),
                       "tag_ms_per_frame": round(t_tag * 1000 / n, 2), "batch": batch, "width": width},
            "vram_mib": round(torch.cuda.max_memory_allocated() / 2**20) if torch is not None and torch.cuda.is_available() else None}


def embed(bgr, box=None, seqlen=1024):
    """Pooled 2048-d image embedding (L2-normalized float32 ndarray) of a frame or a normalized
    [x,y,w,h] crop of it. Upstream's emb_head (extremum pool over unpooled head features)."""
    import torch
    m = load()
    if box is not None:
        H, W = bgr.shape[:2]
        x, y, w, h = box
        bgr = bgr[int(y * H):max(int(y * H) + 1, int((y + h) * H)), int(x * W):max(int(x * W) + 1, int((x + w) * W))]
    feats, valid, _ = _features(m, bgr, seqlen)
    with torch.no_grad():
        e = m.forward_emb_head(feats, valid)[0].float()
    return torch.nn.functional.normalize(e, dim=-1).cpu().numpy()


# v4.40 tag_image: what the labelling workspace's "duos first" order needs from one still, cheaply (one forward pass, no CAMs)
COUNT_TAGS = ("solo", "duo", "trio", "group", "duo_focus", "solo_focus")
GENDERS = frozenset(("male", "female", "intersex", "andromorph", "gynomorph", "herm", "ambiguous", "femboy", "maleherm"))


def count_scores(names, probs, top=6):
    """{tag: p} of the count tags and the best few gender pairings (male/female, male/male, ...) among all labels `names`.
    Raw probabilities, no threshold: the app turns them into a guess."""
    out = {n: round(float(p), 4) for n, p in zip(names, probs) if n in COUNT_TAGS}
    pairs = sorted(((float(p), n) for n, p in zip(names, probs)
                    if "/" in n and set(n.split("/")) <= GENDERS), reverse=True)[:top]
    out.update({n: round(p, 4) for p, n in pairs})
    return out


def tag_image(path, seqlen=512):
    """One still -> {"scores": count_scores(...)}. Smaller seqlen than describe: this runs over thousands of pictures."""
    import torch
    from pawtrack.seeder import read_image
    m = load()
    feats, valid, _ = _features(m, read_image(path, 1000), seqlen)
    with torch.no_grad():
        p = m.forward_head(feats, valid)[0].float().cpu().numpy()
    return {"scores": count_scores([l.label for l in m.labels], p), "model": f"{REPO}@{REVISION[:8]} hydra-3.5"}
