// dev/actions-check.mjs -- paw-2lp7.5 (regions stage 2): the Actions strip and the Actions panel, by real pointer and key events,
// asserted on what is PAINTED (the Scenes and shots row's canvas text, its height, the tooltip, the panel's rows), in YOUR test
// instance (node dev/test-app.mjs start ...; the CDP_* env it prints), on a copy of a generated clip in a folder of yours.
//   node dev/actions-check.mjs <clip.mp4> [--shots <dir>] [--long <13-minute clip.mp4>]
// Twelve 5 s shots, no action. A drag on the main line across two cuts makes one region (on frame starts); its end dragged
// onto a cut, its start to a mid-shot frame (the shot's marker: its tooltip); Alt+drag a secondary region above it (the row
// grows a band), its mix chip clicked (mix -> layer), dragged down onto the main line (the layers swap); tagged in place
// (double-click: the chips; anal + penetration); a shot selected on the Shots strip and 1 pressed (a region with the
// recent action); S / M / Delete on a selected region; a dashed proposal accepted by a click, another by the panel's
// "Accept 1 proposal"; every edit one undo step; the shots painted 1, 2, 3 ...; the panel lists the regions and the gaps and
// the selection follows both ways. paw-2lp7.9: far drags above the strip land one layer above those in use (the row grows one
// band), the only region on the top layer stays, deleting a middle layer's only region drops the one above (one step, undone).
// --long: a 13-minute overview (60 shots, 12 regions incl. two secondary) screenshot.
// Every page exception and console error fails it.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';
import { stripLayout, bandsIn, MIX_W } from '../src/features/timeline/actions-strip.js';

const args = process.argv.slice(2), opt = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
const src = args[0], shotsDir = opt('shots'), longClip = opt('long');
if (!src) { console.error('usage: node dev/actions-check.mjs <clip.mp4> [--shots <dir>] [--long <clip>]'); process.exit(2); }
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); return c; };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null); });
const settle = async (pred) => { for (let k = 0; k < 40; k++) { await answer(); if (await ev(pred).catch(() => false)) return true; await wait(500); } return false; };
const J = JSON.stringify;
const steps = () => ev(() => app._history.entries.length);
const acts = () => ev(() => (app.doc.acts || []).map((r) => ({ ...r })));
const desc = (a) => a.map((r) => `${r.layer}:${r.kind}:${Math.round(r.t0)}-${Math.round(r.t1)}:${r.tags.join('+')}${r.auto ? '?' : ''}${r.mix ? ':' + r.mix : ''}`).join(' | ');
const hookText = () => ev(() => {
  window.__ft = [];
  if (window.__ftHooked) return;
  const o = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { if (this.canvas?.closest?.('[data-tl-lane]')?.getAttribute('data-tl-lane') === 'scenes') window.__ft.push(String(t)); return o.call(this, t, ...a); };
  window.__ftHooked = true;
});
/** What the row paints now (its canvas text), after a forced repaint. */
const painted = async () => { await ev(() => { const v = app.view; app.setView({ start: v.start, span: v.span + 1 }); }); await wait(250); await ev(() => { window.__ft = []; const v = app.view; app.setView({ start: v.start, span: v.span - 1 }); }); await wait(350); return ev(() => window.__ft.slice()); };
/** The row's geometry now: canvas rect, the strip layout (actions-strip.js) and x(t). */
async function geo() {
  const g = await ev(() => { const c = document.querySelector('[data-tl-lane="scenes"] canvas').getBoundingClientRect(); return { left: c.left, top: c.top, w: c.width, h: c.height, v: { ...app.view }, acts: app.doc.acts || [] }; });
  // the bands the strip shows: those in use plus the empty one above them (befd421: somewhere to drag a secondary action into)
  const L = stripLayout(g.h, bandsIn(g.acts, g.v.start, g.v.start + g.v.span));
  const x = (t) => g.left + ((t - g.v.start) / g.v.span) * g.w, y = (b) => g.top + (b.y0 + b.y1) / 2;
  return { ...g, L, x, y, yShots: g.top + (L.y1 + g.h) / 2 };
}
async function drag(x0, y0, x1, y1, { alt = false, shift = false } = {}) {
  await page.mouse.move(x0, y0);
  if (alt) await page.keyboard.down('Alt');
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.down(); await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 }); await page.mouse.move(x1, y1, { steps: 6 }); await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
  if (shift) await page.keyboard.up('Shift');
  await wait(250);
}
const click = async (x, y) => { await page.mouse.click(x, y); await wait(250); };
const tip = async (x, y) => { await page.mouse.move(x - 3, y); await page.mouse.move(x, y, { steps: 2 }); await wait(400); return ev(() => [...document.querySelectorAll('.k-tip .txt')].map((e) => e.textContent).join(' / ')); };
const onFrame = (t, fm) => Math.abs(t / fm - Math.round(t / fm)) < 0.02;
const shoot = async (name) => { if (!shotsDir) return; mkdirSync(shotsDir, { recursive: true }); const el = await page.$('[data-tl-lane="scenes"]'); await el.screenshot({ path: join(shotsDir, name + '-row.png') }); await page.screenshot({ path: join(shotsDir, name + '-window.png') }); };

async function open(clip) {
  const mine = join(dirname(clip), 'act-' + basename(clip));
  if (mine !== clip) copyFileSync(clip, mine);
  await hookText();
  await ev(() => app.load({}));
  ev((p) => app.project.openVideo(p, { force: true }), mine).catch(() => {});
  ok(await settle(() => app.doc.media && app.player.ready && app.player.vw > 0), `the clip opened (${basename(mine)})`);
  await ev(() => { app.setMode('scenes'); app.player.pause(); app.settings.set('timeline.actMru', []); });
  await wait(600);
}

try {
  await open(src);
  const fm = await ev(() => app.player.frameMs);
  await ev(() => { app.doc.scenes = Array.from({ length: 12 }, (_, i) => ({ start_ms: i * 5000, end_ms: (i + 1) * 5000 })); app.doc.acts = []; app.setView({ start: 0, span: 30000 }); app.player.seek(20000); });
  await wait(500);
  let g = await geo(), n0 = await steps();
  const text0 = await painted();
  ok(['1', '2', '3', '4', '5', '6'].every((s) => text0.includes(s)) && !text0.some((s) => /^\d+\.\d+$/.test(s)), `the shots read 1, 2, 3 ... (${text0.filter((s) => /^\d+(\.\d+)?$/.test(s)).slice(0, 8).join(' ')})`);
  ok(text0.includes('ACTIONS') && text0.includes('SHOTS'), 'the strip names: ACTIONS over SHOTS');
  await shoot('0-empty');

  // 1. a drag across two cuts: one region, frame starts, one undo step
  await drag(g.x(3200), g.y(g.L.main), g.x(12300), g.y(g.L.main));
  let a = await acts();
  ok(a.length === 1 && a[0].layer === 0 && a[0].t0 < 5000 && a[0].t1 > 10000 && onFrame(a[0].t0, fm) && onFrame(a[0].t1, fm), `drawn across two cuts on frame starts: ${desc(a)}`);
  ok((await steps()) === n0 + 1, 'one undo step');
  ok((await painted()).includes('untagged'), 'painted: "untagged" (no recent action yet)');
  const id = a[0].id;

  // 2. its end onto the cut at 15 s (snapped), the video on that frame; its start to a mid-shot frame: the shot's marker
  g = await geo();
  await drag(g.x(a[0].t1) - 1, g.y(g.L.main), g.x(14950), g.y(g.L.main));
  a = await acts();
  ok(a[0].t1 === 15000, `the end snapped onto the cut: ${desc(a)}`);
  // once the release's <video> seek has landed (a long-GOP VP9 clip on a software decoder: up to a second, paw-yhif)
  await page.waitForFunction(() => !app.player.seeking && !app.player.scrubbing, null, { timeout: 5000 }).catch(() => {});
  const tEdge = await ev(() => app.player.timeMs);
  ok(Math.abs(tEdge - 15000) < fm, `the video shows the frame under the dragged edge (${tEdge})`);
  g = await geo();
  await drag(g.x(a[0].t0) + 1, g.y(g.L.main), g.x(7340), g.y(g.L.main));
  a = await acts();
  ok(a[0].t0 > 7000 && a[0].t0 < 7700 && onFrame(a[0].t0, fm), `the start on a mid-shot frame: ${desc(a)}`);
  ok((await steps()) === n0 + 3, 'one undo step each');
  g = await geo();
  const mt = await tip(g.x(a[0].t0), g.yShots);
  ok(/The action changes at .* inside shot 2 \(tracked as one shot.*select an action and press T to track just it, or cut here \(K\)/.test(mt), `the marker on shot 2 tells it (both ways, paw-qoo5): "${mt.slice(0, 200)}"`);
  await shoot('1-region');

  // 3. Alt+drag on it: a secondary region on the layer above; the row grows a band; its mix chip; dragged onto the main line
  const h0 = g.h;
  await drag(g.x(9000), g.y(g.L.main), g.x(12500), g.y(g.L.main), { alt: true });
  await wait(400);
  a = await acts();
  const sec = a.find((r) => r.layer === 1);
  ok(!!sec && sec.t0 > 8800 && sec.t1 < 12700, `Alt+drag: a secondary region above: ${desc(a)}`);
  g = await geo();
  ok(g.h - h0 === 13 && g.L.n === 2, `the row grew a band (${h0} -> ${g.h} px)`);
  const band = g.L.layers[0], bx1 = Math.min(g.x(sec.t1), g.left + g.w);
  await click(bx1 - 2 - MIX_W / 2, g.y(band));
  a = await acts();
  ok(a.find((r) => r.id === sec.id)?.mix === 'layer', `its mix chip: mix -> layer (${a.find((r) => r.id === sec.id)?.mix})`);
  ok((await painted()).includes('layer'), 'painted: the chip says "layer"');
  await shoot('2-secondary');
  const n3 = await steps();
  await drag(g.x((sec.t0 + sec.t1) / 2), g.y(band), g.x((sec.t0 + sec.t1) / 2), g.y(g.L.main));
  a = await acts();
  const down = a.find((r) => r.id === sec.id), up = a.find((r) => r.layer === 1);
  ok(down?.layer === 0 && up && up.t0 === down.t0 && up.t1 === down.t1 && (await steps()) === n3 + 1, `dragged onto the main line: the layers swap in one step: ${desc(a)}`);

  // 4. tagged in place: double-click the main region -> its chips; anal, penetration
  g = await geo();
  const main = a.find((r) => r.layer === 0 && r.id === id);
  await page.mouse.dblclick(g.x((main.t0 + Math.min(main.t1, down.t0)) / 2), g.y(g.L.main));
  await wait(400);
  ok(await ev(() => !!document.querySelector('.k-popover .rc')), 'double-click: the tag chips in place');
  const n4 = await steps();
  await page.locator('.k-popover .rc button', { hasText: /^\s*anal\s*$/i }).first().click();
  await wait(200);
  await page.locator('.k-popover .rc button', { hasText: /^\s*penetration\s*$/i }).first().click();
  await wait(300);
  a = await acts();
  ok(J(a.find((r) => r.id === id)?.tags) === J(['anal', 'penetration']) && (await steps()) === n4 + 2, `tagged: ${desc(a.filter((r) => r.id === id))} (two undo steps)`);
  await page.keyboard.press('Escape'); await wait(250);
  ok((await painted()).some((t) => /^anal pen/.test(t)), 'painted: "anal penetration" (ellipsized when short)');

  // 5. the keyboard path: shot 1 selected on the Shots strip, 1 = the recent action over it
  g = await geo();
  await click(g.x(2500), g.yShots);
  const n5 = await steps();
  await page.keyboard.press('1'); await wait(300);
  a = await acts();
  const k1 = a.find((r) => r.t0 === 0 && r.t1 === 5000);
  ok(k1 && J(k1.tags) === J(['anal', 'penetration']) && (await steps()) === n5 + 1, `1 over the selected shot: ${desc(a.filter((r) => r.t0 === 0))}`);

  // 6. S / M / Delete on the selected region
  g = await geo();
  await click(g.x(1500), g.y(g.L.main));
  await ev(() => app.player.seek(2500)); await wait(200);
  await page.keyboard.press('S'); await wait(250);
  a = await acts();
  ok(a.filter((r) => r.t1 <= 5000).length === 2 && (await steps()) === n5 + 2, `S: split at the playhead: ${desc(a.filter((r) => r.t1 <= 5000))}`);
  await page.keyboard.press('M'); await wait(250);
  a = await acts();
  ok(a.filter((r) => r.t1 <= 5000).length === 1 && (await steps()) === n5 + 3, 'M: merged with the same action');
  await page.keyboard.press('Delete'); await wait(250);
  a = await acts();
  ok(!a.some((r) => r.t1 <= 5000) && (await steps()) === n5 + 4, 'Delete: removed');
  await page.keyboard.press('Control+z'); await wait(250);
  ok((await acts()).some((r) => r.t0 === 0 && r.t1 === 5000), 'Ctrl+Z: back, one step');

  // 7. proposals: shots 10-12 described, their regions removed; propose; click one = accepted; again, the panel's button
  await ev(() => { app.setView({ start: 0, span: 60000 }); app.doc.scenes = app.doc.scenes.map((s, i) => (i >= 9 ? { ...s, describe: { tags: [{ tag: 'fellatio', score: 0.9 }] } } : s)); app.doc.acts = app.doc.acts.filter((r) => r.t1 <= 45000); });
  await wait(300);
  await ev(() => app.commands.run('timeline.acts.propose')); await wait(300);
  a = await acts();
  const prop = a.find((r) => r.auto);
  ok(prop && prop.t0 === 45000 && prop.t1 === 60000, `proposed (dashed): ${desc(a.filter((r) => r.auto))}`);
  ok((await painted()).some((s) => /\?$/.test(s) && /fellatio|oral/.test(s)), 'painted: the proposal with its "?"');
  ok(await ev(() => [...document.querySelectorAll('.scp button')].some((b) => /Accept 1 proposal/.test(b.textContent))), 'the panel offers "Accept 1 proposal"');
  await shoot('3-proposal');
  g = await geo();
  const n7 = await steps();
  await click(g.x(52000), g.y(g.L.main));
  a = await acts();
  ok(!a.some((r) => r.auto) && a.some((r) => r.t0 === 45000) && (await steps()) === n7 + 1, 'one click accepts it (one step)');
  await ev(() => { app.doc.acts = app.doc.acts.filter((r) => r.t0 < 45000); app.commands.run('timeline.acts.propose'); }); await wait(300);
  await page.locator('.scp button', { hasText: /Accept 1 proposal/ }).first().click(); await wait(300);
  a = await acts();
  ok(!a.some((r) => r.auto) && a.some((r) => r.t0 === 45000), 'the panel\'s "Accept 1 proposal" accepts it');

  // 8. the panel: regions and gaps; a row selects its region (the range follows), a click on the strip opens its row
  const rows = await ev(() => ({ acts: document.querySelectorAll('.scp .act').length, gaps: [...document.querySelectorAll('.scp .gap')].map((e) => e.textContent.trim()) }));
  a = await acts();
  ok(rows.acts === a.length && rows.gaps.length >= 1 && rows.gaps.every((t) => /^no action · /.test(t)), `the panel lists ${rows.acts} regions and gaps (${rows.gaps.join(' / ')})`);
  await page.locator('.scp .act .head').nth(1).click(); await wait(300);
  const pick = (await ev(() => document.querySelectorAll('.scp .act')[1]?.dataset.act)), r1 = a.find((r) => r.id === pick), rg = await ev(() => app.doc.range);
  ok(r1 && rg && Math.abs(rg.t0 - r1.t0) < 1, `a panel row selects its region (the range ${J(rg)})`);
  g = await geo();
  const last = a.filter((r) => r.layer === 0).at(-1);
  await click(g.x((last.t0 + last.t1) / 2), g.y(g.L.main));
  ok(await ev((i) => !!document.querySelector(`.scp .act.sel[data-act="${i}"]`), last.id), 'a click on the strip selects its row in the panel');
  await shoot('4-tagged');

  // 9. loops band, cut grips and the filmstrip still there (their own checks run separately); the hover of a cut grip
  const ct = await tip(g.x(5000), g.yShots);
  ok(/Cut at 0:05/.test(ct), `a cut's tooltip: "${ct.slice(0, 80)}"`);

  // 10. paw-2lp7.9: the strip offers exactly one layer more than is in use; an emptied layer closes. Real drags, asserted on
  // the painted row: its height and the band each region's label is painted in.
  await ev(() => {
    window.__fty = [];
    if (window.__ftyHooked) return;
    const o = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t, x, y, ...a) { if (this.canvas?.closest?.('[data-tl-lane]')?.getAttribute('data-tl-lane') === 'scenes') window.__fty.push([String(t), y]); return o.call(this, t, x, y, ...a); };
    window.__ftyHooked = true;
  });
  const AR = (id, t0, t1, layer, tags) => ({ id, kind: 'act', t0, t1, layer, tags, roles: [] });
  const reset = async (list) => { await page.keyboard.press('Escape'); await ev((l) => { app.doc.acts = l; app.setView({ start: 0, span: 30000 }); }, list); await wait(400); };
  /** The painted label starting with `word`: the band (geo().L) its y falls in: 0 = the main line, k = layer k, -1 none. */
  const bandOf = async (word, G) => {
    await ev(() => { window.__fty = []; }); await painted();
    const y = (await ev(() => window.__fty.slice())).filter(([t]) => t.startsWith(word)).at(-1)?.[1];
    if (y == null) return -1;
    if (y >= G.L.main.y0 && y <= G.L.main.y1) return 0;
    const k = G.L.layers.findIndex((b) => y >= b.y0 && y <= b.y1);
    return k >= 0 ? k + 1 : -2;
  };
  const far = (G) => G.top - 140;   // well above the strip (the pointer is captured)
  await reset([AR('m', 0, 10000, 0, ['anal', 'penetration']), AR('o', 15000, 25000, 0, ['handjob'])]);
  g = await geo();
  const hMain = g.h;
  ok(g.L.n === 1, `only the main line in use (row ${hMain} px)`);
  await drag(g.x(20000), g.y(g.L.main), g.x(20000), far(g));
  a = await acts(); g = await geo();
  ok(a.find((r) => r.id === 'o')?.layer === 1 && Math.max(...a.map((r) => r.layer)) === 1, `a far drag with only the main line lands on layer 1: ${desc(a)}`);
  ok(g.h - hMain === 13 && g.L.n === 2, `the row grew by exactly one band (${hMain} -> ${g.h} px)`);
  ok((await bandOf('handjob', g)) === 1, 'painted: "handjob" in the band above the main line');
  await drag(g.x(5000), g.y(g.L.main), g.x(5000), far(g));
  a = await acts(); g = await geo();
  ok(a.find((r) => r.id === 'm')?.layer === 2 && Math.max(...a.map((r) => r.layer)) === 2, `with two layers in use a far drag lands on layer 2: ${desc(a)}`);
  ok(g.h - hMain === 26 && g.L.n === 3, `the row grew by one more band (${g.h} px)`);
  ok((await bandOf('anal', g)) === 2 && (await bandOf('handjob', g)) === 1, 'painted: "anal penetration" on band 2, "handjob" on band 1; the main line left empty, nothing promoted onto it');

  await reset([AR('m', 0, 25000, 0, ['anal', 'penetration']), AR('h', 5000, 10000, 1, ['handjob'])]);
  g = await geo();
  const n10 = await steps(), hOne = g.h;
  await drag(g.x(6500), g.y(g.L.layers[0]), g.x(6500), far(g));
  a = await acts(); g = await geo();
  ok(a.find((r) => r.id === 'h')?.layer === 1 && g.h === hOne && (await steps()) === n10, `the only layer-1 region dragged up stays on layer 1, no step (${desc(a)}; ${g.h} px)`);
  ok((await bandOf('handjob', g)) === 1, 'painted: still on band 1');

  const three = [AR('m', 0, 25000, 0, ['anal', 'penetration']), AR('h', 5000, 10000, 1, ['handjob']), AR('k', 5000, 12000, 2, ['oral', 'licking'])];
  await reset(three);
  g = await geo();
  const before = desc(await acts()), hTwo = g.h, n11 = await steps();
  ok(g.L.n === 3 && (await bandOf('oral', g)) === 2, `two layers: "oral licking" painted on band 2 (row ${hTwo} px)`);
  await click(g.x(6000), g.y(g.L.layers[0]));
  await page.keyboard.press('Delete'); await wait(300);
  a = await acts(); g = await geo();
  ok(!a.some((r) => r.id === 'h') && a.find((r) => r.id === 'k')?.layer === 1 && (await steps()) === n11 + 1, `the middle layer's only region deleted: the one above drops to layer 1 in the same step: ${desc(a)}`);
  ok(hTwo - g.h === 13 && g.L.n === 2 && (await bandOf('oral', g)) === 1, `the row shrank by one band (${hTwo} -> ${g.h} px), "oral licking" painted on band 1`);
  await page.keyboard.press('Control+z'); await wait(300);
  g = await geo();
  ok(desc(await acts()) === before && g.h === hTwo && (await bandOf('oral', g)) === 2, `one undo restores it exactly (${g.h} px)`);
  await shoot('7-layers');

  if (longClip) {   // a 13-minute overview: 60 shots, 12 regions, two of them secondary
    await open(longClip);
    await ev(() => {
      const L = 13000, n = 60, kinds = [['anal', 'penetration'], ['oral', 'penetration'], ['vaginal', 'penetration'], ['handjob'], ['anal', 'licking']];
      app.doc.scenes = Array.from({ length: n }, (_, i) => ({ start_ms: i * L, end_ms: (i + 1) * L }));
      const R = (t0, t1, tags, layer = 0, kind = 'act', x = {}) => ({ kind, t0: t0 * L, t1: t1 * L, layer, tags, ...x });
      app.doc.acts = [R(0, 2, [], 0, 'intro'), R(2, 9, kinds[1]), R(9, 10.4, [], 0, 'positioning'), R(10, 19, kinds[0]), R(14, 16, kinds[3], 1), R(19, 21, [], 0, 'rest'), R(21, 30, kinds[2]),
        R(30, 34.5, kinds[4]), R(36, 45, kinds[0]), R(40, 43, kinds[3], 1, 'act', { mix: 'ignore' }), R(45, 47, []), R(48, 56, kinds[1], 0, 'act', { auto: true }), R(56, 60, [], 0, 'outro')];
      app.setView({ start: 0, span: 60 * L });
    });
    await wait(800);
    const t = await painted();
    ok(t.includes('ACTIONS'), `the 13-minute overview paints (${t.filter((s) => /[a-z]/.test(s)).slice(0, 10).join(' | ')})`);
    await shoot('5-overview13');
    await ev(() => app.setView({ start: 9 * 13000, span: 12 * 13000 }));
    await wait(600);
    await shoot('6-shotzoom');
  }
} catch (e) {
  fails++;
  console.log('FAIL [check]', e?.stack || e);
} finally {
  await browser.close();
}
console.log(fails ? `${fails} failure(s)` : 'all ok');
process.exit(fails ? 1 : 0);
