// fake-pawtrack.mjs -- a stand-in for `uv run ... pawtrack`: protocol v3 (trackers/PROTOCOL.md), synthetic data.
// Use: PAWTRACK_CMD="node test/fake-pawtrack.mjs" (see src-tauri/src/lib.rs). Knobs via env:
//   FAKE_DURATION_MS / FAKE_FPS (default: ffprobe of the video, else 30000 / 25)   FAKE_DELAY_MS per frame (default 4)
//   FAKE_FAIL=1       track ends with an error line + exit 1 after 30 frames
// fake.mask mimics sam2_mask: box_or_points, channels, confidence, mask polygons, frames in bursts of 30.
// Cuts: every 5 s the first frame has value null (like a scene cut).
// fake.groups (paw-o74b) mimics the points trackers with painted groups (sem_groups; paw-2pcf: c1_hips sways and turns): a 4-point grid + 3 pinned points per
// group, each group's centre / camera channels, scenes[].groups ids; v4.45 groups_only: the groups' points only, "lost"
// 1.5 s either side of the seed (frames beyond not sent). FAKE_REQ_LOG=<file>: every track request's gist appended as a line.
// FAKE_NAME_MS: name_groups answers after this long (paw-wzxu: a slow naming call in front of a SAM prompt).
// FAKE_LIST_MS: the tracker list answers after this long (paw-ws19: the real sidecar's list takes seconds after start).

import { spawnSync } from 'node:child_process';
import * as nfs from 'node:fs';
import { basename } from 'node:path';

const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const P = (key, label, type, def, min = null, max = null, choices = null) => ({ key, label, type, default: def, min, max, choices });

const own = [
  P('freq', 'Frequency (Hz)', 'float', 1.5, 0.2, 6),
  P('noise', 'Noise', 'float', 0.05, 0, 0.5),
  P('shape', 'Shape', 'choice', 'sine', null, null, ['sine', 'saw', 'square']),
  P('invert', 'Invert', 'bool', false),
];
const shared = [
  P('pipe_invert', 'Invert direction', 'bool', false),
  P('pipe_gate', 'Activity gate', 'choice', 'motion', null, null, ['off', 'motion']),
  P('pipe_gate_motion', 'Gate motion threshold', 'float', 4.0, 0, 50),
  P('pipe_norm_window_ms', 'Norm window (ms)', 'int', 3000, 0, 20000),
  P('pipe_min_gap_ms', 'Min point gap (ms)', 'int', 120, 20, 1000),
  P('pipe_smooth_ms', 'Smoothing window (ms)', 'int', 100, 0, 2000),
  P('cut_enabled', 'Detect cuts', 'bool', true),
  P('held_retime', 'Held-frame retime', 'choice', 'auto', null, null, ['off', 'auto', 'on']),
  P('loop_fold', 'Loop fold', 'choice', 'off', null, null, ['off', 'auto', 'on']),
  P('loop_min_confidence', 'Loop min confidence', 'float', 0.5, 0, 1),
];
const CH = ['centroid_y', 'area'];
const trackers = [
  { id: 'fake.box', name: 'Fake box oscillator', roi: 'box', channels: [], params: [...own, ...shared] },
  { id: 'fake.points', name: 'Fake point follower', roi: 'points', channels: [], params: [...own.slice(0, 2), ...shared] },
  { id: 'fake.mask', name: 'Fake mask (box or clicks)', roi: 'box_or_points', channels: CH, params: [...own, ...shared] },
  { id: 'fake.none', name: 'Fake whole-frame', roi: 'none', channels: [], params: shared },
  // v4.39: sam2_mask on painted groups (a modifier's own run): each group's polygon slides and breathes; with a penis and
  // another group the shaft's inside fraction (one push in and out over the range); the groups / fixes received are echoed
  { id: 'fake.groups', name: 'Fake points (painted groups)', roi: 'box', channels: [], params: [P('sem_groups', 'Pin painted groups', 'bool', true), P('group_points', 'Points per group (0 = auto: 16+, more for bigger parts)', 'int', 0, 0, 256), ...shared] },
  { id: 'sam2_mask', name: 'SAM 2.1 mask (fake: painted parts)', roi: 'box_or_points', channels: [], params: [P('model', 'Model size', 'choice', 'small', null, null, ['tiny', 'small', 'base_plus', 'large']), ...shared] },
];
const sceneParams = [P('scene_len_s', 'Mean scene length (s)', 'float', 5, 1, 60)];
const loopParams = [shared.find((p) => p.key === 'loop_min_confidence')];
const describeParams = [P('min_score', 'Min tag score', 'float', 0.3, 0, 1), P('top_k', 'Tags kept', 'int', 12, 1, 50)];

let media = { duration_ms: 30000, fps: 25, is_vfr: false, width: 640, height: 360, frame_count: 750 };
function probe(video) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=avg_frame_rate,width,height:format=duration', '-of', 'json', video], { encoding: 'utf8' });
  try {
    const j = JSON.parse(r.stdout), [n, d] = j.streams[0].avg_frame_rate.split('/').map(Number);
    const dur = Math.round(parseFloat(j.format.duration) * 1000), fps = Math.round((n / d) * 1000) / 1000;
    media = { duration_ms: dur, fps, is_vfr: false, width: j.streams[0].width, height: j.streams[0].height, frame_count: Math.round((dur / 1000) * fps) };
  } catch { /* keep defaults */ }
  if (process.env.FAKE_DURATION_MS) media.duration_ms = +process.env.FAKE_DURATION_MS;
  if (process.env.FAKE_FPS) media.fps = +process.env.FAKE_FPS;
  return media;
}

const wave = (shape, ph) => {
  const f = ph - Math.floor(ph);
  return shape === 'saw' ? f : shape === 'square' ? (f < 0.5 ? 1 : 0) : 0.5 - 0.5 * Math.cos(2 * Math.PI * f);
};
const circle = (cx, cy, r) => Array.from({ length: 12 }, (_, i) => [+(cx + r * Math.cos((i / 12) * 6.2832)).toFixed(4), +(cy + r * Math.sin((i / 12) * 6.2832)).toFixed(4)]);

async function trackPainted(req) {
  const gs = req.groups.filter((g) => g.pinned !== false && g.poly?.length >= 3), frameMs = 1000 / media.fps, n = Math.max(1, Math.floor((req.end_ms - req.start_ms) / frameMs));
  const name = (g) => [g.who, g.part, g.side].filter(Boolean).join('_') || g.name, shaft = gs.find((g) => g.part === 'penis'), other = gs.find((g) => g !== shaft);
  const samples = [], channels = {}, confidence = [], put = (k, tm, v) => (channels[k] ||= []).push([tm, v == null ? null : +v.toFixed(5)]);
  for (let i = 0; i <= n; i++) {
    const tm = Math.round(req.start_ms + i * frameMs), u = i / n, push = Math.sin(Math.PI * u), masks = [], of = [];
    gs.forEach((g, k) => {
      const dx = g === shaft ? 0.06 * push : 0, sc = g === shaft ? 1 - 0.5 * push : 1;
      const cx = g.poly.reduce((a, q) => a + q[0], 0) / g.poly.length, cy = g.poly.reduce((a, q) => a + q[1], 0) / g.poly.length;
      masks.push(g.poly.map(([x, y]) => [+(cx + dx + (x - cx) * sc).toFixed(4), +(cy + (y - cy) * sc).toFixed(4)])); of.push(k);
      put(`sem_${name(g)}_area`, tm, 0.01 * sc * sc); put(`sem_${name(g)}_vis`, tm, sc * sc); put(`sem_${name(g)}_x`, tm, cx + dx); put(`sem_${name(g)}_y`, tm, cy); put(`sem_${name(g)}_conf`, tm, 0.95);
    });
    if (shaft && other) { put(`sem_${name(shaft)}_in`, tm, push); put(`sem_${name(shaft)}_in_conf`, tm, u < 0.1 ? 0.3 : 0.9); put(`sem_${name(shaft)}_len`, tm, 1 - push); }
    out({ type: 'frame', t_ms: tm, value: 1 - 0.5 * push, overlay: { points: [], boxes: [], masks, mask_of: of } });
    samples.push([tm, +(1 - 0.5 * push).toFixed(4)]); confidence.push([tm, 0.95]);
    if (i % 10 === 0) out({ type: 'progress', done: i, total: n });
    if (i % 30 === 29) await sleep(60);
  }
  const shaftRec = shaft && other ? { [name(shaft)]: { source: 'sam', from: 'mask', full: 'seen', l_full_w: 6, conf_share: 0.9, edge_share: 0.1 } } : null;
  out({ type: 'result', samples, points: [{ at: req.start_ms, pos: 100 }, { at: Math.round((req.start_ms + req.end_ms) / 2), pos: 50 }, { at: req.end_ms - 1, pos: 100 }], events: [], media,
    scenes: [{ start_ms: req.start_ms, end_ms: req.end_ms, sign: 1, ...(shaftRec ? { shaft: shaftRec } : {}) }], channels, confidence,
    notes: [{ code: 'fake_groups', message: JSON.stringify(gs.map((g) => ({ name: name(g), t_ms: g.t_ms, fixes: (g.fixes || []).map((f) => f.t_ms) }))), data: { seed: req.roi?.t_ms } }] });
}

// paw-o74b: a points tracker with painted groups (see the header); names as pawtrack/cli.py parse_groups, ids 4, 5, ...
async function trackGrouped(req) {
  const frameMs = 1000 / media.fps, clean = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''), seen = new Set();
  const named = (req.groups || []).filter((g) => g.pinned !== false && g.poly?.length >= 3).map((g, k) => {
    const base = g.who || g.part ? [g.who, clean(g.part) || clean(g.name) || 'other', g.side].filter(Boolean).join('_') : clean(g.name) || 'other';
    let name = base, j = 2;
    while (seen.has(name)) name = base + j++;
    seen.add(name);
    const c = [g.poly.reduce((a, q) => a + q[0], 0) / g.poly.length, g.poly.reduce((a, q) => a + q[1], 0) / g.poly.length];
    // paw-9qim: the 3 points half way from the centre to 3 of its vertices (inside the painting, as a real seeding inset leaves them)
    return { name, id: 4 + k, t_ms: g.t_ms, c, shaft: g.shaft === true, depth: g.depth === true && g.shaft !== true, off: [0, 1, 2].map((j) => g.poly[Math.floor((j * g.poly.length) / 3)]).map(([x, y]) => [0.5 * (x - c[0]), 0.5 * (y - c[1])]) };
  });
  const only = !!req.groups_only, seed = req.roi?.t_ms ?? req.start_ms;
  // paw-4c48: a shaft group (v4.17 `shaft`) with a receiving part of the other character gets the shaft pass's channels, a
  // known story (s = seconds into the range): out and free to 1 s (the Top's base 0.15 frame widths back), goes in (went in
  // at 1 s), down to 20 % visible at 3 s (knot in at ~2.77 s: knot at 35 % +- 5 % of the length), hidden (no reading, the
  // body tracked) 3-4.5 s, back up (knot out at ~4.88 s), fully out at 6 s and pulled back (pulled out at 6 s), off frame
  // 7-7.5 s. The receiving part stays where the fake puts it; the base moves (bx = entry - 0.3 x visible).
  const sh = !only && named.find((g) => g.shaft), whoOf = (g) => /^(c[12]|x)_/.exec(g.name)?.[1];
  const recv = sh && named.find((g) => g !== sh && whoOf(g) !== whoOf(sh) && /^(c[12]|x)_(anus|slit|hips|torso)/.test(g.name));
  // paw-4c48.19 (v4.52): a group with `depth` (a part the owner turned on) gets the same pass's channels, its own story (strokes,
  // 1.2 s, 25..85 % visible), along its own axis (-140 deg: from the other side of the same receiver), record role 'part'
  const dps = only ? [] : named.filter((g) => g.depth), drecv = (g) => named.find((o) => o !== g && whoOf(o) !== whoOf(g) && /^(c[12]|x)_(anus|slit|hips|torso)/.test(o.name));
  const PART_RAD = (-140 * Math.PI) / 180, partStory = (s) => 0.55 + 0.3 * Math.cos((2 * Math.PI * s) / 1.2);
  const SHAFT_RAD = (-40 * Math.PI) / 180;   // paw-4c48.7: the shaft's axis (square units), not along the frame's x
  const story = process.env.FAKE_SHAFT_STORY === 'strokes'   // paw-4c48.10 (dev/shaft-source-check.mjs): strokes, 0.9 s, 20..90 % visible, held 3-3.6 s
    ? (s) => (s >= 3 && s < 3.6 ? NaN : 0.55 + 0.35 * Math.cos((2 * Math.PI * s) / 0.9))
    : (s) => (s < 1 ? 1 : s < 2 ? 1 - 0.5 * (s - 1) : s < 3 ? 0.5 - 0.3 * (s - 2) : s < 4.5 ? NaN : s < 5 ? 0.2 + 0.6 * (s - 4.5) : s < 6 ? 0.5 + 0.5 * (s - 5) : s >= 7 && s < 7.5 ? NaN : 1);
  if (only && !named.length) { out({ type: 'error', message: 'ValueError: groups_only needs groups' }); process.exit(1); }
  if (process.env.FAKE_REQ_LOG) nfs.appendFileSync(process.env.FAKE_REQ_LOG, JSON.stringify({ tracker: req.tracker, start_ms: req.start_ms, end_ms: req.end_ms, groups_only: only, seed, groups: named.map((x) => ({ name: x.name, t_ms: x.t_ms })), cuts: req.cuts }) + '\n');
  const lo = only ? Math.max(req.start_ms, seed - 1500) : req.start_ms, hi = only ? Math.min(req.end_ms, seed + 1500) : req.end_ms;
  const samples = [], channels = {}, confidence = [], put = (k, tm, v) => (channels[k] ||= []).push([tm, v == null ? null : +v.toFixed(6)]);
  const n = Math.max(1, Math.floor((req.end_ms - req.start_ms) / frameMs));
  let first = null, last = null, sent = 0;
  for (let i = 0; i <= n; i++) {
    const tm = Math.round(req.start_ms + i * frameMs);
    if (tm < lo || tm >= hi) continue;
    first ??= tm; last = tm;
    const cam = [0.003 * Math.sin(tm / 900), 0], v = 0.5 + 0.5 * Math.sin((2 * Math.PI * tm) / 1000), pts = [];
    if (!only) for (const [x, y] of [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) pts.push([+(x + cam[0]).toFixed(4), y, 1, 0]);
    named.forEach((g, k) => {
      // paw-2pcf: the Bottom's hips also sway across the stroke and turn (1.3 s period, out of step with the 1 s stroke)
      // paw-o74b.1: the phase is the part's (its name), so a part seeded again in another call moves the same way
      const hips = g.name === 'c1_hips', w = Math.sin((2 * Math.PI * tm) / 1300), ph = [...g.name].reduce((a, c) => a + c.charCodeAt(0), 0) % 7;
      const img = [g.c[0] + cam[0] + (hips ? 0.012 * w : 0), g.c[1] + 0.03 * Math.sin((2 * Math.PI * tm) / 1000 + ph)];
      if (!(recv && g === sh) && !(g.depth && drecv(g))) for (const [dx, dy] of g.off) pts.push([+(img[0] + dx).toFixed(4), +(img[1] + dy).toFixed(4), 1, 1, 0, g.id]);   // the shaft's members: along it (below)
      if (hips) for (let q = pts.length - 3; q < pts.length; q++) { const a = 0.15 * w, x = pts[q][0] - img[0], y = pts[q][1] - img[1]; pts[q][0] = +(img[0] + Math.cos(a) * x - Math.sin(a) * y).toFixed(4); pts[q][1] = +(img[1] + Math.sin(a) * x + Math.cos(a) * y).toFixed(4); }
      put(`sem_${g.name}_x`, tm, img[0] - cam[0]); put(`sem_${g.name}_y`, tm, img[1] - cam[1]); put(`sem_${g.name}_n`, tm, 3 / Math.max(1, pts.length)); put(`sem_${g.name}_proj`, tm, 0.5 + 0.5 * Math.sin((2 * Math.PI * tm) / 1000 + ph));
      g.img = img;
    });
    if (recv) {
      // paw-4c48.7: the shaft is OBLIQUE (SHAFT_DEG in square units, up-right into the receiver), its 10 members lie along it
      // (hidden past the entry), and the stored channels glitch as the sidecar's did before the fix: every 6th frame the
      // SAM mask "leaks" and the entry swings 30 deg off the axis, the length over-read along it (its projection on the
      // axis is the true one). The app draws along the members; dev/shaft-strip-check.mjs asserts the painted capsule.
      const A = media.width / media.height, U = [Math.cos(SHAFT_RAD), Math.sin(SHAFT_RAD)], LF = 0.3 * A;
      const s = (tm - req.start_ms) / 1000, L = story(s), gap = (s < 1 || s >= 6 ? 0.15 : 0) * A, P = `sem_${sh.name}_`;
      const eSq = [recv.img[0] * A - gap * U[0], recv.img[1] - gap * U[1]], off = s >= 7 && s < 7.5;
      const bSq = off ? [1.2 * A, eSq[1]] : L === L ? [eSq[0] - L * LF * U[0], eSq[1] - L * LF * U[1]] : eSq;
      const glitch = i % 6 === 3 && L === L, gu = glitch ? [Math.cos(SHAFT_RAD - Math.PI / 6), Math.sin(SHAFT_RAD - Math.PI / 6)] : U, gl = glitch ? 1 / Math.cos(Math.PI / 6) : 1;
      const sx = [], sy = [];
      for (let q = 0; q < 10; q++) {   // the members: at 5 % .. 95 % of the full length from the base, two rows
        const f = 0.05 + 0.1 * q, a = q % 2 ? 0.012 : -0.012, x = (bSq[0] + f * LF * U[0] - a * U[1]) / A, y = bSq[1] + f * LF * U[1] + a * U[0], v = !off && L === L && f < L;
        pts.push([+x.toFixed(4), +y.toFixed(4), v ? 1 : 0, 1, 0, sh.id]);
        if (v) { sx.push(x); sy.push(y); }
      }
      if (sx.length) { channels[P + 'x'].at(-1)[1] = +(sx.reduce((p, q) => p + q, 0) / sx.length - cam[0]).toFixed(6); channels[P + 'y'].at(-1)[1] = +(sy.reduce((p, q) => p + q, 0) / sy.length).toFixed(6); }
      put(P + 'len', tm, L === L ? L * gl : null); put(P + 'in', tm, L === L ? Math.max(0, 1 - L * gl) : null); put(P + 'in_conf', tm, L === L ? 0.9 : 0); put(P + 'knot', tm, null);
      put(P + 'bx', tm, bSq[0] / A); put(P + 'by', tm, bSq[1]);
      put(P + 'ex', tm, L === L ? (bSq[0] + L * gl * LF * gu[0]) / A : null); put(P + 'ey', tm, L === L ? bSq[1] + L * gl * LF * gu[1] : null); put(P + 'w', tm, L === L ? 0.05 : null);
    }
    for (const dp of dps) {   // paw-4c48.19: the depth parts, the shaft block's geometry without its glitches
      const rv = drecv(dp);
      if (!rv) continue;
      const A = media.width / media.height, U = [Math.cos(PART_RAD), Math.sin(PART_RAD)], LF = 0.25 * A, s = (tm - req.start_ms) / 1000, L = partStory(s), P = `sem_${dp.name}_`;
      const eSq = [rv.img[0] * A, rv.img[1]], bSq = [eSq[0] - L * LF * U[0], eSq[1] - L * LF * U[1]], sx = [], sy = [];
      for (let q = 0; q < 10; q++) {
        const f = 0.05 + 0.1 * q, a = q % 2 ? 0.012 : -0.012, x = (bSq[0] + f * LF * U[0] - a * U[1]) / A, y = bSq[1] + f * LF * U[1] + a * U[0], v = f < L;
        pts.push([+x.toFixed(4), +y.toFixed(4), v ? 1 : 0, 1, 0, dp.id]);
        if (v) { sx.push(x); sy.push(y); }
      }
      if (sx.length) { channels[P + 'x'].at(-1)[1] = +(sx.reduce((p, q) => p + q, 0) / sx.length - cam[0]).toFixed(6); channels[P + 'y'].at(-1)[1] = +(sy.reduce((p, q) => p + q, 0) / sy.length).toFixed(6); }
      put(P + 'len', tm, L); put(P + 'in', tm, 1 - L); put(P + 'in_conf', tm, 0.9); put(P + 'knot', tm, null); put(P + 'why', tm, 0);
      put(P + 'bx', tm, bSq[0] / A); put(P + 'by', tm, bSq[1]); put(P + 'ex', tm, (bSq[0] + L * LF * U[0]) / A); put(P + 'ey', tm, bSq[1] + L * LF * U[1]); put(P + 'w', tm, 0.06);
      put(P + 'pn', tm, sx.length / 10); put(P + 'pcut', tm, L);
    }
    put('cam_x', tm, cam[0]); put('cam_y', tm, cam[1]); put('centroid_x', tm, 0.5); put('centroid_y', tm, 0.5 - 0.02 * v); put('proj', tm, v);
    out({ type: 'frame', t_ms: tm, value: v, overlay: { points: pts.map((q) => [q[0], q[1]]), boxes: [], pts } });
    samples.push([tm, +v.toFixed(4)]); confidence.push([tm, 0.9]);
    if (++sent % 10 === 0) out({ type: 'progress', done: sent, total: n });
    if (sent % 30 === 29) await sleep(20);
  }
  const groups = Object.fromEntries(named.map((g) => [`sem_${g.name}`, { label: g.name, source: 'user', id: g.id, points: 3 }]));
  const partRec = Object.fromEntries(dps.filter(drecv).map((g) => [g.name, { source: 'sam', role: 'part', receiver: [drecv(g).name], receiver_from: 'parts', base_from: 'partner', full: 'relative', l_full_w: 4, conf_share: 0.9, members: 10, chunks: 3, drift: 0, carried: 2, lost: 0, bound: 0 }]));
  const shaftRec = recv || Object.keys(partRec).length ? { shaft: { ...(recv ? { [sh.name]: { source: 'sam', base_from: 'own', full: 'seen', l_full_w: 6, knot: { at_w: 2.1, half_w: 0.3 }, conf_share: 0.8, members: 3, chunks: 4, drift: 1, lost: 0.2 } } : {}), ...partRec } } : {};
  const pointsOut = [];
  for (let i = 1; i < samples.length - 1; i++) if ((samples[i][1] - samples[i - 1][1]) * (samples[i + 1][1] - samples[i][1]) < 0) pointsOut.push({ at: samples[i][0], pos: Math.round(samples[i][1] * 100) });
  out({ type: 'result', samples, points: pointsOut, events: [], media, channels, confidence,
    scenes: first == null ? [] : [{ start_ms: first, end_ms: only ? last + Math.round(frameMs) : req.end_ms, sign: 1, groups, ...shaftRec }],
    notes: [{ code: 'fake_groups', message: JSON.stringify({ groups_only: only, seed, groups: named.map((g) => g.name) }) }] });
}

async function track(req) {
  if (req.tracker === 'sam2_mask' && req.groups?.length) return trackPainted(req);
  if (req.tracker === 'fake.groups') return trackGrouped(req);
  const t = trackers.find((x) => x.id === req.tracker);
  if (!t) { out({ type: 'error', message: 'unknown tracker ' + req.tracker }); process.exit(1); }
  // (the real sidecar's trackers take its scene params too, cli.py: t.params + ... + SCENE_PARAMS; the app sends them with every
  // Track, tracking.svelte.js withAxis)
  const known = new Set([...t.params, ...sceneParams].map((p) => p.key));
  for (const k of Object.keys(req.params || {})) if (!known.has(k)) { out({ type: 'error', message: 'unknown param ' + k }); process.exit(1); }
  // cuts (v3.1; v4.9): numbers (hard) or {t_ms, kind: 'hard' | 'soft', why?}; like pawtrack/cli.py parse_cuts
  const cutOk = (c) => (typeof c === 'number' && Number.isFinite(c)) || (c && typeof c === 'object' && Number.isFinite(c.t_ms) && ['hard', 'soft', undefined].includes(c.kind));
  if (req.cuts != null && !(Array.isArray(req.cuts) && req.cuts.every(cutOk))) { out({ type: 'error', message: 'ValueError: cuts: a number or {"t_ms": ms, "kind": "hard" | "soft"}' }); process.exit(1); }
  const p = Object.fromEntries(t.params.map((s) => [s.key, s.default]));
  Object.assign(p, req.params);
  // v4.15 direction: the range cut at the seed (pawtrack/cli.py clamp_direction); frames still run forward
  const dir = req.direction || 'both', seed = req.seed_ms ?? req.roi?.t_ms;
  if (!['both', 'forward', 'backward'].includes(dir)) { out({ type: 'error', message: 'ValueError: direction' }); process.exit(1); }
  if (dir !== 'both') {
    if (!Number.isFinite(seed) || seed < req.start_ms || seed >= req.end_ms) { out({ type: 'error', message: `ValueError: direction ${dir} needs seed_ms inside the range` }); process.exit(1); }
    req = dir === 'forward' ? { ...req, start_ms: seed } : { ...req, end_ms: seed + 1 };
  }
  const frameMs = 1000 / media.fps, total = Math.max(1, Math.floor((req.end_ms - req.start_ms) / frameMs));
  const delay = +(process.env.FAKE_DELAY_MS ?? 4), roi = req.roi, burst = t.id === 'fake.mask';
  const states = ['active', 'idle', 'carry', 'climax', 'orgasm'];
  for (const sp of req.spans || []) if (!states.includes(sp.state)) { out({ type: 'error', message: 'bad span state ' + sp.state }); process.exit(1); }
  const samples = [], channels = { centroid_y: [], area: [] }, confidence = [], events = [];
  for (let i = 0; i <= total; i++) {
    const tm = Math.round(req.start_ms + i * frameMs), cut = tm > 0 && tm % 5000 < frameMs, lost = i % 50 === 49;
    let v = wave(p.shape, (tm / 1000) * p.freq) + (Math.random() - 0.5) * p.noise;
    v = Math.min(1, Math.max(0, p.invert ? 1 - v : v));
    const cx = roi?.kind === 'box' ? roi.x + roi.w / 2 : roi?.kind === 'points' && roi.points[0] ? roi.points[0][0] : 0.5;
    const cy = roi?.kind === 'box' ? roi.y + roi.h * (1 - v) : roi?.kind === 'points' && roi.points[0] ? roi.points[0][1] - 0.1 * v : 1 - v;
    const overlay = { points: [[cx, cy]], boxes: roi?.kind === 'box' ? [[roi.x, roi.y, roi.w, roi.h]] : [] };
    if (burst) overlay.masks = [circle(cx, cy, 0.05 + 0.03 * v)];
    const none = cut || lost;
    out({ type: 'frame', t_ms: tm, value: none ? null : v, overlay });
    samples.push([tm, none ? null : +v.toFixed(4)]);
    if (burst) { channels.centroid_y.push([tm, none ? null : +cy.toFixed(4)]); channels.area.push([tm, none ? null : +(0.01 + 0.02 * v).toFixed(5)]); }
    confidence.push([tm, cut ? 0 : lost ? 0.1 : +(0.8 + 0.2 * Math.random()).toFixed(3)]);
    if (i % 10 === 0) out({ type: 'progress', done: i, total });
    if (process.env.FAKE_FAIL && i === 30) { out({ type: 'error', message: 'fake failure at frame 30' }); process.stderr.write('fake stderr line\n'); process.exit(1); }
    if (burst ? i % 30 === 29 : delay) await sleep(burst ? 150 : delay);
  }
  // paw-rxr3 (v4.44): FAKE_SHAFT_MS=<ms per frame> plays a shaft pass after the frames: stage "shaft" with each frame's
  // t_ms and an outline (a disc swinging round the roi's centre), then the points stage as the real sidecar
  if (+process.env.FAKE_SHAFT_MS > 0) {
    out({ type: 'progress', done: total, total, stage: 'points' });
    const cx = roi?.kind === 'box' ? roi.x + roi.w / 2 : 0.5, cy = roi?.kind === 'box' ? roi.y + roi.h / 2 : 0.5;
    for (let i = 0; i <= total; i++) {
      const tm = Math.round(req.start_ms + i * frameMs);
      out({ type: 'progress', done: Math.round((1000 * (i + 1)) / (total + 1)), total: 1000, stage: 'shaft', t_ms: tm, outline: circle(cx + 0.08 * Math.sin(i / 8), cy, 0.06) });
      await sleep(+process.env.FAKE_SHAFT_MS);
    }
    out({ type: 'progress', done: total, total, stage: 'points' });
  }
  // scenes: split at every 5 s cut; sign = invert
  const cuts = [req.start_ms];
  for (let c = Math.ceil((req.start_ms + 1) / 5000) * 5000; c < req.end_ms; c += 5000) cuts.push(c);
  const lastEnd = samples.length ? samples[samples.length - 1][0] + Math.round(frameMs) : req.end_ms;
  const scenes = cuts.map((c, i) => ({ start_ms: c, end_ms: i + 1 < cuts.length ? cuts[i + 1] : lastEnd, sign: p.pipe_invert ? -1 : 1 }));
  // events: the first 600 ms is idle; user spans are echoed (active ones produce nothing); a long still run in scene 1
  events.push({ t_ms: req.start_ms, end_ms: Math.min(req.end_ms, req.start_ms + 600), kind: 'idle', label: 'idle 0.6 s' });
  if (req.end_ms - req.start_ms > 3000) events.push({ t_ms: req.start_ms + 1500, end_ms: req.start_ms + 2500, kind: 'still', label: 'still 1.0 s' });
  for (const sp of req.spans || []) if (sp.state !== 'active') events.push({ t_ms: sp.start_ms, end_ms: sp.end_ms, kind: sp.state, label: `${sp.state} ${((sp.end_ms - sp.start_ms) / 1000).toFixed(1)} s` });
  events.sort((a, b) => a.t_ms - b.t_ms);
  if (p.loop_fold !== 'off') for (let k = 0, s = req.start_ms; s <= req.end_ms; k++, s += 1000) events.push({ t_ms: s, kind: 'cycle', label: 'cycle ' + (k + 1) });
  events.sort((a, b) => a.t_ms - b.t_ms);
  const pts = [];
  for (let i = 1; i < samples.length - 1; i++) {
    const [tm, y] = samples[i];
    if (y == null || samples[i - 1][1] == null || samples[i + 1][1] == null) continue;
    const ext = (y - samples[i - 1][1]) * (samples[i + 1][1] - y) < 0;
    if (ext && (!pts.length || tm - pts[pts.length - 1].at >= p.pipe_min_gap_ms)) pts.push({ at: tm, pos: Math.round(y * 100) });
  }
  out({ type: 'progress', done: total, total });
  out({ type: 'result', samples, points: pts, events, media, scenes, ...(burst ? { channels } : {}), confidence });
}

// v4.49 grid describe (paw-2lp7.3): every `step` frames (+ each shot's first / last frame), or the frames at / before `times`;
// a made-up timeline: anal penetration over 10..70 % of the video, a handjob over 30..60 %, cum over 60..70 %
function fakeGrid(grid, m) {
  const fl = 1000 / (m.fps || 25), n = Math.max(1, Math.floor(m.duration_ms / fl)), D = m.duration_ms, T = (k) => Math.round(k * fl);
  let ks;
  if (grid.times) ks = [...new Set(grid.times.map((t) => Math.max(0, Math.min(n - 1, Math.floor((t + 0.5) / fl)))))].sort((a, b) => a - b);
  else {
    const s = new Set(), step = Math.max(1, grid.step || 12), lo = Math.ceil((grid.start_ms || 0) / fl), hi = grid.end_ms != null ? Math.ceil(grid.end_ms / fl) : n;
    const cuts = [...new Set([lo, hi, ...(grid.shots || []).flat().map((t) => Math.ceil(t / fl)).filter((k) => k > lo && k < hi)])].sort((a, b) => a - b);
    for (let i = 0; i + 1 < cuts.length; i++) { for (let k = cuts[i]; k < cuts[i + 1]; k += step) s.add(k); s.add(cuts[i + 1] - 1); }
    ks = [...s].sort((a, b) => a - b);
  }
  return ks.map((k) => {
    const t = T(k), f = t / D, tags = {};
    if (f >= 0.1 && f < 0.7) { tags.anal_penetration = 0.95; tags.sex = 0.9; }
    if (f >= 0.3 && f < 0.6) tags.handjob = 0.93;
    if (f >= 0.6 && f < 0.7) tags.cumshot = 0.92;
    return { t_ms: t, frame: k, tags };
  });
}

const TAGS = [['solo', 0.97, null], ['canine', 0.93, [0.12, 0.2, 0.3, 0.45]], ['penis', 0.88, [0.42, 0.35, 0.16, 0.3]], ['outside', 0.71, null], ['knot', 0.4, [0.46, 0.5, 0.08, 0.1]], ['3d', 0.35, null]];

// ---- score: a small stand-in for pawtrack/score.py (turning points matched within 150 ms, sign by correlation) ----
const turns = (pts) => pts.filter((p, i) => i === 0 || i === pts.length - 1 || (p.pos - pts[i - 1].pos) * (pts[i + 1].pos - p.pos) < 0).map((p, i, a) => ({ at: p.at, kind: i + 1 < a.length ? (a[i + 1].pos > p.pos ? 'low' : 'high') : 'end' }));
function match(cand, ref) {
  const used = new Set(), dts = [];
  for (const c of cand) {
    let best = -1, bd = 151;
    ref.forEach((r, j) => { const d = Math.abs(r.at - c.at); if (!used.has(j) && r.kind === c.kind && d < bd) { bd = d; best = j; } });
    if (best >= 0) { used.add(best); dts.push(bd); }
  }
  return dts;
}
const flip = (pts) => pts.map((p) => ({ at: p.at, pos: 100 - p.pos }));
function scoreRange(cand, ref, a, b, fps) {
  const inr = (x) => x.at >= a && x.at < b, c = cand.filter(inr), r = ref.filter(inr);
  const f1Of = (cc) => { const tc = turns(cc), tr = turns(r), dts = match(tc, tr), tp = dts.length; const prec = tc.length ? tp / tc.length : null, rec = tr.length ? tp / tr.length : null;
    return { tp, fp: tc.length - tp, fn: tr.length - tp, n_cand_turns: tc.length, n_ref_turns: tr.length, precision: prec, recall: rec, f1: prec != null && rec != null && prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : prec != null && rec != null ? 0 : null, dts }; };
  const fixed = f1Of(c), flipped = f1Of(flip(c)), head = (flipped.f1 ?? -1) > (fixed.f1 ?? -1) ? flipped : fixed;
  const dts = head.dts.slice().sort((x, y) => x - y), med = dts.length ? dts[dts.length >> 1] : null;
  const { dts: _d, ...rest } = head;
  return { ...rest, f1_fixed_sign: fixed.f1, f1_sign_oracle: head.f1, f1_lag: head.f1, sign: head === flipped ? -1 : 1, lag_ms: 0, lag_bound_ms: 500, r_pos: 0.8, r_pos_fixed_sign: head === flipped ? -0.8 : 0.8,
    dt_median_ms: med, dt_p90_ms: dts.length ? dts[Math.floor(dts.length * 0.9)] : null, dt_median_frames: med == null ? null : med / (1000 / (fps || 30)), amp_ratio: 0.95, t0: a, t1: b, duration_ms: b - a, fps: fps || 30 };
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (buf += d));
process.stdin.on('end', async () => {
  let req;
  try { req = JSON.parse(buf); } catch { out({ type: 'error', message: 'bad request json' }); process.exit(1); }
  process.stderr.write('fake-pawtrack ' + req.cmd + '\n');
  if (req.cmd === 'list') { if (+process.env.FAKE_LIST_MS > 0) await new Promise((r) => setTimeout(r, +process.env.FAKE_LIST_MS)); out({ type: 'result', trackers, scene_params: sceneParams, loop_params: loopParams, describe_params: describeParams }); }
  else if (req.cmd === 'score') {
    const overall = scoreRange(req.candidate, req.reference, req.start_ms, req.end_ms, req.fps);
    const scenes = req.scenes?.map((sc) => scoreRange(req.candidate, req.reference, Math.max(sc.start_ms, req.start_ms), Math.min(sc.end_ms, req.end_ms), req.fps));
    out({ type: 'result', overall, ...(scenes ? { scenes } : {}) });
  } else if (req.cmd === 'probe') out({ type: 'result', media: probe(req.video) });
  else if (req.cmd === 'scenes') {
    probe(req.video);
    const len = (req.params?.scene_len_s ?? 5) * 1000, scenes = [];
    for (let s = 0; s < media.duration_ms; s += len) scenes.push({ start_ms: Math.round(s), end_ms: Math.round(Math.min(media.duration_ms, s + len)) });
    scenes[scenes.length - 1].end_ms = media.duration_ms;
    out({ type: 'progress', done: 1, total: 1 });
    out({ type: 'result', scenes, media });
  } else if (req.cmd === 'track') { probe(req.video); await track(req); }
  else if (req.cmd === 'loop') {
    probe(req.video);
    const period_ms = 1000, cycles = Math.floor((req.end_ms - req.start_ms) / period_ms);
    const exact = req.start_ms < 5000;   // the fake: scenes starting at 5 s or later are only periodic
    out({ type: 'result', period_ms: exact ? period_ms : null, period_frames: exact ? Math.round((period_ms / 1000) * media.fps) : null, confidence: exact ? 0.93 : 0.22, cycles: exact ? cycles : 0,
      kind: exact ? 'exact' : 'periodic', prominence: exact ? 1.4 : 0.35, motion_period_frames: Math.round((period_ms / 1000) * media.fps), motion_period_ms: period_ms, held: { step: 2, ratio: 0.5 }, media });
  } else if (req.cmd === 'describe' && req.grid) {
    probe(req.video);
    const all = fakeGrid(req.grid, media);
    out({ type: 'progress', done: 0, total: all.length, stage: 'grid' });
    for (let i = 0; i < all.length; i += 16) { await sleep(20); out({ type: 'samples', samples: all.slice(i, i + 16) }); out({ type: 'progress', done: Math.min(all.length, i + 16), total: all.length, stage: 'grid' }); }
    out({ type: 'result', samples: all, step: req.grid.step || 12, frames: media.frame_count, model: 'fake-tagger', thresholds: { anal_penetration: 0.4, sex: 0.5, handjob: 0.45, cumshot: 0.4 }, media });
  } else if (req.cmd === 'describe') {
    probe(req.video);
    const one = () => ({
      model: 'fake-tagger',
      tags: TAGS.map(([tag, score, box]) => ({ tag, score, box })),
      summary: { count: 'solo', species: ['canine'], acts: ['masturbation'], visible_parts: ['penis'], knot: true, rating: 'explicit', positions: ['standing'], views: ['side'] },
      per_frame: [],
    });
    await sleep(600);
    if (req.ranges) {   // v4.2: one request, one result per range
      const n = req.ranges.length, results = [];
      out({ type: 'progress', done: 0, total: n, stage: 'model load' });
      for (let i = 0; i < n; i++) { await sleep(150); out({ type: 'progress', done: i + 1, total: n, stage: 'describe', range: i, ranges: n }); results.push(one()); out({ type: 'described', range: i, ...results[i] }); }
      out({ type: 'result', results, media });
    } else {
      out({ type: 'progress', done: 1, total: 1 });
      out({ type: 'result', ...one(), media });
    }
  } else if (req.cmd === 'suggest_groups' && /many/.test(req.image || '')) {   // paw-r6t0: what a young head used to return: 6 good proposals, then ragged duplicates and weak guesses (every candidate carries its score)
    const blobp = (x, y, r, k = 0, rag = 0) => Array.from({ length: 24 }, (_, i) => { const th = (i / 24) * 2 * Math.PI; const rr = r * (1 + rag * (((i * 7 + k) % 5) - 2) / 5); return [+(x + rr * Math.cos(th) * 0.56).toFixed(4), +(y + rr * Math.sin(th)).toFixed(4)]; });
    const g = (name, who, part, side, x, y, r, score, rag = 0, k = 0) => ({ name, who, part, side, poly: blobp(x, y, r, k, rag), score, source: 'seeder', outline: 'head', pinned: true, ...(score < 0.7 ? { tentative: true } : {}) });
    const groups = [g('c1_hips', 'c1', 'hips', null, 0.3, 0.62, 0.1, 0.97), g('c1_penis', 'c1', 'penis', null, 0.45, 0.58, 0.06, 0.93), g('c1_head', 'c1', 'head', null, 0.2, 0.3, 0.07, 0.95), g('c2_head', 'c2', 'head', null, 0.7, 0.22, 0.07, 0.99),
      g('c2_hips', 'c2', 'hips', null, 0.68, 0.52, 0.09, 0.88), g('c1_tail', 'c1', 'tail', null, 0.12, 0.7, 0.07, 0.91),
      g('c1_hand_l', 'c1', 'hand', 'l', 0.35, 0.4, 0.05, 0.83, 0.5, 1), g('c1_hand_l', 'c1', 'hand', 'l', 0.8, 0.8, 0.04, 0.77, 0.7, 2), g('c1_hand_l', 'c1', 'hand', 'l', 0.9, 0.3, 0.04, 0.73, 0.7, 3),
      g('c2_hand_r', 'c2', 'hand', 'r', 0.85, 0.45, 0.05, 0.73, 0.6, 4), g('c2_paws', 'c2', 'paws', 'r', 0.78, 0.85, 0.04, 0.69, 0.6, 5), g('c2_paws', 'c2', 'paws', 'r', 0.55, 0.9, 0.04, 0.69, 0.6, 6),
      g('c1_balls', 'c1', 'balls', null, 0.4, 0.68, 0.035, 0.92), g('c1_balls', 'c1', 'balls', null, 0.5, 0.72, 0.03, 0.55, 0.6, 7), g('c2_head', 'c2', 'head', null, 0.9, 0.12, 0.04, 0.75, 0.6, 8),
      g('c1_tail', 'c1', 'tail', null, 0.06, 0.8, 0.04, 0.62, 0.7, 9), g('c1_torso', 'c1', 'torso', null, 0.28, 0.46, 0.08, 0.99), g('c1_torso', 'c1', 'torso', null, 0.5, 0.35, 0.04, 0.74, 0.6, 10)];
    out({ type: 'result', t_ms: 0, frame: 'image', frame_wh: [640, 360], ms: 300, media: { width: 640, height: 360 }, seeder: { frames: 9, videos: 9, trained_at: 1, parts: ['head', 'hips', 'penis', 'tail', 'balls', 'hand', 'paws', 'torso'] }, groups });
  } else if (req.cmd === 'suggest_groups') {   // v4.18: a learned head (one confident, one tentative), a tag part; the 3rd candidate wins
    const samState = (cx, cy, r) => {   // v4.37: what a SAM-drawn proposal carries: the prompts sent and SAM's chosen mask (a disc here), run-length coded at 320 wide
      const mw = 320, mh = 180, rle = []; let v = -1, c = 0;
      for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) { const q = Math.hypot(x + 0.5 - cx * mw, y + 0.5 - cy * mh) < r ? 15 : 0; if (q === v) c++; else { if (c) rle.push(v, c); v = q; c = 1; } }
      rle.push(v, c);
      return { pos: [[cx, cy]], neg: [], mask: { w: mw, h: mh, rle } };
    };
    const media0 = req.image ? { width: 640, height: 360 } : probe(req.video), sq = (x, y, r) => [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]];
    const cands = req.candidates?.length > 2 ? req.candidates.map((t, k) => ({ t_ms: t, parts: k === 2 ? 5 : 3 })) : null, t = req.image ? 0 : cands ? cands[2].t_ms : req.t_ms ?? req.start_ms;   // v4.25: an image is the one frame
    const seeded = !!req.seed?.dir;
    // v4.13 prior (paw-lgtx check): every prior identity re-found 0.01 to the right, except a tail (missing)
    const refound = (req.prior || []).filter((p) => !/tail/.test(p.name)).map((p) => ({ name: p.name, who: p.who, part: p.part, side: p.side ?? null, poly: (p.poly || []).map(([x, y]) => [+(x + 0.01).toFixed(4), y]), score: 0.8, source: 'tagger', pinned: true, prior: p.name, unconfirmed: true }));
    out({ type: 'result', t_ms: t, frame: req.image ? 'image' : cands ? 'best' : 'given', frame_wh: [640, 360], ms: 300, media: media0, ...(cands ? { candidates: cands } : {}), ...(req.prior?.length ? { missing: req.prior.filter((p) => /tail/.test(p.name)).map((p) => p.name) } : {}), ...(seeded ? { seeder: { frames: 29, videos: 3, trained_at: 1, parts: ['head', 'hips', 'penis'] }, who: { bodies: 2, by: 'left', conf: 0.5, sam: 'used', ms: 30 } } : {}), groups: [...refound,
      ...(seeded ? [{ name: 'c1_head', who: 'c1', part: 'head', side: null, poly: sq(0.7, 0.25, 0.06), score: 0.91, source: 'seeder', outline: 'sam', mask_from: 'sam', sam: samState(0.7, 0.25, 19), pinned: true, named: 'left', who_by: 'left', who_conf: 0.5 },
        { name: 'c2_tail', who: 'c2', part: 'tail', side: null, poly: sq(0.2, 0.7, 0.05), score: 0.55, source: 'seeder', outline: 'head', pinned: true, tentative: true, named: 'left', who_by: 'left', who_conf: 0.5 }] : []),
      { name: 'c1_penis', who: 'c1', part: 'penis', side: null, poly: sq(0.45, 0.55, 0.05), score: 0.81, source: 'tagger', outline: 'grabcut', pinned: true }] });
  } else if (req.cmd === 'name_groups') {   // v4.34: every third unnamed blob is doubtful ("hips" 45 %), the others are confident "thighs"; named blobs answer unknown
    if (+process.env.FAKE_NAME_MS > 0) await sleep(+process.env.FAKE_NAME_MS);
    let u = 0;
    const limb = req.masks.find((m) => ['shoulder', 'forearm', 'shin'].includes(m.part))?.part;   // paw-5r1: a named limb segment: the unnamed blobs are proposed as that part (no who: the owner's)
    out({ type: 'result', ms: 20, model: { blobs: 40, images: 8, gate: 0.9 }, seen: false, blobs: req.masks.map((m) => {
      if (m.part) return { part: [], conf: 0, auto: false, who: null, who_by: null, named: true };
      if (limb) return { part: [{ part: limb, p: 0.97 }, { part: 'hand', p: 0.02 }], conf: 0.97, auto: true, who: null, who_by: null, named: false };
      const doubt = u++ % 3 === 2;   // v4.36: the first confident one also carries a sure who (c2), the others a doubtful one (the left-head fallback)
      return doubt ? { part: [{ part: 'hips', p: 0.45 }, { part: 'thighs', p: 0.3 }, { part: 'torso', p: 0.1 }], conf: 0.45, auto: false, who: null, who_by: null, named: false }
        : { part: [{ part: 'thighs', p: 0.97 }, { part: 'hips', p: 0.02 }, { part: 'torso', p: 0.01 }], conf: 0.97, auto: true, who: u === 1 ? 'c2' : null, who_by: u === 1 ? 'bodies' : null, who_conf: u === 1 ? 0.97 : undefined, named: false };
    }) });
  } else if (req.cmd === 'segment') {   // v4.25: a deliberately RAGGED mask round the first positive point: a wavy fringe, a hole, a speck and a far island (the app must clean it)
    if (+process.env.FAKE_SEGMENT_MS > 0) await sleep(+process.env.FAKE_SEGMENT_MS);   // paw-evlj: a slow card (or a loaded PC): answers later than the wheel turns
    const mw = req.mask_w || 320, mh = Math.round(mw * 9 / 16), [px, py] = req.pos?.[0] || [0.5, 0.5], cx = px * mw, cy = py * mh, R = 0.09 * mh;
    if (req.mask) {   // v4.35: a mask prompt (a loosen / tighten notch, a refinement dab): four answers, discs round the prompt's centre, 0.8 / 1 / 1.25 / 1.7 x its radius
      let n = 0, sx = 0, sy = 0, i = 0;
      for (let k = 0; k < req.mask.rle.length; k += 2) { const v = req.mask.rle[k], run = req.mask.rle[k + 1]; if (v >= 8) for (let j = 0; j < run; j++) { n++; sx += (i + j) % req.mask.w; sy += Math.floor((i + j) / req.mask.w); } i += run; }
      const X = sx / Math.max(1, n), Y = sy / Math.max(1, n), rp = Math.sqrt(n / Math.PI), encm = (m) => { const rle = []; let v = -1, c = 0; for (const f of m) { const q = Math.round(f * 15); if (q === v) c++; else { if (c) rle.push(v, c); v = q; c = 1; } } if (c) rle.push(v, c); return { w: mw, h: mh, rle }; };
      const ans = [0.8, 1, 1.25, 1.7].map((f) => { const m = new Float32Array(mw * mh); for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) m[y * mw + x] = Math.hypot(x + 0.5 - X, y + 0.5 - Y) < f * rp ? 1 : 0; return { mask: encm(m), score: 0.8, area: +(m.reduce((q, v) => q + v, 0) / (mw * mh)).toFixed(5) }; });
      out({ type: 'result', frame_wh: [1920, 1080], mask_wh: [mw, mh], cached: true, ms: { embed: 0, decode: 1 }, masks: ans });
      return;
    }
    const a = new Float32Array(mw * mh);
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, th = Math.atan2(dy, dx), r = R + 1.6 * Math.sin(7 * th) + 1.2 * Math.sin(13 * th + 1) + 0.8 * Math.sin(29 * th);
      if (Math.hypot(dx, dy) < r) a[y * mw + x] = 1;
      if (Math.hypot(dx - 0.4 * R, dy + 0.2 * R) < 0.2 * R) a[y * mw + x] = 0;   // a hole
      if (Math.hypot(dx - 1.6 * R, dy + 1.5 * R) < 1.5) a[y * mw + x] = 1;       // a speck
      if (Math.hypot(dx + 2.7 * R, dy - 0.3 * R) < 0.3 * R) a[y * mw + x] = 1;   // a far island
    }
    const enc = (m) => { const rle = []; let v = -1, n = 0; for (const f of m) { const q = Math.round(f * 15); if (q === v) n++; else { if (n) rle.push(v, n); v = q; n = 1; } } if (n) rle.push(v, n); return { w: mw, h: mh, rle }; };
    const big = a.map((_, i) => { const x = i % mw, y = (i / mw) | 0; return Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < 3 * R ? 1 : 0; });
    // v4.35: `logits` -> each answer's 256 x 256 int8 low-res logits (a blurred copy of the mask: the slope SAM's own have at an edge); `single` -> one answer
    const lg = (m) => {
      let f = Float32Array.from(m);
      for (let pass = 0; pass < 2; pass++) { const g = new Float32Array(f.length); for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) { let t = 0, c = 0; for (let k = -3; k <= 3; k++) { const xx = x + k; if (xx >= 0 && xx < mw) { t += f[y * mw + xx]; c++; } } g[y * mw + x] = t / c; } f = new Float32Array(f.length); for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) { let t = 0, c = 0; for (let k = -3; k <= 3; k++) { const yy = y + k; if (yy >= 0 && yy < mh) { t += g[yy * mw + x]; c++; } } f[y * mw + x] = t / c; } }
      const q = Buffer.alloc(256 * 256);
      for (let Y = 0; Y < 256; Y++) for (let X = 0; X < 256; X++) { const v = f[Math.min(mh - 1, Math.floor(((Y + 0.5) * mh) / 256)) * mw + Math.min(mw - 1, Math.floor(((X + 0.5) * mw) / 256))]; q.writeInt8(Math.max(-127, Math.min(127, Math.round(Math.max(-12, Math.min(12, (v - 0.5) * 24)) / 0.25))), Y * 256 + X); }
      return { w: 256, h: 256, s: 0.25, b64: q.toString('base64') };
    };
    const masks = [{ mask: enc(a), score: 0.9, area: 0.01, m: a }, { mask: enc(big), score: 0.7, area: 0.09, m: big }].slice(req.single ? 1 : 0).map(({ m, ...r }) => (req.logits ? { ...r, logits: lg(m) } : r));
    out({ type: 'result', frame_wh: [1920, 1080], mask_wh: [mw, mh], cached: false, ms: { embed: 1, decode: 1 }, masks });
  } else if (req.cmd === 'seed_train') {   // v4.18
    out({ type: 'progress', done: 1, total: 1, stage: 'training' });
    // v4.32: with a `dataset` the record and a score go to that dataset's folder (head.json / score.json), numbers from its label count
    let dsRec = {};
    if (req.dataset) {
      const names = req.labels && nfs.existsSync(req.labels) ? nfs.readdirSync(req.labels).filter((n) => n.endsWith('.json')).sort() : [];
      const fp = `fp-${names.length}-${names.join(',').length}-${basename(req.dataset)}`, found = Math.min(0.9, 0.3 + 0.03 * names.length) + (basename(req.dataset) === 'v1' ? -0.1 : 0);
      const score = { fingerprint: fp, at: 1, frames: names.length, sources: names.length, overall: { found, iou: found / 2, cerr: 0.05, extra: 1.2, n: names.length }, parts: {} };
      const rec = { frames: names.length, videos: names.length, groups: names.length, changed: true, s: 1, trained_at: 2, fingerprint: fp, images: names.length, parts: {}, trained_on: names.map((n) => n.slice(0, -5) + '_0') };
      nfs.mkdirSync(req.dataset, { recursive: true });
      nfs.writeFileSync(req.dataset + '/head.json', JSON.stringify(rec)); nfs.writeFileSync(req.dataset + '/score.json', JSON.stringify({ latest: score, history: [score] }));
      dsRec = { ...rec, score };
    }
    if (req.dataset) { out({ type: 'result', ...dsRec, projects: {} }); return; }
    out({ type: 'result', frames: 31, videos: 3, groups: 152, changed: true, s: 4.2, trained_at: 2, fingerprint: 'x', ...(req.labels ? { images: 12, negatives: 2 } : {}), parts: { head: { labels: 32, videos: 3, use: true }, paws: { labels: 7, videos: 1, use: false } }, projects: {} });
  } else if (req.cmd === 'seed_compare') {   // v4.32: every dataset with a head scored on the active one's labels (numbers from the label counts)
    const heads = req.datasets.map((d) => { try { return { d, h: JSON.parse(nfs.readFileSync(d.dir + '/head.json', 'utf8')) }; } catch { return { d, h: null }; } });
    const trained = heads.filter((x) => x.h);
    const res = { active: req.active, frames: trained.find((x) => x.d.id === req.active)?.h.frames || 0, common: ['hips', 'head'], fingerprint: 'c' + trained.length, at: 3, rows: heads.map(({ d, h }) => (h ? { id: d.id, name: d.name, own: d.id === req.active, how: d.id === req.active ? 'held-out' : 'never saw', found: d.id === req.active ? 0.62 : 0.44, iou: 0.3, cerr: 0.05, extra: 1, n_frames: h.frames, excluded: 0 } : { id: d.id, name: d.name, own: d.id === req.active, error: 'not trained yet' })) };
    if (trained.length < 2) { res.rows = []; res.note = 'fewer than two trained datasets'; }
    const act = req.datasets.find((d) => d.id === req.active); if (act) nfs.writeFileSync(act.dir + '/cross.json', JSON.stringify(res));
    out({ type: 'result', ...res });
  } else { out({ type: 'error', message: 'unknown cmd ' + req.cmd }); process.exit(1); }
});
