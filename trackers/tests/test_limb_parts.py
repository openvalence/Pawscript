"""paw-5r1: shoulder / forearm / shin. A head trained on the older, shorter part list keeps answering for its own parts with the new
list (no crash, no mis-indexed heat: its outputs are placed by name), the new parts are not proposed until a Train learns them; the
fingerprint names the list, so the next Train retrains. Sides are the character's own: a suggestion proposes l for a character's first
of a paired part and r for its second, never from where it sits in the picture."""
import numpy as np

from pawtrack import partlabel, seeder
from test_seeder import GRID, synth

OLD = ["penis", "sheath", "balls", "hips", "head", "hand", "paws", "tail", "torso", "knot", "thighs", "tongue", "stomachbulge", "neckbulge"]
NEW = ("shoulder", "forearm", "shin")


def test_new_parts_are_appended_and_paired():
    assert seeder.PARTS[:len(OLD)] == OLD and tuple(seeder.PARTS[len(OLD):]) == NEW
    for p in NEW:
        assert p in partlabel.PAIRED and seeder.MAXN[p] == 4
    assert partlabel.sits_on("c1_forearm_l", "c1_shoulder_l") and partlabel.sits_on("c1_shin_r", "c1_thighs_r") and partlabel.sits_on("c1_paws_l", "c1_shin_l")
    assert not partlabel.sits_on("c1_shin_l", "c2_thighs_l")


def test_a_head_trained_on_the_old_list_keeps_its_parts(tmp_path, monkeypatch):
    data = [synth(s) for s in range(6)]
    f, _ = synth(99, part_box=(1, 3, 10, 13))
    with monkeypatch.context() as m:   # train and save as the code before paw-5r1 would (its PARTS)
        m.setattr(seeder, "PARTS", list(OLD))
        m.setattr(seeder, "PI", {p: i for i, p in enumerate(OLD)})
        h = seeder.Head.fit([x for x, _ in data], [seeder.targets(g, GRID) for _, g in data])
        h.use = np.array([p in ("penis", "hips") for p in OLD])
        old_heat = h.heat(f, GRID)
        h.save(str(tmp_path), {"frames": 6, "fingerprint": "old"})
        fp_old = seeder.fingerprint([])
        assert old_heat.shape[2] == len(OLD)
    seeder._CACHE.clear()
    h2 = seeder.Head.load(str(tmp_path))
    assert h2 is not None, "an old head is not thrown away"
    heat = h2.heat(f, GRID)
    assert heat.shape == (GRID[0], GRID[1], len(seeder.PARTS))
    for i, p in enumerate(OLD):   # every old part's heat at its new index, unchanged
        assert np.allclose(heat[..., seeder.PI[p]], old_heat[..., i], atol=1e-6), p
    for p in NEW:
        assert heat[..., seeder.PI[p]].max() < 1e-6 and not h2.present[seeder.PI[p]] and not h2.use[seeder.PI[p]], p
    assert h2.use[seeder.PI["penis"]] and h2.use[seeder.PI["hips"]] and h2.use.sum() == 2
    reg = seeder.regions(heat, (320, 180), h2.use)
    assert {r["part"] for r in reg} <= {"penis", "hips"} and any(r["part"] == "penis" for r in reg)
    assert seeder.fingerprint([]) != fp_old, "the list is in the fingerprint: the next Train retrains and can learn the new parts"
    # trained on the new list: the new parts are classes like any other
    h3 = seeder.Head.fit([x for x, _ in data], [seeder.targets(g, GRID) for _, g in data])
    assert h3.heat(f, GRID).shape[2] == len(seeder.PARTS)
    # a head that names a part this list does not know is stale, not guessed at
    import torch
    d = torch.load(str(tmp_path / "head.pt"), weights_only=False)
    d["parts"] = OLD[:-1] + ["wing"]
    torch.save(d, str(tmp_path / "head.pt"))
    seeder._CACHE.clear()
    assert seeder.Head.load(str(tmp_path)) is None


def test_usable_needs_labels_from_sources_for_a_new_part():
    fr = [{"key": "a", "groups": [{"part": "forearm", "who": "c1"}] * 5}]
    assert seeder.usable(fr)["forearm"] == {"labels": 5, "videos": 1, "use": False}
    fr.append({"key": "b", "groups": [{"part": "forearm", "who": "c1"}]})
    assert seeder.usable(fr)["forearm"]["use"] is True


def _sq(cx, cy, r=0.04):
    return [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]]


def test_suggested_sides_are_the_characters_not_the_picture_half():
    assert partlabel.pair_sides([("c1", "hand"), ("c1", "penis"), ("c2", "hand"), ("c1", "hand"), ("c1", "hand")]) == ["l", None, "l", "r", None]
    one = [{"name": "hips", "poly": _sq(.5, .5)}, {"name": "forearm", "poly": _sq(.45, .5)}, {"name": "forearm", "poly": _sq(.55, .5)}]
    mirror = [{**g, "poly": [[1 - x, y] for x, y in g["poly"]]} for g in one]
    for gs in (one, mirror):   # the same sides whichever way round the picture is: the first l, the second r
        out = partlabel.assign_who(gs, (), 16 / 9)
        assert [(g["part"], g["side"]) for g in out] == [("hips", None), ("forearm", "l"), ("forearm", "r")]
        assert [g["name"] for g in out] == ["c1_hips", "c1_forearm_l", "c1_forearm_r"]
