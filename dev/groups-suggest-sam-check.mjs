// dev/groups-suggest-sam-check.mjs -- paw-om3e: a Suggest proposal that SAM drew keeps SAM's state through Accept, so Alt + Up / Alt + wheel loosen it by
// re-asking SAM (the dial starts from Suggest's own prompts, not from a hand-painted group's inside points), in YOUR test instance (CDP_* env; the fake
// sidecar answers suggest_groups with a `sam` state on c1_head and `segment` with discs round a mask prompt). On a GENERATED picture folder.
//   node dev/groups-suggest-sam-check.mjs <folder with generated pictures> <out dir>
import { connectTestApp } from './cdp-connect.mjs';
import { mkdirSync } from 'node:fs';
const [folder, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms = 300) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const px = () => ev(() => { const G = app.labelling.G, k = G.groups.findIndex((g) => g.name === 'c1_head'), a = G.maskFor(G.groups[k]).a; let n = 0; for (let i = 0; i < a.length; i++) if (a[i] >= 0.5) n++; return n; });
try {
  await page.waitForFunction(() => window.app?.commands, null, { timeout: 60000 });
  await ev((f) => app.commands.run('labelling.open', { folder: f }), folder);
  await page.waitForFunction(() => app.labelling?.on && app.labelling.ready, null, { timeout: 30000 });
  await ev(async () => { const d = await app.labelling.labelsDir(); for (const e of await app.backend.listDir(d).catch(() => [])) await app.backend.remove(e.path); await app.labelling.leave(); });
  await ev((f) => app.commands.run('labelling.open', { folder: f }), folder);
  await page.waitForFunction(() => app.labelling?.on && app.labelling.ready, null, { timeout: 30000 });
  await page.getByTestId('groups-tools').getByRole('button', { name: 'Suggest', exact: true }).click();
  await page.waitForFunction(() => app.labelling.suggestionCount > 0, null, { timeout: 20000 });
  const sam = await ev(() => { const g = app.labelling.G.groups.find((x) => x.name === 'c1_head'); return g ? { mask_from: g.mask_from, pos: g.sam?.pos, has: !!g.sam?.mask, fp: !!g.sam?.fp } : null; });
  ok(sam?.mask_from === 'sam' && sam.has && sam.fp && sam.pos?.length === 1, `the suggestion carries its SAM state: ${JSON.stringify(sam)}`);
  await page.screenshot({ path: out + '/sam-1-suggested.png' });
  await ev(() => app.labelling.G.accept());   // Accept all (the store's own call: every suggestion of the picture)
  await wait(600);
  const acc = await ev(() => { const g = app.labelling.G.groups.find((x) => x.name === 'c1_head'); return g ? { source: g.source, sam: !!g.sam } : null; });
  ok(acc?.source === 'user' && acc.sam, `after Accept all it is a painted group that still carries SAM's state: ${JSON.stringify(acc)}`);
  const n0 = await px();
  const at = await ev(() => { const r = document.querySelector('[data-testid="label-stage"]').getBoundingClientRect(), b = app.labelling.player.bmp; const s = Math.min(r.width / b.width, r.height / b.height), ox = r.x + (r.width - b.width * s) / 2, oy = r.y + (r.height - b.height * s) / 2; return [ox + 0.7 * b.width * s, oy + 0.25 * b.height * s]; });
  await page.mouse.move(...at); await wait(150);
  await page.keyboard.press('Alt+ArrowUp'); await wait(150);
  await page.waitForFunction(() => app.labelling.G.dial && !app.labelling.G.dial.busy, null, { timeout: 10000 });
  const dial = await ev(() => { const D = app.labelling.G.dial, m = app.labelling.G.size; return { pos0: D.pos0.map(([x, y]) => [+(x / m.w).toFixed(3), +(y / m.h).toFixed(3)]), label: D.label }; });
  ok(dial.pos0.length === 1 && Math.abs(dial.pos0[0][0] - 0.7) < 0.01 && Math.abs(dial.pos0[0][1] - 0.25) < 0.01, `the dial starts from Suggest's own positive (a hand-painted group has none): ${JSON.stringify(dial)}`);
  ok(/looser/.test(dial.label) && !/\(/.test(dial.label), `SAM was asked again: '${dial.label}'`);
  await page.screenshot({ path: out + '/sam-2-looser-readout.png' });
  await wait(900); await ev(() => app.labelling.G.commitDial?.()); await wait(300);
  const n1 = await px();
  ok(n1 > n0, `Alt + Up loosened it: ${n0} -> ${n1} px`);
  await page.screenshot({ path: out + '/sam-3-after.png' });
  await ev(() => app.labelling.leave());
  ok(!errs.length, `no console errors (${errs.slice(0, 2).join(' | ')})`);
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
