"""paw-iyl3: what runs after a points tracker's last frame is named (progress stages v4.41) and cheaper, with the same
bytes and numbers: serve's JSON line, the overlay of a 1000+ point frame, one fit per body in sem_tracks."""
import gc
import json
import time

import numpy as np

import pawtrack.progress as pr
from pawtrack import cli, groups
from pawtrack.registry import Tracker
from pawtrack import points as C
from test_cli import BOX, DUR_MS, run, video  # noqa: F401  (video: the session fixture)

RNG = np.random.default_rng(3)


def test_dumps_skips_the_walk_on_plain_json_and_keeps_the_bytes(monkeypatch):
    xy, vis = RNG.random((1200, 2)), RNG.random(1200) > 0.2
    frame = {"id": "app1", "type": "frame", "t_ms": 33, "value": 0.5,
             "overlay": C.overlay(xy, vis, RNG.integers(-1, 5, 1200), part=RNG.integers(0, 3, 1200), sem=RNG.integers(0, 4, 1200))}
    odd = {"a": [float("nan"), np.float32(1.5), np.int64(3), np.bool_(True), (1, 2)], "b": np.inf, "c": np.float64(0.25)}
    want = [json.dumps(cli._json_safe(x), separators=(",", ":")) for x in (frame, odd)]
    assert cli.dumps(odd) == want[1] == '{"a":[null,1.5,3,true,[1,2]],"b":null,"c":0.25}'  # NaN / numpy: the walk, as before
    monkeypatch.setattr(cli, "_json_safe", lambda x: 1 / 0)  # a plain frame never walks
    assert cli.dumps(frame) == want[0]


def _old_overlay(xy, vis, lab=None, alive=None, part=None, sem=None):  # the v4.40 body, kept to pin the output
    xy = np.clip(xy, 0, 1).round(4)
    d = 0.006
    pin = lambda i: sem is not None and sem[i] > 0
    return {"points": xy[vis].tolist(),
            "boxes": [[round(float(a) - d, 4), round(float(b) - d, 4), 2 * d, 2 * d] for a, b in xy[~vis if alive is None else ~vis & alive]],
            "pts": [[a, b, int(v)] for (a, b), v in zip(xy.tolist(), vis)] if lab is None else
                   [[a, b, int(v), int(g)] + ([int(part[i]) if part is not None else 0, int(sem[i])] if pin(i) else
                                              [int(part[i])] if part is not None and part[i] > 0 else [])
                    for i, ((a, b), v, g) in enumerate(zip(xy.tolist(), vis, lab))]}


def test_overlay_same_lists_and_faster():
    N = 2400
    xy, vis = RNG.normal(0.5, 0.4, (N, 2)), RNG.random(N) > 0.2
    lab, part = RNG.integers(-1, 5, N).astype(np.int8), RNG.integers(0, 3, N).astype(np.int8)
    sem, alive = RNG.integers(0, 7, N) * (RNG.random(N) > 0.7), RNG.random(N) > 0.1
    for kw in ({}, {"lab": lab}, {"lab": lab, "part": part}, {"lab": lab, "sem": sem}, {"alive": alive},
               {"lab": lab, "part": part, "sem": sem, "alive": alive}):
        assert json.dumps(C.overlay(xy, vis, **kw)) == json.dumps(_old_overlay(xy, vis, **kw)), kw
    kw = {"lab": lab, "part": part, "sem": sem, "alive": alive}

    def best(f):  # the garbage collector's passes over the new lists are noise here: off while timing
        out = []
        gc.disable()
        try:
            for _ in range(5):
                t = time.perf_counter()
                for _ in range(20):
                    f(xy, vis, **kw)
                out.append(time.perf_counter() - t)
        finally:
            gc.enable()
        return min(out)
    assert best(C.overlay) < 0.7 * best(_old_overlay)  # measured ~0.33


def test_sem_tracks_fits_each_body_once(monkeypatch):
    T, Nf, Np = 90, 30, 3 * 8
    t = np.arange(T)[:, None, None]
    free = RNG.random((Nf, 2)) * [0.6, 0.6] + 0.2
    pins = RNG.random((Np, 2)) * 0.1 + 0.45
    xy = np.concatenate([free[None] + 0.02 * np.sin(t / 5), pins[None] + 0.03 * np.sin(t / 5 + 1)], 1)
    vis = np.ones((T, Nf + Np), bool)
    pinned = np.r_[np.zeros(Nf, int), np.repeat([1, 2, 3], 8)]
    labels = np.where(pinned == 0, 1, -1)[None].repeat(T, 0).astype(np.int8)  # every free point on body 1
    n = [0]
    fit = groups.fit
    monkeypatch.setattr(groups, "fit", lambda *a: (n.__setitem__(0, n[0] + 1), fit(*a))[1])
    out = groups.sem_tracks(xy, vis, 30.0, 1.0, pinned, labels, np.zeros_like(labels), np.zeros((T, 2)))
    assert list(out["sem_body"]) == [1, 1, 1]
    assert n[0] == 1 + 3  # body 1 once, then each group's own scale fit (was 2 per group)
    assert np.isfinite(out["sem_rel"]).any() and np.isfinite(out["sem_scale"]).any()


def test_track_names_every_stage_after_the_last_frame(video, monkeypatch):  # noqa: F811
    """A tracker that buffers the scene (as the points trackers do): its rows go out as stage "frames", the job ends on
    "result" (v4.41); a streaming tracker keeps "tracking" for its rows."""
    def buffered(frames, roi, p):
        fr = list(frames)
        pr.stage("groups")
        for t, _ in fr:
            yield t, 0.5 + 0.1 * np.sin(t / 300), None
    reg = dict(cli.load())
    reg["buffered"] = Tracker("buffered", "buffered", "box", [], buffered, [])
    monkeypatch.setattr(cli, "load", lambda: reg)
    ev = []
    cli.cmd_track({"video": video, "tracker": "buffered", "start_ms": 0, "end_ms": DUR_MS // 2, "roi": BOX, "cuts": [], "params": {}}, ev.append)
    stages = [e.get("stage") for e in ev if e["type"] == "progress"]
    order = [s for k, s in enumerate(stages) if not k or s != stages[k - 1]]
    assert order[-5:] == ["inference", "groups", "frames", "points", "result"], order
    i = next(k for k, e in enumerate(ev) if e["type"] == "frame")
    assert [e.get("stage") for e in ev[i:] if e["type"] == "progress"][0] == "frames"


def test_streaming_tracker_rows_stay_tracking(video):  # noqa: F811
    code, ev, err = run({"cmd": "track", "video": video, "tracker": "lk_box", "start_ms": 0, "end_ms": DUR_MS // 2, "roi": BOX, "cuts": [], "params": {}})
    assert code == 0, err
    stages = [e.get("stage") for e in ev if e["type"] == "progress"]
    assert "frames" not in stages and "tracking" in stages and stages[-2:] == ["points", "result"]
