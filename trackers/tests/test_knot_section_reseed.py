"""[review] v4.54 knot section through re-seeding: the knot goes inside the partner for longer than retire_ms (default 2 s)
and comes back out. An old separate knot group gets its channels back (its re-seeded members keep the knot id); the
section's channels must too (today its members are the seed indices only, so once they are retired it reads None for
the rest of the scene). CPU only (a fake runner).
paw-adxi: a hidden section's members wait for it (no hull pick moves them onto the rest of the shaft), and while none of
them shows, its centre is carried by the penis group's fit with _n 0 (never None while the penis is seen)."""
import numpy as np

from pawtrack import cli, partlabel
from pawtrack import points as C
from test_user_groups import FRAMES, P, SQ, WHOLE

KN = (0.3, 0.3, 0.42, 0.6)
PEN = (0.3, 0.3, 0.7, 0.6)
FR = [(round(k * 1000 / 30), FRAMES[0][1]) for k in range(240)]   # 8 s


def in_box(xy, b, e=.005):
    return (xy[:, 0] >= b[0] - e) & (xy[:, 0] <= b[2] + e) & (xy[:, 1] >= b[1] - e) & (xy[:, 1] <= b[3] + e)


def knot_hidden(fr, seed, reseed=None, hide=(1000, 4000), drift=0.0):
    """Every slot stays at its layout place, a slot inside the penis box moves right by drift x t / 8 s; a slot inside
    the knot box is hidden over hide (ms, real time; the back pass is mirrored)."""
    base, last = seed.copy(), None
    d = lambda t: np.array([drift * t / 8000, 0.0])
    for t, img in fr:
        if reseed is not None and last is not None:
            slots, new = reseed(t, img, *last[:2])
            base = np.r_[base, np.zeros((int((slots >= len(base)).sum()), 2))]
            new = np.asarray(new).reshape(-1, 2)
            base[slots] = new - in_box(new - d(last[2]), PEN)[:, None] * d(last[2])
        pen = in_box(base, PEN)
        xy = base + pen[:, None] * d(t)
        vis = ~(in_box(base, KN) & (hide[0] <= t < hide[1]))
        last = xy, vis, t
        yield t, xy, vis, vis.astype(float), np.ones(len(xy))


def knot_at(groups, ks, **kw):
    run = lambda fr, seed, reseed=None: knot_hidden(fr, seed, reseed, **kw)
    out = list(C.wrap(run, WHOLE, FR, P | {"groups": cli.parse_groups(groups)}, lambda vp, cf: 1.0, None, work_wh=(160, 120)))
    return [(out[k][1]["channels"].get("sem_c2_knot_x"), out[k][1]["channels"].get("sem_c2_knot_n")) for k in ks]


SECTION = [{"name": "p", "who": "c2", "part": "penis", "poly": SQ(*PEN), "t_ms": 1000, "knot": [SQ(*KN)]}]


def test_the_knot_section_comes_back_after_a_hide_longer_than_retire_ms(monkeypatch):
    monkeypatch.setattr(partlabel, "hydra_ready", lambda: False)
    old = [{"name": "p", "who": "c2", "part": "penis", "poly": SQ(0.42, 0.3, 0.7, 0.6), "t_ms": 1000},
           {"name": "k", "who": "c2", "part": "knot", "poly": SQ(*KN), "t_ms": 1000}]
    assert knot_at(old, [180])[0][0] is not None, "the old separate knot group is back at 6 s"
    (x, n), = knot_at(SECTION, [180])
    assert x is not None and n > 0, "the knot section is back at 6 s (its members waited for it)"


def test_a_section_hidden_to_the_end_is_carried_by_the_penis_fit(monkeypatch):
    monkeypatch.setattr(partlabel, "hydra_ready", lambda: False)
    (x0, n0), (x1, n1), (x2, n2) = knot_at(SECTION, [15, 180, 239], hide=(2000, 10 ** 9), drift=0.05)
    assert x0 is not None and n0 > 0, "seen before the hide"
    for x, n, t in ((x1, n1, 6000), (x2, n2, 7967)):
        assert n == 0 and x is not None, f"hidden at {t} ms: carried, low confidence (_n 0), not None"
        assert abs(x - (x0 + 0.05 * (t - 500) / 8000)) < 0.01, (x, x0, t)   # moved with the penis, not held


def test_a_section_never_seen_after_seeding_still_has_a_place(monkeypatch):
    monkeypatch.setattr(partlabel, "hydra_ready", lambda: False)
    res = knot_at(SECTION, [0, 30, 120, 239], hide=(1000, 10 ** 9))
    assert all(x is not None and n == 0 for x, n in res), res
    assert all(abs(x - 0.36) < 0.03 for x, _ in res), res   # the section's centre on the static scene


def test_the_shaft_pass_takes_the_knot_section_as_a_base_end_hint():
    """paw-adxi: an own knot group told the shaft pass where the base is (BASE_PARTS); the section does the same."""
    from pawtrack import shaft
    W, H, n = 320, 240, 20
    xs = np.linspace(60, 260, 11)
    pts = [[[float(x / W), 0.5, 1, 1, 0, 1] for x in xs] for _ in range(n)]
    g = {"name": "p", "id": 1, "who": "c2", "part": "penis", "t_ms": 0, "poly": SQ(0.15, 0.45, 0.85, 0.55)}
    ts = [k * 1000 / 30 for k in range(n)]
    for side, want in ((0.7, 260), (0.15, 60)):   # the knot painted at the right end, then at the left end
        kg = g | {"knot": [SQ(side, 0.45, side + 0.15, 0.55)]}
        res = shaft.run_scene(ts, pts, [kg], kg, (W, H), {}, frame_at=None)
        assert res["record"]["base_from"] == "own", res["record"]
        assert abs(res["channels"]["bx"][0] * W - want) < 15, (side, res["channels"]["bx"][0] * W)
