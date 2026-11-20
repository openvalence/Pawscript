"""pawtrack/shaft.py (shaft consumption: how much of the penis is inside) on CPU: a rendered penetration shot
(tests/shaft_clip.py) with known inserted length, zoom, camera motion, a hand over the middle, a foreshortened pull-out,
a knot bulge, drawn on twos; through run_scene with a perfect stand-in for SAM, and with the points fallback."""
import numpy as np
import pytest

import shaft_clip as sc
from pawtrack import shaft

P = {"shaft_sam": True, "shaft_model": "small", "shaft_reprompt": 48, "shaft_stride": 1}


def run(monkeypatch, sam=sc.oracle, frame_at=sc.frame, **kw):
    monkeypatch.setattr(shaft, "sam_chunk", sam)
    ts, pts, groups = sc.clip()
    g = next(x for x in groups if x["name"] == "c1_penis")
    return shaft.run_scene(ts, pts, groups, g, (sc.W, sc.H), {**P, **kw}, frame_at=frame_at, knot=True)


def truth():
    return [sc.truth(i) for i in range(sc.N)]


def errors(r, tr):
    ins, conf = r["channels"]["in"], r["channels"]["in_conf"]
    plain = [i for i, x in enumerate(tr) if not x["hand"] and not x["fore"] and conf[i] >= shaft.CONF_MIN]
    return np.array([abs(ins[i] - tr[i]["in"]) for i in plain]), plain


def test_sam_inserted_fraction_matches_the_rendered_truth(monkeypatch):
    r = run(monkeypatch)
    tr = truth()
    err, plain = errors(r, tr)
    print(f"\nSAM (oracle masks): inserted MAE {err.mean():.3f}, p95 {np.percentile(err, 95):.3f}, "
          f"confident {len(plain)} / {sum(not x['hand'] and not x['fore'] for x in tr)} plain frames")
    assert r["record"]["source"] == "sam" and r["record"]["full"] == "seen"
    assert len(plain) >= 0.9 * sum(not x["hand"] and not x["fore"] for x in tr)
    assert err.mean() < 0.03 and np.percentile(err, 95) < 0.06


def test_a_hand_over_the_middle_is_never_insertion(monkeypatch):
    r = run(monkeypatch)
    tr = truth()
    ins = r["channels"]["in"]
    over = np.array([ins[i] - tr[i]["in"] for i in sc.HAND])
    ok = np.isfinite(over)
    print(f"\nhand frames: max over-read {over[ok].max():+.3f}, {int((~ok).sum())} / {len(over)} unknown (the hand at the entry edge)")
    assert over[ok].max() < 0.06  # the worst: the hand's edge 10 px from the entrance (nearer the partner than the hand)



def test_foreshortened_pull_out_is_not_trusted(monkeypatch):
    r = run(monkeypatch)
    conf = r["channels"]["in_conf"]
    fore = [i for i in sc.FORE if i % 2 == 0 and i - 2 in sc.FORE]  # well inside the stretch
    assert max(conf[i] for i in fore) < shaft.CONF_MIN


def test_sign_is_always_right(monkeypatch):
    r = run(monkeypatch)
    out = np.array([1 - x["in"] for x in truth()])
    ln, conf = r["channels"]["len"], r["channels"]["in_conf"]
    noise = np.random.default_rng(0).normal(0, 0.05, len(out))
    assert shaft.shaft_sign(out + noise, ln, conf) == {**shaft.shaft_sign(out + noise, ln, conf), "sign": 1, "confident": True}
    flipped = shaft.shaft_sign(1 - out + noise, ln, conf)
    assert flipped["sign"] == -1 and flipped["confident"]
    for k in range(0, sc.N - 48, 24):  # every 2 s window on its own
        s = slice(k, k + 48)
        w = shaft.shaft_sign(out[s] + noise[s], ln[s], conf[s])
        assert w["sign"] == 1 or not w["confident"]


def test_knot_events_within_a_drawing(monkeypatch):
    r = run(monkeypatch)
    tr = truth()
    ts = np.arange(sc.N) * 1000 / 24
    want = shaft.knot_events(ts, np.array([x["knot"] for x in tr]))
    got = [e for e in r["events"] if e["kind"] == "knot"]
    print(f"\nknot: {len(got)} events found, {len(want)} true; place {r['record'].get('knot')}")
    assert r["record"]["knot"] and len(want) >= 4
    assert [e["dir"] for e in got] == [e["dir"] for e in want]
    assert all(abs(a["t_ms"] - b["t_ms"]) <= 2 * 1000 / 24 + 1 for a, b in zip(got, want))  # one drawing (twos)


def test_drift_re_prompts_from_the_points(monkeypatch):
    def drifty(frames, roi, size, p):  # loses the shaft to the partner's body on frames 60..63, until re-prompted
        bad = {60, 61, 62, 63}
        lost = False
        for k, img in frames:
            lost = lost or k in bad
            m = np.all(np.abs(img.astype(int) - (sc.BODY_C if lost else sc.SHAFT_C)) <= 2, axis=2)
            yield k, m, 1.0
    r = run(monkeypatch, sam=drifty)
    err, _ = errors(r, truth())
    assert r["record"]["drift"] >= 1 and r["record"]["chunks"] >= 4
    assert err.mean() < 0.03


def test_stride_interpolates(monkeypatch):
    r = run(monkeypatch, shaft_stride=2)
    err, plain = errors(r, truth())
    assert r["record"]["frames"] <= sc.N // 2 + 10 and err.mean() < 0.04


def test_points_fallback_without_sam(monkeypatch):
    r = run(monkeypatch, frame_at=None)
    tr = truth()
    err, plain = errors(r, tr)
    print(f"\npoints fallback: inserted MAE {err.mean():.3f}, p95 {np.percentile(err, 95):.3f}, confident {len(plain)}")
    assert r["record"]["source"] == "points"
    assert err.mean() < 0.12
    out = np.array([1 - x["in"] for x in tr])
    assert shaft.shaft_sign(out, r["channels"]["len"], r["channels"]["in_conf"])["sign"] == 1


def test_sam_failure_falls_back(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("no GPU")
        yield
    r = run(monkeypatch, sam=boom)
    assert r["record"]["source"] == "points" and "SAM failed" in r["record"]["note"]


def test_calibration_marks_set_full_and_hilt(monkeypatch):
    ts, pts, groups = sc.clip()
    monkeypatch.setattr(shaft, "sam_chunk", sc.oracle)
    g = next(x for x in groups if x["name"] == "c1_penis")
    r = shaft.run_scene(ts, pts, groups, g, (sc.W, sc.H), P, frame_at=sc.frame, calib={"out": 0, "hilt": 30})
    assert r["channels"]["in"][0] == pytest.approx(0, abs=0.02) and r["channels"]["in"][30] == pytest.approx(1, abs=0.02)


def _axis_deg(r):
    c = r["channels"]
    dx, dy = (c["ex"] - c["bx"]) * sc.W, (c["ey"] - c["by"]) * sc.H
    ok = np.isfinite(dx) & (np.hypot(dx, dy) > 5)
    return np.degrees(np.abs(np.arctan2(dy[ok], dx[ok])))


def test_a_leaky_mask_never_tilts_the_axis(monkeypatch):
    """paw-4c48.7: SAM takes in a blob of the partner below the entry at depth (the mask's own principal axis tilts by
    15-30 deg): the drawn axis base -> entry stays on the shaft (horizontal in this clip: the camera zooms and pans only)."""
    def leaky(frames, roi, size, p):
        for k, img in frames:
            m = np.all(np.abs(img.astype(int) - sc.SHAFT_C) <= 2, axis=2)
            ys, xs = np.nonzero(m)
            if len(xs) and sc.truth(k)["in"] > 0.4:   # deep: a slab of the partner's body down-left of the entry
                xe, yc = xs.max(), int(ys.mean())
                body = np.all(np.abs(img.astype(int) - sc.BODY_C) <= 2, axis=2)
                slab = np.zeros_like(m)
                slab[yc:yc + 70, max(0, xe - 90):xe + 4] = True
                m = m | (body & slab) | slab   # the slab drawn as mask (SAM leaking past the shaft's edge)
            yield k, m, 1.0
    r = run(monkeypatch, sam=leaky)
    a = _axis_deg(r)
    print(f"\nleaky masks: axis off the shaft max {a.max():.2f} deg, p90 {np.percentile(a, 90):.2f}")
    assert a.max() < 2.0


def test_measure_uses_the_tracked_axis():
    m = np.zeros((200, 300), bool)
    m[95:106, 50:250] = True          # the shaft, horizontal
    m[106:180, 170:250] = True        # a leak below its far end
    r = shaft.measure(m, np.array([50.0, 100.0]), np.array([1.0, 0.0]))
    assert r["u"] == pytest.approx([1, 0]) and abs(r["entry"][1] - 100) < 1e-6 and r["L"] == pytest.approx(199, abs=2)


def test_base_end_is_by_the_sheath_not_the_mean_of_the_own_parts():
    """paw-4c48.7: the owner's riding shot: the sheath at one end, the torso far beyond the other; the mean of the own
    parts' centres sat nearer the tip, so the base was read at the tip (the stored axis 180 deg off)."""
    X = np.full((3, 10, 2), np.nan)
    X[:, :, 0], X[:, :, 1] = np.linspace(100, 200, 10), 100.0
    sheath = np.full((3, 4, 2), [92.0, 104.0])
    torso = np.full((3, 6, 2), [420.0, 90.0])
    balls = np.full((3, 4, 2), [90.0, 120.0])
    ax = shaft.frame_axis(X, 0, own=[sheath, balls, torso])
    assert ax["why"] == "own" and ax["base"][0] == pytest.approx(100) and ax["u"][0] > 0.99


def test_refine_axis_from_the_masks_of_a_fat_painted_region(monkeypatch):
    """A painted region nearly as wide as long (members' principal direction 25 deg off): the out shaft's outlines set
    the axis (the app's shaftGeom does the same with the stored channels of older runs)."""
    rng = np.random.default_rng(1)
    P = np.stack([rng.uniform(0, 100, 40), rng.uniform(-45, 45, 40)], 1) @ np.array([[np.cos(0.45), np.sin(0.45)], [-np.sin(0.45), np.cos(0.45)]]) * [1, 1]
    X = np.repeat((P + [200, 200])[None], 6, 0)
    ax = shaft.frame_axis(X, 0)
    T, _ = shaft.transforms(X, ax)
    m = np.zeros((400, 400), bool)
    m[195:206, 200:300] = True        # the shaft itself: horizontal
    ax2 = shaft.refine_axis(X, ax, [(m, (0, 0))] * 6, T)
    assert ax2.get("refined") and abs(ax2["u"][1]) < 1e-6


def test_despike_removes_a_one_frame_swing():
    a = np.radians([-45, -45, -46, -75, -45, -44, -45, np.nan, -45])
    d = np.degrees(shaft.despike(a))
    assert abs(d[3] + 45) < 1.5 and np.isnan(d[7]) and np.allclose(d[[0, 1, 2, 4, 5, 6, 8]], [-45, -45, -46, -45, -44, -45, -45])


def sticky(frames, roi, size, p):
    """SAM's video predictor as the owner sees it (paw-4c48.13): a box prompt bounds the mask's length (the memory holds
    what the first frame got; the clip's shaft is horizontal); without a prompt of its own (roi kind "none": the last
    frame's mask as an anchor) it follows the whole object, so a shaft coming back out grows the mask again."""
    import cv2
    w, h = size
    prev = roi["anchors"][-1][1] if roi["kind"] == "none" else None
    box = np.zeros((h, w), bool)
    if roi["kind"] == "box":
        x0 = int(roi["x"] * w)
        box[:, x0:x0 + int(roi["w"] * w) + 1] = True
    for k, img in frames:
        col = np.all(np.abs(img.astype(int) - sc.SHAFT_C) <= 2, axis=2)
        if prev is None:
            m = col & box
        else:
            _, lab = cv2.connectedComponents(col.astype(np.uint8))
            near = cv2.dilate(prev.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
            keep = np.unique(lab[near & col])
            m = np.isin(lab, keep[keep > 0])
            prev = m
        yield k, m, 1.0


def deep(monkeypatch, sam, dying=True):
    import functools
    monkeypatch.setattr(shaft, "sam_chunk", sam)
    ts, pts, groups = sc.clip(deep=True, dying=dying)
    g = next(x for x in groups if x["name"] == "c1_penis")
    r = shaft.run_scene(ts, pts, groups, g, (sc.W, sc.H), P, frame_at=functools.partial(sc.frame, deep=True))
    tr = np.array([sc.truth(i, deep=True)["in"] for i in range(len(ts))])
    late = np.arange(len(ts)) > sc.HILT[-1]
    ok = late & (r["channels"]["in_conf"] >= shaft.CONF_MIN) & np.isfinite(r["channels"]["in"])
    return r, np.abs(r["channels"]["in"] - tr)[ok], ok.sum() / late.sum()


def test_the_mask_grows_back_after_a_long_deep_hold(monkeypatch):
    """paw-4c48.13, the owner's "it'll get crushed and never expand again": after ~4 s held deep only the members at the
    base are still tracked; the mask used to be re-prompted from their box every shaft_reprompt frames and stayed that
    small for the rest of the shot (inserted read ~0.3 off, confidently). Now a clean chunk hands its last mask on."""
    r, err, share = deep(monkeypatch, sticky)
    print(f"\nafter the hold: inserted MAE {err.mean():.3f}, confident {share:.2f}, {r['record']}")
    assert share > 0.7 and err.mean() < 0.05


def test_why_flags_a_prompt_from_too_few_members(monkeypatch):
    """v4.50 sem_<name>_why: a scene that starts deep is first prompted from the 4 members at the base (of 16): the mask
    is no longer than that box, so those frames are `bound` (never confident); once the shaft comes out they are seen."""
    monkeypatch.setattr(shaft, "sam_chunk", sticky)
    ts, pts, groups = sc.clip(deep=True, dying=True)
    k0 = 24
    g = next(x for x in groups if x["name"] == "c1_penis")
    r = shaft.run_scene(ts[k0:], pts[k0:], groups, g, (sc.W, sc.H), P, frame_at=lambda i: sc.frame(i + k0, deep=True))
    why, conf = r["channels"]["why"], r["channels"]["in_conf"]
    b = why == shaft.WHY["bound"]
    assert b[:30].sum() >= 2 and not b[60:].any() and conf[b].max() < shaft.CONF_MIN
    assert why[0] == shaft.WHY["few"] and (why[60:] == shaft.WHY["seen"]).mean() > 0.8
    assert r["record"]["bound"] > 0 and r["record"]["carried"] >= 5


@pytest.mark.gpu
def test_real_sam_after_a_long_deep_hold():
    """paw-4c48.13 with real SAM 2.1: the deep long shot whose penis members die during the hold (before the fix:
    inserted MAE 0.30 over 64 % confident frames, the full length read at 2.6 widths instead of ~8.5)."""
    pytest.importorskip("sam2")
    import functools, time
    ts, pts, groups = sc.clip(deep=True, dying=True)
    g = next(x for x in groups if x["name"] == "c1_penis")
    t0 = time.perf_counter()
    r = shaft.run_scene(ts, pts, groups, g, (sc.W, sc.H), P, frame_at=functools.partial(sc.frame, deep=True))
    tr = np.array([sc.truth(i, deep=True)["in"] for i in range(len(ts))])
    ok = (r["channels"]["in_conf"] >= shaft.CONF_MIN) & np.isfinite(r["channels"]["in"])
    err = np.abs(r["channels"]["in"] - tr)[ok]
    print(f"\nreal SAM, deep hold: MAE {err.mean():.3f}, confident {ok.mean():.2f}, {r['record']}, {time.perf_counter() - t0:.1f} s")
    assert err.mean() < 0.06 and ok.mean() > 0.7


@pytest.mark.gpu
def test_real_sam_on_the_rendered_clip():
    pytest.importorskip("sam2")
    import time
    ts, pts, groups = sc.clip()
    g = next(x for x in groups if x["name"] == "c1_penis")
    t0 = time.perf_counter()
    r = shaft.run_scene(ts, pts, groups, g, (sc.W, sc.H), P, frame_at=sc.frame, knot=True)
    err, plain = errors(r, truth())
    print(f"\nreal SAM: MAE {err.mean():.3f}, p95 {np.percentile(err, 95):.3f}, {r['record']}, {time.perf_counter() - t0:.1f} s")
    assert r["record"]["source"] == "sam" and err.mean() < 0.08


def test_track_end_to_end_adds_channels_sets_the_direction_and_knots(tmp_path, monkeypatch):
    """Through cli.cmd_track: a stand-in points tracker reports the clip's pts and a primary oriented the WRONG way
    (larger = deeper); the shaft pass adds sem_c1_penis_* channels, flips the scene's sign, and finds the knot."""
    import cv2
    from pawtrack import cli, registry
    path = tmp_path / "shaft.avi"
    vw = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), 24, (sc.W, sc.H))
    for i in range(sc.N):
        vw.write(sc.frame(i))
    vw.release()

    def fake(frames, roi, p):
        for i, (t, img) in enumerate(frames):
            v = sc.truth(i)["in"]
            yield t, {"value": v, "channels": {"raw_px": v}}, {"points": [], "boxes": [], "pts": sc.pts(i)}
    monkeypatch.setitem(registry.TRACKERS, "fake_points", registry.Tracker("fake_points", "fake", "none", [], fake, ["raw_px"]))

    def tolerant(frames, roi, size, p):  # the oracle through MJPG: the shaft colour within a margin
        for k, img in frames:
            yield k, np.all(np.abs(img.astype(int) - sc.SHAFT_C) <= 40, axis=2), 1.0
    monkeypatch.setattr(shaft, "sam_chunk", tolerant)
    sq = [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]]
    groups = [{"who": g["who"], "part": g["part"], "poly": sq, "t_ms": 0, **({"shaft": True} if g["part"] == "penis" else {})}
              for g in sc.GROUPS]
    res = cli.cmd_track({"cmd": "track", "video": str(path), "tracker": "fake_points", "start_ms": 0, "end_ms": 10000,
                         "roi": None, "cuts": [], "groups": groups, "tags": ["knotting"], "params": {}}, lambda e: None)
    ch = res["channels"]
    assert {f"sem_c1_penis_{k}" for k in ("in", "in_conf", "len", "knot", "bx", "by", "ex", "ey", "w")} <= set(ch)
    rec = res["scenes"][0]["shaft"]["c1_penis"]
    assert rec["source"] == "sam" and rec["full"] == "seen"
    assert res["scenes"][0]["sign"] == -1
    sign = next(n for n in res["notes"] if n["code"] == "primary")["data"]["sign"] if any(n["code"] == "primary" for n in res["notes"]) else None
    assert sign is None or sign["mode"] == "shaft"
    ins = np.array([np.nan if v is None else v for _, v in ch["sem_c1_penis_in"]])
    tr = np.array([sc.truth(i)["in"] for i in range(sc.N)])
    conf = np.array([v or 0 for _, v in ch["sem_c1_penis_in_conf"]])
    ok = (conf >= shaft.CONF_MIN) & np.isfinite(ins)
    assert ok.mean() > 0.7 and np.abs(ins[ok] - tr[ok]).mean() < 0.05
    assert sum(e["kind"] == "knot" for e in res["events"]) >= 4


# ---------------------------------------------------------------- paw-4c48.19: the same pass on any part (v4.52 `depth`)

def limb(monkeypatch, part=True):
    import limb_clip as lc
    monkeypatch.setattr(shaft, "sam_chunk", lc.oracle)
    ts, pts, groups = lc.clip()
    g = next(x for x in groups if x["name"] == "c2_forearm_r")
    r = shaft.run_scene(ts, pts, groups, g, (lc.W, lc.H), P, frame_at=lc.frame, part=part)
    tr = np.array([lc.truth(i)["in"] for i in range(lc.N)])
    return r, tr


def test_a_depth_part_reads_like_the_shaft(monkeypatch):
    """A forearm going into the Bottom (rendered: deep strokes, held deep 4 s, the other hand over its middle 2 s): the base is
    the end away from the receiver, its own hand at the tip is no occluder, the inserted fraction follows the truth, and the
    two points readings (pn, pcut) follow it too. As a plain shaft its own hand read as an occluder at the entry."""
    r, tr = limb(monkeypatch)
    c, rec = r["channels"], r["record"]
    ok = (c["in_conf"] >= shaft.CONF_MIN) & np.isfinite(c["in"])
    err = np.abs(c["in"] - tr)[ok]
    print(f"\nforearm (oracle SAM): MAE {err.mean():.3f}, confident {ok.mean():.2f}, {rec}")
    assert rec["role"] == "part" and rec["base_from"] == "partner" and rec["receiver"] == ["c1_anus", "c1_hips"] and rec["receiver_from"] == "parts"
    assert err.mean() < 0.06 and ok.mean() > 0.9 and "knot" not in rec
    for k in ("pn", "pcut"):
        m = np.isfinite(c[k])
        assert np.corrcoef(c[k][m], 1 - tr[m])[0, 1] > 0.95, k
    plain, _ = limb(monkeypatch, part=False)
    assert (plain["channels"]["in_conf"] >= shaft.CONF_MIN).mean() < ok.mean()


def test_a_depth_part_without_a_receiving_part_takes_the_nearest_other_character(monkeypatch):
    import limb_clip as lc
    monkeypatch.setattr(shaft, "sam_chunk", lc.oracle)
    ts, pts, groups = lc.clip()
    groups = [x for x in groups if x["name"] not in ("c1_anus", "c1_hips")] + [{"name": "c1_thighs_l", "id": 6, "who": "c1", "part": "thighs", "side": "l", "t_ms": 0.0}]
    g = next(x for x in groups if x["name"] == "c2_forearm_r")
    r = shaft.run_scene(ts, pts, groups, g, (lc.W, lc.H), P, frame_at=lc.frame, part=True)
    assert r["record"]["receiver"] == ["c1_thighs_l"] and r["record"]["receiver_from"] == "nearest"


def test_track_measures_a_part_only_when_turned_on_and_never_changes_anything_else(tmp_path, monkeypatch):
    """Through cli.cmd_track: the same request with the forearm's `depth` flag adds sem_c2_forearm_r_* (record role part) and
    leaves every other channel, the scene sign and the samples exactly as without it."""
    import cv2
    import json
    import limb_clip as lc
    from pawtrack import cli, registry
    path = tmp_path / "limb.avi"
    vw = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), 24, (lc.W, lc.H))
    for i in range(lc.N):
        vw.write(lc.frame(i))
    vw.release()

    def fake(frames, roi, p):
        for i, (t, img) in enumerate(frames):
            v = lc.truth(i)["in"]
            yield t, {"value": v, "channels": {"raw_px": v}}, {"points": [], "boxes": [], "pts": lc.pts(i)}
    monkeypatch.setitem(registry.TRACKERS, "fake_points", registry.Tracker("fake_points", "fake", "none", [], fake, ["raw_px"]))

    def tolerant(frames, roi, size, p):
        for k, img in frames:
            yield k, np.all(np.abs(img.astype(int) - lc.ARM_C) <= 40, axis=2), 1.0
    monkeypatch.setattr(shaft, "sam_chunk", tolerant)
    sq = [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]]

    def req(on):
        gs = [{"who": g["who"], "part": g["part"], **({"side": g["side"]} if g["side"] else {}), "poly": sq, "t_ms": 0,
               **({"depth": True} if on and g["name"] == "c2_forearm_r" else {})} for g in lc.GROUPS]
        return cli.cmd_track({"cmd": "track", "video": str(path), "tracker": "fake_points", "start_ms": 0, "end_ms": 20000,
                              "roi": None, "cuts": [], "groups": gs, "tags": [], "params": {}}, lambda e: None)
    off, on = req(False), req(True)
    assert not any(k.startswith("sem_c2_forearm_r_in") for k in off["channels"])
    new = {k for k in on["channels"] if k not in off["channels"]}
    assert {f"sem_c2_forearm_r_{k}" for k in ("in", "in_conf", "len", "why", "pn", "pcut", "bx", "ex")} <= new
    assert all(k.startswith("sem_c2_forearm_r_") for k in new)
    assert on["scenes"][0]["shaft"]["c2_forearm_r"]["role"] == "part"
    strip = lambda r: json.dumps({**r, "channels": {k: v for k, v in r["channels"].items() if k in off["channels"]},
                                  "scenes": [{k: v for k, v in s.items() if k != "shaft"} for s in r["scenes"]]}, sort_keys=True, default=str)
    assert strip(on) == strip(off)


@pytest.mark.gpu
def test_real_sam_on_a_depth_part():
    """paw-4c48.19 with real SAM 2.1 on the rendered limb (2026-11-18: inserted MAE 0.033 over 96 % confident frames; the points
    readings pn / pcut MAE 0.064 / 0.11; ~1 s of compute per s of video, 0.93 GiB reserved)."""
    pytest.importorskip("sam2")
    import limb_clip as lc
    ts, pts, groups = lc.clip()
    g = next(x for x in groups if x["name"] == "c2_forearm_r")
    r = shaft.run_scene(ts, pts, groups, g, (lc.W, lc.H), P, frame_at=lc.frame, part=True)
    tr = np.array([lc.truth(i)["in"] for i in range(lc.N)])
    ok = (r["channels"]["in_conf"] >= shaft.CONF_MIN) & np.isfinite(r["channels"]["in"])
    err = np.abs(r["channels"]["in"] - tr)[ok]
    print(f"\nreal SAM, forearm: MAE {err.mean():.3f}, confident {ok.mean():.2f}, {r['record']}")
    assert r["record"]["role"] == "part" and err.mean() < 0.06 and ok.mean() > 0.8
