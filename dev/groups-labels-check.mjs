// dev/groups-labels-check.mjs -- paw-6m6o / paw-c1m1 in YOUR test instance (node dev/test-app.mjs start ...; the fake sidecar), on a
// generated clip: 12 overlapping groups on one character (two of them unconfirmed '?'), the Groups tool open, one group active. What
// the overlay drew (G.labelsShown: centre, size, angle in stage px) and the overlay canvas' pixels:
//  1. Smart (the default): every label INSIDE its own part (its box, turned, within the outline), none over another; full names only
//     for the active, hovered and unconfirmed groups, the rest short tags ('RS', 'LT2'); 'Bottom' left out and said once on the
//     labels chip; no pill above the active group (its name is inside it); a group hovered gets its full name
//  2. a label is not a hit target: a stroke starting on a label's centre paints its part; Alt+click on a label selects the part under
//     it; a right click on one opens the picker on that part
//  3. Shift+H -> All (full names wherever they fit) -> None (no labels; hover: the name as a tip) -> Smart
//  4. the fill (paw-c1m1): Dither is the default (1-bit square cells, the thigh's bigger than the shin's); Hatch: across a thigh ->
//     shin border the period changes (wide vs fine lines); Gradient: no lines; Flat: even inside; a Prop in the bar's options; Shift+J cycles
//  5. right click on a part: the picker's switches measure its depth / make it a spurt cue (greyed with a reason where they cannot);
//     the look shows them (Flat: a ruler of ticks inside the thigh's long edge, dotted rings inside the penis); the list row's icons are
//     the same switches; undo covers them
//   node dev/groups-labels-check.mjs <clip.mp4> <out dir> [--shots <dir>]   (grouplook-dither / -hatch / -gradient / -flat / -painting / -smart.png)
import { connectTestApp } from './cdp-connect.mjs';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2), si = args.indexOf('--shots'), shots = si >= 0 ? args.splice(si, 2)[1] : null;
const [clip, out] = args;
if (!clip || !out) { console.error('usage: node dev/groups-labels-check.mjs <clip.mp4> <out dir> [--shots <dir>]'); process.exit(2); }
mkdirSync(out, { recursive: true }); if (shots) mkdirSync(shots, { recursive: true });
for (const f of [clip.replace(/\.[^.]+$/, '.pawproj'), clip.replace(/\.[^.]+$/, '.pawruns')]) if (existsSync(f)) rmSync(f);
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });

const SQ = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const mk = (rows) => rows.map(([part, side, poly, unconfirmed, rep]) => ({ name: `c1_${part}${side ? '_' + side : ''}${rep || ''}`, who: 'c1', part, ...(side ? { side } : {}), poly, ...(unconfirmed ? { unconfirmed: true } : {}) }));
const G12 = mk([
  ['head', null, SQ(0.45, 0.10, 0.10, 0.16), true], ['torso', null, SQ(0.42, 0.24, 0.16, 0.30), true], ['hips', null, SQ(0.42, 0.50, 0.16, 0.12)],
  ['shoulder', 'r', SQ(0.36, 0.24, 0.08, 0.12)], ['forearm', 'r', SQ(0.32, 0.34, 0.07, 0.14)], ['hand', 'r', SQ(0.30, 0.46, 0.06, 0.08)],
  ['hand', 'l', SQ(0.58, 0.40, 0.06, 0.08)], ['thighs', 'l', SQ(0.52, 0.58, 0.07, 0.16)], ['thighs', 'l', SQ(0.50, 0.62, 0.07, 0.14), false, '2'],
  ['shin', 'r', SQ(0.42, 0.70, 0.06, 0.16)], ['paws', 'l', SQ(0.52, 0.80, 0.07, 0.07)], ['tail', null, [[0.58, 0.52], [0.80, 0.48], [0.82, 0.54], [0.58, 0.58]]],
]);
// a leg on its own: hips, a thigh and a shin stacked straight down (the border at y 0.55), for the texture across the border
const LEG = mk([['hips', null, SQ(0.36, 0.12, 0.28, 0.14)], ['thighs', 'r', SQ(0.40, 0.26, 0.12, 0.29)], ['shin', 'r', SQ(0.40, 0.55, 0.12, 0.30)], ['penis', null, SQ(0.56, 0.30, 0.06, 0.16)]]);
const A = 1000;
const inPoly = (poly, x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const aabb = (b) => { const c = Math.abs(Math.cos(b.ang)), s = Math.abs(Math.sin(b.ang)); return { x: b.x - (b.w * c + b.h * s) / 2, y: b.y - (b.w * s + b.h * c) / 2, w: b.w * c + b.h * s, h: b.w * s + b.h * c }; };
const meets = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const read = () => ev(() => {
  const G = __pawDev.groupsFor(app), st = document.querySelector('[data-testid="video-stage"]'), s = st.getBoundingClientRect(), v = st.querySelector('video').getBoundingClientRect();
  return { labels: (G.labelsShown || []).map((q) => ({ ...q })), stage: { x: s.x, y: s.y }, pic: { x0: v.x - s.x, y0: v.y - s.y, w: v.width, h: v.height, cx: v.x, cy: v.y },
    pill: !!document.querySelector('svg.ghl rect.pill'), mode: app.settings.get('tracking.groups.labels'), fill: app.settings.get('tracking.groups.fill'), active: G.active, hoverK: G.hoverK, picker: G.picker ? G.picker.k : -1,
    chip: document.querySelector('[data-testid="groups-labels"]')?.textContent?.trim() || '', tip: document.querySelector('[data-testid="groups-label-tip"]')?.textContent?.trim() || '', names: G.groups.map((g) => g.name) };
});
// a label's box (turned) in picture units: its centre and its 4 corners pulled in by 1.5 px
const corners = (s, b) => { const c = Math.cos(b.ang), n = Math.sin(b.ang), hw = b.w / 2 - 1.5, hh = b.h / 2 - 1.5; return [[0, 0], [-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([u, v]) => [(b.x + u * c - v * n - s.pic.x0) / s.pic.w, (b.y + u * n + v * c - s.pic.y0) / s.pic.h]); };
const sane = (s, tag, groups) => {
  const L = s.labels;
  let hit = 0, outside = 0;
  for (let i = 0; i < L.length; i++) {
    for (let j = 0; j < i; j++) if (meets(aabb(L[i]), aabb(L[j]))) { hit++; console.log(`     ${tag}: "${L[i].shown}" meets "${L[j].shown}"`); }
    const g = groups.find((x) => x.name === L[i].key);
    if (g && !corners(s, L[i]).every(([x, y]) => inPoly(g.poly, x, y))) { outside++; console.log(`     ${tag}: "${L[i].shown}" (${L[i].key}) not inside its part`); }
  }
  ok(hit === 0, `${tag}: ${L.length} labels, ${hit} overlapping pairs`);
  ok(outside === 0, `${tag}: every label inside its own part (${outside} not)`);
};
const shot = async (s, name) => { if (shots) await page.screenshot({ path: join(shots, name), clip: { x: s.pic.cx, y: s.pic.cy, width: s.pic.w, height: s.pic.h } }); };
const away = async () => { await page.mouse.move(2, 2); await wait(400); };
const cyc = async (want) => { await page.keyboard.press('Shift+H'); await page.waitForFunction((w) => app.settings.get('tracking.groups.labels') === w, want, { timeout: 3000 }).catch(() => {}); await wait(400); };
const centre = (s, b) => [s.stage.x + b.x, s.stage.y + b.y];
const setGroups = async (groups) => {
  await ev(([groups, A]) => {
    const G = __pawDev.groupsFor(app);
    if (G.on) app.commands.run('tracking.groups');
    app.doc.scenes = [{ start_ms: 0, end_ms: app.durationMs, groups: groups.map((g) => ({ ...g, pinned: true, t_ms: A, source: 'user' })) }];
    app.player.seek(A, { exact: true });
  }, [groups, A]);
  await page.waitForFunction((A) => Math.abs(app.player.timeMs - A) < 20 && !app.player.el?.seeking, A, { timeout: 15000 });
  await ev(() => { const G = __pawDev.groupsFor(app); if (!G.on) app.commands.run('tracking.groups'); });
  await page.waitForFunction((n) => __pawDev.groupsFor(app).on && __pawDev.groupsFor(app).groups.length === n, groups.length, { timeout: 10000 });
};
// the overlay canvas' alpha along a horizontal line at picture y, from picture x0 to x1 (device px)
const scan = (y, x0, x1) => ev(([y, x0, x1]) => {
  const st = document.querySelector('[data-testid="video-stage"]'), v = st.querySelector('video').getBoundingClientRect(), cv = st.querySelector('canvas.ov'), r = cv.getBoundingClientRect(), k = cv.width / r.width;
  const X0 = Math.round((v.x + x0 * v.width - r.x) * k), X1 = Math.round((v.x + x1 * v.width - r.x) * k), Y = Math.round((v.y + y * v.height - r.y) * k);
  const d = cv.getContext('2d').getImageData(X0, Y, X1 - X0, 1).data, a = [];
  for (let i = 3; i < d.length; i += 4) a.push(d[i]);
  return { a, dpr: k };
}, [y, x0, x1]);
// ... and down a column at picture x, from picture y0 to y1
const scanCol = (x, y0, y1) => ev(([x, y0, y1]) => {
  const st = document.querySelector('[data-testid="video-stage"]'), v = st.querySelector('video').getBoundingClientRect(), cv = st.querySelector('canvas.ov'), r = cv.getBoundingClientRect(), k = cv.width / r.width;
  const X = Math.round((v.x + x * v.width - r.x) * k), Y0 = Math.round((v.y + y0 * v.height - r.y) * k), Y1 = Math.round((v.y + y1 * v.height - r.y) * k);
  const d = cv.getContext('2d').getImageData(X, Y0, 1, Y1 - Y0).data, a = [];
  for (let i = 3; i < d.length; i += 4) a.push(d[i]);
  return a;
}, [x, y0, y1]);
// the dominant period of a profile (autocorrelation peak, lags 2..30), its spread (std)
const period = (a) => {
  const n = a.length, m = a.reduce((s, v) => s + v, 0) / n, d = a.map((v) => v - m), v0 = d.reduce((s, v) => s + v * v, 0) || 1;
  let best = 0, lag = 0;
  for (let L = 2; L <= 30 && L < n / 2; L++) { let c = 0; for (let i = 0; i + L < n; i++) c += d[i] * d[i + L]; c /= v0; if (c > best) { best = c; lag = L; } }
  return { lag, corr: best, std: Math.sqrt(v0 / n) };
};

try {
  await page.waitForFunction(() => window.app && window.__pawDev?.groupsFor, null, { timeout: 60000 });
  const p = ev((c) => app.project.openVideo(c, { force: true }), clip);
  for (let k = 0; k < 6; k++) { await wait(500); await ev(() => { if (app.dialog) app.dialog.resolve(app.dialog.choices?.[0]?.id ?? null); }); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.doc.media && app.player.ready && app.player.vw > 0, null, { timeout: 60000 });
  await ev(() => { app.setMode('track'); app.player.pause(); app.settings.reset('tracking.groups.labels'); app.settings.reset('tracking.groups.fill'); });
  await setGroups(G12);
  await ev(() => { const G = __pawDev.groupsFor(app); G.pick(G.groups.findIndex((g) => g.name === 'c1_hips')); });
  await away();

  // 1. Smart
  let s = await read();
  ok(s.mode === 'smart' && s.fill === 'dither', `the defaults: labels Smart (${s.mode}), fill Dither (${s.fill})`);
  sane(s, 'Smart', G12);
  const full = s.labels.filter((b) => b.full), tags = s.labels.filter((b) => !b.full);
  console.log(`     Smart: full ${full.map((b) => b.shown).join(' | ')}; tags ${tags.map((b) => b.shown).join(' ')}`);
  ok(s.labels.length >= 10, `Smart: ${s.labels.length} of 12 parts labelled (the rest too small: the brush names them)`);
  ok(full.every((b) => ['c1_head', 'c1_torso', 'c1_hips'].includes(b.key)) && full.some((b) => b.key === 'c1_hips'), 'the full ones: only the active (hips, inside it) and the unconfirmed');
  ok(!s.pill, 'no pill above the active group: its name is inside it');
  const tagOf = (key) => tags.find((b) => b.key === key)?.shown;
  ok(tagOf('c1_shoulder_r') === 'RS' && tagOf('c1_tail') === 'Ta', `tags: R shoulder ${tagOf('c1_shoulder_r')}, tail ${tagOf('c1_tail')}`);
  ok(s.labels.every((b) => !/^Bottom /.test(b.shown || '')) && /Smart/.test(s.chip) && /Bottom/.test(s.chip), `'Bottom' left out of the labels, said once on the chip ("${s.chip}")`);
  await shot(s, 'grouplook-smart.png');
  // a group hovered: its full name (the tail, away from its label)
  const tail = G12.find((g) => g.name === 'c1_tail'), tailK = s.names.indexOf('c1_tail'), tl0 = s.labels.find((b) => b.key === 'c1_tail');
  const pt = [0.79, 0.77, 0.62, 0.64].map((x) => [x, 0.52]).find(([x, y]) => inPoly(tail.poly, x, y) && (!tl0 || Math.abs(s.pic.x0 + x * s.pic.w - tl0.x) > tl0.w));
  if (pt) {
    await page.mouse.move(s.pic.cx + pt[0] * s.pic.w, s.pic.cy + pt[1] * s.pic.h); await wait(400);
    const h = await read(), tl = h.labels.find((b) => b.key === 'c1_tail');
    ok(h.hoverK === tailK && tl?.full, `hovering the tail: hoverK ${h.hoverK} (want ${tailK}), its label full ("${tl?.shown}")`);
    sane(h, 'Smart, the tail hovered', G12);
  } else ok(false, 'no free point on the tail to hover');

  // 2. a label is not a hit target
  await away(); s = await read();
  const torsoL = s.labels.find((b) => b.key === 'c1_torso');
  ok(!!torsoL, 'the torso has its label');
  if (torsoL) {
    const torso = () => ev(() => { const G = __pawDev.groupsFor(app), g = G.groups.find((x) => x.name === 'c1_torso'); return { n: G.groups.length, active: G.groups[G.active]?.name, sum: g ? Array.from(G.maskFor(g).a).reduce((a, b) => a + b, 0) : -1 }; });
    const m0 = await torso(), [cx, cy] = centre(s, torsoL);
    await page.mouse.move(cx, cy); await wait(200);
    await page.mouse.down();
    for (let k = 1; k <= 14; k++) await page.mouse.move(cx + k * 0.012 * s.pic.w, cy - k * 0.004 * s.pic.h);   // from the label's centre out past the torso's right edge
    await page.mouse.up(); await wait(600);
    const m1 = await torso();
    ok(m1.n === 12 && m1.sum > m0.sum, `a stroke starting on the torso's label paints the torso (mask ${m0.sum.toFixed(0)} -> ${m1.sum.toFixed(0)}, ${m1.n} groups)`);
    await ev(() => app.commands.run('edit.undo')); await wait(400);
    // Alt+click on the shoulder's label selects the shoulder
    s = await read();
    const sh = s.labels.find((b) => b.key === 'c1_shoulder_r');
    if (sh) {
      await page.mouse.move(...centre(s, sh)); await page.keyboard.down('Alt'); await page.mouse.down(); await page.mouse.up(); await page.keyboard.up('Alt'); await wait(400);
      const h = await read();
      ok(h.names[h.active] === 'c1_shoulder_r', `Alt+click on the shoulder's label selects it (active ${h.names[h.active]})`);
      await page.mouse.click(...centre(s, sh), { button: 'right' }); await wait(400);
      const r = await read();
      ok(r.names[r.picker] === 'c1_shoulder_r', `a right click on its label opens the picker on the shoulder (${r.names[r.picker] ?? 'closed'})`);
      await page.keyboard.press('Escape'); await wait(300);
    } else ok(false, 'the shoulder has its label');
  }
  await ev(() => { const G = __pawDev.groupsFor(app); if (!G.on) app.commands.run('tracking.groups'); G.pick(G.groups.findIndex((g) => g.name === 'c1_hips')); });

  // 3. All, None, Smart
  await away(); await cyc('all');
  s = await read();
  ok(s.mode === 'all', `Shift+H: All (${s.mode})`);
  ok(s.labels.length >= 10 && s.labels.filter((b) => b.full).length > full.length, `All: ${s.labels.length} labels, ${s.labels.filter((b) => b.full).length} full (Smart had ${full.length})`);
  sane(s, 'All', G12);
  console.log(`     All: ${s.labels.map((b) => b.shown).join(' | ')}`);
  await cyc('none');
  s = await read();
  ok(s.mode === 'none' && s.labels.length === 0 && !s.pill, `Shift+H: None: ${s.labels.length} labels, pill ${s.pill}`);
  if (pt) {
    await page.mouse.move(s.pic.cx + pt[0] * s.pic.w, s.pic.cy + pt[1] * s.pic.h); await wait(700);
    ok((await read()).tip === 'Bottom tail', 'None: hovering the tail shows its name as a tip');
  }
  await away(); await cyc('smart');
  ok((await read()).mode === 'smart', 'Shift+H: back to Smart');

  // 2b. painting: the stroke in progress (its part a plain tint), for the screenshot
  if (shots) {
    s = await read();
    const th = s.labels.find((b) => b.key === 'c1_thighs_l') || s.labels[0], [x, y] = centre(s, th);
    await page.mouse.move(x, y); await page.mouse.down();
    for (let k = 1; k <= 6; k++) await page.mouse.move(x + k * 4, y + k * 6);
    await wait(300); await shot(s, 'grouplook-painting.png');
    await page.mouse.up(); await wait(300); await ev(() => app.commands.run('edit.undo')); await wait(300);
  }

  // 4. the fill across a thigh -> shin border (a penis beside them, for the spurt cue)
  await setGroups(LEG); await away();
  s = await read();
  const yT = 0.50, yS = 0.60, X0 = 0.415, X1 = 0.505;   // just above / below the border at 0.55, inside both
  // Dither (the default): 1-bit square cells, the thigh's bigger than the shin's
  const rows = async (ys) => { const out = []; for (const y of ys) out.push((await scan(y, X0, X1)).a); return out; };   // (clear of the labels at the parts' middles)
  const dT = await rows([0.31, 0.33, 0.35, 0.47, 0.49]), dS = await rows([0.61, 0.63, 0.65, 0.77, 0.79]);
  const bimodal = (L) => { const a = L.flat(); return a.filter((v) => v < 12 || v > 200).length / a.length; }, runs = (a) => { const r = []; let n = 0; for (const v of a) { if (v > 128) n++; else if (n) { r.push(n); n = 0; } } return r.slice(1); };
  const minRun = (L) => Math.min(...L.flatMap((a) => runs(a)).filter((n) => n >= 2), 99);
  console.log(`     dither: thigh 1-bit ${(bimodal(dT) * 100).toFixed(0)} %, smallest dot ${minRun(dT)} px; shin ${(bimodal(dS) * 100).toFixed(0)} %, smallest dot ${minRun(dS)} px`);
  ok(bimodal(dT) > 0.9 && bimodal(dS) > 0.9 && dT.flat().some((v) => v > 200) && dT.flat().some((v) => v < 12), 'Dither: every pixel a dot or the footage (1-bit, crisp)');
  ok(minRun(dT) > minRun(dS) && minRun(dS) < 99, `Dither: the thigh's cells are bigger than the shin's (${minRun(dT)} vs ${minRun(dS)} px)`);
  await ev(() => app.settings.set('tracking.groups.fill', 'hatch')); await wait(400);
  const pT = period((await scan(yT, X0, X1)).a), pS = period((await scan(yS, X0, X1)).a), dpr = (await scan(yT, X0, X1)).dpr;
  console.log(`     hatch: thigh period ${pT.lag} px (corr ${pT.corr.toFixed(2)}, std ${pT.std.toFixed(1)}), shin ${pS.lag} px (corr ${pS.corr.toFixed(2)}, std ${pS.std.toFixed(1)}), dpr ${dpr.toFixed(2)}`);
  ok(pT.corr > 0.3 && pS.corr > 0.3, 'hatch: both parts show a regular line pattern');
  ok(Math.abs(pT.lag - 7 * dpr) <= 1.5 && Math.abs(pS.lag - 4.5 * dpr) <= 1.5, `the period changes across the border: thigh ${pT.lag} (wide, 7 css px), shin ${pS.lag} (fine, 4.5 css px)`);
  await page.keyboard.press('Shift+J'); await page.waitForFunction(() => app.settings.get('tracking.groups.fill') === 'gradient', null, { timeout: 3000 }).catch(() => {});
  await wait(400);
  const gT = period((await scan(yT, X0, X1)).a);
  ok(gT.std < pT.std / 3, `Shift+J: Gradient, no lines across the thigh (std ${gT.std.toFixed(1)} vs hatch ${pT.std.toFixed(1)})`);
  await page.keyboard.press('Shift+J'); await page.waitForFunction(() => app.settings.get('tracking.groups.fill') === 'flat', null, { timeout: 3000 }).catch(() => {});
  await wait(400);
  const fT = (await scan(yT, X0 + 0.01, X1 - 0.01)).a, fl = await ev(() => app.settings.get('tracking.groups.fill'));
  ok(fl === 'flat' && Math.max(...fT) - Math.min(...fT) <= 3, `Shift+J: Flat (${fl}), even inside the thigh (alpha ${Math.min(...fT)}..${Math.max(...fT)})`);
  // 5. measured / spurt cue, from the look (in Flat: the tint is even, so anything else in it is the mark). The thigh's ruler sits
  // inside its left long edge (its +normal side), ticks pointing in: a column just right of that edge crosses the ticks
  const spread = (L) => Math.max(...L.map((a) => Math.max(...a) - Math.min(...a)));   // the most any one line of the band varies
  const colT = async () => { const o = []; for (const x of [0.419, 0.420, 0.421, 0.422, 0.423]) o.push(await scanCol(x, 0.30, 0.52)); return o; };
  const colP = async () => { const o = []; for (const y of [0.330, 0.333, 0.336, 0.339, 0.342, 0.345]) o.push((await scan(y, 0.565, 0.615)).a); return o; };   // above its label
  const t0 = await colT(), p0 = await colP();
  const state = () => ev(() => { const G = __pawDev.groupsFor(app), th = G.groups.find((g) => g.name === 'c1_thighs_r'), pe = G.groups.find((g) => g.name === 'c1_penis'); return { depth: th?.depth === true, pulse: pe?.pulse === true }; });
  const centreOf = (x, y) => [s.pic.cx + x * s.pic.w, s.pic.cy + y * s.pic.h];
  await page.mouse.click(...centreOf(0.46, 0.40), { button: 'right' }); await wait(400);
  const dis = await ev(() => { const b = document.querySelector('[data-testid="groups-pick-toggles"] [data-command="tracking.groupsPulse"]'); return b ? b.getAttribute('aria-disabled') || String(b.disabled) : 'none'; });
  ok(dis === 'true', `the thigh's picker: "spurt cue" greyed (only the anus, balls, sheath and penis): ${dis}`);
  await ev(() => document.querySelector('[data-testid="groups-pick-toggles"] [data-command="tracking.groupsDepth"]')?.click()); await wait(400);
  ok((await state()).depth && (await ev(() => document.querySelector('[data-testid="groups-pick-toggles"] [data-command="tracking.groupsDepth"]')?.getAttribute('aria-pressed'))) === 'true', 'right click on the thigh, "measure depth": its depth is measured, the switch pressed');
  await page.keyboard.press('Escape'); await wait(300);
  await page.mouse.click(...centreOf(0.59, 0.38), { button: 'right' }); await wait(400);
  await ev(() => document.querySelector('[data-testid="groups-pick-toggles"] [data-command="tracking.groupsPulse"]')?.click()); await wait(400);
  ok((await state()).pulse, 'right click on the penis, "spurt cue": its contractions are a spurt cue');
  await page.keyboard.press('Escape'); await wait(300); await away();
  const t1 = await colT(), p1 = await colP();
  console.log(`     marks (Flat): thigh edge column spread ${spread(t0)} -> ${spread(t1)}, penis middle column ${spread(p0)} -> ${spread(p1)}`);
  ok(spread(t0) <= 3 && spread(t1) > 40, 'a measured part: a ruler of ticks inside its long edge (the column across it changes)');
  ok(spread(p0) <= 3 && spread(p1) > 40, 'a spurt-cue part: dotted rings inside it');
  // the list row's icons: the same state, the same command; undo covers it
  await ev(() => document.querySelector('[data-testid="groups-list-open"]')?.click()); await wait(400);
  const rowPressed = () => ev(() => { const b = [...document.querySelectorAll('.grp')].find((r) => /thigh/i.test(r.textContent))?.querySelector('[data-command="tracking.groupsDepth"]'); return b ? b.getAttribute('aria-pressed') : 'none'; });
  ok((await rowPressed()) === 'true', `the thigh's list row shows it measured (${await rowPressed()})`);
  await ev(() => [...document.querySelectorAll('.grp')].find((r) => /thigh/i.test(r.textContent))?.querySelector('[data-command="tracking.groupsDepth"]')?.click()); await wait(400);
  ok(!(await state()).depth, 'its row icon turns the same switch off');
  await ev(() => document.querySelector('[data-testid="groups-list-open"]')?.click()); await wait(300);
  await ev(() => app.commands.run('edit.undo')); await wait(400);
  ok((await state()).depth, 'undo: measured again');
  await ev(() => document.querySelector('[data-testid="groups-options"]')?.click()); await wait(400);
  ok(await ev(() => !!document.querySelector('[data-prop="tracking.groups.fill"]') && !!document.querySelector('[data-prop="tracking.groups.labels"]')), 'the fill and labels settings are in the bar\'s options (Prop)');
  await page.keyboard.press('Escape'); await wait(300);
  await page.keyboard.press('Shift+J'); await page.waitForFunction(() => app.settings.get('tracking.groups.fill') === 'dither', null, { timeout: 3000 }).catch(() => {});
  ok((await ev(() => app.settings.get('tracking.groups.fill'))) === 'dither', 'Shift+J: back to Dither');
  // the 12-part character in each fill, for the owner to choose
  if (shots) {
    await setGroups(G12);
    for (const fill of ['dither', 'hatch', 'gradient', 'flat']) { await ev((f) => app.settings.set('tracking.groups.fill', f), fill); await away(); await shot(await read(), `grouplook-${fill}.png`); }
    await ev(() => app.settings.reset('tracking.groups.fill'));
  }} catch (e) { fails++; console.log('FAIL', e.message); }
console.log(fails ? `${fails} failure(s)` : 'all ok');
await browser.close();
process.exit(fails ? 1 : 0);
