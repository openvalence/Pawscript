// dev/shaft-data-check.mjs -- paw-4c48.15: the shaft's data under the Tracker lane (ShaftData.svelte) in YOUR test instance, started
// with FAKE_SHAFT_STORY=strokes in its environment (node dev/test-app.mjs start ...; the CDP_* env it prints), on a generated clip
// (any 8 s video). One shot with c2_penis (the shaft) + c1_hips painted; T with the fake sidecar's fake.groups (its shaft strokes,
// held 3-3.6 s: test/fake-pawtrack.mjs). It asserts, on what is painted / read:
//  1. off by default: no band; the source menu has "Shaft data under the lane" (a checkbox row, its kit tip says what it is);
//  2. on (that row): since 0d4d3ae (paw-unuy) layered over the Track tab's combined lane, not a band under it: its canvas painted,
//     the lane and its trace keep their heights, the lane's band names the reading in use (shaft-note);
//  3. hovering the state strip in the lane's top padding: the value the lane's tip says the diamond shows equals what the position
//     bar on the shaft paints (data-meas) at that time; its held frames are where the bar draws no diamond; the words name the
//     reading in use and both readings;
//  4. the command (palette) turns it off: the layer and the note gone, the lane and the trace exactly as before.
// Every page exception and console error fails it.
//   node dev/shaft-data-check.mjs <clip.mp4> <out dir>
import { existsSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: node dev/shaft-data-check.mjs <clip.mp4> <out dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const clip = join(resolve(out), `shaftdata-${Date.now()}.mp4`);
copyFileSync(src, clip);
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null); });
const SQ = (x, y, w = 0.12, h = 0.12) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const grp = (who, part, x, y, extra = {}) => ({ name: `${who}_${part}`, who, part, poly: SQ(x, y), pinned: true, t_ms: 500, source: 'user', ...extra });
const chip = () => page.locator('button.chip.src');
const heights = () => ev(() => { const tl = document.querySelector('[data-testid="shaft-strip"]')?.parentElement, tr0 = tl?.firstElementChild;   // the Tracker lane's grid (its first row: the trace)
    return { tl: Math.round(tl?.getBoundingClientRect().height ?? -1), trace: Math.round(tr0?.getBoundingClientRect().height ?? -1), band: !!document.querySelector('[data-testid="shaft-data"]') }; });

try {
  await page.reload();
  await page.waitForFunction(() => window.app?.project && window.__pawDev?.trackingFor, null, { timeout: 60000 });
  for (const f of ['.pawproj', '.pawruns']) { const p = clip.replace(/\.[^.]+$/, f); if (existsSync(p)) rmSync(p); }
  const p = ev((c) => app.project.openVideo(c, { force: true }), resolve(clip));
  for (let k = 0; k < 40 && !(await ev(() => !!(app.doc.media && app.player.ready))); k++) { await wait(500); await answer(); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.doc.media && app.player.ready, null, { timeout: 60000 });
  await ev((g) => {
    app.devicePreview.toggle(false);
    app.player.setUi({ posBar: true });
    app.setMode('track'); app.player.pause();
    app.transact('shot', () => { app.doc.scenes = [{ start_ms: 0, end_ms: 8000, tags: ['anal', 'penetration'], groups: g }]; });
    app.settings.set('video.posbar.shaft:' + app.doc.media.path, { on: true, labels: false });
    app.settings.set('tracking.shaftData', false);
  }, [grp('c2', 'penis', 0.3, 0.45, { shaft: true }), grp('c1', 'hips', 0.6, 0.45)]);
  await ev(async () => { const tr = window.__pawDev.trackingFor(app); await tr.list(); tr.selectTracker('fake.groups'); app.doc.range = { t0: 0, t1: 8000 }; app.player.seek(500); for (let k = 0; k < 75 && !tr.canTrack; k++) await new Promise((r) => setTimeout(r, 200)); await tr.track(); });   // (canTrack: as shaft-source-check, a job just after the open can hold the tracker for a moment)
  await page.waitForFunction(() => !window.__pawDev.trackingFor(app).busy, null, { timeout: 90000 });
  await ev(() => { const tr = window.__pawDev.trackingFor(app); window.TR = tr; tr.select(tr.runs.at(-1).id); app.setView({ start: 0, span: 8000 }); app.player.seek(1500, { exact: true }); });
  await wait(900);

  // ---- 1. off by default; the menu row ----
  const h0 = await heights();
  ok(!h0.band && h0.tl > 0, `off by default: no band (lane ${h0.tl} px, trace ${h0.trace} px)`);
  await page.mouse.move(5, 5); await wait(200);
  await chip().click(); await wait(400);
  const row = page.locator('[role="menu"] [role="menuitemcheckbox"]').filter({ hasText: /Shaft data under the lane/ });
  ok(await row.count() === 1 && (await row.getAttribute('aria-checked')) === 'false', 'the source menu has "Shaft data under the lane", unchecked');
  // ---- 2. on ----
  // 0d4d3ae (paw-unuy, the owner's "I'd layer this tbh rather than under"): on the Track tab's combined lane the data is drawn
  // over the lane on its pos scale (ShaftData `layered`), no band under it: the lane and its trace keep their heights, the canvas
  // over the lane is painted, and the lane's band says which reading is in use (the shaft-note)
  await row.click(); await wait(900);
  const h1 = await heights();
  const lay = await ev(() => { const d = document.querySelector('[data-testid="shaft-data"]'), c = d?.querySelector('canvas'); if (!c?.width) return null;
    const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < px.length; i += 4) if (px[i]) n++;
    return { layered: d.classList.contains('layered'), painted: n, note: document.querySelector('[data-testid="shaft-note"]')?.textContent.trim() || '' }; });
  ok(h1.band && lay?.layered && lay.painted > 200 && h1.tl === h0.tl && h1.trace === h0.trace, `on: drawn over the lane (layered, ${lay?.painted} px painted), the lane and its trace keep their heights (${h0.tl} -> ${h1.tl} / ${h0.trace} -> ${h1.trace} px)`);
  ok(/^shaft: (points|SAM) in use|^shaft unsure/.test(lay?.note || ''), `the lane's band says the reading in use: "${lay?.note}"`);
  await page.screenshot({ path: join(out, 'shaft-data-on.png') });

  // ---- 3. its hover words (the lane's tip over the state strip in its top padding) against the position bar's diamond ----
  // (layered: no .cell elements; the lane's hover shows the frame's words, ShaftData's cells, as its .whytip; a column is 6 px)
  const box = await ev(() => { const r = document.querySelector('[data-testid="shaft-data"]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
  const rows = [];
  for (let k = 0; k < 16; k++) {
    const cx = 6 * Math.floor((box.w * (0.04 + 0.92 * k / 15)) / 6);
    for (let j = 0; j < 3; j++) { await page.mouse.move(box.x + cx + 2 + (j % 2), box.y + 4); await wait(60); }
    await wait(150);
    const tip = await ev(() => document.querySelector('.whytip')?.textContent || '');
    const m = /the diamond: (-?\d+|–) · (measured|unsure|held)/.exec(tip);
    if (!m) { rows.push({ cx, tip }); continue; }
    const t = await ev((cx) => app.view.start + ((cx + 3) / document.querySelector('[data-testid="shaft-data"]').clientWidth) * app.view.span, cx);   // ShaftData hov: the column's centre
    rows.push({ cx, t, tip, dia: m[1] === '–' ? NaN : +m[1], st: m[2] });
  }
  await page.mouse.move(5, 5);
  for (const r of rows.filter((r) => r.st)) Object.assign(r, await ev(async (t) => { app.player.seek(t, { exact: true }); await new Promise((r) => setTimeout(r, 300)); const cv = document.querySelector('canvas.pbar'); return { meas: parseFloat(cv.dataset.meas), mode: cv.dataset.mode }; }, r.t));
  const read = rows.filter((r) => r.st), both = read.filter((r) => Number.isFinite(r.dia) && Number.isFinite(r.meas));
  // the tip rounds the diamond to a whole number: 0.5 more than the 1.5 the old cells (one decimal) were held to
  ok(both.length >= 8 && both.every((r) => Math.abs(r.dia - r.meas) < 2), `hover value = the diamond the bar paints at ${both.length} of ${rows.length} columns (data - bar: ${both.map((r) => (r.dia - r.meas).toFixed(1)).join(' ')})`);
  const held = read.filter((r) => r.st === 'held');
  ok(held.every((r) => !Number.isFinite(r.meas) && /faint/.test(r.mode)) && read.filter((r) => r.st === 'measured').every((r) => Number.isFinite(r.meas)), `held where the bar draws no diamond (${held.length} held of ${read.length}: ${read.map((r) => r.st[0]).join('')})`);
  const tip = read.find((r) => r.st === 'measured')?.tip || read[0]?.tip || '';
  ok(/in use/.test(tip) && /the penis points/.test(tip) && /SAM's outline/.test(tip) && /the diamond: /.test(tip), `the hover words name the reading in use and both readings: "${tip.slice(0, 160)}…"`);

  // ---- 4. the command turns it off: the lane as before ----
  await ev(() => app.commands.run('tracking.shaftData')); await wait(800);
  const h2 = await heights(), note2 = await ev(() => !!document.querySelector('[data-testid="shaft-note"]'));
  ok(!h2.band && !note2 && h2.tl === h0.tl && h2.trace === h0.trace, `the command turns it off: no layer, no note, lane ${h2.tl} px, trace ${h2.trace} px (as before: ${h0.tl} / ${h0.trace})`);
} catch (e) { fails++; console.log('FAIL', e.message); }
console.log(fails ? `${fails} FAILED` : 'all ok');
await browser.close().catch(() => {});
process.exit(fails ? 1 : 0);
