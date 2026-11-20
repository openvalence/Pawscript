// dev/linkfill-check.mjs -- paw-ef73.33 (linked shots fill each other) in YOUR test instance (node dev/test-app.mjs start ...; the
// CDP_* env it prints), on a loop clip (every picture only its id):
//   node dev/make-loop-clip.mjs <dir>/loopfill.mp4 --secs 14 --segs '60:20:100:100;300:20:90:100'
// = a 20-picture loop 5 passes from frame 60 (shot 1 = frames 0-150), unique pictures (shot 2 = 150-300), the same loop 4.5
// passes from frame 300 (shot 3 = 300-420, its last pass cut short). Shots are set by the check.
//   1. prepare: Track shot 1 (the fake box tracker) -> shot 3 gets its derived run by itself: the toast, its link, painted dashed on
//      the Tracker lane with its label band, its ghost painted in the script lane over shot 3; flip shot 1 -> shot 3's run follows
//      (its trace mirrored on the lane); shot 3 plays live (paw-x7w7), Shift+B bakes it (points in the stroke lane), undone; the Runs list's Detach /
//      Dismiss each one undo step (painted / not painted), "Fill this shot from its linked shot" brings a dismissed one back;
//      saved: the ghost keeps the link (source.derived, no channels), the .pawruns has no copy of it.
//   2. (restart the app with the same --id) check: opened again: the derived run is there (from the source, not the file),
//      painted on the Tracker lane, linked to shot 3.
// Every page exception and console error fails it. Screenshots in <out dir>.
//   node dev/linkfill-check.mjs prepare|check <clip.mp4> <out dir>
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';
import { decodeRuns } from '../src/lib/runs-file.js';

const [phase, clip, out] = process.argv.slice(2);
if (!['prepare', 'check'].includes(phase) || !clip || !out) { console.error('usage: node dev/linkfill-check.mjs prepare|check <clip.mp4> <out dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const proj = clip.replace(/\.[^.]+$/, '.pawproj'), runsFile = clip.replace(/\.[^.]+$/, '.pawruns');
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); return c; };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /changed outside/.test(t) ? 'project' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null); });
const settle = async (pred, n = 60) => { for (let k = 0; k < n; k++) { await answer(); if (await ev(pred).catch(() => false)) return true; await wait(500); } return false; };
/** settle on a predicate run here (it may call ev itself). */
const until = async (pred, n = 40) => { for (let k = 0; k < n; k++) { if (await pred().catch(() => false)) return true; await wait(500); } return false; };
const FM = 1000 / 30, ms = (f) => Math.round(f * FM), SH = [[0, 150], [150, 300], [300, 420]];
// (every tab's app: `app` is the shown tab's, and a clip opened beside a document gets a tab of its own since f19f112)
const hook = (reset = true) => ev((reset) => { if (reset || !window.__toasts) window.__toasts = []; for (const a of new Set([...(window.appTabs?.apps || []), app])) if (!a.__toastHooked) { const o = a.toast.bind(a); a.toast = (m, ...x) => { window.__toasts.push(String(m)); return o(m, ...x); }; a.__toastHooked = true; } }, reset);
const fill = () => ev(() => { const tr = window.__pawDev.trackingFor(app), r = tr.runs.find((x) => x.derived); return r ? { id: r.id, from: r.derived.from, live: tr.isLiveFill(r), name: r.name, what: r.derived.what, color: r.color, pts: Array.from(r.points.pos), at: Array.from(r.points.at), ghost: !!tr.ghost(r.id), link: tr.sceneLink(2)?.runId || '' } : null; });
const flag = () => ev(() => app.doc.scenes[2]?.linkfill ?? null);
const paint = () => ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** Pixels of the Tracker lane canvas over [t0, t1) near colour c (sum of |dRGB| <= tol). */
async function trackerPixels(t0, t1, c, tol = 90) {
  await paint();
  return ev(({ t0, t1, c, tol }) => {
    const cv = document.querySelector('canvas[aria-label="Tracker signals"]'), d = window.devicePixelRatio || 1, w = cv.width, h = cv.height, v = app.view;
    const x0 = Math.max(0, Math.round(((t0 - v.start) / v.span) * w)), x1 = Math.min(w, Math.round(((t1 - v.start) / v.span) * w));
    const img = cv.getContext('2d').getImageData(x0, 0, Math.max(1, x1 - x0), h).data;
    let n = 0, sig = 0; const cols = new Set();
    for (let i = 0; i < img.length; i += 4) if (Math.abs(img[i] - c[0]) + Math.abs(img[i + 1] - c[1]) + Math.abs(img[i + 2] - c[2]) <= tol && img[i + 3] > 0) { n++; cols.add(((i / 4) % (x1 - x0))); }
    return { n, cols: cols.size, width: x1 - x0, d, sig };
  }, { t0, t1, c, tol });
}
/** A hash of the Tracker lane's pixels over [t0, t1) (a repaint changed what is there). */
const trackerHash = (t0, t1) => paint().then(() => ev(({ t0, t1 }) => { const cv = document.querySelector('canvas[aria-label="Tracker signals"]'), v = app.view, w = cv.width; const x0 = Math.max(0, Math.round(((t0 - v.start) / v.span) * w)), x1 = Math.min(w, Math.round(((t1 - v.start) / v.span) * w)); const img = cv.getContext('2d').getImageData(x0, 0, x1 - x0, cv.height).data; let h = 0; for (let i = 0; i < img.length; i += 7) h = (h * 31 + img[i]) | 0; return h; }, { t0, t1 }));
/** Pixels near colour c in the stroke lane's row over [t0, t1) (a screenshot: what is on screen). */
async function strokePixels(t0, t1, c) {
  await paint();
  const r = await ev(({ t0, t1 }) => { const row = document.querySelector('.gutter[data-axis=stroke]')?.closest('.lrow'), g = row?.querySelector('.gutter')?.getBoundingClientRect(), b = row?.getBoundingClientRect(); if (!b) return null; const L = g ? g.right : b.left, W = b.right - L, v = app.view; const x0 = L + ((t0 - v.start) / v.span) * W, x1 = L + ((t1 - v.start) / v.span) * W; return { x: Math.max(L, x0), y: b.top + 2, w: Math.max(2, Math.min(b.right, x1) - Math.max(L, x0)), h: b.height - 4 }; }, { t0, t1 });
  if (!r) return { n: -1 };
  const png = (await page.screenshot({ clip: { x: r.x, y: r.y, width: r.w, height: r.h }, scale: 'css' })).toString('base64');
  return ev(async ({ png, c, tol }) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + png)).blob()), cv = new OffscreenCanvas(bmp.width, bmp.height), x = cv.getContext('2d'); x.drawImage(bmp, 0, 0);
    const d = x.getImageData(0, 0, bmp.width, bmp.height).data; let n = 0;
    // the ghost's hue (thin anti-aliased dashes), not its exact colour
    const hsv = (r, g, b) => { const M = Math.max(r, g, b), m = Math.min(r, g, b), q = M - m || 1; const h = M === r ? ((g - b) / q) % 6 : M === g ? (b - r) / q + 2 : (r - g) / q + 4; return [(h * 60 + 360) % 360, M ? (M - m) / M : 0, M]; };
    const hc = hsv(...c)[0];
    for (let i = 0; i < d.length; i += 4) { const [h, sat, v] = hsv(d[i], d[i + 1], d[i + 2]), dh = Math.min(Math.abs(h - hc), 360 - Math.abs(h - hc)); if (dh < 20 && sat > 0.35 && v > 90) n++; }
    return { n };
  }, { png, c });
}
const T3 = [ms(300), ms(420)], T2 = [ms(150), ms(300)];

try {
  await page.setViewportSize({ width: 1600, height: 1000 });
  if (phase === 'prepare') {
    await hook();
    await ev(() => app.load({}));
    ev((p) => app.project.openVideo(p, { force: true }), clip).catch(() => {});
    ok(await settle(() => app.doc.media && app.player.ready && app.player.vw > 0), 'the clip opened');
    await hook(false);   // the clip's own tab (another app when a document was open already)
    ok(await settle(() => (app.doc.loops || []).filter((l) => l.auto).length >= 2, 120), 'the repeats marked the loop in shots 1 and 3');
    await ev(({ SH, FM }) => {
      app.transact('Shots (check)', () => { app.doc.scenes = SH.map(([a, b], i) => ({ start_ms: Math.round(a * FM), end_ms: Math.round(b * FM), ...(i ? { join: false } : {}) })); });
      app.setMode('track'); app.player.pause(); app.setView({ start: 0, span: Math.round(420 * FM) });
    }, { SH, FM });
    await wait(500);
    const before = await trackerHash(...T3);
    // Track shot 1 (fake box tracker)
    const tracked = await ev(async () => {
      const tr = window.__pawDev.trackingFor(app);
      await tr.list?.().catch?.(() => {});
      for (let k = 0; k < 40 && !tr.trackers.length; k++) await new Promise((r) => setTimeout(r, 250));
      tr.selectTracker('fake.box'); tr.roi = { kind: 'box', x: 0.3, y: 0.3, w: 0.3, h: 0.3, t_ms: 100 };
      const s = app.doc.scenes[0], r = await tr.trackRange({ tracker: 'fake.box', range: { t0: s.start_ms, t1: s.end_ms }, roi: tr.roi, params: tr.params, scenes: 'document' });
      return r?.run?.id || r?.error || 'none';
    });
    ok(/^run\d+$/.test(tracked), `shot 1 tracked (${tracked})`);
    ok(await until(async () => !!(await fill())?.ghost), 'shot 3 got its derived run by itself');
    let F = await fill();
    console.log(JSON.stringify({ ...F, pts: F?.pts.length, at: undefined }));
    ok(F && F.from === tracked && F.live && F.link === F.id, `derived from ${F?.from}, following, linked to shot 3 (${F?.link})`);
    ok(F && /^looped from shot 1$/.test(F.name) && /passes · exact repeats/.test(F.what), `named "${F?.name} · ${F?.what}"`);
    ok(F && F.at.length >= 6 && F.at.every((t) => t >= T3[0] && t < T3[1]), `its points sit in shot 3 (${F?.at.length})`);
    ok((await ev(() => window.__toasts)).some((t) => /^Shot 3 filled from shot 1/.test(t)), `one toast: ${(await ev(() => window.__toasts)).filter((t) => /filled/.test(t)).join(' | ')}`);
    await wait(400);
    const lane3 = await trackerPixels(...T3, rgb(F.color)), lane2 = await trackerPixels(...T2, rgb(F.color));
    ok(lane3.cols > lane3.width * 0.5 && lane2.n < lane3.n / 10, `the Tracker lane paints it over shot 3 (${lane3.n} px over ${lane3.cols} of ${lane3.width} columns; shot 2: ${lane2.n})`);
    ok((await trackerHash(...T3)) !== before, 'the Tracker lane over shot 3 changed');
    const sk3 = await strokePixels(...T3, rgb(F.color)), sk2 = await strokePixels(...T2, rgb(F.color));
    ok(sk3.n > 30 && sk2.n < sk3.n / 5, `its ghost is painted in the script lane over shot 3 (${sk3.n} px; shot 2: ${sk2.n})`);
    await page.screenshot({ path: `${out}/1-filled.png` });
    // follows the source: flip shot 1
    const h0 = await trackerHash(...T3), p0 = F.pts;
    await ev(() => { const tr = window.__pawDev.trackingFor(app), s = tr.runs.find((r) => !r.derived && !r.tag); tr.select(s.id); tr.flipScene(0); });
    ok(await until(async () => { const f = await fill(); return f && f.pts.join() !== p0.join(); }), 'flip shot 1 -> shot 3\'s points follow');
    F = await fill();
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    ok(Math.abs(mean(p0) + mean(F.pts) - 100) < 15, `mirrored (mean ${mean(p0).toFixed(1)} -> ${mean(F.pts).toFixed(1)})`);
    ok((await trackerHash(...T3)) !== h0, 'the Tracker lane over shot 3 repainted');
    await page.screenshot({ path: `${out}/2-flipped.png` });
    // shot 3 is live; Shift+B bakes it (paw-uzlr: the fill takes its shot's range since 49002c8)
    await ev((t) => { const tr = window.__pawDev.trackingFor(app); tr.select(tr.runs.find((r) => r.derived).id); app.player.seek(t); document.activeElement?.blur?.(); }, ms(330));
    await wait(300);
    ok((await ev((T3) => (app.liveOf?.('stroke')?.script || []).filter((p) => p.at >= T3[0] && p.at < T3[1]).length, T3)) >= 6, 'shot 3 plays live');
    await page.keyboard.press('Shift+B');
    await wait(500);
    const acc = await ev((T3) => (app.doc.axes.stroke || []).filter((p) => p.at >= T3[0] && p.at < T3[1]).length, T3);
    ok(acc >= 6, `Shift+B baked shot 3's points into the script (${acc})`);
    const ink = await ev(() => getComputedStyle(document.documentElement).getPropertyValue('--axis-stroke').trim() || '#4DA6FF');
    console.log('stroke ink', ink);
    await page.screenshot({ path: `${out}/3-baked.png` });
    await page.keyboard.press('Control+Z'); await wait(400);
    ok((await ev((T3) => (app.doc.axes.stroke || []).filter((p) => p.at >= T3[0] && p.at < T3[1]).length, T3)) === 0, 'undone');
    // Detach (the Runs list) / undo
    await ev(() => app.showPanel?.('tracking'));
    await ev((t) => { const tr = window.__pawDev.trackingFor(app); tr.select(''); app.player.seek(t); window.__pawDev.tl.scene = 2; }, ms(330));   // the Runs list shows the runs over the current shot
    await wait(300);
    const det = page.locator('button[aria-label^="Detach"]').first();
    ok(await det.count() > 0, 'the Runs list shows Detach on the derived run');
    const steps0 = await ev(() => app._history.index);
    await det.click(); await wait(500);
    ok((await flag()) === 'detached' && !(await fill())?.live, 'Detach: the shot\'s run is an independent copy');
    ok((await ev(() => app._history.index)) === steps0 + 1, `one undo step (${steps0} -> ${await ev(() => app._history.index)})`);
    await page.screenshot({ path: `${out}/4-detached.png` });
    await page.keyboard.press('Control+Z'); await wait(600);
    ok((await flag()) === null && (await fill())?.live, 'undo: following again');
    // Dismiss / undo / refill
    const dis = page.locator('button[aria-label^="Dismiss"]').first();
    ok(await dis.count() > 0, 'the Runs list shows Dismiss (×) on the derived run');
    await dis.click(); await wait(600);
    ok((await flag()) === 'off' && !(await fill()), 'Dismiss: the run is gone, the shot flagged');
    const gone = await trackerPixels(...T3, rgb(F.color));
    ok(gone.n < lane3.n / 10, `nothing painted over shot 3 any more (${gone.n} px)`);
    await page.keyboard.press('Control+Z'); await wait(600);
    ok((await flag()) === null && !!(await fill()), 'undo: back');
    await dis.click().catch(() => page.locator('button[aria-label^="Dismiss"]').first().click()); await wait(600);
    await ev((t) => { app.player.seek(t); window.__pawDev.tl.scene = 2; }, ms(330));
    await ev(() => app.commands.run('tracking.fillFromLink')); await wait(600);
    ok((await flag()) === 'on' && !!(await fill()), '"Fill this shot from its linked shot" brings it back (one undo step)');
    await page.keyboard.press('Control+Z'); await wait(300); await page.keyboard.press('Control+Z'); await wait(600);
    ok((await flag()) === null && !!(await fill()), 'two undos: automatic again');
    // save
    await ev(() => app.project.save()).catch((e) => console.log('save:', e?.message));
    ok(await settle(() => !app.doc.dirty && !!app.doc.project?.path, 20), 'saved');
    const pj = JSON.parse(readFileSync(proj, 'utf8')), g = (pj.ghosts || []).find((x) => String(x.id).startsWith('fill-'));
    ok(g && g.source?.derived?.from === tracked && !g.source.keep && g.script?.length >= 6, `the ghost keeps the link, no channels (${JSON.stringify(g?.source?.derived)})`);
    // (its runs: the file's live records. The project is written about a second after every change (0cef84c), so the detached
    // copy above was written as a run, and a copy-on-write runs file keeps a dropped record's bytes until a compaction (e44c326):
    // the bytes are not a run of the file, paw-lups)
    const ids = existsSync(runsFile) ? decodeRuns(new Uint8Array(readFileSync(runsFile))).map((r) => r.id) : null;
    ok(ids && !ids.some((id) => String(id).startsWith('fill-')), `the .pawruns holds no copy of the derived run (its runs: ${ids?.join(', ')})`);
  } else {
    await hook();
    ev((f) => app.project.openProject(f, { force: true }), proj).catch(() => {});
    ok(await settle(() => app.doc.project?.path && app.doc.scenes.length === 3 && app.player.ready), `opened ${proj}`);
    await hook(false);   // its tab's app, before its runs file is read and its fills come back
    await ev(() => { app.setMode('track'); app.player.pause(); app.setView({ start: 0, span: Math.round(420 * (1000 / 30)) }); });
    ok(await until(async () => !!(await fill())?.ghost, 120), 'after a restart: the derived run is there');
    const F = await fill();
    ok(F && F.live && F.link === F.id && /^run\d+$/.test(F.from), `following ${F?.from}, linked to shot 3`);
    await wait(500);
    const lane3 = await trackerPixels(...T3, rgb(F.color));
    ok(lane3.cols > lane3.width * 0.5, `painted on the Tracker lane over shot 3 (${lane3.n} px over ${lane3.cols} of ${lane3.width} columns)`);
    // FAILS at 49002c8: the fill is announced again on reopening (paw-3xif)
    ok(!(await ev(() => window.__toasts)).some((t) => /filled from/.test(t)), 'no toast on reopening (nothing new)');
    await page.screenshot({ path: `${out}/5-reopened.png` });
  }
} catch (e) { fails++; console.log('FAIL', e?.stack || e); }
console.log(fails ? `${fails} FAILED` : 'all ok');
await browser.close();
process.exit(fails ? 1 : 0);
