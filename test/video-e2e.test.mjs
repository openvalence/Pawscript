// The video pane in the whole app (dev/shell.html, mock backend) in a real browser (Playwright + Edge): media that
// fails to load. Starts its own Vite dev server (5490+). Skipped unless VIDEO_E2E=1:
//   VIDEO_E2E=1 node --test test/video-e2e.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ON = process.env.VIDEO_E2E === '1';
const root = fileURLToPath(new URL('..', import.meta.url));

describe('video e2e', { skip: !ON && 'set VIDEO_E2E=1 to run the browser checks' }, () => {
  let server, browser, page;
  before(async () => {
    const { createServer } = await import('vite');
    server = await createServer({ root, logLevel: 'error', server: { port: 5490, strictPort: false, hmr: false, ws: false, watch: null } });
    await server.listen();
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    page = await browser.newPage();
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    await page.goto(`${server.resolvedUrls.local[0]}dev/shell.html`);
    await page.waitForFunction(() => window.app?.player?.error);   // the sample doc's video is not on disk
  });
  after(async () => { await browser?.close(); await server?.close(); });

  test('seek on media that failed to load settles and moves the playhead', async () => {
    const r = await page.evaluate(async () => {
      const p = app.player, to = (pr) => Promise.race([pr, new Promise((r) => setTimeout(() => r('hung'), 2000))]);
      return { a: await to(p.seek(300000)), b: await to(p.seek(5000)), t: p.timeMs, seeking: p.seeking };
    });
    assert.deepEqual(r, { a: 300000, b: 5000, t: 5000, seeking: false });
  });

  test('missing, empty and unreadable files get their own card', async () => {
    const r = await page.evaluate(async () => {
      const be = app.backend, wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await be.writeText('C:/v/empty.mp4', '');
      await be.writeText('C:/v/junk.mp4', 'x'.repeat(2000));
      const out = {};
      for (const f of ['C:/v/missing.mp4', 'C:/v/empty.mp4', 'C:/v/junk.mp4']) {
        await app.project.openVideo(f, { force: true, mode: 'ignore' });
        for (let i = 0; i < 40 && !app.player.error; i++) await wait(50);
        out[f] = { code: app.player.error?.code, proxy: app.player.error?.canProxy };
      }
      return out;
    });
    assert.equal(r['C:/v/missing.mp4'].code, 'missing');
    assert.equal(r['C:/v/empty.mp4'].code, 'empty');
    assert.equal(r['C:/v/junk.mp4'].code, 4);
    for (const f of Object.values(r)) assert.equal(f.proxy, false);
  });
});
