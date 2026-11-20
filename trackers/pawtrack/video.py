"""Frame source. Timestamps are presentation timestamps (PTS) from the container, rebased so
the file starts at 0 (same as mpv / <video>.currentTime). Never frame_index / fps, so VFR is fine."""
import sys

import av
import numpy as np


def probe(path):
    """Media facts the webview can't read: {"duration_ms","fps","is_vfr","width","height","frame_count"}.
    Demuxes packets only (no decode). duration_ms = end of the last video frame on the same
    rebased PTS clock as open_frames, so the last scene ends exactly there.
    ponytail: reads the whole file (~1-2 s per GB from SSD); sample the head if that gets slow."""
    with av.open(path) as c:
        s = c.streams.video[0]
        tb, t0_us = float(s.time_base), c.start_time or 0
        pk = sorted((p.pts, p.duration or 0) for p in c.demux(s) if p.pts is not None)
        w, h = s.codec_context.width, s.codec_context.height
        rate = s.average_rate or s.guessed_rate
    if not pk:
        raise ValueError("no video packets")
    pts = np.array([p for p, _ in pk], float)
    dt = np.diff(pts)
    med = float(np.median(dt)) if len(dt) else 0.0
    last_dur = pk[-1][1] or med
    vfr = bool(len(dt) and np.abs(dt - med).max() > max(1.5, 0.01 * med))  # in ticks
    return {"duration_ms": round((pts[-1] + last_dur) * tb * 1000 - t0_us / 1000),
            "fps": round(float(rate) if rate else (1 / (med * tb) if med else 0.0), 3),
            "is_vfr": vfr, "width": w, "height": h, "frame_count": len(pk)}


def open_frames(path, start_ms=0, end_ms=None, width=None):
    """Returns (estimated_frame_count, iterator of (t_ms, bgr ndarray)).
    width: if set, frames are scaled (aspect kept) by swscale right after decode."""
    c = av.open(path)
    s = c.streams.video[0]
    s.thread_type = "AUTO"
    t0_us = c.start_time or 0
    dur_ms = (c.duration or 0) / 1000
    rate = float(s.average_rate or s.guessed_rate or 30)
    stop = dur_ms if end_ms is None else min(end_ms, dur_ms or end_ms)
    total = max(1, round((stop - start_ms) / 1000 * rate))  # estimate only (VFR); progress clamps
    size = {}
    if width and s.codec_context.width:
        size = {"width": width, "height": max(2, round(s.codec_context.height * width / s.codec_context.width / 2) * 2)}

    def gen():
        with c:
            if start_ms > 0:
                c.seek(int(start_ms * 1000 + t0_us), backward=True)  # lands on keyframe before
            for f in c.decode(s):
                if f.pts is None:
                    print("pawtrack: frame without pts skipped", file=sys.stderr)
                    continue
                t = round(float(f.pts * f.time_base) * 1000 - t0_us / 1000)
                if t < start_ms:
                    continue
                if end_ms is not None and t > end_ms:
                    break
                yield t, f.to_ndarray(format="bgr24", **size)

    return total, gen()
