// dev/band-select-check.mjs -- paw-iphl / paw-6bkv / paw-5nsv in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it
// prints), real mouse and keys over CDP, on a generated clip cut into three shots. Asserted:
//   1. Track tab: a click in the upper part of the shot band (the positioning lane, not the number row) selects that shot;
//      then Tab opens Groups (Tab again closes it; G never does);
//   2. a page text selection (made by script) is dropped by a press on the timeline, and a drag on a timeline row then runs to its
//      release (no pointercancel);
//   3. a row's hide chip takes no press while it is not drawn: a press where it sits with the pointer outside the row first.
//   node dev/band-select-check.mjs <clip.mp4>        exits 1 on any FAIL
import { connectTestApp } from './cdp-connect.mjs';

const [clip] = process.argv.slice(2);
if (!clip) { console.error('usage: node dev/band-select-check.mjs <clip.mp4>'); process.exit(2); }
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
const box = (sel) => ev((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
const tl = () => 'window.__pawDev.tl';   // the shown tab's timeline state

try {
  await page.waitForFunction(() => window.app && app.player, null, { timeout: 60000 });
  await ev(() => { if (app.dialog) app.dialog.resolve(null); app.history?.markSaved?.(); });
  const p = ev((c) => app.project.openVideo(c, { force: true }), clip);
  for (let k = 0; k < 8; k++) { await wait(400); await ev(() => { const d = app.dialog; if (d) d.resolve(/Save changes/.test(d.title || '') ? 'discard' : d.choices?.[0]?.id ?? null); }); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.player.ready && app.player.vw > 0, null, { timeout: 60000 });
  await ev(() => {
    app.project.stopAutosave?.(); app.player.pause();
    const D = app.durationMs, c = [0, Math.round(D / 3), Math.round((2 * D) / 3), D];
    app.transact('shots', () => { app.doc.scenes = [0, 1, 2].map((k) => ({ start_ms: c[k], end_ms: c[k + 1], tags: ['anal', 'penetration'] })); });
    app.setView?.({ start: 0, span: D }); app.setMode('track');
  });
  await wait(1200);
  const tlx = tl();
  // 1. a click high on the shot band selects the shot; Tab opens Groups
  const band = await box('[data-tl-lane="scenes"]');
  ok(!!band, `the shot band is there (${JSON.stringify(band)})`);
  if (band) {
    const D = await ev(() => app.durationMs), x = band.x + band.w * (0.5 / 1) * 0.5;   // the middle of shot 2 (1/3..2/3 of the view)
    const xs = band.x + 60 + ((band.w - 60) * 0.5);
    await page.mouse.click(xs, band.y + band.h * 0.3); await wait(400);
    const sel = await ev(`[...(${tlx}).shots]`), range = await ev(() => app.doc.range);
    ok(sel.length === 1, `a click high on the band selected a shot (${JSON.stringify(sel)}, range ${JSON.stringify(range)}, x ${Math.round(xs)} of ${D} ms view)`);
    await page.keyboard.press('g'); await wait(500);
    ok(!(await ev(() => !!window.__pawDev.groupsFor(app).on)), 'G after the band click: Groups stays closed (G is move)');
    await page.keyboard.press('Tab'); await wait(800);
    const on = await ev(() => !!window.__pawDev.groupsFor(app).on);
    ok(on, 'Tab after the band click: Groups open');
    if (on) { await page.keyboard.press('Tab'); await wait(500); ok(!(await ev(() => !!window.__pawDev.groupsFor(app).on)), 'Tab again: Groups closed'); }
    void x;
  }
  // 2. a text selection on the page, then a drag on the shot band
  await ev(() => { const sb = document.querySelector('footer, .statusbar, [data-testid="status-bar"]') || document.body; const r = document.createRange(); r.selectNodeContents(sb); getSelection().removeAllRanges(); getSelection().addRange(r); });
  const had = await ev(() => getSelection().type);
  if (band) {
    // the drag must not end in the browser's pointercancel (a native drag of the selected text, paw-6bkv)
    await ev(() => { window.__bsc = { cancel: 0, moves: 0 }; window.addEventListener('pointercancel', () => window.__bsc.cancel++, true); window.addEventListener('pointermove', (e) => { if (e.buttons) window.__bsc.moves++; }, true); });
    const y = band.y + band.h * 0.3;
    await page.mouse.move(band.x + 120, y); await page.mouse.down();
    await page.mouse.move(band.x + band.w * 0.6, y, { steps: 12 }); await page.mouse.up(); await wait(400);
    const got = await ev(() => window.__bsc), left = await ev(() => getSelection().type);
    ok(had === 'Range' && left !== 'Range' && got.cancel === 0 && got.moves >= 10, `with a page text selection (${had}) a drag on the band runs to its release: ${got.moves} moves, ${got.cancel} pointercancel, the selection dropped (${left})`);
    await page.keyboard.press('Control+z'); await wait(300);   // the drag moved an action region: back
  }
  // 3. the hide chip: not hittable while not drawn
  const chip = await ev(() => { const b = document.querySelector('.row .fold'); if (!b) return null; const r = b.getBoundingClientRect(), cs = getComputedStyle(b); return { x: r.x + r.width / 2, y: r.y + r.height / 2, pe: cs.pointerEvents, op: cs.opacity }; });
  if (!chip) ok(false, 'a row hide chip is there');
  else {
    await page.mouse.move(5, 5); await wait(300);
    const hidden = await ev(([x, y]) => { const e = document.elementFromPoint(x, y); return { fold: !!e?.closest?.('.fold'), op: getComputedStyle(document.querySelector('.row .fold')).opacity }; }, [chip.x, chip.y]);
    ok(!hidden.fold, `the hide chip, not drawn (opacity ${hidden.op}), is not what a press there hits`);
    await page.mouse.move(chip.x, chip.y); await wait(300);
    const shown = await ev(([x, y]) => { const e = document.elementFromPoint(x, y); return { fold: !!e?.closest?.('.fold'), op: getComputedStyle(e?.closest?.('.fold') || document.body).opacity }; }, [chip.x, chip.y]);
    ok(shown.fold && shown.op === '1', `the pointer on its row: drawn (opacity ${shown.op}) and hittable (${shown.fold})`);
  }
} finally {
  await ev(() => app.project.close?.({ force: true })).catch(() => {});
  await browser.close();
}
console.log(fails ? `${fails} FAIL` : 'all ok');
process.exit(fails ? 1 : 0);
