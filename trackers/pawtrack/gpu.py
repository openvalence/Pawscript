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

paw-vdb3.1 (ROCm, torch.version.hip set): torch keeps the torch.cuda API and the "cuda" device. The card is named by its
gfx target (gcnArchName, "gfx1201") instead of "12.0", and it must be one the installed runtime has device libraries for
(pip's rocm-sdk-device-<target> packages): rocBLAS / MIOpen without the card's code objects can abort the process, so a
missing target is "unsupported" WITHOUT the probe. With several devices the check picks one (pick(): a supported
discrete card, the most VRAM; an iGPU only when nothing else is there) and sets it current before any model loads, so
"cuda", mem_get_info() and vram.py all mean that card. The probe's first conv2d is MIOpen's cold start (the whole probe
took 9-11 s on an RX 9070 XT): inside a track it shows as the stage "warming".
"""
import importlib.abc
import importlib.metadata
import importlib.util
import os
import re
import sys
import time
import traceback

STATE = None
_REAL = None    # torch.cuda.is_available before install()
_BUSY = False   # the check is running (the probe's own torch calls see the real answer)
KERNEL_MARKS = ("no kernel image", "invalid device function", "not compatible with the current pytorch",
                "unsupported gpu architecture", "cudaerrornokernelimagefordevice",
                "invalid kernel file")   # ROCm: torch's own kernels for the card are not installed
# AMD APUs, for a torch whose device properties lack is_integrated
APU = {"gfx902", "gfx909", "gfx90c", "gfx1013", "gfx1033", "gfx1035", "gfx1036", "gfx1037", "gfx1103", "gfx1150",
       "gfx1151", "gfx1152", "gfx1153"}


def gfx(props):
    """'gfx1201' from a ROCm device's properties ('gfx90a:sramecc+:xnack-' loses its feature flags)."""
    return str(getattr(props, "gcnArchName", "") or "").split(":")[0].lower()


def shipped(torch):
    """The gfx targets the installed ROCm runtime has device libraries for: its rocm-sdk-device-<target> packages
    ("gfx1201"; a family package "gfx120X-all" is kept as "gfx120x"), else the torch build's own list."""
    have = set()
    for d in importlib.metadata.distributions():
        n = str(d.metadata["Name"] or "").lower().replace("_", "-")
        if n.startswith("rocm-sdk-device-"):
            have.add(n.removeprefix("rocm-sdk-device-").split("-")[0])
    return have or {str(a).split(":")[0].lower() for a in torch.cuda.get_arch_list() or ()}


def covered(arch, have):
    """Is gfx target `arch` in `have` ("gfx120x" covers gfx1200 .. gfx120f)? An empty `have` (nothing says) covers it."""
    return not have or any(arch == t or (t.endswith("x") and arch.startswith(t[:-1])) for t in have)


def _order(arch):
    try:
        return int(arch[3:].replace("x", "f"), 16)   # gfx90a < gfx1030 < gfx1201 < gfx1250
    except ValueError:
        return 0


def decide_hip(arch, have):
    """-> "ok" | "new" | "old" for a ROCm card: covered by the runtime, else newer / older than its newest target."""
    if covered(arch, have):
        return "ok"
    return "new" if _order(arch) > max(map(_order, have)) else "old"


def pick(torch, ok):
    """-> the device index to use: a usable (ok(props)) discrete card with the most VRAM before an integrated one."""
    n = torch.cuda.device_count()
    if n < 2:
        return 0
    props = [torch.cuda.get_device_properties(i) for i in range(n)]
    return max(range(n), key=lambda i: (ok(props[i]), not (getattr(props[i], "is_integrated", 0) or gfx(props[i]) in APU),
                                        props[i].total_memory))


def cache_env():
    """MIOpen's kernel database and cache go to the models folder's .cache, never %USERPROFILE%\\.miopen (no-op on CUDA).
    A value set from outside is kept."""
    from pawtrack import MODELS_DIR
    d = str(MODELS_DIR / ".cache" / "miopen")
    os.environ.setdefault("MIOPEN_USER_DB_PATH", d)
    os.environ.setdefault("MIOPEN_CUSTOM_CACHE_DIR", d)


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
        archs = torch.cuda.get_arch_list()
        hip = bool(getattr(torch.version, "hip", None))
        if hip:
            have = shipped(torch)
            dev = pick(torch, lambda p: covered(gfx(p), have))
            arch = gfx(torch.cuda.get_device_properties(dev))
            verdict, cap, card, archs = decide_hip(arch, have), arch, arch, sorted(have)
        else:
            dev = pick(torch, lambda p: decide((p.major, p.minor), archs) == "ok")
            c = tuple(torch.cuda.get_device_capability(dev))
            verdict, cap, card = decide(c, archs), f"{c[0]}.{c[1]}", f"sm_{c[0]}{c[1]}"
        if dev:
            torch.cuda.set_device(dev)   # before any model loads: "cuda" is this card from here on
        name = torch.cuda.get_device_name(dev)
        out = {"state": "ok", "name": name, "capability": cap}
        if hip and verdict != "ok":
            out.update(state="unsupported", reason=verdict, outside=verdict)   # no device libraries: never probed
            torch.cuda.is_available = lambda: False
            print(f"pawtrack: {name} ({card}) is not in this ROCm runtime ({' '.join(archs)}): the GPU is off for this "
                  "process, the trackers run on the CPU", file=sys.stderr)
            return out
        if verdict in ("new", "old"):
            out["outside"] = verdict
        elif not full:
            return {**out, "_later": True}  # paw-1dt4: in the list, probed at the first use instead
        t = time.perf_counter()
        try:
            from pawtrack.progress import sub
            with sub("warming"):   # paw-vdb3.1: the first conv2d is MIOpen's cold start on AMD (9-11 s)
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
            print(f"pawtrack: {name} ({card}) cannot run this torch build ({out['probe']}; built for "
                  f"{' '.join(archs)}): CUDA is off for this process, the trackers run on the CPU", file=sys.stderr)
            return out
        out["probe_ms"] = round(1000 * (time.perf_counter() - t), 1)
        if "outside" in out:
            print(f"pawtrack: {name} ({card}) is outside this torch build's list ({' '.join(archs)}) "
                  "but its probe passed: the GPU stays on", file=sys.stderr)
        return out
    except Exception:
        traceback.print_exc()
        return {"state": "unknown"}


def state(probe=True):
    """-> {"state": "ok" | "unsupported" | "none" | "unknown", "name"?, "capability"? ("12.0"; ROCm: "gfx1201"),
    "outside"? ("new" | "old": not in the build's list), "reason"? ("new" | "old", unsupported; "torch": none, torch did not load), "probe"?
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
        cache_env()
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
    card = re.sub(r"^(NVIDIA (GeForce )?|AMD (Radeon )?)", "", str(s.get("name") or ""))
    return f" This graphics card{f' ({card})' if card else ''} is newer than this build was made for, which may be the cause."
