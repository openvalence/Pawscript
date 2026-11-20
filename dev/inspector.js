// dev/inspector.js -- harness for the inspector panels: the real mock app, a minimal lane canvas (select, box-select,
// drag points, ghosts) and every inspector panel side by side, framed like the shell's dock. The kit's ToastHost and
// the shell's DialogHost are mounted, so app.toast / app.confirm look as they do in the app.
// Query: ?theme=light|contrast&density=compact|comfortable. window.app and window.H are set for Playwright.
import '../src/ui/kit/theme.css';
import '../src/style.css'; // the app's page sheet, as main.js loads it: harness screenshots show what users see
import { mount } from 'svelte';
import { createMockApp, sampleDoc } from './mock-app.js';
import commands from '../src/features/inspector/commands.js';
import panels from '../src/features/inspector/panel.js';
import { inspector } from '../src/features/inspector/state.svelte.js';
import { rangeStats } from '../src/features/inspector/logic.js';
import { lowerBound } from '../src/lib/core/script.js';
import ToastHost from '../src/ui/kit/ToastHost.svelte';
import DialogHost from '../src/app/DialogHost.svelte';
import { setTheme, setDensity, onThemeChange } from '../src/ui/kit/tokens.js';
import { cssVar } from '../src/ui/kit/color.js';

const q = new URLSearchParams(location.search);
setTheme(q.get('theme') || 'dark'); setDensity(q.get('density') || 'default');

const app = createMockApp({ commands, doc: sampleDoc({ minutes: 4 }) });
app.hosts = true;
inspector.init(app);
const hosts = document.createElement('div'); document.body.appendChild(hosts);
mount(DialogHost, { target: hosts, props: { app } });
mount(ToastHost, { target: hosts });
// window keys go through the command registry, as in the app (boot.js)
window.addEventListener('keydown', (e) => app.commands.handleKey?.(e));
window.addEventListener('keyup', (e) => app.commands.handleKeyUp?.(e));

const cols = document.getElementById('cols');
for (const p of panels) {
  const col = document.createElement('div');
  col.className = 'col';
  col.dataset.panel = p.id;
  col.innerHTML = `<div class="ttl"></div><div class="body"></div>`;
  col.querySelector('.ttl').textContent = p.title;
  cols.appendChild(col);
  mount(p.component, { target: col.querySelector('.body'), props: { app } });
}

// theme / density switches
const ctl = document.getElementById('ctl');
const pick = (name, opts, cur, set) => {
  const s = document.createElement('select'); s.ariaLabel = name; s.className = 'hctl';
  for (const o of opts) s.add(new Option(o, o, false, o === cur));
  s.onchange = () => { set(s.value); const u = new URL(location.href); u.searchParams.set(name, s.value); history.replaceState(null, '', u); };
  ctl.appendChild(s);
};
pick('theme', ['dark', 'light', 'contrast'], q.get('theme') || 'dark', setTheme);
pick('density', ['compact', 'default', 'comfortable'], q.get('density') || 'default', setDensity);
for (const [id, label] of [['big', 'Load 100k script'], ['reset', 'Reset doc']]) {
  const b = document.createElement('button'); b.id = id; b.className = 'hctl'; b.textContent = label; ctl.appendChild(b);
}
let K = {};
const readTokens = () => { K = Object.fromEntries(['--line-1', '--reality', '--highlight', '--tx-val', '--tx-hi', '--intent', '--warn', '--reality-rgb'].map((k) => [k, cssVar(k)])); };
readTokens(); onThemeChange(readTokens);

// ---- lane ----
const cv = document.getElementById('lane'), info = document.getElementById('info');
const view = () => ({ start: 0, span: 12000 });
let t0 = 60000, span = 12000; // window start
const X = (t, w) => ((t - t0) / span) * w, T = (x, w) => t0 + (x / w) * span;
const Y = (p, h) => 8 + (1 - p / 100) * (h - 16);
let drag = null, box = null;

function draw() {
  const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  g.strokeStyle = K['--line-1']; g.lineWidth = 1;
  for (const p of [0, 25, 50, 75, 100]) { g.beginPath(); g.moveTo(0, Y(p, h) + .5); g.lineTo(w, Y(p, h) + .5); g.stroke(); }
  const ax = app.doc.activeAxis, s = app.doc.axes[ax] ?? [], sel = app.doc.selection.ats;
  const i0 = Math.max(0, lowerBound(s, t0) - 1), i1 = Math.min(s.length, lowerBound(s, t0 + span) + 1);
  if (app.doc.range) { g.fillStyle = `rgba(${K['--reality-rgb']},.12)`; g.fillRect(X(app.doc.range.t0, w), 0, X(app.doc.range.t1, w) - X(app.doc.range.t0, w), h); }
  for (const gh of app.doc.ghosts) {
    if (!gh.visible || (gh.axis && gh.axis !== ax)) continue;
    const prev = gh.source === 'inspector-preview';
    g.strokeStyle = prev ? gh.color : gh.color + '66'; g.lineWidth = prev ? 2 : 1; g.setLineDash(prev ? [5, 3] : []);
    g.beginPath(); const a = Math.max(0, lowerBound(gh.script, t0) - 1), b = Math.min(gh.script.length, lowerBound(gh.script, t0 + span) + 1);
    for (let i = a; i < b; i++) (i === a ? g.moveTo : g.lineTo).call(g, X(gh.script[i].at, w), Y(gh.script[i].pos, h));
    g.stroke(); g.setLineDash([]);
    if (prev) { g.fillStyle = gh.color; for (let i = a; i < b; i++) g.fillRect(X(gh.script[i].at, w) - 2, Y(gh.script[i].pos, h) - 2, 4, 4); }
  }
  g.strokeStyle = K['--reality']; g.lineWidth = 1.5; g.beginPath();
  for (let i = i0; i < i1; i++) (i === i0 ? g.moveTo : g.lineTo).call(g, X(s[i].at, w), Y(s[i].pos, h));
  g.stroke();
  for (let i = i0; i < i1; i++) { const on = sel.has(s[i].at); g.fillStyle = on ? K['--highlight'] : K['--tx-val']; const r = on ? 4 : 2.5; g.beginPath(); g.arc(X(s[i].at, w), Y(s[i].pos, h), r, 0, 7); g.fill(); }
  const ph = X(app.player.timeMs, w); g.strokeStyle = K['--tx-hi']; g.beginPath(); g.moveTo(ph + .5, 0); g.lineTo(ph + .5, h); g.stroke();
  if (box) { g.strokeStyle = K['--reality']; g.strokeRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0); }
  info.textContent = `${ax} · ${s.length} pts · selected ${sel.size}`;
  requestAnimationFrame(draw);
}
const hit = (e) => {
  const w = cv.clientWidth, h = cv.clientHeight, s = app.doc.axes[app.doc.activeAxis], r = e.offsetX, y = e.offsetY;
  const i0 = Math.max(0, lowerBound(s, T(r - 8, w))), i1 = lowerBound(s, T(r + 8, w) + 1);
  for (let i = i0; i < i1; i++) if (Math.hypot(X(s[i].at, w) - r, Y(s[i].pos, h) - y) < 8) return s[i];
  return null;
};
cv.addEventListener('pointerdown', (e) => {
  cv.setPointerCapture(e.pointerId);
  const p = hit(e);
  if (p) {
    if (!app.doc.selection.ats.has(p.at)) app.select(e.shiftKey ? [...app.doc.selection.ats, p.at] : [p.at]);
    drag = { g: app.begin('Move points', { coalesce: false }), x: e.clientX, y: e.clientY, base: app.doc.axes[app.doc.activeAxis], ats: [...app.doc.selection.ats] };
  } else box = { x0: e.offsetX, y0: e.offsetY, x1: e.offsetX, y1: e.offsetY, add: e.shiftKey };
});
cv.addEventListener('pointermove', (e) => {
  const w = cv.clientWidth, h = cv.clientHeight;
  if (drag) {
    const dp = Math.round(((drag.y - e.clientY) / (h - 16)) * 100), set = new Set(drag.ats);
    app.edit('Move points', app.doc.activeAxis, drag.base.map((a) => (set.has(a.at) ? { at: a.at, pos: Math.max(0, Math.min(100, a.pos + dp)) } : a)));
  } else if (box) { box.x1 = e.offsetX; box.y1 = e.offsetY; }
});
cv.addEventListener('pointerup', () => {
  if (drag) { drag.g.commit(); drag = null; }
  if (box) {
    const w = cv.clientWidth, a = Math.round(T(Math.min(box.x0, box.x1), w)), b = Math.round(T(Math.max(box.x0, box.x1), w));
    if (Math.abs(box.x1 - box.x0) < 3) { app.player.seek(Math.round(T(box.x0, w))); app.select([]); }
    else { const ats = app.doc.axes[app.doc.activeAxis].filter((p) => p.at >= a && p.at <= b).map((p) => p.at); app.select(box.add ? [...app.doc.selection.ats, ...ats] : ats); }
    box = null;
  }
});
cv.addEventListener('dblclick', (e) => { const w = cv.clientWidth, t = Math.round(T(e.offsetX, w)); app.doc.range = { t0: t, t1: t + 3000 }; });
app.player.seek(t0 + 3000);
requestAnimationFrame(draw);

// ---- big script ----
function bigScript(n) {
  const out = []; let t = 100, up = false;
  for (let i = 0; i < n; i++) { out.push({ at: t, pos: (up ? 85 : 15) + ((i * 37) % 11) }); t += 120 + ((i * 53) % 60); up = !up; }
  return out;
}
document.getElementById('big').onclick = () => { app.doc.axes = { ...app.doc.axes, stroke: bigScript(100000) }; t0 = 0; span = 30000; };
document.getElementById('reset').onclick = () => { app.load(sampleDoc({ minutes: 4 })); t0 = 60000; span = 12000; };
window.H = { app, inspector, view, set: (a, b) => { t0 = a; span = b; }, bigScript, rangeStats };
document.getElementById('out').textContent = 'ready';
