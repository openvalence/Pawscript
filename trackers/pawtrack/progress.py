"""Progress events on a wall-clock cadence (PROTOCOL.md `progress`): at most one per `every` seconds while a loop
runs (so at least one a second), and one at once on every stage change, with `"stage"` when one is set.
`stage(name)` is the hook a tracker calls (model load, groups) without knowing the job's emitter: cmd_track installs
the job's Progress as CURRENT for its duration (one job at a time per process, as `pawtrack serve` runs them).
v4.43 (paw-mhme): every stage's wall time is kept (`table()`): cmd_track writes it to stderr at the end."""
import time
from contextlib import contextmanager

CURRENT = None


class Progress:
    def __init__(self, emit, total=0, every=0.5):
        self.emit, self.total, self.every = emit, int(total), every
        self.done, self.name, self.last = 0, None, float("-inf")
        self.pull = "tracking"  # the stage frames pulled before a tracker's first output count under (v4.43)
        self.t0 = self.t = time.monotonic()
        self.spent = {}  # stage -> seconds (a stage repeats per scene: summed)

    def __call__(self, done=None, total=None, stage=None, force=False, extra=None):
        if done is not None:
            self.done = int(done)
        if total is not None:
            self.total = int(total)
        if stage is not None and stage != self.name:
            self._clock()
            self.name, force = stage, True
        now = time.monotonic()
        if not force and now - self.last < self.every:
            return
        self.last = now
        ev = {"type": "progress", "done": self.done, "total": max(self.total, self.done)}
        if self.name:
            ev["stage"] = self.name
        self.emit({**ev, **extra} if extra else ev)

    def _clock(self):
        now = time.monotonic()
        if self.name is not None:
            self.spent[self.name] = self.spent.get(self.name, 0.0) + now - self.t
        self.t = now

    def table(self):
        """-> [[stage, seconds]] in first-seen order, the running stage counted up to now."""
        self._clock()
        return [[k, round(v, 2)] for k, v in self.spent.items()]


def stage(name):
    """A tracker's stage change for the running job (no-op outside a track)."""
    if CURRENT is not None:
        CURRENT(stage=name)


def beat():
    """paw-eeod: work goes on (a tracker's output frame): a progress event at the cadence with the same counts, so the
    app's stall watchdog hears from a scene that is tracked before any of its rows go out."""
    if CURRENT is not None:
        CURRENT()


def pulling(name):
    """v4.43: the frames the tracker pulls from now on count under this stage (a buffering tracker: "reading")."""
    if CURRENT is not None:
        CURRENT.pull = name
        CURRENT(stage=name)


@contextmanager
def sub(name):
    """v4.43: a stage inside whatever runs (a model load, the tagger): the stage before comes back after it, so a
    load in the middle of a scene never names the rest of the scene."""
    p = CURRENT
    prev = p.name if p is not None else None
    stage(name)
    try:
        yield
    finally:
        if p is not None and prev is not None:
            p(stage=prev)


STEPS = 1000


@contextmanager
def steps(name):
    """v4.42: a stage that counts its own work (the motion groups): while it runs done / total are its share done out
    of STEPS, so the app's bar moves; yields tick(frac 0..1). The job's counts come back after (the next stage's
    events carry them)."""
    p = CURRENT
    if p is None:
        yield lambda f, **extra: None
        return
    done, total = p.done, p.total
    p(0, STEPS, stage=name)
    try:  # extra (v4.44): fields of this event (the shaft pass's t_ms + outline); such a tick always goes out
        yield lambda f, **extra: p(min(STEPS, int(f * STEPS)), STEPS, force=f >= 1 or bool(extra), extra=extra)
    finally:
        p.done, p.total = done, total
