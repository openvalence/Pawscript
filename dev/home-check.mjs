// dev/home-check.mjs -- paw-xn04 in the REAL window (your test instance: node dev/test-app.mjs start ...; the CDP_* env it
// prints). The project page and the provenance of written funscripts, asserted on what is painted. Generated clips only.
//   1. prepare: the page shows with no project; alpha.mp4 opened, scenes + points, saved (alpha.pawproj + alpha.funscript
//      beside it); charlie.mp4 the same; bravo.mp4 opened, points, never saved: written all the same (continuous projects,
//      0cef84c: bravo.pawproj beside it, no funscript); every tab closed (the Projects page shows).
//   2. (restart the app with the same --id) check: the Projects page (no tab reopens: none was open at quit, f19f112);
//      charlie.mp4 deleted first (its video goes missing); three cards, each its .pawproj's; alpha's and bravo's thumbnails
//      painted (pixels, not the placeholder); bravo's card has its 3 points and no unsaved mark; charlie "video missing";
//      alpha's script line "Pawscript"; a click on bravo opens it with its points; "Remove from list" on alpha keeps
//      its files; alpha reopened: the Points panel says "Written by Pawscript ... from this project"; alpha.funscript edited
//      outside: the card says "edited elsewhere since" and, loaded, the panel "changed outside since".
//   (paw-kbhn: before tabs (f19f112 / 04c6fd6, reopened at start) and continuous projects (0cef84c) the prepare phase replaced
//   one document by the next in one window and bravo stayed "not saved yet"; now each document is its own tab, closed here, and
//   every opened video is written to its own .pawproj.)
//   node dev/home-check.mjs prepare <clips dir>
//   node dev/test-app.mjs stop --dir <d>; node dev/test-app.mjs start --dir <d> --target <t> --id <the same id>
//   SHOT_DIR=<dir> node dev/home-check.mjs check <clips dir>
import { existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';

const [phase, dir] = process.argv.slice(2);
if (!['prepare', 'check'].includes(phase) || !dir) { console.error('usage: node dev/home-check.mjs prepare|check <clips dir>'); process.exit(2); }
const shots = process.env.SHOT_DIR || null;
const A = join(dir, 'alpha.mp4'), B = join(dir, 'bravo.mp4'), C = join(dir, 'charlie.mp4');
const proj = (v) => v.replace(/\.mp4$/, '.pawproj'), fun = (v) => v.replace(/\.mp4$/, '.funscript');
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
// scripted answers: never a destructive one (the app ignores them anyway)
const answer = (want = {}) => ev((want) => { const d = app.dialog; if (!d) return ''; const t = d.title || ''; const id = Object.entries(want).find(([k]) => t.includes(k))?.[1] ?? (/^Found/.test(t) ? 'ignore' : /Save changes/.test(t) ? 'keep' : d.choices.find((c) => c.kind !== 'danger')?.id ?? null); d.resolve(id); return t; }, want);
const settle = () => ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 200)))));
// every tab closed and written (a document is a tab of its own since f19f112: the next open would add one beside it)
const closeAll = async () => { await ev(() => app.tabs.closeAll({ quit: false })); await settle(); };
const openVideo = async (v) => {
  await closeAll();
  const p = ev((v) => app.project.openVideo(v, { force: true }), v);
  for (let k = 0; k < 6; k++) { await wait(300); await answer(); }
  await p;
  await page.waitForFunction((v) => app.doc.media?.path === v && app.player.ready, v, { timeout: 60000 });
};
const thumbOf = (path) => ev((p) => app.project.recent.find((e) => e.path.toLowerCase() === p.toLowerCase())?.thumb || null, path);
const waitThumb = async (path) => { for (let k = 0; k < 60 && !(await thumbOf(path)); k++) await wait(250); return thumbOf(path); };
const card = (path) => page.locator(`[data-testid="project-card"][data-path="${path.replace(/\\/g, '\\\\')}"]`);
/** Luminance spread of what is painted in a locator (its screenshot decoded in the page: a flat placeholder is ~0). */
const spread = async (loc) => {
  const b64 = (await loc.screenshot()).toString('base64');
  return ev((b64) => new Promise((res) => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let s = 0, s2 = 0, n = 0; for (let i = 0; i < d.length; i += 16) { const y = (d[i] + d[i + 1] + d[i + 2]) / 3; s += y; s2 += y * y; n++; } const m = s / n; res(Math.sqrt(Math.max(0, s2 / n - m * m))); }; im.src = 'data:image/png;base64,' + b64; }), b64);
};
const metrics = async (w, h) => { const s = await page.context().newCDPSession(page); await s.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await settle(); return s; };

try {
  await page.waitForFunction(() => window.app?.project, null, { timeout: 60000 });
  if (phase === 'prepare') {
    for (const f of [proj(A), fun(A), proj(C), fun(C), proj(B), fun(B)]) if (existsSync(f)) rmSync(f);
    await ev(() => app.project.close({ force: true }));
    await settle();
    ok(await page.locator('.home h1').count() === 1, 'no project: the project page shows');
    for (const [v, pts] of [[A, [[500, 0], [1000, 100], [1500, 0], [4000, 100], [4500, 0]]], [C, [[300, 20], [800, 80]]]]) {
      await openVideo(v);
      await ev((pts) => {
        app.transact('Scenes', () => { app.doc.scenes = [{ start_ms: 0, end_ms: 3000 }, { start_ms: 3000, end_ms: 6000 }]; });
        app.edit('Points', 'stroke', pts.map(([at, pos]) => ({ at, pos })));
      }, pts);
      const saved = ev(() => app.project.save());
      for (let k = 0; k < 4; k++) { await wait(300); await answer(); }
      ok(await saved, `${v.split(/[\\/]/).pop()} saved`);
      ok(existsSync(proj(v)) && existsSync(fun(v)), `${proj(v).split(/[\\/]/).pop()} and its funscript beside the clip`);
      ok(!!(await waitThumb(proj(v))), `a thumbnail cached for ${proj(v).split(/[\\/]/).pop()}`);
    }
    const written = JSON.parse(readFileSync(fun(A), 'utf8'));
    ok(written.metadata?.pawscript?.app === 'Pawscript' && written.metadata.pawscript.project === 'alpha.pawproj' && written.metadata.creator_software === 'Pawscript', `alpha.funscript carries metadata.pawscript (${JSON.stringify(written.metadata?.pawscript)})`);
    await openVideo(B);
    await ev(() => app.edit('Points', 'stroke', [{ at: 700, pos: 10 }, { at: 1200, pos: 90 }, { at: 1700, pos: 10 }]));
    ok(await ev(() => app.project.flushAutosave()), 'bravo written');
    // 0cef84c: never saved, still written: bravo.pawproj beside the clip (the funscript only on save / publish)
    ok(existsSync(proj(B)) && !existsSync(fun(B)), 'bravo.pawproj beside the clip without a save, no bravo.funscript');
    ok(!!(await waitThumb(proj(B))), 'a thumbnail cached for bravo.pawproj');
    await closeAll();
    const ids = await page.locator('[data-testid="project-card"]').evaluateAll((es) => es.map((e) => e.dataset.path.split(/[\\/]/).pop()));
    ok(await ev(() => app.tabs.home && app.tabs.list.length === 0) && ids.length === 3, `every tab closed: the Projects page, three cards before the restart (${ids.join(', ')})`);
    // quit as the owner does (tabs-multi-check does the same): the open-tab list for the next start lives in localStorage, which
    // the WebView writes to disk seconds later or on the way out; the kill a restart is (test-app stop) lost that write, and the
    // next start reopened the tab alpha had been in
    await ev(() => app.tabs.closeAll({ quit: true }));
    await ev(() => { setTimeout(() => app.backend.windowCloseNow(), 50); });
    await new Promise((r) => setTimeout(r, 2000));   // (not page.waitForTimeout: the page is gone)
    console.log(fails ? `${fails} FAILED` : 'all ok');
    await browser.close().catch(() => {});
    process.exit(fails ? 1 : 0);
  } else {
    if (existsSync(C)) rmSync(C);
    await ev(() => window.dispatchEvent(new Event('focus')));   // the page looks again when the window comes back
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="project-card"]').length >= 3, null, { timeout: 30000 }).catch(() => {});
    await wait(1500);   // the per-card disk checks
    const n = await page.locator('[data-testid="project-card"]').count();
    const home = await ev(() => app.tabs.home && app.tabs.list.length === 0);
    ok(home && n === 3, `after a restart: the Projects page (no tab was open at quit), three cards (${n}): alpha, bravo, charlie` + (home && n === 3 ? '' : ` (page: ${JSON.stringify(await ev(() => ({ home: !!document.querySelector('.home'), tab: app.tabId, tabs: app.tabs?.list?.length, media: app.doc.media?.path || null, recent: (app.project.recent || []).map((e) => e.path) })))})`));
    for (const v of [proj(A), proj(B)]) {
      const t = card(v).locator('.thumb');
      const img = await card(v).locator('.thumb img').evaluate((im) => im.complete && im.naturalWidth > 0).catch(() => false);
      const sp = await spread(t);
      ok(img && sp > 25, `${v.split(/[\\/]/).pop()}: thumbnail painted (img loaded ${img}, luminance spread ${sp.toFixed(1)})`);
    }
    // 0cef84c: bravo was written like any project (no unsaved mark anywhere since): its card is its .pawproj's
    const bt = await card(proj(B)).innerText().catch(() => '(no card)');
    ok((await card(proj(B)).getAttribute('data-unsaved').catch(() => 'none')) !== '1' && !/not saved yet/i.test(bt) && /3 points/.test(bt), `bravo's card: its 3 points, no unsaved mark: "${bt.replace(/\n/g, ' | ')}"`);
    const ct = await card(proj(C)).innerText();
    ok(/video missing/i.test(ct), `charlie (video deleted) is marked: "${ct.split('\n')[0]}"`);
    const ca = await card(proj(A)).locator('[data-testid="card-script"]').innerText();
    ok(/alpha\.funscript: Pawscript$/.test(ca.trim()), `alpha's script line: "${ca.trim()}"`);
    const at = await card(proj(A)).innerText();
    ok(/2 scenes/.test(at) && /5 points/.test(at) && /stroke only/.test(at), `alpha's state line: "${at.replace(/\n/g, ' | ')}"`);
    if (shots) {
      let s = await metrics(1280, 720); await page.screenshot({ path: `${shots}/home-1280x720.png` }); await s.detach();
      s = await metrics(3440, 1440); await page.screenshot({ path: `${shots}/home-3440x1440.png` }); await s.detach();
      s = await metrics(1280, 720);
      await page.keyboard.press('Escape'); await page.locator('.home').focus(); await page.keyboard.type('alp'); await settle();
      await page.screenshot({ path: `${shots}/home-filter.png` });
      ok(await page.locator('[data-testid="project-card"]').count() === 1, 'type-to-filter: "alp" leaves one card');
      await page.locator('.home .k-text-field input').fill(''); await settle();
      await s.send('Emulation.clearDeviceMetricsOverride'); await s.detach(); await settle();
    }
    // a click on bravo: its written state
    await card(proj(B)).locator('.card-open').click();
    await page.waitForFunction((v) => app.doc.media?.path?.toLowerCase() === v.toLowerCase() && !app.project.busy, B, { timeout: 30000 });
    const st = await ev(() => ({ n: app.doc.axes.stroke?.length, project: app.doc.project?.path?.split(/[\\/]/).pop() }));
    ok(st.n === 3 && st.project === 'bravo.pawproj', `bravo opened from its card with its 3 points (${JSON.stringify(st)})`);
    await closeAll();
    ok((await card(proj(B)).count()) === 1, 'bravo is still listed after closing it');
    // remove alpha from the list: files stay
    await card(proj(A)).locator('.card-open').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Remove from list' }).click();
    await settle();
    ok((await card(proj(A)).count()) === 0 && existsSync(proj(A)) && existsSync(A) && existsSync(fun(A)), 'Remove from list: the card goes, alpha.pawproj / alpha.mp4 / alpha.funscript stay');
    // reopen alpha: where its script came from
    const op = ev((p) => app.project.openPaths([p]), proj(A));
    for (let k = 0; k < 4; k++) { await wait(300); await answer(); }
    await op;
    await page.waitForFunction(() => !app.project.busy);
    await ev(() => { app.setMode('refine'); app.select([]); app.doc.range = null; app.showPanel?.('inspector.selection'); });
    await settle();
    const origin = page.locator('[data-testid="script-origin"]');
    await origin.waitFor({ timeout: 10000 }).catch(() => {});
    const o1 = (await origin.count()) ? await origin.innerText() : '(not shown)';
    ok(/^Written by Pawscript \S+ on .+ from this project$/.test(o1), `Points panel: "${o1}"`);
    const sb = page.locator('[data-testid="status-origin"]');
    const sbText = async () => ((await sb.count()) ? (await sb.innerText()).trim() : '(not shown)');
    ok((await sbText()) === 'Pawscript', `status bar: "${await sbText()}"`);
    await ev(() => app.project.close({ force: true }));
    await settle();
    // edited outside
    const f = JSON.parse(readFileSync(fun(A), 'utf8'));
    f.actions[1].pos = 77;
    writeFileSync(fun(A), JSON.stringify(f));
    await ev(() => window.dispatchEvent(new Event('focus')));   // back from the editor that changed it: the page looks again
    await wait(1200);
    const ca2 = await card(proj(A)).locator('[data-testid="card-script"]').innerText().catch(() => '(no card)');
    ok(/edited elsewhere since/.test(ca2), `after an outside edit, alpha's script line: "${ca2.trim()}"`);
    const op2 = ev((p) => app.project.openPaths([p]), proj(A));
    for (let k = 0; k < 4; k++) { await wait(300); await answer({ 'changed outside': 'file' }); }
    await op2;
    await page.waitForFunction(() => !app.project.busy);
    await ev(() => { app.setMode('refine'); app.select([]); app.doc.range = null; app.showPanel?.('inspector.selection'); });
    await settle();
    const o2 = (await origin.count()) ? await origin.innerText() : '(not shown)';
    ok(/changed outside since/.test(o2), `loaded, the Points panel: "${o2}"`);
    ok(/edited elsewhere since/.test(await sbText()), `status bar: "${await sbText()}"`);
    if (shots) await page.screenshot({ path: `${shots}/home-inspector.png` });
    await ev(() => app.project.close({ force: true }));
  }
} catch (e) { fails++; console.log('FAIL', e?.stack || e); }
console.log(fails ? `${fails} FAILED` : 'all ok');
await browser.close().catch(() => {});
process.exit(fails ? 1 : 0);
