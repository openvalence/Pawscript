"""v4.55 TAPNext++ model "auto" (paw-mvnf) and its VRAM need (paw-s9ns), CPU only."""
import pytest

from pawtrack import vram
from pawtrack.cli import parse_groups
from pawtrack.registry import TRACKERS
from pawtrack.trackers import NOTES
from pawtrack.trackers import tapnext_points as T

# measured peak reserved GiB (weights included), experiments/resolution/vram.py, 120 frames of its synthetic clip:
# (input size, chunk, points) -> GiB. Chunk 8 from out/vram.json (paw-mvnf), chunks 1 / 4 / 16 from paw-s9ns, and the
# README's older dev-clip cells (512 chunk 16 x 1024 points 12.7; chunk 1: 256 1.6, 512 2.5 at 64..400 points).
MEASURED = {
    ("256", 8, 128): 2.361, ("256", 8, 512): 2.828, ("256", 8, 1024): 3.412, ("256", 8, 2048): 4.643,
    ("256", 8, 3072): 5.752, ("256", 8, 4096): 7.082, ("256", 8, 6144): 9.297,
    ("256", 4, 128): 1.965, ("256", 4, 2048): 3.037, ("256", 16, 128): 3.414, ("256", 16, 2048): 7.773,
    ("512", 8, 128): 6.049, ("512", 8, 512): 6.457, ("512", 8, 1024): 7.068, ("512", 8, 2048): 8.377,
    ("512", 8, 3072): 9.652,
    ("512", 4, 128): 3.789, ("512", 4, 2048): 5.061, ("512", 16, 128): 10.67, ("512", 16, 256): 10.941,
    ("512", 16, 1024): 12.7,
    ("256", 1, 128): 1.541, ("256", 1, 1024): 1.756, ("512", 1, 128): 2.32, ("512", 1, 1024): 2.816,
    ("256", 1, 64): 1.6, ("512", 1, 64): 2.5,
}


@pytest.mark.parametrize("cell", sorted(MEASURED))
def test_need_is_an_upper_bound_of_every_measured_peak(cell):
    """The cap keeps the CUDA context (~0.5 GB) and the scan kernel's headroom above the real peak: never under it."""
    model, chunk, n = cell
    assert T.need_gb(model, chunk, n) >= MEASURED[cell] + 0.5, (cell, T.need_gb(model, chunk, n))


def test_need_is_not_the_old_5_gb_over():
    """The owner's 512 / 1024 points / chunk 8 asked 12.66 GB for a 7.07 GiB peak; now within peak + 25 %."""
    assert T.need_gb("512", 8, 1024) < 7.068 * 1.25
    assert T.need_gb("auto", 8, 1024) == T.need_gb("256", 8, 1024)


def part(h, w, name="penis", t_ms=None, W=1920, H=1080):
    """The probe's part (synth.py CASES h<h>: w = 0.6 h, centred) as a painted outline."""
    x0, y0 = (W - w) / 2 / W, (H - h) / 2 / H
    return parse_groups([{"name": name, "poly": [[x0, y0], [x0 + w / W, y0], [x0 + w / W, y0 + h / H], [x0, y0 + h / H]],
                          **({} if t_ms is None else {"t_ms": t_ms})}])[0]


@pytest.mark.parametrize("h,w,want", [(40, 24, "512"), (60, 36, "512"), (90, 54, "256"), (135, 81, "256"), (200, 120, "256")])
def test_probe_part_sizes(h, w, want):
    """512 at 3.7 % and 5.6 % of the frame height, 256 at 8.3 %, 12.5 % and 18.5 % (experiments/resolution)."""
    size, why = T.auto_size([part(h, w)])
    assert size == want and why.startswith(f"auto: {want}, ") and "penis is" in why, why


def test_smallest_part_decides_and_says_why():
    size, why = T.auto_size([part(300, 180, "hips"), part(60, 36)])
    assert (size, why) == ("512", "auto: 512, penis is 1.9 % of the frame across")
    assert T.auto_size([]) == ("256", "auto: 256, no painted parts")
    assert T.auto_size([part(60, 36)], have512=False)[1] == "auto: 256, penis is 1.9 % of the frame across but the 512 model is not downloaded"
    size, why = T.auto_size([part(60, 36)], room=6.0, need512=8.7)
    assert size == "256" and why.endswith("but 512 needs 8.7 GB of 6.0 GB")
    assert T.auto_size([part(60, 36)], room=9.0, need512=8.7)[0] == "512"
    # a horizontal part: its short side is its height (x 1920 / 1080 in the square model input)
    assert T.short_side(part(36, 200)) == pytest.approx(36 / 1080)


def test_model_param_defaults_to_auto_and_keeps_256_512():
    import pawtrack.trackers.tapnext_points  # noqa: F401 (registers)
    m = next(q for q in TRACKERS["tapnext_points"].params if q["key"] == "model")
    assert m["default"] == "auto" and m["choices"] == ["auto", "256", "512"] and m.get("hint")


@pytest.fixture
def run(monkeypatch, tmp_path):
    """track() up to wrap: -> fn(p overrides, roi) -> (work_wh, p['model'], the model_size notes)."""
    (tmp_path / "tapnext").mkdir()
    (tmp_path / "tapnext" / T.CK["512"][1]).write_bytes(b"")
    monkeypatch.setattr(T, "CACHE", tmp_path)
    monkeypatch.setattr(vram, "_cuda", lambda: None)
    seen = {}

    def fake_wrap(run_, roi, frames, p, conf_of, local_support, work_wh=None, grow=1.0):
        seen.update(wh=work_wh, model=p["model"])
        return iter(())
    monkeypatch.setattr(T, "wrap", fake_wrap)
    base = {q["key"]: q["default"] for q in TRACKERS["tapnext_points"].params}

    def fn(over, roi=None):
        NOTES.clear()
        list(T.track(iter(()), roi or {"kind": "box", "x": 0, "y": 0, "w": 1, "h": 1}, {**base, **over}))
        return seen["wh"], seen["model"], [n for n in NOTES if n["code"] == "model_size"]
    return fn


def test_track_auto_picks_per_scene_and_notes_it(run):
    small, big = part(60, 36, t_ms=5000.0), part(300, 180, "hips", t_ms=100.0)
    wh, model, notes = run({"groups": [small, big], "scene_ms": (0, 3000)})   # this scene holds only the big part
    assert (wh, model) == ((256, 256), "256") and notes[0]["data"] == {"model": "256", "auto": True}
    wh, model, notes = run({"groups": [small, big], "scene_ms": (3000, 9000)})
    assert (wh, model) == ((512, 512), "512") and notes[0]["message"] == "auto: 512, penis is 1.9 % of the frame across"
    assert run({"groups": []})[:2] == ((256, 256), "256")                         # grid: 256
    assert run({"groups": [small]}, {"kind": "points", "points": [[0.5, 0.5]]})[:2] == ((256, 256), "256")  # clicks: no groups
    wh, model, notes = run({"groups": [small], "model": "256"})                   # explicit: as asked, no note
    assert (wh, model, notes) == ((256, 256), "256", [])
    assert run({"groups": [big], "model": "512"})[:2] == ((512, 512), "512")
