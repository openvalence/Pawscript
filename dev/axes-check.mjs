// dev/axes-check.mjs -- paw-2pcf, the secondary axes in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it
// prints), on a generated clip (any 8 s video). The fake sidecar's fake.groups run carries a Bottom hips group that sways and
// turns. One shot with c1_hips + c2_hips painted; T:
//  1. after Track the run has axes ghosts (no angle on the shot: a guessed side view, estimates only); no lane yet;
//  2. the Shot popover: the axes line is painted; the 'rear' Angle chip: the ghosts re-derive, sway and twist are measured;
//  3. "Show lanes": the lanes are added (one undo step) and play their axes live (paw-x7w7: no Accept); Bake the
//     script: every axis written, one undo step takes them all back (redo puts them back);
//  4. a click on an axis meter flips it in the shot (its ghost negated); export "All axes" writes the sibling files.
// Every page exception and console error fails it.
//   node dev/axes-check.mjs <clip.mp4> <out dir>
import { existsSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';

const [clip, out] = process.argv.slice(2);
if (!clip || !out) { console.error('usage: node dev/axes-check.mjs <clip.mp4> <out dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null); });
const SQ = (x, y, w = 0.12, h = 0.12) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const grp = (who, part, x, y) => ({ name: `${who}_${part}`, who, part, poly: SQ(x, y), pinned: true, t_ms: 500, source: 'user' });
const axesGhosts = () => ev(() => app.doc.ghosts.filter((g) => g.source?.kind === 'axes' && g.source.runId === window.__pawDev.trackingFor(app).runs.at(-1)?.id).map((g) => ({ id: g.id, axis: g.axis, label: g.source.label, n: g.script.length, first: g.script.slice(0, 6).map((p) => p.pos) })));
const clickText = async (sel, text) => { const b = page.locator(sel).getByRole('button', { name: text, exact: true }).first(); await b.click(); await wait(400); };

try {
  await page.waitForFunction(() => window.app?.project && window.__pawDev?.trackingFor, null, { timeout: 60000 });
  for (const f of ['.pawproj', '.pawruns']) { const p = clip.replace(/\.[^.]+$/, f); if (existsSync(p)) rmSync(p); }
  const p = ev((c) => app.project.openVideo(c, { force: true }), resolve(clip));
  for (let k = 0; k < 8; k++) { await wait(500); await answer(); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.doc.media && app.player.ready, null, { timeout: 60000 });
  await ev((g) => { app.setMode('track'); app.transact('shot', () => { app.doc.scenes = [{ start_ms: 0, end_ms: 8000, groups: g }]; }); }, [grp('c1', 'hips', 0.3, 0.5), grp('c2', 'hips', 0.55, 0.3)]);
  await ev(async () => { const tr = window.__pawDev.trackingFor(app); await tr.list(); tr.selectTracker('fake.groups'); app.doc.range = { t0: 0, t1: 8000 }; app.player.seek(3000); });
  // tr.track() returns doing nothing while another job runs (a tracker list after the reload: busy 'list', paw-mawd); the
  // product greys Track then (track.run's when: canTrack), so wait for it as a user would
  await page.waitForFunction(() => window.__pawDev.trackingFor(app).canTrack, null, { timeout: 60000 });
  await ev(async () => { await window.__pawDev.trackingFor(app).track(); });
  await page.waitForFunction(() => !window.__pawDev.trackingFor(app).busy, null, { timeout: 90000 });
  let gs = await axesGhosts();
  if (!gs.length) console.log('     tracking:', JSON.stringify(await ev(() => { const tr = window.__pawDev.trackingFor(app); return { runs: tr.runs.map((r) => r.id), busy: tr.busy, error: tr.error, notice: tr.notice, canTrack: tr.canTrack, tracker: tr.trackerId, video: tr.videoPath, tab: app.tabId }; })));
  ok(gs.length > 0 && gs.every((g) => g.label === 'estimate'), `after Track: axes ghosts ${gs.map((g) => g.axis + ':' + g.label).join(', ')} (no angle: estimates only)`);
  ok(await ev(() => !['surge', 'sway', 'twist', 'roll', 'pitch'].some((a) => a in app.doc.axes)), 'no secondary lane yet');
  // the Shot popover: angle chips + the axes line
  if (!(await page.locator('.pop').count())) { await page.locator('[data-chip="shot"]').first().click(); await wait(500); }
  ok(await page.locator('[aria-label="Secondary axes of this shot"]').count() > 0, 'the axes line is painted in the Shot popover');
  await clickText('.pop', 'rear'); await wait(600);
  gs = await axesGhosts();
  const lab = Object.fromEntries(gs.map((g) => [g.axis, g.label]));
  ok(lab.sway === 'measured' && lab.twist === 'measured' && !lab.roll, `rear: ${JSON.stringify(lab)}`);
  ok(await ev(() => document.querySelector('[data-axis="sway"][data-label="measured"]') != null), 'the sway meter says measured');
  await page.screenshot({ path: join(out, 'axes-line.png') });
  // lanes: live at once; Bake the script, one undo step
  await clickText('.pop', 'Show lanes');
  ok(await ev(() => ['sway', 'twist', 'surge'].every((a) => a in app.doc.axes)), `lanes: ${await ev(() => Object.keys(app.doc.axes).join(', '))}`);
  ok(await ev(() => window.__pawDev && app.doc.ghosts.some((g) => g.axis === 'sway' && g.visible !== false)), 'the sway ghost is on show');
  ok(await ev(() => ['sway', 'twist'].every((a) => (app.liveOf?.(a)?.script.length || 0) > 4 && (app.doc.axes[a] || []).length === 0)), 'the lanes play sway and twist live (nothing baked)');
  await ev(() => app.commands.run('tracking.bakeAll')); await wait(300);
  const acc = await ev(() => Object.fromEntries(['surge', 'sway', 'twist', 'roll', 'pitch'].filter((a) => a in app.doc.axes).map((a) => [a, app.doc.axes[a].length])));
  ok(acc.sway > 4 && acc.twist > 4, `baked: ${JSON.stringify(acc)}`);
  await ev(() => app.undo());
  ok(await ev(() => ['sway', 'twist'].every((a) => (app.doc.axes[a] || []).length === 0)), 'one undo step takes every axis back');
  await ev(() => app.redo());
  ok(await ev(() => app.doc.axes.sway.length > 4 && app.doc.axes.twist.length > 4), 'redo puts them back');
  // flip by the meter
  const before = gs.find((g) => g.axis === 'sway').first;
  await page.locator('.pop [data-axis="sway"]').first().click(); await wait(600);
  const after = (await axesGhosts()).find((g) => g.axis === 'sway').first;
  ok(after.every((v, k) => Math.abs((v - 50) + (before[k] - 50)) <= 1), `the meter flips sway in the shot (${before} -> ${after})`);
  ok(await ev(() => (app.doc.scenes[0].axflip || []).includes('sway')), 'shot.axflip holds it');
  // export: the sibling files
  const dir = resolve(out, 'export');
  mkdirSync(dir, { recursive: true });
  for (const a of ['sway', 'twist']) { const f = join(dir, clip.split(/[\\/]/).pop().replace(/\.[^.]+$/, `.${a}.funscript`)); if (existsSync(f)) rmSync(f); }
  await ev((d) => app.project.exportTo({ axes: Object.keys(app.doc.axes), dir: d }), dir);
  await wait(500);
  for (const a of ['sway', 'twist']) {
    const f = join(dir, clip.split(/[\\/]/).pop().replace(/\.[^.]+$/, `.${a}.funscript`));
    ok(existsSync(f) && JSON.parse(readFileSync(f, 'utf8')).actions.length > 4, `export wrote ${a}.funscript`);
  }
  await page.keyboard.press('Escape');
} catch (e) { fails++; console.log('FAIL', e.message); }
console.log(fails ? `${fails} failure(s)` : 'all ok');
await browser.close();
process.exit(fails ? 1 : 0);
