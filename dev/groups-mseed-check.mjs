// dev/groups-mseed-check.mjs -- paw-o74b.1 (one part seeded on several frames) in YOUR test instance (node dev/test-app.mjs start
// ... with FAKE_REQ_LOG=<file> in its environment: the fake sidecar appends each track request's gist there), on a generated clip.
// One shot; Groups tool; real pointer strokes and keys:
//  1. paint Bottom hips (armed) on frame A, T: a run with it;
//  2. frame B of the same shot: the hips drawn dimmed where the run tracked them; a plain stroke over that outline (nothing armed)
//     is never refused: it proposes Bottom hips (a re-anchor), Enter takes it: c1_hips seeded on A and B;
//  3. T: exactly ONE request, groups only, c1_hips alone, seeded on B; still one run, ONE hips group (no c1_hips2) with two
//     seeds; the dock shows the hips once on each frame with its two frame chips; the hips channel has no step at the handover
//     (the fake's two paintings sit apart: their raw tracks differ by that offset, the stitched channel does not jump);
//  4. delete the seed on B: the run's hips channel is the single-seed signal again (no request); save.
//  reopen (after a restart with the same --id): the project from disk: one run, the hips with both seeds kept, the one on B unused,
//     the channel still the single-seed signal; the deleted group put back as it was (an undo across the restart): stitched again
//     from the track the file kept, no request; a NEW painting there instead is a changed seed (T would track it again), never the
//     old track.
//   node dev/groups-mseed-check.mjs run <clip.mp4> <out dir> <FAKE_REQ_LOG file>
//   node dev/test-app.mjs stop --dir <d>; node dev/test-app.mjs start --dir <d> --target <t> --id <the same id>
//   node dev/groups-mseed-check.mjs reopen <clip.mp4> <out dir> <FAKE_REQ_LOG file>
import { readFileSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';

const [phase, clip, out, reqLog] = process.argv.slice(2);
if (!['run', 'reopen'].includes(phase) || !clip || !out || !reqLog) { console.error('usage: node dev/groups-mseed-check.mjs run|reopen <clip> <out dir> <FAKE_REQ_LOG file>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const proj = clip.replace(/\.[^.]+$/, '.pawproj'), runsFile = clip.replace(/\.[^.]+$/, '.pawruns'), single = `${out}/single-hips.json`, gone = `${out}/deleted-seed.json`;
const requests = () => (existsSync(reqLog) ? readFileSync(reqLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('[pageerror]', String(e.message).slice(0, 300)); });
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /changed outside/.test(t) ? 'project' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null); });
const open = async (project) => {
  const p = project ? ev((f) => app.project.openProject(f, { force: true }), project) : ev((c) => app.project.openVideo(c, { force: true }), clip);
  for (let k = 0; k < 8; k++) { await wait(500); await answer(); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.doc.media && app.player.ready, null, { timeout: 60000 });
};
const A = 1000, B = 4000;
const seek = async (t) => { await ev((t) => { app.player.pause(); app.player.seek(t, { exact: true }); }, t); await page.waitForFunction((t) => Math.abs(app.player.timeMs - t) < 20 && !app.player.el?.seeking, t, { timeout: 15000 }); await wait(400); };
const toolOn = async () => { await ev(() => { const g = window.__pawDev.groupsFor(app); if (!g.on) app.commands.run('tracking.groups'); }); await page.waitForFunction(() => !!document.querySelector('[data-testid="groups-tools"]'), null, { timeout: 10000 }); await wait(300); };
const box = async () => ev(() => { const r = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const stroke = async (nx, ny, n = 8, d = 0.006) => {
  const b = await box(), at = (x, y) => [b.x + x * b.w, b.y + y * b.h];
  await page.mouse.move(...at(nx, ny)); await page.mouse.down();
  for (let k = 1; k <= n; k++) await page.mouse.move(...at(nx + d * k, ny + (2 * d * k) / 3));
  await page.mouse.up(); await wait(600);
};
const trackNow = async (n) => {   // T, then wait for request n to be logged and the job to end
  await ev(() => app.commands.run('track.run', { all: true }));
  for (let k = 0; k < 100 && requests().length < n; k++) await wait(200);
  await page.waitForFunction(() => !window.__pawDev.trackingFor(app).busy, null, { timeout: 60000 }); await wait(800);
};
const toasts = () => ev(() => [...document.querySelectorAll('[data-testid="toast"], .toast')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
const runState = () => ev(() => window.__pawDev.trackingFor(app).runs.map((r) => ({ id: r.id, restored: !!r.restored, hipsCh: Object.keys(r.channels).filter((k) => /^sem_c1_hips\d*_x$/.test(k)),
  x: Array.from(r.channels.sem_c1_hips_x?.v || [], (v) => (v === v ? v : null)), t: Array.from(r.channels.sem_c1_hips_x?.t || []),
  seeds: (r.groupSeeds || []).filter((s) => s.name === 'c1_hips').map((s) => ({ t: s.t_ms, track: !!s.track, own: s.own === undefined ? 'none' : s.own, x0: s.track?.ch?.x?.find((v) => v != null) ?? null, t0: s.track?.t0 ?? null })) })));
/** The largest frame-to-frame change of x within 300 ms of `at`, and the largest one elsewhere (more than 600 ms away). */
function steps(T, x, at) {
  let near = 0, rest = 0;
  for (let i = 0; i + 1 < x.length; i++) {
    if (x[i] == null || x[i + 1] == null) continue;
    const d = Math.abs(x[i + 1] - x[i]);
    if (Math.abs(T[i] - at) <= 300) near = Math.max(near, d); else if (Math.abs(T[i] - at) > 600) rest = Math.max(rest, d);
  }
  return { near, rest };
}
/** Paint over the hips' dimmed tracked outline on this frame (nothing armed), then Enter: -> the proposal seen. */
async function reanchor() {
  await ev(() => { const g = window.__pawDev.groupsFor(app); g.disarm(); });
  const o = await ev(() => { const g = window.__pawDev.groupsFor(app); const x = g.othersHere().find((q) => q.g.name === 'c1_hips'); return x && { tracked: x.tracked, c: x.poly.reduce((s, q) => [s[0] + q[0] / x.poly.length, s[1] + q[1] / x.poly.length], [0, 0]) }; });
  ok(o?.tracked, `the hips drawn dimmed where the run tracked them on this frame (${JSON.stringify(o)})`);
  if (!o) return null;
  await stroke(o.c[0] - 0.012, o.c[1] - 0.008, 4, 0.006);
  const pr = await ev(() => { const g = window.__pawDev.groupsFor(app), k = g.active, x = g.groups[k]; const p = x && g.proposalFor(x); return { name: x?.name, prop: p ? { part: p.parts[0].part, who: p.who, re: p.reanchor } : null }; });
  ok(/^unassigned_/.test(pr.name || '') && pr.prop?.part === 'hips' && pr.prop.who === 'c1' && pr.prop.re === 'c1_hips', `the stroke over the outline proposes Bottom hips, a re-anchor (${JSON.stringify(pr)})`);
  const tt = (await toasts()).join(' | ');
  ok(!/one seed frame per part|already seeded/.test(tt), `no refusal (${tt.slice(0, 200)})`);
  const b = await box();
  await page.mouse.move(b.x + 0.9 * b.w, b.y + 0.9 * b.h); await wait(150);
  await page.keyboard.press('Enter'); await wait(600);
  return pr;
}

try {
  await page.waitForFunction(() => window.app?.project && window.__pawDev?.groupsFor, null, { timeout: 60000 });
  if (phase === 'run') {
    for (const f of [proj, runsFile, reqLog, single]) if (existsSync(f)) rmSync(f);
    await open();
    const D = await ev(() => app.durationMs);
    await ev((D) => {
      app.setMode('track'); app.player.pause();
      app.doc.scenes = [{ start_ms: 0, end_ms: D }];
      for (const [k, v] of [['tracking.groups.snap', false], ['tracking.groups.circle', false], ['tracking.groups.grow', false], ['tracking.groups.brush', 0.04], ['tracking.groups.askAfter', false], ['tracking.scenes', 'document']]) app.settings.set(k, v);
      const tr = window.__pawDev.trackingFor(app);
      tr.runs = []; app.doc.ghosts = (app.doc.ghosts || []).filter((g) => g.source?.kind !== 'tracker');
      tr.selectTracker('fake.groups');
      app.doc.range = { t0: 0, t1: D };
    }, D);
    await page.waitForFunction(() => window.__pawDev.trackingFor(app).trackerId === 'fake.groups', null, { timeout: 15000 });

    // ---- 1. Bottom hips on frame A, Track ----
    await seek(A); await toolOn();
    await ev(() => { const g = window.__pawDev.groupsFor(app); g.setWho('c1'); g.pickPart('hips'); });
    await stroke(0.3, 0.3);
    await trackNow(1);
    const r1 = await runState();
    ok(r1.length === 1 && r1[0].hipsCh.length === 1, `one run with the hips: ${JSON.stringify(r1.map((r) => r.hipsCh))}`);
    writeFileSync(single, JSON.stringify(r1[0].x));

    // ---- 2. frame B: a stroke over the dimmed tracked hips, Enter ----
    await seek(B); await toolOn();
    const h0 = await ev(() => app._history.index);
    await reanchor();
    const g2 = await ev(() => window.__pawDev.groupsFor(app).all.map((g) => [g.name, g.t_ms]));
    ok(g2.filter(([n]) => n === 'c1_hips').length === 2 && g2.some(([n, t]) => n === 'c1_hips' && Math.abs(t - B) < 40), `Enter: c1_hips seeded on A and B (${JSON.stringify(g2)})`);
    ok((await ev(() => app._history.index)) - h0 === 2, 'two undo steps: the stroke, the name');
    await page.screenshot({ path: `${out}/b-reanchored.png` });

    // ---- 3. T: one groups-only request for that seed; one hips group, stitched ----
    const n0 = requests().length;
    await trackNow(n0 + 1);
    const rq = requests().slice(n0);
    ok(rq.length === 1 && rq[0].groups_only === true && JSON.stringify(rq[0].groups.map((g) => g.name)) === '["c1_hips"]' && Math.abs(rq[0].seed - B) < 40, `exactly one groups-only request, c1_hips seeded on B: ${JSON.stringify(rq)}`);
    const r2 = await runState();
    ok(r2.length === 1 && r2[0].id === r1[0].id && JSON.stringify(r2[0].hipsCh) === '["sem_c1_hips_x"]', `still one run, ONE hips group: ${JSON.stringify(r2.map((r) => r.hipsCh))}`);
    ok(r2[0].seeds.length === 2 && r2[0].seeds.every((s) => s.track && Array.isArray(s.own)), `two seeds, each with its track and its stretch: ${JSON.stringify(r2[0].seeds.map((s) => [s.t, s.own]))}`);
    await toolOn();   // a track job closes the tool
    // the frame chips sit in the Groups list popover since 6543984 (paw-i5qx: the slim bar): open it, read, close
    await page.getByTestId('groups-list-open').click(); await wait(300);
    const chips = await ev(() => [...document.querySelectorAll('[data-testid="groups-seed-chips"] .seed')].map((e) => e.textContent));
    await page.getByTestId('groups-list-open').click(); await wait(300);
    ok(chips.length === 2, `the dock: the hips with two seed chips (${JSON.stringify(chips)})`);
    const hand = r2[0].seeds.find((s) => s.t === Math.max(...r2[0].seeds.map((q) => q.t))).own[0][0];
    const st = steps(r2[0].t, r2[0].x, hand), raw = Math.abs((r2[0].seeds[1].x0 ?? 0) - (r2[0].x[r2[0].t.indexOf(r2[0].seeds[1].t0)] ?? 0));
    ok(st.near <= st.rest * 1.05 + 1e-6, `the hips channel: no step at the handover (${hand} ms): largest change there ${st.near.toFixed(5)}, elsewhere ${st.rest.toFixed(5)}; the raw tracks differ by ${raw.toFixed(4)}`);
    ok(raw > 3 * st.rest, `... and without the stitch it would step (offset ${raw.toFixed(4)} vs ${st.rest.toFixed(5)} per frame)`);
    ok(/re-anchored/.test(await ev(() => window.__pawDev.trackingFor(app).notice)), `the panel says it re-anchored (${await ev(() => window.__pawDev.trackingFor(app).notice)})`);
    await page.screenshot({ path: `${out}/b-tracked.png` });

    // ---- 4. delete the seed on B: back to the single-seed signal, no request ----
    const n1 = requests().length;
    writeFileSync(gone, JSON.stringify(await ev(() => { const g = window.__pawDev.groupsFor(app); return g.groups.find((x) => x.name === 'c1_hips'); })));
    await ev(() => { const g = window.__pawDev.groupsFor(app); g.remove(g.groups.findIndex((x) => x.name === 'c1_hips')); });
    await wait(800);
    const r3 = await runState(), one = JSON.parse(readFileSync(single, 'utf8'));
    const same = r3[0].x.every((v, i) => (v == null ? one[i] == null : Math.abs(v - one[i]) < 1e-5));
    ok(same, 'the seed on B deleted: the hips channel is the single-seed signal again');
    ok(r3[0].seeds.length === 2 && r3[0].seeds.some((s) => s.own === null), `its track kept, unused (${JSON.stringify(r3[0].seeds.map((s) => [s.t, s.own]))})`);
    ok(requests().length === n1, 'no sidecar request');
    const sp = ev(() => app.project.save());
    for (let k = 0; k < 6; k++) { await wait(400); await answer(); }
    await Promise.race([sp.catch((e) => console.log('save:', e?.message)), wait(20000)]);
    await page.waitForFunction(() => !window.__pawDev.trackingFor(app).runsDirty, null, { timeout: 20000 }).catch(() => {});
    ok(existsSync(proj) && existsSync(runsFile), `saved ${proj} and its .pawruns (${existsSync(runsFile) ? readFileSync(runsFile).length : 0} bytes)`);
  } else {
    for (let k = 0; k < 6; k++) { await wait(400); await answer(); }
    if (await ev(() => !!app.doc.media)) { await ev(() => app.project.close()); await wait(800); }
    await open(proj); await wait(800);
    await page.waitForFunction(() => window.__pawDev.trackingFor(app).runs.length > 0, null, { timeout: 20000 }).catch(() => {});
    const r = await runState(), one = JSON.parse(readFileSync(single, 'utf8'));
    ok(r.length === 1 && !r[0].restored && r[0].seeds.length === 2 && r[0].seeds.some((s) => s.own === null), `reopened after a restart: one run, both hips seeds kept, the one on B unused (${JSON.stringify(r.map((x) => x.seeds.map((s) => [s.t, s.own])))})`);
    ok(r[0].x.every((v, i) => (v == null ? one[i] == null : Math.abs(v - one[i]) < 1e-5)), 'the hips channel: the single-seed signal');
    await ev(() => { app.setMode('track'); const tr = window.__pawDev.trackingFor(app); tr.selectTracker('fake.groups'); tr.select(tr.runs[0].id); app.doc.range = { t0: 0, t1: app.durationMs }; });
    for (const [k, v] of [['tracking.groups.snap', false], ['tracking.groups.circle', false], ['tracking.groups.grow', false], ['tracking.groups.askAfter', false]]) await ev(([k, v]) => app.settings.set(k, v), [k, v]);
    const n0 = requests().length, put = JSON.parse(readFileSync(gone, 'utf8'));
    await ev((g) => { app.doc.scenes = app.doc.scenes.map((s) => ({ ...s, groups: [...(s.groups || []), g] })); }, put);
    await wait(800);
    const r2 = await runState(), now = r2[0].seeds.find((s) => Math.abs(s.t - B) < 40);
    ok(now && Array.isArray(now.own), `the seed on B put back: stitched again from the kept track (${JSON.stringify(r2[0].seeds.map((s) => [s.t, s.own]))})`);
    ok(requests().length === n0, 'no request');
    await ev(() => { app.doc.scenes = app.doc.scenes.map((s) => ({ ...s, groups: (s.groups || []).map((g) => (g.name === 'c1_hips' && Math.abs(g.t_ms - 4000) < 40 ? { ...g, poly: g.poly.map(([x, y]) => [x + 0.01, y]) } : g)) })); });
    await wait(800);
    const r3 = await runState();
    ok(r3[0].seeds.find((s) => Math.abs(s.t - B) < 40)?.own === null, 'a new painting on B instead: the old track is not used');
    ok((await ev(() => window.__pawDev.trackingFor(app).addPlan())) === null, '... it is a changed seed: T tracks everything again (a new run)');
  }
} catch (e) {
  fails++; console.log('FAIL', e?.stack || e);
} finally {
  await browser.close().catch(() => {});
  console.log(fails ? `${fails} FAILED` : 'all ok');
  process.exit(fails ? 1 : 0);
}
