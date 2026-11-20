"""The app's resident serve (no VRAM budget): one GPU model kind at a time, idle unload; batched describe ranges."""
import time
import types

from pawtrack import cli, serve


class FakeChild:
    closed = False

    def alive(self):
        return not self.closed

    def close(self):
        self.closed = True


def test_no_budget_evicts_other_kinds_and_idle_unloads(monkeypatch):
    monkeypatch.delenv("PAWSCRIPT_GPU_FRACTION", raising=False)
    svc = serve.Service(lambda ev: None)
    assert svc.budget is None
    child = svc.describe = FakeChild()
    svc._make_room(serve.GPU_TRACKERS["tapnext_points"], "tracker")  # a track job: describe goes first
    assert child.closed and svc.describe is None
    svc.tracker = "tapnext_points"
    svc._make_room(serve.DESCRIBE_GB, "describe")  # a describe job: the tracker goes
    assert svc.tracker is None
    svc.tracker, svc.describe = "cotracker_points", FakeChild()
    svc._make_room(serve.GPU_TRACKERS["cotracker_points"], "tracker")  # the same kind stays resident
    assert svc.tracker == "cotracker_points" and svc.describe is None
    svc._idle()
    assert svc.tracker == "cotracker_points", "not idle long enough"
    svc.describe = FakeChild()
    svc.last = time.monotonic() - serve.IDLE_UNLOAD_S - 1
    svc._idle()  # paw-mhme: the children go, the tracker keeps its weights (its cached blocks went back)
    assert svc.tracker == "cotracker_points" and svc.describe is None and svc.trimmed
    svc.last = time.monotonic() - serve.TRACKER_IDLE_S - 1
    svc._idle()
    assert svc.tracker is None


def test_describe_ranges_one_load_per_range_results(monkeypatch):
    loads, calls = [], []

    def describe(video, a, b, p, prog):
        if a == 666:
            raise ValueError("no decodable frames in range")
        calls.append((a, b))
        for k in range(p["frames"]):
            prog(k + 1, p["frames"])
        return {"tags": [{"tag": "x", "score": 0.5, "box": None}]}

    fake = types.SimpleNamespace(PARAMS=[{"key": "frames", "label": "", "type": "int", "default": 2, "min": 1, "max": 9}],
                                 _MODEL=None, describe=describe)
    fake.load = lambda: (loads.append(1), setattr(fake, "_MODEL", object()))
    monkeypatch.setattr(cli, "_describe_module", lambda: fake)
    monkeypatch.setattr(cli, "probe", lambda v: {"duration_ms": 1})
    import torch
    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    ev = []
    res = cli.cmd_describe({"cmd": "describe", "video": "v", "ranges": [[0, 10], [666, 700], [20, 30]]}, ev.append)
    assert loads == [1] and calls == [(0, 10), (20, 30)]
    assert ev[0] == {"type": "progress", "done": 0, "total": 6, "stage": "model load"}
    prog = [e for e in ev if e["type"] == "progress"][1:]
    assert [(e["done"], e["range"]) for e in prog] == [(1, 0), (2, 0), (5, 2), (6, 2)] and prog[0]["ranges"] == 3
    done = [e for e in ev if e["type"] == "described"]
    assert [e["range"] for e in done] == [0, 1, 2] and "error" in done[1] and done[2]["tags"][0]["tag"] == "x"
    assert len(res["results"]) == 3 and "error" in res["results"][1]
