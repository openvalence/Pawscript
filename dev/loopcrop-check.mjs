// dev/loopcrop-check.mjs -- paw-0zwb (loops matched as whole cycles, anywhere in the video) in YOUR test instance (node
// dev/test-app.mjs start ...; the CDP_* env it prints), on a generated clip of twelve 5 s shots (the fake sidecar cuts every 5 s):
//   CLIP_SHOT_S=5 python experiments/cropscene/make_loopclips.py raw.mp4 A F0 F1 F2 F3 F4 F5 F6 F7 F8 F9 A18
//   ffmpeg -i raw.mp4 -c:v libx264 -g 1 -pix_fmt yuv420p clip.mp4
// = a 12-frame loop in shot 1, ten unrelated looping shots (F2: another 12-frame loop), the same loop cropped x1.8 at phase +3 in
// shot 12.
//   1. prepare: Detect -> after the background pass ONE loop link (via 'loops'), shot 1 <-> shot 12, x1.8, shift 3, spot checks;
//      both shots show a HOLLOW chain (painted: fewer pixels than the solid one the same link draws without `via`), the same loop
//      colour on the Shots strip, the tip "same loop as shot 1, this one re-framed ×1.8: matched on all 12 frames, N spot checks
//      ok"; Track shot 1 (fake box tracker) -> shot 12 is offered from shot 1 through the far link (the fake tracker's passes
//      differ, so the guard holds it back: not for the link), "Fill this shot from its linked shot" fills it ("cropped ×1.8"),
//      painted on the Tracker lane; saved: the project holds the loopLinks block.
//   2. (restart the app with the same --id) check: opened again: the link is there and shot 12's derived run with it, no loop
//      pair matched again (no 'loops:cropPair' usage note), painted.
//   node dev/loopcrop-check.mjs prepare|check <clip.mp4> <out dir>
import { readFileSync, mkdirSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';

const [phase, clip, out] = process.argv.slice(2);
if (!['prepare', 'check'].includes(phase) || !clip || !out) { console.error('usage: node dev/loopcrop-check.mjs prepare|check <clip.mp4> <out dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const proj = clip.replace(/\.[^.]+$/, '.pawproj');
const { browser, page } = await connectTestApp();
if (process.argv.includes('--reload')) { await page.reload(); await page.waitForFunction(() => window.app?.project && window.__pawDev?.trackingFor, null, { timeout: 60000 }); }
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); return c; };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /changed outside/.test(t) ? 'project' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null); });
const settle = async (pred, n = 60) => { for (let k = 0; k < n; k++) { await answer(); if (await ev(pred).catch(() => false)) return true; await wait(500); } return false; };
const T12 = [55000, 60000];
const farLinks = () => ev(() => window.__pawDev.trackingFor(app).shotLinks.links.filter((l) => l.via === 'loops').map((l) => ({ a: l.a.start_ms, b: l.b.start_ms, scale: +l.scale.toFixed(2), tighter: l.tighter, frames: l.frames, checks: l.checks, weak: !!l.weak, loops: l.loops.map((p) => ({ shift: p.shift, n: p.periodA, score: +p.score.toFixed(3), margin: +p.margin.toFixed(3) })) })));
const fill = () => ev(() => { const tr = window.__pawDev.trackingFor(app), r = tr.runs.find((x) => x.derived); return r ? { id: r.id, from: r.derived.from, what: r.derived.what, name: r.name, color: r.color, pts: r.points.at.length, start: r.range.start } : null; });
const paint = () => ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
async function lanePixels(lane) {
  await paint();
  const r = await ev((lane) => { const e = document.querySelector(`[data-tl-lane="${lane}"]`).getBoundingClientRect(); return { x: e.left, y: e.top, w: e.width, h: e.height }; }, lane);
  const png = (await page.screenshot({ clip: { x: r.x, y: r.y, width: r.w, height: r.h }, scale: 'css' })).toString('base64');
  const data = await ev(async (png) => { const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + png)).blob()); const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d'); x.drawImage(bmp, 0, 0); return { w: bmp.width, h: bmp.height, d: Array.from(x.getImageData(0, 0, bmp.width, bmp.height).data) }; }, png);
  return { ...r, w: data.w, h: data.h, at: (x, y) => { const i = (Math.round(y) * data.w + Math.round(x)) * 4; return data.d.slice(i, i + 3); } };
}
const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
/** The chain on shot [t0, ...)'s label row ly: the first column (within 90 px of the shot's start) where painting P differs
 *  from Q (the same row without links), and the pixels that differ in the glyph's box there. -> {n, x, y} */
function chainAt(P, Q, t0, ly) {
  const s = Math.max(0, Math.floor((t0 / 60000) * P.w)), d = (x, y) => dist(P.at(x, y), Q.at(x, y)) > 60;
  let x0 = -1;
  for (let x = s + 2; x < s + 90 && x0 < 0; x++) for (let y = ly - 3; y <= ly + 3; y++) if (d(x, y)) { x0 = x; break; }
  if (x0 < 0) return { n: 0, x: -1, y: -1 };
  let n = 0;
  for (let y = ly - 5; y <= ly + 5; y++) for (let x = x0 - 1; x < x0 + 13; x++) if (d(x, y)) n++;
  return { n, x: x0 + 5, y: ly };
}
const hue = ([r, g, b]) => { const M = Math.max(r, g, b), m = Math.min(r, g, b), q = M - m || 1; const h = M === r ? ((g - b) / q) % 6 : M === g ? (b - r) / q + 2 : (r - g) / q + 4; return (h * 60 + 360) % 360; };
const hueDiff = (a, b) => { const x = Math.abs(hue(a) - hue(b)) % 360; return Math.min(x, 360 - x); };
const trackerPixels = async (t0, t1, c, tol = 90) => { await paint(); return ev(({ t0, t1, c, tol }) => { const cv = document.querySelector('canvas[aria-label="Tracker signals"]'), w = cv.width, h = cv.height, v = app.view; const x0 = Math.max(0, Math.round(((t0 - v.start) / v.span) * w)), x1 = Math.min(w, Math.round(((t1 - v.start) / v.span) * w)); const img = cv.getContext('2d').getImageData(x0, 0, Math.max(1, x1 - x0), h).data; const cols = new Set(); let n = 0; for (let i = 0; i < img.length; i += 4) if (Math.abs(img[i] - c[0]) + Math.abs(img[i + 1] - c[1]) + Math.abs(img[i + 2] - c[2]) <= tol && img[i + 3] > 0) { n++; cols.add((i / 4) % (x1 - x0)); } return { n, cols: cols.size, width: x1 - x0 }; }, { t0, t1, c, tol }); };
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

try {
  await page.setViewportSize({ width: 1600, height: 1000 });
  if (phase === 'prepare') {
    await ev(() => app.load({}));
    ev((p) => app.project.openVideo(p, { force: true }), clip).catch(() => {});
    ok(await settle(() => app.doc.media && app.player.ready && app.player.vw > 0), 'the clip opened');
    await ev(() => { app.setMode('scenes'); app.player.pause(); app.setView({ start: 0, span: 60000 }); });
    const det = await ev(async () => { const r = await window.__pawDev.trackingFor(app).detectScenes(); return { error: r?.error ?? null, n: app.doc.scenes.length }; });
    ok(det.n === 12, `Detect: twelve shots ${JSON.stringify(det)}`);
    ok(await settle(() => (app.doc.loops || []).filter((l) => l.auto).length >= 2, 120), `the repeats marked the loops (${await ev(() => (app.doc.loops || []).filter((l) => l.auto).length)})`);
    const t0 = Date.now();
    ok(await settle(() => window.__pawDev.trackingFor(app).shotLinks.links.some((l) => l.via === 'loops'), 360), `the background pass found a loop link (${((Date.now() - t0) / 1000).toFixed(0)} s after the loops)`);
    await wait(3000);
    const L = await farLinks();
    console.log(JSON.stringify(L));
    const k = L[0];
    ok(L.length === 1 && k.a === 0 && k.b === 55000 && Math.abs(k.scale - 1.8) < 0.08 && k.tighter === 'b' && !k.weak, 'ONE loop link: shot 1 <-> shot 12 (11 shots apart), x1.8, shot 12 the crop, not weak (F2, the other 12-frame loop, not linked)');
    ok(k?.loops[0]?.shift === 3 && k.loops[0].n === 12 && k.frames === 12, `shift 3 (shot 12's first frame shows shot 1's frame 3 of its cycle), 12 frames (${JSON.stringify(k?.loops)})`);
    ok(k?.checks?.n >= 10 && k.checks.ok >= 0.8 * k.checks.n, `spot checks of the later passes: ${k?.checks?.ok} / ${k?.checks?.n}`);
    // painted: the chains (with the links vs with them taken away) and hollow vs solid
    const SC0 = await lanePixels('scenes');
    const H = SC0.h, sh = Math.max(12, Math.round(H * 0.58)), y1 = sh + 1, bh = Math.max(5, Math.min(8, Math.round((H - y1) * 0.32))), ly0 = y1 + 2 + bh, by = y1 + 2 + Math.floor(bh / 2);
    await ev(() => { const tr = window.__pawDev.trackingFor(app); window.__keep = tr.shotLinks; tr.shotLinks = { links: [], inserts: tr.shotLinks.inserts }; });
    await wait(400);
    const SCoff = await lanePixels('scenes');
    await ev(() => { const tr = window.__pawDev.trackingFor(app); tr.shotLinks = { links: window.__keep.links.map((l) => ({ ...l, via: undefined })), inserts: window.__keep.inserts }; });
    await wait(400);
    const SCsolid = await lanePixels('scenes');
    await ev(() => { window.__pawDev.trackingFor(app).shotLinks = window.__keep; });
    await wait(400);
    const SC = await lanePixels('scenes');
    const ly = Math.round((ly0 + H) / 2);
    const c1 = chainAt(SC, SCoff, 0, ly), c12 = chainAt(SC, SCoff, T12[0], ly), s1 = chainAt(SCsolid, SCoff, 0, ly), s12 = chainAt(SCsolid, SCoff, T12[0], ly);
    ok(c1.n >= 6 && c12.n >= 6, `a chain painted on shot 1 and shot 12 (${c1.n} / ${c12.n} px)`);
    ok(s1.n > c1.n * 1.15 && s12.n > c12.n * 1.15, `hollow: fewer pixels than the solid chain the same link draws (${c1.n} vs ${s1.n}, ${c12.n} vs ${s12.n})`);
    const mid = (t) => Math.round((t / 60000) * SC.w);
    const colA = SC.at(mid(0) + 3, by), colB = SC.at(mid(55000) + 3, by), offA = SCoff.at(mid(0) + 3, by), offB = SCoff.at(mid(55000) + 3, by);
    ok(hueDiff(colA, colB) < 12 && Math.max(...colB) - Math.min(...colB) > 60, `the same loop colour on both shots' loop bands (${colA} / ${colB}; without the link ${offA} / ${offB})`);
    const box = await ev(() => { const e = document.querySelector('[data-tl-lane="scenes"]').getBoundingClientRect(); return { x: e.left, y: e.top }; });
    await page.mouse.move(box.x + c12.x, box.y + c12.y); await wait(400);
    const tip = await ev(() => document.querySelector('.k-tip .txt')?.textContent || '');
    ok(/same loop as shot 1, this one re-framed ×1\.8: matched on all 12 frames, \d+ spot checks ok/i.test(tip), `shot 12's tip: "${tip.slice(0, 140)}"`);
    await page.mouse.move(box.x + c1.x, box.y + c1.y); await wait(400);
    const tip1 = await ev(() => document.querySelector('.k-tip .txt')?.textContent || '');
    ok(/same loop as shot 12, re-framed ×1\.8/i.test(tip1), `shot 1's tip: "${tip1.slice(0, 140)}"`);
    await page.screenshot({ path: `${out}/1-chains.png` });
    // Track shot 1 -> shot 12 fills
    await ev(() => { app.setMode('track'); app.player.pause(); app.setView({ start: 0, span: 60000 }); });
    const tracked = await ev(async () => {
      const tr = window.__pawDev.trackingFor(app);
      for (let k = 0; k < 40 && !tr.trackers.length; k++) await new Promise((r) => setTimeout(r, 250));
      tr.selectTracker('fake.box'); tr.roi = { kind: 'box', x: 0.3, y: 0.3, w: 0.3, h: 0.3, t_ms: 100 };
      const s = app.doc.scenes[0], r = await tr.trackRange({ tracker: 'fake.box', range: { t0: s.start_ms, t1: s.end_ms }, roi: tr.roi, params: tr.params, scenes: 'document' });
      return r?.run?.id || r?.error || 'none';
    });
    ok(/^run\d+$/.test(tracked), `shot 1 tracked (${tracked})`);
    // the fake box tracker's signal does not repeat with the loop: the guard holds the fill back as an offer (its reason is
    // the source's passes, not the link); "Fill this shot from its linked shot" takes it, as the owner would
    let off = null;
    for (let k = 0; k < 40 && !off; k++) { off = await ev(() => window.__pawDev.trackingFor(app).fillOffers.find((o) => o.i === 11) || null); if (!off) await wait(500); }
    ok(off?.j === 0 && !/weak/.test(off.why), `shot 12 offered from shot 1 through the far link (${JSON.stringify(off)})`);
    await ev(() => { app.player.seek(56000); window.__pawDev.tl.scene = 11; app.commands.run('tracking.fillFromLink'); });
    let F = null;
    for (let k = 0; k < 60 && !F; k++) { F = await fill(); if (!F) await wait(500); }
    ok(F && F.from === tracked && F.start >= T12[0] && /cropped ×1\.8/.test(F.what) && /looped from shot 1$/.test(F.name), `shot 12 filled through the far link: "${F?.name} · ${F?.what}" (${F?.pts} points)`);
    if (F) { await wait(500); const px = await trackerPixels(...T12, rgb(F.color)); ok(px.cols > px.width * 0.5, `painted on the Tracker lane over shot 12 (${px.n} px over ${px.cols} of ${px.width} columns)`); }
    await page.screenshot({ path: `${out}/2-filled.png` });
    await ev(() => app.project.save()).catch((e) => console.log('save:', e?.message));
    ok(await settle(() => !!app.doc.project?.path, 30), 'saved');
    const pj = JSON.parse(readFileSync(proj, 'utf8')), blk = pj.loopLinks ?? pj.extra?.loopLinks;
    ok(blk?.v === 1 && blk.pairs?.length === 1 && blk.done?.length >= 2, `the project holds the loop links (${blk?.pairs?.length} pair, ${blk?.done?.length} loops compared)`);
  } else {
    await ev(() => { window.__notes = []; const u = app.usage; if (u && !u.__hooked) { const o = u.note.bind(u); u.note = (n, ...a) => { window.__notes.push(n); return o(n, ...a); }; u.__hooked = true; } });
    const t0 = Date.now();
    ev((f) => app.project.openProject(f, { force: true }), proj).catch(() => {});
    ok(await settle(() => app.doc.project?.path && app.doc.scenes.length === 12 && app.player.ready), `opened ${proj}`);
    ok(await settle(() => window.__pawDev.trackingFor(app).shotLinks.links.some((l) => l.via === 'loops'), 40), `the loop link is there on load (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    await ev(() => { app.setMode('track'); app.player.pause(); app.setView({ start: 0, span: 60000 }); });
    let F = null;
    for (let k = 0; k < 80 && !F; k++) { F = await fill(); if (!F) await wait(500); }
    ok(F && /cropped ×1\.8/.test(F.what), `shot 12's derived run is there (${F?.name} · ${F?.what}, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    if (F) { await wait(500); const px = await trackerPixels(...T12, rgb(F.color)); ok(px.cols > px.width * 0.5, `painted on the Tracker lane over shot 12 (${px.cols} of ${px.width} columns)`); }
    await wait(25000);   // the neighbour pass and the loop pass run again meanwhile
    const L = await farLinks(), notes = await ev(() => window.__notes);
    ok(L.length === 1 && L[0].b === 55000, `still one loop link after the background passes (${L.length})`);
    ok(!notes.includes('loops:cropPair'), `no loop pair matched again (${notes.filter((n) => n.startsWith('loops')).join(', ') || 'no loop notes'})`);
    await page.screenshot({ path: `${out}/3-reopened.png` });
  }
} catch (e) { fails++; console.log('FAIL', e?.stack || e); }
console.log(fails ? `${fails} FAILED` : 'all ok');
await browser.close();
process.exit(fails ? 1 : 0);
