"""Release robustness (PROTOCOL v4.56): an unsupported card turns CUDA off (paw-k97q), a non-OOM CUDA error ends the
resident serve after a plain error (paw-ldfs), a job far over the VRAM budget is refused in words (paw-ldfs), a GPU
tracker on the CPU says so (paw-eeod). No GPU needed: torch / CUDA are faked."""
import sys
import types

import pytest

from pawtrack import gpu, serve, vram

CU126 = ["sm_50", "sm_60", "sm_70", "sm_75", "sm_80", "sm_86", "sm_90"]


@pytest.mark.parametrize("cap, archs, want", [
    ((8, 9), CU126, "ok"),          # RTX 4090: sm_86 cubins run on 8.9
    ((6, 1), CU126, "ok"),          # GTX 1080
    ((12, 0), CU126, "new"),        # RTX 5070: no sm_12x cubin, no PTX
    ((3, 7), CU126, "old"),         # Kepler, below the build's minimum
    ((5, 3), ["sm_60"], "old"),
    ((12, 0), CU126 + ["compute_90"], "ok"),   # PTX is compiled on load for newer cards
    ((9, 0), ["sm_90a"], "ok"),
    ((12, 0), ["sm_120"], "ok"),
    ((12, 0), [], "ok"),            # a build that does not list its archs is trusted
    ((12, 0), ["weird", "sm_x"], "ok"),
    (None, CU126, "none"),          # no CUDA device
])
def test_decide(cap, archs, want):
    assert gpu.decide(cap, archs) == want


def fake_torch(monkeypatch, cap=(12, 0), archs=CU126, available=True, boom=False, probe_err=None):
    def capability(i):
        if boom:
            raise RuntimeError("driver said no")
        return cap
    cuda = types.SimpleNamespace(is_available=lambda: available, get_device_capability=capability,
                                 get_arch_list=lambda: archs, get_device_name=lambda i: "NVIDIA GeForce RTX 5070")
    t = types.SimpleNamespace(cuda=cuda)
    monkeypatch.setitem(sys.modules, "torch", t)
    monkeypatch.setattr(gpu, "STATE", None)
    monkeypatch.setattr(gpu, "_REAL", None)
    probes = []

    def probe(torch):
        probes.append(1)
        if probe_err:
            raise RuntimeError(probe_err)
    monkeypatch.setattr(gpu, "probe", probe)
    t.probes = probes
    return t


NO_KERNEL = "CUDA error: no kernel image is available for execution on the device"


@pytest.mark.parametrize("cap, probe_err, want_state, outside, cuda_on", [
    ((8, 9), None, "ok", None, True),                 # in the list, probe passes: as before
    ((12, 0), None, "ok", "new", True),               # outside the list, probe passes (the friend's RTX 50xx): GPU stays on
    ((12, 0), NO_KERNEL, "unsupported", "new", False),  # outside the list, no kernel for it: CUDA off, said in words
    ((8, 9), NO_KERNEL, "unsupported", None, False),  # in the list but the probe finds no kernel: off as well
])
def test_arch_list_times_probe(monkeypatch, cap, probe_err, want_state, outside, cuda_on):
    t = fake_torch(monkeypatch, cap=cap, probe_err=probe_err)
    gpu.install()
    assert t.probes == [], "install alone does no CUDA work"
    assert bool(t.cuda.is_available()) is cuda_on      # the first caller probes
    s = gpu.state()
    assert s["state"] == want_state and s.get("outside") == outside and s["name"] == "NVIDIA GeForce RTX 5070"
    assert (s.get("reason") == "new") is (want_state == "unsupported")
    assert bool(t.cuda.is_available()) is cuda_on and t.probes == [1], "probed once per process"
    assert (gpu.hint() != "") is (outside == "new" and want_state == "ok")


def test_driver_error_mentions_a_card_outside_the_list(monkeypatch):
    fake_torch(monkeypatch, cap=(12, 0))
    gpu.state()
    assert gpu.hint() == " This graphics card (RTX 5070) is newer than this build was made for, which may be the cause."


def test_old_card_no_cuda_and_other_probe_failures(monkeypatch):
    t = fake_torch(monkeypatch, cap=(3, 5), probe_err=NO_KERNEL)
    assert gpu.state()["reason"] == "old" and not t.cuda.is_available()
    fake_torch(monkeypatch, available=False)
    assert gpu.state() == {"state": "none"}
    t = fake_torch(monkeypatch, cap=(12, 0), probe_err="CUDA error: an illegal memory access was encountered")
    s = gpu.state()
    assert s["state"] == "unknown" and t.cuda.is_available(), "not a kernel-image error: the GPU stays on"


def test_check_never_crashes(monkeypatch):
    t = fake_torch(monkeypatch, boom=True)
    assert gpu.state() == {"state": "unknown"} and t.cuda.is_available()   # torch left as it is

def test_list_reports_the_state_and_gpu_trackers(monkeypatch):
    from pawtrack import cli
    monkeypatch.setattr(gpu, "STATE", {"state": "unsupported", "name": "X", "capability": "12.0", "reason": "new"})
    res = cli.cmd_list({}, lambda e: None)
    assert res["gpu"]["state"] == "unsupported"
    by = {t["id"]: t["gpu"] for t in res["trackers"]}
    assert by["tapnext_points"] and by["sam2_mask"] and not by["lk_box"]   # cotracker_points: listed only where installed


# ---------------------------------------------------------------- paw-ldfs: fatal CUDA errors


class AcceleratorError(RuntimeError):
    pass


FATAL = ["CUDA error: an illegal memory access was encountered\nCUDA kernel errors might be asynchronously reported",
         "CUDA error: unspecified launch failure", "CUDA error: the launch timed out and was terminated",
         "CUDA error: no kernel image is available for execution on the device",
         "CUDA error: device-side assert triggered",
         "CUDA error: CUBLAS_STATUS_EXECUTION_FAILED when calling `cublasSgemm( handle, opa, opb, m, n, k, ...)`",
         "cuDNN error: CUDNN_STATUS_EXECUTION_FAILED"]
CLEAN = ["CUDA out of memory. Tried to allocate 174.00 MiB", "CUDA error: out of memory", "Expected all tensors to be on the same device",
         "list index out of range"]


def test_is_fatal_classifies():
    for m in FATAL:
        assert vram.is_fatal(RuntimeError(m)), m
    assert vram.is_fatal(AcceleratorError("something else"))
    for m in CLEAN:
        assert not vram.is_fatal(RuntimeError(m)), m
    try:  # wrapped by a command: the cause still counts
        try:
            raise RuntimeError("CUDA error: an illegal memory access was encountered")
        except RuntimeError as e:
            raise ValueError("tracking failed") from e
    except ValueError as e:
        assert vram.is_fatal(e)


def run_job(monkeypatch, err):
    out, exits = [], []

    class Exited(BaseException):
        pass

    def boom(req, emit):
        raise err

    def exit_(code):
        exits.append(code)
        raise Exited()
    monkeypatch.setattr(serve.os, "_exit", exit_)
    svc = serve.Service(out.append)
    svc.commands = {"x": boom}
    try:
        svc.run(serve.Job("7", {"cmd": "x"}))
    except Exited:
        pass
    return out, exits


def test_fatal_error_reports_plainly_then_exits(monkeypatch):
    out, exits = run_job(monkeypatch, RuntimeError(FATAL[0]))
    assert out == [{"id": "7", "type": "error", "message": vram.FATAL, "restart": True}] and exits == [3]
    assert "CUDA" not in out[0]["message"]


def test_oom_and_other_errors_keep_the_process(monkeypatch):
    for err in (RuntimeError("CUDA out of memory. Tried to allocate 1 GiB"), ValueError("bad roi")):
        out, exits = run_job(monkeypatch, err)
        assert exits == [] and out[0]["type"] == "error" and out[0]["message"] != vram.FATAL


# ---------------------------------------------------------------- paw-ldfs: refuse up front


def test_far_over_budget_is_refused_in_words(monkeypatch):
    from test_vram import FakeCuda
    c = FakeCuda(other=15.0, total=24.0)   # 8 GB budget
    monkeypatch.setattr(vram, "_cuda", lambda: c)
    monkeypatch.delenv("PAWSCRIPT_GPU_FRACTION", raising=False)
    monkeypatch.delenv("PAWTRACK_VRAM_GB", raising=False)
    vram.RESIDENT.clear()
    with pytest.raises(vram.OutOfVram) as e:
        vram.run(lambda: vram.cap("tapnext_points:512", 12.66))
    msg = str(e.value)
    assert "Model input size to 256" in msg and "13 GB" in msg and "8.0 GB" in msg and c.frac is None  # never clamped
    assert vram.run(lambda: (vram.cap("tapnext_points:256", 3.8), "ok")[1]) == "ok"   # within 1.5x: runs as before
    assert vram.run(lambda: (vram.cap("hydra", 11.0), "ok")[1]) == "ok"
    with pytest.raises(vram.OutOfVram) as e:
        vram.run(lambda: vram.cap("hydra", 13.0))
    assert "Close other programs" in str(e.value)
    vram.RESIDENT.clear()
    vram.JOB.clear()


# ---------------------------------------------------------------- paw-eeod: the CPU path is said


def test_gpu_tracker_on_cpu_says_so(monkeypatch, tmp_path):
    """A GPU tracker without usable CUDA: the first track progress event carries device "cpu", so does the result."""
    import torch
    import make_video as mv
    from pawtrack import cli
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    video = str(mv.make(tmp_path / "v.mp4"))
    req = {"video": video, "tracker": "lk_box", "start_ms": 0, "end_ms": 1000, "cuts": [],
           "roi": {"kind": "box", "x": (mv.CX - 25) / mv.W, "y": (mv.CY - 25) / mv.H, "w": 50 / mv.W, "h": 50 / mv.H}}
    monkeypatch.setitem(serve.GPU_TRACKERS, "lk_box", 1.0)   # the CPU tracker stands in for a GPU one (no weights here)
    ev = []
    res = cli.cmd_track(req, ev.append)
    starting = next(e for e in ev if e.get("stage") == "starting")
    assert starting["device"] == "cpu" and res["device"] == "cpu"
    monkeypatch.delitem(serve.GPU_TRACKERS, "lk_box")
    ev.clear()
    res = cli.cmd_track(req, ev.append)
    assert "device" not in res and not any("device" in e for e in ev)   # a CPU tracker: nothing to say
