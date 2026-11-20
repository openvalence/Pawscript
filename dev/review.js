// dev/review.js -- harness for the Review panels: the real mock app, a document seeded with known problems,
// a strip that draws the script and the shared problem markers, and the four panels side by side.
// window.app / window.H are set for Playwright.
import { mount } from 'svelte';
import { Button, Select, setTheme, setDensity, THEMES, DENSITIES } from '../src/ui/kit/index.js';
import { createMockApp, sampleDoc, mockBackend } from './mock-app.js';
import commands from '../src/features/review/commands.js';
import panels from '../src/features/review/panel.js';
import { getReview } from '../src/features/review/state.svelte.js';
import { getCompare } from '../src/features/review/compare.svelte.js';
import { reviewMarkers } from '../src/features/review/markers.svelte.js';
import { normalize } from '../src/lib/core/script.js';

const strokes = (n, step, t0, lo = 10, hi = 90) => Array.from({ length: n }, (_, i) => ({ at: t0 + i * step, pos: i % 2 ? lo : hi }));

/** 100 s stroke with known problems (times in ms): fast 30s, close 40s, gap 50-62s, flat hold 70s, jitter 80s. */
export function seededDoc() {
  const s = normalize([
    ...strokes(60, 500, 0),                                                   // 0-29.5 s clean, 160 u/s
    { at: 30000, pos: 0 }, { at: 30100, pos: 100 }, { at: 30200, pos: 0 }, { at: 30700, pos: 90 },   // too fast
    ...strokes(18, 500, 31000),                                               // clean to 39.5
    { at: 40000, pos: 10 }, { at: 40030, pos: 90 }, { at: 40500, pos: 10 },   // too close
    ...strokes(16, 500, 41000),                                               // to 48.5
    { at: 50000, pos: 90 },                                                   // gap 50.0 -> 62.0 s
    ...strokes(16, 500, 62000),                                               // to 69.5
    { at: 70000, pos: 50 }, { at: 70400, pos: 50 }, { at: 70800, pos: 50 }, { at: 71200, pos: 50 },   // redundant hold
    ...strokes(16, 500, 72000),
    { at: 80000, pos: 50 }, { at: 80100, pos: 52 }, { at: 80200, pos: 50 }, { at: 80300, pos: 52 }, { at: 80400, pos: 50 }, { at: 80500, pos: 52 },
    ...strokes(30, 500, 82000),
  ]);
  const ghost = normalize(s.filter((_, i) => i % 7 !== 3).map((a) => ({ at: a.at + 30, pos: 100 - a.pos < 0 ? 0 : a.pos })));
  const D = sampleDoc({ minutes: 2 });
  return {
    ...D, axes: { stroke: s, roll: strokes(20, 1500, 3000, 30, 70) }, activeAxis: 'stroke',
    chapters: [{ id: 'c1', t0: 0, t1: 45000, name: 'Intro', color: '#4DA6FF' }, { id: 'c2', t0: 45000, t1: 100000, name: 'Main', color: '#A78BFA' }],
    ghosts: [{ id: 'g1', name: 'Tracker run 1', color: '#3CEBC0', script: ghost, visible: true, source: { kind: 'tracker' } }],
    media: { ...D.media, durationMs: 120000 },
  };
}

/** n actions of plausible motion with a problem every ~2000 actions. */
export function bigScript(n = 100000) {
  const out = []; let t = 0, up = false, seed = 5;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) {
    t += i % 2000 === 1999 ? 40 : 300 + Math.round(r() * 200);
    out.push({ at: t, pos: up ? (i % 2000 === 1999 ? 100 : 80 + Math.round(r() * 15)) : 5 + Math.round(r() * 15) });
    up = !up;
  }
  return normalize(out);
}

const backend = {
  ...mockBackend(),
  score: async (req) => ({ error: null, cancelled: false, result: {
    overall: { f1: 0.81, precision: 0.88, recall: 0.75, tp: 60, fp: 8, fn: 20, lag_ms: 40, dt_median_ms: 33, dt_p90_ms: 90, dt_bias_ms: 12, r_pos: 0.93, r_vel: 0.71, sign: 1 },
    scenes: (req.scenes ?? []).map((s, i) => ({ ...s, t0: s.start_ms, t1: s.end_ms, f1: 0.9 - i * 0.2, lag_ms: 20 * i, sign: 1 })) } }),
};
const app = createMockApp({ commands, doc: seededDoc(), backend });
const rv = getReview(app), cmp = getCompare(app);
rv.flush();

const cols = document.getElementById('cols');
for (const p of panels) {
  const col = document.createElement('div');
  col.className = 'col'; col.dataset.panel = p.id;
  col.innerHTML = `<div class="ttl">${p.title}</div><div class="body"></div>`;
  cols.appendChild(col);
  mount(p.component, { target: col.querySelector('.body'), props: { app } });
}

// ---- strip: script as a line, problems as ticks, diff markers underneath, playhead ----
const cv = document.getElementById('strip'), info = document.getElementById('info');
const SEV = { error: '--bad', warn: '--warn', info: '--info' }, DIFF = { missing: '--series-violet', extra: '--series-pink', differs: '--series-green' };
function draw() {
  const cs = getComputedStyle(document.documentElement), tok = (n) => cs.getPropertyValue(n).trim();
  const sev = { error: tok(SEV.error), warn: tok(SEV.warn), info: tok(SEV.info) }, diff = { missing: tok(DIFF.missing), extra: tok(DIFF.extra), differs: tok(DIFF.differs) };
  const w = cv.clientWidth, h = cv.clientHeight, dpr = devicePixelRatio || 1;
  if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
  const dur = app.durationMs, X = (t) => (t / dur) * w, s = app.script;
  c.strokeStyle = tok('--series-sky'); c.lineWidth = 1; c.beginPath();
  const step = Math.max(1, Math.floor(s.length / (w * 2)));
  for (let i = 0; i < s.length; i += step) { const x = X(s[i].at), y = h - 14 - (s[i].pos / 100) * (h - 24); i ? c.lineTo(x, y) : c.moveTo(x, y); }
  c.stroke();
  for (const m of reviewMarkers.items) if (m.axis === app.doc.activeAxis) { c.fillStyle = sev[m.severity]; c.fillRect(X(m.t0), 0, Math.max(2, X(m.t1) - X(m.t0)), 6); }
  for (const m of reviewMarkers.diff) { c.fillStyle = diff[m.what] ?? diff.differs; c.fillRect(X(m.t0), h - 6, Math.max(2, X(m.t1) - X(m.t0)), 6); }
  const sel = reviewMarkers.selectedId && reviewMarkers.items.find((m) => m.id === reviewMarkers.selectedId);
  if (sel) { c.strokeStyle = tok('--tx-hi'); c.strokeRect(X(sel.t0) - 1.5, 0.5, Math.max(3, X(sel.t1) - X(sel.t0)) + 3, 7); }
  c.fillStyle = tok('--highlight'); c.fillRect(X(app.player.timeMs), 0, 1, h);
  const k = reviewMarkers.counts;
  info.textContent = `${s.length} actions · problems ${k.total} (E${k.error} W${k.warn} I${k.info}) · ${rv.lastMs.toFixed(1)} ms · t=${(app.player.timeMs / 1000).toFixed(1)}s`;
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

const load = (doc) => { app.load(doc); rv.flush(); };
const loadBig = () => { const d = seededDoc(); d.axes.stroke = bigScript(); d.media = { ...d.media, durationMs: d.axes.stroke.at(-1).at + 5000 }; load(d); };

// ---- bar: theme / density (also ?theme=light|contrast&density=compact|comfortable), the two loaders ----
const qs = new URLSearchParams(location.search), tools = document.getElementById('tools');
let theme = qs.get('theme') || 'dark', density = qs.get('density') || 'default';
setTheme(theme); setDensity(density);
const remember = () => { qs.set('theme', theme); qs.set('density', density); history.replaceState(null, '', '?' + qs); };
mount(Select, { target: tools, props: { label: 'Theme', size: 'sm', value: theme, options: THEMES.map((t) => ({ value: t.id, label: t.label })), onchange: (v) => { theme = v; setTheme(v); remember(); } } });
mount(Select, { target: tools, props: { label: 'Density', size: 'sm', value: density, options: DENSITIES.map((d) => ({ value: d, label: d[0].toUpperCase() + d.slice(1) })), onchange: (v) => { density = v; setDensity(v); remember(); } } });
mount(Button, { target: tools, props: { size: 'sm', label: 'Load 100k script', id: 'big', onclick: loadBig } });
mount(Button, { target: tools, props: { size: 'sm', variant: 'ghost', label: 'Reset doc', id: 'reset', onclick: () => load(seededDoc()) } });
window.H = { app, rv, cmp, reviewMarkers, seededDoc, bigScript, load, setWidth: (px) => document.documentElement.style.setProperty('--pw', px + 'px') };
