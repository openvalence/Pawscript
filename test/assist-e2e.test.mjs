// Assist store + overlay in a real browser (Playwright + Edge): the decisions block across open / close, the overlay's
// keys, the single-run track rejection, the out-of-date queue. dev/shell.html (whole app, mock backend) and
// dev/assist.html (harness with two injected tracker runs). Own Vite dev server on port 5474 (ASSIST_E2E_PORT).
// Skipped unless ASSIST_E2E=1 so `npm run check` stays fast:  ASSIST_E2E=1 node --test test/assist-e2e.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ON = process.env.ASSIST_E2E === '1';
const root = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.ASSIST_E2E_PORT || 5474);

describe('assist e2e', { skip: !ON && 'set ASSIST_E2E=1 to run the browser checks' }, () => {
  let server, browser, base;
  before(async () => {
    const { createServer } = await import('vite');
    server = await createServer({ root, logLevel: 'error', server: { port: PORT, strictPort: true, hmr: false, ws: false, watch: null } });
    await server.listen();
    base = server.resolvedUrls.local[0];
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ channel: 'msedge', headless: true });
  });
  after(async () => { await browser?.close(); await server?.close(); });

  async function open(path) {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    await page.goto(base + path);
    await page.waitForFunction(() => window.app?.doc || window.H);
    await page.evaluate(async () => { window.AS = await import('/src/features/assist/assist.svelte.js'); });
    return page;
  }

  test('decisions stay with their document: an open keeps the file\'s block, a close does not carry it over', async () => {
    const page = await open('dev/shell.html?mode=track');
    const r = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms)), b = () => app.doc.project?.extra?.assist,
        n = () => (b() ? ['direction', 'track', 'activity', 'depth'].reduce((k, x) => k + b()[x].length, 0) : null);
      const A = AS.assistFor(app); A.regenerate(); A.show();
      A.press('ArrowLeft'); A.press('ArrowLeft'); await sleep(100);
      const answered = n();
      A.close();
      app.doc.project = { ...(app.doc.project || {}), path: 'C:/videos/sample.pawproj' };
      await app.project.save();
      A.show(); A.press('Backspace'); A.press('Backspace'); A.close(); await sleep(100);
      const takenBack = n();   // the open document now differs from the file
      await app.project.openProject('C:/videos/sample.pawproj', { force: true }); await sleep(500);
      const opened = n(), dirtyOnOpen = app.doc.dirty, remembered = A.questions.filter((q) => q.memory).length;
      A.show(); A.press(A.q.choices[0].key); await sleep(100); A.close();
      const more = n(), dirtyAfterAnswer = app.doc.dirty;
      await app.project.close({ force: true }); await sleep(500);
      return { answered, takenBack, opened, dirtyOnOpen, remembered, more, dirtyAfterAnswer, leaked: app.doc.project?.extra?.assist ?? null };
    });
    assert.deepEqual(r, { answered: 2, takenBack: 0, opened: 2, dirtyOnOpen: false, remembered: 2, more: 3, dirtyAfterAnswer: true, leaked: null });
    await page.context().close();
  });

  test('overlay: answer keys reach assist; rate, mode, docks and axis keys do not act behind it', async () => {
    const page = await open('dev/shell.html?mode=track');
    await page.evaluate(() => AS.assistFor(app).regenerate());
    await page.keyboard.press('F6');
    await page.waitForFunction(() => AS.peekAssist(app).open);
    const st = () => page.evaluate(() => ({ open: AS.peekAssist(app).open, done: AS.peekAssist(app).progress.done, rate: app.player.rate, mode: app.mode, left: app.layout.cur.left?.collapsed ?? null }));
    const s0 = await st();
    await page.keyboard.press('ArrowLeft');
    for (const k of ['BracketLeft', 'BracketRight', 'Backslash', 'Control+Digit1', 'Control+Digit2', 'Control+b', 'Alt+ArrowDown']) await page.keyboard.press(k);
    const s1 = await st();
    assert.equal(s1.done, s0.done + 1, 'ArrowLeft answered');
    assert.deepEqual({ ...s1, done: 0 }, { ...s0, done: 0 });
    await page.keyboard.press('Escape');
    assert.equal((await st()).open, false);
    await page.context().close();
  });

  test('track check "no" with a single run offers re-track (R) or keep (N)', async () => {
    const page = await open('dev/assist.html');
    await page.evaluate(() => {
      const { tr, app } = H;
      tr.runs = tr.runs.slice(0, 1); app.doc.ghosts = app.doc.ghosts.slice(0, 1);
    });
    await page.waitForTimeout(100);   // the store regenerates for the new run count
    const r = await page.evaluate(() => {
      const { A } = H;
      const i = A.questions.findIndex((q) => q.kind === 'track' && q.state === 'open');
      A.show(); A.goto(i); A.press('N');
      const q = A.q;
      return { kind: q.kind, other: q.other, keys: q.choices.map((c) => c.key), prompt: q.prompt };
    });
    assert.deepEqual(r, { kind: 'fallback', other: null, keys: ['R', 'N'], prompt: 'Re-track this span with a new region?' });
    const after = await page.evaluate(() => { H.A.press('R'); return { open: H.A.open, mode: H.app.mode, range: !!H.app.doc.range }; });
    assert.deepEqual(after, { open: false, mode: 'track', range: true });
    await page.context().close();
  });

  test('queue: out of date after an edit that is not an answer; answers, undo and Regenerate are not', async () => {
    const page = await open('dev/assist.html');
    const r = await page.evaluate(() => {
      const { A, app } = H, out = [A.stale];
      A.show(); A.press(A.q.choices[0].key); A.close();                       // an answer (may edit)
      out.push(A.stale);
      app.undo(); out.push(A.stale); app.redo(); out.push(A.stale);
      app.edit('hand edit', 'stroke', app.script.slice(1)); out.push(A.stale);
      app.undo(); out.push(A.stale);
      app.redo(); A.regenerate(); out.push(A.stale);
      return out;
    });
    assert.deepEqual(r, [false, false, false, false, true, false, false]);
    await page.context().close();
  });
});
