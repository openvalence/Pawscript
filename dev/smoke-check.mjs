// dev/smoke-check.mjs -- paw-p42x: a smoke test of the Track tab at HEAD on a SAVED project after a RESTART, the owner's way, in
// YOUR test instance (node dev/test-app.mjs start ... with FAKE_REQ_LOG=<file> in its environment; the CDP_* env it prints). Every
// page exception and console error fails it (an exception in a Svelte effect leaves a tool half-mounted or crashes the interface).
//   1. prepare: a generated clip opened alone; 30 shots: scene A = shots 0 + 1 joined by a camera move, its groups painted on two
//      frames (one in each shot) that repeat a part (c1_hips on both: paw-o74b.1, one part seeded twice); 26 short shots; scene
//      B = shots 28 + 29 (a camera move), its groups on shot 28 plus a part seeded later on shot 29 (the second seed); a modifier
//      (Alt+Shift+O); Track ROI (track.run, the fake sidecar), F (a flip); optional owner-like settings (--settings <json>: layout, lanes.*,
//      tracking.groups.* ...); saved beside the clip (.pawproj + .pawruns).
//   2. (restart the app with the same --id) check: open it from Recent, Track tab; on shot 1 G: the dock is up beside the picture,
//      the overlay is mounted, scene A's parts dimmed from its two seed frames (hips once, with both frames); C opens Copy from... (and
//      never lanes.copy), Esc closes it; Go there + a real stroke paints (one undo step); 2 / Tab peek / A / Esc reach the tool;
//      on shot 28 / 29 the second seed is listed as seeded on another frame; Ctrl+T (Track ROI): scene A's groups in ONE request with B's first
//      frame, A's second frame (hips again + tail) and B's later part added (groups only); F flips; a lane grip drag; the Scenes
//      filmstrip paints.
//   node dev/smoke-check.mjs prepare <clip.mp4> <FAKE_REQ_LOG file> [--settings owner.json]
//   node dev/test-app.mjs stop --dir <d>; node dev/test-app.mjs start --dir <d> --target <t> --id <the same id>
//   node dev/smoke-check.mjs check <clip.mp4> <FAKE_REQ_LOG file>
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';

const [phase, clipArg, reqLog] = process.argv.slice(2);
// paw-4c48.18 follow-up: the clip as an absolute path (the app saves the project beside it; a relative one never matched the files
// checked below) and at least MIN_CLIP_MS long (scene B is painted at 11.8 / 13.5 s: on a shorter clip it lies past the end and the
// Track ROI asserts fail for a reason that has nothing to do with the app)
const clip = clipArg && resolve(clipArg), MIN_CLIP_MS = 14000;
const sIx = process.argv.indexOf('--settings'), settingsFile = sIx > 0 ? process.argv[sIx + 1] : null;
if (!['prepare', 'check'].includes(phase) || !clip || !reqLog) { console.error('usage: node dev/smoke-check.mjs prepare|check <clip.mp4> <FAKE_REQ_LOG file> [--settings owner.json]'); process.exit(2); }
const proj = clip.replace(/\.[^.]+$/, '.pawproj'), runsFile = clip.replace(/\.[^.]+$/, '.pawruns');
const requests = () => (existsSync(reqLog) ? readFileSync(reqLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /changed outside/.test(t) ? 'project' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null); });
const G = () => ev(() => { const g = window.__pawDev.groupsFor(app); return { on: g.on, groups: g.groups.map((x) => `${x.name}@${x.t_ms}`), others: g.others.map((x) => `${x.name}@${x.t_ms}`), t: g.t, onFrame: g.onFrame, copy: !!g.copy, peek: !!g.peek, who: g.who, picker: !!g.picker }; });
// (player.shownMs: the playhead resting at t inside the frame on screen; timeMs is that frame's start since e7db632, up to a
// frame (33 ms) before t on the 29.97 fps clip dev/check-all.mjs gives this check)
const seek = async (t) => { await ev((t) => { app.player.pause(); app.player.seek(t, { exact: true }); }, t); await page.waitForFunction((t) => Math.abs(app.player.shownMs - t) < 20 && !app.player.el?.seeking, t, { timeout: 15000 }); await wait(400); };
const video = () => ev(() => { const r = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const hover = async (nx, ny) => { const b = await video(); await page.mouse.move(b.x + nx * b.w, b.y + ny * b.h); await wait(150); };
const press = async (k) => { await page.keyboard.press(k); await wait(350); };
const busyDone = () => page.waitForFunction(() => !window.__pawDev.trackingFor(app).busy, null, { timeout: 90000 });
const SQ = (x, y, w = 0.12, h = 0.12) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const grp = (who, part, t_ms, x, y) => ({ name: `${who}_${part}`, who, part, poly: SQ(x, y), pinned: true, t_ms, source: 'user' });
let A1 = 1000, A2 = 4000, B1 = 11800, B2 = 13500;   // made frame starts once the clip is open

try {
  await page.waitForFunction(() => window.app?.project && window.__pawDev?.groupsFor, null, { timeout: 60000 });
  await ev(() => { const n = app.usage?.note?.bind(app.usage); if (n && !window.__notes) { window.__notes = []; app.usage.note = (k, d, o) => { window.__notes.push(k); if (k === 'app:error') (window.__appErr ??= []).push(JSON.stringify(d ?? null).slice(0, 300)); return n(k, d, o); }; } });
  if (phase === 'prepare') {
    for (const f of [proj, runsFile, reqLog]) if (existsSync(f)) rmSync(f);
    if (settingsFile) await ev((o) => { for (const [k, v] of Object.entries(o)) app.settings.set(k, v); app.settings.set('tracking.groups.corner', [0.1, 0.1]); }, JSON.parse(readFileSync(settingsFile, 'utf8')));
    const p = ev((c) => app.project.openVideo(c, { force: true }), clip);
    for (let k = 0; k < 8; k++) { await wait(500); await answer(); }
    await p.catch(() => {});
    await page.waitForFunction(() => app.doc.media && app.player.ready, null, { timeout: 60000 });
    // the seed frames as the app stamps them: frame starts (player.timeMs is the frame's start since e7db632; on the 29.97 fps clip
    // dev/check-all.mjs gives this check 1000 ms is 32 ms into frame 29, past the Groups tool's 25 ms slack: no groups on it)
    [A1, A2, B1, B2] = await ev((ts) => ts.map((t) => Math.round(app.player.clock.timeOf(app.player.clock.frameAt(t)))), [1000, 4000, 11800, 13500]);
    const D = await ev(() => app.durationMs);
    if (!(D >= MIN_CLIP_MS)) { console.log(`FAIL the clip is ${(D / 1000).toFixed(1)} s: smoke-check needs one of at least ${MIN_CLIP_MS / 1000} s (scene B is painted at 11.8 / 13.5 s)`); await browser.close(); process.exit(1); }
    await ev(([D, gA, gB]) => {
      app.setMode('track'); app.player.pause();
      const S = (a, b, x = {}) => ({ start_ms: a, end_ms: b, ...x });
      const shots = [S(0, 3000, { groups: gA }), S(3000, 5000, { join: true, split: 'camera', groups: gA })];
      for (let k = 0; k < 26; k++) shots.push(S(5000 + k * 250, 5250 + k * 250));
      shots.push(S(11500, 13000, { groups: gB }), S(13000, D, { join: true, split: 'camera', groups: gB }));
      app.doc.scenes = shots;
      app.settings.set('tracking.scenes', 'document');
      const tr = window.__pawDev.trackingFor(app);
      tr.selectTracker('fake.groups');
      app.doc.range = { t0: 0, t1: D };
    }, [D, [grp('c1', 'hips', A1, 0.2, 0.3), grp('c2', 'penis', A1, 0.5, 0.5), grp('c1', 'hips', A2, 0.22, 0.32), grp('c1', 'tail', A2, 0.7, 0.2)],
      [grp('c1', 'hips', B1, 0.3, 0.3), grp('c2', 'penis', B1, 0.5, 0.6), { name: 'unassigned_1', poly: SQ(0.1, 0.7), pinned: true, t_ms: B1, source: 'user' }, grp('c2', 'balls', B2, 0.55, 0.75)]]);
    await page.waitForFunction(() => window.__pawDev.trackingFor(app).trackerId === 'fake.groups', null, { timeout: 15000 });
    ok((await ev(() => app.doc.scenes.length)) === 30, '30 shots');
    await seek(2000); await ev(() => document.activeElement?.blur?.()); await press('Alt+Shift+O');
    ok((await ev(() => (app.doc.fx || []).length)) >= 1, `a modifier over scene A (${await ev(() => JSON.stringify((app.doc.fx || []).map((e) => e.kind)))})`);
    await ev(() => app.commands.run('track.run', { all: true })); await wait(1500); await busyDone(); await wait(800);
    const rq = requests();
    console.log('     requests:', JSON.stringify(rq.map((r) => ({ only: r.groups_only, groups: r.groups.map((g) => `${g.name}@${g.t_ms}`) }))));
    ok(rq.length === 3 && !rq[0].groups_only && rq[1]?.groups_only && rq[2]?.groups_only, `Track ROI: a run and two adds (${rq.length} requests)`);
    ok(rq[0]?.groups.filter((g) => g.t_ms === A1).length === 2 && !rq[0]?.groups.some((g) => g.t_ms === A2), "scene A seeds the run on its first frame");
    ok(JSON.stringify(rq[1]?.groups.map((g) => `${g.name}@${g.t_ms}`)) === `["c1_hips@${A2}","c1_tail@${A2}"]`, "A's second frame added: hips again (another seed) and the tail");
    ok(JSON.stringify(rq[2]?.groups.map((g) => g.name)) === '["c2_balls"]', "scene B's later part is added from its own frame");
    const hs = await ev((A) => (window.__pawDev.trackingFor(app).runs[0]?.groupSeeds || []).filter((s) => s.name === 'c1_hips' && s.t_ms < A).map((s) => [s.t_ms, !!s.track, !!s.own]), 11000);
    ok(hs.length === 2 && hs.every((h) => h[1] && h[2]), `one hips group in scene A, stitched from both seeds (${JSON.stringify(hs)})`);
    ok(!(await ev(() => window.__pawDev.trackingFor(app).error)), `no tracking error (${await ev(() => window.__pawDev.trackingFor(app).error)})`);
    await seek(2000); await ev(() => document.activeElement?.blur?.());
    const f0 = await ev(() => JSON.stringify(window.__pawDev.trackingFor(app).selected?.flips || null));
    await press('f');
    const f1 = await ev(() => JSON.stringify(window.__pawDev.trackingFor(app).selected?.flips || null));
    ok(f1 !== f0, `F flips scene A (${f0} -> ${f1})`);
    const sp = ev(() => app.project.save());
    for (let k = 0; k < 6; k++) { await wait(400); await answer(); }
    await Promise.race([sp.catch((e) => console.log('save:', e?.message)), wait(20000)]);
    await page.waitForFunction(() => !window.__pawDev.trackingFor(app).runsDirty, null, { timeout: 20000 }).catch(() => {});
    // the flip's run refresh can land while that save runs ("Edits made while saving are not saved yet": the document stays dirty);
    // save again until clean, or an autosave lands before the restart and the check meets "Recover unsaved work?" (paw-r73w)
    for (let k = 0; k < 3 && (await ev(() => app.doc.dirty)); k++) {
      await wait(500);
      const again = ev(() => app.project.save());
      for (let j = 0; j < 4; j++) { await wait(300); await answer(); }
      await Promise.race([again.catch(() => {}), wait(20000)]);
    }
    ok(!(await ev(() => app.doc.dirty)), 'saved clean: no autosave left to recover after the restart');
    ok(existsSync(proj) && existsSync(runsFile), `saved ${proj} and its .pawruns`);
  } else {
    // ---- open from Recent, the owner's way ----
    for (let k = 0; k < 6; k++) { await wait(400); await answer(); }
    if (await ev(() => !!app.doc.media)) { await ev(() => app.project.close()); await wait(800); }
    const btn = page.locator('.recent button.open', { hasText: proj.split(/[\\/]/).pop() }).first();
    await btn.waitFor({ timeout: 20000 }).catch(() => {});
    if (await btn.count()) await btn.click();
    else { console.log('     not in Recent (a project saved by another build or profile): opened by path'); ev((f) => app.project.openProject(f, { force: true }), proj).catch(() => {}); }
    for (let k = 0; k < 8; k++) { await wait(500); await answer(); }
    await page.waitForFunction(() => app.doc.media && app.player.ready, null, { timeout: 60000 });
    // the seed frames as the app stamps them: frame starts (player.timeMs is the frame's start since e7db632; on the 29.97 fps clip
    // dev/check-all.mjs gives this check 1000 ms is 32 ms into frame 29, past the Groups tool's 25 ms slack: no groups on it)
    [A1, A2, B1, B2] = await ev((ts) => ts.map((t) => Math.round(app.player.clock.timeOf(app.player.clock.frameAt(t)))), [1000, 4000, 11800, 13500]);
    await page.waitForFunction(() => window.__pawDev.trackingFor(app).runs.length > 0, null, { timeout: 20000 }).catch(() => {});
    const st = await ev(() => ({ shots: app.doc.scenes.length, runs: window.__pawDev.trackingFor(app).runs.length, fx: (app.doc.fx || []).length, flips: window.__pawDev.trackingFor(app).runs.map((r) => JSON.stringify(r.flips || null)) }));
    ok(st.shots === 30 && st.runs === 1 && st.fx >= 1 && st.flips[0] !== 'null', `reopened: ${JSON.stringify(st)}`);
    await ev(() => { app.setMode('track'); const tr = window.__pawDev.trackingFor(app); tr.selectTracker('fake.groups'); if (tr.runs[0]) tr.select(tr.runs[0].id); app.doc.range = { t0: 0, t1: app.durationMs }; });
    await seek(2000); await ev(() => document.activeElement?.blur?.());

    // ---- Tab on scene A between its two seed frames (one part seeded on both) ----
    await press('Tab');
    await page.waitForFunction(() => !!document.querySelector('[data-testid="groups-tools"]'), null, { timeout: 10000 }).catch(() => {});
    const geo = await ev(() => { const d = document.querySelector('[data-testid="groups-tools"]'), s = document.querySelector('[data-testid="video-stage"]'); const R = (e) => e && e.getBoundingClientRect(); const a = R(d), b = R(s); return { dock: !!d && a.width > 0 && a.height > 0, over: !!a && !!b && a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1, canvas: !!s?.querySelector('.gcursor') }; });
    // since 6543984 (paw-i5qx) the tool is a slim translucent bar over the picture's left edge, not a dock beside it
    ok(geo.dock && geo.over, `Tab: the Groups bar is up, over the picture ${JSON.stringify(geo)}`);
    ok(geo.canvas, 'the Groups overlay is mounted (its cursor canvas is on the stage)');
    const rail = await ev(() => { const d = document.querySelector('[data-testid="groups-tools"]'); return { rail: !!d?.classList.contains('col'), row: d?.parentElement?.clientWidth, dock: Math.round(d?.getBoundingClientRect().width || 0) }; });
    console.log('     dock:', JSON.stringify(rail));
    if (rail.rail) { await page.locator('[data-testid="groups-collapse"]').click(); await wait(500); ok(await ev(() => !document.querySelector('[data-testid="groups-tools"]').classList.contains('col')), 'a narrow stage row folds the dock to its rail; one click opens it'); }
    let g = await G();
    ok(g.on && g.groups.length === 0 && g.others.length === 4, `scene A off its seed frames: its four seeds are on other frames (${JSON.stringify(g)})`);
    // "Seeded on other frames" is a section of the Groups list popover since 6543984: opened, read, closed
    const others = async () => {
      await page.locator('[data-testid="groups-list-open"]').click(); await page.locator('[data-testid="groups-others"]').waitFor({ timeout: 3000 }).catch(() => {});
      const r = await ev(() => [...document.querySelectorAll('[data-testid="groups-others"] .grp')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
      await page.locator('[data-testid="groups-list-open"]').click(); await wait(200);
      return r;
    };
    const rows = await others();
    ok(rows.length === 3 && rows.filter((r) => /hips/.test(r)).length === 1 && rows.some((r) => /hips.*f\d+ f\d+/.test(r)), `"Seeded on other frames": hips listed once with both frames (${JSON.stringify(rows)})`);
    ok(g.onFrame && (await ev(() => !!document.querySelector('[data-testid="groups-add-here"]'))), 'off the seed frames: painting here adds a seed, Go there offered');
    // C: Copy from... never lanes.copy
    await ev(() => { window.__notes.length = 0; });
    await press('c');
    g = await G();
    ok(g.copy && (await ev(() => !!document.querySelector('[data-testid="groups-copy"]'))), 'C opens Copy from…');
    ok(!(await ev(() => window.__notes.includes('lanes.copy'))), `C never reaches lanes.copy (${await ev(() => window.__notes.join(','))})`);
    await press('Escape');
    g = await G();
    ok(!g.copy && g.on, 'Esc closes the strip, the tool stays');
    // Go there, a real stroke
    await page.locator('[data-testid="groups-goto-seed"]').first().click(); await wait(800);
    g = await G();
    ok(g.onFrame && Math.abs((await ev(() => app.player.timeMs)) - A1) < 40, 'Go there: on the take\'s frame');
    const h0 = await ev(() => app._history.index), n0 = g.groups.length;
    await ev(() => { const x = window.__pawDev.groupsFor(app); x.disarm?.(); app.settings.set('tracking.groups.grow', false); app.settings.set('tracking.groups.snap', false); app.settings.set('tracking.groups.circle', false); app.settings.set('tracking.groups.askAfter', false); });
    const b = await video();
    await page.keyboard.down('Control');
    await page.mouse.move(b.x + 0.85 * b.w, b.y + 0.85 * b.h); await page.mouse.down();
    for (let k = 1; k <= 8; k++) await page.mouse.move(b.x + (0.85 + 0.006 * k) * b.w, b.y + (0.85 - 0.004 * k) * b.h);
    await page.mouse.up(); await page.keyboard.up('Control'); await wait(600);
    g = await G();
    ok(g.groups.length === n0 + 1 && (await ev(() => app._history.index)) - h0 === 1, `a stroke paints a new group, one undo step (${n0} -> ${g.groups.length})`);
    await ev(() => app.undo()); await wait(300);
    // keys reach the tool
    await hover(0.05, 0.05); await press('2');
    ok((await G()).who === 'c2', `2 sets Top (${(await G()).who})`);
    await press('1');
    await page.keyboard.down('Space'); await hover(0.3, 0.5); await hover(0.5, 0.5); await wait(300);
    const pk = (await G()).peek, pl = await ev(() => app.player.playing);
    await page.keyboard.up('Space'); await wait(500);
    ok(pk && !pl && !(await G()).peek && (await G()).on, 'Space + mouse move peeks (no play), release ends it, the tool stays open');
    await hover(0.26, 0.36); await press('a');
    const pick = (await G()).picker;
    if (!pick) {   // what is under the pointer there (the bar, its notes card, a popover?), and the stage as painted
      const b2 = await video();
      console.log('     at the A target:', JSON.stringify(await ev(([x, y]) => [...document.elementsFromPoint(x, y)].slice(0, 5).map((e) => `${e.tagName}.${[...e.classList].join('.')}${e.dataset.testid ? '#' + e.dataset.testid : ''}`), [b2.x + 0.26 * b2.w, b2.y + 0.36 * b2.h])));
      if (process.env.SHOT_DIR) await page.locator('[data-testid="video-stage"]').screenshot({ path: `${process.env.SHOT_DIR}/smoke-picker.png` }).catch(() => {});
    }
    ok(pick, 'A over a group opens the picker');
    if (pick) await press('Escape');
    // shot 28 / 29: the second seed is listed as seeded on another frame
    await seek(B2); await wait(500);
    g = await G();
    ok(g.groups.length === 1 && g.others.length === 3, `shot 29: its own part, the take's others listed (${JSON.stringify([g.groups, g.others])})`);
    ok((await others()).length === 3, '"Seeded on other frames" lists them');
    await seek(B1); await wait(500);
    g = await G();
    ok(g.groups.length === 3 && g.others.length === 1, `shot 28: its three, the later one listed (${JSON.stringify([g.groups, g.others])})`);
    await press('Escape');
    ok(!(await G()).on, 'Esc closes the tool');

    // ---- Ctrl+T (Track ROI; paw-rw84: T is the point grid now): scene A as one set, B's later part added ----
    const n1 = requests().length;
    await seek(A2); await ev(() => document.activeElement?.blur?.());
    // paw-x8we: Ctrl+T with several parts painted asks which; its last row tracks every painted part (what this phase checks)
    await press('Control+t'); await page.locator('[role=menu] [role=menuitem]', { hasText: 'Every painted part' }).click({ timeout: 5000 });
    await wait(1500); await busyDone(); await wait(800);
    const rq = requests().slice(n1);
    console.log('     requests:', JSON.stringify(rq.map((r) => ({ only: r.groups_only, groups: r.groups.map((x) => `${x.name}@${x.t_ms}`) }))));
    ok(rq.length === 3 && !rq[0].groups_only && rq[0].groups.filter((x) => x.t_ms === A1).length === 2 && rq[1]?.groups_only && rq[1].groups.length === 2 && rq[2]?.groups_only && rq[2].groups.length === 1, 'Ctrl+T (nothing new for the run: a new run): scene A from its first frame, its second frame and B\'s later part added');
    ok(!(await ev(() => window.__pawDev.trackingFor(app).error)), `no tracking error (${await ev(() => window.__pawDev.trackingFor(app).error)})`);
    // F
    await seek(2000); await ev(() => document.activeElement?.blur?.());
    const f0 = await ev(() => JSON.stringify(window.__pawDev.trackingFor(app).selected?.flips || null));
    await press('f');
    ok((await ev(() => JSON.stringify(window.__pawDev.trackingFor(app).selected?.flips || null))) !== f0, 'F flips');
    // a lane grip
    // the last lane's grip: down, else up (a layout at a limit holds one way: dev/lanes-resize-check.mjs covers which)
    const sizes = () => ev(() => [document.querySelector('.areas > [data-area=timeline]')?.getBoundingClientRect().height, ...[...document.querySelectorAll('[data-area=timeline] .lrow .canvas')].map((e) => Math.round(e.getBoundingClientRect().height))].join(' '));
    const gripDrag = async (dy) => {
      const grip = await ev(() => { const e = [...document.querySelectorAll('[data-area=timeline] .lrow .split')].at(-1); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      if (!grip) return false;
      await page.mouse.move(grip.x, grip.y); await page.mouse.down(); for (let k = 1; k <= 10; k++) await page.mouse.move(grip.x, grip.y + (dy * k) / 10); await page.mouse.up(); await wait(400);
      return true;
    };
    const z0 = await sizes(), g1 = await gripDrag(40), z1 = await sizes(), z2 = z1 === z0 && g1 && (await gripDrag(-40)) ? await sizes() : z1;
    ok(g1 && z2 !== z0, `a lane grip drag resizes (timeline, lanes: ${z0} -> ${z2})`);
    // the filmstrip paints
    await ev(() => app.setMode('scenes')); await wait(2500);
    const film = await ev(() => { const l = document.querySelector('[data-tl-lane="filmstrip"]'); const c = l?.querySelector('canvas'); if (!c) return { lane: !!l, colours: 0 }; try { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, s = new Set(); for (let i = 0; i < d.length; i += 4 * 97) s.add((d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4)); return { lane: true, colours: s.size }; } catch (e) { return { lane: true, colours: -1, err: String(e) }; } });
    ok(film.lane && film.colours > 20, `the Scenes filmstrip paints (${JSON.stringify(film)})`);
    await ev(() => app.setMode('track'));
  }
  const errs = await ev(() => (window.__notes || []).filter((k) => k === 'app:error').length);
  ok(errs === 0, `no app:error in the usage log (${errs}${errs ? ': ' + (await ev(() => (window.__appErr || []).join(' | '))) : ''})`);
} catch (e) {
  fails++; console.log('FAIL', e?.stack || e);
} finally {
  await browser.close().catch(() => {});
  console.log(fails ? `${fails} FAILED` : 'all ok');
  process.exit(fails ? 1 : 0);
}
