"""`segment` (PROTOCOL v4.25): prompts -> SAM's masks in the groups' encoding, one embedding per frame (LRU), refused while
a GPU job holds the card. A fake predictor stands in for SAM 2 (the real one is timed in PROTOCOL v4.25)."""
import base64
import json

import cv2
import numpy as np
import pytest

from pawtrack import segment, serve


class FakeSam:
    """set_image keeps an 'embedding'; predict draws 3 growing discs round the first positive point (a box: 3 boxes)."""

    def __init__(self):
        self.embeds, self.calls = 0, []

    def set_image(self, img):
        self.embeds += 1
        self._features, self._orig_hw, self._is_image_set, self._is_batch = ("emb", self.embeds), [img.shape[:2]], True, False

    def predict(self, point_coords=None, point_labels=None, box=None, mask_input=None, multimask_output=True, **kw):
        assert self._is_image_set
        h, w = self._orig_hw[0]
        self.calls.append({"emb": self._features, "pts": None if point_coords is None else point_coords.tolist(),
                           "lab": None if point_labels is None else point_labels.tolist(), "box": None if box is None else box.tolist(),
                           "mask_input": None if mask_input is None else mask_input.shape, "multi": multimask_output})
        cx, cy = (point_coords[0] if point_coords is not None else ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2))
        yy, xx = np.mgrid[:h, :w]
        masks = np.stack([np.hypot(xx - cx, yy - cy) < r for r in (h * 0.30, h * 0.10, h * 0.20)])   # NOT sorted: the command sorts
        scores = np.array([0.9, 0.8, 0.95])
        if not multimask_output:   # SAM: the one best mask
            k = int(scores.argmax())
            return masks[k:k + 1], scores[k:k + 1], ((cv2.resize(masks[k].astype(np.float32), (256, 256)) - 0.5) * 16)[None]
        return masks, scores, np.stack([(cv2.resize(m.astype(np.float32), (256, 256)) - 0.5) * 16 for m in masks])   # logits: +8 inside, -8 outside


@pytest.fixture(autouse=True)
def clean():
    segment._CACHE.clear()
    segment._OWNER[0] = None


def image(tmp_path, name="a.png", w=400, h=200):
    p = tmp_path / name
    cv2.imwrite(str(p), np.full((h, w, 3), 120, np.uint8))
    return str(p)


def test_mask_encoding_roundtrip():
    a = np.zeros((6, 10), np.float32)
    a[2:4, 3:7] = 1
    a[0, 0] = 0.5
    e = segment.encode_mask(a)
    assert e["w"] == 10 and e["h"] == 6 and sum(e["rle"][1::2]) == 60
    assert np.allclose(segment.decode_mask(e), np.rint(a * 15) / 15)


def test_prompts_to_masks_smallest_first(tmp_path):
    sam = FakeSam()
    r = segment.cmd_segment({"image": image(tmp_path), "pos": [[0.5, 0.5], [0.55, 0.5]], "neg": [[0.1, 0.1]], "mask_w": 100}, lambda e: None, predictor=sam)
    assert r["frame_wh"] == [400, 200] and r["mask_wh"] == [100, 50]
    areas = [m["area"] for m in r["masks"]]
    assert areas == sorted(areas) and len(areas) == 3 and areas[0] < areas[1] < areas[2]
    assert r["masks"][0]["score"] == 0.8   # the smallest one is the 0.10 disc
    c = sam.calls[0]
    assert c["pts"] == [[200, 100], [220, 100], [40, 20]] and c["lab"] == [1, 1, 0]   # 0..1 -> frame px, positives then negatives
    m = segment.decode_mask(r["masks"][0]["mask"])
    assert m.shape == (50, 100) and m[25, 50] > 0.9 and m[2, 2] < 0.1
    assert r["cached"] is False


def test_box_prior_and_no_prompt(tmp_path):
    sam = FakeSam()
    src = image(tmp_path)
    prior = segment.encode_mask(np.ones((20, 40), np.float32))
    r = segment.cmd_segment({"image": src, "box": [0.25, 0.25, 0.75, 0.75], "mask": prior}, lambda e: None, predictor=sam)
    assert sam.calls[0]["box"] == [100, 50, 300, 150] and sam.calls[0]["mask_input"] == (1, 256, 256) and len(r["masks"]) == 3
    with pytest.raises(ValueError):
        segment.cmd_segment({"image": src, "neg": [[0.1, 0.1]]}, lambda e: None, predictor=sam)


def test_single_asks_sam_for_one_mask_and_the_prior_outline_goes_in(tmp_path):
    sam = FakeSam()
    src = image(tmp_path)
    one = segment.cmd_segment({"image": src, "pos": [[0.5, 0.5], [0.6, 0.5]], "single": True, "mask": segment.encode_mask(np.ones((20, 40), np.float32))}, lambda e: None, predictor=sam)
    assert sam.calls[0]["multi"] is False and sam.calls[0]["mask_input"] == (1, 256, 256) and len(one["masks"]) == 1
    assert one["masks"][0]["score"] == 0.95
    many = segment.cmd_segment({"image": src, "pos": [[0.5, 0.5]]}, lambda e: None, predictor=sam)
    assert sam.calls[1]["multi"] is True and len(many["masks"]) == 3, "a lone point keeps SAM's three levels"


def test_embedding_computed_once_per_frame_lru(tmp_path):
    sam = FakeSam()
    a, b = image(tmp_path, "a.png"), image(tmp_path, "b.png")
    seg = lambda src, x: segment.cmd_segment({"image": src, "pos": [[x, 0.5]]}, lambda e: None, predictor=sam)
    r1, r2, r3 = seg(a, 0.3), seg(a, 0.6), seg(b, 0.5)
    assert (r1["cached"], r2["cached"], r3["cached"]) == (False, True, False) and sam.embeds == 2
    assert sam.calls[0]["emb"] == sam.calls[1]["emb"] != sam.calls[2]["emb"], "the second prompt on a frame decodes against the first's embedding"
    assert seg(a, 0.7)["cached"] is True and sam.calls[-1]["emb"] == sam.calls[0]["emb"], "going back to frame a restores its embedding, not b's"
    for k in range(segment.CACHE_MAX + 1):
        seg(image(tmp_path, f"x{k}.png"), 0.5)
    assert len(segment._CACHE) == segment.CACHE_MAX and (a, 0) not in segment._CACHE, "the oldest frames are dropped"
    assert seg(image(tmp_path, "x0.png"), 0.5)["cached"] is False, "an evicted frame is embedded again"


def test_a_reloaded_sam_invalidates_the_cache(tmp_path):
    src = image(tmp_path)
    s1, s2 = FakeSam(), FakeSam()
    one = lambda s: segment.cmd_segment({"image": src, "pos": [[0.5, 0.5]]}, lambda e: None, predictor=s)
    assert one(s1)["cached"] is False and one(s1)["cached"] is True
    assert one(s2)["cached"] is False and s2.embeds == 1, "another predictor object (SAM was unloaded and loaded again): its own embedding"


def test_video_frame_source(tmp_path, monkeypatch):
    got = []
    import pawtrack.frames as fr
    monkeypatch.setattr(fr, "grab", lambda v, ts, **k: (got.append((v, list(ts))), [np.full((90, 160, 3), 50, np.uint8)])[1])
    sam = FakeSam()
    run = lambda t: segment.cmd_segment({"video": "clip.mp4", "t_ms": t, "pos": [[0.5, 0.5]]}, lambda e: None, predictor=sam)
    assert run(1000)["frame_wh"] == [160, 90] and run(1000)["cached"] is True and run(2000)["cached"] is False
    assert got == [("clip.mp4", [1000]), ("clip.mp4", [2000])], "a frame is decoded once"


def test_serve_refuses_while_a_gpu_job_holds_the_card():
    out = []
    svc = serve.Service(out.append)
    req = json.dumps({"id": "s1", "cmd": "segment", "image": "x.png", "pos": [[0.5, 0.5]]})
    svc.busy = serve.Job("t1", {"cmd": "track"})
    svc.submit(req)
    assert out[-1]["id"] == "s1" and out[-1]["type"] == "error" and out[-1]["message"] == "the card is busy tracking" and not svc.queue
    svc.busy = serve.Job("t2", {"cmd": "suggest_groups"})
    svc.submit(req)
    assert "busy" in out[-1]["message"] and not svc.queue
    svc.busy = serve.Job("t3", {"cmd": "frames"})   # a light job: the prompt queues behind it
    svc.submit(req)
    assert [j.id for j in svc.queue] == ["s1"]
    svc.queue.clear(); svc.busy = None
    svc.submit(req)
    assert [j.id for j in svc.queue] == ["s1"]


def test_segment_is_a_command_and_needs_sam(tmp_path, monkeypatch):
    from pawtrack import cli, partlabel
    assert "segment" in cli.COMMANDS
    monkeypatch.setattr(partlabel, "sam_ready", lambda: False)
    with pytest.raises(RuntimeError, match="SAM 2"):
        cli.COMMANDS["segment"]({"cmd": "segment", "image": image(tmp_path), "pos": [[0.5, 0.5]]}, lambda e: None)


def test_logits_option_returns_each_answers_low_res_logits_in_the_same_order(tmp_path):
    sam = FakeSam()
    r = segment.cmd_segment({"image": image(tmp_path), "pos": [[0.5, 0.5]], "logits": True, "mask_w": 100}, lambda e: None, predictor=sam)
    for m in r["masks"]:
        lg = m["logits"]
        q = np.frombuffer(base64.b64decode(lg["b64"]), np.int8).reshape(lg["h"], lg["w"]).astype(np.float32) * lg["s"]
        assert (lg["w"], lg["h"]) == (256, 256) and q[128, 128] > 7 and q[0, 0] < -7, "inside > 0, outside < 0"
        a = segment.decode_mask(m["mask"])
        assert abs(float((cv2.resize(q, (100, 50)) > 0).mean()) - float((a >= 0.5).mean())) < 0.02, "the logits belong to THIS mask (sorted together)"
    none = segment.cmd_segment({"image": image(tmp_path), "pos": [[0.5, 0.5]]}, lambda e: None, predictor=sam)
    assert all("logits" not in m for m in none["masks"]), "only when asked"
