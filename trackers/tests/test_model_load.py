"""paw-mhme: what the owner's "loading the model" covered. TAPNext++ on a buffered scene (painted groups / a seed frame
inside the scene) tracked the whole scene, both ways, under the load's stage. v4.43: every stage before the first frame
has its own name, the load names its parts and gives the stage back, the buffered scene counts its tracked frames, the
job's stage times go to stderr, nothing touches the network, and a second track in one serve session does not load
again. A tiny stand-in for tapnet's TAPNext on the CPU; the real checkpoint path (mmap) is exercised."""
import socket
import sys
import types
import urllib.request

import pytest

torch = pytest.importorskip("torch", reason="torch comes with the ML extras (uv sync --extra tapnext); the base sync has none")

import pawtrack.progress as pr
from pawtrack import serve
from pawtrack.trackers import tapnext_points as tp
from test_cli import BOX, DUR_MS, video  # noqa: F401  (video: the session fixture)

PARAMS = {"model": "256", "chunk": 4, "box_points": 16, "reseed_every_ms": 0, "sem_groups": False,
          "held_input": "off"}
BUILT = []


class FakeTAPNext(torch.nn.Module):
    """tapnet's call signature: video (1,T,S,S,3), query_points (1,N,3) [t,y,x] once, state -> tracks (1,T,N,2) [y,x] in
    256-px space, coordinate logits (1,T,N,2K), visibility logits (1,T,N,1), state."""

    def __init__(self, image_size):
        super().__init__()
        BUILT.append(image_size)
        self.w = torch.nn.Parameter(torch.zeros(3))

    def forward(self, video, query_points=None, state=None):
        q = query_points if state is None else state
        T, N = video.shape[1], q.shape[1]
        tracks = q[:, None, :, 1:].expand(1, T, N, 2) + self.w[0]
        return tracks, torch.zeros(1, T, N, 8), torch.ones(1, T, N, 1), q


@pytest.fixture()
def fake_tapnet(tmp_path, monkeypatch):
    mod = types.ModuleType("tapnet.tapnext.tapnext_torch")
    mod.TAPNext = FakeTAPNext
    pkg, sub = types.ModuleType("tapnet"), types.ModuleType("tapnet.tapnext")
    pkg.tapnext, sub.tapnext_torch = sub, mod
    monkeypatch.setitem(sys.modules, "tapnet", pkg)
    monkeypatch.setitem(sys.modules, "tapnet.tapnext", sub)
    monkeypatch.setitem(sys.modules, "tapnet.tapnext.tapnext_torch", mod)
    (tmp_path / "tapnext").mkdir()
    # a Lightning-style file as upstream ships it: the weights under state_dict beside optimizer state
    torch.save({"state_dict": {"tapnext.w": torch.tensor([0.0, 1.0, 2.0])}, "optimizer_states": [torch.ones(1000)]},
               tmp_path / "tapnext" / tp.CK["256"][1])
    monkeypatch.setattr(tp, "CACHE", tmp_path)
    monkeypatch.setattr(tp, "_MODELS", {})
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)  # CPU only: never the card in a test

    def offline(*a, **k):
        raise AssertionError("network access during a track")
    monkeypatch.setattr(urllib.request, "urlopen", offline)
    monkeypatch.setattr(urllib.request, "urlretrieve", offline)
    monkeypatch.setattr(socket.socket, "connect", offline)
    BUILT.clear()
    yield


def order(ev):
    st = [e.get("stage") for e in ev if e["type"] == "progress"]
    return [s for k, s in enumerate(st) if not k or s != st[k - 1]]


def req(video, rid):  # noqa: F811
    # the roi drawn mid-scene: the scene is buffered and tracked both ways from there (as with painted groups)
    return {"id": rid, "cmd": "track", "video": video, "tracker": "tapnext_points", "start_ms": 0, "end_ms": DUR_MS // 2,
            "roi": {**BOX, "t_ms": DUR_MS // 4}, "cuts": [], "params": PARAMS}


def test_stages_before_the_first_frame_and_one_load_per_serve_session(video, fake_tapnet, monkeypatch, capsys):  # noqa: F811
    monkeypatch.delenv("PAWSCRIPT_GPU_FRACTION", raising=False)
    init = pr.Progress.__init__
    monkeypatch.setattr(pr.Progress, "__init__", lambda self, emit, total=0, every=0.5: init(self, emit, total, 0.0))  # every event
    out = []
    svc = serve.Service(out.append)
    svc.run(serve.Job("a1", req(video, "a1")))
    svc.run(serve.Job("a2", req(video, "a2")))
    ev = {rid: [e for e in out if e.get("id") == rid] for rid in ("a1", "a2")}
    assert [e[-1]["type"] for e in ev.values()] == ["result", "result"], [e[-1] for e in ev.values()]
    assert BUILT == [(256, 256)], "the second track of the session loads nothing"

    first, second = order(ev["a1"]), order(ev["a2"])
    i = first.index("model read")
    # the model loads inside the buffered scene's tracking, names its two parts, then "inference" comes back
    assert first[:3] == ["starting", "levels", "tracking"] and "reading" in first[:i], first
    assert first[i - 1:i + 3] == ["inference", "model read", "model gpu", "inference"], first
    assert first[-3:] == ["frames", "points", "result"], first
    assert "model read" not in second and "model gpu" not in second and "inference" in second, second

    inf = [e for e in ev["a2"] if e["type"] == "progress" and e.get("stage") == "inference"]
    assert inf[-1]["done"] == inf[-1]["total"] == pr.STEPS, "inference counts both passes to the end"
    d = [e["done"] for e in inf]
    d = d[d.index(0):]  # before it: the buffer's end in job frames (the scene's "inference" as before v4.43)
    assert d == sorted(d) and len(set(d)) > 10, d

    times = [l for l in capsys.readouterr().err.splitlines() if l.startswith("pawtrack: stage times ")]
    assert len(times) == 2 and times[0].startswith("pawtrack: stage times starting ") and " model read " in times[0], times
    assert " model read " not in times[1]


def test_same_rows_whether_or_not_the_model_was_loaded(video, fake_tapnet):  # noqa: F811
    from pawtrack import cli
    runs = []
    for _ in range(2):  # the first loads (stages inside the scene), the second finds it loaded
        ev = []
        res = cli.cmd_track({k: v for k, v in req(video, "x").items() if k not in ("id", "cmd")}, ev.append)
        runs.append(([(e["t_ms"], e["value"]) for e in ev if e["type"] == "frame"], res["samples"]))
    assert len(BUILT) == 1 and runs[0] == runs[1] and len(runs[0][0]) > 10


def test_progress_sub_gives_the_stage_back_and_times_stages():
    ev = []
    p = pr.CURRENT = pr.Progress(ev.append)
    try:
        p(0, 10, stage="inference")
        with pr.sub("model read"):
            pass
        assert p.name == "inference"
        pr.pulling("reading")
        assert p.pull == "reading" and p.name == "reading"
        t = p.table()
        assert [k for k, _ in t] == ["inference", "model read"] + (["reading"] if t[-1][0] == "reading" else [])
    finally:
        pr.CURRENT = None
    assert [e["stage"] for e in ev] == ["inference", "model read", "inference", "reading"]
    with pr.sub("x"):  # outside a track: nothing
        pass


def test_a_describe_keeps_the_tracker_when_the_card_holds_both(monkeypatch):
    from pawtrack import vram
    monkeypatch.delenv("PAWSCRIPT_GPU_FRACTION", raising=False)
    svc = serve.Service(lambda ev: None)
    svc.tracker = "tapnext_points"
    monkeypatch.setitem(vram.RESIDENT, "tapnext_points:512", {"gb": 0.9, "drop": lambda: None, "t": 0})
    room = []
    monkeypatch.setattr(svc, "_room_beside", lambda gb: room.append(gb) or True)
    svc._make_room(serve.DESCRIBE_GB, "describe")
    assert svc.tracker == "tapnext_points" and "tapnext_points:512" in vram.RESIDENT and room == [serve.DESCRIBE_GB]
    monkeypatch.setattr(svc, "_room_beside", lambda gb: False)
    svc._make_room(serve.DESCRIBE_GB, "describe")
    assert svc.tracker is None and "tapnext_points:512" not in vram.RESIDENT


def test_room_beside_is_false_without_a_cuda_context(monkeypatch):
    from pawtrack import vram
    monkeypatch.setitem(vram.RESIDENT, "x", {"gb": 1, "drop": lambda: None, "t": 0})
    monkeypatch.setattr(torch.cuda, "is_initialized", lambda: False)
    assert serve.Service(lambda ev: None)._room_beside(1.0) is False
