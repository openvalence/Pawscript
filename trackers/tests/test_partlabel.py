"""pawtrack.partlabel on synthetic heat maps and member sets (no model); one GPU test with the real tagger."""
import numpy as np
import pytest

from pawtrack import partlabel as PL
from test_cli import video  # noqa: F401 (fixture)

GRID = (24, 42)  # (ph, pw), 16:9 at seqlen 1024


def blob(cx, cy, r=0.06):
    ph, pw = GRID
    y, x = np.mgrid[0:ph, 0:pw]
    return np.exp(-(((x + 0.5) / pw - cx) ** 2 + ((y + 0.5) / ph - cy) ** 2) / (2 * r * r)).astype(np.float32)


def scene(rng, n_body=80, n_part=12):
    """A body spread over the frame and a compact part (12 points) at (0.5, 0.7); xy (N, 2), part / body masks."""
    body = rng.uniform([0.2, 0.2], [0.8, 0.8], (n_body, 2))
    part = rng.normal([0.5, 0.7], 0.015, (n_part, 2))
    xy = np.r_[body, part]
    isp = np.r_[np.zeros(n_body, bool), np.ones(n_part, bool)]
    return xy, isp


def test_part_gets_the_tag_body_falls_back():
    xy, isp = scene(np.random.default_rng(0))
    heat = {"penis": blob(0.5, 0.7), "head": blob(0.25, 0.25)}
    sets = {"g1": np.ones(len(xy), bool)[None], "g1p1": isp[None]}
    r = PL.label([heat], xy[None], np.ones((1, len(xy)), bool), sets)
    assert r["g1p1"]["label"] == "penis" and r["g1p1"]["score"] > 0
    assert r["g1"]["label"] == "body" and r["g1"]["score"] == 0.0
    assert r["g1p1"]["tags"]["penis"] > r["g1p1"]["tags"].get("head", 0)


def test_margin_and_floor():
    assert PL.decide({"penis": 0.8, "balls": 0.75}, 0.1)[0] == "body"           # too close to the runner-up
    assert PL.decide({"penis": 0.2}, 0.1)[0] == "body"                          # under the body floor
    assert PL.decide({"penis": 0.8, "balls": 0.5}, 0.1)[:2] == ("penis", 0.3)   # score = margin over max(2nd, floor)
    assert PL.decide({}, 0.1) == ("body", 0.0, None)


def test_geometry_small_tag_on_a_big_group():
    assert PL.decide({"balls": 0.9}, 0.8) == ("body", 0.0, "balls")             # balls as big as its parent: suspect
    assert PL.decide({"tail": 0.9}, 0.8)[0] == "tail"                            # not a SMALL tag: no size rule
    xy, isp = scene(np.random.default_rng(1))
    heat = {"balls": np.ones(GRID, np.float32)}                                  # everything glows
    r = PL.label([heat], xy[None], np.ones((1, len(xy)), bool), {"g1": np.ones(len(xy), bool)[None]})
    assert r["g1"]["label"] == "body" and r["g1"]["suspect"] == "balls"


def test_k_frame_aggregation_and_stability():
    xy, isp = scene(np.random.default_rng(2))
    on, off = {"balls": blob(0.5, 0.7)}, {"balls": blob(0.9, 0.1)}
    K = 5
    xys, vis = np.repeat(xy[None], K, 0), np.ones((K, len(xy)), bool)
    sets = {"g1": np.ones((K, len(xy)), bool), "g1p1": np.repeat(isp[None], K, 0)}
    r = PL.label([on, on, on, on, off], xys, vis, sets)["g1p1"]
    assert r["label"] == "balls" and r["frames"] == 5 and r["stable"] == 0.8  # 4 of 5 frames agree
    vis[3:, isp] = False  # part hidden on two frames: they do not count
    r = PL.label([on, on, on, off, off], xys, vis, sets)["g1p1"]
    assert r["frames"] == 3 and r["stable"] == 1.0


def test_masks_and_tap():
    lab = np.array([[1, 1, 2, -1], [1, 1, 2, 0]], np.int8)
    part = np.array([[0, 1, 0, 0], [0, 1, 0, 0]], np.int8)
    m = PL.masks({"labels": lab, "part": part})
    assert set(m) == {"g1", "g1p1", "g2"} and m["g1p1"][:, 1].all() and not m["g1p1"][:, 0].any()
    assert set(PL.masks({"labels": lab})) == {"g1", "g2"}
    assert PL.parent("g1p2") == "g1" and PL.parent("g3") is None
    tap = PL.Tap(cap=4)
    frames = [(i * 40, np.zeros((4, 8, 3), np.uint8)) for i in range(1000)]
    assert len(list(tap(iter(frames)))) == 1000  # passes every frame through
    assert len(tap.buf) <= 8 and len({b[0] for b in tap.buf}) == len(tap.buf)
    d = np.diff([b[0] for b in tap.buf])
    assert (d == d[0]).all()  # evenly spaced
    pk = [t for t, _ in tap.pick(5)]
    assert len(pk) == 5 and pk == sorted(pk) and pk[0] < 8000 and pk[-1] > 28000


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
