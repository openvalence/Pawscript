// dev/crop-scene-check.mjs -- paw-3uyu: a crop of an earlier shot is that shot's footage continuing, the shot between
// is off-screen (the action going on unseen, paw-2lp7.4). In YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints) on a generated clip of
// three 5 s shots (the fake sidecar cuts every 5 s): A, an unrelated insert, A cropped x1.6 at another loop phase
//   CLIP_SHOT_S=5 python experiments/cropscene/make_clips.py clip.mp4 A I A16   (then H.264: ffmpeg -c:v libx264)
// After Detect: the crop link (tracking shotLinks), the dashed "off-screen?" card on the insert (paw-2lp7.4: the action goes on unseen) and the offer badge on the
// third shot's boundary are painted (asserted against the same row with the proposals taken away), the badge's hover
// reads "Same footage as shot 1 · crop ×1.6"; clicking the card makes one scene with the insert off-screen in one undo
// step, clicking the badge joins the three shots in one undo step.
//   node dev/crop-scene-check.mjs <clip.mp4>
import { connectTestApp } from './cdp-connect.mjs';

const clip = process.argv[2];
const { browser: b, page } = await connectTestApp();
if (process.argv.includes('--reload')) {   // a dist rebuilt from a scratch copy after start
  await page.reload();
  await page.waitForFunction(() => window.app?.project && window.__pawDev?.trackingFor, null, { timeout: 60000 });
}
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => console.log('[pageerror]', String(e.message).slice(0, 300)));
try {
  await ev(async (p) => {
    clearInterval(window.__noRecover);
    window.__noRecover = setInterval(() => { if (app.dialog) app.dialog.resolve('discard'); }, 150);
    await app.project.openVideo(p, { force: true });
    window.__tr = window.__pawDev.trackingFor(app);
  }, clip);
  await page.waitForFunction(() => app.doc.media && app.player.ready && app.player.vw > 0, null, { timeout: 60000 });
  await ev(() => { app.setMode('scenes'); app.player.pause(); });
  const det = await ev(async () => { const r = await __tr.detectScenes(); return { error: r?.error ?? null, n: app.doc.scenes.length, cuts: app.doc.scenes.map((s) => s.start_ms) }; });
  ok(det.n === 3 && det.cuts[1] === 5000 && det.cuts[2] === 10000, `Detect: three shots at 0 / 5 / 10 s ${JSON.stringify(det)}`);
  await ev(() => app.setView({ start: 0, span: 15000 }));
  await page.waitForFunction(() => __tr.shotLinks.links.length > 0 && __tr.proposed.size > 0, null, { timeout: 180000, polling: 500 });
  const data = await ev(() => ({ links: __tr.shotLinks.links.map((l) => ({ a: l.a.start_ms, b: l.b.start_ms, scale: +l.scale.toFixed(2), score: +l.score.toFixed(3), tighter: l.tighter })),
    inserts: __tr.shotLinks.inserts, proposed: [...__tr.proposed] }));
  const L0 = data.links[0];
  ok(data.links.length === 1 && L0.a === 0 && L0.b === 10000 && Math.abs(L0.scale - 1.6) < 0.1 && L0.tighter === 'b', `one crop link: shot 3 = shot 1 cropped x1.6 ${JSON.stringify(data.links)}`);
  ok(JSON.stringify(data.proposed) === '[[10000,0]]' && data.inserts[0]?.shots?.join() === '5000' && Math.abs(data.inserts[0].crop - 1.6) < 0.1, `the insert (shot 2) between them is the off-screen candidate ${JSON.stringify(data.inserts)}`);

  // painted: the row with the proposals vs the same row with them taken away (restored after)
  const geo = await ev(() => { const cv = document.querySelector('[data-tl-lane="scenes"] canvas'), r = cv.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, d: cv.width / r.width }; });
  const sh = Math.max(12, Math.round(geo.h * 0.58)), top = sh - Math.max(3, Math.min(7, Math.round(sh * 0.22))), X = (t) => (t / 15000) * geo.w;
  const grab = () => ev(([g, top, xs]) => {
    const cv = document.querySelector('[data-tl-lane="scenes"] canvas'), c = cv.getContext('2d');
    const row = (y, x0, x1) => Array.from(c.getImageData(Math.round(x0 * g.d), Math.round(y * g.d), Math.round((x1 - x0) * g.d), 1).data);
    return { edge: row(top + 0.5, xs[0], xs[1]), dot: row(5, xs[2] - 6, xs[2] + 6) };
  }, [geo, top, [X(5000) + 6, X(10000) - 6, X(10000)]]);
  await wait(500);
  const on = await grab();
  await ev(() => { window.__keep = [__tr.shotLinks, __tr.proposed]; __tr.shotLinks = { links: [], inserts: [] }; __tr.proposed = new Set(); });
  await wait(500);
  const off = await grab();
  await ev(() => { [__tr.shotLinks, __tr.proposed] = window.__keep; });
  await wait(500);
  const diff = (p, q) => { let n = 0; for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 40) n++; return n; };
  const runs = (p) => { let n = 0, prev = null; for (let i = 0; i < p.length; i += 4) { const v = p[i] + p[i + 1] + p[i + 2] > 300; if (prev !== null && v !== prev) n++; prev = v; } return n; };
  ok(diff(on.edge, off.edge) > 20 && runs(on.edge) > 2 * runs(off.edge) + 10, `the dashed "off-screen?" card is painted on shot 2 (${diff(on.edge, off.edge)} px differ, ${runs(on.edge)} vs ${runs(off.edge)} dash edges)`);
  ok(diff(on.dot, off.dot) >= 4, `the offer badge is painted on shot 3's boundary (${diff(on.dot, off.dot)} px differ)`);

  // the badge's hover words
  await page.mouse.move(geo.x + X(10000), geo.y + 5);
  await wait(600);
  const hint = await ev(() => document.body.innerText.match(/Same footage as shot[^\n]*/)?.[0] ?? '');
  ok(/^Same footage as shot 1 · crop ×1\.6/.test(hint), `hover: "${hint.slice(0, 90)}"`);
  await page.mouse.move(geo.x + X(7500), geo.y + top + 2);
  await wait(600);
  const tip = await ev(() => document.body.innerText.match(/Proposed off-screen[^\n]*/)?.[0] ?? '');
  ok(/same footage as shot 1, crop ×1\.6/.test(tip), `card hover names the crop: "${tip.slice(0, 120)}"`);

  // take the card: one scene, the insert off-screen, one undo step
  const state = () => ev(() => app.doc.scenes.map((s) => [s.join === true ? 1 : 0, (s.tags || []).includes('offscreen') || !!s.fill ? 'cut' : '']));
  const before = JSON.stringify(await state());
  await page.mouse.click(geo.x + X(7500), geo.y + top + 2);
  await wait(500);
  const took = await state();
  ok(took[1][0] === 1 && took[2][0] === 1 && took[1][1] === 'cut' && took[2][1] === '', `card click: shots 1-3 one scene, shot 2 off-screen ${JSON.stringify(took)}`);
  await ev(() => app.undo());
  await wait(300);
  ok(JSON.stringify(await state()) === before, 'one undo step back');

  // take the badge: the three shots one scene (the same-footage join), one undo step
  await page.waitForFunction(() => __tr.shotLinks.links.length > 0, null, { timeout: 60000 });
  await wait(800);
  await page.mouse.click(geo.x + X(10000), geo.y + 5);
  await wait(500);
  const joined = await state();
  ok(joined[1][0] === 1 && joined[2][0] === 1, `badge click: one scene from shot 1 to shot 3 ${JSON.stringify(joined)}`);
  await ev(() => app.undo());
  await wait(300);
  ok(JSON.stringify(await state()) === before, 'one undo step back');
} catch (e) {
  fails++;
  console.log('FAIL', e.message);
} finally {
  await b.close().catch(() => {});
}
console.log(fails ? `${fails} failed` : 'all ok');
process.exit(fails ? 1 : 0);
