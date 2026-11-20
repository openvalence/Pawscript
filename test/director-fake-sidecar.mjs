// director-fake-sidecar.mjs -- a synthetic world for the director (harness dev/director.js and node tests): a 60 s clip
// with six scenes shaped like trace 2 (title, static penetration, knotting with a stroke-locked camera, off-screen with a
// push-in, climax, credits), and the sidecar commands of trackers/PROTOCOL.md plus the director's (contract README §8:
// frames, motion.stats, motion.compare, motion.propose, director.ask), answered from that world.
//   import { makeFakeSidecar, WORLD } from './director-fake-sidecar.mjs'
//   const fake = makeFakeSidecar({ delay: 4 });  fake.sidecar(req, {onEvent, onFrames}) -> {result, error, cancelled}
//   fake.cancel()   fake.requests (every request)   fake.knobs {failCmd: 'motion.compare' | null, ...}
// As a CLI (`node test/director-fake-sidecar.mjs`, PAWTRACK_CMD for a Tauri test instance): answers the director
// commands itself and hands every other command to test/fake-pawtrack.mjs.
// Truth the director has to find: s1's subject runs are right as tracked (+1), s2's are mirrored (-1).

const SUM = (acts, o = {}) => ({ count: 'duo', species: ['canine'], acts, visible_parts: [], knot: false, rating: 'explicit', positions: [], views: ['side_view'], ...o });
const BLACK = { count: 'unknown', species: [], acts: [], visible_parts: [], knot: false, rating: 'safe', positions: [], views: [] };
// [start, end, summary, loop kind, camera mode, truth sign, stroke Hz]
export const WORLD = {
  media: { duration_ms: 60027, fps: 29.97, is_vfr: false, width: 640, height: 360, frame_count: 1799 },
  scenes: [
    [0, 4000, BLACK, null, 'static', 1, 0],
    [4000, 24000, SUM(['anal_penetration'], { views: ['from_behind'] }), 'exact', 'static', 1, 1.25],
    [24000, 38000, SUM(['anal_knotting'], { knot: true, visible_parts: ['knot', 'penis'] }), 'periodic', 'rides', -1, 1.3],
    [38000, 48000, SUM(['sex']), 'periodic', 'move', 1, 1.5],
    [48000, 56000, SUM(['sex'], { visible_parts: ['penis'] }), null, 'sway', 1, 0.8],
    [56000, 60027, BLACK, null, 'static', 1, 0],
  ],
};
const at = (t) => WORLD.scenes.find(([a, b]) => t >= a && t < b) || WORLD.scenes[WORLD.scenes.length - 1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const P = (key, label, type, def, min = null, max = null, choices = null) => ({ key, label, type, default: def, min, max, choices });
const shared = [P('pipe_gate', 'Activity gate', 'choice', 'motion', null, null, ['off', 'motion']), P('pipe_invert', 'Invert direction', 'bool', false)];
const axis = [P('axis', 'Stroke axis', 'choice', 'auto', null, null, ['auto', 'vertical', 'horizontal', 'custom']), P('axis_x0', 'x0', 'float', 0.5), P('axis_y0', 'y0', 'float', 0), P('axis_x1', 'x1', 'float', 0.5), P('axis_y1', 'y1', 'float', 1)];
export const TRACKERS = [
  { id: 'lk_box', name: 'Optical flow (box)', roi: 'box', channels: [], params: [...axis, ...shared] },
  { id: 'cotracker_points', name: 'CoTracker (points)', roi: 'points', channels: ['proj', 'dist01'], params: [...axis, P('primary', 'Primary', 'choice', 'proj', null, null, ['proj', 'dist01', 'centroid_y']), ...shared] },
  { id: 'sam2_mask', name: 'SAM 2 mask', roi: 'box_or_points', channels: ['area', 'centroid_y', 'len_over_width'], params: [P('primary', 'Primary', 'choice', 'len_over_width', null, null, ['area', 'centroid_y', 'len_over_width']), ...shared] },
];
const TINY_JPEG = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

/** Is this whole-frame-ish (follows the camera, not the subject)? */
const isFrame = (roi) => roi?.kind === 'box' && roi.w >= 0.9 && roi.h >= 0.9;
/** The value a tracker sees at t: the subject's stroke (with the scene's truth sign baked in mirrored), or the camera. */
function valueAt(t, roi, tracker) {
  const [, , , , cam, sign, hz] = at(t), ph = 2 * Math.PI * (t / 1000) * (hz || 0.3);
  const camV = cam === 'rides' ? 0.5 - 0.3 * Math.cos(ph + 0.8) : cam === 'move' ? Math.min(1, ((t % 10000) / 10000)) : cam === 'sway' ? 0.5 + 0.2 * Math.sin(ph) : 0.5;
  if (isFrame(roi) || hz === 0) return camV + (tracker === 'lk_box' ? 0.02 * Math.sin(t / 37) : 0);
  if (cam === 'move' || cam === 'sway') return camV;   // nothing of the subject is visible: every measure is the camera
  const s = 0.5 - 0.5 * Math.cos(ph);                   // as tracked, "deep" is the low end when sign = +1
  return sign > 0 ? s : 1 - s;
}
function tiles(times, labels) { return times.map((t, k) => ({ t_ms: t, x: k * 160, y: 0, w: 160, h: 90, label: labels?.[k] ?? `${(t / 1000).toFixed(1)} s` })); }
function turnsOf(t, v) {
  const out = [];
  for (let i = 1; i + 1 < v.length; i++) { if (v[i] == null || v[i - 1] == null || v[i + 1] == null) continue; if ((v[i] - v[i - 1]) * (v[i + 1] - v[i]) < 0 && Math.abs(v[i] - v[i - 1]) + Math.abs(v[i + 1] - v[i]) > 1e-6) out.push(t[i]); }
  return out.filter((x, k, a) => !k || x - a[k - 1] > 120);
}
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
function matchFrac(a, b, ms) { if (!a.length) return 0; let n = 0, j = 0; const off = []; for (const x of a) { while (j + 1 < b.length && Math.abs(b[j + 1] - x) <= Math.abs(b[j] - x)) j++; if (b.length && Math.abs(b[j] - x) <= ms) { n++; off.push(Math.abs(b[j] - x)); } } return { match: n / a.length, off: median(off) ?? 0 }; }
function corr(a, b) {
  const n = Math.min(a.length, b.length), x = [], y = [];
  for (let i = 0; i < n; i++) if (a[i] != null && b[i] != null) { x.push(a[i]); y.push(b[i]); }
  if (x.length < 3) return 0;
  const mx = x.reduce((s, v) => s + v, 0) / x.length, my = y.reduce((s, v) => s + v, 0) / y.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx && syy ? +(sxy / Math.sqrt(sxx * syy)).toFixed(3) : 0;
}

export function makeFakeSidecar({ delay = 4, write = null } = {}) {
  const S = { cancelled: false, requests: [], knobs: { failCmd: null } };
  const done = (r) => ({ result: null, error: null, cancelled: false, ...r });
  const media = WORLD.media, sceneOf = (start) => WORLD.scenes.find(([a]) => a === start);

  async function track(req, onEvent, onFrames) {
    const frameMs = 1000 / media.fps, total = Math.max(1, Math.floor((req.end_ms - req.start_ms) / frameMs));
    const samples = [], channels = {};
    let batch = [];
    for (let i = 0; i <= total; i++) {
      if (S.cancelled) return { cancelled: true };
      const tm = Math.round(req.start_ms + i * frameMs), v = +valueAt(tm, req.roi, req.tracker).toFixed(4);
      batch.push({ type: 'frame', t_ms: tm, value: v, overlay: { points: [[0.5, 1 - v]], boxes: req.roi?.kind === 'box' ? [[req.roi.x, req.roi.y, req.roi.w, req.roi.h]] : [] } });
      samples.push([tm, v]);
      if (i % 30 === 29 || i === total) { onFrames?.(batch); batch = []; onEvent?.({ type: 'progress', done: i, total }); if (delay) await sleep(delay); }
    }
    if (req.tracker === 'sam2_mask') channels.area = samples.map(([t, v]) => [t, +(0.02 + 0.01 * v).toFixed(5)]);
    const ts = samples.map((x) => x[0]), vs = samples.map((x) => x[1]), tt = new Set(turnsOf(ts, vs));
    const points = samples.filter(([t]) => tt.has(t)).map(([t, v]) => ({ at: t, pos: Math.round(v * 100) }));
    const scenes = WORLD.scenes.filter(([a, b]) => b > req.start_ms && a < req.end_ms).map(([a, b]) => ({ start_ms: Math.max(a, req.start_ms), end_ms: Math.min(b, req.end_ms), sign: 1, auto_sign: null }));
    return { result: { type: 'result', samples, points, events: [], media, scenes, channels, confidence: samples.map(([t]) => [t, 0.9]) } };
  }

  function stats(r) {
    const [a, , , , cam, , hz] = sceneOf(r.start_ms) || at(r.start_ms), hzS = 15, n = Math.max(1, Math.round(((r.end_ms - r.start_ms) / 1000) * hzS));
    const g = { hz: hzS, dx: [], dy: [], zoom: [] };
    for (let k = 0; k < n; k++) {
      const t = r.start_ms + (k * 1000) / hzS, ph = 2 * Math.PI * (t / 1000) * (hz || 0.3);
      g.dx.push(cam === 'sway' ? +(6 * Math.sin(ph)).toFixed(2) : 0); g.dy.push(cam === 'rides' ? +(34 * Math.cos(ph + 0.8)).toFixed(2) : 0); g.zoom.push(cam === 'move' ? +(k / n * 0.05).toFixed(4) : 0);
    }
    const secs = Array.from({ length: Math.ceil((r.end_ms - r.start_ms) / 1000) }, (_, k) => r.start_ms + k * 1000);
    const black = !hz && (a === 0 || a >= 56000);
    return {
      start_ms: r.start_ms, end_ms: r.end_ms,
      camera: { mode: cam, p95_px: cam === 'static' ? 1.2 : cam === 'rides' ? 34 : cam === 'move' ? 22 : 9, zoom_pct: cam === 'move' ? 5 : 0.1, rate_hz: cam === 'rides' ? hz * 2 : null, phase_ms: cam === 'rides' ? 177 : null,
        move_spans: cam === 'move' ? [[r.start_ms + 2500, r.end_ms]] : [], stroke_lock: cam === 'rides' || cam === 'move' ? { rate_hz: (hz || 1.5) * 2, cv: 0.08, phase_ms: 177 } : null },
      global: g,
      energy: { t: secs, v: secs.map((t) => (black ? 0.01 : a === 48000 ? +(1 - (t - 48000) / 9000).toFixed(3) : hz ? 0.6 : 0.05)) },
      still: black ? [[r.start_ms, r.end_ms]] : [],
      heat: Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) => (hz && x > 2 && x < 6 && y > 2 && y < 6 ? 0.8 : 0.05))),
      seconds: secs.map((t) => ({ t, bright: black ? 3 : 90, black: black && a === 0, credits_like: a >= 56000 ? 0.9 : 0.02 })),
    };
  }

  function compare(req) {
    const series = req.series.map((s) => {
      const turns = turnsOf(s.t, s.v), dur = (req.t1 - req.t0) / 1000, iv = turns.slice(1).map((x, k) => x - turns[k]);
      const mean = iv.length ? iv.reduce((p, x) => p + x, 0) / iv.length : 0, sd = iv.length ? Math.sqrt(iv.reduce((p, x) => p + (x - mean) ** 2, 0) / iv.length) : 0;
      const camT = req.camera ? turnsOf(req.camera.t, req.camera.dy.map((y, k) => y || req.camera.dx[k])) : [];
      const cm = camT.length > 2 ? matchFrac(turns, camT, 120) : null;
      const frame = s.role === 'reference';
      return { id: s.id, turns: turns.length, turns_per_s: +(turns.length / dur).toFixed(2), half_cv: +(mean ? sd / mean : 1).toFixed(3), coverage: +(s.v.filter((v) => v != null).length / Math.max(1, s.v.length)).toFixed(3),
        gaps: [], cycle_ms: mean ? Math.round(2 * mean) : null, vs_loop: req.loop_period_ms && mean ? +((2 * mean) / req.loop_period_ms).toFixed(2) : null,
        camera_share: cm ? +(frame ? Math.max(cm.match, 0.92) : cm.match).toFixed(2) : frame ? 0.95 : null, camera_offset_ms: cm ? (frame ? 8 : Math.max(cm.off, 177)) : frame ? 8 : null };
    });
    const pairs = [];
    for (let i = 0; i < req.series.length; i++) for (let j = i + 1; j < req.series.length; j++) {
      const a = req.series[i], b = req.series[j], m = matchFrac(turnsOf(a.t, a.v), turnsOf(b.t, b.v), req.match_ms || 120);
      pairs.push({ a: a.id, b: b.id, corr: corr(a.v, b.v), match: +m.match.toFixed(2), median_offset_ms: m.off });
    }
    return { type: 'result', series, pairs };
  }

  async function sidecar(req, { onEvent = () => {}, onFrames = () => {} } = {}) {
    S.cancelled = false;
    S.requests.push(req);
    await sleep(Math.min(10, delay * 3));
    if (S.knobs.failCmd === req.cmd) return done({ error: `${req.cmd}: fake failure` });
    switch (req.cmd) {
      case 'list': return done({ result: { type: 'result', trackers: TRACKERS, scene_params: [], loop_params: [], describe_params: [P('min_score', 'Min tag score', 'float', 0.3, 0, 1)] } });
      case 'probe': return done({ result: { type: 'result', media } });
      case 'scenes': onEvent({ type: 'progress', done: 1, total: 1 }); return done({ result: { type: 'result', scenes: WORLD.scenes.map(([a, b]) => ({ start_ms: a, end_ms: b })), media } });
      case 'describe': {
        const sc = sceneOf(req.start_ms), sum = sc?.[2] || BLACK, figs = sum.acts.length ? [['canine', 0.92, [0.25, 0.2, 0.5, 0.7]], ...(sum.knot ? [['knot', 0.6, [0.45, 0.5, 0.1, 0.1]]] : [])] : [];
        const per = sc && sc[0] === 48000 ? [{ t_ms: 48500, scores: { cum: 0.2 } }, { t_ms: 49200, scores: { cum: 0.81 } }] : [];
        return done({ result: { type: 'result', model: 'fake-tagger', media, tags: figs.map(([tag, score, box]) => ({ tag, score, box })), summary: sum, per_frame: per } });
      }
      case 'loop': {
        const sc = sceneOf(req.start_ms), kind = sc?.[3] ?? null, ms = sc?.[6] ? Math.round(1000 / sc[6]) : null;
        return done({ result: { type: 'result', period_ms: kind === 'exact' ? ms : null, period_frames: null, confidence: kind ? 0.9 : 0.1, cycles: kind === 'exact' ? 10 : 0, kind, prominence: kind ? (kind === 'exact' ? 1.4 : 0.5) : 0,
          motion_period_frames: null, motion_period_ms: kind ? ms : null, held: { step: 1, ratio: 0 }, media } });
      }
      case 'track': return done(await track(req, onEvent, onFrames));
      case 'score': return done({ result: { type: 'result', overall: { f1: 0.5 }, scenes: [] } });
      case 'motion.stats': return done({ result: { type: 'result', ranges: req.ranges.map(stats) } });
      case 'motion.compare': return done({ result: compare(req) });
      case 'motion.propose': {
        const [, , sum, , cam] = at(req.start_ms);
        if (!sum.acts.length || cam === 'move') return done({ result: { type: 'result', candidates: [] } });
        return done({ result: { type: 'result', candidates: [{ box: { x: 0.4, y: 0.35, w: 0.2, h: 0.25 }, axis: [0.62, 0.48, 0.42, 0.48], points: [[0.45, 0.42], [0.5, 0.45], [0.55, 0.44], [0.52, 0.5]],
          pair: cam === 'rides' ? [[0.44, 0.5], [0.58, 0.48]] : null, power: 0.41, cam_corr: cam === 'rides' ? 0.7 : 0.1 }] } });
      }
      case 'frames': {
        const images = [];
        for (const j of req.jobs || []) {
          const times = j.times_ms || Array.from({ length: Math.max(1, Math.floor((j.t1 - j.t0) / (j.step_ms || 500))) }, (_, k) => j.t0 + k * (j.step_ms || 500));
          if (j.dest && write) await write(j.dest, TINY_JPEG);
          images.push({ dest: j.dest || null, b64: j.dest ? null : TINY_JPEG, w: 160 * times.length, h: 90, tiles: tiles(times, j.tile_labels) });
        }
        return done({ result: { type: 'result', images } });
      }
      case 'director.ask': return done({ result: { type: 'result', probs: req.items.map(() => Object.fromEntries(req.choices.map((c, k) => [c, k ? 0.2 / (req.choices.length - 1) : 0.8]))), s: 0.1, load_s: 0, model: req.model } });
      default: return done({ error: 'unknown cmd ' + req.cmd });
    }
  }
  return { sidecar, cancel() { S.cancelled = true; }, requests: S.requests, knobs: S.knobs, S };
}

// ---- CLI: director commands here, the rest to fake-pawtrack.mjs ----
const DIRECTOR_CMDS = new Set(['frames', 'motion.stats', 'motion.compare', 'motion.propose', 'director.ask']);
if (typeof process !== 'undefined' && process.argv?.[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => (buf += d));
  process.stdin.on('end', async () => {
    const req = JSON.parse(buf);
    if (DIRECTOR_CMDS.has(req.cmd)) {
      const fs = await import(/* @vite-ignore */ 'node:' + 'fs');
      const r = await makeFakeSidecar({ delay: 0, write: (p, b64) => fs.writeFileSync(p, Buffer.from(b64, 'base64')) }).sidecar(req);
      process.stdout.write(JSON.stringify(r.error ? { type: 'error', message: r.error } : r.result) + '\n');
      process.exit(r.error ? 1 : 0);
    }
    const cp = await import(/* @vite-ignore */ 'node:' + 'child_process');
    const child = cp.spawn(process.execPath, [new URL('./fake-pawtrack.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], { stdio: ['pipe', 'inherit', 'inherit'] });
    child.on('exit', (c) => process.exit(c ?? 0));
    child.stdin.end(buf);
  });
}
