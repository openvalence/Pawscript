// dev/areas-check.mjs -- the Blender-style areas (paw-1ad) in YOUR test instance (node dev/test-app.mjs start ...,
// then the CDP_* env it prints): the default frame, dock a tab by dragging it onto an edge, Esc cancels, split from a
// corner, the panel picker, join from a corner, the border menu's Swap, maximise, persistence across a reload,
// Reset. Asserts on painted boxes; the <video> element and an open panel must stay the same nodes throughout.
//   node dev/areas-check.mjs <video path> [out.png]
import { connectTestApp } from './cdp-connect.mjs';

const { browser, page: p } = await connectTestApp();
let fails = 0, errors = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
p.on('console', (m) => { if (m.type() === 'error') { errors++; console.log('[console]', m.text()); } });
p.on('pageerror', (e) => { errors++; console.log('[pageerror]', e.message); });
const ev = (f, a) => p.evaluate(f, a);
const wait = (ms) => p.waitForTimeout(ms);
const rect = (sel) => ev((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return r.width || r.height ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null; }, sel);
const slots = () => ev(() => [...document.querySelectorAll('.areas > [data-area]')].filter((e) => e.getBoundingClientRect().width).map((e) => e.dataset.area));
const tabRect = (label) => ev((l) => { const t = [...document.querySelectorAll('.areas [role=tab]')].find((x) => x.textContent.trim() === l); if (!t) return null; const r = t.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, label);
const areaOf = (label) => ev((l) => [...document.querySelectorAll('.areas > [data-area]')].find((e) => [...e.querySelectorAll('[role=tab]')].some((t) => t.textContent.trim() === l))?.dataset.area, label);
async function drag(from, to, { steps = 12, mid } = {}) {
  await p.mouse.move(from.x, from.y); await p.mouse.down();
  for (let i = 1; i <= steps; i++) await p.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps);
  if (mid) await mid();
  await p.mouse.up(); await wait(250);
}
const sameNodes = () => ev(() => document.querySelector('[data-area=video] video') === window.__vid && window.__reloads === 0);

try {
  await p.waitForFunction(() => window.app?.project, null, { timeout: 30000 });
  await ev(() => { app.layout.reset(); app.setMode('track'); });
  await ev((v) => app.project.openVideo(v), process.argv[2]);
  await p.waitForFunction(() => document.querySelector('[data-area=video] video')?.readyState >= 1, null, { timeout: 20000 });
  await wait(500);
  await ev(() => { window.__vid = document.querySelector('[data-area=video] video'); window.__reloads = 0; window.__vid.addEventListener('loadstart', () => window.__reloads++); });

  // the default frame (Track): [left | video | right] over the timeline, the bottom dock folded under both
  const A = await rect('.areas'), Lf = await rect('[data-area=left]'), V = await rect('[data-area=video]'), R = await rect('[data-area=right]'), T = await rect('[data-area=timeline]'), B = await rect('[data-area=bottom]');
  ok(Lf && Lf.w === 300 && V.x === Lf.x + 301 && R.w === 330 && R.x + R.w === A.x + A.w, `default row: left 300 | video | right 330 (${JSON.stringify([Lf, V, R])})`);
  // 014f5cd (paw-idb5): the folded bottom tray draws no rail (the status bar is the bottom edge): the timeline reaches the foot
  ok(T.w === A.w && T.y === V.y + V.h + 1 && !B && T.y + T.h === A.y + A.h, `timeline under, reaching the foot; the folded tray undrawn (${JSON.stringify([T, B])})`);
  await ev(() => app.setMode('refine')); await wait(200);
  ok(!(await slots()).includes('left') && (await rect('[data-area=video]')).x === A.x, 'Refine: no left panels, so no left area (as before)');
  await ev(() => app.setMode('track')); await wait(200);
  ok(await sameNodes(), 'mode switches: same <video>, no reload');
  await ev(() => { window.__insp = document.querySelector('[data-panel="timeline.inspector"]')?.firstElementChild; });

  // drag the Points tab onto the left edge of the video: preview = the video's left half; drop = a new area there
  const ch = await tabRect('Points');
  let preview = null;
  await drag(ch, { x: V.x + 30, y: V.y + V.h / 2 }, { mid: async () => { preview = await rect('.preview'); } });
  ok(preview && Math.abs(preview.x - V.x) <= 1 && Math.abs(preview.w - V.w / 2) <= 2, `drop preview: the video's left half (${JSON.stringify(preview)})`);
  const chA = await areaOf('Points'), C1 = chA && await rect(`[data-area="${chA}"]`), V1 = await rect('[data-area=video]');
  ok(chA && !['left', 'right', 'bottom'].includes(chA) && Math.abs(C1.x - V.x) <= 1 && V1.x > C1.x + C1.w - 1, `Points in a new area left of the video (${JSON.stringify([C1, V1])})`);
  ok(await sameNodes(), 'docking elsewhere: same <video>, no reload');
  ok(await ev(() => document.querySelector('[data-panel="timeline.inspector"]')?.firstElementChild === window.__insp), 'the Inspector panel was not remounted');

  // Esc cancels mid-drag
  const before = await ev(() => JSON.stringify(app.layout.tree));
  const hi = await tabRect('History');
  await drag(hi, { x: V1.x + V1.w / 2, y: V1.y + 20 }, { mid: async () => { await p.keyboard.press('Escape'); } });
  ok(await ev((b) => JSON.stringify(app.layout.tree) === b, before) && !(await rect('.preview')), 'Esc cancels a drag: nothing moved, no preview left');

  // split from the right area's bottom-left corner, dragging up: a new empty area below it with the panel picker
  const R2 = await rect('[data-area=right]');
  await drag({ x: R2.x + 3, y: R2.y + R2.h - 3 }, { x: R2.x + 6, y: R2.y + R2.h * 0.6 });
  const fresh = await ev(() => [...document.querySelectorAll('.areas > [data-area]')].find((e) => e.textContent.includes('Choose a panel'))?.dataset.area);
  const F = fresh && await rect(`[data-area="${fresh}"]`), R3 = await rect('[data-area=right]');
  ok(F && Math.abs(F.x - R2.x) <= 1 && Math.abs(F.y + F.h - (R2.y + R2.h)) <= 1 && Math.abs(F.h - R2.h * 0.4) < 12 && R3.h < R2.h, `corner split: new area under the right one (${JSON.stringify([F, R3])})`);
  ok(await ev(() => document.querySelector('[data-panel="timeline.inspector"]')?.firstElementChild === window.__insp), 'splitting its own area did not remount the Inspector');
  // the picker: show History there
  await p.locator(`[data-area="${fresh}"] button[aria-label="Panel shown in this area"]`).click(); await wait(150);
  await p.getByRole('menuitemradio', { name: 'History' }).click(); await wait(250);
  ok((await areaOf('History')) === fresh, 'the panel picker moved History into the new area');

  // join: from the new area's top-left corner drag up past its top edge onto the right area: they merge
  const F2 = await rect(`[data-area="${fresh}"]`);
  await drag({ x: F2.x + 3, y: F2.y + 3 }, { x: F2.x + 20, y: F2.y - 60 });
  const F3 = await rect(`[data-area="${fresh}"]`);
  ok(!(await slots()).includes('right') && F3 && Math.abs(F3.y - R2.y) <= 1 && (await areaOf('Inspector')) === fresh && (await areaOf('History')) === fresh, `corner join: the new area took over the right one, tabs merged (${JSON.stringify(F3)})`);

  // border menu: right-click the border between the Points area and the video -> Swap areas
  const C2 = await rect(`[data-area="${chA}"]`);
  await p.mouse.click(C2.x + C2.w, C2.y + C2.h / 2, { button: 'right' }); await wait(200);
  await p.getByRole('menuitem', { name: 'Swap areas' }).click(); await wait(250);
  const C3 = await rect(`[data-area="${chA}"]`), V3 = await rect('[data-area=video]');
  ok(C3.x > V3.x, `Swap areas: the video now left of Points (${JSON.stringify([V3, C3])})`);
  ok(await sameNodes(), 'swap: same <video>, no reload');

  // resize: drag that border
  const W0 = (await rect(`[data-area="${chA}"]`)).w;
  await drag({ x: C3.x - 1, y: C3.y + C3.h / 2 }, { x: C3.x - 81, y: C3.y + C3.h / 2 }, { steps: 6 });
  const W1 = (await rect(`[data-area="${chA}"]`)).w;
  ok(Math.abs(W1 - W0 - 80) <= 2, `border drag resizes (${W0} -> ${W1})`);

  // maximise: pointer over the timeline, Ctrl+Alt+Space; again restores
  const T2 = await rect('[data-area=timeline]');
  await p.mouse.move(T2.x + T2.w / 2, T2.y + T2.h / 2);
  await p.keyboard.press('Control+Alt+Space'); await wait(250);
  const TM = await rect('[data-area=timeline]');
  ok(TM && TM.w === A.w && TM.h === A.h && !(await rect('[data-area=video]')), `maximised: the timeline fills the body, the video is undrawn (${JSON.stringify(TM)})`);
  await p.keyboard.press('Control+Alt+Space'); await wait(250);
  ok(JSON.stringify(await rect('[data-area=timeline]')) === JSON.stringify(T2), 'again: restored');
  ok(await sameNodes(), 'maximise / restore: same <video>, no reload');

  // persistence: reload the page, the arrangement comes back
  const keep = await ev((id) => { const q = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }; return { ch: q(`[data-area="${id}"]`), v: q('[data-area=video]') }; }, chA);
  if (process.argv[3]) await p.screenshot({ path: process.argv[3] });
  await p.reload();
  await p.waitForFunction(() => window.app?.project, null, { timeout: 30000 });
  await ev(() => app.setMode('track'));
  await ev((v) => app.project.openVideo(v, { force: true }), process.argv[2]);
  await p.waitForFunction(() => document.querySelector('[data-area=video] video')?.readyState >= 1, null, { timeout: 20000 });
  await wait(400);
  const back = await ev((id) => { const q = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }; return { ch: q(`[data-area="${id}"]`), v: q('[data-area=video]') }; }, chA);
  ok(JSON.stringify(back) === JSON.stringify(keep), `after a reload: same boxes (${JSON.stringify(keep)} / ${JSON.stringify(back)})`);

  // Ctrl+B still folds the left dock; Reset layout brings the default back
  await p.mouse.move(A.x + A.w / 2, A.y + 40);
  await p.keyboard.press('Control+b'); await wait(200);
  ok((await rect('[data-area=left]'))?.w === 24, 'Ctrl+B folds the left area to its rail');
  await ev(() => app.commands.run('layout.reset')); await wait(250);
  const R4 = await rect('[data-area=right]'), V4 = await rect('[data-area=video]');
  ok(R4?.w === 330 && V4.x === A.x + 301 && (await areaOf('Points')) === 'right', 'Reset layout: the default frame again');
  ok(errors === 0, `no console errors (${errors})`);
} finally {
  await browser.close();
}
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
