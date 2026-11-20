"""Tracker plug-ins: one file per tracker, each calling pawtrack.registry.register.

Tracker contract:
    track(frames, roi, params) -> iterator of (t_ms, value, overlay), one item per input frame
      frames:  iterator of (t_ms, bgr uint8 ndarray), full resolution, one scene (no cuts inside)
      roi:     request ROI dict (normalized 0..1 coords) or None
      value:   float in any unit (core normalizes per scene), or (dx, dy) image-space displacement
               (core projects onto the principal axis of motion), or None if lost
      overlay: {"points": [[x, y], ...], "boxes": [[x, y, w, h], ...]}, normalized 0..1
Helpers shared by the built-in LK trackers live here (files starting with '_' or this file are
never registered).
"""
import sys

import cv2
import numpy as np


def lk_fb(prev_gray, gray, pts, win=21, max_fb_err=1.0):
    """Pyramidal LK with forward-backward check. pts: (N,2) float32 px.
    Returns (new_pts (N,2), ok mask (N,))."""
    if len(pts) == 0:
        return pts, np.zeros(0, bool)
    p0 = pts.reshape(-1, 1, 2).astype(np.float32)
    kw = dict(winSize=(win, win), maxLevel=3,
              criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01))
    p1, st1, _ = cv2.calcOpticalFlowPyrLK(prev_gray, gray, p0, None, **kw)
    p0r, st2, _ = cv2.calcOpticalFlowPyrLK(gray, prev_gray, p1, None, **kw)
    fb = np.linalg.norm((p0 - p0r).reshape(-1, 2), axis=1)
    ok = (st1.ravel() == 1) & (st2.ravel() == 1) & (fb < max_fb_err)
    return p1.reshape(-1, 2), ok


RAW_MIN_PX = 4.0  # below this raw peak-to-peak a "stroke" is most likely tracker noise / a static background


NOTES = []  # {"code","message"(,"data")} collected during one track run; cli.cmd_track clears it, stamps scene_index, returns it as result.notes


def note(code, message, data=None):
    """Info note: stderr line (kept) + an entry in the track result's `notes`. data: optional JSON object (PROTOCOL v3.2)."""
    print(f"pawtrack: info: {message}", file=sys.stderr)
    NOTES.append({"code": code, "message": message, **({} if data is None else {"data": data})})


def low_motion_note(tracker, raws, thr=RAW_MIN_PX):
    """info note when a scene's raw_px channel barely moves (per-scene normalization would still turn it
    into a full 0..100 stroke). """
    v = np.array([r for r in raws if r is not None], float)
    if len(v) >= 2 and np.ptp(v) < thr:
        note("low_motion", f"{tracker} raw_px peak-to-peak {np.ptp(v):.1f} px < {thr:g} px: "
                           f"probably no real motion, the normalized signal is noise",
             {"ptp_px": round(float(np.ptp(v)), 1), "thr_px": thr})
