// dev/machine.js -- harness for the Machine panel: the real mock app with a synthetic script (60 s of shallow
// strokes, then 60 s of deep knot strokes), the panel twice (dark and light). ?toy=<sku>&size=&char=&t=<ms>&theme=
// ?machine=1: the shell's device preview with the Nucleus Capstan profile (the panel then plays the planner's motion);
// ?fast=1: the deep strokes every 150 ms (past the planner's limits)
import { mount } from 'svelte';
import { setTheme } from '../src/ui/kit/index.js';
import { createMockApp, sampleDoc } from './mock-app.js';
import panel from '../src/features/machine/panel.js';

const qs = new URLSearchParams(location.search);
const strokes = (t0, n, half, lo, hi) => Array.from({ length: n }, (_, i) => ({ at: t0 + i * half, pos: i % 2 ? lo : hi }));
const script = [...strokes(0, 120, 500, 55, 100), ...(qs.get('fast') ? strokes(60000, 400, 150, 0, 100) : strokes(60000, 120, 500, 0, 100))];
const D = sampleDoc({ minutes: 2 });
const app = createMockApp({ doc: { ...D, axes: { stroke: script }, activeAxis: 'stroke', media: { ...D.media, durationMs: 120000 } } });
if (qs.get('toy')) app.settings.set('machine.toy', qs.get('toy'));
if (qs.get('size')) app.settings.set('machine.size', qs.get('size'));
if (qs.get('char')) app.settings.set('machine.char', qs.get('char'));
if (qs.get('machine')) {
  app.settings.set('review.profile', 'nucleus-capstan');
  const { DevicePreview } = await import('../src/app/device-preview.svelte.js');
  app.devicePreview = new DevicePreview(app);
}
setTheme(qs.get('theme') || 'dark');
const cols = document.getElementById('cols');
for (const theme of (qs.get('both') ? ['dark', 'light'] : [qs.get('theme') || 'dark'])) {
  const col = document.createElement('div');
  col.className = 'col'; col.dataset.theme = theme;
  cols.append(col);
  mount(panel.component, { target: col, props: { app } });
}
app.player.seek(+(qs.get('t') || 0) || 0);
window.H = { app, script };
