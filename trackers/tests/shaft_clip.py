"""A rendered penetration shot with known inserted length (tests/test_shaft.py): a shaft (with a knot bulge) slides into
a partner body that hides what is inside, under a zooming, panning camera; a hand covers the middle of the shaft on some
frames; on others the shaft is pulled out and turned toward the camera (foreshortened, nothing inside); drawn on twos.
Also the points a seeded points tracker would report: the penis group's members on the shaft (hidden inside the partner
or under the hand), the partner's anus and hips, the own balls, the hand. Truth per frame: inserted fraction, knot state."""
import math

import numpy as np

W, H = 640, 360
L, WID = 200.0, 24.0                  # the shaft's full length and width (px at zoom 1)
KNOT_AT, KNOT_R = 0.25 * L, 0.8 * WID  # the knot bulge: centre from the base, radius
EDGE = 320.0                          # the partner's entrance (the ellipse's left edge, x at zoom 1)
ELL = ((EDGE + 110, 180.0), (110, 120))
SHAFT_C, BODY_C, HAND_C, BG_C = (80, 200, 240), (150, 70, 60), (170, 190, 230), (40, 40, 40)
IDS = {"c1_penis": 4, "c2_anus": 5, "c2_hips": 6, "c1_balls": 7, "c2_hand_l": 8}
N, PERIOD = 240, 60                   # frames (24 fps), frames per stroke
HAND = range(150, 175)                # a hand over the middle of the shaft
FORE = range(200, 226)                # pulled out and turned toward the camera: foreshortened x0.6, nothing inside
PULL = range(226, 240)                # pulled out flat: the full length in view, the tip free
N_DEEP, HILT, HILT_D = 480, range(150, 250), 0.8 * L  # paw-4c48.13 the long shot: deep strokes, held deep ~4 s, then out
GROUPS = [{"name": k, "id": v, "who": k[:2], "part": k.split("_")[1], "t_ms": 0.0} for k, v in IDS.items()]


def state(i, deep=False):
    """The drawing of frame i (on twos) -> dict: d (inserted px), fs (foreshortening), cam (zoom, dx, dy), hand.
    deep (paw-4c48.13): the long shot (N_DEEP frames): strokes from fully out to 0.97 L inside, held 0.8 L deep over
    HILT, no hand, no foreshortening."""
    k = i - i % 2
    if deep:
        d = HILT_D if k in HILT else 0.485 * L * (1 - math.cos(2 * math.pi * k / PERIOD))
        z = 1 + 0.25 * math.sin(2 * math.pi * k / 90)
        return {"d": d, "fs": 1.0, "z": z, "dx": 15 * math.sin(2 * math.pi * k / 70), "dy": 10 * math.cos(2 * math.pi * k / 110), "hand": False}
    d = 0.45 * L * (1 - math.cos(2 * math.pi * k / PERIOD))  # 0 .. 0.9 L inside
    fs = 1.0
    if k in FORE:
        d, fs = -30.0, 0.6
    if k in PULL:
        d = -70.0

    z = 1 + 0.25 * math.sin(2 * math.pi * k / 90)
    return {"d": d, "fs": fs, "z": z, "dx": 15 * math.sin(2 * math.pi * k / 70), "dy": 10 * math.cos(2 * math.pi * k / 110),
            "hand": k in HAND}


def truth(i, deep=False):
    """The shaft runs from its base cap (WID / 2 behind the base) to its tip cap (WID / 2 past the tip): full length
    L + WID; what is past the entrance is inside."""
    s = state(i, deep)
    r = WID / 2
    b = EDGE - L + s["d"]
    vis = min(b + L + r, EDGE) - (b - r) if s["fs"] == 1 else L + 2 * r
    kn = 0.0 if EDGE - b > KNOT_AT + KNOT_R else 1.0 if EDGE - b < KNOT_AT - KNOT_R else 0.5
    return {"in": 1 - vis / (L + 2 * r), "vis": vis / (L + 2 * r), "knot": kn, "hand": s["hand"], "fore": s["fs"] < 1}



def _cam(s, P):
    P = np.asarray(P, float)
    return (P - [W / 2, H / 2]) * s["z"] + [W / 2 + s["dx"], H / 2 + s["dy"]]


def _base(s):
    return np.array([EDGE - L * s["fs"] + s["d"], 180.0])


def frame(i, deep=False):
    import cv2
    s = state(i, deep)
    img = np.full((H, W, 3), BG_C, np.uint8)
    b = _base(s)
    tip = b + [L * s["fs"], 0]
    r = WID / 2 * s["z"]
    P = _cam(s, [b, tip, b + [KNOT_AT * s["fs"], 0]])
    cv2.line(img, tuple(np.round(P[0]).astype(int)), tuple(np.round(P[1]).astype(int)), SHAFT_C, int(round(2 * r)))
    cv2.circle(img, tuple(np.round(P[2]).astype(int)), int(round(KNOT_R * s["z"])), SHAFT_C, -1)
    c = _cam(s, [ELL[0]])[0]
    cv2.ellipse(img, tuple(int(v) for v in np.round(c)), (int(round(ELL[1][0] * s["z"])), int(round(ELL[1][1] * s["z"]))), 0, 0, 360, BODY_C, -1)

    if s["hand"]:
        q = _cam(s, [b + [0.3 * L, -30], b + [0.45 * L, 30]])
        cv2.rectangle(img, tuple(np.round(q[0]).astype(int)), tuple(np.round(q[1]).astype(int)), HAND_C, -1)
    return img


def _inside_ell(p):
    (cx, cy), (a, bb) = ELL
    return ((p[0] - cx) / a) ** 2 + ((p[1] - cy) / bb) ** 2 <= 1


def pts(i, deep=False, dying=False):
    """The overlay `pts` of frame i: [x, y, visible, motion group 0, part 0, group id] per point (fixed order).
    dying (paw-4c48.13, what the owner's tracker does on a long shot): the penis members that went inside during the
    long hold stay hidden for the rest of the shot (only the base ones survive)."""
    s = state(i, deep)
    b = _base(s)
    out = []

    def add(p, vis, gid):
        q = _cam(s, [p])[0]
        out.append([round(q[0] / W, 4), round(q[1] / H, 4), int(vis), 0, 0, gid])

    for f in np.linspace(0.06, 0.94, 8):  # penis members
        for a in (-0.25, 0.25):
            p = b + [f * L * s["fs"], a * WID]
            hid = p[0] > EDGE or (s["hand"] and b[0] + 0.3 * L <= p[0] <= b[0] + 0.45 * L)
            hid = hid or (dying and i >= HILT[0] and f * L > L - HILT_D)   # went in during the hold: lost for good
            add(p, not hid, IDS["c1_penis"])
    for y in np.linspace(160, 200, 6):
        add([EDGE + 6, y], True, IDS["c2_anus"])
    for p in [(380, 120), (420, 100), (470, 150), (500, 200), (450, 250), (400, 260), (460, 200), (420, 180)]:
        add(p, True, IDS["c2_hips"])
    for dx in (-8, 0, 8, 16):
        add(b + [dx, 22], True, IDS["c1_balls"])
    for dx in (0.32, 0.43):
        for dy in (-20, 20):
            add(b + [dx * L, dy], s["hand"], IDS["c2_hand_l"])
    return out


def clip(deep=False, dying=False):
    """-> (ts ms, pts per frame, groups)."""
    n = N_DEEP if deep else N
    return np.arange(n) * 1000 / 24, [pts(i, deep, dying) for i in range(n)], [dict(g) for g in GROUPS]


def oracle(frames, roi, size, p):
    """A perfect stand-in for SAM on this clip: the shaft colour in each crop."""
    for k, img in frames:
        m = np.all(np.abs(img.astype(int) - SHAFT_C) <= 2, axis=2)
        yield k, m, 1.0
