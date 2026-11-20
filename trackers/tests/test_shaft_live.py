"""paw-rxr3, v4.44: while the SAM shaft pass runs, stage "shaft" counts its frames (out of 1000) and carries the frame's
t_ms and the outline SAM just made, in order, so the app can show that frame with it. CPU stand-in for SAM (the
rendered clip of test_shaft.py); the pass's own results do not change."""
import time

import numpy as np

import shaft_clip as sc
from pawtrack import cli, progress, registry, shaft


def _video(tmp_path):
    import cv2
    path = tmp_path / "shaft.avi"
    vw = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), 24, (sc.W, sc.H))
    for i in range(sc.N):
        vw.write(sc.frame(i))
    vw.release()
    return str(path)


def _tolerant(frames, roi, size, p):  # the oracle through MJPG: the shaft colour within a margin
    for k, img in frames:
        yield k, np.all(np.abs(img.astype(int) - sc.SHAFT_C) <= 40, axis=2), 1.0


def _track(path, monkeypatch, ev):
    def fake(frames, roi, p):
        for i, (t, img) in enumerate(frames):
            v = sc.truth(i)["in"]
            yield t, {"value": v, "channels": {"raw_px": v}}, {"points": [], "boxes": [], "pts": sc.pts(i)}
    monkeypatch.setitem(registry.TRACKERS, "fake_points", registry.Tracker("fake_points", "fake", "none", [], fake, ["raw_px"]))
    monkeypatch.setattr(shaft, "sam_chunk", _tolerant)
    sq = [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]]
    groups = [{"who": g["who"], "part": g["part"], "poly": sq, "t_ms": 0, **({"shaft": True} if g["part"] == "penis" else {})}
              for g in sc.GROUPS]
    return cli.cmd_track({"cmd": "track", "video": path, "tracker": "fake_points", "start_ms": 0, "end_ms": 10000,
                          "roi": None, "cuts": [], "groups": groups, "tags": [], "params": {}}, ev.append)


def test_shaft_stage_streams_frames_outlines_and_fractions_in_order(tmp_path, monkeypatch):
    monkeypatch.setattr(cli, "SHOW_HZ", 1e9)  # every frame SAM keeps
    path, ev = _video(tmp_path), []
    res = _track(path, monkeypatch, ev)
    sh = [e for e in ev if e["type"] == "progress" and e.get("stage") == "shaft"]
    live = [e for e in sh if "outline" in e]
    assert len(live) >= 0.8 * sc.N, len(live)
    t = [e["t_ms"] for e in live]
    assert t == sorted(t) and len(set(t)) == len(t), "one event per frame, in time order"
    d = [e["done"] for e in sh]
    assert all(e["total"] == progress.STEPS for e in sh) and d == sorted(d) and d[-1] == progress.STEPS
    ts = np.array([r[0] for r in res["samples"]])
    for e in live[::10]:  # the outline is on the shaft at that frame (SAM's crop of it): inside the shaft colour's box
        k = int(np.argmin(np.abs(ts - e["t_ms"])))
        ys, xs = np.nonzero(np.all(np.abs(sc.frame(k).astype(int) - sc.SHAFT_C) <= 2, axis=2))
        o = np.array(e["outline"])
        assert 3 <= len(o) <= 32 and ((0 <= o) & (o <= 1)).all()
        lo, hi = np.array([xs.min() / sc.W, ys.min() / sc.H]), np.array([xs.max() / sc.W, ys.max() / sc.H])
        assert (o.min(0) >= lo - 0.03).all() and (o.max(0) <= hi + 0.03).all() and (np.ptp(o, 0) > 0.02).all(), (o, lo, hi)
    after = ev[ev.index(sh[-1]) + 1:]
    nxt = next(e for e in after if e["type"] == "progress")
    assert nxt["stage"] == "points" and nxt["total"] != progress.STEPS, "the job's counts come back after the pass"


def test_outline_events_are_capped_per_second_and_change_nothing(tmp_path, monkeypatch):
    path = _video(tmp_path)
    ev_slow, ev_all = [], []
    a = _track(path, monkeypatch, ev_slow)  # SHOW_HZ as shipped
    monkeypatch.setattr(cli, "SHOW_HZ", 1e9)
    b = _track(path, monkeypatch, ev_all)
    n = lambda ev: sum("outline" in e for e in ev)
    assert n(ev_slow) < n(ev_all)
    strip = lambda r: {k: v for k, v in r.items() if k not in ("notes", "scenes")}
    assert strip(a) == strip(b) and a["scenes"][0]["shaft"]["c1_penis"]["source"] == "sam"


def test_outline_of_a_mask():
    m = np.zeros((40, 60), bool)
    m[10:30, 20:50] = True
    o = shaft.outline(m, (100, 50), (200, 100))
    xs, ys = [p[0] for p in o], [p[1] for p in o]
    assert (min(xs), max(xs), min(ys), max(ys)) == (0.6, 0.745, 0.6, 0.79)
    assert shaft.outline(np.zeros((5, 5), bool), (0, 0), (5, 5)) == []
    disc = np.hypot(*np.mgrid[-50:50, -50:50]) < 45
    assert len(shaft.outline(disc, (0, 0), (100, 100))) <= 32


def test_show_costs_under_two_percent_on_the_cpu_stand_in(monkeypatch):
    """The app's outline events (SHOW_HZ) cost under 2 % of the pass, on the CPU stand-in (cheaper than real SAM, so
    the share is an upper bound). paw-ky07: the time spent in show itself, against the pass without it. Two whole-pass
    wall clocks differ by +-4 % run to run on a loaded desktop (and the second of a pair ran slower even with a no-op
    show), far above the 0.3 ms an outline costs; that difference failed at random."""
    monkeypatch.setattr(shaft, "sam_chunk", sc.oracle)
    ts, pts, groups = sc.clip()
    g = next(x for x in groups if x["name"] == "c1_penis")
    P = {"shaft_sam": True, "shaft_model": "small", "shaft_reprompt": 48, "shaft_stride": 1}
    last, spent = [float("-inf")], [0.0]

    def show(k, m, off):
        now = time.perf_counter()
        if now - last[0] >= 1 / cli.SHOW_HZ:
            last[0] = now
            shaft.outline(m, off, (sc.W, sc.H))
        spent[0] += time.perf_counter() - now

    def once(**kw):
        t = time.perf_counter()
        shaft.run_scene(ts, pts, groups, g, (sc.W, sc.H), P, frame_at=sc.frame, **kw)
        return time.perf_counter() - t
    base = min(once() for _ in range(3))
    costs = []
    for _ in range(3):
        spent[0], last[0] = 0.0, float("-inf")
        once(show=show)
        costs.append(spent[0])
    cost = min(costs)
    print(f"\nshaft pass (CPU stand-in): {base:.3f} s, outlines {1000 * cost:.1f} ms ({100 * cost / base:.2f} %)")
    assert cost < 0.02 * base
