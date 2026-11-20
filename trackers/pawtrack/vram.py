"""This process's VRAM: the models it keeps loaded between jobs (RESIDENT) and its CUDA cap (paw-szyg).

`pawtrack serve` keeps a tracker, the Hydra tagger and SAM loaded after a job. The cap is therefore (what stays
resident) + (what this job asked for), never one command's own figure: that put the next command's first allocation
over its cap with 18-20 GB free ("2.50 GiB allowed" for Suggest after a TAPNext++ run). Before the cap is set,
residents the job does not use go, least recently used first, until resident + need fits the budget.

Budget: PAWSCRIPT_GPU_FRACTION (trackers/gpu_lock.py) x the card, else PAWTRACK_VRAM_GB, else what is free on the card
now plus what this process holds, less MARGIN_GB (nothing may spill into shared memory: the owner remotes in). With
either env var the cap is that budget itself, as before (gpu_lock reserved it; PAWTRACK_VRAM_GB is a manual override).
"""
import gc
import re
import sys
import time
import os
from contextlib import contextmanager

GB = 2 ** 30
MARGIN_GB = 1.0  # left free on the card for the desktop and whatever starts next
RESIDENT = {}    # name -> {"gb": weights measured on load, "drop": callable that forgets the model, "t": last use}
JOB = {}         # name -> GB the running job asked for (measured peak incl. the weights + headroom)
BOOST = 1.0      # this job's needs are scaled by it: raised for the retry when the first try ran out under its own cap
BOOST_MAX = 4.0
REFUSE_X = 1.5   # paw-ldfs: a job whose need is over this x the budget is refused up front, in words (LOWER)
LOWER = {"tapnext_points": "Set the tracker's Model input size to 256, or lower Frames per forward call or the points, then track again.",
         "cotracker_points": "Set the tracker's Mode to online, or lower its frames per chunk, then track again.",
         "sam2_mask": "Set the tracker's Model size smaller, or lower Frames per chunk, then track again.",
         "": "Close other programs that use the graphics card, then try again."}


class OutOfVram(RuntimeError):
    relayed = True  # serve / cli pass the message on as is


def _cuda():
    try:
        import torch
    except Exception:  # paw-1dt4: a torch that does not load (OSError from a DLL) is "no CUDA" here
        return None
    return torch if torch.cuda.is_available() else None


def budget_gb(torch):
    """-> (budget GB, fixed): fixed when an env var sets it (then it is also the cap)."""
    total = torch.cuda.get_device_properties(0).total_memory / GB
    if os.environ.get("PAWSCRIPT_GPU_FRACTION"):
        return float(os.environ["PAWSCRIPT_GPU_FRACTION"]) * total, True
    if os.environ.get("PAWTRACK_VRAM_GB"):
        return float(os.environ["PAWTRACK_VRAM_GB"]), True
    free, _ = torch.cuda.mem_get_info()
    return (free + torch.cuda.memory_reserved()) / GB - MARGIN_GB, False


def others_gb():
    return sum(r["gb"] for n, r in RESIDENT.items() if n not in JOB)


def cap(name, gb):
    """The running job uses model `name` and needs `gb` for it (its measured peak incl. the weights, plus headroom).
    Call before loading / running it, every job (a resident model is only counted once, here). Several calls in one
    job add up (a tracker + the tagger + SAM). No-op without CUDA."""
    torch = _cuda()
    if torch is None:
        return
    JOB[name] = max(float(gb) * BOOST, JOB.get(name, 0.0))
    if name in RESIDENT:
        RESIDENT[name]["t"] = time.monotonic()
    budget, fixed = budget_gb(torch)
    need = sum(JOB.values())
    if need > REFUSE_X * budget:  # paw-ldfs: clamped this far under its need a job crashes the driver (TAPNext's scan)
        raise OutOfVram(f"This needs about {need:.0f} GB of graphics memory and only {max(budget, 0):.1f} GB is free. "
                        + next((v for k, v in LOWER.items() if name.startswith(k)), LOWER[""]))
    for n in sorted((n for n in RESIDENT if n not in JOB), key=lambda n: RESIDENT[n]["t"]):
        if others_gb() + need <= budget:
            break
        from pawtrack.progress import sub
        with sub("freeing"):  # v4.43
            evict([n])
        print(f"pawtrack: unloaded {n} for {name} ({need:.1f} GB needed, budget {budget:.1f} GB)", file=sys.stderr)
    want = others_gb() + need
    total = torch.cuda.get_device_properties(0).total_memory / GB
    torch.cuda.set_per_process_memory_fraction(max(0.01, min(1.0, (budget if fixed else min(want, budget)) / total)))


@contextmanager
def loading(name, drop):
    """Wrap a model load: the model becomes resident under `name` with its measured size; drop() forgets it."""
    torch = _cuda()
    a = torch.cuda.memory_allocated() if torch else 0
    yield
    gb = (torch.cuda.memory_allocated() - a) / GB if torch else 0.0
    RESIDENT[name] = {"gb": max(gb, 0.0), "drop": drop, "t": time.monotonic()}


def evict(names=None):
    """Unload residents (all by default) and give their VRAM back. -> the names unloaded."""
    names = [n for n in (list(RESIDENT) if names is None else names) if n in RESIDENT]
    for n in names:
        RESIDENT.pop(n)["drop"]()
    if names:
        gc.collect()
        torch = _cuda()
        if torch is not None:
            torch.cuda.empty_cache()
    return names


def trim():
    """The cached blocks of finished jobs go back to the card; the residents' weights stay (paw-mhme)."""
    torch = sys.modules.get("torch")
    if torch is not None and torch.cuda.is_initialized():
        gc.collect()
        torch.cuda.empty_cache()


_LIB_STATUS = re.compile(r"(CUBLAS|CUDNN)_STATUS_([A-Z_]+)")
# paw-58lg: a cuBLAS / cuDNN status by what it means. Out of memory: an allocation failure, cuBLAS' handle that could not
# get its workspace (NOT_INITIALIZED from cublasCreate), cuDNN's INTERNAL_ERROR (its workspace, most often). Fatal: an
# execution / mapping failure, an arch mismatch. Any other status (NOT_SUPPORTED, BAD_PARAM, INVALID_VALUE, cuBLAS'
# INTERNAL_ERROR ...) is the job's input: a plain error, the process stays.
_OOM_STATUS = {("CUBLAS", "ALLOC_FAILED"), ("CUDNN", "ALLOC_FAILED"), ("CUBLAS", "NOT_INITIALIZED"), ("CUDNN", "INTERNAL_ERROR")}
_FATAL_STATUS = {"EXECUTION_FAILED", "MAPPING_ERROR", "ARCH_MISMATCH"}


def _status(s):
    m = _LIB_STATUS.search(s)
    return (m.group(1), m.group(2)) if m else None


def is_oom(e):
    s = str(e)
    return type(e).__name__ == "OutOfMemoryError" or "CUDA out of memory" in s or _status(s) in _OOM_STATUS


FATAL = "The graphics driver reported an error; the tracker restarts on the next run."
_FATAL_MARKS = ("CUDA error", "CUDA driver error", "cuDNN error")


def is_fatal(e):
    """paw-ldfs: a CUDA error that is not a clean out-of-memory (an illegal memory access, a launch failure / driver
    reset, a device-side assert, no kernel image, a cuBLAS / cuDNN execution failure) leaves this process's CUDA context
    broken: every later job would fail the same way, so the process must go. A cuBLAS / cuDNN status decides by itself
    (_FATAL_STATUS; paw-58lg). Looks through the cause chain."""
    seen = set()
    while e is not None and id(e) not in seen:
        seen.add(id(e))
        s = str(e)
        if not is_oom(e) and "out of memory" not in s:
            st = _status(s)
            if st is not None:
                if st[1] in _FATAL_STATUS:
                    return True
            elif type(e).__name__ == "AcceleratorError" or any(m in s for m in _FATAL_MARKS):
                return True
        e = e.__cause__ or e.__context__
    return False


def explain():
    loaded = ", ".join(f"{n} {r['gb']:.1f} GB" for n, r in RESIDENT.items()) or "nothing"
    asked = ", ".join(f"{n} {g / BOOST:.1f} GB" for n, g in JOB.items()) or "nothing measured"   # as asked, not as boosted for the retry
    torch = _cuda()
    free = f"; {torch.cuda.mem_get_info()[0] / GB:.1f} GB free on the card" if torch else ""
    return (f"Not enough GPU memory for this job, even after unloading the other models. Loaded: {loaded}. "
            f"This job needs: {asked}{free}. Close other GPU programs, or use a smaller model or fewer points.")


def run(fn, retry_ok=lambda: True):
    """One job: fn() with a fresh need list. On a CUDA out-of-memory error the residents the job does not use are
    unloaded, and when the card still has room beyond what the job asked for (its stated need was too small for this
    input: a large still, more points) the needs are scaled up to what the budget allows; then fn runs once more (only
    if retry_ok(): nothing it streamed would be sent twice). A second failure ends in OutOfVram with what was loaded
    and what was needed, in words. The cap never passes the budget, so nothing spills into shared memory."""
    global BOOST
    JOB.clear()
    BOOST = 1.0
    try:
        try:
            return fn()
        except Exception as e:
            if not is_oom(e):
                raise
        # the traceback is gone here, so the failed attempt's tensors can be freed
        freed = evict([n for n in RESIDENT if n not in JOB])
        gc.collect()
        room = False
        torch = _cuda()
        if torch is not None:
            torch.cuda.empty_cache()
            budget, fixed = budget_gb(torch)
            need = sum(JOB.values())
            if not fixed and need > 0 and budget > need * 1.25:
                BOOST = min(BOOST_MAX, budget / need)
                room = True
        again = (freed or room) and retry_ok()
        if not again:
            BOOST = 1.0   # no retry: the needs in JOB are as asked
        if again:
            print(f"pawtrack: CUDA out of memory; {'unloaded the models this job does not use; ' if freed else ''}"
                  f"{f'the card has room, allowing this job {BOOST:.1f}x what it asked for; ' if room else ''}retrying once", file=sys.stderr)
            try:
                return fn()
            except Exception as e:
                if not is_oom(e):
                    raise
        gc.collect()
        raise OutOfVram(explain())
    finally:
        BOOST = 1.0
