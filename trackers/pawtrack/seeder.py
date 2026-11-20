"""The learned part seeder (paw-bn2, PROTOCOL v4.18): a small part head on the Hydra tagger's own patch features,
trained on the owner's painted groups, for Suggest (partlabel.suggest).

Recipe measured by the seeder probe (experiments/seeder-probe, RESULTS.md: leave-one-video-out part found 0.39 vs the
tag CAM's 0.21): a 1-hidden-layer MLP (1152 -> 256 -> 9 parts, ReLU, dropout 0.2) per 16 px patch, masked BCE with
balanced positives (patch >= 50 % covered by a painted part = positive, partly covered = ignored), AdamW 1e-3 / 1e-4,
batches of 4096 patches, 10 epochs (about 50-70 steps on the probe's 29 frames: short training generalises to a new
video, long training over-fits the training videos' characters). Heat >= 0.5 -> 8-connected blobs, the best 2 per part
(4 for hand / paws) by peak x sqrt(cells); the blob is the outline (no GrabCut / SAM). Parts with fewer than MIN_LABELS
painted examples or from fewer than MIN_VIDEOS videos keep the tag CAM (in the probe the head lost tail / paws with
0-1 examples outside the held-out video and only tied the CAM on balls / hand at 5-10).

Training data: painted groups (source "user" or none; not off, not unassigned, not body / other; never the app's copies on
exact repeats, source "repeat" / "run": the same picture counted again) of the .pawproj files in
the library folders (non-recursive) plus any project paths given, deduplicated on (frame, name) as the probe's
labels.py. Features are cached per frame under <seed_dir>/feats/<video key>_<t_ms>.npz (f16, ~2.3 MB a frame); the
head and its record under <seed_dir>/head.pt / head.json. A retrain with the same labels (fingerprint) is a no-op.
Feature SOURCE (PROTOCOL v4.28, paw-26iv): Hydra's patch features as above (built in), or - when the optional taggerine pack is
installed (pawtrack/taggerine.py) - its layer-22 patch tokens at a long side of ~1024 px (the probe's best variant). Caches are per
source (Hydra keeps <seed_dir>/feats, taggerine <seed_dir>/feats-taggerine-l22-1024), the head records the source it was trained on
and is never used with the other; the fingerprint names a non-Hydra source, so changing source retrains on the next Train.
Ignore regions (PROTOCOL v4.31, paw-855t): a label may mark parts of the picture (an inset crop of another angle) to be ignored: a label
file's `ignore: [mask]`, a .pawproj scene's groups named ignore, ignore2 ... A part painted inside one is still a label (the part wins
inside its own mask; the rest of the region stays ignored). Training: those pixels are filled with the picture's MEAN colour (of the
pixels that stay) BEFORE feature extraction, so the backbone's attention cannot carry the inset into its neighbours, and the patches
they cover (>= IGN_COV) take no part in the loss for any part (target -1, not 0); the feature cache name carries the mask's hash.
Partial labels (PROTOCOL v4.31): "not painted" is NOT "not there" (the owner paints some parts of a picture, not all). A patch under a painted
part is a positive (full weight); a patch under none is a WEAK negative of every part (NEG_WEIGHT of a strong one, after class balancing);
reliable negatives stay strong: a patch under painted part X for the parts that cannot share that spot (partlabel.ON_PART: under a penis
is no negative of a knot or sheath, is one of a head), every patch of a "nothing here" picture, every unpainted patch of a picture the owner
marked fully labelled (`complete: true` in its label file). Ignore regions weigh 0. NEG_WEIGHT was chosen on the held-out score
(tests/test_seeder_weak.py is the unit test; the real numbers need the owner's labels: Train and read held-out).
Propagated labels (painted masks carried along a run's points) are not used: in the probe they were neutral on a new
video at matched training and lowered found at this recipe's epoch count (more frames = more steps).
"""
import glob
import hashlib
import json
import os
import re
import time
from contextlib import contextmanager

import numpy as np

# the head's classes (PROTOCOL v4.24 added knot, thighs, tongue, stomachbulge, neckbulge: ids as the app's groups.js PARTS, no
# underscore); a part with fewer than MIN_LABELS examples from MIN_VIDEOS sources is simply not used. A stored head.pt with another
# list is stale for training: the fingerprint (which names this list) makes the next seed_train retrain. paw-5r1 added shoulder, forearm,
# shin (appended: new parts only ever go at the end). A stored head trained on an older list whose parts are all still here keeps working
# for the parts it knows (Head.load maps its outputs by name; the new parts are not proposed until a Train has MIN_LABELS of them from
# MIN_VIDEOS sources); a head naming a part this list lacks is stale (None).
PARTS = ["penis", "sheath", "balls", "hips", "head", "hand", "paws", "tail", "torso", "knot", "thighs", "tongue", "stomachbulge", "neckbulge",
         "shoulder", "forearm", "shin"]
PI = {p: i for i, p in enumerate(PARTS)}
MAXN = {"hand": 4, "paws": 4, "thighs": 4, "shoulder": 4, "forearm": 4, "shin": 4}   # blobs kept per part (paired parts: up to two per character)
HIDDEN, EPOCHS, LR, WD, DROPOUT, BATCH = 256, 10, 1e-3, 1e-4, 0.2, 4096
THR = 0.5                       # heat -> blob threshold (fixed before the probe's evaluation)
CONFIDENT = 0.7                 # a blob whose peak heat is below this is tentative (the UI draws it so)
MIN_LABELS, MIN_VIDEOS = 5, 2   # a part the head has fewer painted examples of keeps the tag CAM
MASK_W, LEVELS = 320, 15        # groups.js MASK_W / the stored soft mask's levels
SEQLEN = 1024
NEG_WEIGHT = 0.2                # per-patch weight of a patch under no painted part (unknown, not "no") relative to a reliable negative (1) ...
UNK_FRAC = 1.0                  # ... but their SUMMED weight per part never exceeds this share of that part's positives' (Head.fit): by construction
IGN_COV = 0.3                   # a patch covered this much by an ignore region (outside every painted part) has no target for any part
IGNORE_RE = re.compile(r"^ignore\d*$")
VERSION = 1
HYDRA = {"source": "hydra", "seqlen": SEQLEN}   # the built-in feature source (what every head before v4.28 was trained on)


class FeatureSourceUnavailable(RuntimeError):
    """The wanted feature source could not be loaded here (the callers fall back to Hydra with this message as the note)."""


def source_dir(src):
    """The feature cache folder of a source under the seed dir: Hydra's stays "feats" (old caches stay valid)."""
    return "feats" if src["source"] == "hydra" else "feats-%s-l%d-%d" % (src["source"], src["layer"], src["long_side"])


def pick_source(prefer="auto"):
    """-> (source, note): taggerine when its pack is installed and a CUDA GPU is there (prefer "auto"), else Hydra. prefer "hydra"
    forces Hydra. Nothing is downloaded; "installed" = the weight file exists. note: why Hydra although the pack is there."""
    from pawtrack import taggerine
    if prefer == "hydra" or not taggerine.installed():
        return HYDRA, None
    if not taggerine.ready():
        return HYDRA, "taggerine is installed but needs a CUDA GPU: Hydra features used"
    return dict(taggerine.SOURCE), None


def status(head, prefer="auto"):
    """What the app shows about the feature source: {source, layer?, long_side?, pack (the optional pack is installed), wanted
    (what a Train would use now), stale (the head was trained on another source), note}."""
    from pawtrack import taggerine
    want, note = pick_source(prefer)
    have = head.features if head is not None else want
    return {**have, "pack": taggerine.installed(), "wanted": want["source"], "stale": head is not None and head.features != want,
            **({"note": note} if note else {})}


def usable_head(head, prefer="auto"):
    """-> (head | None, note): a head is used only with the features it was trained on. A taggerine head needs the pack and a GPU
    now (and is not used when Hydra is forced by the setting); otherwise Suggest uses the tagger's CAMs, with the note."""
    if head is None or head.features == HYDRA:
        return head, None
    from pawtrack import taggerine
    if prefer == "hydra":
        return None, "the seeder was trained on taggerine features but Hydra is forced (setting): the tagger's heat is used; Train to retrain it on Hydra"
    if head.features != dict(taggerine.SOURCE) or not taggerine.ready():
        return None, "the seeder was trained on taggerine features that cannot run here now: the tagger's heat is used"
    return head, None


# ------------------------------------------------------------------ labels from projects
def decode_mask(e):
    a = np.zeros(e["w"] * e["h"], np.float32)
    i, r = 0, e["rle"]
    for k in range(0, len(r) - 1, 2):
        a[i:i + r[k + 1]] = r[k] / LEVELS
        i += r[k + 1]
    return a.reshape(e["h"], e["w"])


def _fit(m, shape):
    import cv2
    return m if m.shape == shape else cv2.resize(m.astype(np.uint8), (shape[1], shape[0]), interpolation=cv2.INTER_NEAREST).astype(bool)


def _ignore_mask(g, W, H):
    """A project's ignore group (name ignore, ignore2 ...) -> (h, w) bool at MASK_W, or None when it is empty."""
    from pawtrack.partlabel import poly_mask
    m = g.get("mask")
    mask = decode_mask(m) >= 0.5 if m and m.get("rle") else None
    if (mask is None or not mask.any()) and g.get("poly") and len(g["poly"]) >= 3:
        mask = poly_mask(g["poly"], MASK_W, max(8, round(MASK_W / (W / H))))
    return mask if mask is not None and mask.any() else None


def with_ignore(f, ignore):
    """Frame f with its ignore regions (list of bool masks): `ign_mask` = their union minus every painted part (the part wins inside
    its own mask), at the parts' grid, and `ign` = its short hash (the feature cache's name). No effective region: f unchanged."""
    ignore = [m for m in ignore or [] if m is not None and m.any()]
    if not ignore:
        return f
    shape = f["groups"][0]["mask"].shape if f["groups"] else ignore[0].shape
    u = np.zeros(shape, bool)
    for m in ignore:
        u |= _fit(m, shape)
    for g in f["groups"]:
        u &= ~_fit(g["mask"], shape)
    if not u.any():
        return f
    return {**f, "ign_mask": u, "ign": hashlib.sha1(np.packbits(u).tobytes() + str(u.shape).encode()).hexdigest()[:10]}


def blank(bgr, ign):
    """The picture with the ignore region filled by the MEAN colour of the pixels that stay. Mean, not black: a black hole on a bright
    picture is the strongest edge there is and its neighbours' features would learn it as a "border" cue; the mean is the least
    contrast on average (test_seeder_ignore.py measures both). `ign`: (h, w) bool at any size, or None."""
    if ign is None or not np.asarray(ign).any():
        return bgr
    import cv2
    m = cv2.resize(np.asarray(ign).astype(np.uint8), (bgr.shape[1], bgr.shape[0]), interpolation=cv2.INTER_NEAREST).astype(bool)
    out = bgr.copy()
    out[m] = bgr[~m].mean(0).astype(bgr.dtype) if (~m).any() else 0
    return out


def inside(ign, c):
    """Is the point c (x, y in 0..1) in the ignore region `ign` ((h, w) bool or None)?"""
    if ign is None:
        return False
    h, w = ign.shape
    return bool(ign[min(h - 1, max(0, int(c[1] * h))), min(w - 1, max(0, int(c[0] * w)))])


def request_ignore(masks, shape=None):
    """suggest_groups `ignore` ([{w, h, rle}]) -> the union as one (h, w) bool, or None. Malformed entries are skipped."""
    u = None
    for e in masks or []:
        try:
            m = decode_mask(e) >= 0.5
        except (KeyError, TypeError, ValueError):
            continue
        u = m if u is None else u | _fit(m, u.shape)
    return u if u is not None and u.any() else None


def drop_ignored(groups, ign):
    """Suggested groups (partlabel.suggest's: {poly 0..1, ...}) without those whose polygon's centre lies in the ignore region `ign`."""
    if ign is None:
        return groups
    out = []
    for g in groups:
        p = g.get("poly") or []
        c = (sum(q[0] for q in p) / len(p), sum(q[1] for q in p) / len(p)) if p else None
        if c is None or not inside(ign, c):
            out.append(g)
    return out


def split_name(n):
    m = re.match(r"^(c[12]|x)_([a-z0-9]+?)(?:_([lr]))?\d*$", n or "")
    return (m.group(1), m.group(2), m.group(3)) if m else (None, re.sub(r"\d+$", "", n or ""), None)


def _label_group(g, W, H, skip):
    """One stored group -> {part, who, mask (h, w) bool at MASK_W} when it is a hand-painted training label, else None
    (skip(why) says why: off / unassigned / copied / suggested / other / empty). Shared by project and image labels."""
    from pawtrack.partlabel import poly_mask
    if g.get("off"):
        skip("off")
        return None
    if str(g.get("name", "")).startswith("unassigned") or not isinstance(g.get("t_ms"), (int, float)):
        skip("unassigned")
        return None
    if g.get("source") in ("repeat", "run"):  # paw-8mf4: copied from an exact repeat (the same picture as a painted frame)
        skip("copied")
        return None
    if g.get("source") not in ("user", None):
        skip("suggested")
        return None
    w2, p2, _ = split_name(g.get("name"))
    part, who = g.get("part") or p2, g.get("who") or w2
    if part not in PI:
        skip("other")
        return None
    m = g.get("mask")
    mask = decode_mask(m) >= 0.5 if m and m.get("rle") else None
    if mask is None or not mask.any():
        if not g.get("poly") or len(g["poly"]) < 3:
            skip("empty")
            return None
        mask = poly_mask(g["poly"], MASK_W, max(8, round(MASK_W / (W / H))))
    return {"part": part, "who": who, "mask": mask, **({"auto": True} if g.get("named_by") == "auto" else {})}   # auto: the namer's name, confirmed


def _knot_section(g, lg):
    """paw-k393: a penis group's knot SECTION (g.knot {w, h, rle}, the knot brush since PROTOCOL v4.54) -> [a knot label of the same character]
    (inside the penis' mask), else []. The penis label keeps its whole mask, knot included: the owner's old separate knot labels lay inside
    their penis (most 0.8-1.0 of the knot's pixels), so old and new labels teach both classes the same way."""
    k = g.get("knot")
    if not (isinstance(k, dict) and k.get("rle") and k.get("w") and k.get("h")):
        return []
    m = _fit(decode_mask(k) >= 0.5, lg["mask"].shape) & lg["mask"]
    return [{"part": "knot", "who": lg["who"], "mask": m}] if m.any() else []


def project_labels(path):
    """A .pawproj -> ([{key, video, t, W, H, groups: [{part, who, mask (h, w) bool at MASK_W}]}], skipped counts).
    The probe's labels.py: groups of scenes[] and their offers[], deduplicated on (t_ms, name), user-painted only."""
    d = json.load(open(path, encoding="utf-8"))
    media = d.get("media") or {}
    key = (media.get("hash") or {}).get("value")
    W, H = media.get("width"), media.get("height")
    if not key or not W or not H:
        return [], {"no_media": 1}
    video = media.get("path")
    if not video or not os.path.exists(video):
        rel = media.get("relativePath")
        video = os.path.join(os.path.dirname(path), rel) if rel else video
    raw = []
    for s in d.get("scenes") or []:
        raw += s.get("groups") or []
        for o in s.get("offers") or []:
            raw += o.get("groups") or []
    seen, frames, skipped, ignores = set(), {}, {}, {}
    skip = lambda why: skipped.__setitem__(why, skipped.get(why, 0) + 1)
    for g in raw:
        k = (g.get("t_ms"), g.get("name"))
        if k in seen:
            skip("dup")
            continue
        seen.add(k)
        if IGNORE_RE.match(str(g.get("name", ""))):   # paw-855t: an ignore region of that frame, not a part
            im = _ignore_mask(g, W, H) if not g.get("off") and isinstance(g.get("t_ms"), (int, float)) else None
            if im is not None:
                ignores.setdefault(int(round(g["t_ms"])), []).append(im)
            continue
        lg = _label_group(g, W, H, skip)
        if lg is None:
            continue
        t = int(round(g["t_ms"]))
        f = frames.setdefault(t, {"key": key, "video": video, "t": t, "W": W, "H": H, "groups": []})
        f["groups"] += [lg] + _knot_section(g, lg)
    return [with_ignore(frames[t], ignores.get(t)) for t in sorted(frames)], skipped


def image_labels(labels_dir):
    """The third label source (PROTOCOL v4.24, paw-714j): the app's still-image labels, <labels_dir>/<key>.json
    ({image, key, w, h, groups: [the .pawproj group encoding], none?}). Each labelled image is ONE frame of its own source
    (its label key: it counts as its own "video" for the MIN_VIDEOS rule), t 0, its mask targets exactly as a project frame's.
    `none` ("nothing to label here") is a frame with no parts: every patch a negative (Head.fit needs no change for that).
    An image that no longer exists is skipped (counted under "missing"); so is one whose groups are all unusable (unassigned,
    body / other ...: not known to be free of parts) and a broken file. -> ([frame], {skipped counts, "none": n})."""
    frames, skipped = [], {}
    skip = lambda why: skipped.__setitem__(why, skipped.get(why, 0) + 1)
    for fn in sorted(glob.glob(os.path.join(labels_dir, "*.json"))) if labels_dir and os.path.isdir(labels_dir) else []:
        try:
            d = json.load(open(fn, encoding="utf-8"))
            key, image, W, H = d["key"], d["image"], int(d["w"]), int(d["h"])
        except (OSError, ValueError, KeyError, TypeError):
            skip("broken")
            continue
        if not os.path.isfile(image):
            skip("missing")
            continue
        groups, seen = [], set()
        for g in d.get("groups") or []:
            if g.get("name") in seen:
                skip("dup")
                continue
            seen.add(g.get("name"))
            lg = _label_group({**g, "t_ms": 0}, W, H, skip)
            if lg is not None:
                groups += [lg] + _knot_section(g, lg)
        if d.get("none") and not groups:
            skipped["none"] = skipped.get("none", 0) + 1
        elif not groups:
            skip("no_parts")
            continue
        ign = [decode_mask(m) >= 0.5 for m in d.get("ignore") or [] if isinstance(m, dict) and m.get("rle") and m.get("w") and m.get("h")]
        frames.append(with_ignore({"key": key, "video": image, "t": 0, "W": W, "H": H, "groups": groups, "image": True, **({"complete": True} if d.get("complete") is True else {})}, ign))
    return frames, skipped


def library(folders=(), projects=()):
    """Project paths: the *.pawproj in each folder (not recursive) and the given ones, each once (case-insensitive)."""
    out, seen = [], set()
    for p in [q for f in folders or () if f and os.path.isdir(f) for q in sorted(glob.glob(os.path.join(f, "*.pawproj")))] + list(projects or ()):
        k = os.path.normcase(os.path.abspath(p))
        if k not in seen and os.path.isfile(p):
            seen.add(k)
            out.append(p)
    return out


def gather(folders=(), projects=(), labels=None):
    """-> (frames over every library project plus the image labels in `labels`, {project: {frames, groups} | {error},
    "labels": {frames, groups, ...} when a labels folder was given})."""
    frames, per = {}, {}
    for p in library(folders, projects):
        try:
            fr, sk = project_labels(p)
        except Exception as e:  # one broken file never stops the rest
            per[p] = {"error": f"{type(e).__name__}: {e}"}
            continue
        for f in fr:  # the same video in two projects: one frame per (video, t), the later project's groups win
            frames[(f["key"], f["t"])] = f
        per[p] = {"frames": len(fr), "groups": sum(len(f["groups"]) for f in fr), **({"skipped": sk} if sk else {})}
    if labels:
        fr, sk = image_labels(labels)
        for f in fr:
            frames[(f["key"], f["t"])] = f
        per["labels"] = {"frames": len(fr), "groups": sum(len(f["groups"]) for f in fr), **({"skipped": sk} if sk else {})}
    return [frames[k] for k in sorted(frames)], per


def fingerprint(frames, src=HYDRA):
    h = hashlib.sha1(("v%s|%s|%s|%s|neg%s" % (VERSION, HIDDEN, EPOCHS, ",".join(PARTS), NEG_WEIGHT)).encode())
    if src["source"] != "hydra":   # a Hydra head keeps its v4.18 fingerprint (no needless retrain for those who never install the pack)
        h.update(("|" + json.dumps(src, sort_keys=True)).encode())
    for f in frames:
        h.update(f"{f['key']}|{f['t']}".encode())
        for g in sorted(f["groups"], key=lambda g: (g["part"], str(g["who"]), g["mask"].tobytes())):
            h.update(f"{g['part']}|{g['who']}".encode())
            h.update(np.packbits(g["mask"]).tobytes())
        if f.get("complete"):
            h.update(b"|complete")
        if f.get("ign"):   # a frame without ignore regions keeps the fingerprint it had (no needless retrain)
            h.update(f"|ign|{f['ign']}".encode())
    return h.hexdigest()


# ------------------------------------------------------------------ features
def feat_file(seed_dir, key, t, src=HYDRA, ign=""):
    """A frame's feature file; `ign` (with_ignore's hash) in the name: blanked pixels are another picture, so a changed region is new features."""
    return os.path.join(seed_dir, source_dir(src), f"{re.sub(r'[^A-Za-z0-9_.-]', '_', key)}_{int(t)}{'_i' + ign if ign else ''}.npz")


def frame_features(D, m, bgr):
    """The tagger's dense patch features of one frame -> (f (S, 1152) float16, (ph, pw), tag logits model output)."""
    import torch
    f, valid, grid = D._features(m, bgr, SEQLEN)
    with torch.no_grad():
        p = m.forward_head(f, valid)[0].float().cpu().numpy()
    return f[0, :grid[0] * grid[1]].float().cpu().numpy().astype(np.float16), tuple(int(a) for a in grid), p, (f, valid)


def head_features(head, bgr):
    """(f, grid) of one picture in the feature source `head` was trained on (a non-Hydra head: the optional pack, on the GPU)."""
    if head.features["source"] == "hydra":
        raise ValueError("a Hydra head takes the tagger's own pass (frame_features)")
    from pawtrack import taggerine
    return taggerine.features(bgr)


def read_image(path, width=None):
    """A still as BGR (any path, EXIF turn applied: what the labelling workspace showed), scaled to `width` when wider."""
    import cv2
    try:
        bgr = cv2.imdecode(np.fromfile(path, np.uint8), cv2.IMREAD_COLOR)
    except OSError as e:
        raise ValueError(f"cannot read {path}: {e}")
    if bgr is None:
        raise ValueError(f"cannot decode {path}")
    if width and bgr.shape[1] > width:
        bgr = cv2.resize(bgr, (width, round(bgr.shape[0] * width / bgr.shape[1])), interpolation=cv2.INTER_AREA)
    return bgr


@contextmanager
def _extractor(src, emit, total, device=None):
    """The per-picture feature function of a source: yields feat(bgr) -> (f (S, D) float16, (ph, pw)). Hydra: the tagger (CUDA in
    the app; `device` "cpu" for scripts). taggerine: the optional pack's backbone, resident through vram.py; any failure to load it
    is a FeatureSourceUnavailable (the caller falls back to Hydra)."""
    if src["source"] == "hydra":
        from pawtrack import partlabel
        with partlabel._tagger_modules() as D:
            if D._MODEL is None:
                emit({"type": "progress", "done": 0, "total": total, "stage": "model load"})
            m = D.load(gb=partlabel.HYDRA_GB) if device is None else D.load(device=device)
            yield lambda bgr: frame_features(D, m, bgr)[:2]
        return
    from pawtrack import taggerine
    if "m" not in taggerine._MODEL:
        emit({"type": "progress", "done": 0, "total": total, "stage": "model load"})
    try:
        m = taggerine.load()
    except Exception as e:
        raise FeatureSourceUnavailable(f"taggerine could not be loaded ({str(e).splitlines()[0] if str(e) else type(e).__name__})")
    yield lambda bgr: taggerine.features(bgr, m)


def ensure_features(seed_dir, frames, emit=lambda e: None, device=None, src=HYDRA):
    """Features of every frame not cached yet, from feature source `src` (-> computed count)."""
    todo = [f for f in frames if not os.path.exists(feat_file(seed_dir, f["key"], f["t"], src, f.get("ign", "")))]
    if not todo:
        return 0
    from pawtrack.frames import grab
    os.makedirs(os.path.join(seed_dir, source_dir(src)), exist_ok=True)
    by = {}
    for f in todo:
        by.setdefault(f["video"], []).append(f)
    n = 0
    with _extractor(src, emit, len(todo), device) as feat:
        for video, fs in by.items():
            if not video or not os.path.exists(video):
                n += len(fs)  # its frames are skipped (counted as done); the record names the missing video
                continue
            wide = 1920 if fs[0]["W"] > 1920 else None
            if fs[0].get("image"):  # a still: one frame per file; an undecodable one is skipped (its features stay missing)
                try:
                    grabbed = [read_image(video, wide)]
                except ValueError:
                    n += len(fs)
                    continue
            else:
                grabbed = grab(video, [f["t"] for f in fs], width=wide)
            for f, bgr in zip(fs, grabbed):
                fe, grid = feat(blank(bgr, f.get("ign_mask")))   # paw-855t: ignore regions blanked BEFORE the backbone sees the picture
                fn = feat_file(seed_dir, f["key"], f["t"], src, f.get("ign", ""))
                np.savez(fn + ".tmp.npz", f=fe, grid=np.array(grid))
                os.replace(fn + ".tmp.npz", fn)
                n += 1
                emit({"type": "progress", "done": n, "total": len(todo), "stage": "features"})
    return n


def load_features(seed_dir, key, t, src=HYDRA, ign=""):
    fn = feat_file(seed_dir, key, t, src, ign)
    if not os.path.exists(fn):
        return None
    z = np.load(fn)
    return z["f"], tuple(int(a) for a in z["grid"])


def targets(groups, grid, ign=None):
    """(S, K) float32 in {1 pos, 0 neg, -1 ignore}: positive = patch covered >= 0.5 by the part, partial cover ignored.
    ign (with_ignore's ign_mask): a patch covered >= IGN_COV by an ignore region has -1 for every part it is not a positive of
    (no loss at all: neither a positive nor a negative of anything); a part painted inside the region stays a positive."""
    import cv2
    ph, pw = grid
    cov = np.zeros((ph, pw, len(PARTS)), np.float32)
    for g in groups:
        c = cv2.resize(g["mask"].astype(np.float32), (pw, ph), interpolation=cv2.INTER_AREA)
        cov[..., PI[g["part"]]] = np.maximum(cov[..., PI[g["part"]]], c)
    Y = np.zeros_like(cov)
    Y[cov >= 0.5] = 1
    Y[(cov > 0) & (cov < 0.5)] = -1
    if ign is not None and np.asarray(ign).any():
        c = cv2.resize(np.asarray(ign).astype(np.float32), (pw, ph), interpolation=cv2.INTER_AREA)
        Y[(c >= IGN_COV)[..., None] & (Y != 1)] = -1
    return Y.reshape(-1, len(PARTS))


def strong_frame(f):
    """Every unpainted patch of this frame is a reliable negative: a "nothing here" picture (no parts) or one marked fully labelled."""
    return bool(f.get("complete")) or not f["groups"]


def weights(groups, grid, ign=None, strong=False):
    """(S, K) float32 loss weights beside targets(): 0 for ignore (target -1), 1 for a positive or a reliable negative, NEG_WEIGHT for a
    patch that may simply be unpainted. `strong`: the frame's unpainted patches are reliable (strong_frame). A patch under a painted
    part X is a reliable negative only for the parts that cannot share that spot (partlabel.ON_PART either way round).
    Head.fit then balances by TOTAL weight: an unknown patch is capped so the unknown mass of a part is at most UNK_FRAC of its
    positives: thousands of unpainted patches against a few painted ones never add up to predicting nothing."""
    from pawtrack import partlabel
    Y = targets(groups, grid, ign).reshape(grid[0] * grid[1], -1)
    W = np.full(Y.shape, 1.0 if strong else NEG_WEIGHT, np.float32)
    for p in PARTS:
        pos = Y[:, PI[p]] == 1
        if not pos.any():
            continue
        for q in PARTS:
            if q != p and not (partlabel.sits_on(p, q) or partlabel.sits_on(q, p)):
                W[pos, PI[q]] = 1.0
    W[Y == 1] = 1.0
    W[Y < 0] = 0.0
    return W


def region_feature(f, grid, mask):
    """Mean patch feature under a bool mask (any size), L2-normalised (float32)."""
    import cv2
    ph, pw = grid
    c = cv2.resize(np.asarray(mask, np.float32), (pw, ph), interpolation=cv2.INTER_AREA).reshape(-1)
    x = (np.asarray(f, np.float32) * (c / max(float(c.sum()), 1e-6))[:, None]).sum(0)
    return x / max(float(np.linalg.norm(x)), 1e-6)


# ------------------------------------------------------------------ the head
class Head:
    """The MLP and its input normalisation; `use` = the parts it answers for (else the tag CAM)."""

    def __init__(self, net=None, mu=None, sd=None, present=None, use=None, refs=None, info=None, features=None):
        self.net, self.mu, self.sd = net, mu, sd
        self.thr = THR   # the blob threshold: THR, or the one the held-out score calibrated on fully labelled pictures (seedscore.calibrate)
        self.features = dict(features or HYDRA)   # the feature source (and input size) it was trained on: used only with those
        self.present = np.zeros(len(PARTS), bool) if present is None else np.asarray(present, bool)
        self.use = np.zeros(len(PARTS), bool) if use is None else np.asarray(use, bool)
        self.refs, self.info = refs or {}, info or {}

    @staticmethod
    def build(d, k=None):
        import torch
        return torch.nn.Sequential(torch.nn.Linear(d, HIDDEN), torch.nn.ReLU(), torch.nn.Dropout(DROPOUT), torch.nn.Linear(HIDDEN, k or len(PARTS)))

    @classmethod
    def fit(cls, Xs, Ys, seed=0, Ws=None, balance="mass"):
        """Xs: [(S_i, D) float16] (D: 1152 Hydra, 1280 taggerine), Ys: [(S_i, K)] targets. The probe's Lin(256, epochs=10).
        The features stay float16 in memory (a taggerine library of hundreds of pictures is gigabytes in float32); each batch is
        normalised as it is drawn."""
        import torch
        X = torch.from_numpy(np.concatenate([np.asarray(x, np.float16) for x in Xs]))
        Y = torch.from_numpy(np.concatenate(Ys))
        Wt = torch.from_numpy(np.concatenate(Ws)) if Ws is not None else (Y >= 0).float()   # per-patch, per-part loss weights (0 = ignored)
        n0 = len(X)
        s1 = torch.zeros(X.shape[1], dtype=torch.float64)
        s2 = torch.zeros(X.shape[1], dtype=torch.float64)
        for i in range(0, n0, 16384):
            c = X[i:i + 16384].double()
            s1 += c.sum(0)
            s2 += (c * c).sum(0)
        m = s1 / n0
        mu = m.float().numpy()
        sd = ((s2 / n0 - m * m).clamp(min=0).sqrt() + 1e-4).float().numpy()
        mu_t, sd_t = torch.from_numpy(mu), torch.from_numpy(sd)
        torch.manual_seed(seed)
        net = cls.build(X.shape[1])
        pos = (Y == 1).sum(0).float()
        if balance == "mass":
            # per part: the unknown negatives (unpainted, partial picture) share a mass of at most UNK_FRAC x the positives' COUNT, each at
            # most NEG_WEIGHT; pos_weight then balances the positives against ALL negative mass (reliable + that capped unknown mass) as
            # before (~1:1, <= 50x), so the unknown mass is also at most UNK_FRAC of the positives' total weight, however many patches
            unk, rel = (Y == 0) & (Wt < 1), (Y == 0) & (Wt >= 1)
            U = unk.sum(0).float().clamp(min=1)
            u = torch.clamp(UNK_FRAC * pos / U, max=NEG_WEIGHT)
            pw = torch.clamp((rel.sum(0).float() + u * unk.sum(0).float()) / pos.clamp(min=1), 1, 50)
            Wt = torch.where(unk, u.expand_as(Wt), Wt)
        else:   # "patch" (tests only): the naive scheme, every unknown patch at its small weight whatever their number, no class balance
            pw = torch.ones_like(pos)
        opt = torch.optim.AdamW(net.parameters(), LR, weight_decay=WD)
        n = len(X)
        steps = max(EPOCHS, int(EPOCHS * n / BATCH))
        net.train()
        for _ in range(steps):
            b = torch.randint(0, n, (min(BATCH, n),))
            y = Y[b]
            w = Wt[b]
            loss = torch.nn.functional.binary_cross_entropy_with_logits(net((X[b].float() - mu_t) / sd_t), y.clamp(min=0), weight=w, pos_weight=pw, reduction="sum") / w.sum().clamp(min=1)
            opt.zero_grad()
            loss.backward()
            opt.step()
        net.eval()
        return cls(net, mu, sd, (pos > 0).numpy(), info={"steps": steps, "patches": n})

    def heat(self, f, grid):
        """(S, 1152) features -> (ph, pw, K) heat (0 for parts it never saw)."""
        import torch
        with torch.no_grad():
            h = torch.sigmoid(self.net(torch.from_numpy((np.asarray(f, np.float32) - self.mu) / self.sd))).numpy()
        h[:, ~self.present] = 0
        return h.reshape(grid[0], grid[1], len(PARTS))

    def save(self, seed_dir, info):   # info carries the feature source too (head.json); head.pt records it for the stale check
        import torch
        os.makedirs(seed_dir, exist_ok=True)
        fn = os.path.join(seed_dir, "head.pt")
        torch.save({"version": VERSION, "state": self.net.state_dict(), "mu": self.mu, "sd": self.sd, "present": self.present,
                    "use": self.use, "refs": self.refs, "parts": PARTS, "features": self.features}, fn + ".tmp")
        os.replace(fn + ".tmp", fn)
        with open(os.path.join(seed_dir, "head.json.tmp"), "w", encoding="utf-8") as fh:
            json.dump(info, fh, indent=1)
        os.replace(os.path.join(seed_dir, "head.json.tmp"), os.path.join(seed_dir, "head.json"))
        _CACHE.clear()

    @classmethod
    def load(cls, seed_dir):
        """The stored head (cached per file mtime) or None (none trained yet, an older format, or a part list with a part PARTS lacks).
        paw-5r1: a head trained on an older, shorter list keeps answering for its own parts: its output layer is widened to PARTS by name
        (a new part's row: zero weights, bias LOST, sigmoid ~0; not present, not used), so heat() / regions() index PARTS as always."""
        fn = os.path.join(seed_dir or "", "head.pt")
        if not seed_dir or not os.path.exists(fn):
            return None
        mt = (os.path.getmtime(fn), _mtime(os.path.join(seed_dir, "score.json")))   # the score (which carries the calibrated threshold) may arrive later
        if _CACHE.get("key") == (fn, mt):
            return _CACHE["head"]
        import torch
        d = torch.load(fn, map_location="cpu", weights_only=False)
        old = list(d.get("parts") or [])
        if d.get("version") != VERSION or not old or any(p not in PI for p in old) or len(set(old)) != len(old):
            return None
        net = cls.build(len(d["mu"]), len(old))
        try:
            net.load_state_dict(d["state"])
        except RuntimeError:   # weights that do not match the list they name: stale, never a crash
            return None
        if old != PARTS:
            net = _widen(net, old)
            d["present"], d["use"] = (_spread(d[k], old) for k in ("present", "use"))
        net.eval()
        info = {}
        try:
            info = json.load(open(os.path.join(seed_dir, "head.json"), encoding="utf-8"))
        except (OSError, ValueError):
            pass
        h = cls(net, d["mu"], d["sd"], d["present"], d["use"], d.get("refs") or {}, info, d.get("features"))
        from pawtrack import seedscore
        t = (seedscore.cached(seed_dir, info.get("fingerprint")) or {}).get("threshold") or {}
        if t.get("calibrated") and 0.05 < t.get("value", 0) < 0.95:
            h.thr = float(t["value"])
        _CACHE.update(key=(fn, mt), head=h)
        return h


_CACHE = {}
LOST = -30.0   # a widened head's logit for a part it was never trained on (sigmoid ~1e-13)


def _widen(net, old):
    """paw-5r1: a head's output layer over the part list `old` -> one over PARTS, rows placed by name (a new part: zero weights, bias LOST)."""
    import torch
    last = net[-1]
    new = torch.nn.Linear(last.in_features, len(PARTS))
    with torch.no_grad():
        new.weight.zero_()
        new.bias.fill_(LOST)
        for i, p in enumerate(old):
            new.weight[PI[p]] = last.weight[i]
            new.bias[PI[p]] = last.bias[i]
    net[-1] = new
    return net


def _spread(a, old):
    """A per-part bool array over `old` -> over PARTS (False for the parts `old` lacks)."""
    out = np.zeros(len(PARTS), bool)
    for i, p in enumerate(old):
        out[PI[p]] = bool(np.asarray(a)[i])
    return out


def _mtime(fn):
    try:
        return os.path.getmtime(fn)
    except OSError:
        return 0


def usable(frames):
    """Per part: painted examples, videos, and whether the head answers for it (>= MIN_LABELS from >= MIN_VIDEOS)."""
    n = {p: 0 for p in PARTS}
    vids = {p: set() for p in PARTS}
    for f in frames:
        for g in f["groups"]:
            n[g["part"]] += 1
            vids[g["part"]].add(f["key"])
    return {p: {"labels": n[p], "videos": len(vids[p]), "use": n[p] >= MIN_LABELS and len(vids[p]) >= MIN_VIDEOS} for p in PARTS}


def area_prior(frames, min_n=5):
    """paw-4fne: part -> median painted share of the picture over the labels (parts with >= min_n groups): Suggest's size rule (seedsam.fit_size)."""
    a = {}
    for f in frames:
        for g in f["groups"]:
            a.setdefault(g["part"], []).append(float(np.asarray(g["mask"]).mean()))
    return {p: round(float(np.median(v)), 6) for p, v in a.items() if len(v) >= min_n}


def _public(info):
    """head.json minus what only Suggest reads (the seed_train answer stays as PROTOCOL.md describes it)."""
    return {k: v for k, v in info.items() if k != "area"}


def who_refs(frames, feats):
    """Per video: the mean region feature of its painted Bottom and Top groups (naming characters in its other scenes)."""
    acc = {}
    for f in frames:
        F = feats.get((f["key"], f["t"]))
        if F is None:
            continue
        for g in f["groups"]:
            if g["who"] in ("c1", "c2"):
                acc.setdefault(f["key"], {}).setdefault(g["who"], []).append(region_feature(F[0], F[1], g["mask"]))
    out = {}
    for k, d in acc.items():
        if "c1" in d and "c2" in d:
            out[k] = {w: (lambda x: (x / max(float(np.linalg.norm(x)), 1e-6)).astype(np.float32))(np.mean(v, 0)) for w, v in d.items()}
    return out


def load_all(seed_dir, frames, src=HYDRA):
    """{(key, t): (f, grid)} of the frames whose features (of source `src`) are cached."""
    feats = {}
    for f in frames:
        z = load_features(seed_dir, f["key"], f["t"], src, f.get("ign", ""))
        if z is not None:
            feats[(f["key"], f["t"])] = z
    return feats


def held_out(seed_dir, frames, fp, feats=None, budget=None, features=None, src=HYDRA, dataset=None):
    """PROTOCOL v4.27: the held-out score of this label set (pawtrack/seedscore.py), cached by the fingerprint. Never raises."""
    from pawtrack import seedscore
    ds = dataset or seed_dir   # the score (and its trend) belongs to the dataset; the features are shared
    try:
        c = seedscore.cached(ds, fp)
        if c is not None:
            return c
        feats = load_all(seed_dir, frames, src) if feats is None else feats
        return seedscore.run(ds, [f for f in frames if (f["key"], f["t"]) in feats], feats, fp, features,
                             budget=seedscore.BUDGET_S if budget is None else budget)
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}", "fingerprint": fp}


def namer_frames(scope, frames):
    """v4.38: what the shared namer learns from, each frame tagged with its dataset (`ds`): every dataset's image labels (scope `labels`
    {dataset id: labels folder}) and the projects (scope `folders` / `projects`: sent when some dataset learns from them); with no scope,
    this Train's frames."""
    if not scope:
        return [dict(f, ds=None) for f in frames]
    out = []
    for i, d in sorted((scope.get("labels") or {}).items()):
        out += [dict(f, ds=i) for f in image_labels(d)[0]]
    if scope.get("folders") or scope.get("projects"):
        out += [dict(f, ds="projects") for f in gather(scope.get("folders") or (), scope.get("projects") or ())[0]]
    return out


def train_namer(seed_dir, frames, src, scope=None):
    """paw-p9ve, v4.38: ONE blob namer for every dataset (autoname.py; <seed_dir>/namer.pt and its summary namer.json): trained on the named
    groups of the union (namer_frames) whose features of `src` are cached (nothing is computed for another dataset's pictures), scored held
    out by source across the union. A namer of this union is left alone. -> its summary {fingerprint, score, blobs, images, auto, missing,
    datasets} or None (too little to learn from). Never raises (naming is a convenience; a Train never fails on it)."""
    from pawtrack import autoname
    try:
        un = namer_frames(scope, frames)
        fp = hashlib.sha1(("namer%d|%s" % (autoname.VERSION, fingerprint(un, src))).encode()).hexdigest()
        old = autoname.Namer.load(seed_dir, fp)
        if old is not None:
            return old.info.get("summary")
        feats = load_all(seed_dir, un, src)
        rows = autoname.region_rows(un, feats)
        nm = autoname.fit(None, None, PARTS, fp, rows=rows)
        if nm is None:
            return None
        summ = {"fingerprint": fp, "score": autoname.held_out(rows, PARTS), "blobs": nm.info["blobs"], "images": nm.info["images"],
                "auto": sum(1 for r in rows for g in r[0]["groups"] if g.get("auto")), "missing": sum(1 for f in un if f["groups"] and (f["key"], f["t"]) not in feats),
                "datasets": sorted({str(r[0]["ds"]) for r in rows if r[0].get("ds")}), "trained_at": int(time.time() * 1000)}
        nm.info.update(features=dict(src), summary=summ)
        nm.save(seed_dir)
        with open(os.path.join(seed_dir, "namer.json.tmp"), "w", encoding="utf-8") as fh:
            json.dump(summ, fh)
        os.replace(os.path.join(seed_dir, "namer.json.tmp"), os.path.join(seed_dir, "namer.json"))
        return summ
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"}


def train(seed_dir, folders=(), projects=(), emit=lambda e: None, force=False, device=None, labels=None, features="auto", dataset=None, namer=None):
    """Retrain from the library when its painted groups changed (force: always). -> the head's record (head.json) plus
    `score`: the held-out score of this label set (v4.27: seedscore.py; cached by the fingerprint, so an unchanged set costs
    nothing; {pending: true} while a slow one finishes in the background) and `features`: status() of the feature source.
    v4.28: `features` "auto" (taggerine when its optional pack is installed and a GPU is there, else Hydra) | "hydra" (forced);
    a pack that cannot be loaded falls back to Hydra with a note. A head trained on another source than the one picked is stale:
    the fingerprint names the source, so the next Train retrains it. v4.38: `namer` = the scope of the shared namer (namer_frames); the
    result's `namer` is its summary (train_namer)."""
    t0 = time.perf_counter()
    ds = dataset or seed_dir   # PROTOCOL v4.32: the dataset's folder holds head.pt / head.json / score.json; seed_dir keeps the shared feature caches
    frames, per = gather(folders, projects, labels)
    src, note = pick_source(features)
    fp = fingerprint(frames, src)
    old = Head.load(ds)
    if old is not None and not force and old.info.get("fingerprint") == fp:
        if "area" not in old.info and frames:   # paw-4fne: a head trained before the size rule gets it without retraining
            old.info["area"] = area_prior(frames)
            old.save(ds, old.info)
        nm = train_namer(seed_dir, frames, old.features, namer)   # another dataset's labels may have changed: a few seconds on cached features
        emit({"type": "progress", "done": 0, "total": 1, "stage": "scoring"})
        return {**_public(old.info), "changed": False, "projects": per, "features": status(old, features), "namer": nm,
                "score": held_out(seed_dir, frames, fp, src=old.features, features=old.features, dataset=ds)}
    if not frames:
        return {"frames": 0, "videos": 0, "fingerprint": fp, "changed": False, "projects": per, "parts": usable([]),
                "note": "no painted groups in the library"}
    try:
        ensure_features(seed_dir, frames, emit, device, src)
    except FeatureSourceUnavailable as e:
        src, note = HYDRA, f"{e}; Hydra features used"
        fp = fingerprint(frames, src)
        if old is not None and not force and old.info.get("fingerprint") == fp:
            return {**_public(old.info), "changed": False, "projects": per, "features": {**status(old, features), "note": note},
                    "score": held_out(seed_dir, frames, fp, src=src, features=src, dataset=ds)}
        ensure_features(seed_dir, frames, emit, device, src)
    feats = load_all(seed_dir, frames, src)
    have = [f for f in frames if (f["key"], f["t"]) in feats]
    if not have:
        raise RuntimeError("no features: the library's videos were not found")
    emit({"type": "progress", "done": 0, "total": 1, "stage": "training"})
    t1 = time.perf_counter()
    head = Head.fit([feats[(f["key"], f["t"])][0] for f in have], [targets(f["groups"], feats[(f["key"], f["t"])][1], f.get("ign_mask")) for f in have],
                    Ws=[weights(f["groups"], feats[(f["key"], f["t"])][1], f.get("ign_mask"), strong_frame(f)) for f in have])
    head.features = dict(src)
    parts = usable(have)
    head.use = np.array([parts[p]["use"] and head.present[i] for i, p in enumerate(PARTS)])
    head.refs = who_refs(have, feats)
    info = {"version": VERSION, "fingerprint": fp, "frames": len(have), "videos": len({f["key"] for f in have}),
            "images": sum(1 for f in have if f.get("image")), "negatives": sum(1 for f in have if f.get("image") and not f["groups"]),
            "groups": sum(len(f["groups"]) for f in have), "missing_frames": len(frames) - len(have), "parts": parts,
            "trained_on": sorted(f"{f['key']}_{f['t']}" for f in have), "steps": head.info["steps"], "patches": head.info["patches"], "train_s": round(time.perf_counter() - t1, 2),
            "s": round(time.perf_counter() - t0, 2), "trained_at": int(time.time() * 1000), "area": area_prior(have)}
    info["features"] = {**src, "pack": status(head, features)["pack"], **({"note": note} if note else {})}
    head.save(ds, info)
    nm = train_namer(seed_dir, have, src, namer)
    emit({"type": "progress", "done": 0, "total": 1, "stage": "scoring"})
    return {**_public(info), "changed": True, "projects": per, "features": {**status(head, features), **({"note": note} if note else {})}, "namer": nm,
            "score": held_out(seed_dir, have, fp, feats, src=src, features=src, dataset=ds)}


# ------------------------------------------------------------------ heat -> regions
SMOOTH_CELL = 0.4   # v4.34: the upsampled heat is Gaussian-blurred by this x a patch cell (px) before the threshold


def smooth_up(hm, size):
    """(ph, pw) heat -> (h, w) float32 0..1: bicubic, then a Gaussian of SMOOTH_CELL patch cells, so a threshold on it is a smooth
    curve rather than the grid's staircase (nearest / bilinear upsampling thresholds to blocks and diamonds)."""
    import cv2
    w, h = size
    ph, pw = hm.shape
    up = cv2.resize(np.asarray(hm, np.float32), (w, h), interpolation=cv2.INTER_CUBIC)
    sg = SMOOTH_CELL * min(w / pw, h / ph)
    return np.clip(cv2.GaussianBlur(up, (0, 0), sg) if sg > 0.3 else up, 0, 1)


def proposals(heat, size, use=None, thr=THR, box=(0.0, 0.0, 1.0, 1.0), margin=0.0):
    """The head-only shipped path (what Suggest returns before SAM and who): regions, merged where they touch, cleaned (the app's
    cleanMask + paint margin), slivers and overlaps of unrelated parts removed. The held-out score (seedscore.head_only) measures this."""
    from pawtrack import tidy
    return tidy.tidy_regions(regions(heat, size, use, thr, box), margin)


def regions(heat, size, use=None, thr=THR, box=(0.0, 0.0, 1.0, 1.0)):
    """heat (ph, pw, K) -> [{part, mask (h, w) bool at size, score (peak heat), c (x, y)}]: connected blobs >= thr
    (heat 3x3-blurred half and half, bilinear to size), the best MAXN per part by peak x sqrt(cells); only parts in use,
    only blobs whose peak lies in box (x0, y0, x1, y1). The probe's probe.regions."""
    import cv2
    w, h = size
    ph, pw, _ = heat.shape
    cell = (w / pw) * (h / ph)
    out = []
    for c, p in enumerate(PARTS):
        if use is not None and not use[c]:
            continue
        hm = cv2.blur(heat[..., c].astype(np.float32), (3, 3)) * 0.5 + heat[..., c] * 0.5
        if hm.max() < thr:
            continue
        up = smooth_up(hm, (w, h))   # v4.34: bicubic + a soft blur BEFORE thresholding: no stair-steps from the coarse grid
        n, lab, st, _ = cv2.connectedComponentsWithStats((up >= thr).astype(np.uint8), connectivity=8)
        cand = []
        for j in range(1, n):
            if st[j, 4] < cell:
                continue
            m = lab == j
            i = int(np.argmax(np.where(m, up, -1)))
            py, px = divmod(i, w)
            if not (box[0] <= (px + .5) / w <= box[2] and box[1] <= (py + .5) / h <= box[3]):
                continue
            pk = float(up[py, px])
            cand.append((pk * np.sqrt(st[j, 4] / cell), m, pk, ((px + .5) / w, (py + .5) / h)))
        for _, m, pk, peak in sorted(cand, key=lambda z: -z[0])[:MAXN.get(p, 2)]:
            ys, xs = np.nonzero(m)
            # v4.29: `peak` (x, y 0..1) and `heat` (the part's upsampled heat, size) are the prompts seedsam.py gives SAM
            out.append({"part": p, "mask": m, "score": pk, "c": ((xs.mean() + .5) / w, (ys.mean() + .5) / h), "peak": peak, "heat": up})
    return out


def confident_parts(heat, use):
    """How many parts in use the head is confident about on a frame (peak heat >= CONFIDENT): the seed-frame score."""
    pk = heat.reshape(-1, heat.shape[2]).max(0)
    return int(((pk >= CONFIDENT) & np.asarray(use, bool)).sum())


# ------------------------------------------------------------------ Bottom / Top
def split_who(masks, parts, cen, f, grid, paired=tuple(MAXN)):
    """Exhaustive 2-way split of <= 12 parts minimising within-character dispersion of position (true aspect,
    standardised) + appearance (the region's mean feature, x 0.5), a non-paired part at most once per character (two
    hips = two characters). The probe's who_feat (Bottom/Top grouping 0.84 on painted parts vs 0.68 for position 2-means).
    -> labels (n,) in {0, 1}, or None (fewer than 2 or more than 12 parts)."""
    import itertools
    n = len(parts)
    if n < 2 or n > 12:
        return None
    fe = np.array([region_feature(f, grid, m) for m in masks])
    cen = np.asarray(cen, float)
    Z = np.c_[cen / cen.std() if cen.std() else cen, fe / max(float(fe.std()), 1e-6) * 0.5]
    best = bl = None
    for bits in itertools.product((0, 1), repeat=n - 1):
        lab = np.r_[0, bits]
        bad = sum(max(0, sum(1 for j in range(n) if parts[j] == p and lab[j] == q) - 1) for p in set(parts) if p not in paired for q in (0, 1))
        cost = sum(((Z[lab == q] - Z[lab == q].mean(0)) ** 2).sum() for q in (0, 1) if (lab == q).any()) + 1e3 * bad
        if best is None or cost < best:
            best, bl = cost, lab
    return bl


def name_by_refs(masks, lab, f, grid, ref):
    """Which of the two groups is Bottom by appearance: the one nearer the video's painted Bottom than its Top (mean over its
    parts of cos(Bottom) - cos(Top)). -> the label value (0 | 1) that is Bottom, or None (no refs / one group)."""
    if not ref or "c1" not in ref or "c2" not in ref or len(set(lab)) < 2:
        return None
    m1, m2 = np.asarray(ref["c1"], np.float32), np.asarray(ref["c2"], np.float32)
    s = {q: float(np.mean([region_feature(f, grid, m) @ (m1 - m2) for m, l in zip(masks, lab) if l == q])) for q in (0, 1)}
    return 0 if s[0] > s[1] else 1
