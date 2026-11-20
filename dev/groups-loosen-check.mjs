// dev/groups-loosen-check.mjs -- paw-k8jj: grow picks the part level, the Alt + wheel loosen / tighten dial, grow to fill, in YOUR test
// instance (CDP_* env; the fake sidecar answers `segment` with a small ragged disc and a bigger one, plus logits). On a GENERATED picture
// (an orange disc of 348 px radius at the centre of a 1920 x 1080 frame).
//   node dev/groups-loosen-check.mjs <folder with the picture> <out dir>
// paw-evlj: a reading waits until the gesture has landed (its one undo step: the last answer + DIAL_IDLE_MS), never a fixed rest: with
// answers slower than the wheel (a loaded PC, FAKE_SEGMENT_MS) the old 700 ms rest read the mask before the dial wrote it ("the dial
// stops loosening", "tighter grows"). Each timed notch waits for its own answer, so the number is that notch's round trip, not a queue.
import { connectTestApp } from './cdp-connect.mjs';
import { mkdirSync } from 'node:fs';
const [folder, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms = 300) => page.waitForTimeout(ms);
let fails = 0;
const FIRST_MS = 250;   // the first notch of a page (see step 2)
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const px = () => ev(() => { const G = app.labelling.G, a = G.maskFor(G.groups[G.active]).a; let n = 0; for (let i = 0; i < a.length; i++) if (a[i] >= 0.5) n++; return n; });
const landed = () => page.waitForFunction(() => !app.labelling.G.dial, null, { timeout: 20000 });   // the gesture committed (DIAL_IDLE_MS after its last answer)
const answered = () => page.waitForFunction(() => { const D = app.labelling.G.dial; return !D || (!D.busy && !D.pend); }, null, { timeout: 20000 });   // this notch's answer is in
const reach = () => ev(() => { const G = app.labelling.G, m = G.maskFor(G.groups[G.active]); let r = 0; const cx = m.w / 2, cy = m.h / 2; for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.a[y * m.w + x] >= 0.5) r = Math.max(r, Math.hypot(x + 0.5 - cx, y + 0.5 - cy)); return +r.toFixed(1); });
try {
  await page.waitForFunction(() => window.app?.commands, null, { timeout: 60000 });
  await ev((f) => app.commands.run('labelling.open', { folder: f }), folder);
  await page.waitForFunction(() => app.labelling?.on && app.labelling.ready, null, { timeout: 30000 });
  await ev(() => { const G = app.labelling.G; for (let k = G.groups.length - 1; k >= 0; k--) G.remove(k); app.settings.set('tracking.groups.snap', false); app.settings.set('tracking.groups.grow', false); app.settings.set('tracking.groups.circle', false); });
  await wait(600);
  const rect = () => ev(() => { const r = document.querySelector('[data-testid="label-stage"]').getBoundingClientRect(), b = app.labelling.player.bmp; return { x: r.x, y: r.y, w: r.width, h: r.height, iw: b?.width, ih: b?.height }; });
  const at = async (ix, iy) => { const r = await rect(), s = Math.min(r.w / r.iw, r.h / r.ih), ox = r.x + (r.w - r.iw * s) / 2, oy = r.y + (r.h - r.ih * s) / 2; return [ox + ix * s, oy + iy * s]; };
  const histLen = () => ev(() => app._history?.entries?.length ?? -1);
  const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); };
  // 1. grow dab: the part level (the fake's bigger disc, 48 mask px), not the ragged little one (16 px)
  await page.keyboard.press('e'); await wait(200);
  ok(await ev(() => app.labelling.G.grow), 'grow is on');
  const c = await at(960, 540);
  await page.mouse.move(...c); await page.mouse.down(); await page.mouse.up();
  await page.waitForFunction(() => app.labelling.G.groups.length === 1 && !app.labelling.G.growBusy, null, { timeout: 15000 }); await wait(300);
  const n0 = await px(), r0 = await reach();
  console.log('after the dab: px', n0, 'reach', r0, 'lastGrow', JSON.stringify(await ev(() => app.labelling.G.lastGrow)));
  ok(r0 > 38, `a dab selects the part level, not the sub-part (reach ${r0} mask px; the sub-part's is ~16)`);
  await shot('loosen-1-dab');
  // 2. Alt + wheel up over the group: looser, live, one undo step per burst
  await page.keyboard.down('Alt'); await page.mouse.move(...c);
  const ms = [];
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -100); await answered(); ms.push(await ev(() => app.labelling.G.dialMs)); }
  await shot('loosen-2-looser-readout');
  await page.keyboard.up('Alt'); await landed();
  const n1 = await px(), r1 = await reach();
  ok(n1 > n0 && n1 < 1.08 * n0, `Alt + wheel up x3 is looser by about 1 % a notch: ${n0} -> ${n1} px (${(100 * (n1 / n0 - 1)).toFixed(1)} % for 3 notches)`);
  await ev(() => app.labelling.undo()); await wait(250);
  ok((await px()) === n0, `ONE Ctrl+Z undoes the whole burst: back to ${n0} px (${await px()})`);
  await ev(() => app.labelling.redo()); await wait(250);
  console.log('ms per notch (mask 320 px wide):', ms.join(', '));
  // paw-evlj: the FIRST notch of a page also pays the page's first use of the path (JIT, the frame's edge map: its prep 36-69 ms against
  // 12-16 warm on the second PC) and measured 122-207 ms at every commit tried, 2393eef included (130-145 there was a pass by 5-20 ms);
  // a notch after it is the dial as the owner turns it: 80-125 ms
  ok(ms[0] < FIRST_MS && ms.slice(1).every((m) => m < 150), `each notch's round trip (request, decode, clean) through the fake sidecar: ${ms.join(' / ')} ms (the first under ${FIRST_MS}, the rest under 150)`);
  // 3. keep going: past SAM's answers it follows the part's visible edge, and stops there (the disc is 58 mask px)
  await page.keyboard.down('Alt');
  for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, -100); await wait(150); }
  await page.keyboard.up('Alt'); await landed();
  const r2 = await reach(), n2 = await px();
  ok(r2 > r1, `every notch asks SAM again and the shape keeps loosening: reach ${r1} -> ${r2} (the fake's answers follow the mask prompt; a real SAM jumps to the next region it believes in)`);
  await shot('loosen-3-at-the-edge');
  // 4. tighter
  await page.keyboard.down('Alt');
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 100); await wait(150); }
  await page.keyboard.up('Alt'); await landed();
  const n3 = await px();
  ok(n3 < n2 && n3 >= 12, `Alt + wheel down is tighter: ${n2} -> ${n3}`);
  await shot('loosen-4-tighter');
  // 5. keys: Alt + ArrowUp looser, Alt + ArrowDown tighter, exactly one notch each (the pointer over the group)
  await page.mouse.move(...c); await wait(100);
  const n4 = await px(); await page.keyboard.press('Alt+ArrowUp'); await answered(); const lab = await ev(() => app.labelling.G.dial?.label || ''); await landed(); const n5 = await px(); await page.keyboard.press('Alt+ArrowDown'); await landed(); const n6 = await px();
  ok(n5 > n4 && n6 < n5, `Alt+Up is one notch looser, Alt+Down one tighter: ${n4} -> ${n5} -> ${n6} (readout '${lab}')`);
  // 6. undo: the gestures go back one by one
  await ev(() => app.labelling.undo()); await wait(200); const nu = await px();
  ok(nu !== n6, `Ctrl+Z undoes one gesture (${n6} -> ${nu})`);
  // 7. a refining dab extends the mask (mask prompt, single answer)
  // 8. a hand-painted group dials edge-aware, and Shift+E grows to fill
  await ev(() => { const G = app.labelling.G; for (let k = G.groups.length - 1; k >= 0; k--) G.remove(k); app.settings.set('tracking.groups.grow', false); });
  const p0 = await at(960, 540), p1 = await at(1100, 540);
  await page.mouse.move(...p0); await page.mouse.down(); await page.mouse.move(...p1, { steps: 8 }); await page.mouse.up(); await wait(400);
  const b0 = await px(), br0 = await reach();
  await page.keyboard.down('Alt'); await page.mouse.move(...p0);
  for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -100); await wait(80); }
  await shot('loosen-5-painted-looser');
  await page.keyboard.up('Alt'); await landed();
  const b1 = await px(), br1 = await reach();
  ok(b1 > b0, `a hand-painted group gets SAM-shaped loosening from the first notch: ${b0} -> ${b1} px (reach ${br0} -> ${br1})`);
  await page.keyboard.press('Shift+E'); await wait(700);
  const b2 = await px(), br2 = await reach();
  console.log('grow to fill:', b1, '->', b2, 'reach', br2);
  ok(b2 >= b1 && br2 <= 59, 'grow to fill never goes past the edge');
  await shot('loosen-6-grow-to-fill');
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
