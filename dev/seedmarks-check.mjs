// dev/seedmarks-check.mjs -- paw-46du "seed frames get printed on the timeline so you can jump to them", in YOUR test instance
// (node dev/test-app.mjs start ...; the fake sidecar), on a generated one-shot clip (dev/groups-hide-check.mjs --make <clip>).
// Real pointer strokes paint Bottom torso on frame A and Top penis on frame B of the one shot (no run yet), then, asserted on
// what the Actions and shots row's canvas PAINTS (its --intent tabs near the foot of the Shots strip):
//  1. both marks drawn at their frames' x before any run, nothing between them; the hover tip names the frame and the keys;
//  2. a click on mark B lands on B's exact frame; the commands next / previous seed frame jump B -> A -> (round) B, the keys
//     Shift+] / Shift+[ too, and they have no real key conflict; the right-click menu has previous / next;
//  3. T (fake.groups): one run, both marks still drawn, the tip names the run.
//   node dev/seedmarks-check.mjs <clip.mp4> <out dir>      (two screenshots: <out>/seedmarks-before.png, seedmarks-after.png)
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';

const [clip, out] = process.argv.slice(2);
if (!clip || !out) { console.error('usage: node dev/seedmarks-check.mjs <clip.mp4> <out dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
for (const f of [clip.replace(/\.[^.]+$/, '.pawproj'), clip.replace(/\.[^.]+$/, '.pawruns')]) if (existsSync(f)) rmSync(f);
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('[pageerror]', String(e.message).slice(0, 300)); });
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : d.choices?.[0]?.id ?? null); });
const A = 1000, B = 2500;
const seek = async (t) => { await ev((t) => { app.player.pause(); app.player.seek(t, { exact: true }); }, t); await page.waitForFunction((t) => Math.abs(app.player.timeMs - t) < 20 && !app.player.el?.seeking, t, { timeout: 15000 }); await wait(400); };
const toolOn = async () => { await ev(() => { if (!window.__pawDev.groupsFor(app).on) app.commands.run('tracking.groups'); }); await page.waitForFunction(() => !!document.querySelector('[data-testid="groups-tools"]'), null, { timeout: 10000 }); await wait(300); };
const toolOff = async () => { await ev(() => { if (window.__pawDev.groupsFor(app).on) app.commands.run('tracking.groups'); }); await page.waitForFunction(() => !window.__pawDev.groupsFor(app).on, null, { timeout: 10000 }); await wait(300); };
const stroke = async (nx, ny) => {
  const b = await ev(() => { const r = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const at = (x, y) => [b.x + x * b.w, b.y + y * b.h];
  await page.mouse.move(...at(nx, ny)); await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(...at(nx + 0.006 * k, ny + 0.004 * k));
  await page.mouse.up(); await wait(500);
};
// the Shots strip's foot: for each time, is the --intent tab painted at its x (7 px over the bottom edge)? + the geometry
const marks = (ts) => ev((ts) => {
  const c = document.querySelector('[data-tl-lane="scenes"] canvas'), r = c.getBoundingClientRect(), d = c.width / c.clientWidth;
  const probe = document.createElement('canvas').getContext('2d'); probe.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--intent').trim(); probe.fillRect(0, 0, 1, 1);
  const want = probe.getImageData(0, 0, 1, 1).data, ctx = c.getContext('2d'), v = app.view, w = c.clientWidth, h = c.clientHeight;
  const pink = (x) => { const p = ctx.getImageData(Math.round(x * d), Math.floor((h - 7) * d), 1, 1).data; return Math.abs(p[0] - want[0]) + Math.abs(p[1] - want[1]) + Math.abs(p[2] - want[2]) < 40; };
  const xs = ts.map((t) => ((t - v.start) / v.span) * w);
  return { at: xs.map((x) => [x - 1, x, x + 1].some(pink)), between: pink((xs[0] + xs[1]) / 2), xs, box: { x: r.x, y: r.y, w, h } };
}, ts);

try {
  await page.waitForFunction(() => window.app && window.__pawDev?.groupsFor, null, { timeout: 30000 });
  const op = ev((c) => app.project.openVideo(c, { force: true }), clip);
  for (let k = 0; k < 8; k++) { await wait(500); await answer(); }
  await op.catch(() => {});
  await page.waitForFunction(() => app.doc.media && app.player.ready, null, { timeout: 60000 });
  const D = await ev(() => app.durationMs);
  await ev((D) => {
    app.setMode('track'); app.player.pause();
    app.doc.scenes = [{ start_ms: 0, end_ms: D }];
    for (const [k, v] of [['tracking.groups.snap', false], ['tracking.groups.circle', false], ['tracking.groups.grow', false], ['tracking.groups.brush', 0.04], ['tracking.scenes', 'document']]) app.settings.set(k, v);
    const tr = window.__pawDev.trackingFor(app);
    tr.runs = []; app.doc.ghosts = (app.doc.ghosts || []).filter((g) => g.source?.kind !== 'tracker');
    tr.selectTracker('fake.groups');
    app.doc.range = { t0: 0, t1: D };
    app.setView({ start: 0, span: D });
  }, D);
  await page.waitForFunction(() => window.__pawDev.trackingFor(app).trackerId === 'fake.groups', null, { timeout: 15000 });
  ok(!(await ev(() => app.commands.enabled('timeline.key.nextSeed'))) && /seed frames/i.test(await ev(() => app.commands.whyNot('timeline.key.nextSeed'))), `no seed frame yet: the command is off and says why ("${await ev(() => app.commands.whyNot('timeline.key.nextSeed'))}")`);

  // ---- paint on two frames of the one shot, no run ----
  await seek(A); await toolOn();
  await ev(() => { const g = window.__pawDev.groupsFor(app); g.setWho('c1'); g.pickPart('torso'); });
  await stroke(0.3, 0.3);
  await seek(B); await toolOn();
  await ev(() => { const g = window.__pawDev.groupsFor(app); g.setWho('c2'); g.pickPart('penis'); });
  await stroke(0.62, 0.62);
  await toolOff();
  const ts = await ev(() => [...new Set((app.doc.scenes[0].groups || []).map((g) => g.t_ms))].sort((a, b) => a - b));
  ok(ts.length === 2 && Math.abs(ts[0] - A) < 40 && Math.abs(ts[1] - B) < 40, `painted on two frames: ${JSON.stringify(ts)}`);
  ok((await ev(() => window.__pawDev.trackingFor(app).runs.length)) === 0, 'no run yet');
  await wait(300);
  let m = await marks(ts);
  ok(m.at[0] && m.at[1] && !m.between, `both seed marks painted at their x (${m.xs.map((x) => x.toFixed(1)).join(', ')} px), nothing between: ${JSON.stringify({ at: m.at, between: m.between })}`);

  // hover mark A: the tip
  await page.mouse.move(m.box.x + m.xs[0], m.box.y + m.box.h - 7); await wait(500);
  const tip = await ev(() => { const s = document.body.innerText, i = s.indexOf('Seed frame'); return i < 0 ? '' : s.slice(i, i + 300); });
  ok(/Seed frame/.test(tip) && /frame \d+/.test(tip) && /painted here/.test(tip) && /previous \/ next seed frame/.test(tip), `hover tip: "${tip.slice(0, 200)}"`);
  await page.screenshot({ path: `${out}/seedmarks-before.png` });

  // ---- click mark B: its exact frame ----
  await seek(0);
  await page.mouse.click(m.box.x + m.xs[1], m.box.y + m.box.h - 7); await wait(700);
  let at = await ev(() => app.player.timeMs);
  ok(Math.abs(at - ts[1]) < 2, `a click on mark B lands on its frame: ${at} (want ${ts[1]})`);
  // next / previous: B -> A (round the video) -> B; previous from A -> B (round)
  await ev(() => app.commands.run('timeline.key.nextSeed')); await wait(600); at = await ev(() => app.player.timeMs);
  ok(Math.abs(at - ts[0]) < 2, `next seed frame from the last: round to the first (${at})`);
  await ev(() => app.commands.run('timeline.key.nextSeed')); await wait(600); at = await ev(() => app.player.timeMs);
  ok(Math.abs(at - ts[1]) < 2, `next seed frame: B (${at})`);
  await ev(() => app.commands.run('timeline.key.prevSeed')); await wait(600); at = await ev(() => app.player.timeMs);
  ok(Math.abs(at - ts[0]) < 2, `previous seed frame: A (${at})`);
  // the keys, from the timeline
  const keys = await ev(() => [app.commands.keysFor('timeline.key.prevSeed'), app.commands.keysFor('timeline.key.nextSeed')]);
  const clash = await ev(() => app.commands.conflicts().filter((c) => c.ids.some((id) => /Seed$/.test(id))));
  ok(keys[0][0] === 'Shift+[' && keys[1][0] === 'Shift+]' && !clash.length, `keys ${JSON.stringify(keys)}, real conflicts: ${JSON.stringify(clash)}`);
  await page.keyboard.press('Shift+BracketRight'); await wait(600); at = await ev(() => app.player.timeMs);
  ok(Math.abs(at - ts[1]) < 2, `Shift+] -> B (${at})`);
  await page.keyboard.press('Shift+BracketLeft'); await wait(600); at = await ev(() => app.player.timeMs);
  ok(Math.abs(at - ts[0]) < 2, `Shift+[ -> A (${at})`);
  const here = await ev(() => [...(app.commands.list({ enabled: false }) || [])].filter((c) => /Seed$/.test(c.id)).map((c) => c.title));
  ok(here.includes('Go to previous seed frame') && here.includes('Go to next seed frame'), `searchable: ${JSON.stringify(here)}`);
  // right-click mark A: its menu
  await page.mouse.click(m.box.x + m.xs[0], m.box.y + m.box.h - 7, { button: 'right' }); await wait(400);
  const menu = await ev(() => [...document.querySelectorAll('[role=menu] [role^=menuitem]')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  ok(menu.some((t) => /Previous seed frame/.test(t)) && menu.some((t) => /Next seed frame/.test(t)) && menu.some((t) => /Go to this frame/.test(t)), `right-click menu: ${JSON.stringify(menu)}`);
  await page.keyboard.press('Escape'); await wait(300);

  // ---- T: a run; the marks stay ----
  await ev(() => app.commands.run('track.run', { all: true }));
  await page.waitForFunction(() => window.__pawDev.trackingFor(app).runs.length > 0 && !window.__pawDev.trackingFor(app).busy, null, { timeout: 60000 }); await wait(800);
  m = await marks(ts);
  ok(m.at[0] && m.at[1], `after T both marks still painted: ${JSON.stringify(m.at)}`);
  await page.mouse.move(m.box.x + m.xs[1], m.box.y + m.box.h - 7); await wait(500);
  const tip2 = await ev(() => { const s = document.body.innerText, i = s.indexOf('Seed frame'); return i < 0 ? '' : s.slice(i, i + 300); });
  ok(/run #\d+/.test(tip2), `the tip names the run: "${tip2.slice(0, 200)}"`);
  await page.screenshot({ path: `${out}/seedmarks-after.png` });
} catch (e) {
  fails++; console.log('FAIL', e?.stack || e);
} finally {
  await browser.close().catch(() => {});
  console.log(fails ? `${fails} FAILED` : 'all ok');
  process.exit(fails ? 1 : 0);
}
