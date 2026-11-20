// dev/timeline.js -- harness for the timeline feature: the real mock app (dev/mock-app.js), every timeline lane in
// a stack laid out like the shell's (full-width rows, shared width) with the shell's FallbackLane as the
// reference point lane (drawn by lib/lane.js drawLane, like the lanes agent's), and the timeline panels.
//   ?big=1        60 min doc with 100 000 stroke actions        ?stack=shell   the shell's own Timeline stack
//   ?minutes=N    doc length                                      ?only=plan,ruler  just those lanes (+ reference)
// window.app, window.tl, window.H are set for Playwright.
import '../src/ui/kit/theme.css';
import '../src/style.css';
import { mount } from 'svelte';
import { createMockApp, sampleDoc } from './mock-app.js';
import commands from '../src/features/timeline/commands.js';
import lanes from '../src/features/timeline/lane.js';
import panels from '../src/features/timeline/panel.js';
import { tl } from '../src/features/timeline/state.svelte.js';
import { makeSegment } from '../src/features/timeline/plan.js';
import FallbackLane from '../src/app/FallbackLane.svelte';

const q = new URLSearchParams(location.search);
const big = q.has('big'), minutes = +(q.get('minutes') || (big ? 60 : 10));
const doc = sampleDoc({ minutes, fps: 30 });
const dur = doc.media.durationMs;
function rng(seed = 3) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }
const r = rng(11);

if (big) {   // 100 000 actions: strokes with drifting tempo
  const s = [];
  let t = 500;
  for (let i = 0; i < 100000; i++) { s.push({ at: Math.round(t), pos: i % 2 ? 85 + Math.round(r() * 15) : Math.round(r() * 20) }); t += (dur - 1000) / 100000 * (0.7 + 0.6 * r()); }
  doc.axes.stroke = s.filter((a, i) => !i || a.at > s[i - 1].at);
}

// A story plan across the video (fractions of the duration).
const story = [['idle', 0, 0.03], ['fade-in', 0.03, 0.08], ['foreplay', 0.08, 0.18], ['oral', 0.18, 0.3], ['offscreen', 0.3, 0.35],
  ['penetration', 0.42, 0.62, { intensity: 0.8 }], ['penetration', 0.62, 0.7, { intensity: 1 }], ['knotting', 0.7, 0.78], ['climax', 0.78, 0.84], ['afterglow', 0.84, 0.95], ['outro', 0.95, 1]];
doc.plan = story.map(([kind, a, b, params], i) => makeSegment({ id: 'seg' + i, t0: Math.round(a * dur), t1: Math.round(b * dur), kind, params }));

// Synthetic scene detection (into doc.scenes, like the tracking feature): cuts every 15-60 s; some loop, some described.
const scenes = [];
for (let t = 0; t < dur;) {
  const e = Math.min(dur, t + Math.round(15000 + r() * 45000));
  const s = { start_ms: t, end_ms: e, sign: 1 };
  const k = r();
  if (k < 0.3) s.loop = { kind: 'exact', period_ms: 2400, period_frames: 72, confidence: 0.92, cycles: Math.floor((e - t) / 2400), motion_period_ms: 2400, motion_period_frames: 72, prominence: 1.3 };
  else if (k < 0.5) s.loop = { kind: 'periodic', period_ms: null, period_frames: null, confidence: 0.2, cycles: 0, motion_period_ms: 820, motion_period_frames: 25, prominence: 0.4 };
  if (r() < 0.4) s.describe = { summary: { count: '2', species: [['wolf', 'fox'], ['dragon'], ['cat', 'wolf']][Math.floor(r() * 3)], acts: [['oral'], ['penetration'], ['knotting', 'penetration']][Math.floor(r() * 3)], knot: r() < 0.3 }, tags: [] };
  scenes.push(s);
  t = e;
}

doc.scenes = scenes;
const app = createMockApp({ commands, doc });
app.setView({ start: 0, span: dur });
window.app = app; window.tl = tl;

const only = q.get('only')?.split(',');
const stack = document.getElementById('stack');
if (q.get('stack') === 'shell') {
  const [{ default: Timeline }, { Layout }] = await Promise.all([import('../src/app/Timeline.svelte'), import('../src/app/layout.svelte.js')]);
  mount(Timeline, { target: stack, props: { app, layout: new Layout(app) } });
} else {
  const rows = [
    ...lanes.filter((l) => !only || only.some((o) => l.id.endsWith(o))),
    { id: 'ref:stroke', title: 'stroke', order: 50, height: 'fill', ref: 'stroke' },
    { id: 'ref:roll', title: 'roll', order: 51, height: 60, ref: 'roll' },
  ].sort((a, b) => a.order - b.order);
  for (const l of rows) {
    const row = document.createElement('div');
    row.className = 'hrow' + (l.height === 'fill' ? ' fill' : '');
    row.dataset.lane = l.id;
    if (l.height !== 'fill') row.style.height = l.height + 'px';
    row.innerHTML = `<div class="hcontent"></div><div class="htag">${l.title}</div>`;
    stack.appendChild(row);
    const target = row.querySelector('.hcontent');
    if (l.ref) mount(FallbackLane, { target, props: { app, axis: l.ref } });
    else mount(l.component, { target, props: { app, height: l.height } });
  }
}
const side = document.getElementById('side');
for (const p of panels) {
  const el = document.createElement('section');
  el.className = 'pnl';
  el.dataset.panel = p.id;
  el.innerHTML = `<div class="ttl">${p.title}</div><div class="body"></div>`;
  side.appendChild(el);
  mount(p.component, { target: el.querySelector('.body'), props: { app } });
}

document.getElementById('play').onclick = () => app.player.toggle();
document.getElementById('undo').onclick = () => app.undo();
document.getElementById('redo').onclick = () => app.redo();
const info = document.getElementById('info'), out = document.getElementById('out');
const fmt = (ms) => (ms / 1000).toFixed(3) + 's';
(function loop() {
  info.textContent = `t ${fmt(app.player.timeMs)}  view ${fmt(app.view.start)} +${fmt(app.view.span)}  actions ${app.script.length}  plan ${app.doc.plan.length}  focus ${tl.focus}  undo: ${app.history.undoLabel || '-'}`;
  out.textContent = JSON.stringify({ t: app.player.timeMs, view: app.view, plan: app.doc.plan.length, chapters: app.doc.chapters.length, undo: app.history.undoLabel });
  requestAnimationFrame(loop);
})();

// Helpers for Playwright: geometry of a lane's content box, and x of a time in it.
window.H = {
  rect: (id) => document.querySelector(`[data-lane="${id}"] .hcontent, [data-tl-lane="${id}"]`)?.getBoundingClientRect().toJSON(),
  xOf: (id, t) => { const b = window.H.rect(id); return b.left + ((t - app.view.start) / app.view.span) * b.width; },
};
