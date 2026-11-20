// dev/tracking.js -- harness for src/features/tracking: the real mock app on a 60 s synthetic clip, the tracker
// panel in a 300 px dock, the ROI overlay over the video, the shell's fallback lane (stroke + ghosts) and the
// Tracker lane, the kit's toast host and a status line. app.backend.sidecar is a fake that answers like
// test/fake-pawtrack.mjs (generators ported from there). window.H = { app, tr, FAKE } for Playwright.
//   ?video=1   features/video's Player + VideoPane (the real overlay layer: zoom / pan / rotation), else the
//              shell's fallback overlay over a plain <video>
// FAKE.pan: the whole-frame tracker (fake.none, the camera reference) sees the same motion as the runs (a camera
// pan) instead of noise. FAKE.requests: every track request sent (params check).
import '../src/ui/kit/theme.css';
import '../src/style.css';
import { mount } from 'svelte';
import { createMockApp, sampleDoc, mockBackend } from './mock-app.js';
import commands from '../src/features/tracking/commands.js';
import panel from '../src/features/tracking/panel.js';
import lane from '../src/features/tracking/lane.js';
import overlay from '../src/features/tracking/overlay.js';
import { trackingFor } from '../src/features/tracking/tracking.svelte.js';
import { groupsFor } from '../src/features/tracking/groups.svelte.js';
import { whoName } from '../src/features/tracking/groups.js';
import FallbackLane from '../src/app/FallbackLane.svelte';
import ToastHost from '../src/ui/kit/ToastHost.svelte';
import { Player } from '../src/features/video/player.svelte.js';
import VideoPane from '../src/features/video/VideoPane.svelte';
const VIDEO = new URLSearchParams(location.search).get('video') === '1';

// ---------------- fake sidecar (protocol v3, see test/fake-pawtrack.mjs) ----------------
const FAKE = { fail: false, delay: 12, cancelled: false, pan: false, requests: [], hang: false };
const P = (key, label, type, def, min = null, max = null, choices = null) => ({ key, label, type, default: def, min, max, choices });
const own = [P('freq', 'Frequency (Hz)', 'float', 1.5, 0.2, 6), P('noise', 'Noise', 'float', 0.05, 0, 0.5), P('shape', 'Shape', 'choice', 'sine', null, null, ['sine', 'saw', 'square']), P('invert', 'Invert', 'bool', false)];
const shared = [
  P('pipe_sign', 'Direction', 'choice', 'keep', null, null, ['keep', 'auto']), P('pipe_invert', 'Invert direction', 'bool', false),
  P('pipe_gate', 'Activity gate', 'choice', 'motion', null, null, ['off', 'motion']), P('pipe_gate_motion', 'Gate motion threshold', 'float', 4.0, 0, 50),
  P('pipe_carry_gaps', 'Carry across gaps', 'bool', true), P('pipe_climax_rate', 'Climax pulses/s', 'float', 6.8, 1, 20),
  P('pipe_norm_window_ms', 'Norm window (ms)', 'int', 3000, 0, 20000), P('pipe_min_gap_ms', 'Min point gap (ms)', 'int', 120, 20, 1000),
  P('pipe_smooth_ms', 'Smoothing window (ms)', 'int', 100, 0, 2000), P('cut_enabled', 'Detect cuts', 'bool', true),
  P('held_retime', 'Held-frame retime', 'choice', 'auto', null, null, ['off', 'auto', 'on']), P('loop_fold', 'Loop fold', 'choice', 'off', null, null, ['off', 'auto', 'on']),
  P('loop_min_confidence', 'Loop min confidence', 'float', 0.5, 0, 1),
];
const trackers = [
  { id: 'fake.box', name: 'Fake box oscillator', roi: 'box', channels: [], params: [...own, ...shared] },
  { id: 'fake.points', name: 'Fake point follower', roi: 'points', channels: [], params: [...own.slice(0, 2),
    // the point trackers' stroke-axis schema (trackers/pawtrack/trackers/cotracker_points.py common_params)
    P('primary', 'Primary signal', 'choice', 'auto', null, null, ['auto', 'centroid_auto', 'proj', 'proj_cam', 'dist01']), P('axis', 'Stroke axis for proj', 'choice', 'auto', null, null, ['auto', 'vertical', 'horizontal', 'custom']),
    P('axis_x0', 'Custom axis: out end x (0-1)', 'float', 0.5, 0, 1), P('axis_y0', 'Custom axis: out end y (0-1)', 'float', 0.3, 0, 1),
    P('axis_x1', 'Custom axis: in end x (0-1)', 'float', 0.5, 0, 1), P('axis_y1', 'Custom axis: in end y (0-1)', 'float', 0.7, 0, 1), ...shared] },
  { id: 'fake.mask', name: 'Fake mask (box or clicks)', roi: 'box_or_points', channels: ['centroid_y', 'area'], params: [...own, ...shared] },
  { id: 'fake.none', name: 'Fake whole-frame', roi: 'none', channels: [], params: shared },
  // a points tracker's pinned-group schema (cotracker_points common_params): the Groups tool (G) and track.groups
  { id: 'fake.pinned', name: 'Fake pinned groups', roi: 'box', channels: [], params: [...own.slice(0, 2), P('seed_frame', 'Seed frame', 'choice', 'first', null, null, ['first', 'auto']),
    P('box_points', 'Points in the box', 'int', 64, 4, 4096), P('group_points', 'Points per group (0 = auto: 16+, more for bigger parts)', 'int', 0, 0, 256),
    P('sem_groups', 'Pin penis / balls / hips groups', 'bool', true), P('sem_shape', 'Outline', 'choice', 'grabcut', null, null, ['cam', 'grabcut', 'sam']), ...shared] },
];
const sceneParams = [P('scene_len_s', 'Mean scene length (s)', 'float', 5, 1, 60)];
const loopParams = [shared.find((p) => p.key === 'loop_min_confidence')];
const describeParams = [P('min_score', 'Min tag score', 'float', 0.3, 0, 1), P('top_k', 'Tags kept', 'int', 12, 1, 50)];
const media = { duration_ms: 60027, fps: 29.97, is_vfr: false, width: 640, height: 360, frame_count: 1799 };
const TAGS = [['solo', 0.97, null], ['canine', 0.93, [0.12, 0.2, 0.3, 0.45]], ['penis', 0.88, [0.42, 0.35, 0.16, 0.3]], ['outside', 0.71, null], ['knot', 0.4, [0.46, 0.5, 0.08, 0.1]], ['3d', 0.35, null]];

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wave = (shape, ph) => { const f = ph - Math.floor(ph); return shape === 'saw' ? f : shape === 'square' ? (f < 0.5 ? 1 : 0) : 0.5 - 0.5 * Math.cos(2 * Math.PI * f); };
const circle = (cx, cy, r) => Array.from({ length: 12 }, (_, i) => [cx + r * Math.cos((i / 12) * 6.2832), cy + r * Math.sin((i / 12) * 6.2832)]);

async function fakeTrack(req, onEvent, onFrames) {
  const t = trackers.find((x) => x.id === req.tracker);
  if (!t) return { error: 'unknown tracker ' + req.tracker };
  FAKE.requests.push(structuredClone(req));
  const bad = Object.keys(req.params || {}).find((k) => !t.params.some((s) => s.key === k) && !sceneParams.some((s) => s.key === k));   // the sidecar takes the scene params on every tracker (pawtrack/cli.py)
  if (bad) return { error: 'unknown param ' + bad };   // like the real sidecar
  const p = { ...Object.fromEntries(t.params.map((s) => [s.key, s.default])), ...req.params };
  const camera = t.roi === 'none';   // the whole-frame reference: the pan when FAKE.pan, else sensor noise
  const frameMs = 1000 / media.fps, total = Math.max(1, Math.floor((req.end_ms - req.start_ms) / frameMs));
  const roi = req.roi, burst = t.id === 'fake.mask';
  const samples = [], channels = { centroid_y: [], area: [] }, confidence = [], events = [];
  // paw-azd: a group sent with shaft gets the shaft channels (how much is inside = 1 - v, the visible shaft from the box's
  // left edge rightwards by v) and its scenes a SAM record, like the sidecar's v4.17
  const shafts = (req.groups || []).filter((g) => g.shaft).map((g) => [g.who ? `${g.who}_${g.part}` : g.name, {}]);
  for (const [, c] of shafts) for (const k of ['in', 'in_conf', 'len', 'knot', 'bx', 'by', 'ex', 'ey', 'w']) c[k] = [];
  let batch = [];
  for (let i = 0; i <= total; i++) {
    if (FAKE.cancelled) return { cancelled: true };
    const tm = Math.round(req.start_ms + i * frameMs), cut = tm > 0 && tm % 5000 < frameMs, lost = i % 50 === 49;
    let v = camera ? (FAKE.pan ? wave('sine', (tm / 1000) * 1.5) + (Math.random() - 0.5) * 0.03 : 0.5 + (Math.random() - 0.5) * 0.3) : wave(p.shape, (tm / 1000) * p.freq) + (Math.random() - 0.5) * p.noise;
    v = Math.min(1, Math.max(0, p.invert ? 1 - v : v));
    const cx = roi?.kind === 'box' ? roi.x + roi.w / 2 : roi?.kind === 'points' && roi.points[0] ? roi.points[0][0] : 0.5;
    const cy = roi?.kind === 'box' ? roi.y + roi.h * (1 - v) : roi?.kind === 'points' && roi.points[0] ? roi.points[0][1] - 0.1 * v : 1 - v;
    const overlay = { points: [[cx, cy]], boxes: roi?.kind === 'box' ? [[roi.x, roi.y, roi.w, roi.h]] : [] };
    if (burst) overlay.masks = [circle(cx, cy, 0.05 + 0.03 * v)];
    const none = cut || lost;
    batch.push({ type: 'frame', t_ms: tm, value: none ? null : v, overlay });
    samples.push([tm, none ? null : +v.toFixed(4)]);
    if (burst) { channels.centroid_y.push([tm, none ? null : +cy.toFixed(4)]); channels.area.push([tm, none ? null : +(0.01 + 0.02 * v).toFixed(5)]); }
    confidence.push([tm, cut ? 0 : lost ? 0.1 : +(0.8 + 0.2 * Math.random()).toFixed(3)]);
    const bx = roi?.kind === 'box' ? roi.x : 0.3, by = roi?.kind === 'box' ? roi.y + roi.h / 2 : 0.5;
    for (const [, c] of shafts) {
      const vals = { in: 1 - v, in_conf: none ? 0 : 0.9, len: v, knot: null, bx, by, ex: bx + 0.3 * v, ey: by, w: 0.04 };
      for (const k in vals) c[k].push([tm, none && k !== 'in_conf' ? null : vals[k] == null ? null : +vals[k].toFixed(4)]);
    }
    if (FAKE.fail && i === 30) { FAKE.fail = false; document.getElementById('fail').checked = false; return { error: 'fake failure at frame 30\nTraceback (most recent call last):\n  fake stderr line' }; }
    if (i % 8 === 7 || i === total) { onFrames(batch); batch = []; onEvent({ type: 'progress', done: i, total }); await sleep(FAKE.delay); }
  }
  const cuts = [req.start_ms];
  for (let c = Math.ceil((req.start_ms + 1) / 5000) * 5000; c < req.end_ms; c += 5000) cuts.push(c);
  const lastEnd = samples[samples.length - 1][0] + Math.round(frameMs);
  const scenes = cuts.map((c, i) => { const auto = p.pipe_sign === 'auto' ? (i % 2 ? -1 : 1) : null; return { start_ms: c, end_ms: i + 1 < cuts.length ? cuts[i + 1] : lastEnd, sign: (auto ?? 1) * (p.pipe_invert ? -1 : 1), auto_sign: auto,
    ...(shafts.length ? { shaft: Object.fromEntries(shafts.map(([n]) => [n, { source: 'sam', full: 'seen', conf_share: 0.9 }])) } : {}) }; });
  events.push({ t_ms: req.start_ms, end_ms: Math.min(req.end_ms, req.start_ms + 600), kind: 'idle', label: 'idle 0.6 s' });
  if (req.end_ms - req.start_ms > 3000) events.push({ t_ms: req.start_ms + 1500, end_ms: req.start_ms + 2500, kind: 'still', label: 'still 1.0 s' });
  for (const sp of req.spans || []) if (sp.state !== 'active') events.push({ t_ms: sp.start_ms, end_ms: sp.end_ms, kind: sp.state, label: `${sp.state} ${((sp.end_ms - sp.start_ms) / 1000).toFixed(1)} s` });
  if (p.loop_fold !== 'off') for (let k = 0, s = req.start_ms; s <= req.end_ms; k++, s += 1000) events.push({ t_ms: s, kind: 'cycle', label: 'cycle ' + (k + 1) });
  events.sort((a, b) => a.t_ms - b.t_ms);
  // the turns: where the signal changes direction, read over the lost / cut frames and a flat top or bottom (v clamped to 0..1)
  // at its first frame. paw-kn2r: a turn needed two read neighbours that differed from it, so a stroke whose top sat on a
  // clamped plateau or beside a lost frame was dropped (which ones: the noise), and shaft-check's points-vs-shaft r ran 0.17..0.7
  const pts = [];
  let last = null, dir = 0;   // last: the latest read sample that changed the value
  for (const [tm, y] of samples) {
    if (y == null || y === last?.[1]) continue;
    const d = last ? Math.sign(y - last[1]) : 0;
    if (dir && d !== dir && (!pts.length || last[0] - pts[pts.length - 1].at >= p.pipe_min_gap_ms)) pts.push({ at: last[0], pos: Math.round(last[1] * 100) });
    if (d) dir = d;
    last = [tm, y];
  }
  const shaftCh = Object.fromEntries(shafts.flatMap(([n, c]) => Object.entries(c).map(([k, v]) => [`sem_${n}_${k}`, v])));
  if (shafts.length) Object.assign(shaftCh, { centroid_x: samples.map(([tm]) => [tm, 0.5]), centroid_y: samples.map(([tm, y]) => [tm, y == null ? null : 1 - y]),
    cam_x: samples.map(([tm]) => [tm, 0]), cam_y: samples.map(([tm]) => [tm, 0]) });   // a points run's stored centroid / camera (Adjust works)
  return { result: { type: 'result', samples, points: pts, events, media, scenes, ...(burst || shafts.length ? { channels: { ...(burst ? channels : {}), ...shaftCh } } : {}), confidence } };
}

// score: the fake's stand-in for pawtrack/score.py (turning points matched within 150 ms, sign by best F1)
const turns = (pts) => pts.filter((p, i) => i === 0 || i === pts.length - 1 || (p.pos - pts[i - 1].pos) * (pts[i + 1].pos - p.pos) < 0).map((p, i, a) => ({ at: p.at, kind: i + 1 < a.length ? (a[i + 1].pos > p.pos ? 'low' : 'high') : 'end' }));
function match(cand, ref) {
  const used = new Set(), dts = [];
  for (const c of cand) { let best = -1, bd = 151; ref.forEach((r, j) => { const d = Math.abs(r.at - c.at); if (!used.has(j) && r.kind === c.kind && d < bd) { bd = d; best = j; } }); if (best >= 0) { used.add(best); dts.push(bd); } }
  return dts;
}
function scoreRange(cand, ref, a, b, fps) {
  const inr = (x) => x.at >= a && x.at < b, c = cand.filter(inr), r = ref.filter(inr);
  const f1Of = (cc) => { const tc = turns(cc), tr = turns(r), dts = match(tc, tr), tp = dts.length; const prec = tc.length ? tp / tc.length : null, rec = tr.length ? tp / tr.length : null;
    return { tp, precision: prec, recall: rec, f1: prec != null && rec != null && prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : prec != null && rec != null ? 0 : null, dts }; };
  const fixed = f1Of(c), flipped = f1Of(c.map((p) => ({ at: p.at, pos: 100 - p.pos }))), head = (flipped.f1 ?? -1) > (fixed.f1 ?? -1) ? flipped : fixed;
  const dts = head.dts.slice().sort((x, y) => x - y), med = dts.length ? dts[dts.length >> 1] : null;
  return { ...head, dts: undefined, f1_fixed_sign: fixed.f1, sign: head === flipped ? -1 : 1, lag_ms: 0, r_pos: 0.8, dt_median_ms: med, dt_median_frames: med == null ? null : med / (1000 / (fps || 30)), amp_ratio: 0.95, t0: a, t1: b };
}

const backend = {
  ...mockBackend(),
  async cancelSidecar() { FAKE.cancelled = true; },
  async appPaths() { return { data_dir: 'C:\\mock-data' }; },   // the learned seeder's folder (<data_dir>\seeder)
  async sidecar(req, { onEvent = () => {}, onFrames = () => {} } = {}) {
    FAKE.cancelled = false;
    const done = (r) => ({ result: null, error: null, cancelled: false, ...r });
    await sleep(60);
    if (req.cmd === 'list') return done({ result: { type: 'result', trackers, scene_params: sceneParams, loop_params: loopParams, describe_params: describeParams } });
    if (req.cmd === 'probe') return done({ result: { type: 'result', media } });
    if (req.cmd === 'score') {
      const overall = scoreRange(req.candidate, req.reference, req.start_ms, req.end_ms, req.fps);
      const scenes = req.scenes?.map((sc) => scoreRange(req.candidate, req.reference, Math.max(sc.start_ms, req.start_ms), Math.min(sc.end_ms, req.end_ms), req.fps)).filter((s) => s.t1 > s.t0);
      return done({ result: { type: 'result', overall, ...(scenes ? { scenes } : {}) } });
    }
    if (req.cmd === 'scenes') {
      const len = (req.params?.scene_len_s ?? 5) * 1000, scenes = [];
      for (let s = 0; s < media.duration_ms; s += len) scenes.push({ start_ms: Math.round(s), end_ms: Math.round(Math.min(media.duration_ms, s + len)) });
      for (let k = 1; k <= 4; k++) { onEvent({ type: 'progress', done: k, total: 4 }); await sleep(120); if (FAKE.cancelled) return done({ cancelled: true }); }
      return done({ result: { type: 'result', scenes, media } });
    }
    if (req.cmd === 'track') return done(await fakeTrack(req, onEvent, onFrames));
    if (req.cmd === 'suggest_groups') {   // PROTOCOL v4.12: two pinned parts (C1's penis, C2's hips) and C1's body on the asked frame
      FAKE.requests.push(structuredClone(req));
      await sleep(FAKE.delay);
      let t = req.t_ms ?? Math.round((req.start_ms + req.end_ms) / 2);
      // v4.18 (FAKE.seeder on): the learned head answers (a confident C1 head, a tentative C2 tail), the third candidate wins
      const seeded = FAKE.seeder && req.seed?.dir, cands = FAKE.seeder && req.candidates?.length > 2 ? req.candidates.map((c, k) => ({ t_ms: c, parts: k === 2 ? 5 : 3 })) : null;
      if (cands) t = cands[2].t_ms;
      return done({ result: { type: 'result', t_ms: t, frame: cands ? 'best' : req.t_ms == null ? 'auto' : 'given', frame_wh: [640, 360], ms: 420, media,
        ...(cands ? { candidates: cands } : {}), ...(FAKE.seeder && req.seed ? { seeder: { frames: 29, videos: 3, trained_at: 1, parts: ['head', 'hips', 'penis'] } } : {}), groups: [
        ...(seeded ? [{ name: 'c1_head', who: 'c1', part: 'head', side: null, poly: circle(0.7, 0.25, 0.07), score: 0.91, source: 'seeder', outline: 'head', pinned: true, named: 'left' },
          { name: 'c2_tail', who: 'c2', part: 'tail', side: null, poly: circle(0.15, 0.7, 0.05), score: 0.55, source: 'seeder', outline: 'head', pinned: true, tentative: true, named: 'left' }] : []),
        { name: 'c1_penis', who: 'c1', part: 'penis', side: null, poly: circle(0.45, 0.55, 0.06), score: 0.81, source: 'tagger', outline: 'grabcut', pinned: true },
        { name: 'c2_hips', who: 'c2', part: 'hips', side: null, poly: [[0.3, 0.3], [0.6, 0.3], [0.6, 0.5], [0.3, 0.5]], score: 0.64, source: 'tagger', outline: 'grabcut', pinned: true },
        { name: 'c1_body', who: 'c1', part: 'body', side: null, poly: [[0.2, 0.2], [0.8, 0.2], [0.8, 0.9], [0.2, 0.9]], score: 0.9, source: 'sam', outline: 'sam', pinned: false }] } });
    }
    if (req.cmd === 'seed_train') {   // PROTOCOL v4.18: the learned seeder trained on the library
      FAKE.requests.push(structuredClone(req));
      onEvent({ type: 'progress', done: 1, total: 2, stage: 'features' }); await sleep(FAKE.delay || 60);
      const head = { type: 'result', frames: 31, videos: 3, groups: 152, changed: true, s: 4.2, trained_at: 2, fingerprint: 'x',
        parts: { penis: { labels: 16, videos: 2, use: true }, head: { labels: 32, videos: 3, use: true }, tail: { labels: 13, videos: 2, use: true }, paws: { labels: 7, videos: 1, use: false } }, projects: {} };
      if (req.dataset) await backend.writeText(req.dataset + (req.dataset.includes('\\') ? '\\' : '/') + 'head.json', JSON.stringify(head));   // as pawtrack/seeder.py: the app re-reads it
      return done({ result: head });
    }
    if (req.cmd === 'cum') {   // PROTOCOL v4.16: one proposal per contraction of each pulse group, its signal as a channel
      FAKE.requests.push(structuredClone(req));
      const pg = (req.groups || []).filter((g) => g.pulse), [a, b] = req.pulse_range || [req.start_ms, req.end_ms], spurts = [], channels = {}, pulse = [];
      for (const g of pg) {
        const label = `${g.part}${g.who ? ` (${whoName(g.who)})` : ''}`, ev = [];
        for (let t = a + 1000; t < b; t += 2000) ev.push({ t_ms: t, score: 0.7, z: 7, weak: false });
        const ts = []; for (let t = Math.max(req.start_ms, a - 1000); t <= Math.min(req.end_ms, b + 1000); t += 40) ts.push(t);
        channels[`sem_${g.name}_pulse`] = ts.map((t) => [t, ev.some((e) => t >= e.t_ms && t < e.t_ms + 200) ? 8 : 0]);
        pulse.push({ name: g.name, label, source: 'sam', events: ev, range: [ts[0], ts[ts.length - 1]], frames: ts.length });
        for (const e of ev) spurts.push({ t_ms: e.t_ms, score: 0.79, source: label, why: [{ cue: label, score: 0.7 }, { cue: 'fluid', score: 0.3 }], strong: true });
      }
      return done({ result: { type: 'result', spurts, curve: { t: [], cum: [] }, frames: 0, tagged: 0, media, ...(pg.length ? { pulse, channels } : {}) } });
    }
    if (req.cmd === 'loop') {
      await sleep(300);
      const period_ms = 1000, cycles = Math.floor((req.end_ms - req.start_ms) / period_ms), exact = req.start_ms < 5000;
      return done({ result: { type: 'result', period_ms: exact ? period_ms : null, period_frames: exact ? Math.round((period_ms / 1000) * media.fps) : null, confidence: exact ? 0.93 : 0.22, cycles: exact ? cycles : 0,
        kind: exact ? 'exact' : 'periodic', prominence: exact ? 1.4 : 0.35, motion_period_frames: Math.round((period_ms / 1000) * media.fps), motion_period_ms: period_ms, held: { step: 2, ratio: 0.5 }, media } });
    }
    if (req.cmd === 'describe' && req.grid) {   // v4.49
      const all = fakeGrid(req.grid, media);
      for (let i = 0; i < all.length; i += 16) {
        await sleep(20);
        if (FAKE.cancelled) return done({ cancelled: true });
        onEvent({ type: 'samples', samples: all.slice(i, i + 16) }); onEvent({ type: 'progress', done: Math.min(all.length, i + 16), total: all.length, stage: 'grid' });
      }
      return done({ result: { type: 'result', samples: all, step: req.grid.step || 12, frames: media.frame_count, model: 'fake-tagger', thresholds: { anal_penetration: 0.4, sex: 0.5, handjob: 0.45, cumshot: 0.4 }, media } });
    }
    if (req.cmd === 'describe') {
      await sleep(500);
      while (FAKE.hang && !FAKE.cancelled) await sleep(50);   // a describe stuck behind a busy GPU (no events)
      if (FAKE.cancelled) return done({ cancelled: true });
      onEvent({ type: 'progress', done: 1, total: 1 });
      return done({ result: { type: 'result', model: 'fake-tagger', media, tags: TAGS.map(([tag, score, box]) => ({ tag, score, box })),
        summary: { count: 'solo', species: ['canine'], acts: ['masturbation'], knot: true, rating: 'explicit', positions: ['standing'], views: ['side'] }, per_frame: [] } });
    }
    return done({ error: 'unknown cmd ' + req.cmd });
  },
};

// ---------------- document: 60 s, the clip as media, a reference that matches the fake's 1.5 Hz sine ----------------
const D = sampleDoc({ minutes: 1, fps: 29.97 });
const ref = [];
for (let k = 0; k * 333.33 < 60000; k++) ref.push({ at: Math.round(k * 333.33 + 20), pos: k % 2 ? 100 : 0 });
D.media = { path: 'C:/clips/cfr2997.mp4', name: 'cfr2997.mp4', durationMs: 60027, fps: 29.97, isVfr: false, width: 640, height: 360 };
await backend.writeText(D.media.path, '');   // the clip on the mock disk: a job on a missing video is refused (paw-xfg6)
D.ghosts = D.ghosts.map((g) => (g.id === 'ref' ? { ...g, name: 'Reference cfr2997.funscript', script: ref, visible: true } : { ...g, visible: false }));

let app;
if (VIDEO) {
  document.getElementById('vid').remove();
  D.media.url = '/dev/assets/cfr2997.mp4';
  app = createMockApp({ commands, doc: D, backend });
  app.player = new Player(app);
  app.load(D);
  mount(VideoPane, { target: document.getElementById('pane'), props: { app } });
} else app = createMockApp({ commands, doc: D, backend, video: document.getElementById('vid') });
app.hosts = true;
app.setMode('track');
const tr = trackingFor(app);

mount([panel].flat()[0].component, { target: document.getElementById('panel'), props: { app } });
if (!VIDEO) mount([overlay].flat()[0].component, { target: document.getElementById('overlay'), props: { app } });   // ?video=1: VideoPane mounts the overlay plug-ins itself
mount(ToastHost, { target: document.body });
mount(FallbackLane, { target: document.getElementById('lane-stroke'), props: { app, axis: 'stroke' } });
mount(lane.component, { target: document.getElementById('lane-track'), props: { app, height: 110 } });

// ---------------- chrome: modes, status line, toasts ----------------
const modes = document.getElementById('modes');
for (const m of ['scenes', 'track', 'refine', 'review']) {
  const b = document.createElement('button'); b.className = 'btn sm'; b.textContent = m; b.dataset.mode = m;
  b.onclick = () => app.setMode(m); modes.appendChild(b);
}
document.getElementById('fail').onchange = (e) => (FAKE.fail = e.currentTarget.checked);
document.getElementById('play').onclick = () => app.player.toggle();
document.getElementById('undo').onclick = () => app.undo();
const status = document.getElementById('status');
function chrome() {
  for (const b of modes.children) b.classList.toggle('on', b.dataset.mode === app.mode);
  const tk = app.tasks.map((t) => `${t.label} ${t.total ? Math.round((t.done / t.total) * 100) + '%' : '…'}`).join(' · ');
  status.innerHTML = `<span class="${app.sidecar}">sidecar ${app.sidecar}</span><span>${tk}</span><span style="flex:1"></span>`
    + `<span>${(app.player.timeMs / 1000).toFixed(3)} s</span><span>${app.script.length} actions on ${app.doc.activeAxis}</span><span>sel ${app.doc.selection.ats.size}</span><span>undo: ${app.history.undoLabel || '–'}</span>`;
  requestAnimationFrame(chrome);
}
requestAnimationFrame(chrome);

window.H = { app, tr, FAKE, groups: groupsFor(app), setWidth: (px) => document.documentElement.style.setProperty('--pw', px + 'px') };
