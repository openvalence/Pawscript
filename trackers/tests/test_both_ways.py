"""v4.22: every tracker runs both ways from its seed frame (cli.both_ways: the video played in reverse from the seed for
the trackers that do not do it themselves). A fake tracker on fake frames, then lk_box / template on the synthetic clip
through cli.cmd_track."""
import json

import numpy as np
import pytest

import make_video as mv
from pawtrack import cli

FM = 1000 / 30
TS = [round(k * FM) for k in range(40)]
FRAMES = [(t, np.full((4, 4, 3), k, np.uint8)) for k, t in enumerate(TS)]


def fake_track(frames, roi, p):
    """A tracker whose value is the frame's distance (in frames) from the frame it was seeded on, like a displacement."""
    s = None
    for t, img in frames:
        s = int(img[0, 0, 0]) if s is None else s
        yield t, int(img[0, 0, 0]) - s, {"pts": [[0.5, 0.5 + (int(img[0, 0, 0]) - s) / 100, 1, -1, 0, 4]], "seed": s}


def rev(ts):
    return reversed([f for f in FRAMES if f[0] in set(ts)])


def test_seed_on_the_first_frame_is_the_plain_run():
    assert list(cli.both_ways(fake_track, iter(FRAMES), None, {}, TS[0], rev)) == list(fake_track(iter(FRAMES), None, {}))
    assert list(cli.both_ways(fake_track, iter(FRAMES), None, {}, TS[0] + 10, rev)) == list(fake_track(iter(FRAMES), None, {}))


def test_seed_mid_scene_covers_both_ways_with_one_seed():
    ticks = []
    rows = list(cli.both_ways(fake_track, iter(FRAMES), None, {}, TS[15] + 5, rev, tick=ticks.append))
    assert [r[0] for r in rows] == TS                                   # every frame once, in time order
    assert [r[1] for r in rows] == [k - 15 for k in range(40)]          # both halves measured from the seed frame
    assert {r[2]["seed"] for r in rows} == {15}                         # one seed frame, the same ids in both halves
    back = list(fake_track(rev(TS[:16]), None, {}))
    assert back[0] == rows[15]                                          # the seed frame's row is the same in both halves
    assert ticks == list(range(1, 17))                                  # progress over the backward half


def test_seed_on_the_last_frame_is_backward_only():
    rows = list(cli.both_ways(fake_track, iter(FRAMES), None, {}, TS[-1] + 5, rev))
    assert [r[0] for r in rows] == TS and rows[-1][1] == 0 and rows[0][1] == -39


@pytest.fixture(scope="module")
def video(tmp_path_factory):
    return str(mv.make(tmp_path_factory.mktemp("v") / "synthetic.mp4"))


def test_reverse_frames_are_the_forward_frames_reversed(video):
    from pawtrack.video import open_frames
    fwd = list(open_frames(video, 0, 1000)[1])
    back = list(cli.reverse_frames(video, [t for t, _ in fwd], chunk=7))
    assert [t for t, _ in back] == [t for t, _ in fwd][::-1]
    assert all(np.array_equal(a[1], b[1]) for a, b in zip(fwd[::-1], back))


def track(video, tracker, roi, **kw):
    ev = []
    res = cli.cmd_track({"cmd": "track", "video": video, "tracker": tracker, "start_ms": 0, "end_ms": 3000, "roi": roi,
                         "params": {}, "cuts": [], **kw}, ev.append)
    return res, {e["t_ms"]: e["overlay"] for e in ev if e.get("type") == "frame"}


@pytest.mark.parametrize("tracker", ["lk_box", "template"])
def test_trackers_run_both_ways_from_a_mid_scene_seed(video, tracker):
    box = {"kind": "box", "x": (mv.CX - 25) / mv.W, "y": (mv.CY - 25) / mv.H, "w": 50 / mv.W, "h": 50 / mv.H}
    plain, _ = track(video, tracker, box)
    first, _ = track(video, tracker, {**box, "t_ms": 0})
    assert json.dumps(plain) == json.dumps(first)                       # seeded on the first frame: unchanged, bit for bit
    y_seed = mv.blob_y(1.5)                                             # the box drawn where the blob is at 1.5 s
    roi = {**box, "y": (y_seed - 25) / mv.H, "t_ms": 1500}
    both, ov = track(video, tracker, roi)
    fwd, ovf = track(video, tracker, roi, direction="forward", seed_ms=1500)
    ts = [t for t, _ in both["samples"]]
    assert ts[0] <= 40 and ts[-1] >= 3000 - 40 and ts == sorted(set(ts))   # the whole scene, each frame once
    assert ts == [t for t, _ in plain["samples"]]
    later = [t for t in ovf if t >= 1500]
    assert later and all(ov[t] == ovf[t] for t in later)               # the forward half is the forward-only run
    # the backward half follows the blob back in time: its vertical motion before the seed tracks the true path
    vb = np.array([v for t, v in both["samples"] if t < 1500 and v is not None])
    truth = np.array([mv.blob_y(t / 1000) for t, v in both["samples"] if t < 1500 and v is not None])
    assert abs(np.corrcoef(vb, truth)[0, 1]) > 0.9


def _bframe_clip(tmp_path, fps=30, bf=2):
    import shutil
    import subprocess
    ff = shutil.which("ffmpeg")
    if not ff:
        pytest.skip("ffmpeg not on PATH")
    src = mv.make(tmp_path / "src.mp4")
    out = tmp_path / f"bf{bf}.mp4"
    subprocess.run([ff, "-v", "error", "-y", "-threads", "2", "-i", str(src), "-r", str(fps), "-c:v", "libx264", "-bf", str(bf),
                    "-g", "30", "-pix_fmt", "yuv420p", str(out)], check=True)
    return str(out)


@pytest.mark.parametrize("tracker", ["lk_box", "template"])
def test_b_frame_clip_runs_both_ways_in_time_order(tmp_path, tracker):
    """paw-ol1x: a clip with B-frames (decode order != presentation order): one row per frame, strictly increasing times,
    from a mid-clip seed and from the first frame."""
    from pawtrack.video import open_frames
    v = _bframe_clip(tmp_path)
    ts_all = [t for t, _ in open_frames(v, 0, 2999)[1]]
    assert ts_all == sorted(set(ts_all))
    box = {"kind": "box", "x": (mv.CX - 25) / mv.W, "y": (mv.blob_y(1.5) - 25) / mv.H, "w": 50 / mv.W, "h": 50 / mv.H}
    for t_seed in (0, 1500):
        res, _ = track(v, tracker, {**box, "t_ms": t_seed})
        ts = [t for t, _ in res["samples"]]
        assert ts == ts_all and np.all(np.diff(ts) > 0)


def test_a_run_that_stops_where_its_points_are_lost_keeps_its_thumbs_in_step(video, monkeypatch):
    """paw-o74b.1: a tracker that keeps fewer rows than the scene has frames (groups_only / one-way: it stops where its points
    are lost) used to leave the picture passes with one thumb per frame of the scene against fewer rows: the activity gate's
    np.interp raised "boolean index did not match" (seen on a turntable bench). The thumbs follow the rows kept."""
    import dataclasses
    real = cli.load()["lk_box"]

    def short(frames, roi, p):
        for row in real.track(frames, roi, p):
            if 800 <= row[0] <= 2200:
                yield row
    monkeypatch.setattr(cli, "load", lambda: {"lk_box": dataclasses.replace(real, track=short)})
    box = {"kind": "box", "x": (mv.CX - 25) / mv.W, "y": (mv.CY - 25) / mv.H, "w": 50 / mv.W, "h": 50 / mv.H}
    res, ov = track(video, "lk_box", box, params={"pipe_gate": "motion"})
    ts = [t for t, _ in res["samples"]]
    assert ts and ts[0] >= 800 and ts[-1] <= 2200 and len(ov) == len(ts)
