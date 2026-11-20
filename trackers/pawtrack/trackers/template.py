"""Template matching (colour, normalized cross-correlation) of the box inside a search window.
Colour matters on flat-shaded 2D art where two fills can share the same grey level."""
import cv2
import numpy as np

from pawtrack.registry import param, register
from pawtrack.trackers import low_motion_note


@register("template", "Template match (box)", roi="box", channels=["raw_px"], params=[
    param("axis", "Axis", "choice", "vertical", choices=["vertical", "horizontal", "auto"]),
    param("search_margin", "Search margin (x box size)", "float", 1.0, 0.1, 5.0),
    param("min_score", "Min match score", "float", 0.4, -1.0, 1.0),
    param("update_rate", "Template update rate (0 = fixed)", "float", 0.0, 0.0, 1.0),
])
def track(frames, roi, p):
    tmpl = None
    raws = []
    # ponytail: integer-pixel match; add parabola sub-pixel refinement if small motions look steppy
    for t, img in frames:
        H, W = img.shape[:2]
        if tmpl is None:
            w, h = max(4, round(roi["w"] * W)), max(4, round(roi["h"] * H))
            x0 = x = int(np.clip(round(roi["x"] * W), 0, W - w))
            y0 = y = int(np.clip(round(roi["y"] * H), 0, H - h))
            tmpl = img[y:y + h, x:x + w].astype(np.float32)
            value = (0.0, 0.0)
        else:
            mx, my = int(w * p["search_margin"]), int(h * p["search_margin"])
            sx, sy = max(0, x - mx), max(0, y - my)
            win = img[sy:min(H, y + h + my), sx:min(W, x + w + mx)].astype(np.float32)
            _, score, _, loc = cv2.minMaxLoc(cv2.matchTemplate(win, tmpl, cv2.TM_CCOEFF_NORMED))
            if score >= p["min_score"]:
                x, y = sx + loc[0], sy + loc[1]
                value = (float(x - x0), float(y - y0))
                if p["update_rate"] > 0:
                    tmpl = cv2.addWeighted(tmpl, 1 - p["update_rate"],
                                           img[y:y + h, x:x + w].astype(np.float32), p["update_rate"], 0)
            else:
                value = None
        if value is not None and p["axis"] != "auto":
            value = -value[1] if p["axis"] == "vertical" else value[0]  # up = higher
        raw = None if value is None else (float(np.hypot(*value)) if isinstance(value, tuple) else value)
        raws.append(raw)  # raw_px: value in frame px (auto: distance from the start, unsigned)
        yield t, {"value": value, "channels": {"raw_px": raw}}, {"points": [], "boxes": [[round(x / W, 4), round(y / H, 4), round(w / W, 4), round(h / H, 4)]]}
    low_motion_note("template", raws)
