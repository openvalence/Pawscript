// dev/snap-look.mjs -- in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints), a video open
// (paw-ef73.14): a press-drag scrub in the Scenes tab (filmstrip, ruler) and the Refine tab (the playhead on the axis
// lane, ruler). Asserts the playhead takes between-frame times during and after the drag, and the frame on screen is the
// one containing it; then that "Cut here" from that playhead lands on that frame's start. Exits 1 on a failure.
import { connectTestApp } from './cdp-connect.mjs';
const { browser: b, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a);
let bad = 0;
const check = (c, msg) => { if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const state = () => ev(() => { const p = app.player, fm = p.frameMs; return { at: p.playheadMs, frame: p.frame, shown: p.frameAt(p.playheadMs), onFrame: Math.abs(p.playheadMs - p.timeOfFrame(p.frameAt(p.playheadMs))) < 0.01, fm }; });
async function scrub(tab, sel, yAt) {
  await ev((m) => { app.setMode(m); app.player.pause(); app.setView({ start: 20000, span: 4000 }); app.player.seek(21000); }, tab);
  await page.waitForTimeout(500);
  const r = await ev(({ sel }) => { const c = [...document.querySelectorAll(sel)].find((k) => k.getClientRects().length); const q = c.getBoundingClientRect(); return { x: q.left, y: q.top, w: q.width, h: q.height }; }, { sel });
  const y = r.y + yAt(r.h), x0 = r.x + ((21000 - 20000) / 4000) * r.w;   // from the playhead (the axis lane's scrub starts on it)
  await page.mouse.move(x0, y); await page.mouse.down();
  const during = [];
  for (let k = 1; k <= 8; k++) { await page.mouse.move(x0 + k * 13.37, y); await page.waitForTimeout(90); during.push(await state()); }
  await page.mouse.up(); await page.waitForTimeout(500);
  const after = await state();
  const between = during.filter((s) => !s.onFrame).length;
  check(between >= 4, `${tab} ${sel}: during the drag ${between} of 8 playhead times between frames (${during.map((s) => s.at.toFixed(1)).join(', ')})`);
  check(!after.onFrame && after.frame === after.shown, `${tab} ${sel}: after it rests at ${after.at.toFixed(2)} ms, the frame on screen ${after.frame} contains it`);
  return after;
}
await scrub('scenes', '[data-tl-lane=filmstrip] canvas', (h) => h / 2);
await scrub('scenes', '[data-tl-lane=ruler] canvas', () => 12);
await scrub('refine', '.lrow canvas.over', (h) => h / 2);
const a = await scrub('refine', '[data-tl-lane=ruler] canvas', () => 12);
// structure from that playhead: a cut on the frame's start (undone after)
const cut = await ev(() => { const before = app.doc.scenes.map((s) => s.start_ms); app.commands.run('timeline.shot.split'); const now = app.doc.scenes.map((s) => s.start_ms).filter((t) => !before.includes(t)); app.undo(); return now; });
check(cut.length === 1 && Math.abs(cut[0] - (await ev(() => app.player.timeOfFrame(app.player.frame)))) < 0.6, `"Cut here" at ${a.at.toFixed(2)} ms put the cut at ${cut[0]} (the frame's start)`);
// a frame step lands on a frame start again
await ev(() => app.commands.run('player.stepFwd'));
await page.waitForTimeout(400);
const st = await state();
check(st.onFrame, `a frame step lands on a frame start (${st.at.toFixed(2)})`);
await ev(() => app.setMode('scenes'));
await b.close();
process.exit(bad ? 1 : 0);
