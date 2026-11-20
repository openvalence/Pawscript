// dev/mods-look.mjs -- screenshots of the Modifiers row (paw-ef73.20) in YOUR Tauri test instance (node dev/test-app.mjs
// start ...; the CDP_* env it prints): the six event kinds over cuts and scene boundaries, spurts inside an orgasm, a
// Reshape (a Refine kind: dimmed outside Refine), the kind picker after a drag, the row's and the Scenes row's menus,
// the curve popover in Refine, the Track tab.   node dev/mods-look.mjs <out-dir>
import { mkdirSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';

const [out = '.'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { browser, page } = await connectTestApp();
page.on('pageerror', (e) => console.log('[pageerror]', String(e.message).slice(0, 300)));
const shot = async (name, clip = true) => {
  await page.waitForTimeout(350);
  const box = clip ? await page.evaluate(() => { const a = document.querySelector('[data-tl-lane="scenes"]'), b = document.querySelector('[data-tl-lane="fx"]'); if (!a || !b) return null; const r = a.getBoundingClientRect(), q = b.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top - 40), width: window.innerWidth, height: Math.min(window.innerHeight - Math.max(0, r.top - 40), q.bottom - r.top + 300) }; }) : null;
  await page.screenshot({ path: `${out}/${name}.png`, ...(box ? { clip: box } : {}) });
  console.log('wrote', `${out}/${name}.png`);
};
const rowAt = (t, frac = 0.5) => page.evaluate(([t, f]) => { const c = document.querySelector('[data-tl-lane="fx"] canvas').getBoundingClientRect(), v = window.app.view; return { x: c.left + ((t - v.start) / v.span) * c.width, y: c.top + c.height * f }; }, [t, frac]);
try {
  await page.waitForFunction(() => window.app?.doc, null, { timeout: 60000 });
  await page.evaluate(() => {
    const S = (a, b, o = {}) => ({ start_ms: a * 1000, end_ms: b * 1000, ...o }), A = ['anal', 'penetration'], O = ['oral', 'penetration'];
    window.app.doc.axes = { stroke: Array.from({ length: 240 }, (_, k) => ({ at: k * 250, pos: k % 2 ? 85 : 15 })) };
    window.app.doc.scenes = [S(0, 10, { tags: O }), S(10, 20, { join: true, tags: O }), S(20, 32, { tags: A }), S(32, 45, { join: true, tags: A }), S(45, 60, { tags: A })];
    const M = (id, kind, a, b, o = {}) => ({ id, kind, t0: a * 1000, t1: b * 1000, params: {}, ...o });
    window.app.doc.fx = [M('i', 'insertion', 20, 23), M('k', 'knotting', 28, 36), M('t', 'throbbing', 6, 9), M('d', 'idle', 0, 3), M('o', 'orgasm', 40, 50),
      M('s1', 'spurt', 42, 42), M('s2', 'spurt', 43.2, 43.2), M('s3', 'spurt', 44.1, 44.1), M('p', 'pullout', 54, 58), M('r', 'shape', 12, 19)];
    window.app.setMode?.('scenes');
    window.app.setView({ start: -1000, span: 62000 });
  });
  await shot('1-scenes-tab');
  // a drag on empty row: marks the last used kind, then the kind picker
  let a = await rowAt(14000, 0.8), b = await rowAt(17500, 0.8);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
  await shot('2-drawn-kind-picker', false);
  console.log('after draw:', await page.evaluate(() => window.app.doc.fx.map((e) => `${e.kind}@${e.t0}-${e.t1}`).join(' ')));
  await page.keyboard.press('Escape');
  // the row's right-click on empty space: every kind once, the Refine ones greyed
  a = await rowAt(25500, 0.3);
  await page.mouse.click(a.x, a.y, { button: 'right' });
  await shot('3-row-menu', false);
  await page.keyboard.press('Escape');
  // the Scenes row's right-click on a scene block: one Modifier submenu
  const sb = await page.evaluate(() => { const c = document.querySelector('[data-tl-lane="scenes"] canvas').getBoundingClientRect(), v = window.app.view; return { x: c.left + ((51000 - v.start) / v.span) * c.width, y: c.top + 8 }; });
  await page.mouse.click(sb.x, sb.y, { button: 'right' });
  await page.waitForTimeout(250);
  const it = page.locator('[role="menuitem"]', { hasText: /^Modifier/ }).first();
  if (await it.count()) { await it.hover(); await page.waitForTimeout(500); }
  await shot('4-scenes-row-menu', false);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  // Refine: the Refine kinds editable; a click opens the curve
  await page.evaluate(() => window.app.setMode?.('refine'));
  await shot('5-refine-tab');
  a = await rowAt(46000, 0.3);
  await page.mouse.click(a.x, a.y);
  await shot('6-refine-curve', false);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.app.setMode?.('track'));
  a = await rowAt(46000, 0.3);
  await page.mouse.click(a.x, a.y);   // Track: a click selects (no curve); the not-tracked one offers its prompt
  await shot('7-track-tab');
  await page.screenshot({ path: `${out}/8-track-full.png` });
} finally {
  await browser.close();
}
