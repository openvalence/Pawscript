// dev/lanes.js -- harness for the lane editor: the real mock app (dev/mock-app.js) with the lanes commands, laid out
// like the shell's timeline stack (76 px gutter, shared content width), with the timeline's overview and ruler above
// when that feature is present.
//   ?n=100000   stroke gets n actions (60 min doc)      ?axes=4   also fill roll/pitch/twist with as many
//   ?empty=1    no scripts      ?ghost=0  no ghosts      ?bare=1  no timeline rows (isolates lane perf)
//   ?machine=1  the shell's machine preview (Nucleus Capstan profile, planner limits)    ?profile=<id>  device profile
//   ?theme=light|contrast
//   ?theme=light|contrast        ?density=compact|comfortable   (the kit's themes and densities)
// window.app, window.st (lanes state) and window.__lanesPerf (paint times, ms) are set for Playwright.
import '../src/ui/kit/theme.css';
import '../src/style.css';
import { mount } from 'svelte';
import { createMockApp, sampleDoc } from './mock-app.js';
import commands from '../src/features/lanes/commands.js';
import lane from '../src/features/lanes/lane.js';
import { lanes } from '../src/features/lanes/state.svelte.js';
import { setTheme, setDensity } from '../src/ui/kit/tokens.js';

const q = new URLSearchParams(location.search);
if (q.get('theme')) setTheme(q.get('theme'));
if (q.get('density')) setDensity(q.get('density'));
const n = +(q.get('n') || 0), nAxes = +(q.get('axes') || 2);
const doc = sampleDoc({ minutes: n ? 60 : 10, fps: 30 });
const dur = doc.media.durationMs;
function rng(seed = 3) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }
function strokes(count, seed) {
  const r = rng(seed), s = [];
  let t = 500;
  for (let i = 0; i < count; i++) { s.push({ at: Math.round(t), pos: i % 2 ? 80 + Math.round(r() * 20) : Math.round(r() * 25) }); t += ((dur - 1000) / count) * (0.6 + 0.8 * r()); }
  return s.filter((a, i) => !i || a.at > s[i - 1].at);
}
if (n) {
  doc.axes.stroke = strokes(n, 11);
  doc.ghosts[0].script = doc.axes.stroke.filter((_, i) => i % 3 !== 1).map((a) => ({ at: a.at + 40, pos: Math.min(100, a.pos + 5) }));
  doc.ghosts[1].script = doc.axes.stroke;
}
['roll', 'pitch', 'twist'].slice(0, Math.max(0, nAxes - 1)).forEach((id, k) => { if (n || id !== 'roll') doc.axes[id] = n ? strokes(n, 20 + k) : []; });
if (q.get('empty')) doc.axes = { stroke: [] };
if (q.get('ghost') === '0') doc.ghosts = [];

// Pass the array itself: createMockApp wraps it as [commands, core] and the registry flattens two levels.
// scenes (app.doc.scenes, the sidecar shape): a cut every 20-50 s
const rs = rng(5);
doc.scenes = [];
for (let t = 0; t < dur;) { const e = Math.min(dur, t + 20000 + Math.round(rs() * 30000)); doc.scenes.push({ start_ms: t, end_ms: e }); t = e; }
const app = createMockApp({ doc, commands });
if (q.get('theme')) document.documentElement.setAttribute('data-theme', q.get('theme'));
if (q.get('profile') || q.get('machine')) app.settings.set('review.profile', q.get('profile') || 'nucleus-capstan');
if (q.get('machine')) {
  const { DevicePreview } = await import('../src/app/device-preview.svelte.js');
  app.devicePreview = new DevicePreview(app);
  app.devicePreview.toggle(true);
}
const st = lanes(app);
window.st = st;

const stack = document.getElementById('stack');
// only the timeline's overview and ruler (its other rows are not needed here and may be mid-edit)
const tl = q.get('bare') ? {} : import.meta.glob(['../src/features/timeline/Overview.svelte', '../src/features/timeline/Ruler.svelte'], { eager: true });
const comp = (name) => Object.entries(tl).find(([k]) => k.endsWith(name))?.[1]?.default;
const rows = [
  comp('Overview.svelte') && { title: 'Overview', height: 44, component: comp('Overview.svelte') },
  comp('Ruler.svelte') && { title: 'Time', height: 28, component: comp('Ruler.svelte') },
  lane,
].filter(Boolean);
for (const l of rows) {
  const row = document.createElement('div');
  row.className = 'hrow' + (l.height === 'fill' ? ' fill' : '');
  if (l.height !== 'fill') row.style.height = l.height + 'px';
  row.innerHTML = `<div class="gutter">${l.title}</div><div class="content"></div>`;
  stack.appendChild(row);
  mount(l.component, { target: row.querySelector('.content'), props: { app, height: l.height } });
}

document.getElementById('play').onclick = () => app.player.toggle();
const info = document.getElementById('info');
const fmt = (t) => (t / 1000).toFixed(3);
function tick() {
  const s = app.doc.axes[app.doc.activeAxis] || [], sel = app.doc.selection;
  const p = window.__lanesPerf, avg = (a) => (a?.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : '-');
  info.textContent = `t ${fmt(app.player.timeMs)}  view ${fmt(app.view.start)}+${fmt(app.view.span)}  ${app.doc.activeAxis} ${s.length} pts  sel ${sel.axis === app.doc.activeAxis ? sel.ats.size : 0}  undo ${app.history.undoLabel || '-'}  base ${avg(p?.base.slice(-30))} ms  over ${avg(p?.over.slice(-30))} ms`;
  requestAnimationFrame(tick);
}
tick();
