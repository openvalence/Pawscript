"""[review] gpu.py promises "Nothing here raises", but torch's import on Windows can fail with OSError (a DLL that does not
load: WinError 126 / 1114), not ImportError. Then gpu.install() raises in serve's worker thread before its loop: the worker
dies and serve answers no job at all (CPU trackers included), and cli.main fails every one-shot command."""
import importlib.abc
import sys
import threading

from pawtrack import gpu, serve


class BrokenTorch(importlib.abc.MetaPathFinder):
    def find_spec(self, name, path=None, target=None):
        if name == "torch" or name.startswith("torch."):
            raise OSError("[WinError 126] The specified module could not be found. Error loading c10.dll")
        return None


def test_a_torch_that_cannot_load_never_stops_serve(monkeypatch):
    for m in [m for m in sys.modules if m == "torch" or m.startswith("torch.")]:
        monkeypatch.delitem(sys.modules, m)
    monkeypatch.setattr(sys, "meta_path", [BrokenTorch(), *sys.meta_path])
    monkeypatch.setattr(gpu, "STATE", None)
    monkeypatch.setattr(gpu, "_REAL", None)
    gpu.install()                                   # must not raise
    assert gpu.state()["state"] in ("none", "unknown")
    monkeypatch.setattr(gpu, "STATE", None)
    out = []
    svc = serve.Service(out.append)
    svc.commands = {"ping": lambda req, emit: {"pong": True}}
    w = threading.Thread(target=svc.worker, daemon=True)
    w.start()
    svc.submit('{"id": "1", "cmd": "ping"}')
    for _ in range(50):
        if out:
            break
        w.join(0.1)
    svc.shutdown()
    assert out and out[0]["type"] == "result", f"serve answered nothing (worker alive: {w.is_alive()})"


# ---------------------------------------------------------------- paw-1dt4: no torch at all, end to end

NO_TORCH = r"""
import importlib.abc, sys
KIND = sys.argv[1]
class Block(importlib.abc.MetaPathFinder):
    def find_spec(self, name, path=None, target=None):
        if name == "torch" or name.startswith("torch."):
            if KIND == "oserror":
                raise OSError("[WinError 1114] A dynamic link library (DLL) initialization routine failed. Error loading c10.dll")
            raise ImportError("No module named 'torch'")
        return None
sys.meta_path.insert(0, Block())
sys.argv = ["pawtrack", "serve"]
from pawtrack import cli
cli.main()
"""


import pytest  # noqa: E402


@pytest.mark.parametrize("kind", ["importerror", "oserror"])
def test_serve_without_torch_answers_every_cpu_job(tmp_path, kind):
    """torch cannot be imported at all: serve says hello, list names the reason, a real lk_box track and scenes run on
    a generated clip, a GPU tracker fails as a job (not the process), and the job after it is still answered."""
    import json
    import subprocess
    import make_video as mv
    video = str(mv.make(tmp_path / "v.mp4"))
    box = {"kind": "box", "x": (mv.CX - 25) / mv.W, "y": (mv.CY - 25) / mv.H, "w": 50 / mv.W, "h": 50 / mv.H}
    jobs = [{"id": "l", "cmd": "list"},
            {"id": "t", "cmd": "track", "video": video, "tracker": "lk_box", "start_ms": 0, "end_ms": 2000, "roi": box, "params": {}},
            {"id": "g", "cmd": "track", "video": video, "tracker": "tapnext_points", "start_ms": 0, "end_ms": 500, "roi": box, "params": {}},
            {"id": "s", "cmd": "scenes", "video": video, "params": {}}]
    p = subprocess.run([sys.executable, "-c", NO_TORCH, kind], input="".join(json.dumps(j) + "\n" for j in jobs),
                       capture_output=True, text=True, encoding="utf-8", timeout=300)
    ev = [json.loads(line) for line in p.stdout.splitlines()]
    assert ev[0]["type"] == "hello", p.stderr
    end = {e["id"]: e for e in ev if e.get("type") in ("result", "error")}
    assert set(end) == {"l", "t", "g", "s"}, p.stderr[-3000:]
    gpu_state = end["l"]["gpu"]
    assert end["l"]["type"] == "result" and gpu_state["state"] == "none" and gpu_state["reason"] == "torch"
    assert ("OSError" if kind == "oserror" else "ImportError") in gpu_state["probe"]
    assert end["t"]["type"] == "result" and len(end["t"]["samples"]) > 50
    v = [s[1] for s in end["t"]["samples"] if s[1] is not None]
    assert max(v) - min(v) > 0.5, "the blob's bob is tracked"
    assert end["g"]["type"] == "error" and not end["g"].get("restart")
    assert end["s"]["type"] == "result" and len(end["s"]["scenes"]) == 2   # the clip's hard cut
