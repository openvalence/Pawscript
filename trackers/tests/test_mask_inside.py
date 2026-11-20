"""v4.39: a modifier's own SAM run (painted seed, corrections) and the mask-only inside fraction. CPU only: the SAM
video predictor is faked (it returns each object's ground-truth mask and records the prompts it was given)."""
from contextlib import nullcontext

import numpy as np
import pytest

from pawtrack import cli, shaft
from pawtrack.trackers import sam2_mask as sm

H, W = 180, 320


def rod(x0, x1, y=90, half=8):
    m = np.zeros((H, W), bool)
    m[y - half:y + half, max(0, int(x0)):max(0, int(x1))] = True
    return m


def region(x0=200):
    m = np.zeros((H, W), bool)
    m[50:130, x0:W - 10] = True
    return m


def shaft_frames(n=60, full=120):
    """A 120 px shaft (base left, tip right) going into a region that starts at x = 200: the tip slides from x = 140
    (out, free) to 260 (half in) and back; frames 0..9 start with its base off screen (x0 < 0)."""
    out = []
    for i in range(n):
        tip = 140 + 120 * np.sin(np.pi * i / (n - 1))
        x0 = -10 if i < 10 else tip - full   # the first 10 frames: the base cut by the left border (off screen)
        visible = rod(x0, min(tip, 200))           # inside the region the shaft is hidden: the mask stops at the entry
        out.append((visible, tip))
    return out


def test_frame_measure_and_inside():
    fr = shaft_frames()
    cols = {k: [] for k in ("mL", "w", "holes", "gap", "edge", "dp", "mconf")}
    truth = []
    for m, tip in fr:
        r = shaft.frame_measure(m, region(), 0.95)
        for k in cols:
            cols[k].append(r.get(k, np.nan))
        truth.append(np.clip((tip - 200) / 120, 0, 1))
    assert shaft.frame_measure(fr[20][0], None) == {}   # no region: nothing about insertion
    ch, rec = shaft.mask_scene({k: np.array(v, float) for k, v in cols.items()}, 30)
    ins, conf = ch["in"], ch["in_conf"]
    edge = np.arange(len(fr)) < 10
    ok = (conf >= shaft.CONF_MIN) & ~edge
    assert ok.sum() > 30
    assert np.nanmax(np.abs(ins[ok] - np.array(truth)[ok])) < 0.08   # inside fraction within 8 % of the length
    # the frames whose base is off screen: cut by the border, never trusted, never the reference length
    assert (conf[edge] < shaft.CONF_MIN).all()
    assert rec["full"] == "seen" and rec["source"] == "sam" and rec["edge_share"] > 0


def test_inside_relative_when_never_free():
    # the tip always at the region: the full length is the longest trusted one (relative)
    cols = {k: [] for k in ("mL", "w", "holes", "gap", "edge", "dp", "mconf")}
    for i in range(30):
        tip = 230 + 20 * np.sin(i / 3)
        r = shaft.frame_measure(rod(tip - 150, 200), region(), 0.9)
        for k in cols:
            cols[k].append(r.get(k, np.nan))
    ch, rec = shaft.mask_scene({k: np.array(v, float) for k, v in cols.items()}, 30)
    assert rec["full"] == "relative"


def test_parse_groups_fixes():
    g = cli.parse_groups([{"name": "x", "who": "c2", "part": "penis", "poly": [[0, 0], [1, 0], [1, 1]], "t_ms": 10,
                           "fixes": [{"t_ms": 500, "poly": [[0.1, 0.1], [0.5, 0.1], [2, 0.5]]}]}])[0]
    assert g["name"] == "c2_penis" and g["fixes"] == [{"t_ms": 500.0, "poly": [[0.1, 0.1], [0.5, 0.1], [1.0, 0.5]]}]
    with pytest.raises(ValueError):
        cli.parse_groups([{"name": "x", "poly": [[0, 0], [1, 0], [1, 1]], "fixes": [{"t_ms": 1}]}])


def test_shaft_pair():
    objs = [{"part": "anus", "who": "c1"}, {"part": "penis", "who": "c2"}, {"part": "hand", "who": "c1"}]
    assert sm.shaft_pair(objs) == (1, 0)
    assert sm.shaft_pair([{"part": "balls", "who": "c2"}]) == (None, None)


class FakeTorch:
    """Just enough torch for _track_painted on CPU (the fake predictor's logits are numpy-backed)."""
    float = None

    @staticmethod
    def inference_mode():
        return nullcontext()

    @staticmethod
    def from_numpy(a):
        return a

    @staticmethod
    def sigmoid(x):
        return Arr(1 / (1 + np.exp(-np.asarray(x))))


class Arr(np.ndarray):
    def __new__(cls, a):
        return np.asarray(a).view(cls)

    def cpu(self):
        return self

    def numpy(self):
        return np.asarray(self)

    def float(self):
        return self


class FakePred:
    """Tracks by looking up each object's truth by the frame's time; records every add_new_mask (chunk, frame_idx, obj)."""

    def __init__(self, truth):
        self.truth, self.calls, self.chunk = truth, [], -1

    def init_state(self, x):
        frames, _, _ = x
        self.chunk += 1
        return {"frames": list(frames), "output_dict_per_obj": {}, "objs": set()}

    def add_new_mask(self, state, frame_idx, obj_id, mask):
        self.calls.append((self.chunk, frame_idx, obj_id))
        state["objs"].add(obj_id)
        state["output_dict_per_obj"].setdefault(obj_id - 1, {"cond_frame_outputs": {}, "non_cond_frame_outputs": {}})

    def propagate_in_video(self, state):
        n = max(state["objs"])
        for k in range(n):
            state["output_dict_per_obj"][k]["non_cond_frame_outputs"].update({i: {"object_score_logits": Arr([5.0])} for i in range(len(state["frames"]))})
        for i, t in enumerate(state["frames"]):
            yield i, list(range(1, n + 1)), Arr(np.stack([self.truth[k](t)[None] for k in range(n)]).astype(float) * 2 - 1)


def test_track_painted_chunks_and_fixes():
    ts = list(range(0, 40 * 33, 33))
    truth = [lambda t: rod(100 + t / 33, 170 + t / 33), lambda t: region()]
    pred = FakePred(truth)
    objs = [{"name": "c2_penis", "part": "penis", "who": "c2", "mask": truth[0](0), "fixes": [(ts[20], truth[0](ts[20]))]},
            {"name": "c1_anus", "part": "anus", "who": "c1", "mask": truth[1](0), "fixes": []}]
    frames = [(t, t) for t in ts]   # the "image" is its time: prep keeps it, the fake predictor looks the truth up by it
    rows = list(sm._track_painted(pred, lambda img: img, list, frames, objs, {"chunk_frames": 16}, H, W, FakeTorch, "cpu"))
    assert [r[0] for r in rows] == ts   # every frame once, in order
    ch = rows[5][1]["channels"]
    assert ch["sem_c2_penis_vis"] == pytest.approx(1, abs=0.01) and ch["sem_c1_anus_area"] > 0
    assert ch["sem_c2_penis_mL"] > 0 and "sem_c2_penis_dp" in ch
    assert rows[5][2]["mask_of"] == [0, 1]
    # chunk 0: the seed masks on frame 0; chunk 1 (frames 16..31): head = seed + carry, the fix (frame 20) at 2 + 4
    assert {(0, 0, 1), (0, 0, 2)} <= set(pred.calls)
    assert (1, 2 + 4, 1) in pred.calls and (1, 0, 1) in pred.calls and (1, 1, 1) in pred.calls
    # chunk 2: head = seed, the corrected frame, carry (3 frames)
    assert {c[1] for c in pred.calls if c[0] == 2} == {0, 1, 2}
