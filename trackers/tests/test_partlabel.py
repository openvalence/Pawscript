"""pawtrack.partlabel: one GPU test with the real tagger (the other helpers are covered by their callers' tests)."""
import numpy as np
import pytest

from pawtrack import partlabel as PL


def _cuda():
    try:
        import pyvips  # noqa: F401
        import torch
        return torch.cuda.is_available()
    except Exception:
        return False


@pytest.mark.gpu
@pytest.mark.skipif(not _cuda(), reason="needs CUDA and the describe deps")
def test_heat_maps_gpu():
    rng = np.random.default_rng(0)
    frames = [(0, rng.integers(0, 255, (432, 768, 3), np.uint8))]
    (h,) = PL.heat_maps(frames)
    for lab, m in h.items():
        assert lab in PL.VOCAB and m.ndim == 2 and 0 <= m.min() and m.max() <= 1.0 + 1e-6


# ---- v4.13: the previous shot's groups as a clue (partlabel.match_prior), synthetic, no models ----
def _g(name, who, part, cx, cy, side=None, r=0.05):
    return {"name": name, "who": who, "part": part, "side": side, "poly": [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]], "pinned": True, "source": "tagger"}


def test_match_prior_keeps_identities_and_flags_them():
    sug = [_g("c1_penis", "c1", "penis", 0.3, 0.5), _g("c2_hips", "c2", "hips", 0.7, 0.5), _g("c1_tail", "c1", "tail", 0.1, 0.2)]
    prior = [{"name": "c1_penis", "who": "c1", "part": "penis", "poly": _g("", "", "", 0.6, 0.4)["poly"]}, {"name": "c2_hips", "who": "c2", "part": "hips"},
             {"name": "c2_hand_l", "who": "c2", "part": "hand", "side": "l"}]
    out, missing = PL.match_prior(sug, prior)
    by = {g["name"]: g for g in out}
    assert by["c1_penis"]["unconfirmed"] and by["c1_penis"]["prior"] == "c1_penis"
    assert by["c2_hips"]["unconfirmed"]
    assert "unconfirmed" not in by["c1_tail"], "a new part is just a suggestion"
    assert missing == ["c2_hand_l"]
    assert PL.match_prior(sug, []) == (sug, [])


def test_match_prior_characters_swapped_sides_at_the_cut():
    # the new framing puts C2 on the left: assign_who calls it c1; the prior says the penis is C2's
    sug = [_g("c1_penis", "c1", "penis", 0.3, 0.5), _g("c2_hips", "c2", "hips", 0.7, 0.5), _g("c2_head", "c2", "head", 0.8, 0.2)]
    prior = [{"name": "c2_penis"}, {"name": "c1_hips"}]
    out, missing = PL.match_prior(sug, prior)
    names = sorted(g["name"] for g in out)
    assert names == ["c1_head", "c1_hips", "c2_penis"], names
    assert missing == []
    assert next(g for g in out if g["name"] == "c1_head").get("unconfirmed") is None, "swapped with its character, not a prior part"


def test_match_prior_nearest_of_two_same_parts():
    sug = [_g("c1_hand_l", "c1", "hand", 0.2, 0.5, "l"), _g("c1_hand_r", "c1", "hand", 0.4, 0.5, "r")]
    prior = [{"name": "c1_hand", "who": "c1", "part": "hand", "poly": _g("", "", "", 0.41, 0.52)["poly"]}]   # no side: the nearest
    out, _ = PL.match_prior(sug, prior)
    hit = [g for g in out if g.get("unconfirmed")]
    assert len(hit) == 1 and hit[0]["side"] == "r"
