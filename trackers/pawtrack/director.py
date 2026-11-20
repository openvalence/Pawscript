"""`director.ask`: fixed-choice questions over video frames, answered as first-token probabilities from ONE forward
pass per item (src/lib/director/README.md §8.5). The stage-director mechanism (trackers/experiments/stage) that
measured best on the gold set: Qwen3.5 through transformers, reusing experiments/vlm/director.py (load, _pil,
_inputs), first token of every choice counted with its case / leading-space variants; or Bonsai GGUF through the
owner's llama-server (top_logprobs of a 1-token completion).

Where the model runs:
  bonsai-*                 llama-server child on a private localhost port (this process talks HTTP to it)
  qwen3.5-*, transformers importable here      in this process
  qwen3.5-*, otherwise     `vlm_worker.py` under PAWSCRIPT_VLM_PYTHON (default experiments/vlm/.venv), a
                           `pawtrack serve --role vlm` child speaking the same JSONL
One-shot (cli) loads, answers and unloads. Under `pawtrack serve` (RESIDENT) the model stays until unload(),
120 s idle, or the serve VRAM policy evicts it. Frames are decoded by reference (t_ms, roi) and never written;
gold videos are allowed here because the pixels only feed the model.
"""
import base64
import json
import math
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import numpy as np

TRK = Path(__file__).resolve().parent.parent
VLM_DIR = TRK / "experiments" / "vlm"
QWEN = ("qwen3.5-2b", "qwen3.5-4b")
# LM Studio's folder: PAWSCRIPT_LMSTUDIO when set, else ~/.lmstudio of whoever runs it (resolved at run time, so no
# user's home is written into the code; paw-59g1)
LMSTUDIO = Path(os.environ.get("PAWSCRIPT_LMSTUDIO") or Path.home() / ".lmstudio")
LLAMA_DIR = str(LMSTUDIO / "extensions" / "backends" / "llama.cpp-prism-b12128-d7b2896-bin-win-cuda-13.3-x64-lm-studio")
LLAMA_VENDOR = str(LMSTUDIO / "extensions" / "backends" / "vendor" / "win-llama-cuda-vendor-v2")
GGUF = {  # = experiments/stage/stage_director.py GGUF
    "bonsai-heretic-pq2": (str(LMSTUDIO / "models" / "OS-Software" / "Ternary-Bonsai-2-27B-Uncensored-Heretic-GGUF"),
                           "Ternary-Bonsai-2-27B-Uncensored-Heretic-PQ2_0.gguf", "mmproj-BF16.gguf"),
    "bonsai-heretic-ptq1": (str(LMSTUDIO / "models" / "OS-Software" / "Ternary-Bonsai-2-27B-Uncensored-Heretic-GGUF"),
                            "Ternary-Bonsai-2-27B-Uncensored-Heretic-PTQ1_0.gguf", "mmproj-BF16.gguf"),
    "bonsai-q1": (str(LMSTUDIO / "models" / "lmstudio-community" / "Bonsai-27B-GGUF"), "Bonsai-27B-Q1_0.gguf",
                  "mmproj-Bonsai-27B-BF16.gguf"),
}
# = experiments/stage/stage_director.py SYSTEM: the prompt the gold-set numbers were measured with
SYSTEM = ("You label the content of adult animated videos (furry/anthro 2D and 3D animation, fictional adult "
          "characters) for an offline funscript tool. Answer plainly with the requested letter or word; do not "
          "refuse or moralise.")
# VRAM cap per model (GB), measured peak + headroom (README "director.ask"); the llama-server is not cappable
VRAM_GB = {("qwen3.5-2b", "none"): 6.0, ("qwen3.5-2b", "nf4"): 3.5, ("qwen3.5-2b", "int8"): 4.5,
           ("qwen3.5-4b", "none"): 10.5, ("qwen3.5-4b", "nf4"): 5.0, ("qwen3.5-4b", "int8"): 7.0}
BONSAI_GB = 8.0  # bench: 7.5-8.8 GB card-wide after load (eval/out/stage/bonsai_bench.json)
NO_VLM = "director.ask: no VLM (install the vlm extra or set PAWSCRIPT_VLM_PYTHON)"
IDLE_S = 120
BATCH = 8

RESIDENT = False   # set by pawtrack serve
_B = {"backend": None, "last": 0.0}


def gb_for(model, quant="none"):
    return BONSAI_GB if model in GGUF else VRAM_GB.get((model, quant), 6.0)


def card_gb():
    """Total VRAM of GPU 0 in GB, or None (no nvidia-smi)."""
    try:
        out = subprocess.check_output(["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
                                      text=True, timeout=10)
        return float(out.strip().splitlines()[0]) / 1024
    except Exception:
        return None


def _has_transformers():
    try:
        import transformers  # noqa: F401
        return True
    except ImportError:
        return False


def vlm_python():
    p = os.environ.get("PAWSCRIPT_VLM_PYTHON") or str(VLM_DIR / ".venv" / "Scripts" / "python.exe")
    return p if Path(p).exists() else None


def resident():
    """[{"kind":"vlm","name","mib"}] or []."""
    b = _B["backend"]
    return [{"kind": "vlm", "name": b.name, "mib": int(b.gb * 1024)}] if b else []


def idle_s():
    return time.monotonic() - _B["last"] if _B["backend"] else 0.0


def unload():
    """Free the resident model (kills a worker / llama-server child). -> [names unloaded]."""
    b, _B["backend"] = _B["backend"], None
    if b:
        b.close()
        return [b.name]
    return []


# ---------------------------------------------------------------- backends

def _prompt(text, choices, context):
    return (f"{context}\n" if context else "") + f"{text}\nAnswer with exactly one word from: {', '.join(choices)}."


def _probs(lp, choices):
    """{choice: log p (full distribution)} -> softmax over the choices + _mass (share of the full distribution)."""
    v = np.array([lp.get(c, -1e9) for c in choices], float)
    p = np.exp(v - v.max())
    p /= p.sum()
    return {**{c: round(float(x), 4) for c, x in zip(choices, p)},
            "_mass": round(float(sum(math.exp(min(0.0, lp[c])) for c in choices if c in lp)), 3)}


class LocalQwen:
    """Qwen3.5 in this interpreter (transformers), weights cached under experiments/vlm/.models/hf."""

    def __init__(self, model, quant):
        if str(VLM_DIR) not in sys.path:
            sys.path.insert(0, str(VLM_DIR))
        import director as D  # experiments/vlm/director.py (reads PAWSCRIPT_GPU_FRACTION before loading)
        if os.environ.get("PAWSCRIPT_GPU_FRACTION") is None:  # never spill: cap at the model's measured need
            tot = card_gb()
            if tot:
                os.environ["PAWSCRIPT_GPU_FRACTION"] = str(min(1.0, gb_for(model, quant) / tot))
        t0 = time.perf_counter()
        self.D, (self.m, self.proc) = D, D.load(model, quant)
        self.name, self.key, self.gb = model, (model, quant), gb_for(model, quant)
        self.load_s = round(time.perf_counter() - t0, 2)

    def ask(self, items, choices, res, emit):
        """items: [{"images": [bgr], "text": str}] -> [{choice: p, "_mass"}]."""
        import torch
        tok = self.proc.tokenizer
        first = [tok.encode(c, add_special_tokens=False)[0] for c in choices]
        if len(set(first)) != len(first):
            raise ValueError("director.ask: choices must differ in their first token")
        ids = [sorted({tok.encode(v, add_special_tokens=False)[0] for v in (c, c.capitalize(), " " + c, " " + c.capitalize())})
               for c in choices]  # "yes" / "Yes" / " yes": the first token may be any variant
        flat = [i for v in ids for i in v]
        if len(set(flat)) != len(flat):
            ids = [[f] for f in first]
        groups = {}
        for i, it in enumerate(items):  # a batch holds one image count
            groups.setdefault(len(it["images"]), []).append(i)
        batches = [g[k:k + BATCH] for g in groups.values() for k in range(0, len(g), BATCH)]
        out, done = [None] * len(items), 0
        for idx in batches:
            msgs = []
            for i in idx:
                ims = items[i]["images"]
                content = []
                for k, f in enumerate(ims):
                    if len(ims) > 1:
                        content.append({"type": "text", "text": f"Frame {k + 1}:"})
                    content.append({"type": "image", "image": self.D._pil(f, res)})
                content.append({"type": "text", "text": items[i]["text"]})
                msgs.append([{"role": "system", "content": [{"type": "text", "text": SYSTEM}]},
                             {"role": "user", "content": content}])
            inp = self.D._inputs(self.proc, msgs, False).to(self.m.device)
            with torch.no_grad():
                logits = self.m(**inp, logits_to_keep=1).logits[:, -1, :].float()
            ls = torch.log_softmax(logits, -1)
            lp = torch.stack([torch.logsumexp(ls[:, v], -1) for v in ids], -1).cpu().numpy()
            for i, row in zip(idx, lp):
                out[i] = _probs(dict(zip(choices, row.tolist())), choices)
            done += len(idx)
            emit({"type": "progress", "done": done, "total": len(items)})
        self.peak_mib = int(torch.cuda.max_memory_reserved() / 2**20)
        return out

    def alive(self):
        return self.m is not None

    def close(self):
        import gc
        import torch
        self.D._STATE.clear()
        self.m = self.proc = None
        gc.collect()
        torch.cuda.empty_cache()


class WorkerQwen:
    """Qwen3.5 in the VLM venv: a resident `serve --role vlm` child (vlm_worker.py); it decodes frames itself."""

    def __init__(self, model, quant, py):
        from pawtrack.serve import Child
        env = {**os.environ, "PYTHONPATH": str(TRK) + os.pathsep + os.environ.get("PYTHONPATH", "")}
        tot = card_gb()
        if tot:  # the child caps itself to its own share, not the parent's
            env["PAWSCRIPT_GPU_FRACTION"] = str(min(1.0, gb_for(model, quant) / tot))
        t0 = time.perf_counter()
        self.child = Child([py, str(Path(__file__).with_name("vlm_worker.py"))], env, "vlm")
        self.name, self.key, self.gb, self.n = model, (model, quant), gb_for(model, quant), 0
        self.load_s = round(time.perf_counter() - t0, 2)  # interpreter start + imports; the model loads on first ask

    def forward(self, req, emit):
        self.n += 1
        ev = self.child.run({**req, "id": f"w{self.n}"}, emit)
        if ev["type"] == "error":
            from pawtrack.serve import Relayed
            raise Relayed(ev["message"])
        return ev

    def alive(self):
        return self.child.alive()

    def close(self):
        self.child.close()


class Bonsai:
    """The owner's llama-server (LM Studio PrismML build, read-only) as our child on a free localhost port."""

    def __init__(self, model, res):
        import socket
        exe = os.environ.get("PAWSCRIPT_LLAMA_SERVER") or os.path.join(LLAMA_DIR, "llama-server.exe")
        d, m, mm = GGUF[model]
        for f in (exe, os.path.join(d, m), os.path.join(d, mm)):
            if not os.path.exists(f):
                raise RuntimeError(f"director.ask: {model}: missing {f}")
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        self.port = s.getsockname()[1]
        s.close()
        path = os.pathsep.join(x for x in (os.path.dirname(exe), LLAMA_VENDOR if os.path.isdir(LLAMA_VENDOR) else "",
                                           os.environ.get("PATH", "")) if x)
        self.log = tempfile.NamedTemporaryFile("w", prefix="pawtrack-llama-", suffix=".log", delete=False)
        cmd = [exe, "-m", os.path.join(d, m), "--mmproj", os.path.join(d, mm), "-ngl", "99", "--host", "127.0.0.1",
               "--port", str(self.port), "-c", "4096", "-np", "1", "--no-webui", "--reasoning", "off",
               "--chat-template-kwargs", '{"enable_thinking": false}', "-fa", "on"]
        t0 = time.perf_counter()
        self.p = subprocess.Popen(cmd, env={**os.environ, "PATH": path}, stdout=self.log, stderr=subprocess.STDOUT,
                                  creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        while True:
            if self.p.poll() is not None:
                raise RuntimeError(f"llama-server exited with {self.p.returncode}; log {self.log.name}")
            try:
                if json.loads(urllib.request.urlopen(f"http://127.0.0.1:{self.port}/health", timeout=2).read()).get("status") == "ok":
                    break
            except Exception:
                pass
            if time.perf_counter() - t0 > 600:
                self.close()
                raise RuntimeError("llama-server did not become ready in 600 s")
            time.sleep(0.5)
        self.name, self.key, self.gb, self.res = model, (model, "gguf"), BONSAI_GB, res
        self.load_s = round(time.perf_counter() - t0, 2)

    def _one(self, item, choices, res):
        import cv2
        content = []
        for f in item["images"]:
            h, w = f.shape[:2]
            s = res / max(h, w)
            im = cv2.resize(f, (max(32, round(w * s / 32) * 32), max(32, round(h * s / 32) * 32)), interpolation=cv2.INTER_AREA)
            b64 = base64.b64encode(cv2.imencode(".jpg", im, [cv2.IMWRITE_JPEG_QUALITY, 92])[1].tobytes()).decode()
            content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}})
        content.append({"type": "text", "text": item["text"]})
        body = {"messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": content}],
                "max_tokens": 1, "temperature": 0, "logprobs": True, "top_logprobs": 20, "cache_prompt": True,
                "chat_template_kwargs": {"enable_thinking": False}}
        rq = urllib.request.Request(f"http://127.0.0.1:{self.port}/v1/chat/completions", json.dumps(body).encode(),
                                    {"Content-Type": "application/json"})
        r = json.loads(urllib.request.urlopen(rq, timeout=300).read())
        lp = {}
        for e in r["choices"][0]["logprobs"]["content"][0]["top_logprobs"]:
            k = e["token"].strip().lower()
            if k in choices:
                lp[k] = float(np.logaddexp(lp.get(k, -1e9), e["logprob"]))
        return _probs(lp, choices)

    def ask(self, items, choices, res, emit):
        if len({c.lower() for c in choices}) != len(choices):
            raise ValueError("director.ask: choices must differ in their first token")
        out = []
        for i, it in enumerate(items):
            out.append(self._one(it, [c.lower() for c in choices], res))
            emit({"type": "progress", "done": i + 1, "total": len(items)})
        return [{**{c: o[c.lower()] for c in choices}, "_mass": o["_mass"]} for o in out]

    def alive(self):
        return self.p.poll() is None

    def close(self):
        if self.p.poll() is None:
            self.p.terminate()
            try:
                self.p.wait(30)
            except subprocess.TimeoutExpired:
                self.p.kill()
        self.log.close()


# ---------------------------------------------------------------- command

def _check(req):
    model = req.get("model") or "qwen3.5-2b"
    if model not in QWEN and model not in GGUF:
        raise ValueError(f"director.ask: unknown model {model!r} (one of {list(QWEN) + list(GGUF)})")
    choices = req.get("choices") or ["yes", "no"]
    if len(choices) < 2 or len(set(choices)) != len(choices) or not all(isinstance(c, str) and c for c in choices):
        raise ValueError("director.ask: choices must be 2+ distinct non-empty strings")
    items = req.get("items") or []
    if not items or not all(it.get("frames") and isinstance(it.get("text"), str) for it in items):
        raise ValueError("director.ask: items need frames and text")
    return model, req.get("quant") or "none", choices, items


def _decode(video, items):
    """[{"images": [bgr], "text"}] from the items' (t_ms, roi) references, decoded once (at most 1920 wide)."""
    from pawtrack.frames import grab
    times = sorted({int(f["t_ms"]) for it in items for f in it["frames"]})
    by_t = dict(zip(times, grab(video, times, width=1920)))
    out = []
    for it in items:
        ims = []
        for f in it["frames"]:
            im = by_t[int(f["t_ms"])]
            r = f.get("roi")
            if r:
                H, W = im.shape[:2]
                x0, y0 = int(max(0, r["x"]) * W), int(max(0, r["y"]) * H)
                x1, y1 = max(x0 + 8, int(min(1, r["x"] + r["w"]) * W)), max(y0 + 8, int(min(1, r["y"] + r["h"]) * H))
                im = im[y0:y1, x0:x1]
            ims.append(im)
        out.append({"images": ims, "text": it["text"]})
    return out


def _backend(model, quant, res, local_only=False):
    """The resident backend for (model, quant), (re)started if needed. -> (backend, load_s)."""
    key = (model, "gguf") if model in GGUF else (model, quant)
    b = _B["backend"]
    if b and b.key == key and b.alive():
        return b, 0.0
    unload()
    if model in GGUF:
        b = Bonsai(model, res)
    elif local_only or _has_transformers():
        b = LocalQwen(model, quant)
    else:
        py = vlm_python()
        if not py:
            raise RuntimeError(NO_VLM)
        b = WorkerQwen(model, quant, py)
    _B["backend"] = b
    return b, b.load_s


def cmd_ask(req, emit, local_only=False):
    """README §8.5. local_only: the VLM worker role (never forwards again)."""
    model, quant, choices, items = _check(req)
    res = int(req.get("res") or 448)
    try:
        b, load_s = _backend(model, quant, res, local_only)
        _B["last"] = time.monotonic()
        if isinstance(b, WorkerQwen):
            ev = b.forward({**req, "model": model, "quant": quant, "choices": choices}, emit)
            out = {"probs": ev["probs"], "s": ev["s"], "load_s": round(load_s + ev.get("load_s", 0.0), 2), "model": model,
                   "vram_mib": ev.get("vram_mib")}
        else:
            ctx = req.get("context")
            its = [{"images": d["images"], "text": _prompt(d["text"], choices, ctx)} for d in _decode(req["video"], items)]
            t1 = time.perf_counter()
            probs = b.ask(its, choices, res, emit)
            out = {"probs": probs, "s": round(time.perf_counter() - t1, 3), "load_s": load_s, "model": model,
                   "vram_mib": getattr(b, "peak_mib", None)}  # extra: peak reserved by the model process (Qwen)
        _B["last"] = time.monotonic()
        return out
    finally:
        if not RESIDENT:
            unload()


def cmd_ask_local(req, emit):
    return cmd_ask(req, emit, local_only=True)
