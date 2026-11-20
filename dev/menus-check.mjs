// dev/menus-check.mjs -- paw-u6s5 in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints), a production
// build, on a generated clip (node dev/make-index-clip.mjs <out.mp4> 8 30 600) and the fake sidecar. On what is painted:
//  1. the top bar's Track menu: at most 12 rows at its top level (the everyday commands, then Groups, Direction and anchors,
//     Runs, ranges and scenes, Bake and export, Advanced); Advanced opens and holds no Director (dev builds only);
//  2. the source chip's menu on a fake.groups run given old motion-group channels (g1 with data, g2 all gaps in the shot): no
//     channel id in any row, the old groups in their own submenu, the gap-only channel left out and counted in a greyed row.
// Screenshots: <out dir>/menus-track.png, menus-track-advanced.png, menus-source.png, menus-source-old.png. Every page exception
// and console error fails it.
//   node dev/menus-check.mjs <clip.mp4> <out dir>
import { existsSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: node dev/menus-check.mjs <clip.mp4> <out dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const clip = join(resolve(out), `menus-${Date.now()}.mp4`);
copyFileSync(src, clip);
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null); });
const SQ = (x, y, w = 0.12, h = 0.12) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const grp = (who, part, x, y) => ({ name: `${who}_${part}`, who, part, poly: SQ(x, y), pinned: true, t_ms: 500, source: 'user' });
/** The open menu panel's own rows (a submenu is nested in its parent's DOM: direct children only). */
const rows = (sel) => ev((sel) => { const m = [...document.querySelectorAll(sel)].at(-1); return m ? [...m.querySelectorAll(':scope > .k-item')].map((e) => ({ label: e.querySelector('.k-item-label')?.textContent.trim(), sub: e.getAttribute('aria-haspopup') === 'menu' || !!e.querySelector('.k-item-chev svg'), off: e.getAttribute('aria-disabled') === 'true' })) : null; }, sel);
const INTERNAL = /_|\bg[1-4]\b|\bproj\b|\bcam [xy]\b|sidecar|\brel\b|pair \(g\)/;

try {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.reload();
  await page.waitForFunction(() => window.app?.project && window.__pawDev?.trackingFor, null, { timeout: 60000 });
  for (const f of ['.pawproj', '.pawruns']) { const p = clip.replace(/\.[^.]+$/, f); if (existsSync(p)) rmSync(p); }
  const p = ev((c) => app.project.openVideo(c, { force: true }), resolve(clip));
  for (let k = 0; k < 40 && !(await ev(() => !!(app.doc.media && app.player.ready))); k++) { await wait(500); await answer(); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.doc.media && app.player.ready, null, { timeout: 60000 });
  await ev((g) => {
    app.devicePreview?.toggle(false);
    app.setMode('track'); app.player.pause();
    app.transact('shot', () => { app.doc.scenes = [{ start_ms: 0, end_ms: 8000, tags: ['anal', 'penetration'], groups: g }]; });
  }, [grp('c2', 'penis', 0.3, 0.45), grp('c1', 'hips', 0.6, 0.45)]);
  await wait(600);

  // ---- 1. the Track menu ----
  const bar = page.locator('[role="menubar"] [role="menuitem"]').filter({ hasText: /^\s*Track\s*$/ });
  await bar.click(); await wait(500);
  const track = await rows('[role="menu"]');
  const top = track || [];
  console.log('info Track top level: ' + top.map((r) => r.label + (r.sub ? ' >' : '')).join(' | '));
  ok(top.length > 0 && top.length <= 12, `the Track menu has ${top.length} rows at its top level (at most 12)`);
  const subs = top.filter((r) => r.sub).map((r) => r.label);
  ok(['Groups', 'Direction and anchors', 'Runs, ranges and scenes', 'Bake and export', 'Advanced'].every((s) => subs.includes(s)), `its submenus: ${subs.join(', ')}`);
  ok(top.some((r) => r.label === 'Track the selected shot or range'), 'T is titled "Track the selected shot or range"');
  await page.screenshot({ path: join(out, 'menus-track.png') });
  await page.locator('[role="menu"] .k-item').filter({ hasText: /^\s*Advanced/ }).first().hover(); await wait(700);
  const adv = await rows('[role="menu"] [role="menu"]');
  console.log('info Advanced: ' + (adv || []).map((r) => r.label + (r.sub ? ' >' : '')).join(' | '));
  ok(!!adv?.length && !adv.some((r) => /Director|scorecard/i.test(r.label)), `Advanced opens (${adv?.length} rows) without the dev-only Director or scorecard marks`);
  await page.screenshot({ path: join(out, 'menus-track-advanced.png') });
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await wait(300);

  // ---- 2. the source chip's menu ----
  await ev(async () => { const tr = window.__pawDev.trackingFor(app); await tr.list(); tr.selectTracker('fake.groups'); app.doc.range = { t0: 0, t1: 8000 }; app.player.seek(500); for (let k = 0; k < 75 && !tr.canTrack; k++) await new Promise((r) => setTimeout(r, 200)); await tr.track(); });
  await page.waitForFunction(() => !window.__pawDev.trackingFor(app).busy && window.__pawDev.trackingFor(app).runs.length, null, { timeout: 90000 });
  // old motion-group channels as an older points run has them: g1 with data, g2 only gaps in the shot
  await ev(() => {
    const tr = window.__pawDev.trackingFor(app), r = tr.runs.at(-1), t = Array.from(r.channels.cam_x.t), wave = (k) => t.map((x) => 0.5 + 0.4 * Math.sin(x / (150 + 40 * k)));
    const ch = (v) => ({ t: [...t], v, min: 0, max: 1 });
    r.channels = { ...r.channels, g1_proj: ch(wave(1)), g1_scale: ch(wave(2)), g1p1_rel: ch(wave(3)), g1p1_proj: ch(wave(4)), g2_proj: ch(t.map(() => NaN)), pair_proj: ch(wave(5)), proj_cam: ch(wave(6)) };
    tr.select(''); tr.select(r.id); app.player.seek(1500, { exact: true });
  });
  await wait(900);
  await page.mouse.move(5, 5); await wait(200);
  const chip = page.locator('button.chip.src');
  const chipText = (await chip.textContent()).trim();
  ok(!INTERNAL.test(chipText.replace(/▾/, '')), `the chip reads "${chipText}"`);
  await chip.click(); await wait(500);
  const srcRows = await rows('[role="menu"]') || [];
  console.log('info source menu: ' + srcRows.map((r) => r.label + (r.sub ? ' >' : '') + (r.off ? ' (off)' : '')).join(' | '));
  const secs = await ev(() => [...[...document.querySelectorAll('[role="menu"]')].at(-1).querySelectorAll(':scope > .k-menu-sec')].map((e) => e.textContent.trim()));
  console.log(`info sections: ${secs.join(', ')}`);
  ok(srcRows.length > 0 && srcRows.length <= 16, `the source menu has ${srcRows.length} rows at its top level (QA counted 30 on an older points run)`);
  const bad = srcRows.filter((r) => INTERNAL.test(r.label));
  ok(!bad.length, `no channel id in a row${bad.length ? ': ' + bad.map((r) => r.label).join(', ') : ''}`);
  ok(srcRows.some((r) => r.label === "Tracker's choice") && srcRows.some((r) => r.label === 'All points, camera removed'), 'the tracker\'s choice and the camera-removed channel in plain words');
  const more = srcRows.find((r) => /more with no data in this shot$/.test(r.label));
  ok(!!more && more.off, `the gap-only channel is left out and counted: "${more?.label}" (greyed: ${more?.off})`);
  await page.screenshot({ path: join(out, 'menus-source.png') });
  await page.locator('[role="menu"] .k-item').filter({ hasText: /^\s*Old motion groups/ }).first().hover(); await wait(700);
  const old = await rows('[role="menu"] [role="menu"]') || [];
  console.log('info Old motion groups: ' + old.map((r) => r.label + (r.sub ? ' >' : '')).join(' | '));
  ok(old.length >= 2 && !old.some((r) => INTERNAL.test(r.label)) && !old.some((r) => /^Body 2\b/.test(r.label)), `the old groups in their own submenu, in words, body 2 (gaps only) left out: ${old.map((r) => r.label).join(', ')}`);
  await page.screenshot({ path: join(out, 'menus-source-old.png') });
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
} catch (e) { fails++; console.log('FAIL', e.message); }
console.log(fails ? `${fails} FAILED` : 'all ok');
await browser.close().catch(() => {});
process.exit(fails ? 1 : 0);
