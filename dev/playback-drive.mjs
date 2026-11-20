// dev/playback-drive.mjs -- drives dev/playback.html (fake device bridge, real video transport) headless and checks
// what reached the "device". Needs vite on 5680:  npx vite --port 5680 --strictPort
//   node dev/playback-drive.mjs [out.png]
// Exit code 1 on the first failed check. Headless Edge: no window ever shows on the desktop.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const out = process.argv[2] || null;
const b = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const ev = (f, a) => p.evaluate(f, a);
const wait = (ms) => p.waitForTimeout(ms);
const ok = (name) => console.log('ok  ', name);

try {
  await p.goto('http://localhost:5680/dev/playback.html');
  await p.waitForFunction(() => window.H && window.H.app.player.ready, null, { timeout: 20000 });

  // the panel: open the Device tab if the right dock has tabs
  const tab = p.getByRole('tab', { name: 'Device' });
  if (await tab.count()) await tab.first().click();
  await p.getByRole('button', { name: 'Connect' }).first().click();
  await p.waitForFunction(() => H.P.devices.length === 2 && H.P.deviceIndex === 0, null, { timeout: 5000 });
  ok('connect + scan: 2 devices, the stroker picked, the vibrator listed but not selectable');
  assert.equal(await p.getByRole('option', { name: /Fake vibrator/ }).isDisabled(), true);

  // play 3 s from 5 s with playback on, under the planner profile (no speed clamp: every span lands on a knot)
  await ev(() => { H.P.setProfile('nucleus-capstan'); H.P.setEnabled(true); H.app.player.seek(5000); });
  await wait(300);
  await ev(() => { H.F.log.length = 0; H.app.player.play(); });
  await wait(3000);
  await ev(() => H.app.player.pause());
  await wait(600);
  const r = await ev(() => {
    const s = H.app.doc.axes.stroke, log = H.F.log.map((c) => ({ ...c }));
    return { log, script: s.filter((a) => a.at >= 4000 && a.at <= 10000), t: H.app.player.timeMs };
  });
  assert.ok(r.log.length > 4, 'commands sent: ' + r.log.length);
  assert.ok(r.log.every((c) => c.index === 0 && c.feature === 0 && Number.isInteger(c.position) && c.position >= 0 && c.position <= 10000 && c.ms >= 1));
  // every span command's position is one of the script's knots in the played window (pos / 100 of 10000 steps)
  const knots = new Set(r.script.map((a) => a.pos * 100));
  const spans = r.log.slice(1, -1);   // first = transition, last = the pause's stop segment
  const hits = spans.filter((c) => knots.has(c.position)).length;
  assert.ok(hits >= spans.length - 1, `${hits}/${spans.length} span commands on script knots`);
  const last = r.log.at(-1);
  assert.ok(last.ms <= 200, 'pause sends a short stop segment: ' + last.ms);
  ok(`play 3 s: ${r.log.length} commands, ${hits}/${spans.length} on script knots, pause -> stop segment (${last.ms} ms)`);
  const n0 = await ev(() => H.F.log.length);
  await wait(500);
  assert.equal(await ev(() => H.F.log.length), n0, 'still while paused');
  ok('paused and still: no motion');

  // scrub while paused
  await ev(() => H.app.player.seek(20000));
  await wait(400);
  const sc = await ev(() => H.F.log.slice(-1)[0]);
  // the playhead lands on a frame, not on 20000 exactly: compare with the script where it is
  const want = await ev(() => { const s = H.app.doc.axes.stroke, t = H.app.player.timeMs; let i = s.findIndex((a) => a.at > t); const a = s[i - 1], c = s[i]; return Math.round((a.pos + (c.pos - a.pos) * (t - a.at) / (c.at - a.at)) * 100); });
  assert.ok(Math.abs(sc.position - want) <= 1, `scrub went to ${sc.position}, playhead is at ${want}`);
  ok('paused seek: the device follows the playhead (' + sc.position + ')');

  // range + invert, under the conservative generic profile (250 u/s clamp)
  await ev(() => { H.P.setProfile('generic'); H.P.set('range', [20, 80]); H.P.set('invert', true); H.F.log.length = 0; H.app.player.play(); });
  await wait(1500);
  await ev(() => H.app.player.pause());
  await wait(300);
  const rr = await ev(() => H.F.log.map((c) => c.position));
  assert.ok(rr.length > 2 && rr.every((v) => v >= 2000 && v <= 8000), 'range 20..80: ' + rr.join(','));
  ok('range 20-80 % + invert: every position inside [2000, 8000] steps');
  await ev(() => { H.P.set('range', [0, 100]); H.P.set('invert', false); H.P.setEnabled(false); });

  // preview range (playback off): plays the I/O range once, then playback is off again
  await ev(() => { H.app.doc.range = { t0: 30000, t1: 31500 }; H.F.log.length = 0; });
  await p.keyboard.press('Control+Shift+Space');
  await p.waitForFunction(() => H.app.player.playing, null, { timeout: 3000 });
  await p.waitForFunction(() => !H.P.previewing, null, { timeout: 5000 });
  const pv = await ev(() => ({ n: H.F.log.length, enabled: H.P.enabled, t: H.app.player.timeMs }));
  assert.ok(pv.n > 2 && pv.enabled === false, JSON.stringify(pv));
  ok(`preview range (Ctrl+Shift+Space): ${pv.n} commands, playback back off, playhead parked at ${Math.round(pv.t)}`);

  // panic key while playing
  await ev(() => { H.P.setEnabled(true); H.app.player.play(); });
  await wait(500);
  const stops0 = await ev(() => H.F.stops);
  await p.keyboard.press('Shift+Escape');
  await wait(100);
  const pn = await ev(() => ({ playing: H.app.player.playing, enabled: H.P.enabled, stops: H.F.stops }));
  assert.deepEqual([pn.playing, pn.enabled, pn.stops > stops0], [false, false, true], JSON.stringify(pn));
  ok('panic (Shift+Esc): video paused, playback off, StopAll sent');

  // device lost while playing: playback turns itself off and stays off
  await ev(() => { H.P.setEnabled(true); H.app.player.play(); });
  await wait(300);
  await ev(() => H.F.drop(0));
  await wait(100);
  const lost = await ev(() => ({ enabled: H.P.enabled, dev: H.P.deviceIndex, n: H.F.log.length }));
  assert.equal(lost.enabled, false);
  await wait(300);
  assert.equal(await ev(() => H.F.log.length), lost.n, 'nothing sent after the loss');
  await ev(() => H.app.player.pause());
  ok('device lost: playback off, nothing more sent');

  await ev(() => H.F.scan(true));
  await p.waitForFunction(() => H.P.deviceIndex === 0, null, { timeout: 3000 });
  await ev(() => { H.P.setEnabled(true); H.app.player.seek(12000); });
  await wait(300);
  if (out) await p.screenshot({ path: out });
  assert.deepEqual(errors, []);
  ok('no page errors');
} catch (e) {
  console.error('FAIL', e.message);
  if (out) await p.screenshot({ path: out.replace(/\.png$/, '-fail.png') }).catch(() => {});
  console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await b.close();
}
