// dev/groups-seed2-check.mjs -- paw-o74b ("the second seed") in YOUR test instance (node dev/test-app.mjs start ... with
// FAKE_REQ_LOG=<file> in its environment: the fake sidecar appends each track request's gist there), on a generated clip.
// One shot; Groups tool; real pointer strokes:
//  1. paint Bottom torso on frame A, T: a run with it;
//  2. scrub to frame B of the same shot: the torso is listed under "Seeded on other frames" and drawn dimmed where the run
//     tracked it on B (not where it was painted); paint Top penis there: added (the shot list unchanged: no division);
//  3. T: ONE request, groups only, that group alone, seeded on B; still one run, now with both, the torso's channel unchanged;
//  4. save, reopen: the run has both groups.
//   node dev/groups-seed2-check.mjs <clip.mp4> <out dir> <FAKE_REQ_LOG file>
import { readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';

const [clip, out, reqLog] = process.argv.slice(2);
if (!clip || !out || !reqLog) { console.error('usage: node dev/groups-seed2-check.mjs <clip> <out dir> <FAKE_REQ_LOG file>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const proj = clip.replace(/\.[^.]+$/, '.pawproj'), runsFile = clip.replace(/\.[^.]+$/, '.pawruns');
for (const f of [proj, runsFile]) if (existsSync(f)) rmSync(f);
const requests = () => (existsSync(reqLog) ? readFileSync(reqLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('[pageerror]', String(e.message).slice(0, 300)); });
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /changed outside/.test(t) ? 'project' : d.choices?.[0]?.id ?? null); });
const open = async (project) => {
  const p = project ? ev((f) => app.project.openProject(f, { force: true }), project) : ev((c) => app.project.openVideo(c, { force: true }), clip);
  for (let k = 0; k < 8; k++) { await wait(500); await answer(); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.doc.media && app.player.ready, null, { timeout: 60000 });
};
const A = 1250, B = 3000;   // the fake moves each group up / down by 0.03 sin(2 pi t + its phase)
const G = 'window.__pawDev.groupsFor(app)', T = 'window.__pawDev.trackingFor(app)';
const seek = async (t) => { await ev((t) => { app.player.pause(); app.player.seek(t, { exact: true }); }, t); await page.waitForFunction((t) => Math.abs(app.player.timeMs - t) < 20 && !app.player.el?.seeking, t, { timeout: 15000 }); await wait(400); };
const toolOn = async () => { await ev(() => { const g = window.__pawDev.groupsFor(app); if (!g.on) app.commands.run('tracking.groups'); }); await page.waitForFunction(() => !!document.querySelector('[data-testid="groups-tools"]'), null, { timeout: 10000 }); await wait(300); };
const box = async () => ev(() => { const r = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const stroke = async (nx, ny) => {
  const b = await box(), at = (x, y) => [b.x + x * b.w, b.y + y * b.h];
  await page.mouse.move(...at(nx, ny)); await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(...at(nx + 0.006 * k, ny + 0.004 * k));
  await page.mouse.up(); await wait(500);
};
const trackNow = async (n) => {   // T, then wait for request n to be logged and the job to end
  await ev(() => app.commands.run('track.run', { all: true }));
  for (let k = 0; k < 100 && requests().length < n; k++) await wait(200);
  await page.waitForFunction(() => !window.__pawDev.trackingFor(app).busy, null, { timeout: 60000 }); await wait(800);
};

try {
  await page.waitForFunction(() => window.app && window.__pawDev?.groupsFor, null, { timeout: 30000 });
  await open();
  const D = await ev(() => app.durationMs);
  await ev((D) => {
    app.setMode('track'); app.player.pause();
    app.doc.scenes = [{ start_ms: 0, end_ms: D }];
    app.settings.set('tracking.groups.snap', false); app.settings.set('tracking.groups.circle', false); app.settings.set('tracking.groups.grow', false); app.settings.set('tracking.groups.brush', 0.04);
    app.settings.set('tracking.scenes', 'document');
    const tr = window.__pawDev.trackingFor(app);
    tr.runs = []; app.doc.ghosts = (app.doc.ghosts || []).filter((g) => g.source?.kind !== 'tracker');   // a clean start (an earlier run of this check)
    tr.selectTracker('fake.groups');
    app.doc.range = { t0: 0, t1: D };
  }, D);
  await page.waitForFunction(() => window.__pawDev.trackingFor(app).trackerId === 'fake.groups', null, { timeout: 15000 });

  // ---- 1. Bottom torso on frame A, Track ----
  await seek(A); await toolOn();
  await ev(() => { const g = window.__pawDev.groupsFor(app); g.setWho('c1'); g.pickPart('torso'); });
  await stroke(0.3, 0.3);
  const g1 = await ev(() => window.__pawDev.groupsFor(app).all.map((g) => ({ name: g.name, t: g.t_ms })));
  ok(g1.length === 1 && g1[0].name === 'c1_torso' && Math.abs(g1[0].t - A) < 40, `painted on frame A: ${JSON.stringify(g1)}`);
  await trackNow(1);
  const r1 = await ev(() => { const tr = window.__pawDev.trackingFor(app); return tr.runs.map((r) => ({ id: r.id, ch: Object.keys(r.channels).filter((k) => k.startsWith('sem_')), torso: Array.from(r.channels.sem_c1_torso_x?.v || []) })); });
  ok(r1.length === 1 && r1[0].ch.includes('sem_c1_torso_x'), `one run with the torso: ${JSON.stringify(r1.map((r) => [r.id, r.ch]))}`);
  ok(requests().length === 1 && !requests()[0].groups_only, 'the first Track: a full run');

  // ---- 2. frame B of the same shot: the torso shown where the run tracked it, then Top penis painted there ----
  await seek(B); await toolOn();
  const shots0 = await ev(() => JSON.stringify(app.doc.scenes.map(({ groups, ...s }) => s)));
  const st = await ev(() => { const g = window.__pawDev.groupsFor(app); const o = g.othersHere(); return { here: g.groups.length, onFrame: g.onFrame, others: o.map((x) => ({ name: x.g.name, tracked: x.tracked, dy: x.poly[0][1] - x.g.poly[0][1], dx: x.poly[0][0] - x.g.poly[0][0] })) }; });
  const camDx = 0.003 * (Math.sin(B / 900) - Math.sin(A / 900));
  const ph = [...'c1_torso'].reduce((a, c) => a + c.charCodeAt(0), 0) % 7, wantDy = 0.03 * (Math.sin(2 * Math.PI * B / 1000 + ph) - Math.sin(2 * Math.PI * A / 1000 + ph));   // the fake's motion (its phase is the part's: paw-o74b.1)
  ok(st.onFrame && st.here === 0, `frame B paints, no groups of its own: ${JSON.stringify(st)}`);
  ok(st.others.length === 1 && st.others[0].tracked && Math.abs(st.others[0].dy - wantDy) < 0.004 && Math.abs(st.others[0].dx - camDx) < 0.004,
    `the torso drawn where the run tracked it on B (moved ${st.others[0]?.dx?.toFixed(4)}, ${st.others[0]?.dy?.toFixed(4)}; expected ${camDx.toFixed(4)}, ${wantDy.toFixed(4)})`);
  // the list (with its "Seeded on other frames" rows) is the Groups list popover since 6543984 (paw-i5qx: the slim bar): open it, read, close
  await page.getByTestId('groups-list-open').click(); await wait(300);
  const row = await ev(() => document.querySelector('[data-testid="groups-others"]')?.textContent?.replace(/\s+/g, ' ').trim() || '');
  await page.getByTestId('groups-list-open').click(); await wait(300);
  ok(/Seeded on other frames/.test(row) && /torso/i.test(row) && /tracked/.test(row), `the dock lists it with its seed frame: "${row}"`);
  ok(await ev(() => !!document.querySelector('[data-testid="groups-add-here"]')), 'the dock says painting here adds groups seeded on this frame');
  await page.screenshot({ path: `${out}/b-before-paint.png` });
  await ev(() => { const g = window.__pawDev.groupsFor(app); g.setWho('c2'); g.pickPart('penis'); });
  const h0 = await ev(() => app._history.index);
  await stroke(0.62, 0.62);
  const g2 = await ev(() => window.__pawDev.groupsFor(app).all.map((g) => ({ name: g.name, t: g.t_ms })));
  ok(g2.length === 2 && g2.some((g) => g.name === 'c2_penis' && Math.abs(g.t - B) < 40), `Top penis added on frame B: ${JSON.stringify(g2)}`);
  ok((await ev(() => app._history.index)) - h0 === 1, 'one undo step');
  ok((await ev(() => JSON.stringify(app.doc.scenes.map(({ groups, ...s }) => s)))) === shots0, 'the shot list is unchanged (no division)');
  await page.screenshot({ path: `${out}/b-after-paint.png` });

  // ---- 3. T: only the new group, from frame B; merged into the same run ----
  await trackNow(2);
  const reqs = requests(), last = reqs.at(-1);
  ok(reqs.length === 2, `one more request (${reqs.length})`);
  ok(last?.groups_only === true && last.groups.length === 1 && last.groups[0].name === 'c2_penis' && Math.abs(last.seed - B) < 40, `groups only, Top penis alone, seeded on B: ${JSON.stringify(last)}`);
  const r2 = await ev(() => { const tr = window.__pawDev.trackingFor(app); return tr.runs.map((r) => ({ id: r.id, ch: Object.keys(r.channels).filter((k) => k.startsWith('sem_') && k.endsWith('_x')), torso: Array.from(r.channels.sem_c1_torso_x?.v || []), pen: Array.from(r.channels.sem_c2_penis_x?.v || []).map((v) => (v === v ? 1 : 0)) })); });
  ok(r2.length === 1 && r2[0].id === r1[0].id, 'still one run, the same one');
  ok(r2[0].ch.includes('sem_c1_torso_x') && r2[0].ch.includes('sem_c2_penis_x'), `it has both: ${JSON.stringify(r2[0].ch)}`);
  ok(JSON.stringify(r2[0].torso) === JSON.stringify(r1[0].torso), "the torso's channel bytes are unchanged");
  ok(r2[0].pen.includes(0) && r2[0].pen.includes(1), 'the penis channel is absent where it was not tracked (NaN), present where it was');
  ok(/Added/.test(await ev(() => window.__pawDev.trackingFor(app).notice)), 'the panel says what was added');

  // ---- 4. save, reopen ----
  const sp = ev(() => app.project.save());   // a video opened on its own: the .pawproj beside it
  for (let k = 0; k < 6; k++) { await wait(400); await answer(); }
  await Promise.race([sp.catch((e) => console.log('save:', e?.message)), wait(20000).then(() => console.log('save: no answer in 20 s'))]);
  await page.waitForFunction(() => !window.__pawDev.trackingFor(app).runsDirty, null, { timeout: 20000 }).catch(() => {});
  ok(existsSync(proj) && existsSync(runsFile), `saved ${proj} and its .pawruns`);
  await ev(() => app.project.close()); await wait(600);
  await open(proj); await wait(800);
  await page.waitForFunction(() => window.__pawDev.trackingFor(app).runs.length > 0, null, { timeout: 20000 }).catch(() => {});
  const r3 = await ev(() => window.__pawDev.trackingFor(app).runs.map((r) => ({ id: r.id, restored: !!r.restored, ch: Object.keys(r.channels).filter((k) => k.startsWith('sem_') && k.endsWith('_x')), seeds: (r.groupSeeds || []).map((s) => s.name) })));
  ok(r3.length === 1 && r3[0].ch.includes('sem_c1_torso_x') && r3[0].ch.includes('sem_c2_penis_x') && !r3[0].restored, `after reopen the run has both: ${JSON.stringify(r3)}`);
  const g3 = await ev(() => (app.doc.scenes[0].groups || []).map((g) => [g.name, g.t_ms]));
  ok(g3.length === 2, `both groups with their own seed frames: ${JSON.stringify(g3)}`);
} catch (e) {
  fails++; console.log('FAIL', e?.stack || e);
} finally {
  await browser.close().catch(() => {});
  console.log(fails ? `${fails} FAILED` : 'all ok');
  process.exit(fails ? 1 : 0);
}
