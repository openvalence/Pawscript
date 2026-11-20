"""Two user points tracked with Lucas-Kanade; value = distance between them."""
import cv2
import numpy as np

from pawtrack.registry import param, register
from pawtrack.trackers import lk_fb, low_motion_note


@register("lk_two_point", "Optical flow (distance between 2 points)", roi="points", channels=["raw_px"], params=[
    param("fb_max_err", "Forward-backward max error (px)", "float", 2.0, 0.1, 20.0),
    param("win", "LK window (px)", "int", 31, 5, 101),
])
def track(frames, roi, p):
    if len(roi["points"]) != 2:
        raise ValueError("lk_two_point needs exactly 2 points")
    prev = None
    raws = []
    for t, img in frames:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        H, W = gray.shape
        if prev is None:
            pts = (np.array(roi["points"], float) * [W, H]).astype(np.float32)
            ok = np.ones(2, bool)
        else:
            new, ok = lk_fb(prev, gray, pts, p["win"], p["fb_max_err"])
            pts = np.where(ok[:, None], new, pts)  # a lost point stays put and retries next frame
        prev = gray
        value = float(np.linalg.norm(pts[0] - pts[1])) if ok.all() else None
        raws.append(value)  # raw_px = the distance itself, frame px
        yield t, {"value": value, "channels": {"raw_px": value}}, {"points": (pts / [W, H]).round(4).tolist(), "boxes": []}
    low_motion_note("lk_two_point", raws)
