// dev/axes-solo-check.mjs -- paw-jyde.11, the solo reading (one character's hips vs the frame) in YOUR test instance (node
// dev/test-app.mjs start ...; the CDP_* env it prints), on any 8 s+ clip. One shot tagged rear + dancing with only c1_hips +
// c1_torso painted (no Top); the fake sidecar's c1_hips sways and turns:
//  1. after Track the run has axes ghosts: sway and roll measured (a lone body seen from behind: the in-plane turn is roll),
//     named "(hips vs frame)";
//  2. the Shot popover: the axes line paints a "vs frame" chip (its kit tooltip names the reference), the sway / roll meters
//     filled (measured, bar width > 0);
//  3. "Show lanes": the sway ghost is painted on its lane (pixels differ with it hidden) and plays live there (paw-x7w7);
//     Bake the script writes every axis, one undo step takes them all back, redo puts them back;
//  4. the six-axis view follows the run's sway ghost (the readout moves off centre between two times).
// Every page exception and console error fails it.
//   node dev/axes-solo-check.mjs <clip.mp4> <out dir>
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';

const [clip, out] = process.argv.slice(2);
if (!clip || !out) { console.error('usage: node dev/axes-solo-check.mjs <clip.mp4> <out dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null); });
const SQ = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const grp = (who, part, box) => ({ name: `${who}_${part}`, who, part, poly: SQ(...box), pinned: true, t_ms: 500, source: 'user' });
const axesGhosts = () => ev(() => app.doc.ghosts.filter((g) => g.source?.kind === 'axes' && g.source.runId === window.__pawDev.trackingFor(app).runs.at(-1)?.id).map((g) => ({ id: g.id, axis: g.axis, label: g.source.label, name: g.name, n: g.script.length })));
const clickText = async (sel, text) => { await page.locator(sel).getByRole('button', { name: text, exact: true }).first().click(); await wait(400); };
/** a screen region as PNG bytes (to compare what is painted) */
const shot = async (r) => page.screenshot({ clip: { x: Math.round(r.x), y: Math.round(r.y), width: Math.max(1, Math.round(r.w)), height: Math.max(1, Math.round(r.h)) } });

try {
  await page.waitForFunction(() => window.app?.project && window.__pawDev?.trackingFor, null, { timeout: 60000 });
  for (const f of ['.pawproj', '.pawruns']) { const p = clip.replace(/\.[^.]+$/, f); if (existsSync(p)) rmSync(p); }
  const p = ev((c) => app.project.openVideo(c, { force: true }), resolve(clip));
  for (let k = 0; k < 8; k++) { await wait(500); await answer(); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.doc.media && app.player.ready, null, { timeout: 60000 });
  await ev((g) => { app.setMode('track'); app.transact('shot', () => { app.doc.scenes = [{ start_ms: 0, end_ms: 8000, tags: ['rear', 'dancing'], groups: g }]; }); },
    [grp('c1', 'hips', [0.4, 0.5, 0.15, 0.15]), grp('c1', 'torso', [0.42, 0.2, 0.11, 0.2])]);
  await ev(async () => { const tr = window.__pawDev.trackingFor(app); await tr.list(); tr.selectTracker('fake.groups'); app.doc.range = { t0: 0, t1: 8000 }; app.player.seek(3000); await tr.track(); });
  await page.waitForFunction(() => !window.__pawDev.trackingFor(app).busy, null, { timeout: 90000 });
  const gs = await axesGhosts(), lab = Object.fromEntries(gs.map((g) => [g.axis, g.label]));
  ok(lab.sway === 'measured' && lab.roll === 'measured' && lab.twist !== 'measured', `after Track, one character: ${JSON.stringify(lab)}`);
  ok(gs.length && gs.every((g) => g.name.endsWith('(hips vs frame)')), `ghost names: ${gs.map((g) => g.name).join(' | ')}`);
  // the Shot popover: the axes line with its "vs frame" chip
  if (!(await page.locator('.pop').count())) { await page.locator('[data-chip="shot"]').first().click(); await wait(500); }
  const chip = await ev(() => { const e = document.querySelector('.pop [data-testid="axes-vs-frame"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { text: e.textContent.trim(), w: r.width, h: r.height, title: e.getAttribute('title') }; });
  ok(chip && chip.text === 'vs frame' && chip.w > 10 && chip.h > 6 && !chip.title, `the "vs frame" chip is painted (${JSON.stringify(chip)}), no native title`);
  await page.locator('.pop [data-testid="axes-vs-frame"]').hover(); await page.waitForFunction(() => document.querySelector('.k-tip')?.matches(':popover-open'), null, { timeout: 8000 }).catch(() => {});   // the tip shows 500 ms after the hover, later while the page computes
  const tip = await ev(() => [...document.querySelectorAll('[role=tooltip], .tooltip, .kit-tooltip')].map((e) => e.textContent).join(' | '));
  ok(/vs frame/.test(tip) && /torso/.test(tip), `its tooltip: ${tip.slice(0, 200)}`);
  const meters = await ev(() => ['sway', 'roll', 'twist'].map((a) => { const b = document.querySelector(`.pop [data-axis="${a}"]`), i = b?.querySelector('.bar i'); return { a, label: b?.dataset.label, w: i ? i.getBoundingClientRect().width : 0 }; }));
  ok(meters[0].label === 'measured' && meters[0].w > 2 && meters[1].label === 'measured' && meters[1].w > 2, `meters painted: ${JSON.stringify(meters)}`);
  await page.screenshot({ path: join(out, 'axes-solo-line.png') });
  // lanes: the ghost is painted on the sway lane
  await clickText('.pop', 'Show lanes');
  ok(await ev(() => ['sway', 'roll'].every((a) => a in app.doc.axes)), `lanes: ${await ev(() => Object.keys(app.doc.axes).join(', '))}`);
  await page.keyboard.press('Escape'); await wait(300);
  await ev(() => { app.doc.range = null; app.player.seek(4000); }); await wait(500);
  const lane = await ev(() => { const r = document.querySelector('.gutter[data-axis=sway]')?.closest('.lrow')?.getBoundingClientRect(); return r ? { x: r.x + 24, y: r.y + 2, w: r.width - 30, h: r.height - 4 } : null; });
  ok(!!lane && lane.h > 20, `the sway lane is on screen (${JSON.stringify(lane)})`);
  const withG = await shot(lane);
  await ev(() => { app.doc.ghosts = app.doc.ghosts.map((g) => (g.source?.kind === 'axes' && g.axis === 'sway' ? { ...g, visible: false } : g)); }); await wait(500);
  const noG = await shot(lane);
  await ev(() => { app.doc.ghosts = app.doc.ghosts.map((g) => (g.source?.kind === 'axes' && g.axis === 'sway' ? { ...g, visible: true } : g)); }); await wait(500);
  let diff = 0;
  for (let i = 0; i < Math.min(withG.length, noG.length); i++) if (withG[i] !== noG[i]) diff++;
  ok(withG.length !== noG.length || diff > 100, `the sway ghost is painted on its lane (${diff} PNG bytes differ with it hidden)`);
  await page.screenshot({ path: join(out, 'axes-solo-lanes.png') });
  // live on the lanes; Bake the script: every axis, one undo step
  ok(await ev(() => (app.liveOf?.('sway')?.script.length || 0) > 4 && (app.doc.axes.sway || []).length === 0), 'sway plays live (nothing baked)');
  await ev(() => app.commands.run('tracking.bakeAll')); await wait(300);
  const acc = await ev(() => Object.fromEntries(['surge', 'sway', 'twist', 'roll', 'pitch'].filter((a) => a in app.doc.axes).map((a) => [a, app.doc.axes[a].length])));
  ok(acc.sway > 4 && acc.roll > 4, `baked: ${JSON.stringify(acc)}`);
  await ev(() => app.undo());
  ok(await ev(() => ['surge', 'sway', 'twist', 'roll', 'pitch'].every((a) => (app.doc.axes[a] || []).length === 0)), 'one undo step takes every axis back');
  await ev(() => app.redo());
  ok(await ev(() => app.doc.axes.sway.length > 4 && app.doc.axes.roll.length > 4), 'redo puts them back');
  await ev(() => app.undo());
  await page.keyboard.press('Escape'); await wait(300);
  // the six-axis view follows the run's sway (live on its lane)
  await ev(() => { const tr = window.__pawDev.trackingFor(app); tr.select(tr.runs.at(-1).id); app.player.pause(); app.player.setUi({ sr6: true }); }); await wait(500);
  const sr = async (ms) => { await ev((t) => app.player.seek(t), ms); await wait(500); return ev(() => document.querySelector('[data-testid="sr6"] canvas')?.dataset.vals || ''); };
  const v1 = (await sr(2000)).split(',').map(Number), v2 = (await sr(2650)).split(',').map(Number);
  ok(v1.length === 6 && (Math.abs(v1[2] - 50) > 1 || Math.abs(v2[2] - 50) > 1) && v1[2] !== v2[2], `six-axis view sway ${v1[2]} -> ${v2[2]}, roll ${v1[4]} -> ${v2[4]}`);
  await page.locator('[data-testid="sr6"]').screenshot({ path: join(out, 'axes-solo-sr6.png') });
  await ev(() => app.player.setUi({ sr6: false }));
} catch (e) { fails++; console.log('FAIL', e.message); }
console.log(fails ? `${fails} failure(s)` : 'all ok');
await browser.close();
process.exit(fails ? 1 : 0);
