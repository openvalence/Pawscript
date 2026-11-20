"""taggerine as an OPTIONAL feature source for the learned seeder (PROTOCOL v4.28, paw-26iv).

lodestones/taggerine: a DINOv3 ViT-H/16+ fine-tuned end to end on e621 + Danbooru tags (card: Apache-2.0; the DINOv3 backbone is
under Meta's dinov3 licence: read it before a public release). The seeder probe (experiments/seeder-probe/RESULTS.md) found its
patch tokens of layer 22 at a long side of ~1024 px the best frozen features for the part head (found 0.59 / IoU 0.34 / centre
0.049 against the Hydra tagger's 0.51 / 0.27 / 0.059, grouped 5-fold on 52 labelled frames).

This module is OWN code (torch + safetensors only), written from the checkpoint's key names and the published architecture
constants; the downloaded repo script is never imported or run, nothing is unpickled (`safetensors.torch.load_file`, never
`torch.load` on it) and nothing is ever downloaded: the weights are an optional pack the owner puts at WEIGHTS. "Installed" =
that file exists. It runs only on a CUDA GPU, in bf16 (the ViT-H on CPU is far too slow to be useful: Hydra is used then).

VRAM: weights 1.68 GB in bf16; measured peak ~1.8 GB at a 1024 px long side (see GB below for the figure the sidecar asks for).
Registered as the resident model "taggerine" in pawtrack/vram.py: it coexists with Hydra and SAM and is evicted LRU like them.
"""
import json
import math
from pathlib import Path

import numpy as np

from pawtrack import MODELS_DIR

CACHE = MODELS_DIR / ".cache" / "taggerine"  # or the app's models folder (paw-cdot)
WEIGHTS = CACHE / "tagger_proto.safetensors"
VOCAB = CACHE / "tagger_vocab.json"
# the ONE place the seeder's feature choice lives: the probe's best variant (patch tokens after block LAYER + the final norm, the
# long side of the picture scaled to LONG_SIDE px, a multiple of the 16 px patch)
LAYER, LONG_SIDE = 22, 1024
SOURCE = {"source": "taggerine", "layer": LAYER, "long_side": LONG_SIDE}
GB = 2.4   # what a job asks vram.cap for. Measured in this sidecar path (53 labelled pictures, ~1024 px): resident weights 1.57 GiB, peak allocated 1.78 GiB, peak reserved 2.18 GiB
MEAN, STD = (0.485, 0.456, 0.406), (0.229, 0.224, 0.225)
_MODEL = {}


def installed():
    """The optional pack is on disk (nothing is downloaded by the app or the sidecar)."""
    return WEIGHTS.is_file()


def ready():
    """Usable here: installed and a CUDA device (never the ViT-H on CPU)."""
    if not installed():
        return False
    import torch
    return torch.cuda.is_available()


class Backbone:
    """DINOv3 ViT-H/16+: 32 pre-norm blocks, width 1280, 20 heads, SwiGLU MLP (5120), RoPE on the patch tokens, LayerScale,
    1 CLS + 4 register tokens. Weights as the checkpoint names them ("backbone.model.layer.N...")."""
    D, H, L, R, P, THETA, RESC = 1280, 20, 32, 4, 16, 100.0, 2.0

    def __init__(self, path, device, dtype):
        import torch
        from safetensors.torch import load_file
        self.torch, self.device, self.dtype = torch, device, dtype
        raw = load_file(str(path), device="cpu")
        self.keys = list(raw)
        self.w = {k[len("backbone."):].replace("model.layer.", "layer."): v.to(device, dtype) for k, v in raw.items() if k.startswith("backbone.")}
        self.head = raw.get("projection.weight")   # (n_tags, (1 + R) * D) float32, CPU: only the self-check uses it
        del raw
        self.used = set()

    def g(self, k):
        self.used.add(k)
        return self.w[k]

    def unused(self):
        """Backbone tensors never read by a forward pass (the load-time self-check wants none beyond mask_token)."""
        return sorted(set(self.w) - self.used - {"embeddings.mask_token"})

    def _rope(self, gh, gw):
        torch = self.torch
        cy = torch.arange(0.5, gh, dtype=torch.float32, device=self.device) / gh
        cx = torch.arange(0.5, gw, dtype=torch.float32, device=self.device) / gw
        c = (2.0 * torch.stack(torch.meshgrid(cy, cx, indexing="ij"), -1).flatten(0, 1) - 1.0) * self.RESC
        inv = 1.0 / (self.THETA ** torch.arange(0, 1, 4 / (self.D // self.H), dtype=torch.float32, device=self.device))
        ang = (2 * math.pi * c[:, :, None] * inv[None, None, :]).flatten(1, 2).tile(2)
        return torch.cos(ang).to(self.dtype)[None, None], torch.sin(ang).to(self.dtype)[None, None]

    def tokens(self, x, want=(LAYER,)):
        """x (1, 3, H, W) normalised, H and W multiples of 16 -> ({n: block n's output after the final norm (1, 1 + R + N, D)}, (gh, gw))."""
        torch = self.torch
        F = torch.nn.functional
        gh, gw = x.shape[2] // self.P, x.shape[3] // self.P
        p = F.conv2d(x.to(self.dtype), self.g("embeddings.patch_embeddings.weight"), self.g("embeddings.patch_embeddings.bias"), stride=self.P).flatten(2).transpose(1, 2)
        h = torch.cat([self.g("embeddings.cls_token"), self.g("embeddings.register_tokens"), p], 1)
        cos, sin = self._rope(gh, gw)
        npre, hd = 1 + self.R, self.D // self.H
        rot = lambda t: torch.cat((-t[..., hd // 2:], t[..., :hd // 2]), -1)

        def rope(t):
            return torch.cat([t[..., :npre, :], t[..., npre:, :] * cos + rot(t[..., npre:, :]) * sin], -2)
        out, last = {}, max(want)
        for i in range(last):
            b = f"layer.{i}."
            y = F.layer_norm(h, (self.D,), self.g(b + "norm1.weight"), self.g(b + "norm1.bias"), 1e-5)
            q = F.linear(y, self.g(b + "attention.q_proj.weight"), self.g(b + "attention.q_proj.bias")).view(1, -1, self.H, hd).transpose(1, 2)
            k = F.linear(y, self.g(b + "attention.k_proj.weight")).view(1, -1, self.H, hd).transpose(1, 2)
            v = F.linear(y, self.g(b + "attention.v_proj.weight"), self.g(b + "attention.v_proj.bias")).view(1, -1, self.H, hd).transpose(1, 2)
            a = F.scaled_dot_product_attention(rope(q), rope(k), v, scale=hd ** -0.5).transpose(1, 2).reshape(1, -1, self.D)
            h = h + F.linear(a, self.g(b + "attention.o_proj.weight"), self.g(b + "attention.o_proj.bias")) * self.g(b + "layer_scale1.lambda1")
            y = F.layer_norm(h, (self.D,), self.g(b + "norm2.weight"), self.g(b + "norm2.bias"), 1e-5)
            m = F.linear(F.silu(F.linear(y, self.g(b + "mlp.gate_proj.weight"), self.g(b + "mlp.gate_proj.bias"))) * F.linear(y, self.g(b + "mlp.up_proj.weight"), self.g(b + "mlp.up_proj.bias")),
                         self.g(b + "mlp.down_proj.weight"), self.g(b + "mlp.down_proj.bias"))
            h = h + m * self.g(b + "layer_scale2.lambda1")
            if i + 1 in want:
                out[i + 1] = F.layer_norm(h, (self.D,), self.g("norm.weight"), self.g("norm.bias"), 1e-5)
        return out, (gh, gw)

    def logits(self, tokens):
        """final-norm tokens (1, 1 + R + N, D) -> (n_tags,) float32: Linear((1 + R) * D, n_tags, no bias) on CLS + registers."""
        z = tokens[0, :1 + self.R].float().cpu().reshape(1, -1)
        return (z @ self.head.T)[0]


def size_for(w, h, long_side=LONG_SIDE, patch=Backbone.P):
    """Picture (w, h) -> the (height, width) in pixels the backbone sees: the long side ~long_side, the aspect kept, both multiples of the patch."""
    long_ = max(1, round(long_side / patch))
    gh, gw = (long_, max(1, round(long_ * w / h))) if h >= w else (max(1, round(long_ * h / w)), long_)
    return gh * patch, gw * patch


def to_tensor(bgr, hw, device):
    """BGR uint8 -> (1, 3, h, w) normalised float32 on `device` at hw = (h, w)."""
    import cv2
    import torch
    h, w = hw
    im = cv2.resize(bgr, (w, h), interpolation=cv2.INTER_AREA if h * w < bgr.shape[0] * bgr.shape[1] else cv2.INTER_CUBIC)
    x = (im[..., ::-1].astype(np.float32) / 255 - np.array(MEAN, np.float32)) / np.array(STD, np.float32)
    return torch.from_numpy(np.ascontiguousarray(x)).permute(2, 0, 1)[None].to(device)


def load(path=None):
    """The resident backbone (bf16 on the GPU). Counted by pawtrack/vram.py as "taggerine" (cap before the load, the measured size
    after); raises RuntimeError with a plain reason when it cannot run here (the callers fall back to Hydra)."""
    from pawtrack import vram
    path = Path(path or WEIGHTS)
    if not path.is_file():
        raise RuntimeError(f"taggerine is not installed ({path} is missing)")
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError("taggerine needs a CUDA GPU (the ViT-H is not run on the CPU)")
    vram.cap("taggerine", GB)
    if "m" not in _MODEL:
        with vram.loading("taggerine", _MODEL.clear):
            _MODEL["m"] = Backbone(path, "cuda", torch.bfloat16)
    return _MODEL["m"]


def features(bgr, model=None):
    """One picture (BGR uint8, any size) -> (f (S, 1280) float16 patch tokens of LAYER, row-major, (gh, gw))."""
    import torch
    m = model or load()
    h, w = bgr.shape[:2]
    x = to_tensor(bgr, size_for(w, h), m.device)
    with torch.no_grad():
        out, grid = m.tokens(x, want=(LAYER,))
    return out[LAYER][0, 1 + m.R:].float().cpu().numpy().astype(np.float16), (int(grid[0]), int(grid[1]))


def vocab():
    return json.load(open(VOCAB, encoding="utf-8"))["idx2tag"]
