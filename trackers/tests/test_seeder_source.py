"""PROTOCOL v4.28 (paw-26iv): taggerine as an OPTIONAL feature source for the learned seeder. Source selection with and without the
pack (a tiny fake checkpoint), caches kept apart, a head used only with its own source (stale -> retrain), the Hydra fallback, VRAM
bookkeeping, and the loader's self-check (runs only when the real weights are on disk). No GPU: the extractor is faked."""
import json
import os
from contextlib import contextmanager

import numpy as np
import pytest

from pawtrack import cli, seeder, taggerine, vram
from test_seeder import GRID, synth
from test_seeder_images import grp, label, make_image

REAL_WEIGHTS = taggerine.WEIGHTS   # captured at import: conftest-free tests patch the module attribute, this keeps the real path
TG = taggerine.SOURCE


@pytest.fixture
def pack(tmp_path, monkeypatch):
    """The optional pack 'installed' (a tiny fake checkpoint file) and a GPU 'present'; returns the weight path."""
    w = tmp_path / "pack" / "tagger_proto.safetensors"
    w.parent.mkdir()
    from safetensors.numpy import save_file
    save_file({"backbone.model.layer.0.norm1.weight": np.zeros(4, np.float32)}, str(w))
    monkeypatch.setattr(taggerine, "WEIGHTS", w)
    monkeypatch.setattr(taggerine, "ready", lambda: taggerine.installed())
    return w


def test_source_selection(tmp_path, monkeypatch):
    assert seeder.pick_source("auto") == (seeder.HYDRA, None), "no pack: Hydra, exactly as before"
    w = tmp_path / "tp.safetensors"
    from safetensors.numpy import save_file
    save_file({"x": np.zeros(2, np.float32)}, str(w))
    monkeypatch.setattr(taggerine, "WEIGHTS", w)
    assert taggerine.installed()
    monkeypatch.setattr(taggerine, "ready", lambda: True)
    src, note = seeder.pick_source("auto")
    assert src == {"source": "taggerine", "layer": 22, "long_side": 1024} and note is None
    assert seeder.pick_source("hydra") == (seeder.HYDRA, None), "the setting forces Hydra"
    monkeypatch.setattr(taggerine, "ready", lambda: False)   # installed but no GPU: the ViT-H never runs on CPU
    src, note = seeder.pick_source("auto")
    assert src == seeder.HYDRA and "needs a CUDA GPU" in note


def test_ready_needs_cuda_and_load_says_why(pack, monkeypatch):
    import torch
    monkeypatch.undo()   # the real ready(): the fixture's stub off
    monkeypatch.setattr(taggerine, "WEIGHTS", pack)
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    assert taggerine.installed() and not taggerine.ready()
    with pytest.raises(RuntimeError, match="needs a CUDA GPU"):
        taggerine.load()
    with pytest.raises(RuntimeError, match="not installed"):
        taggerine.load(pack.parent / "missing.safetensors")


def test_size_for_keeps_the_aspect_in_whole_patches():
    assert taggerine.size_for(1920, 1080) == (576, 1024) and taggerine.size_for(1080, 1920) == (1024, 576)
    assert taggerine.size_for(800, 800) == (1024, 1024) and taggerine.size_for(4000, 100) == (32, 1024)


def test_caches_are_per_source_and_the_fingerprint_names_a_non_hydra_source(tmp_path):
    a, b = seeder.feat_file("S", "k", 5), seeder.feat_file("S", "k", 5, TG)
    assert a != b and os.path.dirname(a) == os.path.join("S", "feats") and os.path.basename(os.path.dirname(b)) == "feats-taggerine-l22-1024"
    fr = [{"key": "k", "t": 0, "groups": []}]
    import hashlib
    old = hashlib.sha1(("v%s|%s|%s|%s|neg%s" % (seeder.VERSION, seeder.HIDDEN, seeder.EPOCHS, ",".join(seeder.PARTS), seeder.NEG_WEIGHT)).encode())
    old.update(b"k|0")
    assert seeder.fingerprint(fr) == old.hexdigest(), "a Hydra head keeps its fingerprint across a source choice (the v4.31 partial-label weight is in it: one retrain after that change): no retrain for those without the pack"
    assert seeder.fingerprint(fr, TG) != seeder.fingerprint(fr)
    assert seeder.fingerprint(fr, {**TG, "layer": 20}) != seeder.fingerprint(fr, TG)


class Fake:
    """The feature extractor, faked: synthetic features per picture, a different width per source; records which source ran."""

    def __init__(self, monkeypatch, fail_taggerine=None):
        self.calls, self.n = [], 0
        fake = self

        @contextmanager
        def extractor(src, emit, total, device=None):
            if src["source"] != "hydra" and fail_taggerine:
                raise seeder.FeatureSourceUnavailable(fail_taggerine)
            fake.calls.append(src["source"])

            def feat(bgr):
                fake.n += 1
                x, _ = synth(fake.n)
                return (x if src["source"] == "hydra" else x[:, :64]), GRID
            yield feat
        monkeypatch.setattr(seeder, "_extractor", extractor)


def _labels(tmp_path, n=6):
    labels = tmp_path / "labels"
    labels.mkdir()
    for k in range(n):
        label(labels, f"i{k:014x}", make_image(tmp_path / f"i{k}.png"), [grp("c1_knot", (.1, .2, .3, .4))])
    return str(labels)


def test_train_with_the_pack_keeps_the_caches_apart_and_retrains_on_a_source_change(tmp_path, monkeypatch, pack):
    fake = Fake(monkeypatch)
    labels, sd = _labels(tmp_path), str(tmp_path / "seed")
    r = seeder.train(sd, (), (), labels=labels)
    assert r["changed"] and fake.calls == ["taggerine"] and fake.n == 6
    assert r["features"]["source"] == "taggerine" and r["features"]["layer"] == 22 and r["features"]["pack"] and not r["features"]["stale"]
    head = seeder.Head.load(sd)
    assert head.features == TG and len(head.mu) == 64 and json.load(open(os.path.join(sd, "head.json")))["features"]["source"] == "taggerine"
    assert len(os.listdir(os.path.join(sd, "feats-taggerine-l22-1024"))) == 6 and not os.path.exists(os.path.join(sd, "feats"))
    assert seeder.train(sd, (), (), labels=labels)["changed"] is False and fake.n == 6, "unchanged: a no-op, nothing recomputed"
    # the setting forces Hydra: a different source, so the head is stale and retrains on the Hydra features (its own cache)
    r = seeder.train(sd, (), (), labels=labels, features="hydra")
    assert r["changed"] and fake.calls == ["taggerine", "hydra"] and fake.n == 12 and seeder.Head.load(sd).features == seeder.HYDRA
    assert len(os.listdir(os.path.join(sd, "feats"))) == 6 and len(os.listdir(os.path.join(sd, "feats-taggerine-l22-1024"))) == 6
    # back to auto: retrains on taggerine again, and its cache is still valid: not one picture is re-extracted
    r = seeder.train(sd, (), (), labels=labels)
    assert r["changed"] and fake.n == 12 and fake.calls == ["taggerine", "hydra"] and seeder.Head.load(sd).features == TG


def test_a_pack_that_cannot_load_falls_back_to_hydra_with_a_note(tmp_path, monkeypatch, pack):
    fake = Fake(monkeypatch, fail_taggerine="taggerine could not be loaded (CUDA out of memory)")
    labels, sd = _labels(tmp_path), str(tmp_path / "seed")
    r = seeder.train(sd, (), (), labels=labels)
    assert r["changed"] and fake.calls == ["hydra"], "trained on Hydra"
    assert r["features"]["source"] == "hydra" and "out of memory" in r["features"]["note"] and "Hydra features used" in r["features"]["note"]
    assert seeder.Head.load(sd).features == seeder.HYDRA
    assert seeder.status(seeder.Head.load(sd))["stale"] is True, "the pack is there: the next Train (when it loads) switches"


def test_no_pack_is_exactly_the_old_behaviour(tmp_path, monkeypatch):
    fake = Fake(monkeypatch)
    labels, sd = _labels(tmp_path), str(tmp_path / "seed")
    r = seeder.train(sd, (), (), labels=labels)
    assert fake.calls == ["hydra"] and r["features"] == {**seeder.HYDRA, "pack": False, "wanted": "hydra", "stale": False}
    assert os.path.isdir(os.path.join(sd, "feats")) and seeder.Head.load(sd).features == seeder.HYDRA


def test_a_head_is_used_only_with_its_own_features(tmp_path, monkeypatch, pack):
    Fake(monkeypatch)
    labels, sd = _labels(tmp_path), str(tmp_path / "seed")
    seeder.train(sd, (), (), labels=labels)
    tg = seeder.Head.load(sd)
    assert seeder.usable_head(tg) == (tg, None)
    h, why = seeder.usable_head(tg, "hydra")
    assert h is None and "Hydra is forced" in why
    monkeypatch.setattr(taggerine, "ready", lambda: False)   # the pack gone / no GPU / out of VRAM now
    h, why = seeder.usable_head(tg)
    assert h is None and "cannot run here" in why
    seeder.train(sd, (), (), labels=labels, features="hydra")
    hy = seeder.Head.load(sd)
    assert seeder.usable_head(hy) == (hy, None) and seeder.usable_head(hy, "hydra") == (hy, None), "a Hydra head always works"
    # the record Suggest returns says it
    rec = cli.seeder_record(tg, "auto", why)
    assert rec["parts"] == [] and rec["unused"] == why and rec["features"]["source"] == "taggerine"


def test_a_head_file_from_before_v4_28_is_a_hydra_head(tmp_path, monkeypatch):
    import torch
    Fake(monkeypatch)
    labels, sd = _labels(tmp_path), str(tmp_path / "seed")
    seeder.train(sd, (), (), labels=labels)
    fn = os.path.join(sd, "head.pt")
    d = torch.load(fn, map_location="cpu", weights_only=False)
    del d["features"]
    torch.save(d, fn)
    os.utime(fn, (1, 2_000_000_000))
    assert seeder.Head.load(sd).features == seeder.HYDRA


def test_taggerine_registers_as_a_resident_model_with_its_measured_size(monkeypatch):
    """vram.cap asks for taggerine.GB (the sidecar's own load path measured it, PROTOCOL v4.28) and the model is evicted LRU like the rest."""
    dropped = []
    vram.RESIDENT.clear()
    vram.RESIDENT["hydra"] = {"gb": 1.8, "drop": lambda: dropped.append("hydra"), "t": 1.0}
    vram.RESIDENT["taggerine"] = {"gb": 1.7, "drop": lambda: dropped.append("taggerine"), "t": 2.0}
    vram.RESIDENT["sam_image"] = {"gb": 0.3, "drop": lambda: dropped.append("sam"), "t": 3.0}
    try:
        assert vram.evict(["taggerine"]) == ["taggerine"] and dropped == ["taggerine"]
        assert "hydra" in vram.RESIDENT and "sam_image" in vram.RESIDENT, "it coexists with Hydra and SAM; only it goes"
    finally:
        vram.RESIDENT.clear()
    assert 1.7 <= taggerine.GB <= 3.0


# ---- the loader's own check: needs the real weights on disk (it is a 5 GB checkpoint: skipped everywhere else) ----
@pytest.mark.skipif(not REAL_WEIGHTS.is_file(), reason="the optional taggerine pack is not installed")
def test_loader_self_check_on_the_real_checkpoint(monkeypatch):
    import cv2
    import torch
    torch.set_num_threads(4)
    b = taggerine.Backbone(REAL_WEIGHTS, "cpu", torch.float32)
    assert len(b.keys) == 616, "the checkpoint has the tensors the architecture reads"
    sky = np.zeros((192, 256, 3), np.uint8)
    sky[:, :] = (235, 180, 90)
    sky[130:] = (60, 150, 50)
    cv2.circle(sky, (210, 40), 25, (60, 220, 250), -1)
    cv2.rectangle(sky, (80, 90), (170, 150), (60, 100, 150), -1)
    cv2.fillPoly(sky, [np.array([(70, 90), (180, 90), (125, 40)])], (40, 40, 190))
    smiley = np.full((192, 192, 3), 255, np.uint8)
    cv2.circle(smiley, (96, 96), 75, (60, 210, 250), -1)
    cv2.circle(smiley, (70, 75), 10, (0, 0, 0), -1)
    cv2.circle(smiley, (122, 75), 10, (0, 0, 0), -1)
    cv2.ellipse(smiley, (96, 110), (40, 25), 0, 10, 170, (0, 0, 0), 4)
    text = np.full((128, 256, 3), 255, np.uint8)
    cv2.putText(text, "HELLO", (10, 80), cv2.FONT_HERSHEY_SIMPLEX, 2, (0, 0, 0), 4)
    vocab = taggerine.vocab()
    assert len(vocab) == 74625
    tops = {}
    for name, im in (("sky", sky), ("smiley", smiley), ("text", text)):
        hw = (im.shape[0] // 16 * 16, im.shape[1] // 16 * 16)
        with torch.no_grad():
            out, grid = b.tokens(taggerine.to_tensor(im, hw, "cpu"), want=(22, 32))
        assert grid == (hw[0] // 16, hw[1] // 16) and out[22].shape == (1, 5 + grid[0] * grid[1], 1280)
        assert torch.isfinite(out[22]).all() and torch.isfinite(out[32]).all()
        lg = b.logits(out[32])
        assert torch.isfinite(lg).all()
        tops[name] = [vocab[i] for i in lg.topk(20)[1].tolist()]
    assert not b.unused(), f"a forward pass reads every backbone tensor: {b.unused()[:5]}"
    assert len({t[0] for t in tops.values()}) >= 2, tops
    assert {"sky", "grass", "house", "building", "no humans"} & set(tops["sky"]), tops["sky"]
