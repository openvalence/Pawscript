// dev/groups-alt-check.mjs -- paw-h07u in YOUR test instance (CDP_* env), labelling workspace on a generated picture folder.
// The loosen / tighten wheel is Alt + wheel; a lone Alt release makes Windows enter menu mode (the pointer stops reaching the page until a
// click: the ring freezes, the brush still works). CDP input skips the OS, so assert the cause: the Alt keyup is default-prevented while
// the Groups tool is on (and not when it is off), and the ring after the gesture is what a fresh hover gives.
//   node dev/groups-alt-check.mjs <folder with the picture>
import { connectTestApp } from './cdp-connect.mjs';
const [folder] = process.argv.slice(2);
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms = 300) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const altUp = () => ev(() => { const e = new KeyboardEvent('keyup', { key: 'Alt', bubbles: true, cancelable: true }); document.body.dispatchEvent(e); return e.defaultPrevented; });
const ringHash = () => ev(() => { const cv = document.querySelector('canvas.gcursor'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let h = 0; for (let i = 3; i < d.length; i += 4) h = (h * 31 + d[i]) | 0; return h; });
try {
  await page.waitForFunction(() => window.app?.commands, null, { timeout: 60000 });
  await ev((f) => app.commands.run('labelling.open', { folder: f }), folder);
  await page.waitForFunction(() => app.labelling?.on && app.labelling.ready, null, { timeout: 30000 });
  await wait(600);
  const r = await ev(() => { const b = document.querySelector('[data-testid="label-stage"]').getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; });
  await page.mouse.move(...r); await wait(300);
  ok(await ev(() => app.labelling.G.on), 'Groups tool is on');
  ok(await altUp(), 'tool on: the Alt keyup is default-prevented (no Windows menu mode)');
  await page.keyboard.down('Alt'); await page.mouse.wheel(0, -100); await wait(900); await page.keyboard.up('Alt'); await wait(300);
  const after = await ringHash();
  await page.mouse.move(r[0] + 40, r[1]); await wait(150); await page.mouse.move(...r); await wait(300);
  ok(after === await ringHash(), 'ring after an Alt + wheel gesture equals a fresh hover at the same point');
  await ev(() => app.labelling.G.toggle(false)); await wait(200);
  ok(!(await altUp()), 'tool off: Alt is left alone');
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
