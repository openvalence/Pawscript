"""Progress events: a wall-clock cadence and a stage per change (pawtrack/progress.py, PROTOCOL.md progress v4.1)."""
import pawtrack.progress as pr
from test_cli import BOX, DUR_MS, run, video  # noqa: F401  (video: the session fixture)


def test_throttle_and_stages(monkeypatch):
    now = [100.0]
    monkeypatch.setattr(pr.time, "monotonic", lambda: now[0])
    out = []
    p = pr.Progress(out.append, total=100, every=0.5)
    p(1)                          # the first one always goes
    p(2)                          # within 0.5 s: dropped
    now[0] += 0.6
    p(3)
    p(4, stage="tracking")        # a stage change goes at once
    p(5, stage="tracking")
    p(9, total=8, force=True)     # total never below done
    assert out == [{"type": "progress", "done": 1, "total": 100}, {"type": "progress", "done": 3, "total": 100},
                   {"type": "progress", "done": 4, "total": 100, "stage": "tracking"},
                   {"type": "progress", "done": 9, "total": 9, "stage": "tracking"}]
    pr.stage("groups")            # no job: nothing, no error
    pr.CURRENT = p
    try:
        pr.stage("groups")
    finally:
        pr.CURRENT = None
    assert out[-1]["stage"] == "groups" and out[-1]["done"] == 9


def test_track_reports_stages(video):  # noqa: F811
    code, ev, err = run({"cmd": "track", "video": video, "tracker": "lk_box", "start_ms": 0, "end_ms": DUR_MS, "roi": BOX, "params": {}})
    assert code == 0, err
    prog = [e for e in ev if e["type"] == "progress"]
    stages = [e.get("stage") for e in prog]
    assert stages[0] == "scenes" and "starting" in stages and stages[-2:] == ["points", "result"] and "tracking" in stages  # "scenes": no cuts, the detector first (v4.5); "result" last (v4.41)
    assert prog[-1]["done"] == prog[-1]["total"] > 0
    assert all(b["done"] >= a["done"] or b["stage"] != a["stage"] for a, b in zip(prog, prog[1:]))
