"""dev/sample/make_sample.py -- the sample clip (paw-ys3x): an abstract, generated, SFW animation that still exercises the
real pipeline. Two flat-coloured bodies in the app's palette: a blue one with an amber capsule, a pink one with a green
ring the capsule slides into; bobbles on stalks sway behind the motion (distractors for fusion). Three shots split by hard
cuts (wide with a slow zoom, a close-up, a tilted medium shot); a periodic stroke with changing tempo and depth, a pause,
a build-up and one peak (a deep hold with a burst of sparks at an exact frame).

    python -I dev/sample/make_sample.py <out.mp4> [--truth <truth.json>] [--frames N] [--truth-only]

(--truth-only: rewrite truth.json for an existing clip, no rendering; a full render takes ~20 min on 4 processes.)

Deterministic: every frame is a pure function of its time (fixed seed for the textures), so the build reproduces it.
Needs numpy and ffmpeg on PATH (the sidecar's Python has numpy). Writes the TRUE stroke beside it (truth.json: the turns,
pos 0 = deepest, 100 = fully out, the cuts, the pause, the peak frame) for test/sample-project.test.mjs.
Clip and truth: CC0 (sample/README.md).
"""
import hashlib, json, math, os, subprocess, sys
import numpy as np

W, H, FPS, DUR_S = 1280, 720, 30, 36
N = FPS * DUR_S
SUB = 3                 # motion-blur subframes per frame, over half a frame (a 180 degree shutter)
CUTS = [390, 750]       # first frame of shots 2 and 3 (13.0 s, 25.0 s)
SEED = 20261118

# ---- the app's palette (src/ui/kit/theme.css, dark)
def hexc(h): return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float32) / 255
BLUE, PINK, AMBER, GREEN = hexc('#4DA6FF'), hexc('#FF5CB3'), hexc('#F5B94D'), hexc('#3DD68C')
INK, BG0, BG1 = hexc('#ECEFF4'), hexc('#161B26'), hexc('#07080B')

# ---- the true stroke: turns (frame, pos) with a cosine ease between them -------------------------------------------
def schedule():
    """[(t_s, pos)] turns. Half-period and depth change over time; a pause (a hold out) and a peak (a hold deep)."""
    turns, t, out = [(0.0, 100.0)], 0.6, False
    turns.append((t, 100.0))
    def seg(t1, half, lo, hi):   # alternate in / out until t1; half(t), lo(t), hi(t) -> seconds, deep pos, out pos
        nonlocal t, out
        while t + half(t) <= t1 + 1e-9:
            t += half(t)
            turns.append((round(t, 4), round(hi(t) if out else lo(t), 2)))
            out = not out
    lerp = lambda a, b, t0, t1: (lambda t: a + (b - a) * min(1, max(0, (t - t0) / (t1 - t0))))
    # shot 1, wide: warming up, slow and shallow to fuller
    seg(13.0, lerp(0.80, 0.60, 0, 13), lerp(35, 12, 0, 13), lerp(78, 90, 0, 13))
    # shot 2, close: steady, then a pause (held out), then the build-up (faster, deeper)
    seg(16.9, lambda t: 0.5, lambda t: 15, lambda t: 85)
    if out: t += 0.5; turns.append((round(t, 4), 85.0)); out = False
    turns.append((round(t + 1.6, 4), turns[-1][1])); t += 1.6                      # the pause
    seg(29.2, lerp(0.50, 0.26, 18.5, 29), lerp(15, 2, 18.5, 29), lerp(85, 98, 18.5, 29))
    # the peak: in, held deep 1.2 s (the burst at its start), then slow and shallow, at rest out by the end
    if out: t += 0.26; turns.append((round(t, 4), 98.0)); out = False
    t += 0.3; turns.append((round(t, 4), 0.0)); peak = t
    t += 1.2; turns.append((round(t, 4), 0.0)); out = True
    seg(34.6, lambda t: 0.75, lambda t: 40, lambda t: 70)
    if not out: t += 0.75; turns.append((round(t, 4), 40.0))
    t += 0.9; turns.append((round(t, 4), 100.0))
    turns.append((DUR_S, 100.0))
    pause = next((a, b) for (a, pa), (b, pb) in zip(turns, turns[1:]) if b - a > 1.5 and pa == pb and pa > 50)
    return turns, peak, pause

TURNS, PEAK_S, PAUSE = schedule()
PEAK_F = round(PEAK_S * FPS)
TT = np.array([x[0] for x in TURNS]); PP = np.array([x[1] for x in TURNS])

def pos_at(t):
    i = int(np.clip(np.searchsorted(TT, t, 'right') - 1, 0, len(TT) - 2))
    a, b = TT[i], TT[i + 1]
    u = 0 if b <= a else min(1, max(0, (t - a) / (b - a)))
    return PP[i] + (PP[i + 1] - PP[i]) * (0.5 - 0.5 * math.cos(math.pi * u))

# ---- the bodies in stage coordinates (a 1280 x 720 world; the camera frames it per shot) --------------------------
TRAVEL = 230.0          # world px between fully out and deepest

def rig(t):
    s = pos_at(t) / 100                     # 1 out, 0 deep
    c = TRAVEL * (1 - s)
    top = np.array([300 + 0.62 * c, 410 + 6 * math.sin(t * 1.3)])
    bot = np.array([985 - 0.38 * c, 400 + 5 * math.sin(t * 1.1 + 1)])
    return s, top, bot

# bobbles: damped springs driven by their body's acceleration (pre-simulated on a fine clock, so deterministic)
def simulate():
    dt, k, d = 1 / 600, 90.0, 3.2
    n = int(DUR_S / dt) + 2
    out = np.zeros((n, 4))
    ang = np.zeros(4); vel = np.zeros(4)
    prev = None; pv = None
    for i in range(n):
        _, top, bot = rig(i * dt)
        x = np.array([top[0], top[0], bot[0], bot[0]])
        v = None if prev is None else (x - prev) / dt
        a = np.zeros(4) if v is None or pv is None else (v - pv) / dt
        acc = -k * ang - d * vel - a * 0.0009 * np.array([1, 1.3, 1, 1.25])
        vel += acc * dt; ang += vel * dt
        out[i] = ang; prev, pv = x, v
    return out, dt
BOB, BOB_DT = simulate()
bob_at = lambda t: BOB[min(len(BOB) - 1, int(round(t / BOB_DT)))]

# ---- cameras: (centre x, y, zoom, rotation deg) per shot; shot 1 zooms slowly
def camera(t):
    f = t * FPS
    if f < CUTS[0]:
        u = f / CUTS[0]; u = u * u * (3 - 2 * u)
        return 640 + 20 * u, 380, 1.0 + 0.22 * u, 0.0
    if f < CUTS[1]:
        return 700, 400, 1.95, 0.0
    return 655, 395, 1.32, -9.0

# ---- procedural texture: jittered dots in a body's own coordinates (a point tracker needs something to hold on to)
def h2(ix, iy, k):
    n = (ix * 374761393 + iy * 668265263 + k * 2147483647 + SEED) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0

def dots(u, v, sp, rmin, rmax, k):
    ix, iy = np.floor(u / sp).astype(np.int64), np.floor(v / sp).astype(np.int64)
    best = np.full(u.shape, 9.0, np.float32); tone = np.zeros(u.shape, np.float32)
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            cx, cy = ix + ox, iy + oy
            px = (cx + 0.15 + 0.7 * h2(cx, cy, k)) * sp; py = (cy + 0.15 + 0.7 * h2(cx, cy, k + 1)) * sp
            r = rmin + (rmax - rmin) * h2(cx, cy, k + 2)
            dd = (np.hypot(u - px, v - py) / r).astype(np.float32)
            m = dd < best; best = np.where(m, dd, best); tone = np.where(m, h2(cx, cy, k + 3), tone).astype(np.float32)
    return best, tone   # best < 1 inside a dot

def sstep(e0, e1, x): x = np.clip((x - e0) / (e1 - e0), 0, 1); return x * x * (3 - 2 * x)

def over(img, col, a):
    a = a[..., None]; img *= 1 - a; img += a * col
    return img

def textured(base, u, v, k, sp=24, rmin=3.0, rmax=6.5):
    d, tone = dots(u, v, sp, rmin, rmax, k)
    inside = 1 - sstep(0.85, 1.0, d)
    light = np.where(tone > 0.5, 1.0, 0.0)[..., None]
    col = base[None, None] * (1 - inside[..., None] * 0.42) + inside[..., None] * light * (np.ones(3) - base) * 0.75
    return col.astype(np.float32)

# ---- one image at time t ----------------------------------------------------------------------------------------
YS, XS = np.mgrid[0:H, 0:W].astype(np.float32)

VIGNETTE = (1 - 0.35 * sstep(0.55, 1.25, np.hypot((XS - W / 2) / (W / 2), (YS - H / 2) / (H / 2))))[..., None]
BACKDROP = [(180, 140, 120, BLUE, .07), (1080, 120, 160, PINK, .06), (640, 90, 70, GREEN, .05),
            (1180, 560, 110, BLUE, .05), (90, 600, 140, PINK, .05), (820, 640, 90, AMBER, .04)]

def render(t):
    cx, cy, z, rot = camera(t)
    r = math.radians(rot); cr, sr = math.cos(r), math.sin(r)
    dx, dy = (XS - W / 2) / z, (YS - H / 2) / z
    WX, WY = cx + cr * dx + sr * dy, cy - sr * dx + cr * dy    # world coordinates of every pixel
    px = 1.0 / z                                                # one screen pixel in world units (antialiasing)
    s, top, bot = rig(t)
    ang = bob_at(t)
    img = np.empty((H, W, 3), np.float32)
    g = np.clip((WY - 40) / 700, 0, 1)[..., None]
    img[:] = BG0 * (1 - g) + BG1 * g

    def crop(x0, y0, x1, y1):
        """The screen rectangle covering a world box: (slice, X, Y, image view); None when off screen."""
        pts = np.array([[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) - [cx, cy]
        sx = (cr * pts[:, 0] - sr * pts[:, 1]) * z + W / 2; sy = (sr * pts[:, 0] + cr * pts[:, 1]) * z + H / 2
        a, b = max(0, int(sx.min()) - 2), min(W, int(sx.max()) + 3)
        c, d = max(0, int(sy.min()) - 2), min(H, int(sy.max()) + 3)
        if a >= b or c >= d: return None
        sl = (slice(c, d), slice(a, b))
        return WX[sl], WY[sl], img[sl]

    def paint(box, fn):
        c = crop(*box)
        if c is not None: fn(*c)

    # soft background discs (world-fixed: the zoom and the cuts move them)
    for (bx, by, br, col, a) in BACKDROP:
        paint((bx - br, by - br, bx + br, by + br), lambda X, Y, im: over(im, col, a * (1 - sstep(0.55, 1.0, np.hypot(X - bx, Y - by) / br))))
    # floor shadows
    for (sx, sw) in ((top[0], 210), (bot[0], 240)):
        paint((sx - sw, 560, sx + sw, 620), lambda X, Y, im: over(im, np.zeros(3), 0.35 * (1 - sstep(0.2, 1.0, np.hypot((X - sx) / sw, (Y - 590) / 26)))))
    # stalks + bobbles (behind the bodies)
    def bobble(base, length, a, col, rad, k):
        tip = base + length * np.array([math.sin(a), -math.cos(a)])
        ax, ay = tip - base
        def fn(X, Y, im):
            tt = np.clip(((X - base[0]) * ax + (Y - base[1]) * ay) / (ax * ax + ay * ay), 0, 1)
            dl = np.hypot(X - base[0] - tt * ax, Y - base[1] - tt * ay)
            over(im, INK * 0.55, 1 - sstep(4 - px, 4 + px, dl))
            m = (1 - sstep(rad - px, rad + px, np.hypot(X - tip[0], Y - tip[1])))[..., None]
            im[:] = im * (1 - m) + m * textured(col, X - tip[0], Y - tip[1], k, 11, 2.0, 3.5)
        paint((min(base[0], tip[0]) - rad - 4, min(base[1], tip[1]) - rad - 4, max(base[0], tip[0]) + rad + 4, max(base[1], tip[1]) + rad + 4), fn)
    bobble(top + [-60, -120], 95, ang[0] - 0.25, GREEN, 21, 11)
    bobble(top + [10, -135], 80, ang[1] + 0.15, PINK, 17, 13)
    bobble(bot + [40, -150], 100, ang[2] + 0.2, AMBER, 22, 15)
    bobble(bot + [120, -120], 78, ang[3] + 0.4, BLUE, 16, 17)
    # the capsule (amber, carried by the blue body; behind the pink body and the ring's front)
    c0, L, R = top + [110, -10], 330.0, 36.0
    cbox = (c0[0] - R - 2, c0[1] - R - 2, c0[0] + L + R + 2, c0[1] + R + 2)
    def capsule(X, Y):
        u = np.clip(X - c0[0], 0, L)
        m = 1 - sstep(-px, px, np.hypot(X - c0[0] - u, Y - c0[1]) - R)
        shade = (0.82 + 0.18 * np.clip(1 - (Y - c0[1] + R) / (2 * R), 0, 1))[..., None]
        return m, textured(AMBER, X - c0[0], Y - c0[1], 3, 20, 2.6, 5.0) * shade
    def draw_capsule(X, Y, im):
        m, col = capsule(X, Y); m = m[..., None]; im[:] = im * (1 - m) + m * col
    paint(cbox, draw_capsule)
    def ellipse(cen, rx, ry, col, k):
        def fn(X, Y, im):
            e = np.hypot((X - cen[0]) / rx, (Y - cen[1]) / ry)
            m = (1 - sstep(1 - px / ry, 1 + px / ry, e))[..., None]
            sh = (0.78 + 0.3 * np.clip(1 - np.hypot((X - cen[0] + rx * .35) / rx, (Y - cen[1] + ry * .4) / ry), 0, 1))[..., None]
            im[:] = im * (1 - m) + m * textured(col, X - cen[0], Y - cen[1], k) * sh
        paint((cen[0] - rx - 3, cen[1] - ry - 3, cen[0] + rx + 3, cen[1] + ry + 3), fn)
    ellipse(top, 175, 150, BLUE, 1)
    # the ring's back half, the pink body, the capsule seen through the ring's mouth, the ring's front half
    flash = math.exp(-(t - PEAK_S) * 3.0) if t >= PEAK_S else 0.0
    rc = bot + [-205, -12]
    rbox = (rc[0] - 40, rc[1] - 68, rc[0] + 40, rc[1] + 68)
    def ring(front):
        def fn(X, Y, im):
            e = np.hypot((X - rc[0]) / 34, (Y - rc[1]) / 62)
            band = (1 - sstep(1.0 - px / 40, 1.0 + px / 40, e)) * sstep(0.62 - px / 40, 0.62 + px / 40, e)
            side = sstep(-px, px, X - rc[0]) if front else 1 - sstep(-px, px, X - rc[0])
            a = (band * side)[..., None]
            col = np.clip(GREEN * (1 + 0.35 * flash), 0, 1) if front else GREEN * 0.6
            im[:] = im * (1 - a) + a * textured(col, X - rc[0], Y - rc[1], 7, 12, 1.8, 3.2)
        paint(rbox, fn)
    ring(False)
    ellipse(bot, 215, 175, np.clip(PINK * (1 + 0.25 * flash), 0, 1), 5)
    def through(X, Y, im):
        m, col = capsule(X, Y)
        mouth = 1 - sstep(0.62 - px / 40, 0.62 + px / 40, np.hypot((X - rc[0]) / 34, (Y - rc[1]) / 62))
        mm = (m * mouth)[..., None]
        im[:] = im * (1 - mm) + mm * col * (0.85 - 0.25 * sstep(-20, 20, X - rc[0]))[..., None]
    paint(rbox, through)
    ring(True)
    # the peak: a burst of sparks from the ring's mouth
    if PEAK_S <= t < PEAK_S + 1.4:
        a = t - PEAK_S
        for i in range(14):
            th = 2 * math.pi * (i / 14 + 0.031 * h2(i, 3, 99)); sp = 260 + 140 * h2(i, 5, 99)
            q = rc + np.array([math.cos(th), math.sin(th)]) * sp * (1 - math.exp(-a * 2.6)) + [0, 40 * a * a]
            paint((q[0] - 12, q[1] - 12, q[0] + 12, q[1] + 12), lambda X, Y, im: over(im, np.clip(AMBER * 1.2, 0, 1), (1 - a / 1.4) * (1 - sstep(5 - px, 9 + px, np.hypot(X - q[0], Y - q[1])))))
    return img * VIGNETTE

def seed_strokes(f):
    """Brush strokes that paint each body part on frame f, as a person would with the Groups brush: {part: {who, radius
    (frame heights), strokes: [[[nx, ny], ...], ...]}} in 0..1 screen coordinates (dev/sample/build-project.mjs paints them)."""
    t = f / FPS
    cx, cy, z, rot = camera(t); r = math.radians(rot); cr, sr = math.cos(r), math.sin(r)
    def scr(x, y):
        return [round(min(1, max(0, ((cr * (x - cx) - sr * (y - cy)) * z + W / 2) / W)), 4),
                round(min(1, max(0, ((sr * (x - cx) + cr * (y - cy)) * z + H / 2) / H)), 4)]
    _, top, bot = rig(t)
    def fill(cen, rx, ry, rw):
        rows, out = max(2, int(2 * (ry - rw) / (1.3 * rw)) + 1), []
        for k in range(rows):
            dy = -(ry - rw) + 2 * (ry - rw) * k / (rows - 1)
            hw = rx * math.sqrt(max(0, 1 - (dy / ry) ** 2)) - rw
            if hw > 0: out.append([scr(cen[0] + hw * u, cen[1] + dy) for u in (-1, -0.5, 0, 0.5, 1)])
        return out
    rc = bot + [-205, -12]; c0 = top + [110, -10]
    tip = min(c0[0] + 330 + 36 - 14, rc[0] - 10)
    hips_r = 48
    return {
        'c2_hips': {'who': 'c2', 'part': 'hips', 'radius': round(hips_r * z / H, 4), 'strokes': fill(top, 175, 150, hips_r)},
        'c1_hips': {'who': 'c1', 'part': 'hips', 'radius': round(hips_r * z / H, 4), 'strokes': fill(bot, 215, 175, hips_r)},
        'c2_penis': {'who': 'c2', 'part': 'penis', 'radius': round(30 * z / H, 4), 'strokes': [[scr(x, c0[1]) for x in np.linspace(top[0] + 168, tip, 6)]]},
    }

def frame(i):
    acc = np.zeros((H, W, 3), np.float32)
    for k in range(SUB):
        acc += render((i + (k / SUB - 0.25) * 0.5) / FPS)
    return np.clip(acc / SUB * 255 + 0.5, 0, 255).astype(np.uint8).tobytes()

def below_normal():
    try:
        import ctypes; ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x4000)
    except Exception: pass

def main():
    args = sys.argv[1:]
    if not args: sys.exit(__doc__)
    out = args[0]
    truth = args[args.index('--truth') + 1] if '--truth' in args else os.path.join(os.path.dirname(out) or '.', 'truth.json')
    n = int(args[args.index('--frames') + 1]) if '--frames' in args else N
    below_normal()
    if '--truth-only' not in args: encode(out, n)
    write_truth(out, truth, n)

def encode(out, n):
    ff = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                           '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-tune', 'animation', '-pix_fmt', 'yuv420p', '-g', '60',
                           '-threads', '4', '-movflags', '+faststart', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact',
                           '-metadata', 'title=Pawscript sample (CC0)', out + '.part.mp4'], stdin=subprocess.PIPE)
    from multiprocessing import Pool
    with Pool(4, initializer=below_normal) as pool:
        for i, b in enumerate(pool.imap(frame, range(n), chunksize=4)):
            ff.stdin.write(b)
            if i % 60 == 0: print(f'frame {i}/{n}', file=sys.stderr, flush=True)
    ff.stdin.close()
    if ff.wait(): sys.exit('ffmpeg failed')
    os.replace(out + '.part.mp4', out)

def write_truth(out, truth, n):
    sha = hashlib.sha256(open(out, 'rb').read()).hexdigest()
    ft = [[round(t * FPS), p] for t, p in TURNS if t * FPS < n]
    seeds = [f for f in (30, CUTS[0] + 12, CUTS[1] + 12) if f < n]
    json.dump({
        'what': 'The true stroke of the Pawscript sample clip (dev/sample/make_sample.py). pos 0 = deepest, 100 = fully out. CC0.',
        'fps': FPS, 'frames': n, 'width': W, 'height': H, 'sha256': sha, 'bytes': os.path.getsize(out),
        'cuts': [c for c in CUTS if c < n], 'pause': [round(PAUSE[0] * FPS), round(PAUSE[1] * FPS)], 'peak': PEAK_F,
        'turns': [[round(t * 1000), p] for t, p in TURNS if t * FPS < n],
        'turnFrames': ft,
        'seeds': [{'frame': f, 'groups': seed_strokes(f)} for f in seeds],
        'pos': [round(pos_at(i / FPS), 1) for i in range(n)],
    }, open(truth, 'w'), indent=None, separators=(',', ':'))
    print(f'{out}: {n} frames, {os.path.getsize(out) / 1e6:.2f} MB, sha256 {sha[:12]}; peak frame {PEAK_F}; {len(TURNS)} turns', file=sys.stderr)

if __name__ == '__main__':
    main()
