"""paw-v0oe: the motion-groups pass is faster (members-only fits, a thread pool, pass 1 fits the bodies ahead) and its
output did not change: bit-identical to the code before (tests/data/groups_golden.npz, made by that code on scene()),
whatever the thread count; BLAS threads are restored; progress fractions move."""
import os
import warnings

import numpy as np
import pytest

import pawtrack.progress as pr
from pawtrack import groups, motion_model as mm

GOLDEN = os.path.join(os.path.dirname(__file__), "data", "groups_golden.npz")


def scene(T=300, fps=15.0, seed=3):
    """Two bodies stroking against each other, a tail part, background, three pinned groups, occlusions, re-seeds."""
    rng = np.random.default_rng(seed)
    t = np.arange(T) / fps
    s = np.sin(2 * np.pi * 1.2 * t)
    A, B = np.c_[0.03 * s, 0.01 * s], np.c_[-0.025 * s, -0.008 * s]
    tail = A + np.c_[0.02 * np.sin(4 * np.pi * 1.2 * t), 0.01 * np.cos(4 * np.pi * 1.2 * t)]
    cam = np.c_[0.01 * np.sin(2 * np.pi * t / 9), 0.0 * t]
    parts = [(40, (0.5, 0.5), 0.45, 0 * A, 0), (35, (0.38, 0.5), 0.1, A, 0), (30, (0.64, 0.5), 0.1, B, 0),
             (12, (0.28, 0.6), 0.03, tail, 0), (12, (0.46, 0.5), 0.02, A * 1.1, 1), (12, (0.44, 0.56), 0.02, A, 2),
             (12, (0.62, 0.5), 0.03, B, 3)]
    xy, pin = [], []
    for n, c, rad, mot, p in parts:
        off = rad * rng.uniform(-1, 1, (n, 2))
        xy.append(np.array(c) + mot[:, None] + off[None] * (1 + 0.03 * s[:, None, None]) + cam[:, None]
                  + rng.normal(0, 0.0015, (T, n, 2)))
        pin.append(np.full(n, p))
    xy, pin = np.clip(np.concatenate(xy, 1), 0, 1), np.concatenate(pin)
    N = xy.shape[1]
    vis = np.ones((T, N), bool)
    for j in range(N):
        for _ in range(rng.poisson(2)):
            a = rng.integers(0, T)
            vis[a:a + rng.integers(3, 40), j] = False
    for j in rng.choice(N, 15, replace=False):
        vis[:rng.integers(1, T - 30), j] = False  # born late (held at the seed position meanwhile)
    first = vis.argmax(0)
    idx = np.maximum.accumulate(np.where(vis, np.arange(T)[:, None], 0), 0)
    idx = np.where(np.arange(T)[:, None] < first[None], first[None], idx)
    return xy[idx, np.arange(N)], vis, fps, pin


def run(threads=None, tick=None):
    xy, vis, fps, pin = scene()
    return groups.group_tracks(xy, vis, fps, aspect=16 / 9, pinned=pin, threads=threads, tick=tick)


def test_output_is_the_old_codes_bit_for_bit():
    """The golden is the pre-paw-v0oe group_tracks on scene(). Bit-identical here; should a numpy / scipy upgrade move
    the floats by noise, the tolerance below still holds (labels / parts / counts exact, floats 1e-9 of their range)."""
    old, new = np.load(GOLDEN), run(threads=3)
    assert set(old) == {k for k, v in new.items() if not isinstance(v, dict)}
    for k in old:
        a, b = old[k], np.asarray(new[k])
        assert a.shape == b.shape, k
        if a.dtype.kind != "f":
            assert np.array_equal(a, b), k
            continue
        assert np.array_equal(np.isnan(a), np.isnan(b)), k
        span = np.nanmax(np.abs(a)) if np.isfinite(a).any() else 0.0
        assert np.allclose(a, b, rtol=0, atol=1e-9 * max(span, 1e-12), equal_nan=True), k


def test_thread_count_does_not_change_the_output():
    a, b = run(threads=1), run(threads=4)
    for k, v in a.items():
        if not isinstance(v, dict):
            assert np.array_equal(v, b[k], equal_nan=np.asarray(v).dtype.kind == "f"), k


def _fit_ref(d, r, w):  # motion_model.fit before paw-v0oe: all columns, np.nanmedian
    def nanmed(x, axis):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            return np.nanmedian(x, axis)

    def one(d, r, w):
        wf = w.astype(float)[..., None]
        n = np.maximum(wf.sum(1), 1e-12)
        c, t = (wf * r).sum(1) / n, (wf * d).sum(1) / n
        u, e = r - c[:, None], d - t[:, None]
        uu = np.maximum((wf[..., 0] * (u ** 2).sum(2)).sum(1), 1e-12)
        a = (wf[..., 0] * (e * u).sum(2)).sum(1) / uu
        b = (wf[..., 0] * (e[..., 1] * u[..., 0] - e[..., 0] * u[..., 1])).sum(1) / uu
        return np.c_[t, a, b], c
    res = np.linalg.norm(d - nanmed(np.where(w[..., None], d, np.nan), 1)[:, None], axis=2)
    w2 = w
    for _ in range(mm.REFIT_N + 1):
        med = np.nan_to_num(nanmed(np.where(w2, res, np.nan), 1), nan=np.inf)
        w2 = w & (res <= mm.REFIT_K * med[:, None] + 1e-9)
        w2 = np.where((w2.sum(1) >= mm.MIN_PTS)[:, None], w2, w)
        p, c = one(d, r, w2)
        res = np.linalg.norm(d - mm.predict(p, c, r), axis=2)
    p[w.sum(1) < mm.MIN_PTS] = np.nan
    return p, c, np.where(w, res, np.nan)


@pytest.mark.parametrize("T,N,m", [(400, 900, 60), (120, 300, 290), (50, 40, 2), (1, 30, 10), (3000, 2458, 600)])
def test_members_only_fit_is_the_full_fit(T, N, m):
    rng = np.random.default_rng(T)
    d, r = rng.normal(0, 0.01, (T, N, 2)), rng.uniform(0, 1, (T, N, 2))
    w = np.zeros((T, N), bool)
    w[:, rng.choice(N, m, replace=False)] = rng.random((T, m)) < 0.8
    for a, b in zip(mm.fit(d, r, w), _fit_ref(d, r, w)):
        assert np.array_equal(a, b, equal_nan=True)


def test_nanmed_is_numpys():
    rng = np.random.default_rng(1)
    x = rng.normal(size=(60, 700))
    x[rng.random(x.shape) < 0.6] = np.nan
    x[3], x[4, 1:], x[5, 2:] = np.nan, np.nan, np.nan  # none, one, two real values
    x[6] = 1.0  # ties
    with warnings.catch_warnings():  # numpy warns on the all-NaN row; _nanmed is silent
        warnings.simplefilter("ignore", RuntimeWarning)
        ref, small = np.nanmedian(x, 1), np.nanmedian(x[:, :50], 1)  # (< 600 columns: numpy's masked-array path)
    assert np.array_equal(mm._nanmed(x, 1), ref, equal_nan=True)
    assert np.array_equal(mm._nanmed(x[:, :50], 1), small, equal_nan=True)
    assert np.array_equal(mm._nanmed(x.T, 0), ref, equal_nan=True)


def test_blas_threads_restored_and_one_meanwhile(monkeypatch):
    b = groups._blas()
    if b is None:
        pytest.skip("numpy without the scipy-openblas library")
    seen, cl = [], groups.cluster
    monkeypatch.setattr(groups, "cluster", lambda *a: (seen.append(b[0]()), cl(*a))[1])
    old = b[0]()
    try:
        b[1](3)
        run(threads=2)
        assert b[0]() == 3, "the caller's BLAS thread count is back"
        assert seen and set(seen) == {1}, "one BLAS thread per pool worker during the pass"
    finally:
        b[1](old)


def test_thread_default(monkeypatch):
    monkeypatch.delenv("OMP_NUM_THREADS", raising=False)
    monkeypatch.setenv("PAWTRACK_THREADS", "3")
    assert groups.default_threads() == 3
    for bad in ("0", "x", ""):
        monkeypatch.setenv("PAWTRACK_THREADS", bad)
        assert groups.default_threads() == (os.cpu_count() or 1)
    monkeypatch.delenv("PAWTRACK_THREADS")
    monkeypatch.setenv("OMP_NUM_THREADS", "2")  # a script that limits its threads
    assert groups.default_threads() == 2


def test_progress_fractions_move():
    f = []
    run(threads=2, tick=f.append)
    assert len(set(f)) > 10 and f == sorted(f) and 0 <= f[0] and f[-1] == 1.0


def test_steps_stage_counts_its_own_work_then_gives_the_job_back(monkeypatch):
    out = []
    monkeypatch.setattr(pr.time, "monotonic", iter(range(0, 1000, 1)).__next__)  # every event goes (1 s apart)
    p = pr.Progress(out.append, total=500, every=0.5)
    p(480, stage="inference")
    pr.CURRENT = p
    try:
        with pr.steps("groups") as tick:
            tick(0.25)
            tick(1.0)
    finally:
        pr.CURRENT = None
    assert out[1:] == [{"type": "progress", "done": 0, "total": pr.STEPS, "stage": "groups"},
                       {"type": "progress", "done": pr.STEPS // 4, "total": pr.STEPS, "stage": "groups"},
                       {"type": "progress", "done": pr.STEPS, "total": pr.STEPS, "stage": "groups"}]
    assert (p.done, p.total) == (480, 500)
    with pr.steps("groups") as tick:  # no job: nothing, no error
        tick(0.5)
