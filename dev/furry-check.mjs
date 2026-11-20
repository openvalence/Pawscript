// dev/furry-check.mjs -- paw-43vn in YOUR test instance (node dev/test-app.mjs start ..., then the CDP_* env it prints) on a GENERATED
// clip: the Groups tool on, one painted group, its picker open (A). Furry items on: the figure offers the tail and "paws". View ›
// "Furry items: show / hide" (the command, live, no restart): the OPEN picker re-renders with no tail / sheath / paw anywhere in its
// labels, "feet" and "vulva" instead, and the head's tooltip on hover says "(face, mouth)"; the stored group and the setting key are
// as expected; the command again brings the tail back.
//   node dev/furry-check.mjs <out dir>
import { connectTestApp } from './cdp-connect.mjs';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const out = resolve(process.argv[2] || '.');
mkdirSync(out, { recursive: true });
const clip = join(out, 'furry-clip.mp4');
const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-threads', '4', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=5', '-pix_fmt', 'yuv420p', clip], { windowsHide: true });
if (r.status !== 0) { console.error('ffmpeg failed: ' + r.stderr); process.exit(1); }

const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null); });
const V = () => ev(() => { const r = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
/** What the open picker shows: its visible text and aria-labels, and the parts its figure / chips offer. */
const picker = () => ev(() => {
  const el = document.querySelector('[data-testid="groups-picker"]');
  if (!el) return null;
  const labels = [el.innerText, ...[...el.querySelectorAll('[aria-label]')].map((x) => x.getAttribute('aria-label')), ...[...el.querySelectorAll('svg text')].map((t) => t.textContent)].join(' | ');
  return { labels, parts: [...new Set([...el.querySelectorAll('[data-drop-part]')].map((x) => x.dataset.dropPart))] };
});
const tipOver = async (sel) => {
  const b = await ev((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }, sel);
  if (!b) return '';
  await page.mouse.move(b.x - 30, b.y - 30); await wait(150); await page.mouse.move(b.x, b.y); await wait(120); await page.mouse.move(b.x + 1, b.y); await wait(900);
  return ev(() => [...document.querySelectorAll('.k-tip')].map((t) => t.textContent).join(' | '));
};

try {
  await page.waitForFunction(() => window.app?.project && window.__pawDev?.groupsFor, null, { timeout: 120000 });
  await ev(async () => { for (const c of (await app.backend.autosaveList()) || []) await app.backend.autosaveClear(c.id); });
  ok(await ev(() => app.settings.get('content.furry')) === true, 'furry items on by default');
  const p = ev((c) => app.project.openVideo(c, { force: true }), clip);
  for (let k = 0; k < 8; k++) { await wait(500); await answer(); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.doc.media && app.player.ready, null, { timeout: 60000 });
  await ev(() => { app.setMode('track'); app.transact('shot', () => { app.doc.scenes = [{ start_ms: 0, end_ms: 4900 }]; }); app.player.pause(); app.player.seek(1000, { exact: true }); });
  await wait(800);
  await ev(() => { app.settings.set('tracking.groups.grow', false); app.settings.set('tracking.groups.snap', false); __pawDev.groupsFor(app).setWho('c1'); __pawDev.groupsFor(app).toggle(true); });
  await page.waitForFunction(() => __pawDev.groupsFor(app).on && __pawDev.groupsFor(app).onFrame, null, { timeout: 10000 });
  await wait(400);
  // paint one group (a short stroke), then the picker on it
  const v = await V(), [x0, y0, x1] = [v.x + 0.45 * v.w, v.y + 0.5 * v.h, v.x + 0.52 * v.w];
  await page.mouse.move(x0, y0); await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(x0 + ((x1 - x0) * k) / 8, y0);
  await page.mouse.up(); await wait(500);
  ok(await ev(() => __pawDev.groupsFor(app).groups.length) === 1, 'one painted group');
  await page.mouse.move(x0 + 10, y0); await wait(150); await page.keyboard.press('a');
  await page.waitForSelector('[data-testid="groups-picker"]', { timeout: 5000 }); await wait(300);
  const a = await picker();
  ok(a.parts.includes('tail') && a.parts.includes('sheath') && /\bpaws\b/.test(a.labels), `on: the picker offers tail, sheath and paws (${a.parts.length} targets)`);
  await page.screenshot({ path: join(out, 'f1-picker-on.png') });

  // the View command, live (the picker stays open)
  await ev(() => app.commands.run('view.furry')); await wait(400);
  ok(await ev(() => app.settings.get('content.furry')) === false, 'View › Furry items: the setting is off');
  const b = await picker();
  ok(!!b, 'the picker is still open');
  ok(!/tail|paw|sheath|muzzle/i.test(b.labels), 'off: no tail / paw / sheath / muzzle in the picker: ' + b.labels.replace(/\s+/g, ' ').slice(0, 300));
  ok(/\bfeet\b/.test(b.labels) && /\bvulva\b/.test(b.labels) && /\bhand\b/.test(b.labels), 'off: feet, vulva and hands are there');
  ok(!b.parts.includes('tail') && !b.parts.includes('sheath') && b.parts.includes('paws') && b.parts.includes('slit'), 'the targets: no tail / sheath; paws and slit keep their ids');
  const tip = await tipOver('[data-testid="groups-picker"] g[data-drop-part="head"]');
  ok(/face, mouth/.test(tip) && !/muzzle/.test(tip), 'the head\'s tooltip: "(face, mouth)": ' + tip);
  const ftip = await tipOver('[data-testid="groups-picker"] g[data-drop-part="paws"][data-drop-side="l"]');
  ok(/L feet/.test(ftip) && !/paw/i.test(ftip), 'the feet tooltip says feet: ' + ftip);
  await page.screenshot({ path: join(out, 'f2-picker-off.png') });
  // assign the feet: stored as paws (the id never changes)
  await page.click('[data-testid="groups-picker"] g[data-drop-part="paws"][data-drop-side="l"] .hit'); await wait(400);
  ok(await ev(() => __pawDev.groupsFor(app).groups[0].name) === 'c1_paws_l', 'assigned "L feet": stored as c1_paws_l');
  // paw-i5qx: the bar's groups list names it the same way
  await page.click('[data-testid="groups-list-open"]'); await wait(300);
  const row = await ev(() => document.querySelector('[data-testid="groups-list"] .grp .nm')?.textContent || '');
  ok(/L feet/.test(row) && !/paw/i.test(row), 'the groups list says feet too: ' + row);
  await page.keyboard.press('Escape'); await wait(200);

  await ev(() => app.commands.run('view.furry')); await wait(300);
  await page.mouse.move(x0 + 10, y0); await wait(150); await page.keyboard.press('a');
  await page.waitForSelector('[data-testid="groups-picker"]', { timeout: 5000 }); await wait(300);
  const c = await picker();
  ok(await ev(() => app.settings.get('content.furry')) === true && c.parts.includes('tail') && /Bottom L paws/.test(c.labels), 'the command again: the tail is back, the group reads "Bottom L paws"');
} catch (e) {
  fails++; console.log('FAIL [threw]', String(e?.stack || e).slice(0, 600));
} finally {
  console.log(fails ? `${fails} failed` : 'all ok');
  await browser.close().catch(() => {});
  process.exit(fails ? 1 : 0);
}
