// dev/tabs-check.mjs -- paw-shgb stage 1 in the REAL window (your test instance: node dev/test-app.mjs start ... with
// FAKE_DELAY_MS=20 in its environment so a fake track lasts a few seconds; the CDP_* env it prints). The top bar's tabs: the
// home tab (the project page) and the open document, asserted on what is painted. A generated clip only.
//   open the clip, a playhead, two points (keys), zoom, the Track stage -> the home tab: the page painted, the editor not,
//   the video paused, Space does not play, type-to-filter works, hardly any animation frames -> the document tab: playhead,
//   points, zoom, stage, selection, layout, undo history as before (Ctrl+Z undoes the last point); Ctrl+Tab / Ctrl+Shift+Tab
//   both ways; a (fake) track started, home shown: the ring on the document tab moves, a toast shows, the run lands; the
//   open document's card says "open" and only switches; narrow 1000 px: nothing in the bar overlaps (both tabs);
//   the close cross asks, "Keep unsaved" leaves a "not saved yet" card and only the home tab.
//   SHOT_DIR=<dir> node dev/tabs-check.mjs <clip.mp4>
import { connectTestApp } from './cdp-connect.mjs';

const clip = process.argv[2];
if (!clip) { console.error('usage: node dev/tabs-check.mjs <clip.mp4>'); process.exit(2); }
const shots = process.env.SHOT_DIR || null;
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const answer = () => ev(() => { const d = app.dialog; if (!d) return ''; const id = /^Found/.test(d.title) ? 'ignore' : d.choices.find((c) => c.kind !== 'danger')?.id ?? null; d.resolve(id); return d.title; });
const settle = () => ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 200)))));
const metrics = async (w, h) => { const s = await page.context().newCDPSession(page); await s.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await settle(); return s; };
/** What is painted in the middle of the body: 'home' | 'editor' | 'other'; and whether each is visible at all. */
const painted = () => ev(() => {
  const b = document.querySelector('.shell').getBoundingClientRect(), el = document.elementFromPoint(b.width / 2, b.height / 2);
  const ed = document.querySelector('[data-testid="editor"]'), home = document.querySelector('.home');
  return { at: el?.closest('.home') ? 'home' : el?.closest('[data-testid="editor"]') ? 'editor' : 'other', editorVisible: !!ed && ed.checkVisibility({ visibilityProperty: true }), homeVisible: !!home && home.checkVisibility({ visibilityProperty: true }), inert: !!ed?.inert };
});
const state = () => ev(() => ({ t: Math.round(app.player.timeMs), axes: JSON.stringify(app.doc.axes), view: JSON.stringify(app.view), mode: app.mode, sel: [...app.doc.selection.ats].join(','),
  undo: app.history.entries.map((e) => e.label).join('|') + '@' + app.history.index, layout: JSON.stringify(app.settings.get('layout')), dirty: app.doc.dirty }));
const active = () => ev(() => app.tabs.active);
const press = async (k) => { await page.keyboard.press(k); await settle(); };

try {
  await page.waitForFunction(() => window.app?.project && window.__pawDev, null, { timeout: 60000 });
  await ev(() => app.project.close({ force: true }));
  await settle();
  ok((await page.locator('[data-testid="tab-home"]').count()) === 1 && (await page.locator('[data-testid="tab-doc"]').count()) === 0, 'no document: only the home tab');
  ok((await page.locator('[data-testid="tab-home"]').getAttribute('aria-selected')) === 'true' && (await painted()).at === 'home', 'the home tab selected, the page painted');

  // ---- open, playhead, points, zoom, Track ----
  const p = ev((v) => app.project.openVideo(v, { force: true }), clip);
  for (let k = 0; k < 6; k++) { await wait(300); await answer(); }
  await p;
  await page.waitForFunction((v) => app.doc.media?.path === v && app.player.ready, clip, { timeout: 60000 });
  await settle();
  ok(await active() !== 'home' && (await painted()).at === 'editor', 'opened: the document tab shows the editor');
  await ev(() => { app.setMode('refine'); document.activeElement?.blur?.(); });
  await ev(() => app.player.seek(3000)); await settle();
  await press('Numpad5');
  await ev(() => app.player.seek(4000)); await settle();
  await press('Numpad0');
  await press('='); await press('=');
  await press('Control+2');
  await ev(() => app.player.seek(5000)); await settle();
  const before = await state();
  ok(before.mode === 'track' && JSON.parse(before.axes).stroke?.length === 2 && JSON.parse(before.view).span < 30000, `set up: Track stage, 2 points, zoomed (${before.mode}, ${JSON.parse(before.axes).stroke?.length} points, span ${JSON.parse(before.view).span})`);
  if (shots) await page.screenshot({ path: `${shots}/tabs-doc-1600.png` });

  // ---- home ----
  await page.locator('[data-testid="tab-home"]').click();
  await settle();
  let pt = await painted();
  ok(await active() === 'home' && pt.at === 'home' && pt.homeVisible && !pt.editorVisible && pt.inert, `home tab: the page is painted, the editor is not (${JSON.stringify(pt)})`);
  ok(await ev(() => document.querySelector('video')?.paused !== false && !app.player.playing), 'home: the video is paused');
  ok(await ev(() => !!document.querySelector('.home')?.contains(document.activeElement)), 'home: the page has the keyboard');
  ok(await page.locator('.left .stages').evaluate((e) => getComputedStyle(e).visibility) === 'hidden', 'home: the stage tabs are hidden (their place kept)');
  ok(await page.locator('[data-testid="tab-doc"] .x').evaluate((e) => getComputedStyle(e).opacity === '1') === false, 'home: the document tab\'s close cross waits for hover');
  const t0 = await ev(() => app.player.timeMs);
  await page.keyboard.down(' '); await wait(120); await page.keyboard.up(' '); await wait(700);
  ok(await ev((t0) => !app.player.playing && Math.abs(app.player.timeMs - t0) < 1, t0), `Space on home does not play (playhead ${Math.round(t0)} -> ${Math.round(await ev(() => app.player.timeMs))})`);
  await press('ArrowRight');
  ok(await ev((t0) => Math.abs(app.player.timeMs - t0) < 1, t0), 'an arrow on home does not step the hidden video');
  await page.locator('.home').focus();
  await page.keyboard.type('tabs');
  await settle();
  const fv = await page.locator('.home .k-text-field input').inputValue().catch(() => '(no filter)');
  ok(fv === 'tabs', `type-to-filter on home: "${fv}"`);
  ok(await ev(() => app.doc.axes.stroke.length) === 2, 'typing on home put no points in the hidden document');
  ok((await page.locator('[data-testid="project-card"] .badges').filter({ hasText: 'open' }).count()) === 1, 'the open document\'s card says "open"');
  const raf = await ev(() => new Promise((res) => { let n = 0; const o = window.requestAnimationFrame; window.requestAnimationFrame = (f) => { n++; return o.call(window, f); }; setTimeout(() => { window.requestAnimationFrame = o; res(n); }, 1500); }));
  ok(raf <= 6, `home with the editor hidden: ${raf} animation frames requested in 1.5 s (no loops)`);
  if (shots) await page.screenshot({ path: `${shots}/tabs-home-1600.png` });
  await page.locator('.home .k-text-field input').fill(''); await settle();
  // the card of the open document only switches
  await page.locator('[data-testid="project-card"]').filter({ has: page.locator('.badges', { hasText: 'open' }) }).locator('.card-open').click();
  await settle();
  ok(await active() !== 'home' && !(await ev(() => app.dialog)) && (await state()).undo === before.undo, 'a click on the open document\'s card: back to it, no question, nothing reloaded');

  // ---- back: everything as it was ----
  await page.locator('[data-testid="tab-home"]').click(); await settle();
  await page.locator('[data-testid="tab-doc"] .go').click(); await settle();
  const after = await state();
  pt = await painted();
  ok(pt.at === 'editor' && pt.editorVisible && !pt.inert && !pt.homeVisible, `document tab: the editor painted again (${JSON.stringify(pt)})`);
  for (const k of Object.keys(before)) ok(after[k] === before[k], `kept: ${k}${after[k] === before[k] ? '' : ` (${before[k]} -> ${after[k]})`}`);
  await press('Control+z');
  ok(await ev(() => app.doc.axes.stroke.length) === 1, `Ctrl+Z undoes the last point (${await ev(() => JSON.stringify(app.doc.axes.stroke))})`);
  await press('Control+y');
  ok(await ev(() => app.doc.axes.stroke.length) === 2, 'Ctrl+Y redoes it');
  await press(' ');
  await wait(600);
  const playing = await ev(() => app.player.playing);
  await press(' ');
  ok(playing, 'Space in the editor still plays / pauses');

  // ---- Ctrl+Tab ----
  await press('Control+Tab'); ok(await active() === 'home', 'Ctrl+Tab: home');
  await press('Control+Tab'); ok(await active() !== 'home', 'Ctrl+Tab: the document');
  await press('Control+Shift+Tab'); ok(await active() === 'home', 'Ctrl+Shift+Tab: home');
  await press('Control+Shift+Tab'); ok(await active() !== 'home', 'Ctrl+Shift+Tab: the document');

  // ---- a (fake) track running while home is shown ----
  await ev(() => app.setMode('track'));
  await page.waitForFunction(() => window.__pawDev.trackingFor(app).trackers.some((t) => t.id === 'fake.none'), null, { timeout: 30000 });
  const runs0 = await ev(() => window.__pawDev.trackingFor(app).runs.length);
  await ev(() => { window.__trackDone = window.__pawDev.trackingFor(app).trackRange({ tracker: 'fake.none', range: { t0: 0, t1: app.durationMs }, scenes: 'one' }).then((r) => (window.__trackRes = r)); });
  await page.waitForFunction(() => window.__pawDev.trackingFor(app).busy, null, { timeout: 15000 });
  await page.locator('[data-testid="tab-home"]').click(); await settle();
  const ring = page.locator('[data-testid="tab-ring"]');
  await ring.waitFor({ timeout: 10000 }).catch(() => {});
  const fr = [];
  for (let k = 0; k < 6; k++) { fr.push(await ring.getAttribute('data-frac').catch(() => null)); await wait(700); }
  const nums = fr.filter((x) => x !== null && x !== '').map(Number);
  ok(nums.length >= 2 && nums[nums.length - 1] > nums[0], `home: the ring on the document tab moves (${fr.join(', ')})`);
  if (shots) await page.locator('header.top').screenshot({ path: `${shots}/tabs-ring.png` });
  await ev(() => app.toast('A toast while home is shown', 'info'));
  await settle();
  ok(await page.locator('.kit-toast-host-msg', { hasText: 'A toast while home is shown' }).isVisible(), 'home: toasts appear');
  await page.waitForFunction(() => window.__trackRes, null, { timeout: 90000 });
  const res = await ev(() => ({ run: !!window.__trackRes.run, err: window.__trackRes.error || null, runs: window.__pawDev.trackingFor(app).runs.length }));
  ok(res.run && res.runs === runs0 + 1, `the run landed in the document while home was shown (${JSON.stringify(res)})`);
  await settle();
  ok((await ring.count()) === 0, 'the job ended: no ring');
  ok((await painted()).at === 'home', 'still home after the job');
  await page.locator('[data-testid="tab-doc"] .go').click(); await settle();

  // ---- narrow / wide: the bar ----
  const boxes = () => ev(() => {
    const r = (el) => { const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width) }; };
    const items = [...document.querySelectorAll('.top .brand, .top .left > *, .top .tabs > *, .top .acts > *')].filter((e) => e.checkVisibility()).map((e) => ({ k: e.className.split(' ')[0] || e.tagName, ...r(e) }));
    const bad = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (items[i].l < items[j].r - 1 && items[j].l < items[i].r - 1 && !(items[i].k === 'left' || items[j].k === 'left')) bad.push(items[i].k + '/' + items[j].k);
    const nm = document.querySelector('.top .tab.t-doc .nm'), lbl = document.querySelector('.top .t-home .lbl');
    return { bad, over: document.querySelector('.top').scrollWidth > document.querySelector('.top').clientWidth, nameW: nm ? Math.round(nm.getBoundingClientRect().width) : -1, cut: nm ? nm.scrollWidth > nm.clientWidth : false, label: !!lbl && lbl.checkVisibility() };
  });
  for (const [w, h] of [[1000, 700], [1280, 720], [2560, 1200]]) {
    const s = await metrics(w, h);
    for (const tab of ['doc', 'home']) {
      if (tab === 'home') await page.locator('[data-testid="tab-home"]').click(); else await ev(() => app.tabs.show(app.tabId));
      await settle();
      const b = await boxes();
      ok(!b.bad.length && !b.over, `${w} px, ${tab}: nothing in the bar overlaps (${JSON.stringify(b)})`);
      if (w === 1000) ok(!b.label, `${w} px: the home tab is its icon only`);
      if (shots) await page.locator('header.top').screenshot({ path: `${shots}/tabs-bar-${w}-${tab}.png` });
    }
    await s.send('Emulation.clearDeviceMetricsOverride'); await s.detach(); await settle();
  }
  await ev(() => app.tabs.show(app.tabId)); await settle();

  // ---- the close cross: no question (the project is written continuously since paw-up1r stage 1); home with its card ----
  await page.locator('[data-testid="tab-doc"]').hover();
  ok(await page.locator('[data-testid="tab-close"]').evaluate((e) => getComputedStyle(e).opacity) === '1', 'hover: the close cross shows');
  await page.locator('[data-testid="tab-close"]').click();
  await page.waitForFunction(() => !app.tabs.list.length || !!app.dialog, null, { timeout: 10000 }).catch(() => {});
  ok(!(await ev(() => app.dialog?.title || '')), 'the cross asks nothing');
  await settle(); await wait(800);
  ok((await page.locator('[data-testid="tab-doc"]').count()) === 0 && await active() === 'home' && (await painted()).at === 'home', 'closed: only the home tab, the page painted');
  // (its card is its project's: every opened video has a .pawproj beside it since 0cef84c, paw-up1r stage 1)
  const card = page.locator(`[data-testid="project-card"][data-path="${clip.replace(/\.[^.\\/]+$/, '.pawproj').replace(/\\/g, '\\\\')}"]`);
  await card.waitFor({ timeout: 10000 }).catch(() => {});
  ok((await card.count()) === 1, `its project card is on the page (cards: ${(await page.locator('[data-testid="project-card"]').evaluateAll((es) => es.map((e) => e.dataset.path))).join(' | ')}; recent: ${(await ev(() => (app.project.recent || []).map((e) => e.path))).join(' | ')})`);
  if (shots) await page.screenshot({ path: `${shots}/tabs-after-close.png` });
} catch (e) { fails++; console.log('FAIL', e?.stack || e); }
console.log(fails ? `${fails} FAILED` : 'all ok');
await browser.close().catch(() => {});
process.exit(fails ? 1 : 0);
