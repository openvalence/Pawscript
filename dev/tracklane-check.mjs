// dev/tracklane-check.mjs -- paw-unuy in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints), on a generated
// clip (node dev/make-index-clip.mjs <out.mp4> 20 30 600) and the fake sidecar: the Track tab's combined lane.
//   1. Track a shot (the Track button; the fake lists no point tracker: a stand-in tapnext_points goes on to fake.mask, as
//      dev/gridfilm-check.mjs); the stroke lane draws the run's trace (the tracker layer under its points) and the run's points;
//   2. no separate Tracker row and no shot-number strip on the Track tab;
//   3. the shot's inspector band: one row, ▾ unfolds it in place (the Adjust strip inside), the source picked from its chip;
//   4. the tracker's settings: the ▾ beside Track opens them, the point count changes there; a right-click on Track opens them too;
//   5. the rows and the stroke lane's height at 1920 x 1080 and 1280 x 720 (--json writes them), a screenshot of the Track tab.
//   node dev/tracklane-check.mjs <clip> [--before] [--shot <png>] [--json <out.json>]
//   --before: only 5 (the build before paw-unuy: the Tracker row, the tracker chip), for the comparison
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';
import { runCtl, runClose, runBarCount } from './run-bar.mjs';
const argv = process.argv.slice(2), opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
const clip = argv[0], BEFORE = argv.includes('--before'), shotPng = opt('--shot'), jsonOut = opt('--json');
if (!clip) { console.error('usage: node dev/tracklane-check.mjs <clip> [--before] [--shot png] [--json out]'); process.exit(2); }
const { browser: b, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); return c; };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
const out = { sizes: {} };

/** The timeline's rows and the stroke lane, in px. */
const measure = () => ev(() => {
  const H = (el) => (el ? Math.round(el.getBoundingClientRect().height) : 0);
  const rows = [...document.querySelectorAll('[aria-label="Timeline"] > .row')].map((r) => ({ id: r.dataset.row, h: H(r) }));
  const lane = document.querySelector('.lrow[aria-label="stroke lane"] .lane');
  return { rows, timeline: H(document.querySelector('[aria-label="Timeline"]')), stroke: H(lane), strokeRow: H(document.querySelector('.lrow[aria-label="stroke lane"]')),
    edge: H(document.querySelector('[data-testid="lane-edge"]')), edgeIn: (() => { const e = document.querySelector('[data-testid="lane-edge"]')?.getBoundingClientRect(), l = lane?.getBoundingClientRect(); return !e || (!!l && Math.abs(e.bottom - l.bottom) <= 1 && e.top >= l.top); })(),
    toolbar: H(document.querySelector('.stack .bar')), trackerRow: H(document.querySelector('[data-row="tracking"]')),
    strips: [...document.querySelectorAll('[data-tracklane] > :not(.cv)')].map((e) => ({ cls: e.className.split(' ').filter((c) => !c.startsWith('s-')).join(' '), h: H(e) })) };
});

try {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.reload(); await page.waitForFunction(() => window.app?.project, null, { timeout: 30000 }); await wait(1500);
  for (let k = 0; k < 3; k++) {
    await ev(async (p) => {
      clearInterval(window.__noRecover);
      window.__noRecover = setInterval(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /changed outside/.test(t) ? 'project' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null, { trusted: true }); }, 150);
      app.settings.set('lanes.hoverScrub', false);
      await app.project.openVideo(p, { force: true });
    }, resolve(clip));
    if (await page.waitForFunction(() => app.doc.media && (app.player.error || (app.player.ready && app.player.vw > 0)), null, { timeout: 20000 }).then(() => true, () => false)) break;
  }
  await wait(800);
  await ev(() => {
    app.transact('check shots', () => { app.doc.scenes = [{ start_ms: 0, end_ms: 10000 }, { start_ms: 10000, end_ms: Math.round(app.durationMs) }]; app.doc.axes.stroke = []; });
    const tr = window.__pawDev.trackingFor(app); tr.runs = []; app.doc.ghosts = []; tr.select('');   // an earlier run's project: none of its runs
    app.setMode('track'); app.player.pause(); app.player.seek(4000);
    app.layout.reset();   // this mode's areas and rows at their defaults: before / after measured on the same layout
    app.setView({ start: 0, span: app.durationMs });
  });
  await page.waitForFunction(() => { const t = window.__pawDev.trackingFor(app); return t.listed && t.busy !== 'list'; }, null, { timeout: 30000 });
  await wait(800);
  // the stand-in grid tracker (dev/gridfilm-check.mjs): Track's request goes on to the fake's box tracker
  await ev(() => {
    const tr = window.__pawDev.trackingFor(app), be = app.backend, orig = be.sidecar.bind(be);
    const fakeBox = tr.trackers.find((t) => t.id === 'fake.mask'),   // the fake's mask tracker: a run with channels (sources to pick)
      real = tr.trackers.some((t) => t.id === 'tapnext_points' && !/stand-in/.test(t.name));
    if (!real && !tr.trackers.some((t) => t.id === 'tapnext_points')) tr.trackers = [...tr.trackers, { id: 'tapnext_points', name: 'TAPNext++ points (check stand-in)', roi: 'box_or_points', channels: [], params: [...fakeBox.params, { key: 'box_seed', type: 'choice', default: 'features', choices: ['features', 'grid'] }, { key: 'box_points', type: 'int', default: 256 }, { key: 'model', label: 'Model input size', type: 'choice', default: '256', choices: ['256', '384', '512'] }] }];
    const keep = new Set(fakeBox.params.map((p) => p.key));
    be.sidecar = (req, o) => {
      if (!real && req?.cmd === 'track' && req.tracker === 'tapnext_points') req = { ...req, tracker: 'fake.mask', params: Object.fromEntries(Object.entries(req.params || {}).filter(([k]) => keep.has(k))) };
      return orig(req, o);
    };
    tr.selectTracker('fake.mask');
  });
  // the first shot selected on the Shots strip's terms (the chips and Track act on it)
  await ev(() => { app.doc.range = { t0: 0, t1: 10000 }; });
  await page.waitForSelector('[data-btn="track"]', { timeout: 10000 });
  await page.click('[data-btn="track"]');
  await page.waitForFunction(() => { const t = window.__pawDev.trackingFor(app); return t.runs.length > 0 && !t.busy; }, null, { timeout: 60000 });
  await wait(1200);
  const run = await ev(() => { const t = window.__pawDev.trackingFor(app), r = t.runs.at(-1); t.select(r.id); return { id: r.id, n: r.n, pts: t.ghost(r.id)?.script?.length ?? 0, range: r.range }; });
  ok(run.pts > 0, `Track made run #${run.n}: ${run.pts} points over ${run.range.start}-${run.range.end} ms`);
  await ev(() => app.player.seek(4000)); await wait(800);

  for (const [W, Hh] of [[1920, 1080], [1280, 720]]) {
    await page.setViewportSize({ width: W, height: Hh }); await wait(900);
    out.sizes[`${W}x${Hh}`] = await measure();
    const m = out.sizes[`${W}x${Hh}`];
    if (shotPng && W !== 1920) await page.screenshot({ path: shotPng.replace(/\.png$/, `-${Hh}.png`) });
    if (!BEFORE) ok(m.edgeIn && m.strips.every((s) => /band|shs/.test(s.cls)), `${W}x${Hh}: the override / direction marks are inside the lane (an edge band of ${m.edge} px), only the inspector band under it`);
    console.log(`     ${W}x${Hh}: timeline ${m.timeline} px · rows ${m.rows.map((r) => `${r.id} ${r.h}`).join(', ')} · lanes toolbar ${m.toolbar} · stroke lane ${m.stroke} px (its row ${m.strokeRow}${m.edge ? `; its plot ${m.stroke - m.edge} px over a ${m.edge} px edge band` : ''})${m.strips.length ? ' · under it: ' + m.strips.map((s) => `${s.cls} ${s.h}`).join(', ') : ''}`);
  }
  await page.setViewportSize({ width: 1920, height: 1080 }); await wait(900);
  await page.mouse.move(2, 2); await wait(400);   // no tooltip in the picture
  if (shotPng) { await page.screenshot({ path: shotPng }); console.log('     screenshot ' + shotPng); }

  if (!BEFORE) {
    // ---- 1 / 2: one lane ----
    const dom = await ev(() => ({ trackerRow: !!document.querySelector('[data-row="tracking"]'), numbers: document.querySelectorAll('.seg.scene').length, combined: !!document.querySelector('.lrow[aria-label="stroke lane"] [data-tracklane="combined"] canvas[aria-label="Tracker signals"]') }));
    ok(!dom.trackerRow, 'no separate Tracker row on the Track tab');
    ok(dom.numbers === 0, `no shot-number strip (${dom.numbers} numbered shot cells)`);
    ok(dom.combined, 'the stroke lane carries the tracker layer');
    const px = await ev(({ t0, t1 }) => {
      const c = document.querySelector('[data-tracklane] canvas[aria-label="Tracker signals"]'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, v = app.view;
      const x0 = Math.max(0, Math.floor(((t0 - v.start) / v.span) * c.width)), x1 = Math.min(c.width, Math.ceil(((t1 - v.start) / v.span) * c.width));
      let inRun = 0, outside = 0;
      for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) if (d[(y * c.width + x) * 4 + 3] > 40) (x >= x0 && x < x1 ? inRun++ : outside++);
      return { inRun, outside };
    }, { t0: run.range.start, t1: run.range.end });
    ok(px.inRun > 200, `the run's trace is drawn on the stroke lane (${px.inRun} painted px in the run, ${px.outside} outside)`);
    const lanePts = await ev((id) => { const g = window.__pawDev.trackingFor(app).ghost(id); return { ghost: g?.script?.length ?? 0, axis: g?.axis ?? 'stroke' }; }, run.id);
    ok(lanePts.ghost > 0 && lanePts.axis === 'stroke', `the run's points are on the stroke lane (${lanePts.ghost} points, axis ${lanePts.axis})`);
    // ---- 3: the inspector band (paw-k8pe: the run's row is the lane toolbar's, right of Track's cog; the band keeps ▾, Detail) ----
    const band = await ev(() => { const b = document.querySelector('[data-testid="inspector-band"]'); return b ? { h: Math.round(b.getBoundingClientRect().height), copy: !!b.querySelector('.pick') } : null; });
    ok(!!band && band.h <= 24 && !band.copy, `the inspector band is one row: ${band?.h} px, no copy of the run's row`);
    await runCtl(page);
    const row = await ev(() => { const rb = document.querySelector('[data-testid="run-bar"]'), bar = document.querySelector('.stack .bar'); return { inBar: !!bar?.contains(rb), text: rb?.innerText.replace(/\s+/g, ' ').slice(0, 160) }; });
    ok(row.inBar && /#\d+ · /.test(row.text) && /baseline/.test(row.text), `the run's row is in the lane toolbar: "${row.text}"`);
    await runClose(page);
    const laneH0 = (await measure()).stroke;
    await page.click('[data-testid="inspector-more"]'); await wait(500);
    const open = await ev(() => ({ body: !!document.querySelector('[data-testid="inspector-more-body"] [data-testid="derive-strip"]'), h: Math.round(document.querySelector('[data-testid="inspector-band"]').getBoundingClientRect().height) }));
    const laneH1 = (await measure()).stroke;
    ok(open.body && open.h > 60, `▾ unfolds it in place (${open.h} px, the Adjust strip inside; the lane ${laneH0} -> ${laneH1} px while open)`);
    if (shotPng) await page.screenshot({ path: shotPng.replace(/\.png$/, '-open.png') });
    await page.click('[data-testid="inspector-more"]'); await wait(300);
    await runCtl(page);
    const src0 = await ev(() => document.querySelector('.pick .src .tx')?.textContent);
    await page.click('.pick .src'); await wait(300);
    const items = page.locator('[role="menuitemradio"]:not([aria-disabled="true"]):not([aria-checked="true"])');
    const n = await items.count();
    if (ok(n > 0, `the source menu offers ${n} other sources`)) { await items.first().click(); await wait(600); }
    await runCtl(page);
    const src1 = await ev(() => document.querySelector('.pick .src .tx')?.textContent);
    ok(src1 && src1 !== src0, `the source changed from the toolbar's row: ${src0} -> ${src1}`);
    await runClose(page);
    // ---- 4: the tracker's settings from the Track button ----
    await page.keyboard.press('Escape');
    const tip = await ev(() => document.querySelector('[data-btn="track"]')?.getAttribute('aria-describedby') ?? '');
    void tip;
    await page.click('[data-btn="track-menu"]'); await wait(400);
    ok(await page.locator('[data-testid="track-menu"]').isVisible(), 'the cog opens the tracker settings');
    const field = page.locator('[data-testid="track-menu"] input[aria-label="Track: grid points"]');
    await field.click(); await field.press('Control+a'); await field.type('640'); await field.press('Enter'); await wait(300);
    ok(await ev(() => app.settings.get('tracking.gridPoints')) === 640, 'the point count changed there (tracking.gridPoints 640)');
    ok(await ev(() => !!document.querySelector('[data-testid="track-menu"] [aria-label^="Model input size"], [data-testid="track-menu"] label')), 'the tracker params are in the popover');
    ok(await ev(() => !!document.querySelector('[data-testid="track-menu-track.gridFrame"]') && !!document.querySelector('[data-testid="track-menu-track.run"]') && !document.querySelector('[data-testid="track-menu"] [aria-label="Tracker"]')), 'the cog has a Track and a Track ROI section and no tracker dropdown');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await wait(300);
    await page.click('[data-btn="track"]', { button: 'right' }); await wait(400);
    const rc = await ev(() => [...document.querySelectorAll('[role=menu] [role=menuitem], [role=menu] [role=menuitemcheckbox]')].map((e) => e.textContent.trim()).join(' | '));
    ok(!(await page.locator('[data-testid="track-menu"]').isVisible()) && /Quick menu/.test(rc) && /shortcut/.test(rc) && /Custom box track/.test(rc) && /Custom point track/.test(rc), `a right-click on Track: the command menu plus the custom tracks: ${rc}`);
    await page.keyboard.press('Escape'); await wait(200);
    ok(await ev(() => !document.querySelector('[data-chip="tracker"]')), 'no tracker chip in the toolbar');
    await ev(() => app.settings.set('tracking.gridPoints', 512));

    // ---- 6. a fused run (painted parts, test/fixtures/rederive-run.json as dev/override-check.mjs): the run's full row (pad,
    //      depth, baseline; paw-k8pe: in the lane toolbar) stays one line at both sizes, what does not fit in its … popover (nothing
    //      lost), the band one row (▾, Detail); unfolded the band holds the fusion panel ----
    const fx = JSON.parse(readFileSync(new URL('../test/fixtures/rederive-run.json', import.meta.url), 'utf8'));
    await ev((fx) => {
      const D = window.__pawDev, tr = D.trackingFor(app);
      tr.runs = []; app.doc.ghosts = []; tr.select('');
      app.doc.scenes = [{ start_ms: 0, end_ms: 8000 }, { start_ms: 8000, end_ms: 14000 }, { start_ms: 14000, end_ms: Math.round(app.durationMs) }];
      const c = fx.auto.channels;
      for (const [to, from, dy] of [['sem_c1_hips', 'who_c1', 0], ['sem_c2_hips', 'who_c2', 0], ['sem_c1_penis', 'who_c1', 0.03]]) {
        c[to + '_x'] = c[from + '_x'].map(([t, v]) => [t, v == null ? null : v + 0.01]);
        c[to + '_y'] = c[from + '_y'].map(([t, v]) => [t, v == null ? null : v + dy]);
        c[to + '_n'] = c[from + '_n'];
      }
      const notes = [0, 1].map((k) => ({ code: 'primary', scene_index: k, message: 'proj', data: { chosen: 'proj' } }));
      const run = D.makeRun({ n: 5, tracker: { id: 'cotracker_points', name: 'CoTracker3' }, params: fx.auto.params, range: { start: 0, end: 14000 }, roi: null,
        result: { samples: c.proj, points: [{ at: 100, pos: 0 }, { at: 7000, pos: 100 }, { at: 9000, pos: 0 }, { at: 13000, pos: 100 }], scenes: fx.scenes.map((s) => ({ ...s, sign: 1 })), channels: c, notes },
        frames: D.newFrames(), runs: tr.runs });
      run.points = run.points0 = D.pointsFromChannel(run, 'proj');
      tr.runs = [run]; app.doc.ghosts = [tr.ghostOf(run)]; tr.select(run.id);
      app.setView({ start: 0, span: 14000 }); app.player.seek(3000);
      tr.setSource('fused');
    }, fx);
    await wait(1200);
    const counts = [];
    for (const [W, Hh] of [[1920, 1080], [1280, 720]]) {
      await page.setViewportSize({ width: W, height: Hh }); await wait(800);
      const row = await ev(() => { const p = document.querySelector('[data-testid="run-bar"]'), bar = document.querySelector('.stack .bar'), r = document.querySelector('[data-testid="inspector-band"] .bandrow'); return { over: p ? p.scrollWidth - p.clientWidth : -1, right: p && bar ? Math.round(p.getBoundingClientRect().right - bar.getBoundingClientRect().right) : 99, barH: Math.round(bar?.getBoundingClientRect().height || 0), rowOver: r ? r.scrollWidth - r.clientWidth : -1, h: Math.round(r?.getBoundingClientRect().height || 0) }; });
      const c = await runBarCount(page);
      counts.push(c.total);
      const text = await ev(() => document.querySelector('[data-testid="run-bar"]').innerText.replace(/\s+/g, ' '));
      ok(row.over <= 1 && row.right <= 1 && row.barH <= 40 && row.rowOver <= 1 && row.h <= 24 && /depth/.test(text) && /baseline/.test(text) && /nudge|rel|abs/.test(text), `${W}x${Hh}: the fused shot's row is one line in the toolbar, nothing cut (toolbar ${row.barH} px, over ${row.over} px; ${c.row} in the row, ${c.folded} in its … popover), the band one row (${row.h} px): "${text}"`);
      if (shotPng) await page.screenshot({ path: shotPng.replace(/\.png$/, `-fused-${Hh}.png`) });
      await runClose(page);
    }
    ok(counts[0] === counts[1], `as many of the run's controls at both sizes: ${counts.join(' = ')}`);
    await page.setViewportSize({ width: 1920, height: 1080 }); await wait(600);
    await page.click('[data-testid="inspector-more"]'); await wait(600);
    ok(await ev(() => !!document.querySelector('[data-testid="inspector-more-body"] [data-testid="fuse-panel"]')), 'unfolded: the fusion panel (pad, relationships, anchors) is in the band');
    if (shotPng) await page.screenshot({ path: shotPng.replace(/\.png$/, '-fused-open.png') });
    await page.click('[data-testid="inspector-more"]'); await wait(300);
  }
} catch (e) { fails++; console.log('FAIL ' + (e?.stack || e)); }
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 1));
console.log(fails ? `${fails} FAILED` : 'all ok');
await b.close();
process.exit(fails ? 1 : 0);
