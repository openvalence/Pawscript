// paw-upot: the device preview's on / off was read once per tab (a toggle in tab A left tab B's stale while the shared setting
// said on), and a hidden tab with it on re-planned whenever its script changed (a background track).
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileModule } from 'svelte/compiler';

// client build: the planning effect really runs
registerHooks({
  load(url, ctx, next) {
    if (!url.startsWith('file:') || url.includes('node_modules')) return next(url, ctx);
    const file = fileURLToPath(url), src = () => readFileSync(file, 'utf8'), noGlob = (s) => s.replace(/import\.meta\.glob\(/g, '((..._) => ({}))(');
    if (url.endsWith('.svelte.js')) return { format: 'module', shortCircuit: true, source: noGlob(compileModule(src(), { filename: file, generate: 'client' }).js.code) };
    if (url.endsWith('.js') && src().includes('import.meta.glob')) return { format: 'module', shortCircuit: true, source: noGlob(src()) };
    return next(url, ctx);
  },
});
const settle = () => new Promise((r) => setTimeout(r, 0));   // the effects run on the microtask queue
const { Settings } = await import('../src/app/settings.svelte.js');
const { DevicePreview } = await import('../src/app/device-preview.svelte.js');
const { reactive: proxyState, cell } = await import('./fixtures/reactive.svelte.js');

const settings = new Settings(null);
const kin = { id: 'p', name: 'P', kinematics: { strokeMm: 100, vMax: 400, aMax: 4000, jMax: 40000 } };
const stroke = (n) => Array.from({ length: n }, (_, i) => ({ at: i * 200, pos: i % 2 ? 90 : 10 }));
const tabs = cell(null);   // tabs.current: the shown tab's app
const mkApp = () => {
  const a = { tabs, settings, review: { profile: kin }, liveOf: null, doc: proxyState({ activeAxis: 'stroke', axes: { stroke: stroke(20) }, ghosts: [], fx: [], scenes: [], finish: null }) };
  a.dp = new DevicePreview(a);
  return a;
};

test('paw-upot: a toggle in one tab is every tab\'s (the shared setting, read live)', () => {
  const A = mkApp(), B = mkApp();
  tabs.current = A;
  assert.equal(B.dp.on, false);
  A.dp.toggle(true);
  assert.equal(B.dp.on, true, 'tab B follows');
  A.dp.toggle(false);
  assert.equal(B.dp.on, false);
  A.dp.destroy(); B.dp.destroy();
});

test('paw-upot: a hidden tab does not plan on a script change; shown again, it plans', async () => {
  const A = mkApp(), B = mkApp();
  tabs.current = A;
  let plans = 0;
  const planned = B.dp.planned.bind(B.dp);
  B.dp.planned = (...a) => { plans++; return planned(...a); };
  A.dp.toggle(true); await settle();
  const before = plans;
  B.doc.axes = { stroke: stroke(30) }; await settle();
  assert.equal(plans, before, 'hidden: no plan');
  tabs.current = B; await settle();
  assert.ok(plans > before, 'shown: it plans');
  A.dp.toggle(false); A.dp.destroy(); B.dp.destroy();
});
