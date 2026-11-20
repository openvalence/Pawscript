// dev/video-sim.js -- harness for the device simulator: the real mock app with the real Player (timer clock, no
// video attached; the clip in the stage is only a backdrop), a stage box like VideoPane's, and window.H for
// Playwright: H.set({doc, t, axis, sw, sh, theme, density, machine: 'off'|'fake'|'real', ...ui}), H.exact(n) (drawn
// piston vs posAt of the script that drives it), H.perf(ms). app.devicePreview is the shell's real DevicePreview:
// 'real' runs the device planner (Nucleus Capstan profile) over the visible range; 'fake' publishes the raw script
// smoothed and delayed 40 ms as the machine motion (generic profile, so the planner leaves it alone).
import '../src/ui/kit/theme.css';
import '../src/style.css';
import { mount, tick } from 'svelte';
import { createMockApp, sampleDoc } from './mock-app.js';
import { Player } from '../src/features/video/player.svelte.js';
import Simulator from '../src/features/video/Simulator.svelte';
import { simDebug, simGeometry } from '../src/features/video/simdraw.js';
import { posAt } from '../src/lib/core/script.js';
import { DevicePreview } from '../src/app/device-preview.svelte.js';

const fix = (s) => s.filter((a, i) => !i || a.at > s[i - 1].at);
function docOf(kind) {
  const d = sampleDoc({ minutes: 2 });
  d.media = null;
  if (kind === 'multi') {
    const pitch = [], twist = [], surge = [];
    for (let t = 0; t < 120000; t += 900) pitch.push({ at: t, pos: Math.round(50 + 40 * Math.sin(t / 1700)) });
    for (let t = 0; t < 120000; t += 1200) twist.push({ at: t, pos: Math.round(50 + 50 * Math.sin(t / 3100)) });
    for (let t = 0; t < 120000; t += 700) surge.push({ at: t, pos: Math.round(50 + 30 * Math.cos(t / 900)) });
    d.axes = { ...d.axes, pitch: fix(pitch), twist: fix(twist), surge: fix(surge) };
  }
  if (kind === 'fast') {   // tempo ramps from 600 ms to 90 ms half-strokes, 5..95: up to ~1000 u/s
    const s = []; let t = 500, up = false;
    while (t < 120000) { s.push({ at: Math.round(t), pos: up ? 95 : 5 }); t += 600 - 510 * Math.min(1, t / 60000); up = !up; }
    d.axes = { stroke: fix(s) };
  }
  if (kind === 'empty') d.axes = { stroke: [], roll: d.axes.roll };
  return d;
}

const app = createMockApp({ doc: docOf('multi'), keys: true });
app.player = new Player(app);
app.player.setDuration(app.durationMs);
app.devicePreview = new DevicePreview(app);
mount(Simulator, { target: document.getElementById('stage'), props: { app } });

const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
const frames = async (n = 2) => { for (let i = 0; i < n; i++) await raf(); };
const geom = () => {
  const box = document.querySelector('.vsim .graph').getBoundingClientRect(), ui = app.player.ui;
  return simGeometry({}, box.width, box.height, ui.simLead, ui.simSide);
};

const H = (window.H = {
  app, simDebug,
  async set(o = {}) {
    if (o.doc) { app.player.pause(); app.load(docOf(o.doc)); app.player.setDuration(app.durationMs); }
    if (o.axis) app.setActiveAxis(o.axis);
    const { doc, axis, t, sw, sh, theme, density, machine, ...ui } = o;
    if (theme) { if (theme === 'dark') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', theme); }
    if (density) { if (density === 'default') document.documentElement.removeAttribute('data-density'); else document.documentElement.setAttribute('data-density', density); }
    if (sw) document.documentElement.style.setProperty('--sw', sw + 'px');
    if (sh) document.documentElement.style.setProperty('--sh', sh + 'px');
    if (Object.keys(ui).length) app.player.setUi(ui);
    if (t != null) await app.player.seek(t);
    if (machine) await H.machine(machine);
    await tick(); await frames(3);
    return H.state();
  },
  async machine(mode) {
    const dp = app.devicePreview, tm = app.player.displayMs;
    if (mode === 'off') { dp.toggle(false); return; }
    app.settings.set('review.profile', mode === 'real' ? 'nucleus-capstan' : 'generic');
    app.setView({ start: Math.max(0, tm - 6000), span: 16000 });
    dp.toggle(true);
    await tick();
    if (mode === 'fake') { dp.ghost = fakeGhost(); dp.engine = 'fake: smoothed, +40 ms'; return; }
    for (let i = 0; i < 100 && !dp.ghost; i++) await new Promise((r) => setTimeout(r, 50));   // debounce + planner
  },
  /** The script that drives the piston at t (the machine inside its span, else the raw script) and its pos. */
  want(t) {
    const g = app.devicePreview?.on && app.devicePreview.ghost;
    const inside = g && t >= (g.range?.t0 ?? g.script[0].at) && t <= (g.range?.t1 ?? g.script.at(-1).at);
    return { src: inside ? 'machine' : 'script', pos: posAt(inside ? g.script : app.script, t) };
  },
  state() { const t = app.player.displayMs, w = H.want(t); return { t, src: simDebug.src, drawn: simDebug.drawnPos, want: w.pos, wantSrc: w.src, raw: simDebug.raw }; },
  /** Pause at n pseudo-random times; compare the drawn head (logical, and measured from canvas pixels) with posAt. */
  async exact(n = 40) {
    let maxLogical = 0, maxPixel = 0, seed = 3, srcMismatch = 0;
    const span = app.devicePreview?.on && app.devicePreview.ghost?.range;   // machine on: sample inside its span
    const lo = span ? span.t0 : 0, len = span ? span.t1 - span.t0 : app.durationMs - 2000;
    const cv = document.querySelector('.vsim .graph canvas'), ctx = cv.getContext('2d', { willReadFrequently: true });
    for (let i = 0; i < n; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const t = lo + Math.round((seed / 4294967296) * len) + 0.37 * (i % 3);
      await app.player.seek(t); await frames(2);
      const w = H.want(app.player.displayMs), want = w.pos;
      if (w.src !== simDebug.src) srcMismatch++;
      maxLogical = Math.max(maxLogical, Math.abs(simDebug.drawnPos - want));
      // pixels: inside the track, between its edge and the rod, only the head is bright (track, sleeve and halo
      // are dark or faint); its brightness-weighted centre row is where the piston is drawn
      const d = devicePixelRatio, g = geom();
      const x = Math.floor((g.nowX - g.tw / 4) * d);
      const col = ctx.getImageData(x, 0, 1, cv.height).data;
      let sum = 0, cnt = 0;
      for (let y = Math.floor((g.top - 3) * d); y < Math.ceil((g.bot + 3) * d); y++) {
        const k = y * 4, v = Math.max(col[k], col[k + 1], col[k + 2]) * col[k + 3] / 255;
        if (v > 200) { sum += (y + 0.5) * v; cnt += v; }
      }
      const yCss = sum / cnt / d, pixPos = ((g.bot - yCss) / (g.bot - g.top)) * 100;
      maxPixel = Math.max(maxPixel, Math.abs(pixPos - want));
    }
    return { n, src: simDebug.src, srcMismatch, maxLogical, maxPixel, pxPerUnit: (geom().bot - geom().top) / 100 };
  },
  /** Play for ms, measure rAF intervals and the simulator's draw time per frame. */
  async perf(ms = 10000) {
    await H.set({ t: 1000 });
    Object.assign(simDebug, { frames: 0, drawSum: 0, drawMax: 0 });
    const gaps = []; let last = performance.now(), on = true;
    const loop = (now) => { gaps.push(now - last); last = now; if (on) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    app.player.play();
    await new Promise((r) => setTimeout(r, ms));
    app.player.pause(); on = false;
    gaps.shift(); gaps.sort((a, b) => a - b);
    const q = (p) => gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))];
    return { frames: gaps.length, simFrames: simDebug.frames, rafMedian: q(0.5), rafP95: q(0.95), rafP99: q(0.99), rafMax: gaps[gaps.length - 1],
      over20ms: gaps.filter((g) => g > 20).length, drawAvg: simDebug.drawSum / simDebug.frames, drawMax: simDebug.drawMax };
  },
});

/** Fake machine motion over the whole document: the raw script low-passed (60 ms box) and delayed 40 ms, 4 ms samples. */
function fakeGhost() {
  const s = app.script, out = [], end = app.durationMs;
  if (!s.length) return null;
  for (let at = 0; at <= end; at += 4) {
    let sum = 0; for (let k = -3; k <= 3; k++) sum += posAt(s, at - 40 + k * 10);
    out.push({ at, pos: Math.round(sum / 7) });
  }
  // the simulator follows samples (the plan at its tick), like device-preview.svelte.js publishes them
  const samples = { t0: 0, dtMs: 4, engine: 'fake', pos: Float32Array.from(out, (p) => p.pos) };
  return { id: 'device-preview', source: 'device-preview', script: out, samples, misses: [], clamps: [], axis: app.doc.activeAxis, range: { t0: 0, t1: end } };
}

document.getElementById('machine').onchange = (e) => H.set({ machine: e.target.value });
document.getElementById('theme').onchange = (e) => H.set({ theme: e.target.value });
document.getElementById('play').onclick = () => app.player.toggle();
document.getElementById('show').onclick = () => app.player.setUi({ sim: true });
document.getElementById('doc').onchange = (e) => H.set({ doc: e.target.value });
const info = document.getElementById('info');
setInterval(() => { info.textContent = `t=${app.player.displayMs.toFixed(1)} drawn=${simDebug.drawnPos.toFixed(3)} draw=${simDebug.drawMs.toFixed(3)}ms`; }, 250);
document.querySelector('#stage video').play().catch(() => {});
