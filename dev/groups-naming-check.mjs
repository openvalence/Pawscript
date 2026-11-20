// dev/groups-naming-check.mjs -- paw-wzxu: the background part naming never blocks SAM, in YOUR test instance started with the fake
// sidecar's naming slowed down (FAKE_NAME_MS=2000 node dev/test-app.mjs start ..., then the CDP_* env it prints), on a GENERATED picture.
// Six grow dabs in quick succession (every one must get its SAM answer: no "Grow: busy (name)", no naming call while painting), then a
// dab and an Alt + wheel loosen while a naming call is in flight (they wait for it, never refused: no "SAM is not available"). Prints the
// dab -> SAM mask times.
//   node dev/groups-naming-check.mjs <folder with the picture> <out dir>
import { connectTestApp } from './cdp-connect.mjs';
import { mkdirSync } from 'node:fs';
const [folder, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms = 300) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
try {
  await page.waitForFunction(() => window.app?.commands, null, { timeout: 90000 });
  await ev((f) => app.commands.run('labelling.open', { folder: f }), folder);
  await page.waitForFunction(() => app.labelling?.on && app.labelling.ready, null, { timeout: 30000 });
  await ev(() => {
    const G = app.labelling.G; for (let k = G.groups.length - 1; k >= 0; k--) G.remove(k);
    app.settings.set('tracking.groups.snap', false); app.settings.set('tracking.groups.circle', false); app.settings.set('tracking.groups.grow', true);
    window.__toasts = []; const t0 = app.toast; app.toast = function (m, ...r) { window.__toasts.push(String(m)); return t0.call(this, m, ...r); };
    window.__names = []; window.__nameIn = 0; const orig = app.labelling.nameJob;
    app.labelling.nameJob = async (req) => { window.__names.push(performance.now()); window.__nameIn++; try { return await orig(req); } finally { window.__nameIn--; } };
  });
  await wait(600);
  const rect = () => ev(() => { const r = document.querySelector('[data-testid="label-stage"]').getBoundingClientRect(), b = app.labelling.player.bmp; return { x: r.x, y: r.y, w: r.width, h: r.height, iw: b?.width, ih: b?.height }; });
  const at = async (ix, iy) => { const r = await rect(), s = Math.min(r.w / r.iw, r.h / r.ih), ox = r.x + (r.w - r.iw * s) / 2, oy = r.y + (r.h - r.ih * s) / 2; return [ox + ix * s, oy + iy * s]; };
  const refusals = () => ev(() => window.__toasts.filter((m) => /busy \(name\)|SAM is not available/.test(m)));
  // one grow dab -> {sam: SAM's mask landed, ms: dab -> mask (the grow's own clock: queue wait included), toast}
  const dab = async (ix, iy) => {
    await ev(() => { app.labelling.G.lastGrow = null; window.__t0 = window.__toasts.length; });
    const p = await at(ix, iy);
    await page.mouse.move(...p); await page.mouse.down(); await page.mouse.up();
    await page.waitForFunction(() => !app.labelling.G.growBusy && !app.labelling.G.draft, null, { timeout: 15000 });
    return ev(() => ({ sam: !!app.labelling.G.lastGrow, ms: app.labelling.G.lastGrow?.ms ?? null, toast: window.__toasts.slice(window.__t0).find((m) => /^Grow/.test(m)) || '' }));
  };
  const spots = [[300, 300], [800, 300], [1400, 300], [300, 800], [800, 800], [1400, 800]];
  const res = [];
  for (const [x, y] of spots) { res.push(await dab(x, y)); await wait(450); }   // painting along: a dab about every half second
  console.log('quick dabs:', res.map((r) => (r.sam ? r.ms + ' ms' : 'refused: ' + r.toast)).join(' | '));
  ok(res.every((r) => r.sam), `every one of the 6 dabs got its SAM answer (${res.filter((r) => r.sam).length} / 6)`);
  const during = await ev(() => window.__names.length);
  ok(during <= 1, `naming calls while painting: ${during} (they wait until the strokes stop)`);
  await page.screenshot({ path: out + '/naming-1-dabs.png' });
  // a dab while a naming call is in flight: it waits for it, then SAM answers
  await page.waitForFunction(() => window.__nameIn > 0, null, { timeout: 8000 });
  const busy = await dab(1100, 550);
  console.log('dab with a naming call in flight:', busy.sam ? busy.ms + ' ms' : 'refused: ' + busy.toast);
  ok(busy.sam, 'a dab while naming runs gets its SAM answer');
  // the loosen dial while a naming call is in flight
  await page.waitForFunction(() => window.__nameIn > 0, null, { timeout: 8000 });
  const c = await at(300, 300);
  await page.mouse.move(...c); await page.keyboard.down('Alt');
  const labels = [];
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -100); await wait(150); labels.push(await ev(() => app.labelling.G.dial?.label || '')); }
  await page.waitForFunction(() => !app.labelling.G.dial?.busy, null, { timeout: 15000 });
  labels.push(await ev(() => app.labelling.G.dial?.label || ''));
  await page.keyboard.up('Alt'); await wait(700);
  console.log('dial readouts:', labels.join(' | '), '· last notch', await ev(() => app.labelling.G.dialMs), 'ms');
  ok(labels.at(-1).startsWith('looser +3') && !labels.some((l) => /edges|no more/.test(l)), 'the dial asked SAM for each notch (no edge-following fallback): ' + labels.at(-1));
  await page.waitForFunction(() => window.__nameIn === 0, null, { timeout: 30000 }).catch(() => ok(false, 'the naming calls settle'));
  await wait(1500);
  const r = await refusals(), n = await ev(() => window.__names.length);
  ok(r.length === 0, `no refusal toasts (${r.length}${r.length ? ': ' + r[0] : ''})`);
  console.log('naming calls in all:', n, '· toasts:', JSON.stringify(await ev(() => window.__toasts)));
  ok(n <= 4, `at most a few naming calls for 7 dabs and a dial: ${n}`);
  await page.screenshot({ path: out + '/naming-2-after.png' });
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
