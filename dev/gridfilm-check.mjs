// dev/gridfilm-check.mjs -- paw-rw84 in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints), on an
// index clip (node dev/make-index-clip.mjs <out.mp4> 780 30 600: 13 minutes, each frame's index in the middle of the picture):
//   1. the lane toolbar: Groups, Track (primary), Track ROI in that order; Track and T send a grid request (tracker
//      tapnext_points, the whole-frame box, box_seed grid), Track ROI and Ctrl+T the panel's tracker with the drawn box; the
//      Groups button counts the take's painted groups, enters and leaves the tool (pressed while open); the row does not
//      overflow at 2560 / 1600 / 1280 / 1000 px. The fake sidecar lists no point tracker: a stand-in tapnext_points entry is
//      listed in the page and its requests go on to the fake's box tracker (each recorded as the app sent it).
//   2. the Scenes filmstrip: a long shot shows its edge tiles and fillers between them, a gap of lane background at each edge
//      tile, every tile read out of a screenshot (its index) = the frame the lane says; edge tiles = the cut frames; at fit zoom,
//      panned (the same frames), zoomed in; the time until every filler is exact, decodes per second, stale asks dropped on a
//      pan; playback with fillers loading: rAF intervals and presented video frames vs the same with nothing to load.
//   node dev/gridfilm-check.mjs <clip> [--shots <dir>] [--json out.json] [--no-cache]
import { writeFileSync, mkdirSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';
const argv = process.argv.slice(2), opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
const clip = argv[0], shots = opt('--shots'), jsonOut = opt('--json'), NOCACHE = argv.includes('--no-cache');
if (!clip) { console.error('usage: node dev/gridfilm-check.mjs <clip> [--shots dir] [--json out] [--no-cache]'); process.exit(2); }
if (shots) mkdirSync(shots, { recursive: true });
const { browser: b, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); return c; };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
const BAND = [650 / 1400, 750 / 1400], LIFT = 10, PAD = 2;
const out = { info: null, perf: {} };

try {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.reload(); await page.waitForFunction(() => window.app?.project, null, { timeout: 30000 }); await wait(1500);   // a clean page: no wrappers or caches from an earlier run
  for (let k = 0; k < 3; k++) {   // an earlier run's autosave / question can swallow the first open
    await ev(async ([p, cache]) => {
      clearInterval(window.__noRecover);
      window.__noRecover = setInterval(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /changed outside/.test(t) ? 'project' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null, { trusted: true }); }, 150);   // this instance's own earlier run: drop it
      window.__film = null; globalThis.__pawFilmLog = (e) => { window.__film = e; };
      app.settings.set('video.scrubCache', cache); app.settings.set('lanes.hoverScrub', false); app.settings.set('timeline.frameCursor', 'off');
      await app.project.openVideo(p, { force: true });
    }, [clip, !NOCACHE]);
    if (await page.waitForFunction(() => app.doc.media && (app.player.error || (app.player.ready && app.player.vw > 0)), null, { timeout: 20000 }).then(() => true, () => false)) break;
  }
  await wait(1500);
  if (!NOCACHE) await page.waitForFunction(() => app.player.scrubCache?.state === 'ready', null, { timeout: 900000, polling: 1000 });
  const info = out.info = await ev(() => ({ fps: app.player.media.fps, frameMs: app.player.frameMs, count: app.player.clock.count, dur: app.durationMs, cache: app.player.scrubCache?.state ?? null }));
  console.log(JSON.stringify(info));
  const fms = info.frameMs, at = (n) => Math.round(n * fms);
  // shots: cuts at these frames; shot index 3 (frames 9000 .. 20000, 'Shot 4') is the long one
  const cuts = [3000, 3600, 9000, 20000], B = [0, ...cuts, info.count];
  const list = B.slice(0, -1).map((n, i) => ({ start_ms: at(n), end_ms: i === B.length - 2 ? info.dur : at(B[i + 1]) }));
  await ev((l) => { app.transact('check shots', () => { app.doc.scenes = l; }); app.player.seek(0); }, list);

  // ================= 1. the toolbar buttons =================
  await ev(() => { app.setMode('track'); app.player.pause(); });
  await page.waitForFunction(() => { const t = window.__pawDev.trackingFor(app); return t.listed && t.busy !== 'list'; }, null, { timeout: 30000 });
  await wait(1500);
  const shim = await ev(() => {
    const tr = window.__pawDev.trackingFor(app), be = app.backend, orig = be.sidecar.bind(be);
    window.__reqs = [];
    const fakeBox = tr.trackers.find((t) => t.id === 'fake.box'), real = tr.trackers.some((t) => t.id === 'tapnext_points' && !/stand-in/.test(t.name));
    window.__standIn = () => { if (!real && !tr.trackers.some((t) => t.id === 'tapnext_points')) tr.trackers = [...tr.trackers, { id: 'tapnext_points', name: 'TAPNext++ points (check stand-in)', roi: 'box_or_points', channels: [], params: [...fakeBox.params, { key: 'box_seed', type: 'choice', default: 'features', choices: ['features', 'grid'] }, { key: 'box_points', type: 'int', default: 256 }] }]; };
    window.__standIn();
    const keep = new Set(fakeBox.params.map((p) => p.key));
    be.sidecar = (req, o) => {
      if (req?.cmd === 'track') window.__reqs.push(JSON.parse(JSON.stringify({ tracker: req.tracker, roi: req.roi, box_seed: req.params?.box_seed ?? null, box_points: req.params?.box_points ?? null, start_ms: req.start_ms, end_ms: req.end_ms })));
      if (!real && req?.cmd === 'track' && req.tracker === 'tapnext_points') req = { ...req, tracker: 'fake.box', params: Object.fromEntries(Object.entries(req.params || {}).filter(([k]) => keep.has(k))) };
      return orig(req, o);
    };
    tr.selectTracker('fake.box');
    return real ? 'the sidecar lists tapnext_points' : 'a stand-in tapnext_points (sent on to fake.box)';
  });
  console.log('     grid tracker: ' + shim);
  // the long shot selected (the chips act on it), the playhead inside it
  await ev((t) => { app.player.seek(t); }, at(3300)); await wait(400);   // shot 1 (20 s): the chips act on it
  const row = () => ev(() => {
    const c = document.querySelector('.chips[data-target]'); if (!c) return null;
    const bs = [...c.querySelectorAll('[data-btn]')].map((e) => ({ id: e.dataset.btn, text: e.textContent.trim(), primary: e.classList.contains('kit-button-v-primary'), pressed: e.getAttribute('aria-pressed'), disabled: e.disabled, r: (({ x, width }) => [Math.round(x), Math.round(width)])(e.getBoundingClientRect()) }));
    const r = c.getBoundingClientRect();
    return { w: Math.round(c.clientWidth), sw: c.scrollWidth, right: Math.round(r.right), bs };
  });
  let R = await row();
  console.log('     row: ' + JSON.stringify(R));
  ok(R && R.bs.map((x) => x.id).join() === 'groups,track,track-roi,track-menu', `the order: Groups, Track, Track ROI, cog (paw-unuy: the tracker's settings), Track ROI (${R?.bs.map((x) => x.id)})`);
  ok(R?.bs.find((x) => x.id === 'track')?.primary && !R.bs.find((x) => x.id === 'track-roi')?.primary, 'Track is the primary button, Track ROI is not');
  const reqsNow = () => ev(() => window.__reqs.length);
  const busyDone = () => page.waitForFunction(() => !window.__pawDev.trackingFor(app).busy, null, { timeout: 60000 });
  const lastReq = () => ev(() => window.__reqs.at(-1));
  const isGrid = (q) => q?.tracker === 'tapnext_points' && q.box_seed === 'grid' && q.roi?.kind === 'box' && q.roi.x === 0 && q.roi.y === 0 && q.roi.w === 1 && q.roi.h === 1;
  const idle = async () => { await ev(() => app.player.pause()); await busyDone(); await wait(200); await ev(() => window.__standIn()); };
  await idle();
  let n0 = await reqsNow();
  await page.click('.chips[data-target] [data-btn="track"]'); await wait(500); await busyDone(); await wait(300);
  let q = await lastReq();
  ok((await reqsNow()) > n0 && isGrid(q), `Track (the button) sends a grid request (${JSON.stringify(q)})`);
  await idle(); await ev(() => { document.activeElement?.blur?.(); });
  n0 = await reqsNow();
  await page.keyboard.press('t'); await wait(500); await busyDone(); await wait(300);
  q = await lastReq();
  ok((await reqsNow()) > n0 && isGrid(q), `T sends a grid request (${q?.tracker}, ${q?.box_seed})`);
  // Track ROI: the panel's tracker with a drawn box
  await ev(() => { const tr = window.__pawDev.trackingFor(app); tr.selectTracker('fake.box'); tr.roi = { kind: 'box', x: 0.3, y: 0.3, w: 0.2, h: 0.2, t_ms: app.player.timeMs }; });
  await idle();
  n0 = await reqsNow();
  await page.click('.chips[data-target] [data-btn="track-roi"]'); await wait(500); await busyDone(); await wait(300);
  q = await lastReq();
  ok((await reqsNow()) > n0 && q?.tracker === 'fake.box' && q.box_seed === null && q.roi?.w === 0.2, `Track ROI (the button) tracks the panel's tracker with the drawn box (${JSON.stringify(q)})`);
  await ev(() => { const tr = window.__pawDev.trackingFor(app); tr.roi = { kind: 'box', x: 0.4, y: 0.3, w: 0.25, h: 0.2, t_ms: app.player.timeMs }; document.activeElement?.blur?.(); });
  await idle(); await ev(() => document.activeElement?.blur?.());
  n0 = await reqsNow();
  await page.keyboard.press('Control+t'); await wait(500); await busyDone(); await wait(300);
  q = await lastReq();
  ok((await reqsNow()) > n0 && q?.tracker === 'fake.box' && q.roi?.w === 0.25, `Ctrl+T tracks the ROI (${q?.tracker}, w ${q?.roi?.w})`);
  // Track with no point tracker: the button says why
  await ev(() => { const tr = window.__pawDev.trackingFor(app); window.__trk = tr.trackers; tr.trackers = tr.trackers.filter((t) => !['tapnext_points', 'cotracker_points'].includes(t.id)); window.__toasts = []; const t0 = app.toast.bind(app); app.toast = (m, ...r) => { window.__toasts.push(m); return t0(m, ...r); }; });
  await wait(200);
  n0 = await reqsNow();
  await page.click('.chips[data-target] [data-btn="track"]'); await wait(300);
  const why = await ev(() => window.__toasts.at(-1));
  ok((await reqsNow()) === n0 && /needs a point tracker/.test(why || ''), `no point tracker: Track says why ("${why}")`);
  await ev(() => { window.__pawDev.trackingFor(app).trackers = window.__trk; });
  // Groups: the count, enter / leave
  await idle();
  const SQ = (x, y) => [[x, y], [x + 0.1, y], [x + 0.1, y + 0.1], [x, y + 0.1]];
  await ev(([t, a, b]) => { const l = app.doc.scenes.map((s, k) => (k === 1 ? { ...s, groups: [{ name: 'c1_hips', who: 'c1', part: 'hips', poly: a, pinned: true, t_ms: t, source: 'user' }, { name: 'c2_penis', who: 'c2', part: 'penis', poly: b, pinned: true, t_ms: t, source: 'user' }] } : s)); app.transact('groups', () => { app.doc.scenes = l; }); }, [at(3100), SQ(0.2, 0.3), SQ(0.5, 0.5)]);
  await wait(300);
  console.log('     painted: ' + await ev(() => (app.doc.scenes[1].groups || []).map((g) => g.name).join(', ')));
  R = await row();
  const gbtn = () => R.bs.find((x) => x.id === 'groups');
  ok(/2/.test(gbtn()?.text || '') && gbtn()?.pressed === 'false' && !gbtn()?.disabled, `Groups shows the take's 2 painted groups, not pressed (${JSON.stringify(gbtn())})`);
  if (shots) await page.screenshot({ path: `${shots}/1-row.png`, clip: await ev(() => { const r = document.querySelector('.chips[data-target]').getBoundingClientRect(); return { x: Math.max(0, r.x - 8), y: r.y - 6, width: Math.min(innerWidth - r.x + 8, r.width + 16), height: r.height + 12 }; }) });
  await idle();
  await page.click('.chips[data-target] [data-btn="groups"]'); await wait(500);
  R = await row();
  const gOn = await ev(() => window.__pawDev.groupsFor(app).on);
  ok(gOn && gbtn()?.pressed === 'true', `Groups enters the tool, pressed (${gOn}, ${gbtn()?.pressed})`);
  if (shots) await page.screenshot({ path: `${shots}/2-groups-open.png` });
  await page.click('.chips[data-target] [data-btn="groups"]'); await wait(400);
  R = await row();
  ok(!(await ev(() => window.__pawDev.groupsFor(app).on)) && gbtn()?.pressed === 'false', 'Groups again leaves it');
  // widths: never a second line, never past the row
  for (const W of [2560, 1600, 1280, 1000]) {
    await page.setViewportSize({ width: W, height: 1000 }); await wait(500);
    R = await row();
    const over = R ? R.sw > R.w + 1 : true;
    const words = R?.bs.map((x) => `${x.id}:${x.text || '(icon)'}`).join(' ');
    ok(R && !over, `${W} px: the chips row fits (slot ${R?.w}, content ${R?.sw}; ${R?.bs.length ? words : 'buttons in the Tracker popover'})`);
    if (shots) await page.screenshot({ path: `${shots}/3-row-${W}.png`, clip: { x: 0, y: await ev(() => Math.max(0, document.querySelector('.chips[data-target]')?.getBoundingClientRect().y - 8 || 0)), width: W, height: 40 } });
  }
  await page.setViewportSize({ width: 1600, height: 1000 }); await wait(400);

  // ================= 2. the filmstrip =================
  await ev(() => { app.setMode('scenes'); app.player.pause(); }); await wait(800);
  const lane = () => ev(() => { const e = document.querySelector('[data-tl-lane="filmstrip"]'), r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: e.clientWidth, h: e.clientHeight, view: { ...app.view } }; });
  const geomNow = () => ev(() => window.__film);
  const setView = (v) => ev((v) => { window.__film = null; app.setView(v); }, v);
  const panBy = (d) => ev((d) => { window.__film = null; app.setView({ start: app.view.start + d, span: app.view.span }); }, d);
  /** Read the index painted in each rect ([x, w] in lane px) from one screenshot; plus the colour at each gap column. */
  async function readRow(L, rects, gaps) {
    const fh = L.h - LIFT - 2 * PAD, y0 = LIFT + PAD;
    const png = (await page.screenshot({ clip: { x: Math.floor(L.x), y: Math.floor(L.y), width: Math.floor(L.w), height: Math.floor(L.h) }, scale: 'css' })).toString('base64');
    return ev(async ([png, rects, gaps, ys, ymid]) => {
      const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + png)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
      const rgb = (px, py) => [...x.getImageData(Math.max(0, Math.min(bmp.width - 1, Math.floor(px))), Math.round(py), 1, 1).data.slice(0, 3)];
      const nums = rects.map(([rx, rw]) => {
        const px = (i, y) => { const d = x.getImageData(Math.floor(rx + ((i + 0.5) * rw) / 16), Math.round(y), 1, 1).data; return (d[0] + d[1] + d[2]) / 3; };
        const hi = px(0, ys[0]), lo = px(15, ys[0]);
        if (hi - lo < 60) return -1;
        const mid = (hi + lo) / 2;
        let n = 0;
        for (let i = 1; i <= 14; i++) { const a = px(i, ys[0]) > mid, b2 = px(i, ys[1]) > mid; if (a === b2) return -1; n = n * 2 + (a ? 1 : 0); }
        return n;
      });
      const bg = rgb(bmp.width - 1, 2);   // the lane's background (above the LIFT, right edge)
      const gapCols = gaps.map(([gx, gw]) => { const cs = []; for (let k = 1; k < Math.floor(gw) - 1; k++) cs.push(rgb(gx + k + 0.5, ymid));   /* inner columns: the edges blend */ return cs; });
      return { nums, bg, gapCols };   // the clip's index is 14 bits: frame n reads n % 16384
    }, [png, rects, gaps, BAND.map((f) => y0 + fh * f), y0 + fh * 0.3]);
  }
  /** Wait until the lane says every tile (edges + fillers) is exact, then read; -> {ms, g, read}. */
  async function settle(label, maxMs = 120000) {
    const t0 = Date.now();
    await page.waitForFunction(() => window.__film && window.__film.fillIdle, null, { timeout: maxMs, polling: 50 }).catch(() => {});
    const ms = Date.now() - t0;
    await wait(150);
    const L = await lane(), g0 = (await geomNow()).geom, vis = (x, w) => x >= 0 && x + w <= L.w;   // whole tiles on screen are read
    const g = { ...g0, edges: g0.edges.filter((e) => vis(e[1], e[2])), fills: g0.fills.filter((f) => vis(f[1], f[2])), gaps: g0.gaps.filter((x) => vis(x[1], x[2])) };
    const rects = [...g.edges.map((e) => [e[1], e[2]]), ...g.fills.map((f) => [f[1], f[2]])];
    const read = await readRow(L, rects, g.gaps.map((x) => [x[1], x[2]]));
    const ne = g.edges.length;
    let badE = 0, badF = 0, unread = 0;
    g.edges.forEach((e, k) => { const got = read.nums[k]; if (e[2] >= (L.h - LIFT - 2 * PAD) * 1.1 && got !== e[3] % 16384) { if (got < 0) unread++; else badE++; } });   // cropped edge tiles (narrow shots) are not read
    const wrong = [];
    g.fills.forEach((f, k) => { const got = read.nums[ne + k]; if (got !== f[3] % 16384) { wrong.push(`shot ${f[0]} x ${f[1].toFixed(0)}: want ${f[3]} got ${got}`); if (got < 0) unread++; else badF++; } });
    if (wrong.length) console.log('     ' + label + ' wrong fillers: ' + wrong.join('; '));
    const bgOk = read.gapCols.every((cs) => cs.length >= 4 && cs.every((c) => c.every((v, i) => Math.abs(v - read.bg[i]) <= 3)));
    console.log(`     ${label}: ${g.edges.length} edge tiles, ${g.fills.length} fillers, ${g.gaps.length} gaps read (${g0.fills.length} fillers in all; gaps ${g.gaps.map((x) => x[2].toFixed(1)).join(' / ')} px); exact in ${ms} ms`);
    return { ms, g, read, badE, badF, unread, bgOk, L };
  }
  const shot = async (name) => { if (shots) { const L = await lane(); await page.screenshot({ path: `${shots}/${name}.png`, clip: { x: L.x, y: L.y - 4, width: L.w, height: L.h + 8 } }); } };
  // fit zoom: the whole video
  await setView({ start: 0, span: info.dur }); await wait(300);
  const calls = await ev(() => { window.__still = []; const p = app.player, s = p.still.bind(p); p.still = (n, h) => { window.__still.push({ n, t: performance.now() }); return s(n, h); }; return true; });
  let r = await settle('fit');
  out.perf.fit = { ms: r.ms, fills: r.g.fills.length, edges: r.g.edges.length, decodes: await ev(() => window.__still.length) };
  ok(r.g.fills.length > 0 && r.g.gaps.length >= 2, `fit zoom: the long shot has fillers (${r.g.fills.filter((f) => f[0] === 3).length}) and its gaps`);
  ok(!r.badE && !r.badF && !r.unread, `fit zoom: every tile is its frame (edges wrong ${r.badE}, fillers wrong ${r.badF}, unread ${r.unread})`);
  ok(r.bgOk, `fit zoom: the gaps are lane background (${JSON.stringify(r.read.gapCols.map((cs) => cs[1]))} vs ${r.read.bg})`);
  const edgeWant = (e) => (e[4] === 'first' ? B[e[0]] : Math.min(info.count - 1, B[e[0] + 1] - 1));
  ok(r.g.edges.every((e) => e[3] === edgeWant(e)), `the edge tiles are the cut frames (${r.g.edges.map((e) => `${e[4][0]}${e[3]}`).join(' ')})`);
  const fitFills = r.g.fills.filter((f) => f[0] === 3).map((f) => f[3]);
  // each filler: the frame at its own centre time (lane px -> ms)
  const centreOk = (rr) => rr.g.fills.every((f) => { const t = rr.L.view.start + ((f[1] + f[2] / 2) / rr.L.w) * rr.L.view.span, n = Math.min(info.count - 1, Math.floor(t / fms + 1e-6)); return Math.abs(n - f[3]) <= 1; });
  ok(centreOk(r), 'fit zoom: each filler is the frame at its centre (within the ms rounding: 1 frame)');
  await shot('4-film-fit');
  // pan by 37 % of the view (zoomed so the long shot is wider than the screen): the same frames, moved
  const spanZ = 120000;
  await setView({ start: at(9000) - 5000, span: spanZ });
  r = await settle('2 min window at the long shot start');
  out.perf.window2m = { ms: r.ms, fills: r.g.fills.length };
  const fillsA = r.g.fills.filter((f) => f[0] === 3).map((f) => f[3]);
  ok(!r.badE && !r.badF && !r.unread && r.bgOk, `2 min window: every tile exact (wrong ${r.badE}/${r.badF}, unread ${r.unread}), gap ${r.bgOk ? 'background' : 'NOT background'}`);
  await shot('5-film-2min');
  await ev(() => { window.__still = []; });
  await panBy(spanZ * 0.37);
  r = await settle('panned 37 %');
  const fillsB = r.g.fills.filter((f) => f[0] === 3).map((f) => f[3]);
  const common = fillsB.filter((n) => fillsA.includes(n)).length;
  ok(!r.badE && !r.badF && !r.unread, `panned: every tile exact (wrong ${r.badE}/${r.badF}, unread ${r.unread})`);
  ok(common >= Math.min(fillsA.length, fillsB.length) * 0.5 && fillsB.every((n, k) => !k || n > fillsB[k - 1]), `panned: the fillers kept their frames (${common} shared of ${fillsA.length} / ${fillsB.length}), in order`);
  out.perf.pan = { ms: r.ms, decodes: await ev(() => window.__still.length), newFills: fillsB.length - common };
  await shot('6-film-panned');
  // zoomed in: 20 s inside the long shot: the view inside one shot is all fillers, as many whole pictures as the lane holds. That
  // number is the lane's own geometry (filmstrip.js: a picture fh x aspect wide, FILL_GUT apart, fh = lane height - LIFT - 2 PAD;
  // the filmstrip takes the timeline's leftover height, so a taller timeline gives fewer, wider fillers): the "> 5" written at
  // a8ea456 held for the lane of that day, today's at 1600 x 1000 holds 3 whole ones. Every whole picture that fits is asked.
  await ev(() => { window.__still = []; });
  await setView({ start: at(14000), span: 20000 });
  r = await settle('zoomed in (20 s)');
  out.perf.zoomIn = { ms: r.ms, fills: r.g.fills.length, decodes: await ev(() => window.__still.length) };
  const asp = await ev(() => app.doc.media.width / app.doc.media.height), fw = (r.L.h - LIFT - 2 * PAD) * asp, kFit = Math.floor((r.L.w - fw) / (fw + 2));   // whole pictures on screen at any phase (FILL_GUT 2)
  console.log(`     lane ${r.L.w} x ${r.L.h} px: a filler ${fw.toFixed(0)} px wide, ${kFit} whole ones fit`);
  ok(kFit >= 2 && r.g.fills.length >= kFit && !r.badF && !r.unread && centreOk(r), `zoomed in: ${r.g.fills.length} fillers (${kFit} fit), each its centre frame (wrong ${r.badF}, unread ${r.unread})`);
  await shot('7-film-zoomed');
  // stale asks dropped: 8 quick pans, then idle: the decodes are far fewer than the fillers asked on the way. One pan per
  // painted frame: 40 ms apart (plus the CDP round trip) a lane of few wide fillers (3-5 a view, above) let the one-at-a-time
  // decoder (~90 a second on the second PC) finish each view before the next pan, so nothing was stale to drop (42 decodes for
  // 41 fillers asked); a pan per frame outruns any decoder, whatever the lane's height
  await ev(() => { window.__still = []; window.__asked = new Set(); const f0 = globalThis.__pawFilmLog; globalThis.__pawFilmLog = (e) => { f0(e); for (const f of e.geom.fills) window.__asked.add(f[3]); }; });
  await ev(async () => { for (let k = 0; k < 8; k++) { window.__film = null; app.setView({ start: app.view.start + 25000, span: app.view.span }); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); } });
  r = await settle('after 8 quick pans');
  const st = await ev(() => ({ decodes: window.__still.length, asked: window.__asked.size }));
  out.perf.quickPans = { ...st, msAfterLast: r.ms };
  ok(!r.badF && !r.unread && st.decodes < st.asked, `quick pans: exact at the end, ${st.decodes} decodes for ${st.asked} fillers asked on the way (stale ones dropped)`);
  // decodes per second (the zoomed-in fill)
  out.perf.decodesPerS = out.perf.zoomIn.ms ? +(out.perf.zoomIn.decodes / (out.perf.zoomIn.ms / 1000)).toFixed(1) : null;
  // playback while fillers load vs nothing to load
  const playMeasure = (fresh) => ev(async ([fresh, d]) => {
    const p = app.player, v = p.el;
    window.__film = null;
    if (fresh) app.setView({ start: d * 0.55 + Math.random() * 20000, span: 20000 }); else app.setView({ ...app.view });
    window.__still = [];
    await new Promise((r) => setTimeout(r, 50));
    p.seek(app.view.start + 2000); await new Promise((r) => setTimeout(r, 400));
    const raf = [], vf = [];
    let stop = false, last = performance.now();
    const f = () => { const n = performance.now(); raf.push(n - last); last = n; if (!stop) requestAnimationFrame(f); };
    const vfc = (now, m) => { vf.push(m.presentedFrames); if (!stop) v.requestVideoFrameCallback(vfc); };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(vfc);
    requestAnimationFrame(f);
    p.play();
    await new Promise((r) => setTimeout(r, 3000));
    stop = true; p.pause();
    raf.sort((a, b) => a - b);
    const q = (x) => +raf[Math.min(raf.length - 1, Math.floor(raf.length * x))].toFixed(1);
    return { frames: raf.length, p50: q(0.5), p95: q(0.95), max: +raf.at(-1).toFixed(1), presented: vf.length ? vf.at(-1) - vf[0] : null, fillDecodes: window.__still.length, fps: p.media.fps };
  }, [fresh, info.dur]);
  await setView({ start: info.dur * 0.3, span: 20000 }); await settle('playback baseline window');
  const base = await playMeasure(false);
  const load = await playMeasure(true);
  out.perf.playback = { cached: base, loading: load };
  console.log('     playback, nothing to load: ' + JSON.stringify(base));
  console.log('     playback, fillers loading: ' + JSON.stringify(load));
  ok(load.p95 <= Math.max(base.p95 * 1.5, 25) && (load.presented ?? 0) >= (base.presented ?? 0) * 0.9, `playback stays smooth while fillers load (rAF p95 ${load.p95} vs ${base.p95} ms; video frames ${load.presented} vs ${base.presented} in 3 s; ${load.fillDecodes} decodes meanwhile)`);
  await ev(() => { window.__film = null; app.setView({ ...app.view }); });
  r = await settle('after playback');
  ok(!r.badF && !r.unread, 'after playback: the fillers are exact');
  console.log('perf: ' + JSON.stringify(out.perf));
} catch (e) {
  fails++; console.log('FAIL', e?.stack || e);
} finally {
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 1));
  await page.mouse.move(10, 10).catch(() => {});
  await b.close().catch(() => {});
  console.log(fails ? `${fails} FAILED` : 'all ok');
  process.exit(fails ? 1 : 0);
}
