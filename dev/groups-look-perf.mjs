// dev/groups-look-perf.mjs -- paw-c1m1 frame times of the Groups tool's look, in YOUR test instance (CDP_* env), on a GENERATED 1080p
// clip with 30 painted groups (two characters), the tool open on their frame. For each fill (tracking.groups.fill: dither, hatch, gradient,
// flat; a build without the setting just draws its own look) it measures the groups drawer's time per call and the frame times
//   cold    the first draw (every mask's stats / hatch built)
//   hover   the pointer swept across the parts (every change of the part under it redraws the overlay: the hot path while painting)
//   stroke  a paint stroke across four parts (the stroke canvas + overlay redraws at pen down / up)
//   scrub   the playhead stepped frame by frame round the seed frame and back (the tool open)
// and fails over budget: drawer p95 <= 8 ms, frame median <= 20 ms, no long task over 50 ms (after the cold draw).
//   ffmpeg -y -v error -f lavfi -i testsrc2=s=1920x1080:r=30:d=6 -c:v libx264 -pix_fmt yuv420p p.mp4
//   node dev/groups-look-perf.mjs <clip.mp4> <out dir> [--fills hatch,gradient,flat]
import { connectTestApp } from './cdp-connect.mjs';
import { mkdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2), fi = args.indexOf('--fills'), fills = fi >= 0 ? args.splice(fi, 2)[1].split(',') : ['dither', 'hatch', 'gradient', 'flat'];
const [clip, out] = args;
if (!clip || !out) { console.error('usage: node dev/groups-look-perf.mjs <clip.mp4> <out dir> [--fills a,b]'); process.exit(2); }
mkdirSync(out, { recursive: true });
for (const f of [clip.replace(/\.[^.]+$/, '.pawproj'), clip.replace(/\.[^.]+$/, '.pawruns')]) if (existsSync(f)) rmSync(f);
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });

// 30 parts: two characters side by side, each part a turned box (cx, cy, w, h, deg) in picture units
const box = (cx, cy, w, h, deg = 0) => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), A = 16 / 9; return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([u, v]) => [cx + (u * c - v * s * 1 / A) / 2, cy + (u * s * A + v * c) / 2]); };
const body = (who, dx, parts) => parts.map(([part, side, b]) => ({ name: `${who}_${part}${side ? '_' + side : ''}`, who, part, ...(side ? { side } : {}), poly: box(b[0] + dx, b[1], b[2], b[3], b[4] || 0) }));
const C1 = [['head', null, [0.25, 0.12, 0.08, 0.14]], ['torso', null, [0.25, 0.33, 0.12, 0.28]], ['hips', null, [0.25, 0.53, 0.12, 0.12]],
  ['shoulder', 'l', [0.33, 0.27, 0.04, 0.14, -20]], ['forearm', 'l', [0.36, 0.40, 0.035, 0.14, -10]], ['hand', 'l', [0.37, 0.51, 0.04, 0.06]],
  ['shoulder', 'r', [0.17, 0.27, 0.04, 0.14, 20]], ['forearm', 'r', [0.14, 0.40, 0.035, 0.14, 10]], ['hand', 'r', [0.13, 0.51, 0.04, 0.06]],
  ['thighs', 'l', [0.29, 0.66, 0.05, 0.16]], ['shin', 'l', [0.30, 0.82, 0.04, 0.15]], ['paws', 'l', [0.31, 0.93, 0.06, 0.04]],
  ['thighs', 'r', [0.21, 0.66, 0.05, 0.16]], ['shin', 'r', [0.20, 0.82, 0.04, 0.15]], ['paws', 'r', [0.19, 0.93, 0.06, 0.04]],
  ['tail', null, [0.36, 0.58, 0.14, 0.03, -15]], ['penis', null, [0.25, 0.60, 0.025, 0.07]], ['balls', null, [0.25, 0.63, 0.04, 0.035]]];
const C2 = C1.filter(([p]) => !['shin', 'paws', 'tail', 'balls'].includes(p));
const G30 = [...body('c1', 0, C1), ...body('c2', 0.5, C2)];
const A = 1000;
const stats = (a) => { const s = [...a].sort((x, y) => x - y), q = (p) => +(s[Math.min(s.length - 1, Math.floor(s.length * p))] || 0).toFixed(2); return { n: s.length, median: q(0.5), p95: q(0.95), max: +(s[s.length - 1] || 0).toFixed(2), mean: +(s.reduce((x, y) => x + y, 0) / Math.max(1, s.length)).toFixed(2) }; };

try {
  await page.waitForFunction(() => window.app && window.__pawDev?.groupsFor, null, { timeout: 60000 });
  const p = ev((c) => app.project.openVideo(c, { force: true }), clip);
  for (let k = 0; k < 6; k++) { await wait(500); await ev(() => { if (app.dialog) app.dialog.resolve(app.dialog.choices?.[0]?.id ?? null); }); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.doc.media && app.player.ready && app.player.vw > 0, null, { timeout: 60000 });
  const media = await ev(() => [app.player.vw, app.player.vh]);
  ok(media[0] === 1920 && media[1] === 1080, `a 1080p picture (${media.join(' x ')})`);
  ok(G30.length === 30, `${G30.length} groups`);
  // instrumentation: the groups drawer's time per call, frame deltas, long tasks
  await ev(() => {
    const T = (window.__perf = { draw: [], frames: [], long: [], last: 0 });
    const raf = window.requestAnimationFrame.bind(window);
    new PerformanceObserver((l) => l.getEntries().forEach((e) => T.long.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] });
    const loop = (t) => { if (T.last) T.frames.push(t - T.last); T.last = t; raf(loop); };
    raf(loop);
  });
  const wrap = () => ev(() => {
    const L = app.player.overlays, d = L.drawers.find((x) => x.id === 'tracking.groups');
    if (!d || d.__timed) return !!d;
    const f = d.draw; d.draw = (ctx, env) => { const t = performance.now(); try { return f(ctx, env); } finally { window.__perf.draw.push(performance.now() - t); } };
    d.__timed = true; L.invalidate(); return true;
  });
  const mark = () => ev(() => { const T = window.__perf; T.draw = []; T.frames = []; T.long = []; });
  const take = () => ev(() => { const T = window.__perf; return { draw: T.draw.slice(), frames: T.frames.slice(), long: T.long.slice() }; });
  const geo = () => ev(() => { const v = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(); return { x: v.x, y: v.y, w: v.width, h: v.height }; });
  const results = {};
  for (const fill of fills) {
    await ev(([groups, A, fill]) => {
      const G = __pawDev.groupsFor(app);
      if (G.on) app.commands.run('tracking.groups');
      app.setMode('track'); app.player.pause(); try { app.settings.set('tracking.groups.fill', fill); } catch { /* a build without the setting */ }
      app.doc.scenes = [{ start_ms: 0, end_ms: app.durationMs, groups: groups.map((g) => ({ ...g, pinned: true, t_ms: A, source: 'user' })) }];
      app.player.seek(A, { exact: true });
    }, [G30.map((g) => ({ ...g, ...(['thighs', 'shoulder'].includes(g.part) ? { depth: true } : {}), ...(['penis', 'balls'].includes(g.part) ? { pulse: true } : {}), poly: g.poly.map(([x, y]) => [x + Math.random() * 1e-6, y]) })), A, fill]);   // fresh polys: no cache carried over from the last fill; some parts measured / spurt cues (their marks drawn too)
    await page.waitForFunction((A) => Math.abs(app.player.timeMs - A) < 20 && !app.player.el?.seeking, A, { timeout: 15000 });
    ok(await wrap(), `${fill}: the groups drawer found`);   // (timed from before the tool opens: the cold draw builds every mask's look)
    await mark();
    await ev(() => { const G = __pawDev.groupsFor(app); if (!G.on) app.commands.run('tracking.groups'); });
    await page.waitForFunction(() => __pawDev.groupsFor(app).on && __pawDev.groupsFor(app).groups.length === 30, null, { timeout: 10000 });
    await wait(500);
    const cold = await take();
    const g = await geo(), P = (x, y) => [g.x + x * g.w, g.y + y * g.h];
    // hover: sweep the pointer over both characters, row by row
    await mark();
    for (const y of [0.15, 0.3, 0.45, 0.6, 0.75, 0.9]) for (let x = 0.08; x <= 0.92; x += 0.02) await page.mouse.move(...P(x, y));
    await wait(200);
    const hover = await take();
    // a stroke across four parts (it starts on the torso: adds to it)
    await mark();
    await page.mouse.move(...P(0.25, 0.35)); await page.mouse.down();
    for (let k = 1; k <= 40; k++) await page.mouse.move(...P(0.25 + k * 0.004, 0.35 + k * 0.012));
    await page.mouse.up(); await wait(500);
    const stroke = await take();
    await ev(() => app.commands.run('edit.undo')); await wait(300);
    // scrub: step frames off the seed frame and back (the tool open)
    await page.mouse.move(2, 2); await wait(200);
    await mark();
    const fm = await ev(() => app.player.frameMs || 1000 / 30);
    for (const k of [...Array(20).keys()].map((i) => i + 1).concat([...Array(20).keys()].map((i) => 19 - i))) { await ev((t) => app.player.seek(t, { exact: true }), A + k * fm); await wait(20); }
    await wait(300);
    const scrub = await take();
    const r = { cold: { draw: stats(cold.draw) }, hover: { draw: stats(hover.draw), frame: stats(hover.frames), long: hover.long }, stroke: { draw: stats(stroke.draw), frame: stats(stroke.frames), long: stroke.long }, scrub: { draw: stats(scrub.draw), frame: stats(scrub.frames), long: scrub.long } };
    results[fill] = r;
    console.log(`${fill}: ${JSON.stringify(r)}`);
    ok(r.hover.draw.p95 <= 8 && r.stroke.draw.p95 <= 8, `${fill}: groups drawer p95 hover ${r.hover.draw.p95} ms, stroke ${r.stroke.draw.p95} ms (budget 8; mean ${r.hover.draw.mean} / ${r.stroke.draw.mean}; cold ${r.cold.draw.max})`);
    ok(r.hover.frame.median <= 20 && r.stroke.frame.median <= 20 && r.scrub.frame.median <= 40, `${fill}: frame median hover ${r.hover.frame.median}, stroke ${r.stroke.frame.median}, scrub ${r.scrub.frame.median} ms`);
    ok([...r.hover.long, ...r.stroke.long].every((d) => d <= 50), `${fill}: long tasks while hovering / painting ${JSON.stringify([...r.hover.long, ...r.stroke.long])}`);
  }
  writeFileSync(join(out, 'groups-look-perf.json'), JSON.stringify(results, null, 1));
} catch (e) { fails++; console.log('FAIL', e.message); }
console.log(fails ? `${fails} failure(s)` : 'all ok');
await browser.close();
process.exit(fails ? 1 : 0);
