"""PROTOCOL v4.49 grid describe (paw-2lp7.3): the sampling grid, shot boundaries, batching, cancel and the wire format,
with a stub tagger (no GPU)."""
import json

import numpy as np
import pytest

import make_video as mv
from pawtrack import cli, describe


@pytest.fixture(scope="module")
def video(tmp_path_factory):
    return str(mv.make(tmp_path_factory.mktemp("g") / "syn.mp4"))


def stub(calls):
    """Labels 'blue' / 'red' / 'quiet'; red = the second shot's background (mean red channel high), never below the floor
    for 'quiet' (0.1)."""
    def tag(bgrs):
        calls.append(len(bgrs))
        return [[0.9 if b[..., 0].mean() > b[..., 2].mean() else 0.3, 0.9 if b[..., 2].mean() > b[..., 0].mean() else 0.25, 0.1]
                for b in bgrs]
    return ["blue", "red", "quiet"], tag


def test_grid_plan_every_step_and_shot_edges():
    ts = [round(k * 1000 / 24) for k in range(100)]
    assert describe.grid_plan(ts, 12) == [0, 12, 24, 36, 48, 49, 60, 72, 84, 96, 99]   # first / middle / last added
    # a cut at frame 30: the grid restarts there, both shots keep first / middle / last
    got = describe.grid_plan(ts, 12, [[0, ts[30]], [ts[30], 99999]])
    assert got == [0, 12, 14, 24, 29, 30, 42, 54, 64, 66, 78, 90, 99]
    # a 2-frame and a 1-frame shot keep every frame; a span narrows to its frames; a gap between shots is a shot
    assert describe.grid_plan(ts, 12, [[0, ts[2]], [ts[2], ts[3]], [ts[3], ts[50]]])[:4] == [0, 1, 2, 3]
    assert describe.grid_plan(ts, 12, None, ts[10], ts[20]) == [10, 14, 19]
    assert describe.grid_plan(ts, 12, [[0, ts[10]], [ts[20], ts[30]]], 0, ts[30])[:6] == [0, 4, 9, 10, 14, 19]
    assert describe.grid_plan(ts, 12, None, ts[50], ts[50]) == []


def test_grid_samples_batches_and_wire_format(video):
    calls, events = [], []
    res = describe.describe_grid(video, {"step": 10, "shots": [[0, 5000], [5000, 10000]], "batch": 4}, {}, events.append, stub(calls))
    s = res["samples"]
    ts = describe.frame_times(video)
    assert len(ts) == res["frames"] == mv.N
    assert [x["frame"] for x in s] == describe.grid_plan(ts, 10, [[0, 5000], [5000, 10000]])
    assert all(x["t_ms"] == ts[x["frame"]] for x in s)
    assert max(calls) == 4 and sum(calls) == len(s)                       # batched
    cut = mv.CUT_FRAME
    assert all((x["tags"]["blue"] == 0.9) == (x["frame"] < cut) for x in s)   # the cut is a sample boundary: frames 149 / 150
    assert {cut - 1, cut} <= {x["frame"] for x in s}
    assert all("quiet" not in x["tags"] for x in s)                       # under the 0.2 floor
    assert s[0]["tags"]["red"] == 0.25                                     # kept down to the floor
    streamed = [y for e in events if e["type"] == "samples" for y in e["samples"]]
    assert streamed == s
    prog = [e for e in events if e["type"] == "progress"]
    assert prog[0]["done"] == 0 and prog[-1]["done"] == prog[-1]["total"] == len(s) and {e["stage"] for e in prog} == {"grid"}
    assert set(res["thresholds"]) == {"blue", "red"}
    json.loads(cli.dumps({"type": "result", **res}))                     # plain JSON


def test_grid_times_are_exact_frames_and_only_filters(video):
    ts = describe.frame_times(video)
    res = describe.describe_grid(video, {"times": [ts[7], ts[7] + 5, ts[200], 10 ** 9], "only": ["re*"]}, {}, tagger=stub([]))
    assert [x["frame"] for x in res["samples"]] == [7, 200, mv.N - 1]     # at or before each time, once each
    assert all(set(x["tags"]) <= {"red"} for x in res["samples"])


def test_grid_cancel_stops_at_the_next_event(video):
    class Stop(BaseException):
        pass
    calls, n = [], [0]

    def emit(e):
        if e["type"] == "samples":
            n[0] += 1
            if n[0] == 2:
                raise Stop()
    with pytest.raises(Stop):
        describe.describe_grid(video, {"step": 2, "batch": 8}, {}, emit, stub(calls))
    assert sum(calls) == 16   # two batches, nothing after


def test_grid_request_validation():
    for bad in ([1], {"times": []}, {"times": ["a"]}, {"shots": [[5, 1]]}, {"step": "x"}, {"only": "anal"}):
        with pytest.raises(ValueError):
            cli.cmd_describe({"cmd": "describe", "video": "x.mp4", "grid": bad}, lambda e: None)
