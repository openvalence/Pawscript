// dev/onboard-check.mjs -- paw-kxwz / paw-a0eg in the REAL window, on a FRESH test instance (node dev/test-app.mjs start with a
// new id: no recent projects, so the first-run hints are on). The empty Projects page shows the five-step card; F1 opens the
// help overlay on the Quick start; a generated clip opened in the Scenes tab shows the hint "cuts"; Detect (the fake sidecar)
// moves it to "paint" naming the Track tab's key; in the Track tab an unnamed painted part gives "name", a named one "track";
// a run (the store's runTrack, the sidecar's answer stood in for) plays live at once (paw-x7w7: no Accept) and gives "next",
// whose line names F, Shift+B and Ctrl+Alt+S; Shift+B (tracking.bake) bakes the shot and "next" stays; the hint's Quick start
// link opens the quick start; its x hides that step for good.   node dev/onboard-check.mjs <clip.mp4>
import { connectTestApp } from './cdp-connect.mjs';

const clip = process.argv[2];
if (!clip) { console.error('usage: node dev/onboard-check.mjs <clip.mp4>'); process.exit(2); }
const { browser, page } = await connectTestApp();
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
const hint = () => page.locator('[data-testid="onboard-hint"]');
const step = async () => ((await hint().count()) ? hint().getAttribute('data-step') : null);
const hintText = async () => ((await hint().count()) ? (await hint().locator('.tx').innerText()).replace(/\s+/g, ' ').trim() : '');
const until = async (want, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if ((await step()) === want) return true; await wait(150); } return false; };
const poly = [[0.4, 0.3], [0.6, 0.3], [0.6, 0.7], [0.4, 0.7]];
try {
  await page.waitForFunction(() => window.app?.project && window.__pawDev, null, { timeout: 60000 });
  ok(await ev(() => app.settings.get('onboard.hints') === true && !(app.project.recent || []).length), 'a fresh profile: no recent projects, the hints on');
  await page.locator('[data-testid="home-first-run"]').waitFor({ timeout: 10000 });
  const card = (await page.locator('[data-testid="home-first-run"]').innerText()).replace(/\s+/g, ' ');
  ok(/five steps/.test(card) && (await page.locator('[data-testid="home-first-run"] li').count()) === 5 && /Ctrl\W*O/.test(card) && /Ctrl\W*2/.test(card), `the empty Projects page shows the five-step card ("${card.slice(0, 120)}…")`);

  await page.keyboard.press('F1');
  await page.locator('[data-testid="quick-start"]').waitFor({ timeout: 5000 });
  const qs = await page.locator('[data-testid="quick-start"] h4').allInnerTexts();
  ok(qs.length === 9 && /Open a video/.test(qs[0]) && /Write the funscript/.test(qs[8]), `F1 opens the Quick start (${qs.length} steps: ${qs[0]} … ${qs[8]})`);
  ok(await page.locator('[data-testid="quick-start"] .pk').count() > 10, 'its keys are drawn as key caps');
  await page.keyboard.press('Escape');
  await wait(300);

  await ev((c) => app.project.openPaths([c]), clip);
  await page.waitForFunction((c) => app.doc.media?.path === c && app.player.ready, clip, { timeout: 60000 });
  await ev(() => { app.setMode('scenes'); app.doc.scenes = []; });
  ok(await until('cuts'), `a video, no cuts yet, the Scenes tab: hint "cuts": "${await hintText()}"`);
  const box = await hint().boundingBox(), stage = await page.locator('[data-testid="video-stage"]').boundingBox();
  ok(box && stage && box.height < 64 && box.y < stage.y + 40 && box.width < stage.width, `a short line at the top of the stage (${Math.round(box?.width)} x ${Math.round(box?.height)} px), not over the timeline`);

  const det = await ev(async () => { const r = await window.__pawDev.trackingFor(app).detectScenes(); if (!app.doc.scenes.length) app.doc.scenes = [{ start_ms: 0, end_ms: app.durationMs }]; return r?.error || r?.cancelled ? String(r.error || 'cancelled') : 'detected'; });
  ok(await until('paint'), `Detect (${det}, ${await ev(() => app.doc.scenes.length)} shots): hint "paint": "${await hintText()}"`);
  ok(/^Ctrl\W*2 Track tab:/.test(await hintText()), 'in the Scenes tab it names the Track tab and its key');

  await ev(() => { app.setMode('track'); app.player.seek(Math.min(1000, app.doc.scenes[0].end_ms / 2)); });
  ok(await until('paint') && !/Track tab:/.test(await hintText()), `the Track tab: "${await hintText()}"`);
  await ev((poly) => { const s = app.doc.scenes.slice(); s[0] = { ...s[0], groups: [{ name: 'unassigned_1', poly, t_ms: 500 }] }; app.doc.scenes = s; }, poly);
  ok(await until('name'), `an unnamed painted part: hint "name": "${await hintText()}"`);
  await ev((poly) => { const s = app.doc.scenes.slice(); s[0] = { ...s[0], groups: [{ name: 'c2_penis', who: 'c2', part: 'penis', poly, t_ms: 500 }] }; app.doc.scenes = s; }, poly);
  ok(await until('track'), `a named part: hint "track": "${await hintText()}"`);

  const run = await ev(async () => {
    const tr = window.__pawDev.trackingFor(app), s = app.doc.scenes[0], T = [];
    for (let t = s.start_ms; t < s.end_ms; t += 40) T.push(t);
    tr.job = async () => ({ result: { samples: T.map((t) => [t, 0.5 + 0.4 * Math.sin(t / 300)]), points: T.filter((_, k) => k % 8 === 0).map((t, k) => ({ at: t, pos: k % 2 ? 90 : 10 })), scenes: [{ start_ms: s.start_ms, end_ms: s.end_ms, sign: 1 }], channels: {}, notes: [] } });
    const r = await tr.runTrack({ id: 'lk_box', name: 'Optical flow (box)', params: [] }, { start: s.start_ms, end: s.end_ms }, {}, { kind: 'box', x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, [], { check: false });
    if (r.run) tr.select(r.run.id);
    return r.run?.id || JSON.stringify(r).slice(0, 200);
  });
  ok(await until('next'), `a run (${run}) covers the shot and plays live: hint "next": "${await hintText()}" (${await ev(() => app.script.length)} points in the script, none baked: ${await ev(() => (app.doc.axes.stroke || []).length)})`);
  const nx = await hintText();
  ok(/^In your script: F flips a tracked shot, Shift\W*B bakes it/.test(nx) && /Ctrl\W*Alt\W*S publishes/.test(nx) && !/accept/i.test(nx), `"next" names the flip, Bake and Publish keys, no Accept: "${nx}"`);
  await ev(() => app.commands.run('tracking.bake'));
  await wait(400);
  const baked = await ev(() => (app.doc.axes.stroke || []).length);
  ok(baked > 0 && (await step()) === 'next', `Shift+B bakes the shot (${baked} points baked) and the hint stays "next"`);

  await hint().locator('.lk').click();
  await page.locator('[data-testid="quick-start"]').waitFor({ timeout: 5000 });
  ok(true, "the hint's Quick start link opens the quick start");
  await page.keyboard.press('Escape');
  await wait(300);
  await hint().locator('.x').click();
  await wait(400);
  ok(!(await hint().count()) && (await ev(() => app.settings.get('onboard.dismissed'))).includes('next'), 'x hides the hint and the step stays dismissed');
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + '/onboard.png' });
} catch (e) { fails++; console.log('FAIL [threw]', String(e?.message || e).slice(0, 400)); } finally {
  console.log(fails ? `${fails} FAILED` : 'all ok');
  await browser.close();
  process.exit(fails ? 1 : 0);
}
