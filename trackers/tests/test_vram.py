"""pawtrack/vram.py on a fake CUDA (paw-szyg): the cap after any order of commands is >= what stays resident + the
job's need, residents go (LRU) when that would exceed the budget, the env overrides, one retry after an OOM."""
import types

import pytest

from pawtrack import vram

GB = 2 ** 30


class FakeCuda:
    """24 GB card; other programs use `other` GB; allocated = the resident weights loaded through vram.loading."""

    def __init__(self, other=3.0, total=24.0):
        self.total, self.other, self.alloc, self.frac = total, other, 0.0, None
        self.cuda = self

    def is_available(self):
        return True

    def current_device(self):
        return 0

    def get_device_properties(self, i):
        return types.SimpleNamespace(total_memory=self.total * GB)

    def mem_get_info(self):
        return (self.total - self.other - self.alloc) * GB, self.total * GB

    def memory_reserved(self):
        return self.alloc * GB

    def memory_allocated(self):
        return self.alloc * GB

    def set_per_process_memory_fraction(self, f):
        self.frac = f

    def empty_cache(self):
        pass

    def cap_gb(self):
        return self.frac * self.total


@pytest.fixture
def cuda(monkeypatch):
    c = FakeCuda()
    monkeypatch.setattr(vram, "_cuda", lambda: c)
    monkeypatch.delenv("PAWSCRIPT_GPU_FRACTION", raising=False)
    monkeypatch.delenv("PAWTRACK_VRAM_GB", raising=False)
    vram.RESIDENT.clear()
    vram.JOB.clear()
    yield c
    vram.RESIDENT.clear()
    vram.JOB.clear()


WEIGHTS = {"hydra": 0.9, "sam_image": 0.2, "tapnext_points:512": 0.8, "tapnext_points:256": 0.8,
           "cotracker_points:online": 0.1}
NEEDS = {"suggest": [("hydra", 1.8), ("sam_image", 0.6)],
         "track512": [("tapnext_points:512", 12.66)],  # the owner's setting under the pre-v4.55 cap (paw-s9ns: now 8.7)
         "track256": [("tapnext_points:256", 3.81)],
         "track_groups": [("tapnext_points:512", 12.66), ("hydra", 1.8)],
         "cotracker": [("cotracker_points:online", 2.2)]}


def job(c, name):
    """One command: cap + load each model it uses, as the trackers / partlabel do. -> the cap after it."""
    def fn():
        for model, gb in NEEDS[name]:
            vram.cap(model, gb)
            if model not in vram.RESIDENT:
                with vram.loading(model, lambda: None):
                    c.alloc += WEIGHTS[model]
        return c.cap_gb()
    return vram.run(fn)


def floor(c):
    """What the cap must at least be: every resident + the job's needs (its own models counted in the need)."""
    return sum(r["gb"] for n, r in vram.RESIDENT.items() if n not in vram.JOB) + sum(vram.JOB.values())


def test_every_order_caps_resident_plus_need(cuda):
    """The owner's night (suggest -> track -> track -> suggest), the reverse, a tracker switch, a model-size switch."""
    for seq in (["suggest", "track512", "track512", "suggest"], ["track512", "suggest", "track256", "track_groups"],
                ["cotracker", "suggest", "track512", "cotracker", "suggest"]):
        cuda.alloc = 0.0
        vram.RESIDENT.clear()
        for name in seq:
            cap = job(cuda, name)
            assert cap >= floor(cuda) - 1e-9, (seq, name)
            assert cap <= cuda.total - cuda.other - vram.MARGIN_GB + 1e-9  # never past what the card has free
    # the bug: Suggest after a TAPNext++ run was capped at 2.5 GB with the tracker's 0.8 GB still allocated
    vram.RESIDENT.clear()
    cuda.alloc = 0.0
    job(cuda, "track512")
    assert job(cuda, "suggest") >= 0.8 + 1.8 + 0.6 - 1e-9


def test_over_budget_evicts_lru_not_the_job(cuda):
    cuda.other = 10.0  # 14 GB free at the start: a 13 GB budget
    job(cuda, "suggest")          # hydra + SAM resident
    job(cuda, "cotracker")        # + cotracker
    assert set(vram.RESIDENT) == {"hydra", "sam_image", "cotracker_points:online"}
    job(cuda, "track512")         # 12.66 + 1.2 resident > 13: the oldest (hydra, then SAM) go first
    assert "tapnext_points:512" in vram.RESIDENT and "hydra" not in vram.RESIDENT
    assert floor(cuda) <= 13.0 + 1e-9
    assert cuda.cap_gb() >= floor(cuda) - 1e-9
    job(cuda, "track_groups")     # the tracker it runs and the tagger stay together
    assert {"tapnext_points:512", "hydra"} <= set(vram.RESIDENT)


def test_owner_setting_fits_beside_the_tagger(cuda):
    """TAPNext++ 512 / 1024 points + Hydra on a 24 GB card with the desktop (~3 GB): nothing is evicted."""
    job(cuda, "track_groups")
    job(cuda, "suggest")
    job(cuda, "track_groups")
    assert {"tapnext_points:512", "hydra", "sam_image"} <= set(vram.RESIDENT)


def test_env_overrides(cuda, monkeypatch):
    monkeypatch.setenv("PAWSCRIPT_GPU_FRACTION", "0.5")  # gpu_lock's reservation wins: the cap is the reservation
    assert job(cuda, "suggest") == pytest.approx(12.0)
    monkeypatch.delenv("PAWSCRIPT_GPU_FRACTION")
    monkeypatch.setenv("PAWTRACK_VRAM_GB", "13")         # the manual override: the cap, and residents evicted to fit it
    assert job(cuda, "track512") == pytest.approx(13.0)
    assert "hydra" not in vram.RESIDENT and "tapnext_points:512" in vram.RESIDENT


def test_oom_retries_once_after_evicting_then_says_why(cuda):
    job(cuda, "suggest")
    calls = []

    def oom_once():
        vram.cap("tapnext_points:512", 12.66)
        calls.append(len(vram.RESIDENT))
        if len(calls) == 1:
            raise RuntimeError("CUDA out of memory. Tried to allocate 174.00 MiB")
        return "ok"
    vram.JOB.clear()
    assert vram.run(oom_once) == "ok" and calls == [2, 0]  # hydra + SAM unloaded before the retry

    def oom_always():
        vram.cap("tapnext_points:512", 12.66)
        raise RuntimeError("CUDA out of memory. Tried to allocate 174.00 MiB")
    job(cuda, "suggest")
    with pytest.raises(vram.OutOfVram) as e:
        vram.run(oom_always)
    msg = str(e.value)
    assert "tapnext_points:512 12.7 GB" in msg and "Not enough GPU memory" in msg and "CUDA out of memory" not in msg
    assert getattr(e.value, "relayed", False)
    with pytest.raises(ValueError):  # other errors pass through untouched
        vram.run(lambda: (_ for _ in ()).throw(ValueError("x")))


def test_no_retry_once_frames_were_sent(cuda):
    job(cuda, "suggest")
    n = []

    def fn():
        n.append(1)
        raise RuntimeError("CUDA out of memory.")
    with pytest.raises(vram.OutOfVram):
        vram.run(fn, retry_ok=lambda: False)
    assert n == [1]


def test_serve_switching_tracker_keeps_the_tagger(cuda, monkeypatch):
    from pawtrack import serve
    monkeypatch.setattr(serve.Service, "__init__", lambda self, *a: None)
    s = serve.Service()
    s.tracker = "cotracker_points"
    job(cuda, "cotracker")
    job(cuda, "suggest")
    assert s._drop_tracker(keep="tapnext_points") == ["cotracker_points:online"]
    assert set(vram.RESIDENT) == {"hydra", "sam_image"}
    assert sorted(s._drop_tracker()) == ["hydra", "sam_image"] and s.tracker is None


def test_oom_under_its_own_cap_retries_with_more_when_the_card_has_room(cuda):
    """Suggest on a large still needed more than hydra's stated 1.8 GB with ~20 GB free: the retry is allowed more,
    never past the budget, and the boost is gone for the next job."""
    caps, calls = [], []

    class Oom(RuntimeError):
        pass
    Oom.__name__ = "OutOfMemoryError"

    def job():
        vram.cap("hydra", 1.8)
        caps.append(cuda.cap_gb())
        calls.append(1)
        if len(calls) == 1:
            raise Oom("CUDA out of memory")
        return "ok"

    assert vram.run(job) == "ok"
    budget = cuda.total - cuda.other - vram.MARGIN_GB
    assert caps[0] == pytest.approx(1.8) and caps[1] > 1.8 * 2 and caps[1] <= budget + 1e-6
    assert vram.BOOST == 1.0
    vram.run(lambda: (vram.cap("hydra", 1.8), caps.append(cuda.cap_gb())))
    assert caps[-1] == pytest.approx(1.8)


def test_oom_with_no_room_still_ends_in_out_of_vram(cuda):
    cuda.other = 21.5   # budget 1.5 GB: nothing to give

    class Oom(RuntimeError):
        pass
    Oom.__name__ = "OutOfMemoryError"

    def job():
        vram.cap("hydra", 1.8)
        raise Oom("CUDA out of memory")

    with pytest.raises(vram.OutOfVram):
        vram.run(job)
