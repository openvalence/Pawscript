// dev/groups-copy-crop-check.mjs -- paw-d2d5: Copy from... onto a re-framed shot, in YOUR test instance (node dev/test-app.mjs
// start ...; the CDP_* env it prints). A generated clip of three 5 s shots (the fake sidecar cuts every 5 s): A (a flat
// world, two characters at 0.42,0.55 and 0.62,0.60), an unrelated insert, A cropped x2 at (0.22, 0.30) (make it with --make).
// After Detect the crop link arrives (tracking shotLinks). Asserts on what is painted and on the strip:
//  1. shot A painted: c1_hips and c2_hips on the two characters, c1_tail in the top-left corner (outside the crop);
//  2. on shot 3, C: shot A's painted frame is a tile with a "linked ×2.0" tag (paw-trxk; "similar picture" before the links); with the links taken away it has none, and it
//     gets it back when they return, without reopening the strip;
//  3. hover: the outlines are painted ON the characters at the crop's scale (centres at 0.40,0.50 and 0.80,0.60, about 4x
//     the area), the corner part left out and the strip says "2 of 3 parts are in this framing";
//  4. click: copied as proposals (copy kind) in one undo step, the toast names the crop and the count; Ctrl+Z takes it back;
//  5. the other way: a part painted on shot 3, C on shot A: the tile has the tag, the hover draws it shrunk at 0.42,0.55.
//   node dev/groups-copy-crop-check.mjs --make <clip.mp4>
//   node dev/groups-copy-crop-check.mjs <clip.mp4> <out dir> [--reload]
import { mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
if (process.argv[2] === '--make') {
  const out = process.argv[3], tmp = out + '.mp4v.mp4';
  const py = spawnSync('trackers/.venv/Scripts/python.exe', ['-I', 'experiments/cropscene/make_clips.py', tmp, 'A', 'I', 'A2'], { stdio: 'inherit', windowsHide: true, env: { ...process.env, CLIP_SHOT_S: '5' } });
  if (py.status) process.exit(py.status);
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', tmp, '-c:v', 'libx264', '-g', '1', '-pix_fmt', 'yuv420p', '-threads', '4', out], { stdio: 'inherit', windowsHide: true });
  rmSync(tmp, { force: true });
  process.exit(r.status);
}
const { connectTestApp } = await import('./cdp-connect.mjs');
const [clip, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { browser: b, page } = await connectTestApp();
if (process.argv.includes('--reload')) {   // a dist rebuilt from a scratch copy after start
  await page.reload();
  await page.waitForFunction(() => window.app?.project && window.__pawDev?.trackingFor, null, { timeout: 60000 });
}
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
const near = (p, q, tol) => p && Math.abs(p[0] - q[0]) <= tol && Math.abs(p[1] - q[1]) <= tol;
try {
  await ev(async (p) => {
    clearInterval(window.__noRecover);
    window.__noRecover = setInterval(() => { if (app.dialog) app.dialog.resolve('discard'); }, 150);
    await app.project.openVideo(p, { force: true });
    window.__tr = window.__pawDev.trackingFor(app);
  }, clip);
  await page.waitForFunction(() => app.doc.media && app.player.ready && app.player.vw > 0, null, { timeout: 60000 });
  await page.waitForFunction(() => window.__pawDev?.groupsFor, null, { timeout: 30000 });
  await ev(() => { app.setMode('scenes'); app.player.pause(); });
  const det = await ev(async () => { const r = await __tr.detectScenes(); return { error: r?.error ?? null, cuts: app.doc.scenes.map((s) => s.start_ms) }; });
  ok(det.cuts.join() === '0,5000,10000', `Detect: three shots ${JSON.stringify(det)}`);
  await page.waitForFunction(() => __tr.shotLinks.links.length > 0, null, { timeout: 180000, polling: 500 });
  const L = await ev(() => __tr.shotLinks.links.map((l) => ({ a: l.a.start_ms, b: l.b.start_ms, scale: +l.scale.toFixed(2), tighter: l.tighter, box: l.box })));
  ok(L.length === 1 && L[0].a === 0 && L[0].b === 10000 && Math.abs(L[0].scale - 2) < 0.1 && L[0].tighter === 'b', 'the crop link: shot 3 = shot 1 x2 ' + JSON.stringify(L));
  await ev(() => { for (const [k, v] of Object.entries({ autoFromRepeats: false, brush: 0.03, grow: false, snap: false, circle: false, askAfter: false, corner: 'tl', compact: true })) app.settings.set('tracking.groups.' + k, v); });
  await ev(() => { app.setMode('track'); app.player.pause(); app.player.seek(2500, { exact: true }); });
  await wait(1500);
  await ev(() => { const G = __pawDev.groupsFor(app); if (!G.on) app.commands.run('tracking.groups'); }); await wait(600);
  ok(await ev(() => !!document.querySelector('[data-testid="groups-tools"]')), 'Groups tool is on');
  const box = await ev(() => { const r = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const at = (nx, ny) => [box.x + nx * box.w, box.y + ny * box.h];
  const scribble = async (cx, cy, rx, ry) => { await page.mouse.move(...at(cx - rx, cy)); await page.mouse.down(); for (let k = 0; k <= 12; k++) await page.mouse.move(...at(cx - rx + (2 * rx * k) / 12, cy + (k % 2 ? ry : -ry))); await page.mouse.up(); await wait(300); };
  const shot = (tag) => page.screenshot({ path: `${out}/${tag}.png`, clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
  /** Painted overlay pixels (alpha > 20) within r (0..1 of the picture's height) of a picture point. */
  const paintNear = (pts, r) => ev(([bx, pts, r]) => {
    const cv = document.querySelector('canvas.ov'), cr = cv.getBoundingClientRect(), k = cv.width / cr.width, d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const n = pts.map(() => 0);
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] <= 20) continue;
      const p = (i - 3) / 4, x = ((p % cv.width) / k + cr.x - bx.x) / bx.w, y = (Math.floor(p / cv.width) / k + cr.y - bx.y) / bx.h;
      pts.forEach(([px, py], j) => { if (Math.hypot((x - px) * bx.w, (y - py) * bx.h) <= r * bx.h) n[j]++; });
    }
    return n;
  }, [box, pts, r]);
  /** Hover the tile until the strip says so (a pointer already moving can miss the first enter). */
  const hoverTile = async (t) => {
    for (let k = 0; k < 3; k++) {
      await page.mouse.move(t.x, t.y - 200); await wait(150); await page.mouse.move(t.x, t.y);
      if (await page.waitForFunction(() => !!__pawDev.groupsFor(app).copy?.hover, null, { timeout: 2000 }).then(() => true, () => false)) break;
      console.log('     (hover not seen yet, again)');
    }
    await wait(800);
  };
  // ---- 1. shot A painted ----
  await scribble(0.42, 0.55, 0.025, 0.06);   // character 1's body
  await scribble(0.62, 0.6, 0.025, 0.05);    // character 2's body
  await scribble(0.08, 0.12, 0.03, 0.04);    // the top-left corner: outside the crop
  await ev(() => { const G = __pawDev.groupsFor(app); G.assign(0, { who: 'c1', part: 'hips' }); G.assign(1, { who: 'c2', part: 'hips' }); G.assign(2, { who: 'c1', part: 'tail' }); });
  await wait(300);
  const painted = await ev(() => __pawDev.groupsFor(app).groups.map((g) => g.name).sort().join());
  ok(painted === 'c1_hips,c1_tail,c2_hips', 'shot A: three parts painted ' + painted);
  await shot('1-painted');
  // ---- 2. shot 3 (the x2 crop), C ----
  await ev(() => app.player.seek(12500, { exact: true })); await wait(1200);
  ok(await ev(() => __pawDev.groupsFor(app).groups.length) === 0, 'shot 3 has no groups');
  await ev(() => { window.__links = __tr.shotLinks; __tr.shotLinks = { links: [], inserts: [] }; });   // as before the links arrive
  await page.mouse.move(...at(0.5, 0.05));
  await page.keyboard.press('c');
  await page.waitForFunction(() => { const c = __pawDev.groupsFor(app).copy; return c && !c.busy; }, null, { timeout: 30000 }).catch(() => {});
  const tiles = () => ev(() => [...document.querySelectorAll('[data-testid="groups-copy-item"]')].map((e) => ({ kind: e.dataset.kind, crop: e.querySelector('[data-testid="groups-copy-crop"]')?.textContent || '', text: e.textContent.replace(/\s+/g, ' ').trim() })));
  const t0 = await tiles();
  ok(t0.length === 1 && t0[0].kind === 'painted' && t0[0].crop === 'similar picture', 'without the links: shot A\'s painted frame, offered as a similar picture ' + JSON.stringify(t0));
  await ev(() => { __tr.shotLinks = window.__links; }); await wait(800);
  const t1 = await tiles();
  ok(t1.length === 1 && /^(linked|same loop) ×2\.0$/.test(t1[0].crop), 'the links arrive: the same strip (not reopened) tags the tile "linked ×2.0" (paw-trxk: was "crop ×2.0") ' + JSON.stringify(t1));
  console.log('     search:', JSON.stringify(await ev(() => __pawDev.groupsFor(app).copyStats)));
  await shot('2-strip');
  // ---- 3. hover: on the characters, at the crop's scale; the corner left out ----
  const tileBox = await ev(() => { const r = document.querySelector('[data-testid="groups-copy-item"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const before = await paintNear([[0.4, 0.5], [0.8, 0.6]], 0.05);
  await hoverTile(tileBox);
  const pv = await ev(() => { const G = __pawDev.groupsFor(app), p = G.copyPreview, src = G.copy.items[0].groups;
    const c = (poly) => poly.reduce((s, q) => [s[0] + q[0] / poly.length, s[1] + q[1] / poly.length], [0, 0]);
    const area = (poly) => Math.abs(poly.reduce((s, [x, y], i) => { const [u, v] = poly[(i + 1) % poly.length]; return s + x * v - u * y; }, 0)) / 2;
    return { lost: p?.lost, of: p?.of, re: G.copy.re, groups: (p || []).map((g) => ({ name: g.name, c: c(g.poly), k: area(g.poly) / area(src.find((s) => s.name === g.name).poly) })) }; });
  const g1 = pv.groups.find((g) => g.name === 'c1_hips'), g2 = pv.groups.find((g) => g.name === 'c2_hips');
  ok(pv.groups.length === 2 && pv.lost === 1 && pv.of === 3 && !pv.groups.some((g) => g.name === 'c1_tail'), 'hover: two parts copied, the corner part left out ' + JSON.stringify(pv.groups.map((g) => g.name)));
  ok(near(g1?.c, [0.4, 0.5], 0.05) && near(g2?.c, [0.8, 0.6], 0.05), `on the characters at the crop's place: c1 ${g1?.c.map((v) => v.toFixed(3))} (want 0.40,0.50), c2 ${g2?.c.map((v) => v.toFixed(3))} (want 0.80,0.60)`);
  ok(g1 && g1.k > 3 && g1.k < 5, `at the crop's scale: ${g1?.k.toFixed(2)} x the painted area (x2 crop: 4)`);
  let hov = await paintNear([[0.4, 0.5], [0.8, 0.6]], 0.05);
  for (let k = 0; k < 25 && !(hov[0] > before[0] + 300 && hov[1] > before[1] + 300); k++) { await wait(200); hov = await paintNear([[0.4, 0.5], [0.8, 0.6]], 0.05); }   // the peek paints once the scrubbed frame is up
  ok(hov[0] > before[0] + 300 && hov[1] > before[1] + 300, `painted on the characters: ${before} px before the hover, ${hov} during`);
  const hint = await ev(() => document.querySelector('[data-testid="groups-copy-fit"]')?.textContent || '');
  const moved = await ev(() => { const r = document.querySelector('[data-testid="groups-copy-item"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  ok(Math.abs(moved.x - tileBox.x) < 1 && Math.abs(moved.y - tileBox.y) < 1, `the tile stays under the pointer while the strip says it (${JSON.stringify(tileBox)} -> ${JSON.stringify(moved)})`);
  ok(/2 of 3 parts are in this framing/.test(hint), 'the strip says how many are in this framing: ' + hint);
  await shot('3-hover');
  // ---- 4. click: proposals, one undo step ----
  const h0 = await ev(() => app._history.entries.length);
  await page.mouse.click(tileBox.x, tileBox.y);
  await page.waitForFunction(() => { const G = __pawDev.groupsFor(app); return !G.busy && !G.copyWait && G.groups.length > 0; }, null, { timeout: 30000 }).catch(() => {});
  await wait(500);
  const gs = await ev(() => __pawDev.groupsFor(app).groups.map((g) => ({ name: g.name, source: g.source, lined: g.lined, un: !!g.unconfirmed })));
  ok(gs.length === 2 && gs.every((g) => g.source === 'repeat'), 'copied as proposals (copy kind): ' + JSON.stringify(gs));
  ok((await ev(() => app._history.entries.length)) === h0 + 1, 'one undo step');
  const toast = await ev(() => document.body.innerText.match(/Copied 2 groups[^\n]*/)?.[0] || '');
  ok(/re-framed: (same loop, )?crop ×2\.0/.test(toast) && /2 of 3 parts are in this framing/.test(toast), 'the toast: ' + toast.slice(0, 200));
  await shot('4-copied');
  await page.keyboard.press('Control+z'); await wait(400);
  ok((await ev(() => __pawDev.groupsFor(app).groups.length)) === 0, 'Ctrl+Z: the copy is gone in one step');
  // ---- 5. the other way: shot 3 painted, copied onto shot A ----
  await scribble(0.4, 0.5, 0.04, 0.1);
  await ev(() => { const G = __pawDev.groupsFor(app); G.assign(0, { who: 'c1', part: 'hips' }); });
  await wait(300);
  await ev(() => app.player.seek(2500, { exact: true })); await wait(1200);
  await page.mouse.move(...at(0.5, 0.05));
  await page.keyboard.press('c');
  await page.waitForFunction(() => { const c = __pawDev.groupsFor(app).copy; return c && !c.busy; }, null, { timeout: 30000 }).catch(() => {});
  const t2 = await tiles();
  ok(t2.length === 1 && /^(linked|same loop) ×2\.0$/.test(t2[0].crop), 'on shot A: shot 3\'s painted frame, tagged ' + JSON.stringify(t2));
  const tb2 = await ev(() => { const r = document.querySelector('[data-testid="groups-copy-item"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await hoverTile(tb2);
  const pv2 = await ev(() => (__pawDev.groupsFor(app).copyPreview || []).map((g) => ({ name: g.name, c: g.poly.reduce((s, q) => [s[0] + q[0] / g.poly.length, s[1] + q[1] / g.poly.length], [0, 0]) })));
  ok(pv2.length === 1 && near(pv2[0].c, [0.42, 0.55], 0.04), 'hover: shrunk back onto character 1 at 0.42,0.55: ' + JSON.stringify(pv2));
  await shot('5-reverse');
  await page.keyboard.press('Escape'); await wait(300);
  ok(!(await ev(() => !!document.querySelector('[data-testid="groups-copy"]'))), 'Esc closes the strip');
} finally { await b.close(); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
