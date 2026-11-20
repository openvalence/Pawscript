// dev/tracker-panel-check.mjs -- paw-r73w step 1 in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints): the
// Tracker panel reordered (the shot's Adjust + Fusion on top, the runs, Setup folded below), on a generated clip with a synthetic fused
// run (test/fusion-synth.mjs tag-not-driver) linked to its shot and selected. It counts the panel's controls (every button, slider,
// combobox, input): rendered = reachable by scrolling without opening a fold, in view = inside the panel's viewport, at 1280 x 720 and
// at 1920 x 1080. COUNT_ONLY=1: just print the counts (the HEAD build's "before"). Otherwise it asserts at 300 px:
//   1. nothing overflows (no horizontal scroll, no control past the panel's edge) and no control's words are cut;
//   2. every folded section starts closed, opens, remembers its state over a reload (settings tracking.panel.open), closes again;
//      the closed camera fold's header names a non-default camera removal;
//   3. the deleted buttons' surviving copies work: Track (the shot chips' Track, T), Track ROI (the chips' button, Ctrl+T), Cancel
//      (the status bar's x, Esc), Range (the Tracker row's shot strip sets it, Esc clears it), Stabilise (the Shot popover);
//   4. the fusion pad drags (one undo step) and the panel survives a weight at 0; ui:ctl names the control and the surface.
//   node dev/tracker-panel-check.mjs <clip.mp4> [<screenshot dir>]
import { connectTestApp } from './cdp-connect.mjs';
import { runCtl } from './run-bar.mjs';
import { CASES } from '../test/fusion-synth.mjs';

const [clip, shots] = process.argv.slice(2);
if (!clip) { console.error('usage: node dev/tracker-panel-check.mjs <clip.mp4> [<screenshot dir>]'); process.exit(2); }
const COUNT_ONLY = !!process.env.COUNT_ONLY;
const sc = CASES.find((c) => c.id === 'tag-not-driver').make();
const chans = Object.fromEntries(Object.entries(sc.run.channels).map(([k, c]) => [k, Array.from(c.t, (t, i) => [t, c.v[i] === c.v[i] ? c.v[i] : null])]));
// a points tracker's centroid and camera path, so Adjust (camera, stroke axis, strokes) is live as on a real TAPNext run
for (const [k, v] of [['centroid_x', 0.5], ['centroid_y', 0.5], ['cam_x', 0], ['cam_y', 0]]) chans[k] = chans.who_pair_proj.map(([t], i) => [t, k === 'centroid_y' ? 0.5 + 0.1 * Math.sin(i / 5) : v]);
const { browser, page } = await connectTestApp();
const cdp = await page.context().newCDPSession(page);
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
const snap = async (name) => { if (shots) await page.locator('.tk.k-scroll').screenshot({ path: `${shots}/${name}.png` }).catch(() => {}); };
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'restore' : /^Replace/.test(t) ? 'replace' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null); });

/** Open the clip, answering the app's dialogs (Recover, Save changes) until the player is ready; a second try if one was dismissed. */
async function openClip() {
  for (let tries = 0; tries < 3; tries++) {
    if (await ev(() => !!app.doc.media && app.player.ready)) return;
    const p = ev((c) => app.project.openVideo(c, { force: true }), clip).catch(() => {});
    for (let k = 0; k < 40 && !(await ev(() => !!app.doc.media && app.player.ready)); k++) { await wait(500); await answer(); }
    await p;
  }
  throw new Error('the clip did not open');
}
async function resize(w, h) {
  try {
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: w, height: h } });
  } catch {
    await ev(([w, h]) => window.__TAURI_INTERNALS__?.invoke('plugin:window|set_size', { label: 'main', value: { Logical: { width: w, height: h } } }), [w, h]).catch(() => {});
  }
  await wait(900);
}
// paw-p8o2: the shot's Adjust strip lives only in the band under the stroke lane: unfold it (its ▾) when it is folded
const openBand = async () => { await page.evaluate(() => { if (!document.querySelector('[data-testid="derive-strip"]')) document.querySelector('[data-testid="inspector-more"]')?.click(); }); await page.waitForTimeout(300); };
async function setup() {
  await ev((chans) => {
    const D = window.__pawDev, tr = D.trackingFor(app);
    window.TR = tr;
    app.layout.reset(); app.setMode('track'); app.showPanel?.('tracking');
    tr.runs = []; app.doc.ghosts = []; tr.select('');
    app.doc.scenes = [{ start_ms: 0, end_ms: 20000, tags: ['handjob'] }, { start_ms: 20000, end_ms: app.durationMs }];
    const T = chans.who_pair_proj.map(([t]) => t);
    const run = D.makeRun({ n: 7, tracker: { id: 'tapnext_points', name: 'TAPNext++' }, params: { axis: 'auto' }, range: { start: 0, end: 20000 }, roi: null,
      result: { samples: T.map((t) => [t, 0.5]), points: [{ at: 100, pos: 0 }, { at: 19900, pos: 100 }], scenes: [{ start_ms: 0, end_ms: 20000, sign: 1 }], channels: chans, notes: [] },
      frames: D.newFrames(), runs: [] });
    tr.runs = [run];
    app.doc.ghosts = [tr.ghostOf(run)];
    tr.select(run.id);
    window.RID = run.id;
    tr.linkScene(0, run.id, 'fused');
    app.player.pause(); app.player.seek(5000);
  }, chans);
  await page.locator('.tk.k-scroll').waitFor({ timeout: 15000 });
  await wait(800);
}
/** The panel's controls: rendered (not in a closed fold, not display:none) and in view (inside the panel's scrolled viewport). */
const count = () => ev(() => {
  const root = document.querySelector('.tk.k-scroll'), R = root.getBoundingClientRect();
  const all = [...root.querySelectorAll('button, [role="slider"], [role="combobox"], input, select, textarea, summary')];
  const shown = all.filter((el) => !el.closest('[inert]') && el.checkVisibility?.({ visibilityProperty: true }) !== false && el.getClientRects().length && !(el.closest('details:not([open])') && !el.matches('summary')));
  const sized = shown.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const inView = sized.filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > R.top + 2 && r.top < R.bottom - 2; });
  const name = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('role') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 32);
  return { w: Math.round(R.width), h: Math.round(R.height), total: all.length, rendered: sized.length, inView: inView.length, view: inView.map(name), names: sized.map(name) };
});

/** Nothing past the panel's edge, no words cut. */
const overflow = async (label) => {
  const o = await ev(() => {
    const root = document.querySelector('.tk.k-scroll'), R = root.getBoundingClientRect(), bad = [];
    // every painted element: past the panel's edge, or its words cut (an ellipsis / clipped one-line text); the run rows'
    // name and meta are one line by design (their full text is the row's own tooltip target), counted apart
    let runRows = 0, kitForm = 0;
    for (const el of root.querySelectorAll('*')) {
      if (el.closest('[inert]') || !el.getClientRects().length || el.closest('svg')) continue;
      if (el.closest('.k-param-form')) { if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow === 'ellipsis') kitForm++; continue; }   // the kit form's own label ellipsis (a tracker's params, folded), counted apart
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const words = () => (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (r.right > R.right + 1 || r.left < R.left - 1) { bad.push('past the edge: ' + words()); continue; }
      const cs = getComputedStyle(el);
      const clips = cs.textOverflow === 'ellipsis' || (cs.whiteSpace === 'nowrap' && cs.overflowX !== 'visible');
      if (clips && el.scrollWidth > el.clientWidth + 1 && el.textContent.trim()) { if (el.closest('.gname')) runRows++; else bad.push('cut: ' + words()); }
    }
    return { w: Math.round(R.width), hscroll: root.scrollWidth > root.clientWidth + 1, bad: [...new Set(bad)], runRows, kitForm };
  });
  ok(!o.hscroll && !o.bad.length, `${label}: panel ${o.w} px, no horizontal scroll, nothing past the edge or cut${o.bad.length ? ': ' + o.bad.slice(0, 8).join('; ') : ''} (apart: run rows one line by design ${o.runRows} cut, kit param-form labels ${o.kitForm} cut)`);
};
try {
  await page.reload();
  await page.waitForFunction(() => window.app?.project && window.__pawDev?.trackingFor, null, { timeout: 60000 });
  await ev(() => { app.settings.set('tracking.panel.open', {}); window.__notes = []; const n = app.usage.note.bind(app.usage); app.usage.note = (k, d, o) => { window.__notes.push([k, d]); return n(k, d, o); }; });
  await openClip();
  await resize(1280, 720);
  await setup();
  const c720 = await count();
  console.log(`1280x720: panel ${c720.w}x${c720.h}: ${c720.total} controls in the DOM, ${c720.rendered} rendered (unfolded), ${c720.inView} in view`);
  console.log('  in view: ' + c720.view.join(' | '));
  if (process.env.VERBOSE) console.log('  rendered: ' + c720.names.join(' | '));
  await snap('panel-1280x720');
  await ev(() => TR.select('')); await wait(400);
  const cNone = await count();
  console.log(`1280x720, no run selected (the shot's linked run in Adjust): ${cNone.rendered} rendered, ${cNone.inView} in view`);
  await ev(() => TR.select(RID)); await wait(400);
  await resize(1920, 1080);
  await wait(500);
  const c1080 = await count();
  console.log(`1920x1080: panel ${c1080.w}x${c1080.h}: ${c1080.total} in the DOM, ${c1080.rendered} rendered, ${c1080.inView} in view`);
  console.log('  in view: ' + c1080.view.join(' | '));
  await snap('panel-1920x1080');
  if (COUNT_ONLY) { await resize(1280, 720); await overflow('at 300 px'); throw 'count only'; }

  // ---- 1. nothing overflows or truncates at 300 px (1280 x 720) ----
  await resize(1280, 720);
  await overflow('folds closed');

  // ---- 2. folds: closed by default, open, remembered over a reload, close ----
  await openBand();   // paw-p8o2: the shot's folds (camera, strokes, ...) are the band's now, the setup ones the panel's
  const folds = () => ev(() => [...document.querySelectorAll(':is(.tk.k-scroll, [data-testid="inspector-more-body"]) .k-section[data-fold]')].map((s) => ({ id: s.dataset.fold, title: s.querySelector('.kit-section-title')?.textContent.trim(), open: s.hasAttribute('data-open') })));
  const f0 = await folds();
  ok(f0.length === 6 && f0.every((f) => !f.open), `${f0.length} folds, all closed by default: ${f0.map((f) => f.title).join(', ')}`);
  for (const f of f0) {
    const head = page.locator(`:is(.tk.k-scroll, [data-testid="inspector-more-body"]) .k-section[data-fold="${f.id}"] > .kit-section-head .kit-section-trigger`);
    await head.scrollIntoViewIfNeeded(); await head.click(); await wait(350);
  }
  const f1 = await folds();
  ok(f1.every((f) => f.open), `every fold opens: ${f1.filter((f) => !f.open).map((f) => f.title).join(', ') || 'all open'}`);
  const stored = await ev(() => app.settings.get('tracking.panel.open'));
  ok(Object.values(stored || {}).filter(Boolean).length >= f0.length, `remembered in settings tracking.panel.open: ${JSON.stringify(stored)}`);
  await overflow('folds open');
  await snap('panel-open');
  await ev(() => app.settings.flush());
  await page.reload();
  await page.waitForFunction(() => window.app?.doc && window.__pawDev?.trackingFor, null, { timeout: 60000 });
  await openClip();
  await setup();
  await openBand();
  const f2 = await folds();
  ok(f2.length === f1.length && f2.every((f) => f.open), `after a reload every fold is still open (${f2.filter((f) => f.open).length} / ${f2.length})`);
  for (const f of f2) { const head = page.locator(`:is(.tk.k-scroll, [data-testid="inspector-more-body"]) .k-section[data-fold="${f.id}"] > .kit-section-head .kit-section-trigger`); await head.scrollIntoViewIfNeeded(); await head.click(); await wait(250); }
  await ev(() => app.settings.flush());
  await page.reload();
  await page.waitForFunction(() => window.app?.doc && window.__pawDev?.trackingFor, null, { timeout: 60000 });
  await openClip();
  await ev(() => { window.__notes = []; const n = app.usage.note.bind(app.usage); app.usage.note = (k, d, o) => { window.__notes.push([k, d]); return n(k, d, o); }; });
  await setup();
  const f3 = await folds();
  ok(f3.every((f) => !f.open), 'closed again, and still closed after another reload');

  // the camera removal is folded: its closed header names a non-default mode / strength (never invisible), and only the name when default
  await openBand();
  const camHead = () => ev(() => document.querySelector('[data-testid="derive-strip"] .k-section[data-fold="camera"]')?.querySelector('.kit-section-title')?.textContent.trim());
  const ch0 = await camHead();
  await ev(() => TR.setDerive(0, { cam: { mode: 'zoom', strength: 50 } }, { scope: 'shot', label: 'check' })); await wait(300);
  const ch1 = await camHead();
  await ev(() => TR.setDerive(0, { cam: null }, { scope: 'shot', label: 'check' })); await wait(300);
  ok(ch0 === 'Camera removal' && /zoom · 50 %/.test(ch1) && (await camHead()) === 'Camera removal', `the closed camera fold says what is set: "${ch0}" -> "${ch1}" -> "${await camHead()}"`);
  // ---- 3. the deleted buttons are gone from the panel; their surviving copies work ----
  const panelText = await page.locator('.tk.k-scroll').innerText();
  const gone = await ev(() => { const root = document.querySelector('.tk.k-scroll'); const words = [...root.querySelectorAll('button')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()); return ['Track T', 'Track', 'Track ROI', 'Cancel', 'Scene at playhead', 'Whole video', 'Stabilise', 'Stabilize'].filter((w) => words.some((x) => x === w || x.startsWith(w + ' ') && w !== 'Track')); });
  ok(!gone.length, `the panel has no Track / Track ROI / Cancel / Scene at playhead / Whole video / Stabilise button${gone.length ? ': still ' + gone.join(', ') : ''}`);
  ok(!/Range\s/.test(panelText.split('\n')[0] || ''), 'no Range section at the top');
  // Track (the grid): the shot chips' Track and T call gridFrame; Track ROI: the chips' button and Ctrl+T track the one painted part
  // (paw-x8we: trackPart; the fake sidecar lists no grid tracker: canGrid / canTrack say yes here, one part is painted, the call
  // itself is recorded, not run)
  await ev(() => { window.__calls = []; const tr = TR; for (const g of ['canGrid', 'canTrack']) Object.defineProperty(tr, g, { get: () => true, configurable: true }); tr.paintedParts = () => [{ name: 'c2_penis', group: { name: 'c2_penis', t_ms: 0, poly: [[0.4, 0.4], [0.5, 0.4], [0.5, 0.6]] } }]; for (const m of ['gridFrame', 'track', 'trackPart']) { const f = tr[m].bind(tr); tr['__' + m] = f; tr[m] = (...a) => { window.__calls.push(m); return undefined; }; } });
  await page.locator('[data-btn="track"]').click(); await wait(300);
  await page.locator('[data-btn="track-roi"]').click(); await wait(300);
  await ev(() => document.querySelector('canvas[aria-label="Tracker signals"]')?.focus());
  await page.keyboard.press('t'); await wait(300);
  const calls = await ev(() => window.__calls);
  ok(calls[0] === 'gridFrame' && calls.includes('trackPart') && calls.filter((c) => c === 'gridFrame').length >= 2, `Track (chips) -> gridFrame, Track ROI (chips) -> trackPart, T -> gridFrame: ${calls.join(', ')}`);
  await ev(() => { const tr = TR; tr.gridFrame = tr.__gridFrame; tr.track = tr.__track; tr.trackPart = tr.__trackPart; delete tr.paintedParts; delete tr.canGrid; delete tr.canTrack; });
  // Cancel: a running job shows the status bar's task with its x; it cancels; Esc is the key
  await ev(() => { window.__cancel = 0; const tr = TR; tr.__cancel = tr.cancel.bind(tr); tr.cancel = () => { window.__cancel++; }; window.__tk = app.task('Tracking', { cancel: () => TR.cancel() }); });
  await wait(300);
  const x = page.locator('.task .x');
  ok((await x.count()) === 1, 'a running job: the status bar shows its task with a x');
  if (await x.count()) { await x.click(); await wait(200); }
  ok((await ev(() => window.__cancel)) === 1, 'the status bar x cancels the job');
  ok(await ev(() => app.commands.keysFor('track.cancel').includes('Escape')), 'Esc is still track.cancel');
  await ev(() => { window.__tk?.done?.(); window.__tk?.end?.(); TR.cancel = TR.__cancel; });
  // Range: a click on a shot of the Shots strip sets it to the shot (paw-unuy: the Tracker row's shot-number strip is gone, this was
  // its click); Esc (nothing selected) clears it
  await ev(() => { TR.select(''); app.doc.range = null; });
  await wait(300);
  const sp = await ev(() => { const cv = document.querySelector('[data-tl-lane="scenes"] canvas'), r = cv.getBoundingClientRect(), v = window.app.view, sh = Math.max(20, Math.round(r.height * 0.58)); return { x: r.left + ((10000 - v.start) / v.span) * r.width, y: r.top + (sh + 1 + r.height) / 2 }; });   // the Shots strip: under the Actions strip (actions-strip.js stripLayout)
  await page.mouse.click(sp.x, sp.y); await wait(300);
  const r1 = await ev(() => app.doc.range);
  ok(!!r1 && r1.t0 === 0 && r1.t1 === 20000, `a click on the shot in the Shots strip sets the range to the shot: ${JSON.stringify(r1)}`);
  ok(await ev(() => app.commands.keysFor('range.in')[0] === 'I' && app.commands.keysFor('range.out')[0] === 'O' && app.commands.keysFor('edit.escape').includes('Escape')), 'I / O set it, Esc clears it (keys unchanged)');
  // edit.escape is "clear selection, then range": the click on the shot may also have selected it, so a second Esc can be needed
  await ev(() => app.commands.run('edit.escape')); await wait(200);
  if (await ev(() => app.doc.range)) { await ev(() => app.commands.run('edit.escape')); await wait(200); }
  ok((await ev(() => app.doc.range)) === null, 'edit.escape cleared the range (after the selection)');
  await ev(() => TR.select(RID)); await wait(300);
  // Stabilise: the Shot popover's button toggles it
  await page.locator('[data-chip="shot"]').click(); await wait(400);
  const stab = page.locator('.k-popover button', { hasText: /Stabili[sz]e/ });   // American spelling since the copy pass (31c75a5)
  ok((await stab.count()) === 1, 'the Shot popover has Stabilise');
  const s0 = await ev(() => TR.stabilised);
  if (await stab.count()) { await stab.click(); await wait(300); }
  ok((await ev(() => TR.stabilised)) === !s0, `Stabilise toggles the preview (${s0} -> ${!s0})`);
  const fa = await ev(() => window.__notes.filter(([k]) => k === 'chips:firstAction').map(([, d]) => d));
  ok(fa.length === 1 && fa[0].chip === 'shot' && fa[0].ms >= 0 && /Stabili[sz]e/.test(fa[0].c), `popover time-to-first-action logged: ${JSON.stringify(fa)}`);
  await page.keyboard.press('Escape'); await wait(300);
  if (await ev(() => TR.stabilised)) await ev(() => TR.toggleStabilise(false));

  // ---- 4. the fusion pad and a weight at 0 ----
  await page.locator('.tk.k-scroll').evaluate((el) => (el.scrollTop = 0));
  const panel = page.locator('[data-testid="fuse-panel"]');
  ok((await panel.count()) === 1, 'the fusion panel is there');
  const pad = panel.locator('[data-testid="fuse-standing-pad"] .box');
  await pad.scrollIntoViewIfNeeded(); await wait(300);
  const bb = await pad.boundingBox(), h0 = await ev(() => app._history.index);
  ok(!!bb && bb.width >= 100, `the pad is open by default (${bb?.width} px)`);
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down();
  for (let k = 1; k <= 6; k++) { await page.mouse.move(bb.x + bb.width / 2 + k * 6, bb.y + bb.height / 2 - k * 5); await wait(40); }
  await page.mouse.up(); await wait(400);
  const padV = await ev(() => (app.doc.scenes[0].derives?.[RID] ?? app.doc.scenes[0].derive)?.fuse?.pad || null);
  ok(!!padV && padV.x > 0 && padV.y > 0 && (await ev(() => app._history.index)) - h0 === 1, `a pad drag writes the pad, one undo step: ${JSON.stringify(padV)}`);
  const rel = panel.locator('[data-testid="fuse-rel"] .wt').first();
  await rel.scrollIntoViewIfNeeded();
  const rb = await rel.boundingBox();
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2); await page.mouse.down();
  for (let k = 1; k <= 12; k++) { await page.mouse.move(rb.x + rb.width / 2 - k * 30, rb.y + rb.height / 2); await wait(30); }
  await page.mouse.up(); await wait(500);
  const rows = await panel.locator('[data-testid="fuse-rel"]').allInnerTexts();
  ok((await panel.count()) === 1 && rows.some((t) => /×0/.test(t) && /out/.test(t)), `a weight dragged to 0: the panel stays, that row reads "×0 out": ${rows.map((t) => t.replace(/\s+/g, ' ')).join(' | ')}`);
  const ctl = await ev(() => window.__notes.filter(([k]) => k === 'ui:ctl').map(([, d]) => `${d.s}:${d.c}`));
  ok(ctl.some((c) => /^panel\.fusion:Fusion pad/.test(c)) && ctl.some((c) => /^panel\.fusion:Weight/.test(c)) && ctl.some((c) => /^chips:/.test(c)), `ui:ctl names control and surface: ${[...new Set(ctl)].slice(0, 12).join(', ')}`);
  await runCtl(page);   // paw-k8pe: the run's row is the lane toolbar's on the Track tab (its tail in a … popover)
  const carrier = await ev(async () => { const b = [...document.querySelectorAll('.pick button.chip')].find((x) => x.textContent.trim() === 'auto'); b?.click(); await new Promise((r) => setTimeout(r, 300)); return window.__notes.filter(([k]) => k === 'tracking:carrier').map(([, d]) => d); });
  ok(carrier.length >= 1, `a baseline edit is logged: ${JSON.stringify(carrier)}`);
  const win = await ev(() => app.usage.log.some((e) => e.kind === 'ui:window'));
  ok(win, 'the window size is logged (ui:window)');
} catch (e) {
  if (e !== 'count only') { fails++; console.log('FAIL', e?.stack || e); }
} finally {
  await resize(1600, 1000).catch(() => {});   // the instance's own size again, for the next check
  await browser.close().catch(() => {});
}
if (!COUNT_ONLY) console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
