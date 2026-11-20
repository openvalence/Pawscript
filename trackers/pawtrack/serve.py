"""`pawtrack serve`: one long-lived process, JSON Lines both ways (src/lib/director/README.md §8.6).

  <- {"type":"hello","protocol":"pawtrack-serve/1","pid":..,"commands":[..]}
  -> {"id":"7","cmd":"frames",...}     any one-shot request + a string id; its events echo the id, a result or an
                                        error line closes it. Jobs run one at a time, FIFO, on a worker thread.
  -> {"id":"c1","cmd":"cancel","target":"7"} | {"cmd":"status"} | {"cmd":"unload","name":..} | {"cmd":"shutdown"}
                                        answered at once by the reader thread, even while a job runs.
Cancel is cooperative: the job's next event raises Cancelled (a queued job is just dropped). stdin EOF = shutdown
after the queued jobs finished; `shutdown` cancels them.

Isolation: `describe` imports the Hydra tagger's own `hydra` package, `sam2` imports hydra-core's `hydra`: one
interpreter can hold only one of them, so describe runs in a resident `serve --role describe` child. The Qwen VLM
runs in-process when transformers imports here, else in a `vlm_worker.py` child (the VLM venv).

VRAM: PAWSCRIPT_GPU_FRACTION (gpu_lock) is read once; budget = fraction x card. Residents: one GPU tracker in this
process (its model caches; switching tracker drops the other's), the describe child (3 GB cap), the VLM (its
measured cap). Before a job, residents that would push the total over the budget are evicted (VLM first, then the
tracker, then describe); in-process trackers are capped to what the children leave. The VLM also goes after
120 s idle. Without a fraction (the app's own resident serve) the children cap themselves (describe 3 GB, VLM its
need), a GPU job evicts the children of another kind first, and this process caps itself through pawtrack/vram.py
(what stays loaded here + the job's need, within the card's free memory; LRU eviction; one retry after an OOM). paw-mhme: a job of another kind keeps
the models here when the card holds both once their cached blocks went back (a describe no longer costs the next
Track its tracker load). The describe child and the VLM go after PAWTRACK_IDLE_UNLOAD_S (default 120) without a job,
when the models here also give their cached blocks back; their weights go after PAWTRACK_TRACKER_IDLE_S (600).
"""
import json
import os
import subprocess
import sys
import threading
import time
import traceback
from collections import deque

PROTOCOL = "pawtrack-serve/1"
GPU_TRACKERS = {"sam2_mask": 4.3, "cotracker_points": 4.3, "tapnext_points": 4.3}  # GB, DESIGN §5.2 "one tracker <= 4.3"
DESCRIBE_GB = 3.0
CONTROL = ("cancel", "status", "unload", "shutdown")
HOLDS_CARD = ("track", "suggest_groups", "seed_train", "describe", "cum", "tag_image", "director.ask")  # a running job of these refuses a `segment` (v4.25)
IDLE_UNLOAD_S = float(os.environ.get("PAWTRACK_IDLE_UNLOAD_S") or 120)
# paw-mhme: the models in this process (tracker, tagger / SAM copies) keep their weights this long without a job (their
# cached blocks go back after IDLE_UNLOAD_S); the app kills an idle serve after PAWTRACK_SERVE_IDLE_S (600) anyway
TRACKER_IDLE_S = max(IDLE_UNLOAD_S, float(os.environ.get("PAWTRACK_TRACKER_IDLE_S") or 600))


class Cancelled(BaseException):
    """Raised by a job's emit after cancel (BaseException: no `except Exception` in a command swallows it)."""


class Relayed(Exception):
    """An error event of a child, passed on with its message as is."""
    relayed = True


class Child:
    """A resident JSONL child (`serve --role describe|vlm`): hello first, then request/relay."""

    def __init__(self, argv, env, name):
        self.name = name
        self.p = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=None, env=env,
                                  text=True, encoding="utf-8", bufsize=1,
                                  creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        hello = self.p.stdout.readline()
        if not hello:
            raise RuntimeError(f"{name} child exited at start (code {self.p.wait()})")
        self.hello = json.loads(hello)
        self.lock = threading.Lock()

    def alive(self):
        return self.p.poll() is None

    def send(self, obj):
        with self.lock:
            self.p.stdin.write(json.dumps(obj) + "\n")
            self.p.stdin.flush()

    def run(self, req, emit):
        """Send req (with its id), relay its events through emit, return the closing result/error event.
        Cancelled from emit is forwarded to the child; the child's close is awaited, then Cancelled re-raised."""
        self.send(req)
        cancelled = False
        while True:
            line = self.p.stdout.readline()
            if not line:
                raise RuntimeError(f"{self.name} child exited (code {self.p.wait()})")
            ev = json.loads(line)
            if ev.get("id") != req["id"]:
                continue
            if ev.get("type") in ("result", "error"):
                if cancelled:
                    raise Cancelled()
                return ev
            if not cancelled:
                try:
                    emit({k: v for k, v in ev.items() if k != "id"})
                except Cancelled:
                    cancelled = True
                    self.send({"id": f"{req['id']}-x", "cmd": "cancel", "target": req["id"]})

    def close(self):
        if self.alive():
            try:
                self.send({"id": "bye", "cmd": "shutdown"})
                self.p.wait(10)
            except Exception:
                pass
        if self.alive():
            self.p.kill()


class Job:
    def __init__(self, id, req):
        self.id, self.req, self.cancelled = id, req, False


def _fraction():
    f = os.environ.get("PAWSCRIPT_GPU_FRACTION")
    return float(f) if f else None


class Service:
    def __init__(self, write, role=None):
        from pawtrack import director
        self.write, self.role = write, role
        director.RESIDENT = True
        self.director = director
        if role == "describe":
            from pawtrack.cli import cmd_cum, cmd_describe
            self.commands = {"describe": cmd_describe, "cum": cmd_cum}  # both run the Hydra tagger
        elif role == "vlm":
            self.commands = {"director.ask": director.cmd_ask_local}
        else:
            from pawtrack.cli import COMMANDS
            self.commands = COMMANDS
        self.fraction = _fraction()       # read once
        self.card = director.card_gb() if self.fraction and not role else None
        self.budget = self.fraction * self.card if self.fraction and self.card else None
        self.queue, self.cv, self.busy, self.stop = deque(), threading.Condition(), None, False
        self.describe = None              # Child
        self.tracker = None               # resident GPU tracker id (this process)
        self.last = time.monotonic()      # end of the last job (idle unload)
        self.trimmed = False              # the cached blocks went back since the last job

    # ---------------------------------------------------------------- residents and VRAM

    def resident(self):
        out = []
        if self.tracker:
            mib = None
            if "torch" in sys.modules:
                import torch
                mib = int(torch.cuda.memory_reserved() / 2**20) if torch.cuda.is_available() else 0
            out.append({"kind": "tracker", "name": self.tracker, "mib": mib if mib is not None else int(GPU_TRACKERS[self.tracker] * 1024)})
        if self.describe and self.describe.alive():
            out.append({"kind": "describe", "name": "hydra", "mib": int(DESCRIBE_GB * 1024)})
        return out + self.director.resident()

    def _drop_tracker(self, keep=None):
        """Every model loaded in this process (pawtrack/vram.py: trackers, the tagger / SAM copies partlabel loads);
        keep (a tracker id): drop only the other trackers' models."""
        from pawtrack import vram
        if keep:
            return vram.evict([n for n in vram.RESIDENT if n.split(":")[0] in GPU_TRACKERS and n.split(":")[0] != keep])
        self.tracker = None
        return vram.evict()

    def _drop_describe(self):
        if self.describe:
            self.describe.close()
            self.describe = None
            return ["describe"]
        return []

    def unload(self, name):
        """Unload residents not used by the running job. name: None (all) | "vlm" | "describe" | "tracker" | a tracker id."""
        cmd = (self.busy.req.get("cmd"), self.busy.req.get("tracker")) if self.busy else (None, None)
        out = []
        if name in (None, "vlm") and cmd[0] != "director.ask":
            out += self.director.unload()
        if name in (None, "describe") and cmd[0] != "describe":
            out += self._drop_describe()
        if (name in (None, "tracker") or name == self.tracker) and cmd[0] not in ("track", "suggest_groups", "seed_train", "name_groups"):
            out += self._drop_tracker()
        return out

    def _make_room(self, need_gb, keep):
        """Evict residents (VLM, then tracker, then describe; never `keep`) until need_gb fits the budget.
        No budget: evict every resident of another kind (VRAM as a one-shot process of this job)."""
        if self.budget is None:
            gone = sum((drop() for kind, drop in (("vlm", self.director.unload), ("tracker", self._drop_tracker),
                                                  ("describe", self._drop_describe))
                        if kind != keep and not (kind == "tracker" and self._room_beside(need_gb))), [])
            if gone:
                print(f"pawtrack serve: evicted {gone} (no VRAM budget: one GPU model kind at a time)", file=sys.stderr)
            return
        used = lambda: sum(r["gb"] for r in self._gb() if r["kind"] != keep)
        for kind, drop in (("vlm", self.director.unload), ("tracker", self._drop_tracker), ("describe", self._drop_describe)):
            if used() + need_gb <= self.budget:
                return
            if kind != keep:
                gone = drop()
                if gone:
                    print(f"pawtrack serve: evicted {gone} for {need_gb:g} GB", file=sys.stderr)
        if used() + need_gb > self.budget:
            raise RuntimeError(f"VRAM budget {self.budget:.1f} GB cannot hold {need_gb:g} GB")

    def _room_beside(self, need_gb):
        """paw-mhme: no budget, a job of another kind (describe, the VLM) needs need_gb: True when the card holds it
        beside the models loaded here once their cached blocks went back (a TAPNext++ 512 run keeps ~12 GB reserved,
        its weights are 0.9 GB), so they stay and the next Track does not load them again."""
        from pawtrack import vram
        torch = sys.modules.get("torch")
        if not vram.RESIDENT or torch is None or not torch.cuda.is_initialized():
            return False
        vram.trim()
        free = torch.cuda.mem_get_info()[0] / vram.GB
        ok = free >= need_gb + vram.MARGIN_GB
        print(f"pawtrack serve: {'kept' if ok else 'unloading'} {sorted(vram.RESIDENT)} "
              f"({free:.1f} GB free on the card for {need_gb:g} GB)", file=sys.stderr)
        return ok

    def _gb(self):
        out = [{"kind": "vlm", "gb": r["mib"] / 1024} for r in self.director.resident()]
        if self.tracker:
            out.append({"kind": "tracker", "gb": GPU_TRACKERS[self.tracker]})
        if self.describe and self.describe.alive():
            out.append({"kind": "describe", "gb": DESCRIBE_GB})
        return out

    # ---------------------------------------------------------------- dispatch

    def dispatch(self, req, emit):
        cmd = req.get("cmd")
        if self.role is None and cmd in ("describe", "cum", "tag_image"):  # the Hydra tagger: the describe child
            self._make_room(DESCRIBE_GB, "describe")
            if not (self.describe and self.describe.alive()):
                env = {k: v for k, v in os.environ.items() if k != "PAWSCRIPT_GPU_FRACTION"}  # caps itself at 3 GB
                trk = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                env["PYTHONPATH"] = trk + os.pathsep + env.get("PYTHONPATH", "")
                self.describe = Child([sys.executable, "-m", "pawtrack.cli", "serve", "--role", "describe"], env, "describe")
            ev = self.describe.run(req, emit)
            if ev["type"] == "error":
                raise Relayed(ev["message"])
            return {k: v for k, v in ev.items() if k not in ("id", "type")}
        if self.role is None and cmd == "director.ask":
            d = self.director
            key = req.get("model") or "qwen3.5-2b"
            if not any(r["name"] == key for r in d.resident()):
                self._make_room(d.gb_for(key, req.get("quant") or "none"), "vlm")
        if self.role is None and cmd == "segment":  # v4.25: SAM 2 (image) in this process, beside a resident points tracker
            from pawtrack.segment import SEG_GB
            self._make_room(SEG_GB, "tracker")
        if self.role is None and cmd == "segment":  # v4.25: SAM 2 (image) in this process, beside a resident points tracker
            from pawtrack.segment import SEG_GB
            self._make_room(SEG_GB, "tracker")
        if self.role is None and cmd in ("suggest_groups", "seed_train", "name_groups"):  # v4.11: the tagger (+ SAM) in this process, beside a points tracker
            self._make_room(DESCRIBE_GB, "tracker")
        if self.role is None and cmd == "track" and req.get("tracker") in GPU_TRACKERS:
            tr = req["tracker"]
            if self.director.resident() or (self.describe and self.describe.alive()) or (self.tracker and self.tracker != tr):
                emit({"type": "progress", "done": 0, "total": 0, "stage": "freeing"})  # v4.43: the children / the other tracker go
            if self.tracker and self.tracker != tr:
                self._drop_tracker(keep=tr)
            self._make_room(GPU_TRACKERS[tr], "tracker")
            self.tracker = tr
            if self.budget is not None:  # this process may use what the children leave
                left = self.budget - sum(r["gb"] for r in self._gb() if r["kind"] != "tracker")
                os.environ["PAWSCRIPT_GPU_FRACTION"] = str(max(0.01, left / self.card))
        fn = self.commands.get(cmd)
        if fn is None:
            raise ValueError(f"unknown cmd {cmd!r}")
        from pawtrack import vram
        sent = []  # a retry after an out-of-memory error must not stream frames / results twice

        def emit_(ev):
            if ev.get("type") != "progress":
                sent.append(ev.get("type"))
            emit(ev)
        return vram.run(lambda: fn(req, emit_), lambda: not sent)

    def run(self, job):
        def emit(ev):
            if job.cancelled:
                raise Cancelled()
            self.write({"id": job.id, **ev})
        try:
            res = self.dispatch(job.req, emit)
            self.write({"id": job.id, "type": "result", **(res or {})})
        except Cancelled:
            self.write({"id": job.id, "type": "error", "message": "cancelled", "cancelled": True})
        except Relayed as e:
            self.write({"id": job.id, "type": "error", "message": str(e)})
        except Exception as e:
            traceback.print_exc()
            from pawtrack import gpu, vram
            if vram.is_fatal(e):  # paw-ldfs: the CUDA context is broken; the app starts a fresh serve on its next run
                self.write({"id": job.id, "type": "error", "message": vram.FATAL + gpu.hint(), "restart": True})
                sys.stderr.flush()
                os._exit(3)
            self.write({"id": job.id, "type": "error",
                        "message": str(e) if getattr(e, "relayed", False) else f"{type(e).__name__}: {e}"})

    def worker(self):
        try:  # paw-1dt4: whatever happens here, the jobs are still answered (the CPU trackers need no torch)
            from pawtrack import gpu
            gpu.install()  # paw-k97q: the first torch.cuda.is_available() probes the card (a failing one turns CUDA off here)
        except Exception:
            traceback.print_exc()
        while True:
            with self.cv:
                while not self.queue and not self.stop:
                    self.cv.wait(5)
                    self._idle()
                if self.stop:
                    return
                job = self.queue.popleft()
                self.busy = job
            try:
                self.run(job)
            finally:
                with self.cv:
                    self.busy = None
                    self.last = time.monotonic()
                    self.trimmed = False

    def _idle(self):
        if self.busy is not None or self.queue:  # a job just queued: don't unload what it is about to use
            return
        gone = self.director.unload() if self.director.idle_s() > self.director.IDLE_S else []
        idle = time.monotonic() - self.last
        if idle > TRACKER_IDLE_S:
            gone += self.unload(None)
        elif idle > IDLE_UNLOAD_S:  # paw-mhme: the children go, the models here keep their weights only
            gone += self.unload("vlm") + self.unload("describe")
            if not self.trimmed:
                from pawtrack import vram
                vram.trim()
                self.trimmed = True
        if gone:
            print(f"pawtrack serve: unloaded idle {gone}", file=sys.stderr)

    # ---------------------------------------------------------------- control (reader thread)

    def control(self, rid, req):
        cmd = req["cmd"]
        if cmd == "cancel":
            tgt, ok = req.get("target"), False
            with self.cv:
                for j in list(self.queue):
                    if j.id == tgt:
                        self.queue.remove(j)
                        self.write({"id": j.id, "type": "error", "message": "cancelled", "cancelled": True})
                        ok = True
                if self.busy and self.busy.id == tgt:
                    self.busy.cancelled = ok = True
            self.write({"id": rid, "type": "result", "cancelled": ok})
        elif cmd == "status":
            with self.cv:
                busy, queued = (self.busy.id if self.busy else None), [j.id for j in self.queue]
            res = self.resident()
            self.write({"id": rid, "type": "result", "busy": busy, "queued": queued, "resident": res,
                        "vram_mib": sum(r["mib"] or 0 for r in res), "fraction": self.fraction})
        elif cmd == "unload":
            with self.cv:
                out = self.unload(req.get("name"))
            self.write({"id": rid, "type": "result", "unloaded": out})
        elif cmd == "shutdown":
            self.write({"id": rid, "type": "result"})
            return True
        return False

    def submit(self, line):
        """One input line. -> True to shut down."""
        try:
            req = json.loads(line)
            if not isinstance(req, dict):
                raise ValueError("a request is a JSON object")
        except ValueError as e:
            self.write({"id": None, "type": "error", "message": f"malformed request: {e}"})
            return False
        rid = req.get("id")
        if not isinstance(rid, str) or not rid:
            self.write({"id": None if rid is None else rid, "type": "error", "message": "request needs a string id"})
            return False
        if req.get("cmd") in CONTROL:
            return self.control(rid, req)
        with self.cv:
            held = self.busy.req.get("cmd") if self.busy else None
            if req.get("cmd") == "segment" and held in HOLDS_CARD:   # v4.25: a prompt must answer in a moment, never wait out a job
                self.write({"id": rid, "type": "error", "message": "the card is busy tracking" if held == "track" else f"the card is busy ({held})", "busy": held})
                return False
            self.queue.append(Job(rid, req))
            self.cv.notify()
        return False

    def shutdown(self):
        with self.cv:
            for j in self.queue:
                self.write({"id": j.id, "type": "error", "message": "cancelled", "cancelled": True})
            self.queue.clear()
            if self.busy:
                self.busy.cancelled = True
            self.stop = True
            self.cv.notify_all()


def main(argv=()):
    """argv: the words after `serve` (`--role describe|vlm` for internal children)."""
    argv = list(argv)
    role = argv[argv.index("--role") + 1] if "--role" in argv else None
    # only JSONL may reach the real stdout (as cli.main): private handle, fd 1 -> stderr
    out = os.fdopen(os.dup(1), "w", encoding="utf-8", newline="\n")
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    lock = threading.Lock()

    def write(obj):
        from pawtrack.cli import dumps
        s = dumps(obj)
        with lock:
            out.write(s + "\n")
            out.flush()
    t0 = time.perf_counter()
    svc = Service(write, role)
    w = threading.Thread(target=svc.worker, daemon=True)
    w.start()
    write({"type": "hello", "protocol": PROTOCOL, "pid": os.getpid(), "commands": list(svc.commands),
           "role": role, "start_s": round(time.perf_counter() - t0, 3)})
    sys.stdin.reconfigure(encoding="utf-8")
    try:
        for line in sys.stdin:
            if line.strip() and svc.submit(line):
                break
        else:  # stdin EOF: finish what was asked (a piped batch), then exit; `shutdown` cancels instead
            with svc.cv:
                while svc.queue or svc.busy:
                    svc.cv.wait(0.5)
    finally:
        svc.shutdown()
        w.join(30)  # a cancelled job stops at its next event
        svc._drop_describe()
        svc.director.unload()
        out.flush()
        os._exit(0)  # don't wait on CUDA / native threads at interpreter teardown
