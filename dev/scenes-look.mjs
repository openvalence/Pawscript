// dev/scenes-look.mjs -- screenshots of the Scenes row on a dense, realistic case (paw-k2u): ten scenes, 47 shots, camera
// moves, cutaways, internal / blank / off-screen shots, fills, an insertion, a merge's offer, re-found (unconfirmed)
// groups, untagged scenes, at three zoom levels. Default: headless Edge on dev/shell.html (its own vite, random port);
// --app: YOUR Tauri test instance (node dev/test-app.mjs start ..., hidden desktop; the CDP_* env it prints).
//   node dev/scenes-look.mjs <out-dir> [prefix] [--app]
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { connectTestApp } from './cdp-connect.mjs';

const args = process.argv.slice(2), APP = args.includes('--app'), [out = '.', prefix = 'look'] = args.filter((a) => a !== '--app');
mkdirSync(out, { recursive: true });
let browser, page, vite = null;
if (APP) ({ browser, page } = await connectTestApp());
else {
  const port = await new Promise((ok) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
  vite = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'ignore', shell: process.platform === 'win32', windowsHide: true });
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  for (let k = 0; k < 60; k++) { try { await page.goto(`http://localhost:${port}/dev/shell.html?mode=track&video=/dev/assets/cfr2997.mp4`); break; } catch { await page.waitForTimeout(1000); } }
}
page.on('pageerror', (e) => console.log('[pageerror]', String(e.message).slice(0, 300)));
try {
  await page.waitForFunction(() => window.app?.doc, null, { timeout: 30000 });
  await page.evaluate(() => {
    const S = (a, b, o = {}) => ({ start_ms: a * 1000, end_ms: b * 1000, ...o }), cam = (a, b, kind) => [{ t0: a * 1000, t1: b * 1000, kind }];
    const sq = (x, y) => [[x, y], [x + 0.1, y], [x + 0.1, y + 0.1], [x, y + 0.1]];
    const A = ['anal', 'penetration'], V = ['vaginal', 'penetration'], O = ['oral', 'penetration'];
    const g4 = [{ name: 'c1_penis', who: 'c1', part: 'penis', poly: sq(0.4, 0.4), pinned: true, t_ms: 50000, source: 'user' },
      { name: 'c1_penis', who: 'c1', part: 'penis', poly: sq(0.5, 0.4), pinned: true, t_ms: 101000, source: 'tagger', unconfirmed: true, prior: 'c1_penis' }];
    const L = [
      S(0, 12, { tags: ['intro'], kind: 'still' }),                                                   // 1 intro
      S(12, 22, { tags: ['exposed'], camera: cam(12, 22, 'static') }), S(22, 31, { join: true, split: 'camera', tags: ['exposed', 'pan'] }), S(31, 40, { join: true, tags: ['exposed'] }),   // 2
      S(40, 43, { kind: 'blank', transition: { in: 'fade', out: 'fade', in_ms: 600, out_ms: 600 } }), // 3 blank
      S(43, 55, { tags: A, groups: g4 }), S(55, 63, { join: true, split: 'camera', tags: [...A, 'zoom'] }), S(63, 74, { join: true, tags: A }), S(74, 80, { join: true, tags: [...A, 'offscreen'] }),
      S(80, 92, { join: true, tags: A }), S(92, 100, { join: true, tags: [...A, 'internal'] }), S(100, 118, { join: true, tags: A }), S(118, 130, { join: true, split: 'camera', tags: [...A, 'handheld'] }),   // 4
      S(130, 141), S(141, 150, { join: true }),                                                       // 5 untagged
      S(150, 160, { tags: O }), S(160, 171, { join: true, tags: O }), S(171, 180, { join: true, split: 'camera', tags: [...O, 'pan'] }), S(180, 190, { join: true, tags: O }), S(190, 200, { join: true, tags: [...O, 'reciprocal'] }), S(200, 210, { join: true, tags: O }),   // 6
      S(210, 222, { tags: V, offers: [{ t0: 262000, t1: 290000, tags: ['anal', 'licking'] }] }), S(222, 232, { join: true, tags: [...V, 'handheld'] }), S(232, 244, { join: true, tags: V }), S(244, 252, { join: true, split: 'camera', tags: [...V, 'zoom'] }),
      S(252, 262, { join: true, tags: V }), S(262, 276, { join: true, tags: V }), S(276, 290, { join: true, tags: V }),   // 7
      S(290, 296, { tags: ['anal', 'insertion'] }), S(296, 300, { join: true, tags: ['anal', 'insertion'] }),   // 8 insertion
      ...Array.from({ length: 12 }, (_, k) => S(300 + k * 10, 310 + k * 10, { ...(k ? { join: true } : {}), ...(k % 4 === 2 ? { split: 'camera' } : {}),
        tags: [...A, 'knotting', ...(k === 3 ? ['orbit'] : k === 7 ? ['reciprocal'] : k === 9 ? ['offscreen'] : [])] })),   // 9
      S(420, 426, { tags: ['after'], fill: 'before' }), S(426, 432, { join: true, tags: ['after'], fill: 'before' }), S(432, 438, { join: true, tags: ['after'], fill: 'before' }),
      S(438, 444, { join: true, tags: ['after'], fill: 'before' }), S(444, 450, { join: true, tags: ['after'], fill: 'before' }),   // 10
    ];
    // the scene's act tags are one per scene (normScenes): a knotting span over scene 4's end, an orgasm span over scene 7's
    const spanOn = (lo, hi, e) => { for (let i = lo; i <= hi; i++) L[i] = { ...L[i], tags: [...(L[i].tags || []), e] }; };
    spanOn(5, 12, { id: 'knotting', t0: 108000, t1: 130000 }); spanOn(21, 27, { id: 'orgasm', t0: 280000, t1: 290000 });
    window.app.setMode?.('track');
    window.app.doc.scenes = L;

  });
  await page.waitForTimeout(500);
  const n = await page.evaluate(() => { const l = window.app.doc.scenes; let s = 0; l.forEach((x, i) => { if (!i || x.join !== true) s++; }); return [l.length, s]; });
  console.log('shots / scenes:', n.join(' / '));
  // select shots 4.2 to 4.4 (a run inside scene 4: click, Shift+click in the Shots strip) so the selection look is in the pictures
  await page.evaluate(() => window.app.setView({ start: 0, span: 455000 }));
  await page.waitForTimeout(300);
  const at = (t) => page.evaluate((t) => { const cv = document.querySelector('[data-tl-lane="scenes"] canvas'), r = cv.getBoundingClientRect(), v = window.app.view; return { x: r.left + ((t - v.start) / v.span) * r.width, y: r.top + ((Math.max(12, Math.round((r.height - Math.max(8, Math.min(14, Math.round(r.height * 0.2)))) * 0.58))) + 1 + r.height - Math.max(8, Math.min(14, Math.round(r.height * 0.2)))) / 2 }; }, t);
  let p = await at(59000); await page.mouse.click(p.x, p.y); await page.waitForTimeout(150);
  p = await at(77000); await page.keyboard.down('Shift'); await page.mouse.click(p.x, p.y); await page.keyboard.up('Shift'); await page.waitForTimeout(250);
  console.log('selected:', await page.evaluate(() => document.querySelector('.qb.bar .which')?.textContent));
  const views = [['1-whole', 0, 455000], ['2-mid', 120000, 330000], ['3-close', 40000, 135000]];
  for (const [name, start, end] of views) {
    await page.evaluate(([a, b]) => window.app.setView({ start: a, span: b - a }), [start, end]);
    await page.mouse.move(2, 2); await page.evaluate(() => document.activeElement?.blur?.());   // no hover tip, no focus tag over the row
    await page.waitForTimeout(400);
    const box = await page.evaluate(() => { const el = document.querySelector('[data-tl-lane="scenes"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top - 60), width: window.innerWidth, height: Math.min(window.innerHeight - Math.max(0, r.top - 60), r.height + 260) }; });
    await page.screenshot({ path: `${out}/${prefix}-${name}.png`, ...(box ? { clip: box } : {}) });
    console.log('wrote', `${out}/${prefix}-${name}.png`);
  }
  await page.screenshot({ path: `${out}/${prefix}-full.png` });
  // paw-hmn: the lane toolbar stays one line; the three chips at three window widths, and each chip's popover
  if (!APP) {
    for (const W of [900, 1200, 1600]) {
      await page.setViewportSize({ width: W, height: 1000 });
      await page.waitForTimeout(500);
      const tb = await page.evaluate(() => { const el = document.querySelector('.tb'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, chips: [...document.querySelectorAll('.tb [data-chip]')].map((c) => c.textContent.trim()), slot: Math.round(document.querySelector('.tb .qbw')?.getBoundingClientRect().width), sp: Math.round(document.querySelector('.tb .sp')?.getBoundingClientRect().width), lt: getComputedStyle(document.querySelector('.tb .lt')).display }; });
      console.log(`toolbar at ${W}px: height ${tb?.h?.toFixed(0)} px, chips ${JSON.stringify(tb?.chips)} slot ${tb?.slot} spacer ${tb?.sp} ${tb?.lt}`);
      if (tb) await page.screenshot({ path: `${out}/${prefix}-toolbar-${W}.png`, clip: { x: 0, y: Math.max(0, tb.y - 4), width: W, height: tb.h + 8 } });
    }
    for (const which of ['scene', 'shot', 'tracker']) {
      await page.click(`.tb [data-chip="${which}"]`);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/${prefix}-pop-${which}.png` });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }
  }
} finally {
  await browser.close();
  if (vite) { try { process.platform === 'win32' ? spawnSync('taskkill', ['/T', '/F', '/PID', String(vite.pid)], { windowsHide: true }) : vite.kill(); } catch { /* gone */ } }
}
