// dev/circle-look.mjs -- paw-714j: "circle to fill" and "Train the seeder" in YOUR test instance (node dev/test-app.mjs start ...,
// the CDP_* env it prints) on GENERATED shapes (the folder dev/label-look.mjs uses: shape01 = a red square, a green disc, a bar).
// Turns Circle on (W), loops 70 % of the red square (a rough, slightly open loop), screenshots the loop in progress and after,
// checks the outline lies just inside the square's edge, loops the green disc with a 20 % gap, draws a straight stroke (it must
// stay a brush stroke), then Train the seeder (the fake sidecar answers) and reads the seeder line.
//   node dev/circle-look.mjs <image folder> <out dir>
import { connectTestApp } from './cdp-connect.mjs';
import { mkdirSync } from 'node:fs';

const [folder, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms = 300) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
try {
  await page.waitForFunction(() => window.app?.commands, null, { timeout: 60000 });
  await ev((f) => app.commands.run('labelling.open', { folder: f }), folder);
  await page.waitForFunction(() => app.labelling?.on && app.labelling.ready, null, { timeout: 20000 });
  await ev(() => app.labelling.show(0));
  await page.waitForFunction(() => app.labelling.ready && app.labelling.index === 0, null, { timeout: 10000 });
  await ev(() => { const G = app.labelling.G; while (G.groups.length) G.remove(0); app.settings.set('tracking.groups.circle', false); });
  const rect = () => ev(() => { const r = document.querySelector('[data-testid="label-stage"]').getBoundingClientRect(), b = app.labelling.player.bmp; return { x: r.x, y: r.y, w: r.width, h: r.height, iw: b.width, ih: b.height }; });
  const at = async (fx, fy) => { const r = await rect(), s = Math.min(r.w / r.iw, r.h / r.ih), ox = r.x + (r.w - r.iw * s) / 2, oy = r.y + (r.h - r.ih * s) / 2; return [ox + fx * r.iw * s, oy + fy * r.ih * s]; };
  const stroke = async (pts, shot) => {
    const P = []; for (const q of pts) P.push(await at(...q));
    await page.mouse.move(...P[0]); await page.mouse.down();
    for (let k = 1; k < P.length; k++) { await page.mouse.move(...P[k]); if (shot && k === Math.floor(P.length * 0.8)) { await wait(120); await page.screenshot({ path: out + '/' + shot + '-loop.png' }); } }
    await page.mouse.up(); await wait(400);
  };
  const ring = (cx, cy, rx, ry, a0 = 0, sweep = 2 * Math.PI, n = 36) => Array.from({ length: n + 1 }, (_, k) => [cx + rx * Math.cos(a0 + (sweep * k) / n), cy + ry * Math.sin(a0 + (sweep * k) / n)]);
  // shape01.png is 640 x 480: the red square spans x 0.15..0.45, y 0.2..0.55
  await page.keyboard.press('1');
  await page.keyboard.press('w'); await wait(200);
  ok(await ev(() => app.labelling.G.circle), 'W turns Circle to fill on (the toolbar toggle is pressed)');
  await page.locator('[data-testid="groups-parts"] button', { hasText: /^hips$/ }).click();
  await page.screenshot({ path: out + '/1-before.png' });
  // a rough loop round ~70 % of the red square, a little open (starts at the top left, ends short of it)
  await stroke(ring(0.30, 0.375, 0.105, 0.125, -2.4, 2 * Math.PI * 0.93), 'sq');
  const f1 = await ev(() => ({ ...app.labelling.G.lastFill, poly: app.labelling.G.groups[0].poly, name: app.labelling.G.groups[0].name }));
  ok(f1.name === 'c1_hips' && f1.mode === 'picture', `the loop filled the armed part: ${f1.name}, ${f1.mode}, grew ${f1.grew}, ${f1.ms} ms`);
  const xs = f1.poly.map((q) => q[0]), ys = f1.poly.map((q) => q[1]), im = 640, ih = 480;
  const box = { x0: Math.min(...xs) * im, x1: Math.max(...xs) * im, y0: Math.min(...ys) * ih, y1: Math.max(...ys) * ih };
  const sq = { x0: 0.15 * im, x1: 0.45 * im, y0: 0.2 * ih, y1: 0.55 * ih };
  const inset = [box.x0 - sq.x0, sq.x1 - box.x1, box.y0 - sq.y0, sq.y1 - box.y1];
  ok(inset.every((d) => d > -1 && d < 7), `the outline is the square's edge pulled inside: margins ${inset.map((d) => d.toFixed(1)).join(' / ')} px (left / right / top / bottom of 640 x 480)`);
  await page.screenshot({ path: out + '/2-filled.png' });
  // the green disc (centre .7 .6, r = .15 x 480 px): a loop with a 20 % gap
  await page.locator('[data-testid="groups-parts"] button', { hasText: /^knot$/ }).click();
  await page.keyboard.press('2');
  const dr = (0.15 * 480) / 640;
  await stroke(ring(0.7, 0.6, dr * 0.8, 0.15 * 0.8, 0.5, 2 * Math.PI * 0.8, 40), 'disc');
  const f2 = await ev(() => ({ ...app.labelling.G.lastFill, n: app.labelling.G.groups.length, last: app.labelling.G.groups.at(-1).name }));
  ok(f2.n === 2 && f2.last === 'c2_knot' && f2.mode === 'picture', `a loop with a 20 % gap closes and fills: ${f2.last}, ${f2.mode}, ${f2.ms} ms`);
  // a second loop on the same group: overlapping most of it replaces
  await stroke(ring(0.7, 0.6, dr * 0.7, 0.15 * 0.7), null);
  ok(await ev(() => app.labelling.G.lastFill.replaced === true && app.labelling.G.groups.length === 2), 'a second loop over most of the shape replaces it (still 2 groups)');
  // a straight stroke stays a brush stroke (circle is on)
  const before = await ev(() => app.labelling.G.groups.length);
  await page.keyboard.press('1'); await page.locator('[data-testid="groups-parts"] button', { hasText: /^tail$/ }).click();
  const lf = JSON.stringify(await ev(() => app.labelling.G.lastFill));
  await stroke([[0.55, 0.12], [0.65, 0.12], [0.75, 0.125], [0.85, 0.12]], null);
  ok((await ev(() => app.labelling.G.groups.length)) === before + 1 && JSON.stringify(await ev(() => app.labelling.G.lastFill)) === lf, 'a straight stroke is painted by the brush, not filled');
  await page.keyboard.press('Control+z'); await wait(200);
  ok((await ev(() => app.labelling.G.groups.length)) === before, 'one undo step per fill / stroke');
  await page.screenshot({ path: out + '/3-three.png' });
  // Train the seeder (the fake sidecar answers seed_train)
  await page.locator('[data-testid="label-train"]').click();
  await page.waitForFunction(() => /images/.test(document.querySelector('[data-testid="label-seeder"]')?.textContent || ''), null, { timeout: 20000 });
  const sl = (await page.locator('[data-testid="label-seeder"]').innerText()).replace(/\s+/g, ' ');
  ok(/learned from 31 painted frames · 3 sources \(12 images\); learned head 32/.test(sl), 'Train the seeder: "' + sl + '"');
  await page.screenshot({ path: out + '/4-trained.png' });
  await ev(() => { app.settings.set('tracking.groups.circle', false); return app.labelling.leave(); });
  ok(!errs.length, `no console errors (${errs.slice(0, 3).join(' | ')})`);
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
