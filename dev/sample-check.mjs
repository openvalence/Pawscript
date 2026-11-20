// dev/sample-check.mjs -- paw-ys3x in the REAL window, on a FRESH test instance (node dev/test-app.mjs start with a new id):
// the empty Projects page offers "Open the sample project"; it copies the sample to <home>\Videos\Pawscript sample (the folder
// the toast names) and opens the copy on the Track tab, with its video, three shots and the run; the video plays and the
// script follows it; a point moved and Ctrl+Alt+S publishes v2 beside the copy's video. The folder must not exist before; remove it after stopping the
// instance (the app may still write into it until then).   node dev/sample-check.mjs
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { connectTestApp } from './cdp-connect.mjs';

const DIR = join(homedir(), 'Videos', 'Pawscript sample'), NAME = 'Pawscript sample';
if (existsSync(DIR)) { console.error(`${DIR} exists already: this check needs it absent`); process.exit(2); }
const { browser, page } = await connectTestApp();
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
try {
  await page.waitForFunction(() => window.app?.project && window.__pawDev, null, { timeout: 60000 });
  ok(await ev(() => app.settings.get('onboard.hints') === true && !(app.project.recent || []).length), 'a fresh profile: no recent projects, the hints on');
  const btn = page.locator('[data-testid="home-sample"]');
  await btn.waitFor({ timeout: 10000 });
  ok(/Open the sample project/.test(await btn.innerText()), 'the first-run card offers "Open the sample project"');
  await ev(() => { const t = app.toast.bind(app); window.__toasts = []; app.toast = (...a) => { window.__toasts.push(a); return t(...a); }; });
  const t0 = Date.now();
  await btn.click();
  await page.waitForFunction((n) => window.app?.doc?.media?.path?.endsWith(n + '.mp4') && app.player.ready, NAME, { timeout: 60000 });
  const st = await ev(() => ({ path: app.doc.media.path, proj: app.project.path, mode: app.mode, shots: app.doc.scenes.length, runs: window.__pawDev.trackingFor(app).runs.length,
    script: app.script.length, toasts: window.__toasts.map((x) => x[1] + ': ' + x[0]) }));
  console.log(JSON.stringify(st));
  ok(st.path === join(DIR, NAME + '.mp4') && st.proj === join(DIR, NAME + '.pawproj'), `the copy opened (${((Date.now() - t0) / 1000).toFixed(1)} s): ${st.proj}`);
  ok(st.toasts.some((m) => m.includes('Sample project copied to ' + DIR)), 'the toast names the folder');
  ok(existsSync(join(DIR, NAME + '.pawruns')) && existsSync(join(DIR, NAME + '.pawhistory', 'index.json')), `the files are there: ${readdirSync(DIR).join(', ')}`);
  ok(st.mode === 'track' && st.shots === 3 && st.runs >= 1 && st.script > 50, `Track tab, ${st.shots} shots, ${st.runs} run(s), ${st.script} script points`);
  await wait(1500);
  const hint = await page.locator('[data-testid="onboard-hint"]').count() ? (await page.locator('[data-testid="onboard-hint"] .tx').innerText()).replace(/\s+/g, ' ') : '';
  ok(!!hint, `a first-run hint: "${hint}"`);
  // plays, and the script follows the video
  await ev(() => app.player.seek(14000));
  await wait(500);
  const p0 = await ev(() => ({ t: app.player.timeMs }));
  await page.keyboard.press('Space');
  const seen = [];
  for (let i = 0; i < 12; i++) { await wait(150); seen.push(await ev(() => { const s = app.script, t = app.player.timeMs; let k = s.findIndex((p) => p.at > t); if (k < 1) k = 1; const a = s[k - 1], b = s[k]; return [Math.round(t), b ? Math.round(a.pos + (b.pos - a.pos) * (t - a.at) / (b.at - a.at)) : null]; })); }
  await page.keyboard.press('Space');
  const pos = seen.map((x) => x[1]);
  ok(seen.at(-1)[0] - p0.t > 1000, `Space plays: ${p0.t} -> ${seen.at(-1)[0]} ms`);
  ok(Math.max(...pos) - Math.min(...pos) > 30, `the script follows: positions ${pos.join(' ')}`);
  if (process.env.SHOT_DIR) { await ev(() => app.player.seek(15200)); await wait(800); await page.screenshot({ path: join(process.env.SHOT_DIR, 'sample-opened.png') }); }
  // Publish: a change (one baked point of shot 1 moved, as a drag would; baking alone changes nothing that plays), Ctrl+Alt+S -> v2
  await ev(() => { const s = app.doc.axes.stroke.map((p) => ({ ...p })); s[5].pos = Math.max(0, s[5].pos - 10); app.edit('Move point', 'stroke', s); });
  await page.keyboard.press('Control+Alt+S');
  await page.waitForFunction(() => window.__toasts.some((x) => /^Published v2/.test(x[0])), null, { timeout: 30000 }).catch(() => {});
  const fun = JSON.parse(readFileSync(join(DIR, NAME + '.funscript'), 'utf8'));
  ok(fun.metadata?.pawscript?.publish?.version === 2, `Publish wrote v2 beside the copy (${fun.actions.length} points)`);
  const baks = readdirSync(DIR).filter((n) => n.endsWith('.bak'));
  ok(!baks.length && !(await ev(() => window.__toasts.some((x) => /changed outside/.test(x[0])))), `the copy is the app's own: no backup on its first writes${baks.length ? ' (' + baks.join(', ') + ')' : ''}`);
} catch (e) { fails++; console.log('FAIL [threw]', String(e?.message || e).slice(0, 400)); } finally {
  console.log(fails ? `${fails} FAILED` : 'all ok');
  await browser.close();
  process.exit(fails ? 1 : 0);
}
