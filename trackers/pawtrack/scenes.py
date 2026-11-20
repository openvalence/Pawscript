"""Scene boundaries from one CPU pass over 160 px frames: hard cuts, plus the soft transitions a hard-cut test misses.

Hard cut: mean HSV difference between consecutive frames, compared with the largest difference in the recent window
(adaptive), plus an absolute floor. Own implementation instead of PySceneDetect (BSD-3) to keep deps and API churn out.
Comparing against the window *max* rather than mean keeps 2D animation shot on twos/threes (held frames -> diff
0,0,x,0,0,x) from looking like a stream of cuts.
cut_repeat (paw-fc0r): inside a fast loop every step is big, so the window max hides a cut to a similar-coloured angle.
Every loop frame has a near twin one cycle back and a cut's first frame has none: a frame whose novelty (32 px BGR
difference to the closest frame of the last NOV_MS) is >= NOV_RATIO x the window's largest novelty (+1), with the HSV
step >= cut_min_content, is a cut too (truth set: experiments/cuts/RESULTS.md).

On top (finish(), over per-frame numbers kept during the pass plus a ~4.5 s ring of small frames):
  blank     a run >= BLANK_MS of frames with luma mean < BLANK_DARK (or > BLANK_LIGHT: white) and luma std < BLANK_STD
            is its own scene, kind 'blank' (cut_blank).
  fade      the monotone luma ramp into / out of a blank (>= FADE_MS, luma moving >= FADE_DROP toward the blank, the
            same content frame to frame: grey correlation >= FADE_CORR, or already dark) belongs to the blank: the
            scene before ends where the fade-out starts, the next begins where the fade-in ends. Held frames (twos)
            keep the ramp monotone; the walk stops once luma has not moved for RAMP_FLAT_MS (the scene's own level).
  dissolve  a stretch >= DISSOLVE_MS whose steps are small but whose ends differ by a cut-sized jump (the cut test on
            the pair, and >= DISSOLVE_PRE x the change over the same span just before it: steady motion is no dissolve)
            and whose inner frames are blends of the ends (correlation of (x - a) with (c - a) >= BLEND_CORR at 1/4,
            1/2, 3/4, the blend weight increasing, 0.25..0.75 in the middle): one cut where the blend passes 0.5
            (cut_dissolve). Compared on BLEND_W px BGR frames (no hue wrap-around).
  flash     a cut whose content returns within FLASH_MS (the frame after differs from the frame before by less than a
            cut) is no cut at all.
  still     a run >= STILL_MS of frames that do not change (under STILL_PX of pixels move more than HELD grey levels;
            not blank): a title card, a frozen frame. A scene it (nearly) fills is kind 'still'; one at a scene's start
            or end is split off as its own 'still' scene when the rest keeps cut_min_scene_ms; a still inside a scene
            (a pose held mid-action) is not a cut (cut_blank).
cut_min_scene_ms applies to hard cuts only (on both sides, the range's end too); blank, fade and dissolve boundaries
always stand. Blank runs a flicker (<= FLASH_MS) apart are one blank.
"""
import bisect

import cv2
import numpy as np

from pawtrack.registry import param

SCENE_PARAMS = [
    param("cut_enabled", "Detect cuts", "bool", True),
    param("cut_threshold", "Cut ratio vs recent motion", "float", 3.0, 1.0, 50.0),
    param("cut_min_content", "Min frame difference (0-255)", "float", 15.0, 0.0, 255.0),
    param("cut_window", "Adaptive window (frames)", "int", 8, 1, 120),
    param("cut_min_scene_ms", "Min scene length (ms)", "int", 500, 0, 60000),
    param("cut_camera", "Split at camera moves (same shot, continuing action)", "bool", True),
    param("cut_blank", "Blank / fade / still segments", "bool", True),
    param("cut_dissolve", "Cut at dissolves", "bool", True),
    param("cut_repeat", "Cuts inside fast loops (compare with the last cycle)", "bool", True),
]
SCAN_WIDTH = 160  # px; cut detection never needs more

BLANK_DARK, BLANK_LIGHT, BLANK_STD = 16.0, 240.0, 10.0  # luma mean / std (0-255) of a blank frame
BLANK_MS = 150
FADE_MS, FADE_DROP, FADE_CORR = 200, 20.0, 0.2
FADE_TOL, RAMP_FLAT_MS, FADE_MAX_MS = 1.5, 250, 5000  # luma a ramp may step back; flat time that ends it; longest
DISSOLVE_MS, BLEND_CORR = 300, 0.8
DISSOLVE_PRE = 2.0  # the ends' jump vs the same span just before it (motion changes the picture steadily)
LAGS_MS = (300, 500, 800, 1200, 2000)  # end-to-end spans a dissolve is looked for at
RING_MS = 2 * LAGS_MS[-1] + 500
FLASH_MS = 80
STILL_MS, HELD, STILL_PX = 2000, 4, 0.01
BLEND_W = 32  # px; the dissolve test's frames (BGR): small motion averages out, hue wrap-around does not count
NOV_MS = 1500  # cut_repeat: a frame's novelty = its difference to the closest of the frames this far back (a cycle)
NOV_RATIO = 5.0  # ... a cut when the novelty is this many times its recent max (+1): stricter than cut_threshold


def _small(img):
    if img.shape[1] > SCAN_WIDTH:
        img = cv2.resize(img, (SCAN_WIDTH, max(2, img.shape[0] * SCAN_WIDTH // img.shape[1])),
                         interpolation=cv2.INTER_AREA)
    return img


def keep_pixels(mask, shape):
    """Optional ignore mask (a low-resolution bool grid over the picture, True = ignore: a burnt-in logo or caption) ->
    (h, w) bool of the pixels to KEEP at a frame of `shape`, or None without a mask."""
    if mask is None:
        return None
    m = cv2.resize(np.asarray(mask, np.uint8), (shape[1], shape[0]), interpolation=cv2.INTER_NEAREST).astype(bool)
    return ~m if m.any() and not m.all() else None


def _blend_frame(img):
    h = max(2, img.shape[0] * BLEND_W // img.shape[1])
    return cv2.resize(img, (BLEND_W, h), interpolation=cv2.INTER_AREA).astype(np.float32)


def _blend(a, x, c):
    """-> (weight, correlation) of x - a along c - a."""
    v, w = c - a, x - a
    vv, ww = float((v * v).sum()), float((w * w).sum())
    if vv < 1e-6 or ww < 1e-6:
        return 0.0, 0.0
    vw = float((v * w).sum())
    return vw / vv, vw / (vv * ww) ** 0.5


class CutDetector:
    """Call once per frame, in order: returns True if this frame starts a new scene by the online hard-cut test (the
    camera detector resets there; eval/inventory.py uses it alone). finish(start_ms, end_ms) -> the scene list with
    blanks, fades, dissolves, flashes and stills resolved (see the module doc): the `scenes` command and track's own
    cut pass."""

    def __init__(self, p, mask=None):
        """mask: optional ignore grid (keep_pixels; True = ignore). Its pixels take the frame's mean colour of the rest
        before anything is measured, so an overlay that never changes neither hides a change nor breaks a blank."""
        self.p, self.mask, self.keep = p, mask, None
        self.prev = self.prev8 = None
        self.recent = []
        self.last_cut_ms = None
        self.t, self.d, self.raw, self.m, self.s, self.corr, self.held = [], [], [], [], [], [], []
        self.ring = []  # contiguous frames: (index, BLEND_W px BGR float32)
        self.e = []  # per frame: mean |BGR step| at BLEND_W
        self.nov, self.nrecent = [], []  # per frame: novelty (cut_repeat, NOV_MS); its recent window
        self.flash = None  # open (cut index, hsv of the frame before, its score)
        self.flashes, self.dissolves = [], []  # [(first, return)], [(start, cut, end)] frame indices
        self.region = None  # open dissolve candidate [first, last]
        self.found = {}

    def __call__(self, t_ms, img):
        if not self.p["cut_enabled"]:
            return False
        img = _small(img)
        if self.mask is not None:
            if self.keep is None or self.keep.shape != img.shape[:2]:
                self.keep = keep_pixels(self.mask, img.shape)
            if self.keep is not None:
                img = img.copy()
                img[~self.keep] = img[self.keep].mean(0).astype(img.dtype)
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.int16)
        g8 = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        g = g8.astype(np.float32)
        mu, sd = cv2.meanStdDev(g)
        m, s = float(mu[0, 0]), float(sd[0, 0])
        i, prev, prev8 = len(self.t), self.prev, self.prev8
        self.prev, self.prev8 = hsv, g8
        self.t.append(t_ms)
        self.m.append(m)
        self.s.append(s)
        if prev is None or prev.shape != hsv.shape:
            self.last_cut_ms = t_ms if prev is None else self.last_cut_ms
            self.d.append(0.0), self.raw.append(False), self.corr.append(1.0), self.held.append(False)
            self.ring.clear()
            self.e.append(0.0)
            self.nov.append(0.0)
            self._ring(i, img)
            return False
        score = float(np.abs(hsv - prev).mean())
        base = max(self.recent) if self.recent else 0.0
        self.recent = (self.recent + [score])[-self.p["cut_window"]:]
        raw = score >= self.p["cut_min_content"] and score >= self.p["cut_threshold"] * (base + 1.0)
        small = _blend_frame(img)
        nov = min((float(np.abs(small - f).mean()) for j, f in self.ring if t_ms - self.t[j] <= NOV_MS), default=0.0)
        nbase = max(self.nrecent) if self.nrecent else 0.0
        self.nrecent = (self.nrecent + [nov])[-self.p["cut_window"]:]
        self.nov.append(nov)
        if self.p["cut_repeat"] and not raw and score >= self.p["cut_min_content"]:
            # paw-fc0r: in a fast loop every step is big, so the window max hides a cut; but every frame of a loop has a
            # near twin one cycle back and a cut's first frame has none: the same ratio test on that novelty
            raw = nov >= max(NOV_RATIO, self.p["cut_threshold"]) * (nbase + 1.0)
        den = s * self.s[-2] * g.size
        self.corr.append(float(((g - m) * (prev8.astype(np.float32) - self.m[-2])).sum()) / den if den > 1e-6 else 1.0)
        self.held.append(np.count_nonzero(cv2.absdiff(g8, prev8) > HELD) < STILL_PX * g8.size)
        self.d.append(score)
        self.raw.append(raw)
        if self.flash is not None:  # a cut whose content comes back within FLASH_MS: a flash, no cut
            j0, before, sc = self.flash
            if t_ms - self.t[j0] > FLASH_MS + 1:
                self.flash = None
            elif float(np.abs(hsv - before).mean()) < min(self.p["cut_min_content"], sc / self.p["cut_threshold"]):
                self.flashes.append((j0, i))
                self.flash = None
        if raw and self.flash is None:
            self.flash = (i, prev, score)
        self._ring(i, img, small)
        if self.p["cut_dissolve"]:
            self._dissolve(i)
        cut = raw and t_ms - self.last_cut_ms >= self.p["cut_min_scene_ms"]
        if cut:
            self.last_cut_ms = t_ms
        return cut

    def _ring(self, i, img, small=None):
        small = _blend_frame(img) if small is None else small
        if len(self.e) <= i:
            self.e.append(float(np.abs(small - self.ring[-1][1]).mean()))
        self.ring.append((i, small))
        while self.t[i] - self.t[self.ring[0][0]] > RING_MS:
            self.ring.pop(0)

    def _frame(self, j):
        return self.ring[j - self.ring[0][0]]

    def _blank(self, j):
        return (self.m[j] < BLANK_DARK or self.m[j] > BLANK_LIGHT) and self.s[j] < BLANK_STD

    def _dissolve(self, c):
        """Online dissolve candidates ending at frame c; overlapping candidates merge into one region, refined once
        no later candidate can reach it."""
        t, r0 = self.t, self.ring[0][0]
        if self.region and t[c] - t[self.region[1]] > LAGS_MS[-1]:
            self._close()
        if self._blank(c):
            return
        times = t[r0:c + 1]
        hc = self._frame(c)
        for lag in LAGS_MS:
            k = bisect.bisect_right(times, t[c] - lag) - 1
            if k < 0:
                break
            a = r0 + k
            if c - a < 4 or self._blank(a) or any(self.raw[a + 1:c + 1]):
                continue
            step = max(self.e[a + 1:c + 1])
            ha = self._frame(a)
            jump = float(np.abs(hc[1] - ha[1]).mean())
            if jump < self.p["cut_min_content"] or jump < self.p["cut_threshold"] * (step + 1.0):
                continue
            if a - (c - a) >= r0 and jump < DISSOLVE_PRE * (float(np.abs(ha[1] - self._frame(a - (c - a))[1]).mean()) + 1.0):
                continue  # the same lag just before changes as much: motion, not a change of picture
            ws = []
            for q in (0.25, 0.5, 0.75):
                w, r = _blend(ha[1], self._frame(a + round((c - a) * q))[1], hc[1])
                if r < BLEND_CORR:
                    break
                ws.append(w)
            if len(ws) < 3 or not (0.0 < ws[0] < ws[1] < ws[2] < 1.0) or not 0.25 <= ws[1] <= 0.75:
                continue
            if self.region and a <= self.region[1]:
                self.region = [min(self.region[0], a), c]
            else:
                if self.region:
                    self._close()
                self.region = [a, c]

    def _close(self):
        (a, c), self.region = self.region, None
        a = max(a, self.ring[0][0])
        if c - a < 2:
            return
        A, B = self._frame(a)[1], self._frame(c)[1]
        w = [_blend(A, self._frame(j)[1], B)[0] for j in range(a, c + 1)]
        mid = next((k for k, x in enumerate(w) if x >= 0.5), None)
        if mid is None:
            return
        st = max([k for k in range(mid) if w[k] <= 0.1], default=0)
        en = min([k for k in range(mid, len(w)) if w[k] >= 0.9], default=len(w) - 1)
        if self.t[a + en] - self.t[a + st] >= DISSOLVE_MS:
            self.dissolves.append((a + st, a + mid, a + en))

    # ------------------------------------------------------------------ offline resolution

    def _ramp(self, edge, step, blank_x, x):
        """The fade ramp next to a blank run, x = luma distance from the blank's side (black: luma, white: 255 - luma).
        edge = the run's first frame (step -1: walk back from edge - 1) or the first frame after it (step +1: walk
        forward from edge). -> (boundary frame, ramp ms), or (edge, 0) without a ramp."""
        t, n = self.t, len(self.t)
        j, prev = edge - 1 if step < 0 else edge, None
        top, top_j = -1.0, None
        while 0 <= j < n and abs(t[j] - t[edge]) <= FADE_MAX_MS:
            later = (prev if step < 0 else j) if prev is not None else (edge if step < 0 else j)
            dark = self.s[later] < 2 * BLANK_STD
            if not dark and (self.corr[later] < FADE_CORR or self.raw[later]):
                break  # a different picture: a hard cut, not a fade
            if prev is not None and x[j] < x[prev] - FADE_TOL:
                break
            if x[j] > top + 1.0:
                top, top_j = x[j], j
            elif abs(t[j] - t[top_j]) > RAMP_FLAT_MS:
                break
            prev, j = j, j + step
        if top_j is None or top - blank_x < FADE_DROP:
            return edge, 0
        b = top_j + 1 if step < 0 else top_j
        ms = abs(t[edge] - t[b]) if b < n else 0
        return (b, ms) if ms >= FADE_MS else (edge, 0)

    def finish(self, start_ms, end_ms):
        """-> [{start_ms, end_ms, kind: 'blank'|'still'|None, transition: {in, out, in_ms?, out_ms?}}], contiguous over
        [start_ms, end_ms]. in / out: 'cut' | 'fade' | 'dissolve' (None at the range's ends); *_ms: the fade's or the
        whole dissolve's length."""
        p, t, n = self.p, self.t, len(self.t)
        if self.region:
            self._close()
        found = self.found = {"blank": 0, "fade": 0, "dissolve": 0, "flash": len(self.flashes), "still": 0}
        if n == 0 or not p["cut_enabled"]:
            return [{"start_ms": start_ms, "end_ms": end_ms, "kind": None, "transition": {"in": None, "out": None}}]
        tt = lambda j: end_ms if j >= n else t[j]
        raw = list(self.raw)
        for a, b in self.flashes:
            for j in range(a, b + 1):
                raw[j] = False
        bounds = {}  # frame index -> (kind, ms) of the transition into it
        blanks, spans = [], []  # [(first, end)] blank scenes; [(first, last)] where hard cuts do not count
        if p["cut_blank"]:
            isb = [self._blank(j) for j in range(n)]
            j = 0
            while j < n:
                if not isb[j]:
                    j += 1
                    continue
                e = j
                while e < n and isb[e]:
                    e += 1
                if tt(e) - t[j] >= BLANK_MS:
                    x = [255.0 - v for v in self.m] if self.m[j] > BLANK_LIGHT else self.m
                    lvl = float(np.mean(x[j:e]))
                    f, fms = self._ramp(j, -1, lvl, x) if j > 0 else (0, 0)
                    g, gms = self._ramp(e, +1, lvl, x) if e < n else (n, 0)
                    if blanks and tt(f) - tt(blanks[-1][1]) <= FLASH_MS:  # touching the last blank (or a flicker apart): one
                        bounds.pop(blanks[-1][1], None)
                        f = blanks.pop()[0]
                    elif f > 0:
                        bounds[f] = ("fade", fms) if fms else ("cut", 0)
                        found["fade"] += bool(fms)
                    if g < n:
                        bounds[g] = ("fade", gms) if gms else ("cut", 0)
                        found["fade"] += bool(gms)
                    blanks.append((f, g))
                j = e
            spans += blanks
            found["blank"] = len(blanks)
        for a, mid, c in self.dissolves:
            if any(a < g and c >= f for f, g in spans):
                continue
            bounds[mid] = ("dissolve", t[c] - t[a])
            spans.append((a, c))
            found["dissolve"] += 1
        fixed = sorted(bounds)
        last = t[0]
        for j in range(1, n):
            if j in bounds:
                last = t[j]
            elif raw[j] and not any(f <= j <= g for f, g in spans):
                nxt = next((b for b in fixed if b > j), n)
                if t[j] - last >= p["cut_min_scene_ms"] and tt(nxt) - t[j] >= p["cut_min_scene_ms"]:
                    bounds[j] = ("cut", 0)
                    last = t[j]
        edges = sorted(b for b in bounds if 0 < b < n)
        firsts = {f for f, _ in blanks}
        sc = [{"a": a, "b": b, "kind": "blank" if a in firsts else None} for a, b in zip([0, *edges], [*edges, n])]
        if p["cut_blank"]:
            self._stills(sc, tt, found)
        out = []
        for s in sc:
            tin = bounds.get(s["a"], ("cut", 0)) if s["a"] else None
            tout = bounds.get(s["b"], ("cut", 0)) if s["b"] < n else None
            tr = {"in": tin and tin[0], "out": tout and tout[0]}
            if tin and tin[1]:
                tr["in_ms"] = int(tin[1])
            if tout and tout[1]:
                tr["out_ms"] = int(tout[1])
            out.append({"start_ms": int(t[s["a"]]) if s["a"] else start_ms,
                        "end_ms": int(t[s["b"]]) if s["b"] < n else end_ms, "kind": s["kind"], "transition": tr})
        return out

    def _stills(self, sc, tt, found):
        """Mark / split off still runs in the scene list sc ([{a, b, kind}], frame indices), in place."""
        n, ms = len(self.t), self.p["cut_min_scene_ms"]
        j = 1
        while j < n:
            if not self.held[j] or self._blank(j):
                j += 1
                continue
            e = j
            while e < n and self.held[e] and not self._blank(e):
                e += 1
            r0, r1, j = j - 1, e, e  # frames r0 .. e-1 show one picture
            if tt(r1) - tt(r0) < STILL_MS:
                continue
            found["still"] += 1
            k = next(k for k, s in enumerate(sc) if s["a"] <= r0 < s["b"])
            s = sc[k]
            a, b = s["a"], s["b"]
            lo, hi = max(a, r0), min(b, r1)
            if s["kind"] or tt(hi) - tt(lo) < STILL_MS:
                continue
            if tt(hi) - tt(lo) >= 0.9 * (tt(b) - tt(a)):
                s["kind"] = "still"
            elif tt(lo) - tt(a) <= 100 and tt(b) - tt(hi) >= ms:
                sc[k:k + 1] = [{"a": a, "b": hi, "kind": "still"}, {"a": hi, "b": b, "kind": None}]
            elif tt(b) - tt(hi) <= 100 and tt(lo) - tt(a) >= ms:
                sc[k:k + 1] = [{"a": a, "b": lo, "kind": None}, {"a": lo, "b": b, "kind": "still"}]
