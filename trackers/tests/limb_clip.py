"""paw-4c48.19: a rendered limb shot (tests/test_shaft.py, the depth part): the Top's forearm (a thick bar, its hand at the far
end) slides into the Bottom's body under a zooming, panning camera, deep strokes, held deep for ~4 s, while the Top's
OTHER hand passes over the forearm's middle for 2 s; drawn on twos. The forearm's members (hidden inside the body or
under the other hand), the hand on its tip, the Top's torso behind the elbow, the Bottom's anus and hips. Truth per frame:
the inserted fraction of the forearm (the visible length from the elbow cap to the entrance, over its full length)."""
import math

import numpy as np

W, H = 640, 360
L, WID = 210.0, 40.0                  # the forearm's length and width (px at zoom 1)
EDGE = 330.0                          # the Bottom's entrance (the ellipse's left edge, x at zoom 1)
ELL = ((EDGE + 110, 180.0), (110, 120))
ARM_C, BODY_C, HAND_C, TORSO_C, BG_C = (70, 150, 230), (150, 70, 60), (120, 210, 160), (60, 110, 200), (40, 40, 40)
IDS = {"c2_forearm_r": 4, "c1_anus": 5, "c1_hips": 6, "c2_hand_r": 7, "c2_hand_l": 8, "c2_torso": 9}
N, PERIOD = 480, 60
HOLD = range(150, 250)                # held 0.8 L deep
OTHER = range(300, 348)               # the other hand over the forearm's middle
GROUPS = [{"name": k, "id": v, "who": k[:2], "part": k.split("_")[1], "side": (k.split("_") + [None])[2], "t_ms": 0.0}
          for k, v in IDS.items()]


def state(i):
    k = i - i % 2
    d = 0.8 * L if k in HOLD else 0.485 * L * (1 - math.cos(2 * math.pi * k / PERIOD))
    z = 1 + 0.2 * math.sin(2 * math.pi * k / 90)
    return {"d": d, "z": z, "dx": 15 * math.sin(2 * math.pi * k / 70), "dy": 10 * math.cos(2 * math.pi * k / 110), "other": k in OTHER}


def truth(i):
    s, r = state(i), WID / 2
    b = EDGE - L + s["d"]
    vis = min(b + L + r, EDGE) - (b - r)
    return {"in": 1 - vis / (L + 2 * r), "vis": vis / (L + 2 * r), "other": s["other"]}


def _cam(s, P):
    return (np.asarray(P, float) - [W / 2, H / 2]) * s["z"] + [W / 2 + s["dx"], H / 2 + s["dy"]]


def _base(s):
    return np.array([EDGE - L + s["d"], 180.0])


def frame(i):
    import cv2
    s = state(i)
    img = np.full((H, W, 3), BG_C, np.uint8)
    b = _base(s)
    P = _cam(s, [b - [70, 40], b + [L, 0], b])
    cv2.circle(img, tuple(np.round(P[0]).astype(int)), int(round(55 * s["z"])), TORSO_C, -1)          # the Top's torso, behind the elbow
    cv2.line(img, tuple(np.round(P[2]).astype(int)), tuple(np.round(P[1]).astype(int)), ARM_C, int(round(WID * s["z"])))
    c = _cam(s, [ELL[0]])[0]
    cv2.ellipse(img, tuple(int(v) for v in np.round(c)), (int(round(ELL[1][0] * s["z"])), int(round(ELL[1][1] * s["z"]))), 0, 0, 360, BODY_C, -1)
    if s["other"]:
        q = _cam(s, [b + [0.35 * L, -45], b + [0.55 * L, 45]])
        cv2.rectangle(img, tuple(np.round(q[0]).astype(int)), tuple(np.round(q[1]).astype(int)), HAND_C, -1)
    return img


def pts(i):
    """The overlay `pts` of frame i: [x, y, visible, motion group 0, part 0, group id] per point (fixed order)."""
    s = state(i)
    b = _base(s)
    out = []

    def add(p, vis, gid):
        q = _cam(s, [p])[0]
        out.append([round(q[0] / W, 4), round(q[1] / H, 4), int(vis), 0, 0, gid])

    for f in np.linspace(0.05, 0.85, 8):   # forearm members (the hand's own group holds the last 15 %)
        for a in (-0.25, 0.25):
            p = b + [f * L, a * WID]
            hid = p[0] > EDGE or (s["other"] and b[0] + 0.35 * L <= p[0] <= b[0] + 0.55 * L)
            add(p, not hid, IDS["c2_forearm_r"])
    for f in (0.92, 0.98):
        for a in (-0.2, 0.2):
            p = b + [f * L, a * WID]
            add(p, p[0] <= EDGE, IDS["c2_hand_r"])
    for y in np.linspace(160, 200, 6):
        add([EDGE + 6, y], True, IDS["c1_anus"])
    for p in [(390, 120), (430, 100), (480, 150), (510, 200), (460, 250), (410, 260), (470, 200), (430, 180)]:
        add(p, True, IDS["c1_hips"])
    for dx, dy in ((-90, -60), (-70, -20), (-50, -70), (-100, -30)):
        add(b + [dx, dy], True, IDS["c2_torso"])
    for dx in (0.4, 0.5):
        for dy in (-30, 30):
            add(b + [dx * L, dy], s["other"], IDS["c2_hand_l"])
    return out


def clip():
    return np.arange(N) * 1000 / 24, [pts(i) for i in range(N)], [dict(g) for g in GROUPS]


def oracle(frames, roi, size, p):
    """A perfect stand-in for SAM on this clip: the forearm's colour in each crop."""
    for k, img in frames:
        yield k, np.all(np.abs(img.astype(int) - ARM_C) <= 2, axis=2), 1.0
