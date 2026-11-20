// Review panels in a real browser (Playwright + Edge) against dev/review.html on the mock app. Starts its own Vite
// dev server. Skipped unless REVIEW_E2E=1 so `npm run check` stays fast:  REVIEW_E2E=1 node --test test/review-e2e.test.mjs
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ON = process.env.REVIEW_E2E === '1';
const root = fileURLToPath(new URL('..', import.meta.url));

describe('review e2e', { skip: !ON && 'set REVIEW_E2E=1 to run the browser checks' }, () => {
  let server, browser, page;

  before(async () => {
    const { createServer } = await import('vite');
    server = await createServer({ root, logLevel: 'error', server: { port: 5468, strictPort: false, hmr: false, ws: false } });
    await server.listen();
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ channel: 'msedge', headless: true });
  });
  after(async () => { await browser?.close(); await server?.close(); });

  beforeEach(async () => {
    await page?.context().close();
    page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    await page.goto(`${server.resolvedUrls.local[0]}dev/review.html`);
    await page.waitForFunction(() => window.H && document.querySelector('[data-panel="review.stats"] .rv-kv'));
    await page.waitForTimeout(400);
  });

  /** aria-busy flips of the Statistics body during `ms` (each recompute flips it twice). */
  const busyFlips = (ms) => page.evaluate((ms) => new Promise((res) => {
    const el = document.querySelector('[data-panel="review.stats"] .rv-body'); let n = 0;
    const mo = new MutationObserver(() => n++); mo.observe(el, { attributes: true, attributeFilter: ['aria-busy'] });
    setTimeout(() => { mo.disconnect(); res(n); }, ms);
  }), ms);

  test('Statistics is idle while nothing changes, and recomputes once after an edit', async () => {
    assert.equal(await busyFlips(1500), 0, 'no recompute loop while idle');
    const flips = busyFlips(1500);
    await page.evaluate(() => { const { app } = window.H; app.edit('test', 'stroke', [...app.doc.axes.stroke, { at: 110000, pos: 40 }]); });
    assert.equal(await flips, 2);
    const actions = await page.evaluate(() => [...document.querySelectorAll('[data-panel="review.stats"] .rv-kv span')].find((s) => s.textContent === 'Actions').nextElementSibling.textContent);
    assert.equal(actions, String(await page.evaluate(() => window.H.app.script.length)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '));
  });

  test('Nucleus Capstan has a stroke window slider that drives max speed', async () => {
    const dev = page.locator('[data-panel="review.device"]');
    assert.equal(await dev.getByRole('slider').count(), 0, 'no slider for the generic profile');
    await page.evaluate(() => window.H.rv.setProfile('nucleus-capstan'));
    const slider = dev.getByRole('slider');
    await slider.waitFor();
    await slider.focus(); await page.keyboard.press('End');
    assert.deepEqual(await page.evaluate(() => [window.H.rv.profile.maxSpeed, window.H.rv.strokeMm, window.H.app.settings.get('review.strokeMm')]), [400, 300, { 'nucleus-capstan': 300 }]);
    await page.keyboard.press('Home');
    assert.equal(await page.evaluate(() => window.H.rv.profile.maxSpeed), 1200);
    assert.match(await dev.getByRole('button', { name: /Limit speed/ }).textContent(), /1200/);
  });

  test('ignore rules ride in the project block, not in settings', async () => {
    const r = await page.evaluate(() => {
      const { app, rv } = window.H, p = rv.problems[0];
      app.history.markSaved();
      rv.toggleIgnore(p, true);
      const saved = JSON.parse(JSON.stringify(app.saveBlocks().review)), dirty = app.doc.dirty;
      app.loadBlocks({});                      // another document
      const after = rv.ignore.ids.length;
      app.loadBlocks({ review: saved });       // reopen the project
      return { saved, id: p.id, dirty, after, back: rv.isIgnored(p), setting: app.settings.get('review.ignore', null) };
    });
    assert.deepEqual(r.saved.ignore.ids, [r.id]);
    assert.equal(r.dirty, true, 'ignoring marks the project dirty');
    assert.equal(r.after, 0);
    assert.equal(r.back, true);
    assert.equal(r.setting, null);
  });
});
