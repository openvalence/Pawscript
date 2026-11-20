// dev/modal-keys-check.mjs -- paw-pj8l / paw-5z78 / paw-zbyd in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it
// prints), real key presses over CDP. Asserted:
//   1. a confirm dialog open (focus on its button): Ctrl+Tab and Ctrl+Shift+Space run nothing behind it (no command, the tab stays);
//      Space presses the dialog's focused button (the dialog closes) and does not play; Shift+Esc still runs the panic stop;
//      focus lost to the page with the dialog open: Space does not play;
//   2. a modifier curve (FxEditor in Refine): a handle clicked, ArrowUp nudges its value (no frame step); Escape drops it, then
//      ArrowRight steps a frame;
//   3. the Tools panel: ArrowDown on a row moves focus to the next row and nudges no point.
//   node dev/modal-keys-check.mjs <clip.mp4>        exits 1 on any FAIL
import { connectTestApp } from './cdp-connect.mjs';

const [clip] = process.argv.slice(2);
if (!clip) { console.error('usage: node dev/modal-keys-check.mjs <clip.mp4>'); process.exit(2); }
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
const settled = () => page.waitForFunction(() => !app.player.seeking && !app.player.scrubbing, null, { timeout: 10000 });
// the commands keys ran (the registry's onRun notes each in the usage log), and the toasts
const ran = () => ev(() => window.__mkc.ran.splice(0));
const confirm = async () => {
  await ev(() => { window.__mkc.answer = app.choose({ title: 'Check', message: 'A confirm for the key check', choices: [{ id: 'no', label: 'Cancel' }, { id: 'ok', label: 'OK', kind: 'primary' }] }); });
  await page.waitForSelector('dialog[open]', { timeout: 5000 }); await wait(250);
};

try {
  await page.waitForFunction(() => window.app && app.player, null, { timeout: 60000 });
  await ev(() => { if (app.dialog) app.dialog.resolve(null); app.history?.markSaved?.(); });
  const p = ev((c) => app.project.openVideo(c, { force: true }), clip);
  for (let k = 0; k < 8; k++) { await wait(400); await ev(() => { const d = app.dialog; if (d) d.resolve(/Save changes/.test(d.title || '') ? 'discard' : d.choices?.[0]?.id ?? null); }); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.player.ready && app.player.vw > 0, null, { timeout: 60000 });
  await ev(() => {
    app.project.stopAutosave?.(); app.player.pause(); app.player.seekFrame(30);
    window.__mkc = { ran: [], toasts: [] };
    const note = app.usage.note.bind(app.usage);
    app.usage.note = (k, d, o) => { if (/^[a-z]+\.[\w.]+$/.test(k)) window.__mkc.ran.push(k); return note(k, d, o); };
    const toast = app.toast.bind(app);
    app.toast = (m, ...r) => { window.__mkc.toasts.push(String(m)); return toast(m, ...r); };
  });
  await settled(); await wait(300);

  // 1. a confirm dialog
  const tab0 = await ev(() => app.tabs.active);
  await confirm(); await ran();
  for (const [keys, what] of [['Control+Tab', 'Ctrl+Tab'], ['Control+Shift+Space', 'Ctrl+Shift+Space']]) {
    await page.keyboard.press(keys); await wait(400);
    const r = await ran(), s = await ev(() => ({ open: !!document.querySelector('dialog[open]'), playing: app.player.playing, tab: app.tabs.active }));
    ok(r.length === 0 && s.open && !s.playing && s.tab === tab0, `${what} with a confirm open: nothing ran behind it (${JSON.stringify({ ran: r, ...s })})`);
  }
  await page.keyboard.press('Shift+Escape'); await wait(400);
  const pr = await ran(), toasts = await ev(() => window.__mkc.toasts.splice(0));
  ok(pr.filter((x) => x === 'playback.panic').length === 1 && toasts.some((t) => /Device stopped/.test(t)), `Shift+Esc with a confirm open: the panic stop ran (${JSON.stringify({ ran: pr, toasts })})`);
  if (!(await ev(() => !!document.querySelector('dialog[open]')))) await confirm();
  await ev(() => document.querySelector('dialog[open] .kit-dialog-foot button:last-of-type')?.focus());
  const focused = await ev(() => document.activeElement?.textContent?.trim() || document.activeElement?.tagName);
  await page.keyboard.press('Space'); await wait(500);
  const sp = await ev(async () => ({ open: !!document.querySelector('dialog[open]'), playing: app.player.playing, answer: await Promise.race([window.__mkc.answer, new Promise((r) => setTimeout(() => r('pending'), 300))]) }));
  ok(!sp.playing && !sp.open && sp.answer === 'ok', `Space on the dialog's focused button (${focused}): it pressed the button (answer ${sp.answer}), no play (${sp.playing})`);
  await confirm();
  await page.evaluate(() => document.activeElement?.blur()); await wait(150);
  const act = await ev(() => document.activeElement?.tagName);
  await page.keyboard.press('Space'); await wait(500);
  const s2 = await ev(() => ({ open: !!document.querySelector('dialog[open]'), playing: app.player.playing }));
  ok(!s2.playing && s2.open, `focus lost to the page (${act}) with a confirm open: Space plays nothing (${JSON.stringify(s2)})`);
  await page.keyboard.press('Escape'); await wait(300);
  ok(!(await ev(() => !!document.querySelector('dialog[open]'))), 'Escape still cancels the dialog with focus on the page');
  await ev(() => app.player.pause()); await settled();

  // 2. a modifier curve's handle: the editor selection
  await ev(() => {
    app.setMode('refine');
    app.transact('check', () => { app.doc.fx = [{ id: 'mkc1', kind: 'throb', t0: 2000, t1: 6000 }]; });
    const tl = window.__pawDev.tlFor ? window.__pawDev.tlFor(app) : window.__pawDev.tl;
    tl.fx = 'mkc1'; tl.fxSel = ['mkc1']; tl.fxPop = 'mkc1';
  });
  await wait(800);
  const h = (await page.$$('.k-curve .h')).at(-1);   // the last one: on top where handles overlap
  ok(!!h, 'the modifier curve shows its handles');
  if (h) {
    const v0 = await h.getAttribute('aria-valuenow'), f0 = await ev(() => app.player.frame);
    await h.click(); await wait(200);
    await page.keyboard.press('ArrowUp'); await wait(400);
    const v1 = await h.getAttribute('aria-valuenow'), f1 = await ev(() => app.player.frame);
    ok(v1 !== v0 && f1 === f0, `ArrowUp on a clicked curve handle nudged it (${v0} -> ${v1}), no frame step (${f0} -> ${f1})`);
    // Escape: the curve popover closes (focus back on the Modifiers row, the modifier still selected: an editor selection too);
    // Escape again drops that; then the arrows step frames
    await page.keyboard.press('Escape'); await wait(300);
    await page.keyboard.press('Escape'); await wait(300);
    await page.keyboard.press('ArrowRight'); await wait(400); await settled();
    const f2 = await ev(() => app.player.frame), v2 = await h.getAttribute('aria-valuenow');
    ok(f2 === f1 + 1 && v2 === v1, `after Escape (twice), ArrowRight steps a frame (${f1} -> ${f2}) and leaves the handle (${v1} -> ${v2})`);
  }
  await ev(() => { const tl = window.__pawDev.tlFor ? window.__pawDev.tlFor(app) : window.__pawDev.tl; tl.fxPop = null; tl.fx = null; tl.fxSel = []; });
  await page.keyboard.press('Escape'); await wait(200);

  // 3. the Tools panel: ArrowDown walks its rows
  await ev(() => app.showPanel?.('inspector.tools'));
  await wait(600);
  const rows = await page.$$('[data-testid^="tool-row-"]');
  if (rows.length < 2) ok(false, `the Tools panel shows its rows (${rows.length}; showPanel: ${await ev(() => typeof app.showPanel)})`);
  else {
    await ev(() => { app.transact('check', () => { app.doc.axes = { ...app.doc.axes, stroke: [{ at: 1000, pos: 20 }, { at: 1500, pos: 80 }] }; }); app.select?.([1000, 1500]); });
    const before = await ev(() => JSON.stringify(app.doc.axes.stroke));
    await rows[0].focus(); await wait(100);
    const id0 = await ev(() => document.activeElement?.dataset?.testid);
    await page.keyboard.press('ArrowDown'); await wait(300);
    const id1 = await ev(() => document.activeElement?.dataset?.testid), after = await ev(() => JSON.stringify(app.doc.axes.stroke));
    ok(id1 && id1 !== id0 && after === before, `ArrowDown on a Tools row: focus ${id0} -> ${id1}, the points unchanged (${after === before})`);
  }
} finally {
  await ev(() => app.project.close?.({ force: true })).catch(() => {});
  await browser.close();
}
console.log(fails ? `${fails} FAIL` : 'all ok');
process.exit(fails ? 1 : 0);
