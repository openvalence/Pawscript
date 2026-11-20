// node dev/shaft-check.mjs [port] [shot.png]  -- shaft consumption (paw-azd) on dev/tracking.html?video=1: the Groups
// tool's depth glyph (on by default for a penis in a scene tagged penetration with a where; one undo step), Track sends
// shaft: true, the run's shaft channels drive the Adjust strip's direction line and the overlay gauge ("in N %"), whose
// click opens the depth marks (Fully out here: one undo step on the shot's derive).
import { chromium } from 'playwright';
const port = process.argv[2] || '5200', shot = process.argv[3] || 'shaft-check.png';
const b = await chromium.launch({ channel: 'msedge', headless: true });
const p = await b.newPage({ viewport: { width: 1500, height: 940 } });
let errors = 0, fails = 0;
p.on('console', (m) => { if (m.type() === 'error') { errors++; console.log('[console]', m.text()); } });
p.on('pageerror', (e) => { errors++; console.log('[pageerror]', e.message); });
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const ev = (f, a) => p.evaluate(f, a);
const wait = (ms = 150) => p.waitForTimeout(ms);
await p.goto(`http://localhost:${port}/dev/tracking.html?video=1`);
await wait(1500);
const circ = (cx, cy, r) => Array.from({ length: 12 }, (_, k) => [+(cx + r * Math.cos(k / 2)).toFixed(4), +(cy + r * Math.sin(k / 2) * 1.7).toFixed(4)]);
await ev((polys) => {
  const H = window.H;
  H.app.doc.scenes = [{ start_ms: 0, end_ms: 20000 }, { start_ms: 20000, end_ms: 60027, tags: ['anal', 'penetration'], groups: [
    { name: 'c1_penis', who: 'c1', part: 'penis', poly: polys[0], t_ms: 30000, pinned: true, source: 'user' },
    { name: 'c2_anus', who: 'c2', part: 'anus', poly: polys[1], t_ms: 30000, pinned: true, source: 'user' },
    { name: 'c2_hips', who: 'c2', part: 'hips', poly: polys[2], t_ms: 30000, pinned: true, source: 'user' }] }];
  H.tr.selectTracker('fake.pinned'); H.app.player.seek(30000);
}, [circ(0.4, 0.45, 0.04), circ(0.55, 0.55, 0.03), circ(0.6, 0.5, 0.08)]);
await wait(400);
await p.keyboard.press('Tab'); await wait(400);
await p.click('[data-testid="groups-list-open"]'); await wait(300);   // 6543984 (paw-i5qx): the groups list is a popover on the bar
const chip = (name) => p.locator('[data-testid="groups-list"] .grp', { hasText: name });
const depth = (name) => chip(name).locator('button.shaft');
ok(await depth('Bottom penis').getAttribute('aria-pressed') === 'true', 'a penis in an anal penetration scene: its depth glyph is on by default');
// paw-4c48.19: any painted part offers the SAM depth glyph (button.shaft[data-testid=groups-depth]); only a penis the shaft one
const inside = (name) => chip(name).locator('button.shaft:not([data-testid="groups-depth"])');
ok((await inside('Top anus').count()) === 0 && (await inside('Top hips').count()) === 0, 'only a penis offers the shaft (how much is inside) glyph');
const look = await depth('Bottom penis').evaluate((e) => { const s = getComputedStyle(e); return { op: +s.opacity, w: e.getBoundingClientRect().width, svg: !!e.querySelector('svg'), title: e.getAttribute('title') }; });
ok(look.svg && look.w > 8 && look.op === 1 && !look.title, `painted: drawn (${look.w.toFixed(0)} px), full opacity when on, no native title`);
await depth('Bottom penis').click(); await wait();
ok(await depth('Bottom penis').getAttribute('aria-pressed') === 'false' && await ev(() => window.H.groups.groups.find((g) => g.name === 'c1_penis')?.shaft === false), 'click: off (stored as shaft: false)');
ok(await ev(() => window.H.app.history.undoLabel === 'Groups: no depth c1_penis'), 'one undo step: ' + await ev(() => window.H.app.history.undoLabel));
await p.mouse.move(5, 5); await wait();
const offOp = await depth('Bottom penis').evaluate((e) => +getComputedStyle(e).opacity);
ok(offOp < 0.6, 'off is drawn faint: ' + offOp);
await depth('Bottom penis').click(); await wait();
ok(await ev(() => !('shaft' in window.H.groups.groups.find((g) => g.name === 'c1_penis'))), 'click again: back to the default (no key)');
await p.mouse.move(5, 5); await wait();
await chip('Bottom penis').screenshot({ path: shot.replace(/\.png$/, '-chip.png') });
await p.keyboard.press('Escape'); await wait(300);
await ev(() => window.H.tr.trackRange({ tracker: 'fake.pinned', range: { t0: 20000, t1: 60027 }, roi: { kind: 'box', x: 0.2, y: 0.2, w: 0.6, h: 0.6 } }));
for (let k = 0; k < 60 && await ev(() => window.H.app.tasks.length); k++) await wait(250);
const req = await ev(() => window.H.FAKE.requests.filter((r) => r.tracker === 'fake.pinned').at(-1));
ok(JSON.stringify(req?.groups?.map((g) => [g.name, !!g.shaft])) === '[["c1_penis",true],["c2_anus",false],["c2_hips",false]]', 'Track sends shaft: true on the penis only: ' + JSON.stringify(req?.groups?.map((g) => [g.name, g.shaft])));
const runId = await ev(() => window.H.tr.runs.find((x) => x.tracker === 'fake.pinned')?.id);
await ev((id) => window.H.tr.select(id), runId); await wait(300);
const at = await ev(() => { const s = window.H.tr.shaftAt(36000), m = window.H.tr.insertedAt(36000); return { s: !!s, in: m?.in, conf: m?.conf, src: m?.source }; });
ok(at.s && at.src === 'sam' && at.in >= 0 && at.in <= 1 && at.conf > 0.5, 'the run has the shaft at 36 s: ' + JSON.stringify(at));
await ev(() => { window.H.app.setMode?.('track'); window.H.app.player.seek(36000); }); await wait(500);
// 145370e (paw-p8o2): the Adjust strip lives only in the inspector band of the combined stroke lane (LaneStack), which this
// harness does not mount: what the strip reads instead (DeriveStrip: directionText(tr.shaftDirection(run, i)); the depth range
// default = run.depthUsed's 'used'); the painted strip is checked in the real window (dev/smart-cusp-check, dev/shaft-source-check)
const sd = await ev(async (id) => { const m = await import('/src/lib/shaft.js'), { sceneAt } = await import('/src/lib/runs.js'), r = window.H.tr.run(id), s = window.H.tr.scenes[1];
  const d = window.H.tr.shaftDirection(r, 1), sk = sceneAt(r.scenes || [], (s.start_ms + s.end_ms) / 2);
  const du = r.depthUsed?.find((x) => x.i === sk), sh = m.shaftOf(r, sk), set = window.H.tr.shotDerive(1, id)?.strokes?.range;   // DeriveStrip's S.range
  return { line: d ? 'Direction: ' + m.directionText(d, 'F') : '', used: set ?? (du ? du.used : sh && sh.share >= m.SHARE_MIN ? 'shaft' : null), share: sh?.share }; }, runId);
ok(/Direction: (from the shaft \(confident|the shaft says the other way)/.test(sd.line), 'the Adjust strip\'s direction line says what the shaft says: ' + sd.line);
ok(sd.used === 'shaft', 'the depth range uses the shaft by default here: ' + JSON.stringify(sd));
const stage = p.locator('[data-testid="video-stage"]');
await stage.screenshot({ path: shot });
const g = await ev(() => { const r = window.H.tr.shaftAt(36000); return r && { base: r.base, entry: r.entry, in: r.in }; });
ok(!!g, 'overlay data: ' + JSON.stringify(g));
// the gauge sits beside the entry edge (above / below / ahead / behind, clear of labels): probe there for the marks menu
const vw = await ev(() => { const v = document.querySelector('[data-testid="video-stage"] video'); const r = v.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
let opened = false;
for (const [dx, dy] of [[0, 0], [0, 30], [0, -30], [0, 24], [0, -24], [45, 0], [-45, 0], [35, 0], [-35, 0]]) {
  await p.mouse.click(vw.x + g.entry[0] * vw.w + dx, vw.y + g.entry[1] * vw.h + dy); await wait(200);
  if (await p.locator('[role="menu"]', { hasText: 'Fully out here' }).count()) { opened = true; break; }
}
ok(opened, 'clicking the gauge on the video opens the depth marks menu');
if (opened) {
  await p.locator('[role="menuitem"]', { hasText: 'Fully out here' }).click(); await wait(200);
  const d = await ev((id) => window.H.tr.shotDerive(1, id), runId);   // the shot's derive is per run now (deriveOf), not scene.derive
  ok(Math.abs(d?.shaft?.out - 36000) < 40, 'Fully out here marks the shot: ' + JSON.stringify(d));
  ok(await ev(() => window.H.app.history.undoLabel === 'Shaft: fully out here'), 'one undo step: ' + await ev(() => window.H.app.history.undoLabel));
  // the marked frame reads 0 % in as soon as the mark is stored (insertedAt reads the shot's marks; no recompose in between).
  // paw-kbou: the failures here (2 in 9 shard runs) were not load, though paw-mawd raised this wait from 3 s to 20 s for it: the
  // fake reading is random, and when the marked frame had the shaft all in (visible length at its hilted end) lib/shaft.js
  // dropped a lone "fully out" mark (its scale collapsed to [0, 1]) and the frame stayed 100 % in however long one waited
  await p.waitForFunction((t) => Math.abs(window.H.tr.insertedAt(t)?.in ?? 1) < 1e-6, d.shaft.out, { timeout: 20000 }).catch(() => {});
  const after = await ev((t) => ({ sel: window.H.tr.selectedId, ins: window.H.tr.insertedAt(t)?.in ?? null, t: window.H.app.player.timeMs }), d.shaft.out);
  ok(after.sel === runId && Math.abs(after.ins) < 1e-6, 'the run stays selected and the marked frame now reads 0 % in: ' + JSON.stringify(after));
}
ok(errors === 0, 'no console errors');
await b.close();
console.log(fails ? `${fails} FAILED` : 'all ok');
