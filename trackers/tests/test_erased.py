"""v4.53 (paw-yx6q): what the owner erased from a group stays out: no points seeded there, and the shaft pass's SAM mask
never takes it in on the group's painted frame. CPU only (a fake runner, a stand-in SAM)."""
import numpy as np

from pawtrack import cli, partlabel, shaft
from pawtrack import points as C
from test_user_groups import FRAMES, P, SQ, WHOLE, static_run


def test_parse_groups_keeps_erased_and_skips_bad_outlines():
    g = cli.parse_groups([{"name": "tail", "poly": SQ(.1, .1, .5, .5), "erased": [SQ(.2, .2, .3, .3), [[0, 0], [1, 1]], "x"]},
                          {"name": "hips", "poly": SQ(.1, .1, .5, .5), "erased": "nope"},
                          {"name": "head", "poly": SQ(.1, .1, .5, .5)}])
    assert g[0]["erased"] == [SQ(.2, .2, .3, .3)]
    assert "erased" not in g[1] and "erased" not in g[2]
    m = partlabel.erased_mask(g[0], 100, 100)
    assert m[25, 25] and not m[10, 10] and partlabel.erased_mask(g[2], 100, 100) is None


def test_no_point_is_seeded_in_an_erased_hole(monkeypatch):
    monkeypatch.setattr(partlabel, "hydra_ready", lambda: False)
    hole = (0.35, 0.35, 0.65, 0.65)   # the middle of the group, erased (the outline the app sends has no hole)
    groups = cli.parse_groups([{"name": "tail", "poly": SQ(.1, .1, .9, .9), "t_ms": 1000, "erased": [SQ(*hole)]}])
    out = list(C.wrap(static_run, WHOLE, FRAMES, P | {"groups": groups}, lambda vp, cf: 1.0, None, work_wh=(160, 120)))
    pts = [q for q in out[0][2]["pts"] if len(q) == 6 and q[5] == 4]
    assert len(pts) >= 8
    inn = [q for q in pts if hole[0] + 0.02 < q[0] < hole[2] - 0.02 and hole[1] + 0.02 < q[1] < hole[3] - 0.02]
    assert not inn, f"{len(inn)} points seeded inside the erased hole"
    plain = list(C.wrap(static_run, WHOLE, FRAMES, P | {"groups": cli.parse_groups([{"name": "tail", "poly": SQ(.1, .1, .9, .9), "t_ms": 1000}])},
                        lambda vp, cf: 1.0, None, work_wh=(160, 120)))
    assert any(hole[0] < q[0] < hole[2] and hole[1] < q[1] < hole[3] for q in plain[0][2]["pts"] if len(q) == 6), "without it the hole is seeded"


def test_the_shaft_mask_does_not_take_the_erased_area_on_the_painted_frame(monkeypatch):
    W, H, n = 200, 120, 6
    X = np.full((n, 5, 2), np.nan)
    X[:, :, 0], X[:, :, 1] = np.linspace(60, 140, 5), 60.0   # five members along a horizontal shaft

    def greedy(frames, roi, size, p):   # SAM taking in everything similar: the whole crop
        for k, img in frames:
            yield k, np.ones(img.shape[:2], bool), 0.9
    monkeypatch.setattr(shaft, "sam_chunk", greedy)
    er = np.zeros((H, W), bool)
    er[20:40, 150:190] = True
    frame_at = lambda i: np.zeros((H, W, 3), np.uint8)
    out, conf, st, bound = shaft.schedule(frame_at, n, X, [], (W, H), {"shaft_stride": 1, "shaft_reprompt": 48}, np.full(n, 80.0), cut=(2, er))
    def full(k):   # the crop mask on the whole frame
        m, (x0, y0) = out[k]
        z = np.zeros((H, W), bool)
        z[y0:y0 + m.shape[0], x0:x0 + m.shape[1]] = m
        return z
    assert full(2)[er].sum() == 0, "the painted frame's mask keeps out of what was erased"
    # paw-jyf9: SAM's memory would take it back on the later frames: every frame is cut (was: "other frames are SAM's")
    assert all(full(k)[er].sum() == 0 for k in range(n)), "the erased area stays out on every frame"
    a, *_ = shaft.schedule(frame_at, n, X, [], (W, H), {"shaft_stride": 1, "shaft_reprompt": 48}, np.full(n, 80.0))
    m3, (x0, y0) = a[3]
    assert m3.all() and m3[20 - y0:40 - y0, 150 - x0:190 - x0].any(), "without a cut: SAM's whole mask, the area included"


def test_the_erased_area_follows_the_group_and_seeds_sams_memory(monkeypatch):
    """paw-jyf9: the shaft moves 6 px a frame; the erase drawn on frame 3 is cut where the members' fit carries it on every
    frame; SAM's chunk ends at the painted frame and the next one starts from the cut mask (its memory), and a stride
    that would skip the painted frame does not."""
    W, H, n = 240, 120, 10
    X = np.full((n, 5, 2), np.nan)
    X[:, :, 0], X[:, :, 1] = np.linspace(60, 140, 5)[None] + 6 * np.arange(n)[:, None], 60.0
    rois = []

    def greedy(frames, roi, size, p):
        rois.append(roi)
        for k, img in frames:
            yield k, np.ones(img.shape[:2], bool), 0.9
    monkeypatch.setattr(shaft, "sam_chunk", greedy)
    er = np.zeros((H, W), bool)
    er[50:70, 90:110] = True   # on frame 3: between two members
    frame_at = lambda i: np.zeros((H, W, 3), np.uint8)
    for stride in (1, 2):
        rois.clear()
        out, *_ = shaft.schedule(frame_at, n, X, [], (W, H), {"shaft_stride": stride, "shaft_reprompt": 48}, np.full(n, 80.0), cut=(3, er))
        assert out[3] is not None, f"stride {stride}: the painted frame is never skipped"
        for k in range(n):
            if out[k] is None:
                continue
            m, (x0, y0) = out[k]
            z = np.zeros((H, W), bool)
            z[y0:y0 + m.shape[0], x0:x0 + m.shape[1]] = m
            moved = np.roll(er, 6 * (k - 3), 1)
            assert z[moved].sum() == 0, f"stride {stride} frame {k}: the erased area, moved with the group, stays out"
            assert z[np.roll(er, 6 * (k - 3) + 30, 1)].all(), f"stride {stride} frame {k}: the rest of the mask is kept"
        assert len(rois) >= 2 and rois[1]["kind"] == "none", "the chunk after the painted frame starts from its mask"
        ax0, ay0 = out[3 + stride][1]   # the anchor is frame 3's mask cut to the next chunk's crop
        a = rois[1]["anchors"][0][1]
        assert a.any() and not a[50 - ay0:70 - ay0, 90 - ax0:110 - ax0].any(), "SAM's memory is the cut mask"
