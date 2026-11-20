"""`frames` command: exact frames by timestamp as single JPEGs or labelled contact sheets (README §8.1 of
src/lib/director). Also the frame access shared by motion.* and director.ask:
  grab(path, times, width)          nearest frame at or before each time, one decode pass with seeks
  sampled(path, t0, t1, hz, width)  one frame per 1/hz step, only kept frames are converted
Gold-set videos (a path component named Reference) never produce images here."""
import base64
import math
import os
import re
from pathlib import Path

import av
import cv2
import numpy as np

SEEK_MS = 2000  # a gap longer than this between wanted times seeks instead of decoding through


def is_gold(video):
    return any(p.lower() == "reference" for p in re.split(r"[\\/]+", str(video)))


def _size(s, width):
    w, h = s.codec_context.width, s.codec_context.height
    if not width or not w or width >= w:
        return {}
    return {"width": int(width), "height": max(2, round(h * width / w / 2) * 2)}


def _ms(f, t0_us):
    return round(float(f.pts * f.time_base) * 1000 - t0_us / 1000)


def grab(path, times, width=None):
    """[bgr] for each time in `times` (ms): the nearest frame at or before it (the first frame for a time before
    it, the last frame for one after the end). Sorted once, decoded in one pass, seeking across gaps > SEEK_MS."""
    want = sorted({int(t) for t in times})
    got = {}
    with av.open(str(path)) as c:
        s = c.streams.video[0]
        s.thread_type = "AUTO"
        t0_us, size = c.start_time or 0, _size(s, width)
        i, prev, dec, sought = 0, None, None, None  # prev = [t, av frame, ndarray|None]

        def arr(p):
            if p[2] is None:
                p[2] = p[1].to_ndarray(format="bgr24", **size)
            return p[2]
        while i < len(want):
            if dec is None or (prev is not None and want[i] - prev[0] > SEEK_MS and sought != want[i]):
                c.seek(int(max(0, want[i]) * 1000 + t0_us), backward=True)
                dec, prev, sought = c.decode(s), None, want[i]
            f = next(dec, None)
            if f is None:  # end of stream: everything left gets the last frame
                if prev is None:
                    raise ValueError(f"no frame at or before {want[i]} ms")
                while i < len(want):
                    got[want[i]] = arr(prev)
                    i += 1
                break
            if f.pts is None:
                continue
            t = _ms(f, t0_us)
            cur = [t, f, None]
            while i < len(want) and want[i] < t:
                got[want[i]] = arr(prev or cur)
                i += 1
            prev = cur
    return [got[int(t)] for t in times]


def sampled(path, t0, t1, hz, width=None):
    """(estimated count, iterator of (t_ms, bgr)): the first frame of every 1000/hz ms step of [t0, t1)."""
    c = av.open(str(path))
    s = c.streams.video[0]
    s.thread_type = "AUTO"
    t0_us, size = c.start_time or 0, _size(s, width)
    step = 1000.0 / hz
    total = max(1, int((t1 - t0) / step))

    def gen():
        nxt = t0
        with c:
            if t0 > 0:
                c.seek(int(t0 * 1000 + t0_us), backward=True)
            for f in c.decode(s):
                if f.pts is None:
                    continue
                t = _ms(f, t0_us)
                if t < nxt:
                    continue
                if t >= t1:
                    break
                yield t, f.to_ndarray(format="bgr24", **size)
                nxt = t0 + (math.floor((t - t0) / step) + 1) * step
    return total, gen()


def _fmt(ms):
    return f"{int(ms // 60000)}:{ms % 60000 / 1000:04.1f}"


def _text(img, s, x, y, scale=0.45):
    (w, h), b = cv2.getTextSize(s, cv2.FONT_HERSHEY_SIMPLEX, scale, 1)
    cv2.rectangle(img, (x, y), (x + w + 6, y + h + b + 4), (0, 0, 0), -1)
    cv2.putText(img, s, (x + 3, y + h + 2), cv2.FONT_HERSHEY_SIMPLEX, scale, (255, 255, 255), 1, cv2.LINE_AA)


def _tile(bgr, crop, height, grid, ov):
    H, W = bgr.shape[:2]
    cx, cy, cw, ch = (crop["x"], crop["y"], crop["w"], crop["h"]) if crop else (0.0, 0.0, 1.0, 1.0)
    x0, y0 = int(round(cx * W)), int(round(cy * H))
    x1, y1 = max(x0 + 1, int(round((cx + cw) * W))), max(y0 + 1, int(round((cy + ch) * H)))
    img = bgr[y0:y1, x0:x1]
    th = int(height)
    tw = max(1, round(th * img.shape[1] / img.shape[0]))
    img = cv2.resize(img, (tw, th), interpolation=cv2.INTER_AREA if th < img.shape[0] else cv2.INTER_LINEAR)
    to_px = lambda x, y: (int(round((x - cx) / cw * tw)), int(round((y - cy) / ch * th)))  # full-frame 0..1 -> tile
    if grid:
        for k in range(1, int(round(1 / grid))):
            g = round(k * grid, 4)
            px, _ = to_px(g, 0)
            _, py = to_px(0, g)
            if 0 < px < tw:
                cv2.line(img, (px, 0), (px, th), (0, 255, 255), 1)
                cv2.putText(img, f"{g:g}", (px + 2, th - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 255, 255), 1, cv2.LINE_AA)
            if 0 < py < th:
                cv2.line(img, (0, py), (tw, py), (0, 255, 255), 1)
                cv2.putText(img, f"{g:g}", (2, py - 3), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 255, 255), 1, cv2.LINE_AA)
    if ov:
        for x, y in ov.get("points") or []:
            cv2.circle(img, to_px(x, y), 4, (0, 255, 0), -1)
            cv2.circle(img, to_px(x, y), 5, (0, 0, 0), 1)
        for x, y, w, h in ov.get("boxes") or []:
            cv2.rectangle(img, to_px(x, y), to_px(x + w, y + h), (255, 0, 255), 2)
    return img


def _times(job):
    if job.get("times_ms"):
        return [int(t) for t in job["times_ms"]]
    t0, t1, step = int(job.get("t0") or 0), int(job.get("t1") or 0), int(job.get("step_ms") or 500)
    if t1 <= t0 or step <= 0:
        raise ValueError("frames: a job needs times_ms or t0 < t1 and step_ms > 0")
    return list(range(t0, t1, step))


def sheet(frames, times, job):
    """Frames (bgr, full frame) -> (sheet bgr, tiles). Pure: the test and the app's thumbnails use it."""
    labels, pos, names = job.get("labels") or "time", job.get("pos"), job.get("tile_labels")
    ovs = {int(o["t_ms"]): o for o in job.get("overlay") or []}
    tiles_img, tiles = [], []
    for k, (f, t) in enumerate(zip(frames, times)):
        ov = ovs.get(t) or (min(ovs.items(), key=lambda kv: abs(kv[0] - t))[1] if ovs else None)
        if ov is not None and abs(int(ov["t_ms"]) - t) > 50:
            ov = None
        img = _tile(f, job.get("crop"), job.get("height") or 240, job.get("grid"), ov)
        if names and k < len(names):
            lab = str(names[k])
        elif labels == "AB":
            lab = chr(65 + k % 26)
        elif labels == "time+pos":
            lab = f"{_fmt(t)} pos {round(pos[k])}" if pos and k < len(pos) and pos[k] is not None else _fmt(t)
        elif labels == "none":
            lab = ""
        else:
            lab = _fmt(t)
        if lab:
            _text(img, lab, 4, 4, 0.6 if labels == "AB" or names else 0.45)
        tiles_img.append(img)
        tiles.append({"t_ms": t, "label": lab})
    cols = max(1, min(int(job.get("cols") or 4), len(tiles_img)))
    rows = math.ceil(len(tiles_img) / cols)
    th = tiles_img[0].shape[0]
    tw = max(i.shape[1] for i in tiles_img)
    pad = 2 if len(tiles_img) > 1 else 0
    out = np.zeros((rows * th + (rows - 1) * pad, cols * tw + (cols - 1) * pad, 3), np.uint8)
    for k, img in enumerate(tiles_img):
        x, y = (k % cols) * (tw + pad), (k // cols) * (th + pad)
        out[y:y + th, x:x + img.shape[1]] = img
        tiles[k].update(x=x, y=y, w=img.shape[1], h=th)
    return out, tiles


def cmd_frames(req, emit):
    video = req["video"]
    if is_gold(video):
        raise ValueError("frames: gold-set video, images disabled")
    jobs = req.get("jobs") or []
    if not jobs:
        raise ValueError("frames: no jobs")
    images = []
    for n, job in enumerate(jobs):
        times = _times(job)
        if len(times) > 400:
            raise ValueError(f"frames: {len(times)} tiles in one job (max 400)")
        # decode at most 1920 wide (as track does); a crop keeps enough pixels for a 240-480 px tile
        img, tiles = sheet(grab(video, times, width=1920), times, job)
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, int(job.get("quality") or 85)])
        if not ok:
            raise RuntimeError("frames: JPEG encode failed")
        dest = job.get("dest")
        if dest:
            p = Path(dest)
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_name(p.name + ".tmp")
            tmp.write_bytes(buf.tobytes())
            os.replace(tmp, p)
        images.append({"dest": dest or None, "b64": None if dest else base64.b64encode(buf.tobytes()).decode("ascii"),
                       "w": int(img.shape[1]), "h": int(img.shape[0]), "tiles": tiles})
        emit({"type": "progress", "done": n + 1, "total": len(jobs)})
    return {"images": images}
