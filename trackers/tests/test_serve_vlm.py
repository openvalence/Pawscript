"""GPU: director.ask (Qwen3.5-2B) resident in pawtrack serve, VRAM eviction across VLM / sam2 / describe child.
Runs only under gpu_lock (PAWSCRIPT_GPU_FRACTION set) with a VLM interpreter available:
  python trackers/gpu_lock.py --gb 8 <abs trackers/.venv python> -m pytest trackers/tests/test_serve_vlm.py -s -m gpu
Prints startup, model load, per-question latency and VRAM numbers (README "pawtrack serve")."""
import os
import time

import pytest

from pawtrack import director
from test_serve_session import Session, clips  # noqa: F401  (fixture)

pytestmark = [pytest.mark.gpu, pytest.mark.skipif(
    not os.environ.get("PAWSCRIPT_GPU_FRACTION") or not (director._has_transformers() or director.vlm_python()),
    reason="needs gpu_lock (PAWSCRIPT_GPU_FRACTION) and a VLM (vlm extra or PAWSCRIPT_VLM_PYTHON)")]


def ask(v, n, q, choices=("yes", "no")):
    return {"cmd": "director.ask", "model": "qwen3.5-2b", "res": 448, "video": v, "choices": list(choices),
            "items": [{"frames": [{"t_ms": 1000 + 997 * i, "roi": None}], "text": q} for i in range(n)]}


def test_vlm_resident_and_eviction(clips):  # noqa: F811
    s = Session()
    try:
        v = clips["long"]  # a white disc bobbing over grey noise
        t = time.perf_counter()
        s.send({"id": "a1", **ask(v, 16, "Is there a white circle in this image?")})
        a1 = s.until(["a1"], timeout=900)["a1"]
        cold = time.perf_counter() - t
        assert a1["type"] == "result", a1
        assert all(p["yes"] > 0.5 for p in a1["probs"]), a1["probs"]
        s.send({"id": "a2", **ask(v, 32, "Is this image completely black?")})
        s.send({"id": "a3", **ask(v, 8, "What is the main colour of the round shape? a = white, b = red, c = green",
                                 ("a", "b", "c"))})
        s.send({"id": "bad", **ask(v, 1, "q", ("yes", "yes please"))})  # same first token
        s.send({"id": "st", "cmd": "status"})
        r = s.until(["a2", "a3", "bad", "st"], timeout=600)
        assert r["a2"]["load_s"] < 1 and all(p["no"] > 0.5 for p in r["a2"]["probs"]), r["a2"]
        assert all(max(p, key=lambda k: p[k] if k != "_mass" else -1) == "a" for p in r["a3"]["probs"]), r["a3"]
        assert r["bad"]["type"] == "error" and "first token" in r["bad"]["message"]
        vlm = [x for x in r["st"]["resident"] if x["kind"] == "vlm"]
        assert vlm and vlm[0]["name"] == "qwen3.5-2b"
        per_q = r["a2"]["s"] / 32
        print(f"\nserve startup {s.startup_s:.2f} s; cold ask 16 q {cold:.1f} s (load_s {a1['load_s']} s, "
              f"ask {a1['s']} s); warm {per_q * 1000:.0f} ms/question (32 q in {r['a2']['s']} s); "
              f"VLM peak reserved {r['a2'].get('vram_mib')} MiB; status vram_mib {r['st']['vram_mib']} "
              f"fraction {r['st']['fraction']}")

        # a GPU tracker in this process, then describe in its child: the VLM is evicted only if the budget says so
        s.send({"id": "sam", "cmd": "track", "video": clips["syn"], "tracker": "sam2_mask", "start_ms": 0,
                "end_ms": 2000, "roi": {"kind": "box", "x": 0.43, "y": 0.35, "w": 0.14, "h": 0.3}, "params": {}})
        s.send({"id": "des", "cmd": "describe", "video": clips["syn"], "start_ms": 0, "end_ms": 4000, "params": {}})
        r = s.until(["sam", "des"], timeout=900)
        s.send({"id": "st3", "cmd": "status"})
        r.update(s.until(["st3"]))
        assert r["sam"]["type"] == "result" and r["sam"]["channels"]["area"], r["sam"]
        assert r["des"]["type"] == "result" and "tags" in r["des"], r["des"]  # hydra in the child, sam2 here
        kinds = {x["kind"] for x in r["st3"]["resident"]}
        print(f"after sam2 + describe: resident {r['st3']['resident']}")
        assert "describe" in kinds and "tracker" in kinds and "vlm" not in kinds  # 6 + 4.3 + 3 > 8 GB: VLM evicted

        t = time.perf_counter()
        s.send({"id": "a4", **ask(v, 8, "Is there a white circle in this image?")})
        a4 = s.until(["a4"], timeout=900)["a4"]
        print(f"ask after eviction: {time.perf_counter() - t:.1f} s (load_s {a4['load_s']})")
        s.send({"id": "u", "cmd": "unload", "name": None})
        u = s.until(["u"])["u"]
        assert "qwen3.5-2b" in u["unloaded"]
        s.send({"id": "bye", "cmd": "shutdown"})
        s.until(["bye"])
        assert s.p.wait(60) == 0
    finally:
        s.close()
