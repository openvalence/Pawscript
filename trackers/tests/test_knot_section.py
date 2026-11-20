"""v4.54 (paw-njnf): the knot is a section of the penis group, not a group of its own: its points are the penis' points inside
the section (same id: one fit, one re-placement), and the section's centre comes out as sem_<who>_knot_* like an old knot
group's. CPU only (a fake runner)."""
import numpy as np

from pawtrack import cli, partlabel
from pawtrack import points as C
from test_user_groups import FRAMES, P, SQ, WHOLE, static_run

PEN, KNOT = (0.3, 0.3, 0.7, 0.6), (0.3, 0.3, 0.42, 0.6)   # the knot section: the penis' base end


def run(groups):
    return list(C.wrap(static_run, WHOLE, FRAMES, P | {"groups": cli.parse_groups(groups)}, lambda vp, cf: 1.0, None, work_wh=(160, 120)))


def test_parse_groups_keeps_a_section_on_a_pinned_group_only():
    g = cli.parse_groups([{"name": "x", "who": "c2", "part": "penis", "poly": SQ(*PEN), "knot": [SQ(*KNOT), "bad"]},
                          {"name": "body", "poly": SQ(0, 0, 1, 1), "pinned": False, "knot": [SQ(*KNOT)]}])
    assert g[0]["knot"] == [SQ(*KNOT)] and "knot" not in g[1]


def test_the_section_is_a_labelled_subset_of_the_penis_points(monkeypatch):
    monkeypatch.setattr(partlabel, "hydra_ready", lambda: False)
    pen = {"name": "p", "who": "c2", "part": "penis", "poly": SQ(*PEN), "t_ms": 1000}
    out = run([pen | {"knot": [SQ(*KNOT)]}])
    pts = out[0][2]["pts"]
    gid = 4
    mem = [q for q in pts if len(q) == 6 and q[5] == gid]
    assert len(mem) >= 8 and not any(len(q) == 6 and q[5] not in (gid,) for q in pts), "no group of its own: every pinned point is the penis'"
    ch = out[0][1]["channels"]
    inside = [q for q in mem if KNOT[0] - 0.01 <= q[0] <= KNOT[2] + 0.01]
    assert inside and ch["sem_c2_knot_x"] is not None
    assert abs(ch["sem_c2_knot_x"] - np.mean([q[0] for q in inside])) < 0.03, "the section's centre"
    assert ch["sem_c2_knot_x"] < ch["sem_c2_penis_x"], "at the base end, left of the penis' centre"
    assert ch["sem_c2_knot_n"] == len(inside) / len(pts)
    # absent: no knot channels, and everything else exactly as without the field
    plain = run([pen])
    assert not any("knot" in k for k in plain[0][1]["channels"])
    assert [r[2]["pts"] for r in plain] == [r[2]["pts"] for r in out]
    same = {k: v for k, v in out[0][1]["channels"].items() if "knot" not in k}
    assert same == plain[0][1]["channels"]


def test_an_old_separate_knot_group_keeps_working(monkeypatch):
    monkeypatch.setattr(partlabel, "hydra_ready", lambda: False)
    out = run([{"name": "p", "who": "c2", "part": "penis", "poly": SQ(0.42, 0.3, 0.7, 0.6), "t_ms": 1000},
               {"name": "k", "who": "c2", "part": "knot", "poly": SQ(*KNOT), "t_ms": 1000}])
    ch = out[0][1]["channels"]
    assert ch["sem_c2_knot_x"] is not None and ch["sem_c2_penis_x"] is not None
    assert {q[5] for q in out[0][2]["pts"] if len(q) == 6} == {4, 5}, "two groups, as before"
