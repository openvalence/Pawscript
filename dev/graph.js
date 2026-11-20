// dev/graph.js -- harness for the graph editor (DESIGN 8.1): the real mock app (dev/mock-app.js: the shell's store,
// undo, commands, keymap) with sampleDoc() plus a synthetic plan of real kinds, a 10-min 100k-action tracker
// ghost and a fake tracking run (samples + confidence) for src.run; FallbackLane canvases for stroke and roll
// so graph ghosts are visible; the probe lane; the Graph panel with the real engine, catalogue and controller.
// Query: ?preset=<id> opens a graph from a preset, ?stress=1 builds the 200-node / 400-wire graph, ?light=1
// skips the 100k ghost. window.H = { app, ctl, ui, model } for Playwright.
import '../src/ui/kit/theme.css';
import { mount } from 'svelte';
import { createMockApp, sampleDoc } from './mock-app.js';
import FallbackLane from '../src/app/FallbackLane.svelte';
import commands from '../src/features/graph/commands.js';
import panel from '../src/features/graph/panel.js';
import lane from '../src/features/graph/lane.js';
import { graphUI } from '../src/features/graph/ui.svelte.js';
import { ctlOf, realController, PRESETS } from '../src/features/graph/deps.js';
import * as model from '../src/lib/graph/model.js';

const q = new URLSearchParams(location.search);
const MIN = 10, DUR = MIN * 60000;

/** Deterministic PRNG. */
const rng = (seed = 3) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

/** n actions of tracker-like motion over the whole duration: varying tempo and depth, noise, dropouts. */
function trackerGhost(n = 100000) {
  const r = rng(11), out = [], step = DUR / n;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = Math.round(i * step);
    if (t > DUR * 0.36 && t < DUR * 0.40) continue;                       // a dropout
    const tempo = 1.6 + Math.sin(t / 47000) * 0.7 + (t > DUR * 0.7 && t < DUR * 0.82 ? 1.2 : 0);
    ph += (step / 1000) * tempo * Math.PI * 2;
    const depth = 35 + 25 * Math.sin(t / 91000);
    out.push({ at: t, pos: Math.max(0, Math.min(100, Math.round(50 + depth * Math.sin(ph) + (r() - 0.5) * 14))) });
  }
  return out.filter((a, i) => !i || a.at > out[i - 1].at);
}

function plan() {
  const kinds = [['foreplay', 0, 0.12], ['oral', 0.12, 0.3], ['penetration', 0.3, 0.55], ['knotting', 0.55, 0.68], ['penetration', 0.68, 0.82], ['climax', 0.82, 0.9], ['afterglow', 0.9, 1]];
  return kinds.map(([kind, a, b], i) => ({ id: 'pl' + i, t0: Math.round(a * DUR), t1: Math.round(b * DUR), kind, recipe: kind === 'climax' ? 'climax' : 'strokes', params: {}, name: kind }));
}

const doc = sampleDoc({ minutes: MIN });
doc.plan = plan();
if (!q.has('light')) doc.ghosts = [...doc.ghosts, { id: 'trk100k', name: 'Tracker 100k (synthetic)', color: '#1FD0F0', script: trackerGhost(), visible: false, source: { kind: 'tracker', tracker: 'synthetic' } }];

const app = createMockApp({ commands, doc });
const ui = graphUI(app);

// a fake tracking run so src.run has samples, confidence and events (the tracking feature's store, when present)
try {
  const T = await import('../src/features/tracking/tracking.svelte.js');
  const R = await import('../src/lib/runs.js');
  // two runs (mix-trackers binds two): different noise, and confidences that trade places over time
  const fakeRun = (n, id, name, seed, confPhase, lostAt) => {
    const r = rng(seed), samples = [], conf = [];
    for (let t = 0; t < DUR; t += 33) {
      const lost = t > DUR * lostAt && t < DUR * (lostAt + 0.04);
      samples.push([t, lost ? null : 0.5 + 0.4 * Math.sin(t / 260) + (r() - 0.5) * 0.08 * n]);
      conf.push([t, lost ? 0.05 : 0.6 + 0.35 * Math.sin(t / 15000 + confPhase) ** 2]);
    }
    const run = R.makeRun({ n, tracker: { id: 'flow', name }, params: {}, range: { start: 0, end: DUR }, roi: null,
      result: { samples, confidence: conf, points: doc.ghosts[0].script, scenes: [{ start_ms: 0, end_ms: DUR * 0.5, sign: 1 }, { start_ms: DUR * 0.5, end_ms: DUR, sign: -1 }], events: [{ t_ms: DUR * 0.85, end_ms: DUR * 0.9, kind: 'climax' }] },
      frames: null, runs: [] });
    run.id = id;
    return run;
  };
  const runs = [fakeRun(1, 'run1', 'Flow (fake)', 5, 0, 0.36), fakeRun(2, 'run2', 'Flow B (fake)', 9, Math.PI / 2, 0.6)];
  // the store's first effect calls openVideo(media path), which resets runs: open it now (a no-op later), then add
  const store = T.trackingFor(app);
  store.openVideo(app.doc.media?.path || null);
  store.runs = runs;
  await Promise.resolve();
  if (T.peekTracking?.(app)?.runs?.length !== runs.length) console.warn('[graph harness] the fake tracking runs did not stick');
} catch (e) { console.warn('[graph harness] no fake tracking run:', e.message); }

mount(FallbackLane, { target: document.getElementById('lane-stroke'), props: { app, axis: 'stroke' } });
mount(FallbackLane, { target: document.getElementById('lane-roll'), props: { app, axis: 'roll' } });
mount(lane.component, { target: document.getElementById('lane-probe'), props: { app, height: 56 } });
mount(panel.component, { target: document.getElementById('panel'), props: { app } });

const ctl = ctlOf(app);
window.H = { app, ui, ctl, model };

// ---- toolbar ----
const sel = document.getElementById('preset');
for (const p of PRESETS) sel.add(new Option(p.name, p.id));
sel.onchange = () => { if (!sel.value) return; const id = ctl.newGraph({ name: sel.options[sel.selectedIndex].text, preset: sel.value }); ctl.openGraph(id); sel.value = ''; };
document.getElementById('play').onclick = () => app.player.toggle();
document.getElementById('stress').onclick = () => stress();

/** 200 nodes, ~400 wires: a lattice of amp.gain nodes over the stroke axis (script in + a modulating signal). */
export function stress(n = 200) {
  const reg = ctl.registry;
  let g = model.emptyGraph({ name: `Stress ${n}` });
  const add = (type, x, y, params) => { const r = model.addNode(g, reg, type, { x, y, params }); g = r.graph; return r.id; };
  const src = add('src.axis', 0, 0, { axis: 'stroke' });
  const ids = [];
  const cols = 20;
  for (let i = 0; i < n - 2; i++) ids.push(add('amp.gain', 260 + (i % cols) * 260, Math.floor(i / cols) * 200, { gain: 1 + (i % 7) * 0.01 }));
  const out = add('out.ghost', 260 + cols * 260, 0, { name: 'stress' });
  const link = (from, to, inp) => { const r = model.connect(g, reg, { from, out: 'script', to, in: inp }); if (r.id) g = r.graph; };
  ids.forEach((id, i) => {
    link(i ? ids[i - 1] : src, id, 'script');
    link(i > 1 ? ids[i - 2] : src, id, 'p:pivot');
  });
  link(ids[ids.length - 1], out, 'script');
  const r = ctl.importGraph(JSON.stringify({ format: 'pawgraph', version: 1, graph: g }));
  if (r?.id) ctl.openGraph(r.id);
  return { nodes: g.nodes.length, links: g.links.length };
}

const info = document.getElementById('info');
info.textContent = `${realController ? 'controller: integration' : 'controller: MISSING (integration.js not landed)'} · ${ctl?.registry?.list().length ?? 0} node types · ${PRESETS.length} presets · ${(doc.ghosts.at(-1)?.script.length ?? 0).toLocaleString()} actions in the tracker ghost`;

if (q.get('preset') && ctl) { const p = PRESETS.find((x) => x.id === q.get('preset')); const id = ctl.newGraph({ name: p?.name || q.get('preset'), preset: q.get('preset') }); ctl.openGraph(id); }
if (q.has('stress') && ctl) stress(+q.get('stress') > 2 ? +q.get('stress') : 200);
