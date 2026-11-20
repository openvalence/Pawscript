"""End-to-end through the real stdin/stdout contract (subprocess), on the synthetic clip."""
import json
import subprocess
import sys

import numpy as np
import pytest

import make_video as mv

BOX = {"kind": "box", "x": (mv.CX - 25) / mv.W, "y": (mv.CY - 25) / mv.H, "w": 50 / mv.W, "h": 50 / mv.H}
TWO = {"kind": "points", "points": [[mv.CX / mv.W, mv.CY / mv.H], [mv.ANCHOR[0] / mv.W, mv.ANCHOR[1] / mv.H]]}
DUR_MS = mv.N * 1000 // mv.FPS
CUT_MS = mv.CUT_FRAME * 1000 / mv.FPS
FRAME_MS = 1000 / mv.FPS


@pytest.fixture(scope="session")
def video(tmp_path_factory):
    return str(mv.make(tmp_path_factory.mktemp("v") / "synthetic.mp4"))


def run(req):
    p = subprocess.run([sys.executable, "-c", "from pawtrack.cli import main; main()"],
                       input=json.dumps(req), capture_output=True, text=True, encoding="utf-8")
    events = [json.loads(line) for line in p.stdout.splitlines()]  # every stdout line must be JSON
    return p.returncode, events, p.stderr


def test_list():
    code, ev, _ = run({"cmd": "list"})
    assert code == 0 and len(ev) == 1 and ev[0]["type"] == "result"
    trackers = {t["id"]: t for t in ev[0]["trackers"]}
    assert {"lk_box", "lk_two_point", "template"} <= trackers.keys()
    assert trackers["lk_two_point"]["roi"] == "points"
    keys = {"key", "label", "type", "default", "min", "max", "choices"}
    for t in trackers.values():
        assert all(set(p) - {"hint"} == keys for p in t["params"])  # hint: optional (v4.10)
        assert all(isinstance(p.get("hint", ""), str) for p in t["params"])
        assert any(p["key"].startswith("pipe_") for p in t["params"])
        assert {"loop_fold", "held_retime"} <= {p["key"] for p in t["params"]}
        assert isinstance(t["channels"], list)
    assert trackers["lk_box"]["channels"] == ["raw_px"]  # raw amplitude in frame px
    assert ev[0]["scene_params"] and ev[0]["loop_params"]
    assert "describe_params" in ev[0]  # null until pawtrack/describe.py exists


def test_error_contract():
    code, ev, err = run({"cmd": "track", "video": "nope.mp4", "tracker": "nope", "start_ms": 0, "end_ms": 1, "roi": None, "params": {}})
    assert code != 0 and ev[-1]["type"] == "error" and "nope" in ev[-1]["message"] and "Traceback" in err


def test_scenes(video):
    code, ev, err = run({"cmd": "scenes", "video": video, "params": {}})
    assert code == 0, err
    scenes = ev[-1]["scenes"]
    assert len(scenes) == 2, scenes
    assert scenes[0]["start_ms"] == 0 and scenes[0]["end_ms"] == scenes[1]["start_ms"]
    assert abs(scenes[1]["start_ms"] - CUT_MS) <= FRAME_MS + 1
    assert scenes[-1]["end_ms"] == ev[-1]["media"]["duration_ms"] == DUR_MS


def test_probe(video):
    code, ev, err = run({"cmd": "probe", "video": video})
    assert code == 0, err
    assert ev[-1]["media"] == {"duration_ms": DUR_MS, "fps": mv.FPS, "is_vfr": False,
                               "width": mv.W, "height": mv.H, "frame_count": mv.N}


@pytest.mark.parametrize("tracker,roi,params,sign", [
    ("lk_box", BOX, {}, -1),
    ("lk_box", BOX, {"axis": "auto"}, -1),
    ("template", BOX, {}, -1),
    ("lk_two_point", TWO, {}, +1),
])
def test_track(video, tracker, roi, params, sign):
    code, ev, err = run({"cmd": "track", "video": video, "tracker": tracker, "start_ms": 0,
                         "end_ms": DUR_MS, "roi": roi, "params": params})
    assert code == 0, err
    frames = [e for e in ev if e["type"] == "frame"]
    assert len(frames) == mv.N
    assert [round(e["t_ms"] / FRAME_MS) for e in frames] == list(range(mv.N))  # PTS-based, in order
    # cut frame is flagged with value null
    assert any(e["value"] is None and abs(e["t_ms"] - CUT_MS) <= FRAME_MS + 1 for e in frames)

    res = ev[-1]
    assert len(res["samples"]) == mv.N and res["events"] == [] and set(res["channels"]) == {"raw_px"}
    raw = np.array([v for _, v in res["channels"]["raw_px"] if v is not None])
    assert np.ptp(raw) > 50  # raw amplitude in frame px: the blob moves +-70 px
    assert any(v is None for _, v in res["samples"])  # the cut frame
    sc = res["scenes"]
    assert [s["sign"] for s in sc] == [1, 1] and sc[0]["start_ms"] == 0 and abs(sc[1]["start_ms"] - CUT_MS) <= FRAME_MS + 1
    assert sc[0]["end_ms"] == sc[1]["start_ms"] and abs(sc[1]["end_ms"] - DUR_MS) <= 1
    t, v = np.array([s for s in res["samples"] if s[1] is not None]).T
    assert v.min() >= 0 and v.max() <= 1
    gt = sign * np.sin(2 * np.pi * mv.FREQ * t / 1000)
    r = np.corrcoef(v, gt)[0, 1]
    assert r > 0.9, r

    # 0.8 Hz over 10 s = 16 strokes; each scene adds a partial stroke at its ends
    pts = res["points"]
    d = np.sign(np.diff([q["pos"] for q in pts]))
    d = d[d != 0]
    strokes = 1 + int(np.count_nonzero(d[1:] != d[:-1]))
    assert 16 <= strokes <= 21, (strokes, pts)
    assert len(pts) <= 2 * strokes + 4, len(pts)  # default simplify keeps mostly turning points
    ats = [q["at"] for q in pts]
    assert ats == sorted(set(ats)) and all(0 <= q["pos"] <= 100 for q in pts)


@pytest.mark.parametrize("cuts,starts", [
    ([7000, 1010, -5, 99999], [0, 1033, 7000]),  # first frame >= each cut; outside the range: ignored; the real cut too
    ([], [0]),                                   # one scene for the whole range, the real cut is not split
    (None, [0, round(CUT_MS)]),                  # absent / null: the detector, as before
])
def test_track_cuts(video, cuts, starts):
    req = {"cmd": "track", "video": video, "tracker": "lk_box", "start_ms": 0, "end_ms": DUR_MS, "roi": BOX, "params": {}}
    if cuts is not None:
        req["cuts"] = cuts
    code, ev, err = run(req)
    assert code == 0, err
    res = ev[-1]
    assert [s["start_ms"] for s in res["scenes"]] == starts
    nulls = [t for t, v in res["samples"] if v is None]
    assert all(any(abs(t - s) <= 1 for s in starts[1:]) for t in nulls)  # only cut frames are flagged


def test_vfr_timestamps(video, tmp_path):
    """Frames 30..59 removed but PTS kept: times must jump 967 -> 2000 ms, not slide down."""
    vfr = str(mv.make_vfr(video, tmp_path / "vfr.mp4"))
    code, ev, err = run({"cmd": "track", "video": vfr, "tracker": "lk_box", "start_ms": 500,
                         "end_ms": 3000, "roi": BOX, "params": {"cut_enabled": False}})
    assert code == 0, err
    got = [e["t_ms"] for e in ev if e["type"] == "frame"]
    want = [round(n * FRAME_MS) for n in range(mv.N) if not 30 <= n < 60 and 500 <= n * FRAME_MS < 3000]  # [start_ms, end_ms): the frame at end_ms is the next shot's
    assert got == want
    code, ev, err = run({"cmd": "probe", "video": vfr})
    assert code == 0 and ev[-1]["media"]["is_vfr"] and ev[-1]["media"]["frame_count"] == mv.N - 30


def test_describe_missing_is_clean_error(video):
    code, ev, _ = run({"cmd": "describe", "video": video, "start_ms": 0, "end_ms": 1000, "params": {}})
    if code == 0:
        pytest.skip("pawtrack/describe.py is installed")
    assert ev[-1]["type"] == "error" and "describe" in ev[-1]["message"]


def test_static_box_info_note(video):
    """A box on the static background: raw_px stays within a few px and the info note is logged."""
    still = {"kind": "box", "x": (mv.ANCHOR[0] - 30) / mv.W, "y": (mv.ANCHOR[1] - 20) / mv.H, "w": 60 / mv.W, "h": 40 / mv.H}
    code, ev, err = run({"cmd": "track", "video": video, "tracker": "lk_box", "start_ms": 0, "end_ms": 2000,
                         "roi": still, "params": {}})
    assert code == 0, err
    raw = np.array([v for _, v in ev[-1]["channels"]["raw_px"] if v is not None])
    assert np.ptp(raw) < 4 and "pawtrack: info: lk_box raw_px peak-to-peak" in err
    notes = ev[-1]["notes"]
    assert [n["code"] for n in notes] == ["low_motion"] and notes[0]["scene_index"] == 0
    assert notes[0]["message"].startswith("lk_box raw_px peak-to-peak")
