// Fixtures for the director brain tests: a fact sheet shaped like trace 2's video (4 scenes, 103.9 s),
// describe summaries, motion.stats camera facts, motion.compare run stats and fake frame descriptors. Synthetic
// numbers chosen to match what DIRECTOR-TRACE-2 measured; no frames.
import { makeRequest } from '../src/lib/director/decisions.js';

export const DUR = 103941;
export const VIDEO = { path: 'C:/fake/clip.mp4', dur: DUR, fps: 45, w: 1600, h: 1400 };
const CUTS = [0, 26489, 40444, 56222, DUR];

const range = (a, b, step = 1000) => { const o = []; for (let t = a; t < b; t += step) o.push(t); return o; };
const energy = (t0, t1, f) => { const t = range(t0 + 500, t1); return { t, v: t.map(f) }; };
const seconds = (t0, t1, f = () => ({})) => range(t0, t1).map((t) => ({ t, bright: 70, black: false, creditsLike: 0.02, ...f(t) }));
const heat = (hot = 0.5) => Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => (r > 0 && r < 7 && c > 0 && c < 7 ? hot : 0.05 + 0.01 * (r + c))));
const D = (o) => ({ acts: [], parts: [], knot: false, count: 'duo', views: [], rating: 'explicit', boxes: [], cumOnsetMs: null, ...o });

export const SCENES = [
  { i: 0, t0: 0, t1: 26489,
    describe: D({ acts: ['sex', 'anal'], views: ['from_behind'], boxes: [{ tag: 'sex', box: { x: 0.4, y: 0.35, w: 0.45, h: 0.4 }, score: 0.8 }] }),
    loop: { periodMs: 889, prominence: 0.18, confidence: 0.4, held: 1 },
    camera: { mode: 'static', p95Px: 1.2, zoomPct: 0.1, rateHz: null, phaseMs: null, moveSpans: [], strokeLock: null },
    energy: energy(0, 26489, (t) => (t < 4500 ? 0.043 : 0.057)), still: [], heat: heat(), seconds: seconds(0, 26489) },
  { i: 1, t0: 26489, t1: 40444,
    describe: D({ acts: ['sex'], parts: ['penis', 'balls', 'knot'], knot: true, views: ['close-up', 'from_below'],
      boxes: [{ tag: 'knot', box: { x: 0.38, y: 0.2, w: 0.26, h: 0.33 }, score: 0.7 }] }),
    loop: { periodMs: 778, prominence: 0.9, confidence: 0.9, held: 1 },
    camera: { mode: 'rides', p95Px: 34, zoomPct: 0.4, rateHz: 1.27, phaseMs: 177, moveSpans: [], strokeLock: { rateHz: 1.27, cv: 0.18, phaseMs: 177 } },
    energy: energy(26489, 40444, () => 0.06), still: [], heat: heat(), seconds: seconds(26489, 40444) },
  { i: 2, t0: 40444, t1: 56222,
    describe: D({ acts: ['sex'], parts: ['tail'] }),
    loop: { periodMs: null, prominence: 0.09, confidence: 0, held: 0 },
    camera: { mode: 'move', p95Px: 17, zoomPct: 6, rateHz: 1.5, phaseMs: null, moveSpans: [[40500, 50000]], strokeLock: { rateHz: 1.5, cv: 0.17, phaseMs: 120 } },
    energy: energy(40444, 56222, () => 0.05), still: [], heat: heat(), seconds: seconds(40444, 56222) },
  { i: 3, t0: 56222, t1: DUR,
    describe: D({ acts: [], cumOnsetMs: 56800 }),
    loop: { periodMs: null, prominence: 0.04, confidence: 0, held: 0 },
    camera: { mode: 'sway', p95Px: 7, zoomPct: 0.2, rateHz: null, phaseMs: null, moveSpans: [], strokeLock: null },
    energy: energy(56222, DUR, (t) => (t < 64000 ? 0.07 : t < 66300 ? 0.05 : t < 80400 ? 0.03 * (1 - (t - 66300) / 14100) + 0.006 : 0.001)),
    still: [[80400, DUR]], heat: heat(0.2), seconds: seconds(56222, DUR, (t) => (t >= 84800 ? { creditsLike: 0.9 } : {})) },
];
export const SHEET = { video: VIDEO, scenes: SCENES };
export const sc = (i) => ({ scene: i, t0: CUTS[i], t1: CUTS[i + 1] });

// motion.compare per span (camelCased RunStat / PairStat), as trace 2's tracker comparison
const run = (o) => ({ role: 'subject', turns: 50, coverage: 1, gaps: [], cycleMs: 900, vsLoop: 1, cameraShare: 0.1, cameraOffsetMs: 200, ...o });
export const RUNS_S0 = [
  run({ id: 'run25', tracker: 'cotracker_points', channel: 'proj', turnsPerS: 2.15, halfCv: 0.21, cycleMs: 930 }),
  run({ id: 'run23', tracker: 'cotracker_points', channel: 'proj', turnsPerS: 2.1, halfCv: 0.22, coverage: 0.77 }),
  run({ id: 'run7', tracker: 'tapnext_points', channel: 'centroid_x', turnsPerS: 2.2, halfCv: 0.25 }),
  run({ id: 'run24', tracker: 'sam2_mask', channel: 'centroid_x', turnsPerS: 2.4, halfCv: 0.45 }),
  run({ id: 'run10', tracker: 'lk_box', channel: 'primary', turnsPerS: 1.66, halfCv: 0.97, gaps: [[10900, 16300]], coverage: 0.8 }),
  run({ id: 'run8', role: 'base', tracker: 'lk_box', channel: 'primary', turnsPerS: 0.78, halfCv: 0.6 }),
  run({ id: 'run9', role: 'reference', tracker: 'lk_box', channel: 'primary', turnsPerS: 2.15, halfCv: 0.5 }),
];
export const PAIRS_S0 = [
  { a: 'run25', b: 'run23', corr: 1, match: 1, medianOffsetMs: 0 },
  { a: 'run25', b: 'run7', corr: 0.92, match: 0.82, medianOffsetMs: 22 },
  { a: 'run25', b: 'run24', corr: 0.52, match: 0.6, medianOffsetMs: 66 },
];
export const RUNS_S1 = [
  run({ id: 'run21', tracker: 'cotracker_points', channel: 'dist01', turnsPerS: 2.51, halfCv: 0.07, cycleMs: 788, cameraShare: 0.12, cameraOffsetMs: 177 }),
  run({ id: 'run22', tracker: 'sam2_mask', channel: 'area', turnsPerS: 2.51, halfCv: 0.31 }),
  run({ id: 'run13', tracker: 'lk_box', channel: 'primary', turnsPerS: 1.22, halfCv: 0.4 }),
];
export const PAIRS_S1 = [{ a: 'run21', b: 'run22', corr: 0.91, match: 0.83, medianOffsetMs: 44 }, { a: 'run21', b: 'run13', corr: 0.3, match: 0.49, medianOffsetMs: 355 }];
export const RUNS_S2 = [
  run({ id: 'run16', tracker: 'lk_box', channel: 'primary', turnsPerS: 2.28, halfCv: 0.5, cameraShare: 0.91, cameraOffsetMs: 44 }),
  run({ id: 'run27', tracker: 'cotracker_points', channel: 'proj', turnsPerS: 2.41, halfCv: 0.55, cameraShare: 0.85, cameraOffsetMs: 30 }),
];

// motion.propose candidates (camelCased)
export const CANDS_S0 = [{ box: { x: 0.55, y: 0.5, w: 0.25, h: 0.2 }, axis: [0.78, 0.6, 0.6, 0.6], points: [[0.7, 0.58], [0.72, 0.62], [0.68, 0.6], [0.71, 0.6]], pair: null, power: 0.41, camCorr: 0.12 }];
export const CANDS_S1 = [{ box: { x: 0.4, y: 0.1, w: 0.2, h: 0.5 }, axis: [0.48, 0.55, 0.48, 0.13], points: [[0.48, 0.13], [0.47, 0.55], [0.5, 0.3], [0.46, 0.4]], pair: [[0.48, 0.13], [0.47, 0.55]], power: 0.6, camCorr: 0.2 }];

// pickPairs of the kept run (assist model shape): pos 0 = deepest
export const PICK_S0 = [
  { a: { at: 5100, pos: 2 }, b: { at: 5670, pos: 88 } }, { a: { at: 6700, pos: 3 }, b: { at: 7130, pos: 90 } },
  { a: { at: 9860, pos: 85 }, b: { at: 10320, pos: 1 } }, { a: { at: 13430, pos: 0 }, b: { at: 14040, pos: 87 } },
];

/** Fake frame descriptors for a ToolCall: what a Tools.run would hand back (no pixels). */
export const fakeFrames = (call, dir = 'req/x') => (call.times ?? []).map((t, k) => ({ id: `ev-${t}`, type: 'image', what: `frame ${t} ms`, path: `${dir}/f${k}.jpg`, tiles: [{ t, x: 0, y: 0, w: 320, h: 240, label: String(t) }] }));

export const R = (kind, scope, facts, o) => makeRequest(kind, scope, facts, o);
