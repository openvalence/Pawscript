"""v4.27 held-out score (pawtrack/seedscore.py): metrics, folds by source, no leakage, caching + trend, Train wiring.
Synthetic features only (a fake feature function), no models, no GPU."""
import os
import time

import numpy as np

from pawtrack import seeder, seedscore

import pytest

GRID, D = (9, 16), 32


@pytest.fixture(autouse=True)
def raw_blobs(monkeypatch):
    """These tests are about folds / leakage / caching on a degenerate synthetic head (it paints the whole frame): the geometry of the
    proposals (merging, cleaning) is tested in test_tidy.py, so the blobs are the raw regions here."""
    monkeypatch.setattr(seeder, "proposals", lambda heat, size, use=None, thr=seeder.THR, box=(0.0, 0.0, 1.0, 1.0), margin=0.0: seeder.regions(heat, size, use, thr, box))

BOX = (2 / 16, 4 / 9, 5 / 16, 6 / 9)      # the penis' patches in synth(): cols 2:5, rows 4:6


def box_mask(x0, y0, x1, y1, w=320, h=180):
    m = np.zeros((h, w), bool)
    m[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)] = True
    return m


def synth(seed, hips=False):
    r = np.random.default_rng(seed)
    f = r.normal(0, 1, (GRID[0], GRID[1], D)).astype(np.float32)
    f[4:6, 2:5, :6] += 6                      # a "penis" look
    if hips:
        f[5:9, 9:14, 6:12] += 6               # a "hips" look
    return f.reshape(-1, D).astype(np.float16)


def frame(src, t=0, parts=("penis",)):
    boxes = {"penis": BOX, "hips": (9 / 16, 5 / 9, 14 / 16, 1.0)}
    return {"key": src, "t": t, "W": 320, "H": 180, "video": src,
            "groups": [{"part": p, "who": "c1", "mask": box_mask(*boxes[p])} for p in parts]}


def library(n_src=12, frames_per=2, hips_in=2):
    frames, feats = [], {}
    for s in range(n_src):
        for t in range(frames_per):
            fr = frame(f"s{s}", t, ("penis", "hips") if s < hips_in else ("penis",))
            frames.append(fr)
            feats[(fr["key"], fr["t"])] = (synth(100 * s + t, hips=s < hips_in), GRID)
    return frames, feats


def test_metrics_perfect_none_and_extras():
    f = {**frame("a"), "id": "a_0", "src": "a"}
    g = f["groups"][0]["mask"]
    perfect = {"a_0": [{"part": "penis", "mask": g, "c": (.2, .55)}]}
    rows, fr = seedscore.evaluate(perfect, [f])
    assert rows[0]["found"] and rows[0]["iou"] == 1.0 and rows[0]["cerr"] < 0.05 and fr[0]["extra"] == 0
    rows, fr = seedscore.evaluate({}, [f])
    assert not rows[0]["found"] and rows[0]["iou"] == 0 and rows[0]["cerr"] is None
    # a second blob of the painted part and a blob of an unpainted part are both extras; a far blob is not "found"
    far = box_mask(.7, .1, .8, .2)
    preds = {"a_0": [{"part": "penis", "mask": g, "c": (.2, .55)}, {"part": "penis", "mask": far, "c": (.75, .15)}, {"part": "tail", "mask": far, "c": (.75, .15)}]}
    rows, fr = seedscore.evaluate(preds, [f])
    assert rows[0]["found"] and fr[0]["extra"] == 2 and fr[0]["blobs"] == 3
    rows, _ = seedscore.evaluate({"a_0": [{"part": "penis", "mask": far, "c": (.75, .15)}]}, [f])
    assert not rows[0]["found"] and rows[0]["cerr"] > 0.3


def test_folds_are_by_source():
    few = {f"s{i}": 2 for i in range(6)}
    assert sorted(seedscore.folds(few).values()) == list(range(6)), "under 10 sources: leave one source out"
    many = {f"s{i}": 1 + i % 3 for i in range(23)}
    fold = seedscore.folds(many)
    assert set(fold) == set(many) and set(fold.values()) == set(range(5))
    assert fold == seedscore.folds(many), "a fixed seed: the same split every time"
    load = [sum(many[s] for s in many if fold[s] == k) for k in range(5)]
    assert max(load) - min(load) <= 3, load


def test_score_is_held_out_and_reports_parts(monkeypatch):
    frames, feats = library()
    fits = []
    real = seeder.Head.fit.__func__

    def spy(cls, Xs, Ys, seed=0, **kw):
        fits.append(sum(len(x) for x in Xs))
        return real(cls, Xs, Ys, seed)
    monkeypatch.setattr(seeder.Head, "fit", classmethod(spy))
    s = seedscore.score(frames, feats)
    assert s["sources"] == 12 and s["frames"] == 24 and s["folds"] == 5
    assert len(fits) == 5 and all(n < 24 * 144 for n in fits) and sum(n for n in fits) == 5 * 24 * 144 - 24 * 144, "each fit sees the other folds' frames only"
    assert s["parts"]["penis"]["n"] == 24 and s["parts"]["penis"]["sources"] == 12 and not s["parts"]["penis"]["too_few"]
    assert s["parts"]["penis"]["found"] > 0.6 and s["overall"]["found"] > 0.6 and s["overall"]["cerr"] < 0.1
    assert s["parts"]["hips"] == {"n": 4, "sources": 2, "too_few": True}, "under the usable threshold: said so, not scored"
    assert s["overall"]["n"] == 24, "only parts the head answers for count in the overall"
    a, b = seedscore.score(frames, feats), seedscore.score(frames, feats)
    assert {k: v for k, v in a.items() if k != "ms"} == {k: v for k, v in b.items() if k != "ms"}, "deterministic"


def test_one_source_has_nothing_to_hold_out():
    frames, feats = library(n_src=1)
    assert seedscore.score(frames, feats) is None


def test_trend_cache_and_background(tmp_path, monkeypatch):
    frames, feats = library(n_src=4)
    sd = str(tmp_path)
    calls = []
    real = seedscore.score
    monkeypatch.setattr(seedscore, "score", lambda *a, **k: (calls.append(1), real(*a, **k))[1])
    r1 = seedscore.run(sd, frames, feats, "fp1", {"source": "hydra"})
    assert r1["fingerprint"] == "fp1" and "previous" not in r1 and len(calls) == 1
    assert seedscore.run(sd, frames, feats, "fp1", {"source": "hydra"}) == r1 and len(calls) == 1, "same fingerprint: free"
    r2 = seedscore.run(sd, frames[:6], feats, "fp2", {"source": "hydra"})
    assert r2["previous"]["found"] == r1["overall"]["found"] and r2["previous"]["frames"] == r1["frames"]
    for i in range(10):
        seedscore.store(sd, {**r2, "fingerprint": f"x{i}", "at": i})
    d = seedscore.read(sd)
    assert len(d["history"]) == seedscore.HISTORY and d["latest"]["fingerprint"] == "x9"
    # a score slower than the budget: Train gets {pending}; the thread stores the result when it ends
    monkeypatch.setattr(seedscore, "score", lambda *a, **k: (time.sleep(0.4), real(*a, **k))[1])
    p = seedscore.run(sd, frames, feats, "slow", None, budget=0.0)
    assert p == {"pending": True, "fingerprint": "slow"}
    seedscore._RUNNING[sd].join(10)
    assert seedscore.cached(sd, "slow")["sources"] == 4


def test_train_returns_the_score_and_an_unchanged_set_costs_nothing(tmp_path, monkeypatch):
    import json
    lib = tmp_path / "lib"
    lib.mkdir()
    for v in range(4):
        d = {"media": {"path": "v.mp4", "width": 320, "height": 180, "hash": {"value": f"q{v}"}},
             "scenes": [{"start_ms": 0, "end_ms": 5000, "groups": [
                 {"name": "c1_penis", "t_ms": t, "source": "user", "poly": [[0, 0], [1, 0], [1, 1]], "mask": _rle(box_mask(*BOX))} for t in (1000, 2000)]}]}
        (lib / f"p{v}.pawproj").write_text(json.dumps(d), encoding="utf-8")

    def fake_features(seed_dir, frames, emit=None, device=None, src=None):
        os.makedirs(os.path.join(seed_dir, "feats"), exist_ok=True)
        for k, f in enumerate(frames):
            np.savez(seeder.feat_file(seed_dir, f["key"], f["t"]), f=synth(k), grid=np.array(GRID))
        return len(frames)
    monkeypatch.setattr(seeder, "ensure_features", fake_features)
    sd = str(tmp_path / "seed")
    r = seeder.train(sd, [str(lib)])
    assert r["changed"] and r["score"]["sources"] == 4 and r["score"]["parts"]["penis"]["n"] == 8 and r["score"]["overall"]["found"] > 0.25   # degenerate synthetic head (blobs cover the frame): only "it was scored"
    calls = []
    monkeypatch.setattr(seedscore, "score", lambda *a, **k: calls.append(1))
    again = seeder.train(sd, [str(lib)])
    assert not again["changed"] and again["score"]["fingerprint"] == r["score"]["fingerprint"] and not calls


def _rle(mask):
    a = mask.reshape(-1).astype(int) * 15
    out, v, n = [], a[0], 0
    for x in a:
        if x == v:
            n += 1
        else:
            out += [int(v), n]
            v, n = x, 1
    out += [int(v), n]
    return {"w": mask.shape[1], "h": mask.shape[0], "rle": out}
