// Lane editor keyboard checks in a real browser (Playwright + Edge) on /dev/shell.html with the synthetic clips in
// dev/assets (real frame clock and seek latency). Starts its own Vite dev server (HMR off) on a port in 5400-5499.
// Skipped unless LANES_E2E=1 so `npm run check` stays fast:  LANES_E2E=1 node --test test/lanes-e2e.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ON = process.env.LANES_E2E === '1';
const root = fileURLToPath(new URL('..', import.meta.url));

describe('lanes e2e', { skip: !ON && 'set LANES_E2E=1 to run the browser checks' }, () => {
  let server, browser, base;
  before(async () => {
    const { createServer } = await import('vite');
    server = await createServer({ root, logLevel: 'error', server: { port: 5400 + Math.floor(Math.random() * 100), strictPort: false, hmr: false, ws: false } });
    await server.listen();
    base = server.resolvedUrls.local[0];
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ channel: 'msedge', headless: true });
  });
  after(async () => { await browser?.close(); await server?.close(); });

  /** A page with `clip` loaded at `fps` and the given stroke points; focus on the video area. */
  async function open(clip, fps, stroke, { w = 1400, h = 900 } = {}) {
    const p = await browser.newPage({ viewport: { width: w, height: h } });
    p.on('pageerror', (e) => console.log('[pageerror]', e.message));
    await p.goto(`${base}dev/shell.html`);
    await p.waitForFunction(() => window.app?.load);   // (window.app is the #app element until the shell sets it)
    await p.evaluate(({ clip, fps, stroke }) => app.load({ axes: { stroke }, activeAxis: 'stroke',
      media: { path: `/dev/assets/${clip}.mp4`, name: clip, durationMs: 10000, fps, isVfr: false, width: 640, height: 360 } }), { clip, fps, stroke });
    await p.waitForFunction(() => app.player.ready, null, { timeout: 15000 });
    await p.mouse.click(300, 150);
    return p;
  }
  const seek = (p, ms) => p.evaluate(async (ms) => { await app.player.seek(ms); }, ms);
  const ats = (p) => p.evaluate(() => app.script.map((a) => a.at));
  const sel = (p) => p.evaluate(() => [...app.doc.selection.ats]);
  const labels = (p) => p.evaluate(() => app.history.entries.map((e) => e.label + (e.applied ? '' : ' (redo)')));

  test('a digit right after a frame step lands on the new frame', async () => {
    const p = await open('cfr30', 30, []);
    await seek(p, 3000);
    for (let i = 0; i < 8; i++) { await p.keyboard.press('ArrowRight'); await p.keyboard.press('Numpad8'); }
    assert.deepEqual(await ats(p), [3033, 3067, 3100, 3133, 3167, 3200, 3233, 3267]);
    await p.close();
  });

  test('Shift+W / W (Blender keymap; OFS: , / .) walk every point at 24 fps (no sticking on 1292 / 1333)', async () => {
    const p = await open('cfr24', 24, [500, 1292, 1333, 2000, 3000].map((at, i) => ({ at, pos: i % 2 ? 100 : 0 })));
    const walk = async (from, key) => {
      await seek(p, from); const out = [];
      for (let i = 0; i < 4; i++) { await p.keyboard.press(key); await p.waitForFunction(() => !app.player.seeking); out.push(Math.round(await p.evaluate(() => app.player.timeMs))); }
      return out;
    };
    assert.deepEqual(await walk(2500, 'Shift+w'), [2000, 1333, 1292, 500]);
    assert.deepEqual(await walk(800, 'w'), [1292, 1333, 2000, 3000]);
    await p.close();
  });

  test('after undo / redo, Left/Right still step and the redo branch survives; redo restores the selection', async () => {
    const p = await open('cfr30', 30, []);
    await seek(p, 1500);
    await p.keyboard.press('Numpad7'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('Numpad2');
    await p.keyboard.press('Control+z');
    assert.deepEqual(await sel(p), [1500]);
    await p.keyboard.press('ArrowRight'); await p.waitForFunction(() => !app.player.seeking);
    assert.equal(Math.round(await p.evaluate(() => app.player.timeMs)), 1567);
    assert.deepEqual(await ats(p), [1500]);
    assert.deepEqual(await labels(p), ['Add point', 'Add point (redo)']);
    await p.keyboard.press('Control+y');
    assert.deepEqual(await sel(p), [1533]);
    await p.close();
  });

  test('repeating a digit on an unchanged point adds no undo entry', async () => {
    const p = await open('cfr30', 30, []);
    await seek(p, 5000);
    for (let i = 0; i < 3; i++) await p.keyboard.press('Numpad5');
    assert.deepEqual(await labels(p), ['Add point']);
    await p.close();
  });

  test('Q never writes past the end of the video', async () => {
    const p = await open('cfr30', 30, [{ at: 8800, pos: 0 }, { at: 9200, pos: 100 }, { at: 9600, pos: 0 }]);
    await seek(p, 9700);
    await p.keyboard.press('q');
    assert.ok((await ats(p)).every((t) => t <= 10000));
    await p.close();
  });

  test('keys on the Welcome screen create no document', async () => {
    const p = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await p.goto(`${base}dev/shell.html?empty`);
    await p.waitForFunction(() => window.app?.load);
    await p.mouse.click(700, 450);
    for (const k of ['5', '9', 'ArrowRight', '0', 'Shift+0', 'q', 'a']) await p.keyboard.press(k);
    assert.deepEqual(await p.evaluate(() => [Object.keys(app.doc.axes).length, app.doc.dirty, app.history.entries.length]), [0, false, 0]);
    await p.close();
  });

  test('at 1100x700 the whole lane stack fits (last lane not clipped)', async () => {
    const p = await browser.newPage({ viewport: { width: 1100, height: 700 } });
    await p.goto(`${base}dev/shell.html`);
    await p.waitForFunction(() => window.app?.load);
    await p.waitForTimeout(800);
    const m = await p.evaluate(() => { const s = document.querySelector('.stack.kit-root'); return { ch: s.clientHeight, sh: s.scrollHeight }; });
    assert.ok(m.sh <= m.ch, JSON.stringify(m));
    await p.close();
  });

  test('Ctrl+Enter on a tracker run seen through a modifier marks the modifier baked (no second pass in the live stroke ghost)', async () => {
    const p = await open('cfr30', 30, []);
    const r = await p.evaluate(async () => {
      const FX = await import('/src/lib/fx.js'), { tl } = await import('/src/features/timeline/state.svelte.js');
      const run = []; for (let t = 100, i = 0; t < 9900; t += 200, i++) run.push({ at: t, pos: i % 2 ? 90 : 5 });
      app.doc.ghosts = [{ id: 'run1', name: 'Run 1', script: run, visible: true, source: { kind: 'tracker', tracker: 'flow' } }];
      app.commands.run('timeline.mod.toggle.orgasm', { t0: 2000, t1: 8000 });
      const id = tl.fx;
      app.commands.run('lanes.acceptGhost', { ghostId: 'run1' });
      return { flutter: app.doc.axes.stroke.length > run.length, baked: !!app.doc.fx.find((e) => e.id === id)?.baked, again: !!FX.fxAxisGhost(app.doc.axes.stroke, app.doc.fx) };
    });
    assert.deepEqual(r, { flutter: true, baked: true, again: false }, 'the run went in with the modifier, which is baked now');
    await p.close();
  });
  // ---- Blender logic (paw-85y): click / Shift+click / box, G S X Shift+D modal transforms ----
  const PTS = [1000, 2000, 3000, 4000, 5000, 6000].map((at, i) => ({ at, pos: i % 2 ? 80 : 20 }));
  /** Client coordinates of (at, pos) on the stroke lane. */
  const xy = (p, at, pos) => p.evaluate(({ at, pos }) => {
    const c = document.querySelector('canvas.over'), r = c.getBoundingClientRect(), v = app.view;
    return [r.left + ((at - v.start) / v.span) * r.width, r.top + 10 + (1 - pos / 100) * (r.height - 20)];
  }, { at, pos });
  async function blenderPage() {
    const p = await open('cfr30', 30, PTS);
    await p.evaluate(() => app.setView({ start: 0, span: 7000 }));
    await p.waitForTimeout(100);
    return p;
  }
  const status = (p) => p.evaluate(() => document.querySelector('.xform')?.textContent || '');
  const pos = (p) => p.evaluate(() => app.script.map((a) => a.pos));

  test('Blender select: click = only it, Shift+click toggles, Shift+drag adds a box, Ctrl+drag subtracts, Shift+RMB = playhead', async () => {
    const p = await blenderPage();
    const [x1, y1] = await xy(p, 1000, 20), [x2, y2] = await xy(p, 2000, 80);
    await p.mouse.click(x1, y1);
    assert.deepEqual(await sel(p), [1000]);
    await p.keyboard.down('Shift'); await p.mouse.click(x2, y2); await p.keyboard.up('Shift');
    assert.deepEqual((await sel(p)).sort((a, b) => a - b), [1000, 2000]);
    await p.keyboard.down('Shift'); await p.mouse.click(x1, y1); await p.keyboard.up('Shift');
    assert.deepEqual(await sel(p), [2000]);
    const [bx0, by0] = await xy(p, 2500, 100), [bx1, by1] = await xy(p, 4500, 0);
    await p.keyboard.down('Shift'); await p.mouse.move(bx0, by0); await p.mouse.down(); await p.mouse.move(bx1, by1, { steps: 5 }); await p.mouse.up(); await p.keyboard.up('Shift');
    assert.deepEqual((await sel(p)).sort((a, b) => a - b), [2000, 3000, 4000]);
    const [cx0, cy0] = await xy(p, 3500, 100), [cx1, cy1] = await xy(p, 4500, 0);
    await p.keyboard.down('Control'); await p.mouse.move(cx0, cy0); await p.mouse.down(); await p.mouse.move(cx1, cy1, { steps: 5 }); await p.mouse.up(); await p.keyboard.up('Control');
    assert.deepEqual((await sel(p)).sort((a, b) => a - b), [2000, 3000]);
    await p.keyboard.press('Alt+a');
    assert.deepEqual(await sel(p), []);
    await p.keyboard.press('a');
    assert.equal((await sel(p)).length, 6);
    await p.keyboard.press('Control+i');
    assert.deepEqual(await sel(p), []);
    const [hx, hy] = await xy(p, 4567, 50);
    await p.keyboard.down('Shift'); await p.mouse.click(hx, hy, { button: 'right' }); await p.keyboard.up('Shift');
    await p.waitForFunction(() => !app.player.seeking);
    assert.ok(Math.abs((await p.evaluate(() => app.player.timeMs)) - 4567) < 40, 'playhead moved');
    assert.equal(await p.evaluate(() => !!document.querySelector('.k-menu')), false, 'no context menu on Shift+RMB');
    await p.close();
  });

  test('G Y 1 0 Enter: +10 pos, one undo step, digits typed not placed; status line while it runs', async () => {
    const p = await blenderPage();
    await p.evaluate(() => app.select([2000, 3000], 'stroke'));
    const [x, y] = await xy(p, 3500, 50);
    await p.mouse.move(x, y);
    await p.keyboard.press('g');
    assert.match(await status(p), /^Grab: dx 0 ms, dy 0/);
    for (const k of ['y', '1', '0']) await p.keyboard.press(k);
    assert.match(await status(p), /dy \+10 \(position only\)  \[10\]/);
    await p.keyboard.press('Enter');
    assert.deepEqual(await pos(p), [20, 90, 30, 80, 20, 80]);
    assert.equal(await status(p), '');
    assert.deepEqual(await labels(p), ['Move 2 points']);
    assert.equal((await ats(p)).length, 6, 'no point placed by the digits');
    await p.keyboard.press('Control+z');
    assert.deepEqual(await pos(p), PTS.map((a) => a.pos));
    await p.close();
  });

  test('G X with the mouse then Esc / right click: nothing changes, no undo entry, no context menu', async () => {
    const p = await blenderPage();
    await p.evaluate(() => app.select([3000], 'stroke'));
    const [x, y] = await xy(p, 3000, 20);
    await p.mouse.move(x, y);
    await p.keyboard.press('g'); await p.keyboard.press('x');
    const [x2] = await xy(p, 3400, 20);
    await p.mouse.move(x2, y - 40, { steps: 4 });
    assert.match(await status(p), /dx \+\d+ ms, dy 0 \(time only\)/);
    assert.ok(await p.evaluate(() => { const c = document.querySelector('canvas.over'); return !!c; }));
    await p.keyboard.press('Escape');
    assert.deepEqual(await ats(p), PTS.map((a) => a.at));
    await p.keyboard.press('g');
    await p.mouse.move(x2, y - 40, { steps: 4 });
    await p.mouse.click(x2, y - 40, { button: 'right' });
    await p.waitForTimeout(150);
    assert.deepEqual(await ats(p), PTS.map((a) => a.at));
    assert.deepEqual(await pos(p), PTS.map((a) => a.pos));
    assert.equal(await p.evaluate(() => !!document.querySelector('.k-menu')), false);
    assert.deepEqual(await labels(p), []);
    await p.close();
  });

  test('G with the mouse, left click confirms; S 0 . 5 scales about the median; Shift+D duplicates; X deletes', async () => {
    const p = await blenderPage();
    await p.evaluate(() => app.select([3000], 'stroke'));
    const [x, y] = await xy(p, 3000, 20);
    await p.mouse.move(x, y);
    await p.keyboard.press('g');
    const [x2] = await xy(p, 3300, 20);
    await p.mouse.move(x2, y, { steps: 4 });
    await p.mouse.click(x2, y);
    const moved = (await ats(p))[2];
    assert.ok(moved > 3200 && moved < 3400, 'moved to ~3300: ' + moved);
    assert.equal(Math.abs(moved - Math.round(Math.round(moved / (1000 / 30)) * (1000 / 30))) <= 1, true, 'on the frame grid');
    await p.evaluate(() => app.select([1000, 2000], 'stroke'));
    for (const k of ['s', '0', '.', '5', 'Enter']) await p.keyboard.press(k);
    assert.deepEqual((await pos(p)).slice(0, 2), [35, 65], 'about the mean 50');
    await p.evaluate(() => app.select([5000, 6000], 'stroke'));
    await p.mouse.move(x, y);
    for (const k of ['Shift+d', 'x', '5', '0', '0', 'Enter']) await p.keyboard.press(k);
    assert.deepEqual((await ats(p)).slice(-4), [5000, 6000, 5500, 6500].sort((a, b) => a - b));
    assert.deepEqual((await sel(p)).sort((a, b) => a - b), [5500, 6500]);
    await p.keyboard.press('x');
    assert.deepEqual((await ats(p)).slice(-2), [5000, 6000]);
    assert.deepEqual((await labels(p)).slice(-3), ['Scale points', 'Duplicate 2 points', 'Delete points']);
    await p.close();
  });
  test('Modifiers row: Alt+drag on empty box-selects (Shift adds), A selects all, G 5 0 0 Enter moves them, X deletes', async () => {
    const p = await blenderPage();
    await p.evaluate(() => { app.commands.run('timeline.mod.toggle.orgasm', { t0: 1000, t1: 2000 }); app.commands.run('timeline.mod.toggle.orgasm', { t0: 4000, t1: 5000 }); });
    await p.waitForTimeout(150);
    const row = await p.evaluate(() => { const r = document.querySelector('[data-tl-lane="fx"] canvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
    const X = (t) => p.evaluate((t) => { const c = document.querySelector('[data-tl-lane="fx"] canvas').getBoundingClientRect(); return c.left + ((t - app.view.start) / app.view.span) * c.width; }, t);
    const fx = () => p.evaluate(async () => { const { tl } = await import('/src/features/timeline/state.svelte.js'); return { sel: [...tl.fxSel], list: app.doc.fx.map((e) => [e.t0, e.t1]) }; });
    const y = row.t + row.h / 2;
    await p.keyboard.down('Alt'); await p.mouse.move(await X(500), y); await p.mouse.down(); await p.mouse.move(await X(2500), y, { steps: 5 }); await p.mouse.up(); await p.keyboard.up('Alt');
    assert.equal((await fx()).sel.length, 1, 'box over the first (a plain drag would mark a modifier)');
    await p.keyboard.down('Shift'); await p.mouse.move(await X(3500), y); await p.mouse.down(); await p.mouse.move(await X(5500), y, { steps: 5 }); await p.mouse.up(); await p.keyboard.up('Shift');
    assert.equal((await fx()).sel.length, 2, 'Shift+drag adds the second');
    await p.keyboard.press('Alt+a');
    assert.equal((await fx()).sel.length, 0);
    await p.keyboard.press('a');
    assert.equal((await fx()).sel.length, 2, 'A: every modifier (the row has the keyboard)');
    assert.equal((await sel(p)).length, 0, 'the axis selection was not touched');
    for (const k of ['g', '5', '0', '0']) await p.keyboard.press(k);
    assert.match(await status(p), /^Grab: dt \+500 ms  \[500\]/);
    await p.keyboard.press('Enter');
    assert.deepEqual((await fx()).list, [[1500, 2500], [4500, 5500]]);
    assert.equal((await labels(p)).at(-1), 'Move modifiers');
    await p.keyboard.press('x');
    assert.deepEqual((await fx()).list, []);
    await p.close();
  });
});
