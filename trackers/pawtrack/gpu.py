"""paw-k97q: can this process use the graphics card? (PROTOCOL v4.56)

torch 2.12.1+cu126 lists kernels for sm_50 .. sm_90. An RTX 50xx (sm_120) is outside that list, yet one ran the shared
build without problems, so the list alone decides nothing: the first time anything asks torch.cuda.is_available() (a
tracker, vram.py, `list`), state() runs a real probe on the card, the ops the trackers use on tiny tensors (conv2d,
interpolate, grid_sample, attention, an fp16 autocast bmm; synchronised). Only a probe that fails with a kernel-image /
unsupported-architecture error turns CUDA off for the whole process (torch.cuda.is_available() is False from then on:
the trackers take their CPU path, the tagger commands refuse as without CUDA) and the app says so in plain words. A card
outside the list whose probe passes keeps the GPU, with a quiet `outside` record (and hint() for a later driver error).
Nothing here raises: a failed check leaves torch as it was (state "unknown").

paw-1dt4: install() never imports torch (it patches torch when something first imports it), so a command that needs no
torch (the CPU trackers, scenes, frames, segment's plain paths) neither loads it nor makes a CUDA context. A torch that
cannot load (ImportError, or OSError from a DLL: WinError 126 / 1114) is state "none" with reason "torch". `list` asks
state(probe=False): a card in the build's list is named without the kernel probe, which then runs at the first
torch.cuda.is_available() (a GPU tracker's start); a card outside the list is probed at once (the app greys out the GPU
trackers from list's answer).
"""
import importlib.abc
import importlib.util
import sys
import time
import traceback

STATE = None
_REAL = None    # torch.cuda.is_available before install()
_BUSY = False   # the check is running (the probe's own torch calls see the real answer)
KERNEL_MARKS = ("no kernel image", "invalid device function", "not compatible with the current pytorch",
                "unsupported gpu architecture", "cudaerrornokernelimagefordevice")


def decide(cap, archs):
    """cap: (major, minor) of the card, None without a CUDA device; archs: torch.cuda.get_arch_list() ("sm_86",
    "sm_90a", "compute_90"). -> "ok" | "new" (newer than the build lists) | "old" (below its minimum) | "none".
    A cubin sm_XY runs on the same major with minor >= Y (sm_86 code on an sm_89 card); PTX compute_XY is compiled on
    load for any card >= XY. An empty list (a build that does not say) counts as covered."""
    if cap is None:
        return "none"
    cc, codes = cap[0] * 10 + cap[1], []
    for a in archs or ():
        kind, _, v = str(a).partition("_")
        try:
            code = int(v.rstrip("af"))
        except ValueError:
            continue
        codes.append(code)
        if (kind == "sm" and code // 10 == cc // 10 and cc >= code) or (kind == "compute" and cc >= code):
            return "ok"
    if not codes:
        return "ok"
    return "new" if cc > max(codes) else "old"


def probe(torch):
    """The kinds of ops the trackers run, on tiny tensors on the card; raises what CUDA raises."""
    import torch.nn.functional as F
    d = "cuda"
    x = F.conv2d(torch.randn(1, 3, 16, 16, device=d), torch.randn(4, 3, 3, 3, device=d), padding=1)
    x = F.interpolate(x, size=(8, 8), mode="bilinear", align_corners=False)
    x = F.grid_sample(x, torch.zeros(1, 4, 4, 2, device=d), align_corners=False)
    q = torch.randn(1, 2, 8, 16, device=d)
    a = F.scaled_dot_product_attention(q, q, q).softmax(-1)
    with torch.autocast("cuda", dtype=torch.float16):
        h = torch.bmm(q[0], q[0].transpose(1, 2))
    float((x.sum() + a.sum() + h.float().sum()).item())  # .item() waits for the kernels: an async error shows here
    torch.cuda.synchronize()
    del x, q, a, h
    torch.cuda.empty_cache()


def _check(full=True):
    try:
        import torch
    except Exception as e:  # ImportError, or OSError: a DLL that does not load (missing VC++ runtime, antivirus quarantine)
        why = f"{type(e).__name__}: {e}".splitlines()[0][:300]
        print(f"pawtrack: PyTorch could not load ({why}): the GPU trackers are off, the CPU trackers still work", file=sys.stderr)
        return {"state": "none", "reason": "torch", "probe": why}
    try:
        if not (_REAL or torch.cuda.is_available)():
            return {"state": "none"}
        cap = tuple(torch.cuda.get_device_capability(0))
        archs = torch.cuda.get_arch_list()
        name = torch.cuda.get_device_name(0)
        out = {"state": "ok", "name": name, "capability": f"{cap[0]}.{cap[1]}"}
        verdict = decide(cap, archs)
        if verdict in ("new", "old"):
            out["outside"] = verdict
        elif not full:
            return {**out, "_later": True}  # paw-1dt4: in the list, probed at the first use instead
        t = time.perf_counter()
        try:
            probe(torch)
        except Exception as e:
            out["probe"] = f"{type(e).__name__}: {e}".splitlines()[0][:300]
            if not any(m in str(e).lower() for m in KERNEL_MARKS):
                out["state"] = "unknown"   # another failure: the GPU stays on (a later fatal error restarts the sidecar)
                print(f"pawtrack: GPU probe on {name} failed ({out['probe']}); leaving CUDA on", file=sys.stderr)
                return out
            out["state"] = "unsupported"
            out["reason"] = "old" if verdict == "old" else "new"
            torch.cuda.is_available = lambda: False  # the one switch every tracker and vram.py read
            print(f"pawtrack: {name} (sm_{cap[0]}{cap[1]}) cannot run this torch build ({out['probe']}; built for "
                  f"{' '.join(archs)}): CUDA is off for this process, the trackers run on the CPU", file=sys.stderr)
            return out
        out["probe_ms"] = round(1000 * (time.perf_counter() - t), 1)
        if "outside" in out:
            print(f"pawtrack: {name} (sm_{cap[0]}{cap[1]}) is outside this torch build's list ({' '.join(archs)}) "
                  "but its probe passed: the GPU stays on", file=sys.stderr)
        return out
    except Exception:
        traceback.print_exc()
        return {"state": "unknown"}


def state(probe=True):
    """-> {"state": "ok" | "unsupported" | "none" | "unknown", "name"?, "capability"? ("12.0"), "outside"? ("new" |
    "old": not in the build's list), "reason"? ("new" | "old", unsupported; "torch": none, torch did not load), "probe"?
    (its error), "probe_ms"?}. Probed once per process. probe=False (list): a card in the build's list answers "ok"
    unprobed (not kept: the first use probes it)."""
    global STATE, _BUSY
    if STATE is None and not _BUSY:
        _BUSY = True
        try:
            s = _check(probe)
            if s.pop("_later", False):
                return s
            STATE = s
        finally:
            _BUSY = False
    return STATE or {"state": "unknown"}


def _patch(torch):
    global _REAL
    if _REAL is not None:
        return
    real = _REAL = torch.cuda.is_available

    def is_available():
        if _BUSY:
            return real()
        return state()["state"] != "unsupported" and real()
    torch.cuda.is_available = is_available


class _OnImport(importlib.abc.MetaPathFinder):
    """Patches torch right after its first import, whoever imports it."""
    busy = False

    def find_spec(self, name, path=None, target=None):
        if name != "torch" or self.busy:
            return None
        self.busy = True
        try:
            spec = importlib.util.find_spec(name)
        finally:
            self.busy = False
        if spec is not None and spec.loader is not None:
            run = spec.loader.exec_module

            def exec_module(module):
                run(module)
                _patch(module)
            spec.loader.exec_module = exec_module
        return spec


def install():
    """Route torch.cuda.is_available() through state(): the first caller probes the card. Never imports torch
    (paw-1dt4): torch is patched when something first imports it. Called once at sidecar start (serve's worker, a
    one-shot run). Never raises."""
    try:
        if "torch" in sys.modules:
            _patch(sys.modules["torch"])
        elif not any(isinstance(f, _OnImport) for f in sys.meta_path):
            sys.meta_path.insert(0, _OnImport())
    except Exception:
        traceback.print_exc()


def hint():
    """A sentence for a driver error's message when the card is outside the build's list ('' otherwise)."""
    s = STATE or {}
    if s.get("outside") != "new" or s.get("state") == "unsupported":  # unsupported: CUDA is off, no driver errors come
        return ""
    card = str(s.get("name") or "").replace("NVIDIA GeForce ", "").replace("NVIDIA ", "")
    return f" This graphics card{f' ({card})' if card else ''} is newer than this build was made for, which may be the cause."
