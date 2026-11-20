"""Box -> good features -> pyramidal Lucas-Kanade with forward-backward check, re-seeding when
points die. Value = cumulative median point motion, projected on the chosen axis."""
import cv2
import numpy as np

from pawtrack.registry import param, register
from pawtrack.trackers import lk_fb, low_motion_note


def _seed(gray, box, p):
    H, W = gray.shape
    x, y, w, h = box
    x0, y0 = int(max(0, x)), int(max(0, y))
    x1, y1 = int(min(W, x + w)), int(min(H, y + h))
    if x1 - x0 < 3 or y1 - y0 < 3:
        return np.zeros((0, 2), np.float32)
    mask = np.zeros_like(gray)
    mask[y0:y1, x0:x1] = 255
    pts = cv2.goodFeaturesToTrack(gray, p["max_points"], 0.01, 3, mask=mask)
    return np.zeros((0, 2), np.float32) if pts is None else pts.reshape(-1, 2)


@register("lk_box", "Optical flow (box)", roi="box", channels=["raw_px"], params=[
    param("axis", "Axis", "choice", "vertical", choices=["vertical", "horizontal", "auto"]),
    param("max_points", "Max feature points", "int", 60, 4, 500),
    param("min_points", "Re-seed below N points", "int", 8, 1, 500),
    param("fb_max_err", "Forward-backward max error (px)", "float", 1.0, 0.1, 20.0),
    param("win", "LK window (px)", "int", 21, 5, 101),
])
def track(frames, roi, p):
    prev = None
    disp = np.zeros(2)
    raws = []
    for t, img in frames:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        H, W = gray.shape
        if prev is None:
            box = np.array([roi["x"] * W, roi["y"] * H, roi["w"] * W, roi["h"] * H], float)
            pts = _seed(gray, box, p)
            value = (0.0, 0.0)
        else:
            new, ok = lk_fb(prev, gray, pts, p["win"], p["fb_max_err"])
            if ok.any():
                d = np.median(new[ok] - pts[ok], axis=0)
                disp += d
                box[:2] += d
                value = (float(disp[0]), float(disp[1]))
            else:
                value = None
            pts = new[ok]
            if len(pts) < p["min_points"]:
                pts = _seed(gray, box, p)
        prev = gray
        if value is not None and p["axis"] != "auto":
            value = -value[1] if p["axis"] == "vertical" else value[0]  # up = higher
        # raw_px: the value in frame px (auto: distance from the start position, unsigned)
        raw = None if value is None else (float(np.hypot(*value)) if isinstance(value, tuple) else value)
        raws.append(raw)
        yield t, {"value": value, "channels": {"raw_px": raw}}, {"points": (pts / [W, H]).round(4).tolist(),
                         "boxes": [(box / [W, H, W, H]).round(4).tolist()]}
    low_motion_note("lk_box", raws)
