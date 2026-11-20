"""TAPNext++ (google-deepmind/tapnet; code and weights Apache-2.0) long-range point tracker.

Same ROI, channels and overlay as cotracker_points (shared helpers: pawtrack/points.py). TAPNext++ is recurrent and
strictly online: one frame in, positions + visibility out, a fixed-size state carried forward. Memory is
constant in the range length, so there are no chunks. Needs the `tapnext` extra.

Models: `256` = tapnextpp_ckpt.pt at 256x256 input; `512` = tapnextpp_512.ckpt fine-tuned at 512x512; `auto` (v4.55,
default) = 256 unless a painted part is small (auto_size).
Frames are squashed to the square input (upstream convention). confidence = mean over points of the
peak probability of the coordinate heads (softmax, upstream temperature), a sharpness score, not a visibility.
"""
import sys

import numpy as np

from pawtrack.progress import stage, sub
from pawtrack.registry import param, register
from pawtrack.points import CACHE, CHANNELS, common_params, fetch, group_total, point_cap, resize, wrap

CK = {"256": ("https://storage.googleapis.com/dm-tapnet/tapnextpp/tapnextpp_ckpt.pt", "tapnextpp_ckpt.pt"),
      "512": ("https://storage.googleapis.com/gresearch/tapnextpp/tapnextpp_512.ckpt", "tapnextpp_512.ckpt")}
_MODELS = {}


def load_model(size, dev):
    """Once per process (pawtrack serve keeps it). v4.43 stages "model read" (tapnet import, construction, weights:
    ~3.5 s warm) and "model gpu" (~0.4 s), then the stage that was running comes back. The checkpoints are Lightning
    files of 2.4 GB of which 0.9 GB are the weights (the rest optimizer state): mmap reads only the weights' pages."""
    import torch
    if size not in _MODELS:
        from pawtrack import vram
        with sub("model read"):
            from tapnet.tapnext import tapnext_torch
            url, name = CK[size]
            ck = fetch(url, CACHE / "tapnext" / name,
                       "TAPNext++ checkpoint (Apache-2.0, Google DeepMind, https://github.com/google-deepmind/tapnet), 2.5 GB")
            m = tapnext_torch.TAPNext(image_size=(256, 256))  # positions are always in 256-px model space
            sd = torch.load(ck, map_location="cpu", weights_only=True, mmap=True)
            sd = sd.get("state_dict", sd)
            m.load_state_dict({k.removeprefix("tapnext."): v for k, v in sd.items()})
            del sd
            stage("model gpu")
            with vram.loading(f"tapnext_points:{size}", lambda: _MODELS.pop(size, None)):
                _MODELS[size] = m.to(dev).eval()
    return _MODELS[size]


def refill(state, kn, dev):
    """Apply a Reseed answer (slots, new) to the TAPNext++ state before a forward call: the recurrent caches are per
    token ((video patches + points) on dim 0, points last), so a retired point's rows are zeroed in place and its
    query becomes the new point at the next frame (t = state.step: relative time 0 of the coming chunk). No copy of
    the state: the point count stays the initial n (only an opted-in max_points appends rows, until it is full).
    Not independent: the ViT blocks attend across all tokens, so the other points shift a little, and a new point
    inherits the stream's long state (experiments/reseed: on a collapsed stream it shows far less visibility than a
    fresh stream on the same points)."""
    import torch
    slots, new = kn
    if not len(new):
        return
    Q = state.query_points.shape[1]
    a = int((slots >= Q).sum())
    if a:
        grow = lambda x: torch.cat([x, x.new_zeros((a, *x.shape[1:]))])
        state.hidden_state = [h._replace(rg_lru_state=grow(h.rg_lru_state), conv1d_state=grow(h.conv1d_state))
                              for h in state.hidden_state]
        state.query_points = torch.cat([state.query_points, state.query_points.new_zeros((1, a, 3))], 1)
    P = state.hidden_state[0].rg_lru_state.shape[0] - state.query_points.shape[1]  # video tokens (batch 1)
    s = torch.as_tensor(slots, device=dev)
    for h in state.hidden_state:
        h.rg_lru_state[P + s] = 0
        h.conv1d_state[P + s] = 0
    qp = state.query_points
    qp[0, s, 0] = float(state.step)
    qp[0, s, 1] = torch.as_tensor(new[:, 1] * 256, dtype=qp.dtype, device=dev)
    qp[0, s, 2] = torch.as_tensor(new[:, 0] * 256, dtype=qp.dtype, device=dev)


def run_tapnext(frames, seed, size="256", dev=None, chunk=1, reseed=None):
    """frames: iterable of (t_ms, BGR) of one scene; seed (N, 2) normalized points on the first frame.
    Yields (t, xy (N,2) normalized, vis bool (N,), vis_prob (N,), conf (N,)) per frame, in order.
    chunk > 1 feeds that many frames per forward call (same causal recurrence, one state hand-over per chunk).
    reseed: a points.Reseed, asked before every chunk with its first frame (refill)."""
    import torch
    import torch.nn.functional as F
    dev = dev or ("cuda" if torch.cuda.is_available() else "cpu")
    model = load_model(size, dev)
    S = int(size)
    q = torch.zeros(1, len(seed), 3, device=dev)
    q[0, :, 1] = torch.as_tensor(seed[:, 1] * 256)  # [t, y, x] in 256-px model space
    q[0, :, 2] = torch.as_tensor(seed[:, 0] * 256)
    amp = torch.autocast("cuda", dtype=torch.float16) if dev == "cuda" else torch.autocast("cpu", enabled=False)
    state, last = None, None

    def step(ts, imgs):
        nonlocal state, last
        x = torch.from_numpy(np.stack(imgs)).to(dev).float().div_(127.5).sub_(1.0)[None]  # 1 T S S 3
        tracks, logits, vis_logits, state = model(video=x, query_points=q if state is None else None, state=state)
        xy = tracks[0].float().cpu().numpy()[..., ::-1] / 256  # [y, x] -> [x, y], normalized
        vp = torch.sigmoid(vis_logits[0, :, :, 0].float()).cpu().numpy()
        lx, ly = logits[0].float().chunk(2, dim=-1)
        conf = torch.sqrt(F.softmax(lx * 0.5, -1).amax(-1) * F.softmax(ly * 0.5, -1).amax(-1)).cpu().numpy()
        last = xy[-1], vp[-1] > 0.5
        for i, t in enumerate(ts):
            yield t, np.ascontiguousarray(xy[i]), vp[i] > 0.5, vp[i], conf[i]

    with torch.inference_mode(), amp:
        ts, imgs = [], []
        for t, bgr in frames:
            img = resize(bgr, (S, S))
            if reseed is not None and not ts and state is not None:
                refill(state, reseed(t, img, *last), dev)
            ts.append(t)
            imgs.append(img)
            if len(ts) == chunk:
                yield from step(ts, imgs)
                ts, imgs = [], []
        if ts:
            yield from step(ts, imgs)


# v4.55 (paw-mvnf) model "auto": 256 unless the smallest painted part is small. experiments/resolution/synth.py: 256 equals
# or beats 512 on normal-sized parts (3.6x faster, under half the VRAM); 512 wins clearly only below ~8 % of the frame
# height (signal error 8.3 %: .016 vs .010, 5.6 %: .047 vs .025, 3.7 %: .263 vs .044). Those parts were 0.6 h wide, so
# their short side was the width: 8 % of 1080 px tall = 52 px wide = 2.7 % of a 1920 frame. The measure is the part's
# bounding-box short side in the model's own square input (frames are squashed to S x S): min(w / W, h / H) of its outline.
# ponytail: one threshold from one aspect of synthetic part; refit on owner clips if 512 picks look wrong.
AUTO_SHORT = 0.027
# paw-s9ns: peak reserved GiB (weights included) = a + b chunk + n (c + d chunk): the activations scale with chunk x tokens
# (video tokens: the a / b difference between the sizes; points: n). Relative least squares over experiments/resolution/
# vram.py (120 frames, chunk 8 x 128..6144 points, chunks 1 / 4 / 16 x 2 counts): every cell within 5 % of it.
PEAK = {"256": (1.43, 0.104, 5.3e-5, 1.37e-4), "512": (1.72, 0.53, 3.1e-4, 1.05e-4)}


def need_gb(model, chunk, n):
    """The VRAM a run asks vram.cap for, GB (GiB): the fitted peak + 15 % + 0.5 (the CUDA context, and headroom for the
    scan kernel, which dies with "illegal memory access" rather than a clean OOM within ~0.2 GB of its cap: seen at 3.83 of
    4.00 GB, model 512, 128 points, chunk 4). tests/test_vram.py holds the measured table: never under a cell."""
    a, b, c, d = PEAK["512" if model == "512" else "256"]
    return 1.15 * (a + b * chunk + n * (c + d * chunk)) + 0.5


def short_side(g):
    xs, ys = zip(*g["poly"])
    return min(max(xs) - min(xs), max(ys) - min(ys))


def auto_size(parts, have512=True, room=None, need512=0.0):
    """parts: this scene's painted pinned groups (cli.parse_groups entries); have512: its checkpoint is on disk; room: the
    VRAM budget in GB (None: no CUDA, not checked); need512: what a 512 run would ask. -> (size, a few words why)."""
    if not parts:
        return "256", "auto: 256, no painted parts"
    g = min(parts, key=short_side)
    what = f"{g['name']} is {100 * short_side(g):.1f} % of the frame across"
    if short_side(g) >= AUTO_SHORT:
        return "256", f"auto: 256, smallest part {what}"
    if not have512:
        return "256", f"auto: 256, {what} but the 512 model is not downloaded"
    if room is not None and need512 > room:
        return "256", f"auto: 256, {what} but 512 needs {need512:.1f} GB of {room:.1f} GB"
    return "512", f"auto: 512, {what}"


@register("tapnext_points", "TAPNext++ points (clicks or box)", roi="box_or_points", channels=CHANNELS,
          params=common_params() + [
              param("model", "Model input size", "choice", "auto", choices=["auto", *CK],
                    hint="auto: 256, or 512 when the smallest painted part is under 2.7 % of the frame across (its "
                         "outline's short side). 512 only helps small parts and is 3.6x slower with twice the VRAM"),
              param("chunk", "Frames per forward call (speed; 1 = strictly per frame)", "int", 8, 1, 32)])
def track(frames, roi, p):
    import torch
    from pawtrack import vram
    k = len(p.get("groups") or ()) or (3 if p.get("sem_groups") else 0)  # v4.14: groups' own points (group_points)
    n = group_total(p, k) if roi.get("kind") == "box" else len(roi.get("points") or [])
    n = point_cap(n, p) if p.get("reseed_every_ms") else n  # re-seeding: the initial n unless max_points opts in to more
    if p["model"] == "auto":
        a, b = p.get("scene_ms") or (-np.inf, np.inf)  # cli: this scene's [start, end); wrap's own rule for its groups
        parts = [g for g in p.get("groups") or () if g["pinned"] and (g["t_ms"] is None or a - 50 <= g["t_ms"] < b)]
        cu = vram._cuda()
        size, why = auto_size(parts if roi.get("kind") == "box" else [], (CACHE / "tapnext" / CK["512"][1]).exists(),
                              vram.budget_gb(cu)[0] if cu else None, need_gb("512", p["chunk"], n))
        from pawtrack.trackers import note
        note("model_size", why, {"model": size, "auto": True})
        p = {**p, "model": size}
    vram.cap(f"tapnext_points:{p['model']}", need_gb(p["model"], p["chunk"], n))
    if not torch.cuda.is_available():
        print("pawtrack: CUDA not available, TAPNext++ runs on CPU (slow)", file=sys.stderr)
    run = lambda fr, seed, reseed=None: run_tapnext(fr, seed, p["model"], chunk=p["chunk"], reseed=reseed)
    S = int(p["model"])
    yield from wrap(run, roi, frames, p, lambda vp, cf: float(np.nanmean(cf)), local_support=True, work_wh=(S, S))
