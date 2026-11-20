"""pawtrack serve: one process, many requests (synthetic clips), cancel, status, malformed input, shutdown."""
import json
import queue
import subprocess
import sys
import threading
import time

import cv2
import numpy as np
import pytest

import make_video as mv


class Session:
    def __init__(self, *args):
        self.t0 = time.perf_counter()
        self.p = subprocess.Popen([sys.executable, "-m", "pawtrack.cli", "serve", *args], stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, text=True, encoding="utf-8", bufsize=1)
        self.q = queue.Queue()
        threading.Thread(target=lambda: [self.q.put(json.loads(l)) for l in self.p.stdout] + [self.q.put(None)],
                         daemon=True).start()
        self.hello = self.next()
        self.startup_s = time.perf_counter() - self.t0
        self.events = []

    def send(self, obj):
        self.p.stdin.write((obj if isinstance(obj, str) else json.dumps(obj)) + "\n")
        self.p.stdin.flush()

    def next(self, timeout=120):
        return self.q.get(timeout=timeout)

    def until(self, ids, timeout=120, on=None):
        """Read events until every id in ids is closed (result/error). -> {id: closing event}."""
        out, end = {}, time.monotonic() + timeout
        while set(ids) - set(out):
            e = self.next(max(0.1, end - time.monotonic()))
            assert e is not None, "serve exited"
            self.events.append(e)
            if on:
                on(e)
            if e.get("type") in ("result", "error"):
                out[e["id"]] = e
        return out

    def close(self):
        if self.p.poll() is None:
            self.p.kill()


@pytest.fixture(scope="module")
def clips(tmp_path_factory):
    d = tmp_path_factory.mktemp("serve")
    long = d / "long.mp4"  # 60 s, small: enough work to cancel mid-way
    vw = cv2.VideoWriter(str(long), cv2.VideoWriter_fourcc(*"mp4v"), 30, (160, 120))
    rng = np.random.default_rng(0)
    bg = cv2.GaussianBlur(rng.integers(0, 256, (120, 160, 3), dtype=np.uint8), (0, 0), 1.5)
    for i in range(1800):
        img = bg.copy()
        cv2.circle(img, (80, int(60 + 25 * np.sin(i / 10))), 12, (255, 255, 255), -1)
        vw.write(img)
    vw.release()
    return {"syn": str(mv.make(d / "syn.mp4")), "long": str(long)}


def test_session(clips, tmp_path):
    s = Session()
    try:
        h = s.hello
        assert h["type"] == "hello" and h["protocol"] == "pawtrack-serve/1" and isinstance(h["pid"], int)  # (a venv launcher may sit between)
        assert {"probe", "track", "describe", "frames", "motion.stats", "motion.compare", "motion.propose",
                "director.ask"} <= set(h["commands"])
        v = clips["syn"]
        # several jobs queued at once: FIFO, each closed by its own result
        s.send({"id": "p", "cmd": "probe", "video": v})
        s.send({"id": "f", "cmd": "frames", "video": v, "jobs": [{"dest": str(tmp_path / "s.jpg"), "times_ms": [0, 5000]}]})
        s.send({"id": "m", "cmd": "motion.stats", "video": v, "ranges": [{"start_ms": 0, "end_ms": 4900}]})
        s.send({"id": "k", "cmd": "track", "video": v, "tracker": "lk_box", "start_ms": 0, "end_ms": 3000,
                "roi": {"kind": "box", "x": 0.45, "y": 0.4, "w": 0.1, "h": 0.2}, "params": {}})
        s.send({"id": "sc", "cmd": "score", "candidate": [{"at": 0, "pos": 0}, {"at": 500, "pos": 100}],
                "reference": [{"at": 0, "pos": 0}, {"at": 500, "pos": 100}], "start_ms": 0, "end_ms": 1000})
        t = time.perf_counter()
        r = s.until(["p", "f", "m", "k", "sc"])
        five_s = time.perf_counter() - t
        assert all(e["type"] == "result" for e in r.values()), r
        closed = [e["id"] for e in s.events if e.get("type") == "result"]
        assert closed == ["p", "f", "m", "k", "sc"]
        assert r["p"]["media"]["duration_ms"] == 10000 and (tmp_path / "s.jpg").exists()
        assert r["m"]["ranges"][0]["camera"]["mode"] == "static"
        assert any(e.get("type") == "frame" and e["id"] == "k" for e in s.events) and r["k"]["points"]
        assert all("id" in e for e in s.events)

        # cancel a running job at its first progress; a queued one behind it still runs
        s.send({"id": "long", "cmd": "motion.stats", "video": clips["long"], "params": {"fps": 30}})
        s.send({"id": "after", "cmd": "probe", "video": v})
        sent = []

        def on(e):
            if e["id"] == "long" and e.get("type") == "progress" and not sent:
                s.send({"id": "st", "cmd": "status"})
                s.send({"id": "c1", "cmd": "cancel", "target": "long"})
                sent.append(1)
        r = s.until(["long", "after", "st", "c1"], on=on)
        assert r["long"]["type"] == "error" and r["long"].get("cancelled") is True
        assert r["c1"]["cancelled"] is True and r["after"]["type"] == "result"
        assert r["st"]["busy"] == "long" and r["st"]["queued"] == ["after"] and "resident" in r["st"]

        # malformed input and bad requests never end the session
        s.send("not json")
        assert s.next()["id"] is None
        s.send({"cmd": "probe", "video": v})
        assert "id" in s.next()["message"]
        s.send({"id": "x", "cmd": "nope"})
        s.send({"id": "e", "cmd": "probe", "video": "C:/no/such.mp4"})
        r = s.until(["x", "e"])
        assert r["x"]["type"] == "error" and "unknown cmd" in r["x"]["message"] and r["e"]["type"] == "error"
        s.send({"id": "c2", "cmd": "cancel", "target": "nothing"})
        s.send({"id": "u", "cmd": "unload", "name": None})
        r = s.until(["c2", "u"])
        assert r["c2"]["cancelled"] is False and r["u"]["unloaded"] == []

        s.send({"id": "bye", "cmd": "shutdown"})
        assert s.until(["bye"])["bye"]["type"] == "result"
        assert s.p.wait(30) == 0
        print(f"serve startup {s.startup_s:.2f} s, 5 jobs {five_s:.2f} s")
    finally:
        s.close()


def test_eof_shuts_down(clips):
    s = Session()
    try:
        s.send({"id": "1", "cmd": "probe", "video": clips["syn"]})
        s.send({"id": "2", "cmd": "motion.stats", "video": clips["syn"], "ranges": [{"start_ms": 0, "end_ms": 3000}]})
        s.p.stdin.close()  # a piped batch: the queued jobs still finish, then exit 0
        r = s.until(["1", "2"])
        assert r["1"]["type"] == "result" and r["2"]["type"] == "result"
        assert s.p.wait(30) == 0
    finally:
        s.close()
