// dev/groups-dock-check.mjs -- paw-i5qx (was paw-ls54 / paw-trjh) in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it
// prints), on generated clips (ffmpeg: boxes on a dark blue 16:9, a 9:16 one, a bright 16:9 one) and, optionally, a folder of generated
// pictures for the labelling workspace. The Groups tool's controls are one slim translucent bar over the stage's left edge:
//  1. geometry: the bar is one column at most 44 px wide (wrapped on a short stage, ff6b6d3), on the stage, beside the picture
//     (bb2d421): opening the tool leaves the picture where it is when its margins hold the tool's columns, else fits it between
//     them; folding keeps it, closing puts it back; in 16:9 and 9:16, at 1600 x 1000, 1100 x 700 and 900 x 600; no hint line, no
//     tracker dock on the picture; the bar is see-through (its background has alpha) and no "Arm" palette exists;
//  2. real pointer: paint a group, assign it from the picker (A over it, a part on the figure), paint another and make it an ignore
//     region from the picker; the groups popover lists them, its trash deletes one; the unassigned line opens in place;
//  3. a stroke that starts on the picture and runs off its left edge under the bar: it paints up to the edge, the bar fades and
//     lets the pointer through;
//  4. off the seed frame the notes card opens by itself with "Go there", which seeks back;
//  5. screenshots: groupsbar-open / -popover / -painting / -tall / -bright (+ -picker, -notes, -1100, -900, label-1600).
//   node dev/groups-dock-check.mjs <wide.mp4> <tall.mp4> <bright.mp4> <out dir> [<picture folder>]
import { connectTestApp } from './cdp-connect.mjs';
import { mkdirSync } from 'node:fs';
const [wide, tall, bright, out, pics] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { browser: b, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
const cdp = await page.context().newCDPSession(page);
const mouse = (type, x, y, extra = {}) => cdp.send('Input.dispatchMouseEvent', { type, x, y, ...extra });
async function resize(w, h) {
  try {
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: w, height: h } });
  } catch (e) {
    await ev(([w, h]) => window.__TAURI_INTERNALS__?.invoke('plugin:window|set_size', { label: 'main', value: { Logical: { width: w, height: h } } }), [w, h]).catch(() => {});
  }
  await wait(900);
  return ev(() => [innerWidth, innerHeight]);
}
const G_ = () => ev(() => { const G = __pawDev.groupsFor(app); return { n: G.groups.length, names: G.groups.map((g) => g.name), on: G.on }; });
// the boxes that matter, client px: the picture as painted (video box clipped to the stage), the bar, any hint line, the tracker dock
const boxes = (stageSel = '[data-testid="video-stage"]', picSel = 'video') => ev(([stageSel, picSel]) => {
  const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; };
  const st = R(document.querySelector(stageSel)), v = R(document.querySelector(stageSel + ' ' + picSel));
  const pic = st && v ? (() => { const x0 = Math.max(st.x, v.x), y0 = Math.max(st.y, v.y), x1 = Math.min(st.x + st.w, v.x + v.w), y1 = Math.min(st.y + st.h, v.y + v.h); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; })() : null;
  const tips = [...document.querySelectorAll(stageSel + ' .tip')].map(R).filter(Boolean);
  const tdock = [...document.querySelectorAll('.tdock')].map(R).filter(Boolean);
  return { st, pic, bar: R(document.querySelector('[data-testid="groups-tools"]')), tips, tdock, win: [innerWidth, innerHeight] };
}, [stageSel, picSel]);
const overlap = (a, c) => !!a && !!c && a.x < c.x + c.w - 0.5 && c.x < a.x + a.w - 0.5 && a.y < c.y + c.h - 0.5 && c.y < a.y + a.h - 0.5;
const same = (a, c) => !!a && !!c && ['x', 'y', 'w', 'h'].every((k) => Math.abs(a[k] - c[k]) < 1);
const fmt = (r) => r ? [r.x, r.y, r.w, r.h].map(Math.round).join(',') : 'none';
// ff6b6d3 (paw-q3ad): a stage shorter than the bar's one column wraps it into a second / third column (its first one then as
// tall as the stage), never a scroll;
// bb2d421 (paw-8ehz): on the VIDEO stage the bar takes a column beside the picture (nothing of it over the picture); on other
// stages (labelling) it still lies over the picture's edge, translucent
function geometry(B, tag, onVideo = true) {
  const col = !!B.bar && (B.bar.w <= 44 || (B.bar.h >= B.st.h - 32 && B.bar.h <= B.st.h + 1));
  ok(!!B.pic && col && (!onVideo || !overlap(B.bar, B.pic)), `${tag}: bar ${B.bar ? Math.round(B.bar.w) + ' x ' + Math.round(B.bar.h) : 'missing'} px (stage ${Math.round(B.st?.h)} tall)${onVideo ? ', beside' : ', over the edge of'} the picture ${fmt(B.pic)}`);
  ok(!B.tips.some((t) => overlap(t, B.pic)), `${tag}: no hint line on the picture`);
  ok(!B.tdock.some((t) => overlap(t, B.pic)), `${tag}: no tracker dock on the picture`);
}
const inside = (a, s) => !!a && !!s && a.x >= s.x - 0.5 && a.y >= s.y - 0.5 && a.x + a.w <= s.x + s.w + 0.5 && a.y + a.h <= s.y + s.h + 0.5;
/** The picture's rect with the tool closed, open, folded, open, closed again. bb2d421 (paw-8ehz; guide step 8 no longer says
 *  "the picture never moves"): when the picture's own margins hold the bar's column and the right column (groups-room.js: the
 *  bar + 4 px at the left, 180 px at the right) it stays put (the paw-trjh guarantee); otherwise it is fitted between the
 *  columns (a stage too narrow even so folds the side docks while the tool is open). Either way: inside the stage, folding the
 *  bar keeps it where it is, closing the tool puts it back exactly. */
async function staysPut(tag) {
  await ev(() => __pawDev.groupsFor(app).toggle(false)); await wait(400);
  const B0 = await boxes(), p0 = B0.pic;
  await ev(() => __pawDev.groupsFor(app).toggle(true)); await wait(500);
  const B = await boxes(), p1 = B.pic;
  await page.click('[data-testid="groups-collapse"]'); await wait(300);
  const p2 = (await boxes()).pic, folded = (await boxes()).bar;
  await page.click('[data-testid="groups-collapse"]'); await wait(300);
  await ev(() => __pawDev.groupsFor(app).toggle(false)); await wait(400);
  const p3 = (await boxes()).pic;
  await ev(() => __pawDev.groupsFor(app).toggle(true)); await wait(500);
  const roomy = !!(p0 && B0.st && B.bar) && p0.x - B0.st.x >= B.bar.w + 4 && B0.st.x + B0.st.w - (p0.x + p0.w) >= 180;
  ok((roomy ? same(p0, p1) : inside(p1, B.st)) && same(p1, p2) && same(p0, p3),
    `${tag}: ${roomy ? 'margins hold both columns: the picture stays put' : 'the picture fitted beside the columns, inside the stage'}, folding keeps it, closing puts it back (${fmt(p0)} / open ${fmt(p1)} / folded ${fmt(p2)} / closed ${fmt(p3)}; folded bar ${fmt(folded)})`);
  geometry(B, tag);
  return B;
}
const clipOf = async (tag, sel = '[data-testid="video-stage"]', pad = 0) => {
  const c = await ev(([sel, pad]) => { const s = document.querySelector(sel).getBoundingClientRect(); const extra = [...document.querySelectorAll('.k-popover.gpop:popover-open, [data-testid="groups-picker"]')].map((e) => e.getBoundingClientRect()); const r = Math.max(s.right, ...extra.map((e) => e.right)), bt = Math.max(s.bottom, ...extra.map((e) => e.bottom)); return { x: s.x, y: s.y, width: r - s.x + pad, height: bt - s.y + pad }; }, [sel, pad]);
  await page.screenshot({ path: `${out}/${tag}.png`, clip: c });
};
async function openClip(clip) {
  await ev(async () => { for (const c of (await app.backend.autosaveList()) || []) await app.backend.autosaveClear(c.id); });
  const p = ev((p) => app.project.openVideo(p, { force: true }), clip);
  for (let k = 0; k < 8; k++) { await wait(500); await ev(() => { const d = app.dialog; if (d) d.resolve(/^Recover/.test(d.title || '') ? 'discard' : /^Replace/.test(d.title || '') ? 'replace' : /Save changes/.test(d.title || '') ? 'discard' : d.choices?.[0]?.id ?? null); }); }
  await p.catch(() => {});
  await page.waitForFunction((p) => app.doc.media && app.doc.media.path === p && app.player.ready && app.player.vw > 0, clip, { timeout: 60000 }).catch(() => {});
  ok(await ev((p) => app.doc.media?.path === p, clip), 'opened ' + clip.split(/[\\/]/).pop());
  await ev(() => { app.setMode('track'); app.doc.scenes = [{ start_ms: 0, end_ms: 4900 }]; app.player.pause(); app.player.seek(1000, { exact: true }); });
  await wait(1200);
  await ev(() => { for (const [k, v] of [['snap', false], ['circle', false], ['grow', false], ['askAfter', false], ['collapsed', false], ['brush', 0.03]]) app.settings.set('tracking.groups.' + k, v); });
  await ev(() => { const G = __pawDev.groupsFor(app); if (!G.on) app.commands.run('tracking.groups'); }); await wait(600);
}
const V = () => ev(() => { const r = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(), s = document.querySelector('[data-testid="video-stage"]').getBoundingClientRect(); const x = Math.max(r.x, s.x), y = Math.max(r.y, s.y); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: x, cy: y }; });
/** A real stroke through frame points (client px from the video box); hold: called mid-stroke (pointer down). */
async function stroke(pts, { mods = 0, hold = null } = {}) {
  const r = await V(), px = ([nx, ny]) => [r.x + nx * r.w, r.y + ny * r.h], [x0, y0] = px(pts[0]);
  await mouse('mouseMoved', x0, y0, { modifiers: mods });
  await mouse('mousePressed', x0, y0, { button: 'left', buttons: 1, clickCount: 1, modifiers: mods });
  let held = null;
  for (const [i, q] of pts.slice(1).entries()) { const [x, y] = px(q); await mouse('mouseMoved', x, y, { button: 'left', buttons: 1, modifiers: mods }); await wait(14); if (hold && i === pts.length - 3) held = await hold(); }
  const [x1, y1] = px(pts.at(-1));
  await mouse('mouseReleased', x1, y1, { button: 'left', buttons: 0, clickCount: 1, modifiers: mods });
  await page.waitForFunction(() => !__pawDev.groupsFor(app).draft, null, { timeout: 8000 }).catch(() => {});
  await wait(250);
  return held;
}
const line = (a, c, n = 14) => Array.from({ length: n + 1 }, (_, k) => [a[0] + ((c[0] - a[0]) * k) / n, a[1] + ((c[1] - a[1]) * k) / n]);
const center = async (k) => ev((k) => { const g = __pawDev.groupsFor(app).groups[k], v = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(); const xs = g.poly.map((q) => q[0]), ys = g.poly.map((q) => q[1]); return [v.x + (Math.min(...xs) + Math.max(...xs)) / 2 * v.width, v.y + (Math.min(...ys) + Math.max(...ys)) / 2 * v.height]; }, k);

try {
  await page.waitForFunction(() => window.app?.commands && window.__pawDev?.groupsFor, null, { timeout: 120000 });
  console.log('window', await resize(1600, 1000));
  await openClip(wide);
  ok(await ev(() => { const d = document.querySelector('[data-testid="groups-tools"]'), s = document.querySelector('[data-testid="video-stage"]'); return s.contains(d) && getComputedStyle(d).position === 'absolute'; }), 'the bar sits on the stage, over its left edge, taking no room');
  const look = await ev(() => { const cs = getComputedStyle(document.querySelector('[data-testid="groups-tools"]')); return { bg: cs.backgroundColor, blur: cs.backdropFilter }; });
  ok(/rgba\(.*,\s*0?\.\d+\)|color\(srgb .* \/ 0?\.\d+\)/.test(look.bg), `the bar is see-through: ${look.bg} ${look.blur}`);
  const noArm = await ev(() => {
    const palette = document.querySelector('[data-testid="groups-parts"], [data-testid="groups-ignore"]');
    const armish = [...document.querySelectorAll('[data-testid="groups-tools"] *')].filter((e) => /^\s*Arm\s*$/.test(e.textContent) || /\barm\b/i.test(e.getAttribute('aria-label') || ''));
    return !palette && !armish.length;
  });
  ok(noArm, 'no Arm palette, no arm control in the DOM');
  let B = await staysPut('16:9 at 1600x1000');
  await clipOf('groupsbar-open');

  // 2. paint, assign from the picker, ignore from the picker, delete from the list
  await stroke(line([0.40, 0.45], [0.46, 0.52]));
  await stroke(line([0.66, 0.40], [0.72, 0.48]));
  await stroke(line([0.20, 0.70], [0.25, 0.74]));
  let st = await G_();
  ok(st.n === 3 && st.names.every((n) => /^unassigned_/.test(n)), `three strokes: three unassigned groups (${st.names.join(', ')})`);
  await page.mouse.move(...await center(0)); await wait(150); await page.keyboard.press('a');
  await page.waitForSelector('[data-testid="groups-picker"]', { timeout: 5000 }); await wait(300);
  await clipOf('groupsbar-picker');
  await page.click('[data-testid="groups-picker"] g[data-drop-part="hips"] .hit'); await wait(400);
  st = await G_();
  ok(/^c1_hips/.test(st.names[0]), `the picker assigned it: ${st.names[0]}`);
  await page.mouse.move(...await center(1)); await wait(150); await page.keyboard.press('a');
  await page.waitForSelector('[data-testid="groups-pick-ignore"]', { timeout: 5000 }); await wait(200);
  await page.click('[data-testid="groups-pick-ignore"]'); await wait(400);
  st = await G_();
  ok(st.names[1] === 'ignore' && !(await ev(() => !!document.querySelector('[data-testid="groups-picker"]'))), `the picker's ignore made it an ignore region (${st.names[1]}), the picker closed`);
  await page.click('[data-testid="groups-list-open"]'); await wait(400);
  const rows = await ev(() => [...document.querySelectorAll('[data-testid="groups-list"] .grp')].map((e) => e.querySelector('.nm').textContent.trim()));
  const unl = await ev(() => document.querySelector('[data-testid="groups-unassigned"]')?.textContent.trim() || '');
  ok(rows.length === 2 && /1\s*unassigned/.test(unl), `the groups popover lists ${rows.join(', ')} + "${unl}"`);
  await page.click('[data-testid="groups-unassigned-toggle"]'); await wait(200);
  ok(await ev(() => document.querySelectorAll('[data-testid="groups-list"] .grp').length) === 3, 'the unassigned line opens in place');
  const pop = await ev(() => { const p = document.querySelector('.k-popover.gpop:popover-open'), r = p.getBoundingClientRect(), bar = document.querySelector('[data-testid="groups-tools"]').getBoundingClientRect(), cs = getComputedStyle(p); return { x: r.x, w: r.width, barR: bar.right, bg: cs.backgroundColor }; });
  ok(pop.x >= pop.barR - 2 && pop.w < 300, `the popover opens beside the bar (x ${Math.round(pop.x)}, bar right ${Math.round(pop.barR)}, ${Math.round(pop.w)} px wide, ${pop.bg})`);
  // hovering a row lights its group on the video
  await clipOf('groupsbar-popover');
  await page.click('[data-testid="groups-list"] .grp[data-k="2"] [data-testid="groups-delete"]'); await wait(400);
  st = await G_();
  ok(st.n === 2 && !st.names.some((n) => /^unassigned_/.test(n)), `the row's trash deleted the unassigned one (${st.names.join(', ')})`);
  ok(await ev(() => !!document.querySelector('.k-popover.gpop:popover-open')), 'the popover stays open for the next one');
  // a press on the picture (painting) closes it
  await stroke(line([0.55, 0.75], [0.58, 0.78], 4));
  ok(await ev(() => !document.querySelector('.k-popover.gpop:popover-open')), 'painting closes the popover');
  await ev(() => { const G = __pawDev.groupsFor(app); const k = G.groups.findIndex((g) => /^unassigned_/.test(g.name)); if (k >= 0) G.remove(k); });

  // 3. a stroke from the picture running off its edge under the bar: the bar fades and lets the pointer through. bb2d421
  // (paw-8ehz): on the video stage the bar sits beside the picture, so what it lies over is the margin, not the picture
  B = await boxes();
  const v = await V(), bar = B.bar;
  const ny = (bar.y + bar.h * 0.45 - v.y) / v.h, nxIn = (bar.x + bar.w + 30 - v.x) / v.w, nxUnder = (bar.x + bar.w - 8 - v.x) / v.w;
  ok(bar.x + bar.w <= B.pic.x + 0.5 && nxIn > 0 && nxUnder < 0, `the bar lies beside the picture (bar right ${Math.round(bar.x + bar.w)}, picture left ${Math.round(B.pic.x)})`);
  const held = await stroke(line([nxIn, ny], [nxUnder, ny], 16), { hold: async () => {
    await clipOf('groupsbar-painting');
    return ev(() => { const d = document.querySelector('[data-testid="groups-tools"]'), cs = getComputedStyle(d); return { op: +cs.opacity, pe: cs.pointerEvents, draft: !!__pawDev.groupsFor(app).draft }; });
  } });
  ok(held && held.draft && held.op < 0.3 && held.pe === 'none', `mid-stroke under the bar: opacity ${held?.op}, pointer-events ${held?.pe}, stroke live ${held?.draft}`);
  const under = await ev(([nx, ny]) => { const G = __pawDev.groupsFor(app), g = G.groups.at(-1), m = G.maskFor(g); return { name: g.name, a: m.a[Math.floor(ny * m.h) * m.w + Math.floor(nx * m.w)] }; }, [0.004, ny]);
  ok(under.a >= 0.5, `the stroke kept painting to the picture's edge on its way under the bar (${under.name} at x 0.004: ${under.a?.toFixed(2)})`);
  ok(await ev(() => +getComputedStyle(document.querySelector('[data-testid="groups-tools"]')).opacity) > 0.9, 'after the stroke the bar is back');

  // 4. off the seed frame: the notes card opens by itself; Go there seeks back
  await ev(() => app.player.seek(2600, { exact: true })); await wait(800);
  ok(await ev(() => !!document.querySelector('[data-testid="groups-notes-card"] [data-testid="groups-goto-seed"]')), 'off the seed frame: the notes card is up by itself with "Go there"');
  await clipOf('groupsbar-notes');
  await page.click('[data-testid="groups-notes-card"] [data-testid="groups-goto-seed"]'); await wait(800);
  ok(await ev(() => Math.abs(app.player.timeMs - 1000) < 40 && __pawDev.groupsFor(app).groups.length > 0), 'one click seeks back to the seed frame');
  ok(await ev(() => !document.querySelector('[data-testid="groups-notes-card"]')), 'back on it: the card closed itself');

  // the key list behind the (i)
  await page.mouse.move(5, 5); await wait(500);
  const ib = await ev(() => { const r = document.querySelector('[data-testid="groups-keys"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await page.mouse.move(...ib); await wait(250); await page.mouse.move(ib[0] + 1, ib[1]); await wait(900);
  const tip = await ev(() => { const t = document.getElementById('k-tip'); return t?.matches(':popover-open') ? t.textContent : ''; });
  ok(/Shift erases/.test(tip) && /Alt\+click picks/.test(tip) && tip.split('\n').length >= 10, `the (i) hover is the key list (${tip.split('\n').length} lines)`);
  await page.mouse.move(5, 5); await wait(300);

  // smaller windows
  for (const [w, h] of [[1100, 700], [900, 600]]) {
    console.log('window', await resize(w, h));
    B = await staysPut(`16:9 at ${w}x${h}`);
    B = await boxes();
    ok(await ev(() => { const d = document.querySelector('[data-testid="groups-tools"]'); return d.scrollWidth <= d.clientWidth + 1; }), `${w}x${h}: no sideways overflow in the bar (${Math.round(B.bar.h)} px tall, stage ${Math.round(B.st.h)})`);
    await clipOf(`groupsbar-${w}`);
  }
  console.log('window', await resize(1600, 1000));
  // a bright picture: is the bar still readable over it
  await ev(() => __pawDev.groupsFor(app).toggle(false)); await wait(300);
  await openClip(bright);
  await stroke(line([0.30, 0.4], [0.36, 0.5]));
  await page.click('[data-testid="groups-list-open"]'); await wait(300);
  await clipOf('groupsbar-bright');
  await page.keyboard.press('Escape'); await wait(200);
  // 9:16: a wide stage, letterboxed sides
  await ev(() => __pawDev.groupsFor(app).toggle(false)); await wait(300);
  await openClip(tall);
  B = await boxes();
  ok(B.pic && B.pic.w < B.st.w - 50, `9:16: letterboxed (picture ${Math.round(B.pic?.w)} of ${Math.round(B.st?.w)} wide)`);
  B = await staysPut('9:16 at 1600x1000');
  await stroke(line([0.4, 0.3], [0.5, 0.35]));
  await clipOf('groupsbar-tall');
  for (const [w, h] of [[1100, 700], [900, 600]]) { console.log('window', await resize(w, h)); await staysPut(`9:16 at ${w}x${h}`); }
  console.log('window', await resize(1600, 1000));
  await ev(() => __pawDev.groupsFor(app).toggle(false)); await wait(300);
  ok(await ev(() => !document.querySelector('[data-testid="groups-tools"]')), 'tool off: the bar is gone');
  ok(await ev(() => !document.querySelector('[data-testid="video-stage"] .gtools, [data-testid="video-stage"] .gdock')), 'tool off: nothing left on the stage');
  // the labelling workspace (generated pictures)
  if (pics) {
    await ev((f) => app.commands.run('labelling.open', { folder: f }), pics);
    await page.waitForFunction(() => app.labelling?.on && app.labelling.ready, null, { timeout: 30000 });
    await wait(800);
    ok(await ev(() => app.labelling.G.on && !!document.querySelector('[data-testid="label-stage"] [data-testid="groups-tools"]')), 'labelling: the same bar is up on its stage');
    B = await boxes('[data-testid="label-stage"]', 'canvas.pic'); geometry(B, 'labelling', false);
    ok(await ev(() => !document.querySelector('[data-testid="groups-seeder"]') && !document.querySelector('[data-testid="groups-copy-open"]')), 'labelling: no seeder / Copy from on the bar');
    // 7e73c91 (paw-k393): the knot brush (K) labels the knot in the image painter too
    ok(await ev(() => !!document.querySelector('[data-testid="label-stage"] [data-testid="groups-knot"]')), 'labelling: the knot brush is on the bar');
    await clipOf('label-1600', '[data-testid="label-stage"]');
    await ev(() => app.labelling.leave()); await wait(500);
  }
} catch (e) {
  fails++; console.log('FAIL [threw]', String(e?.stack || e).slice(0, 600));
} finally { await b.close().catch(() => {}); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
