// dev/runbar-check.mjs -- paw-k8pe in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints), on a clip (F
// needs a video: node dev/make-index-clip.mjs <out.mp4> 20 30 600) with synthetic runs (test/fixtures/rederive-run.json, as
// dev/runsel-check.mjs). The owner: "this tapnext bar at the bottom with the microscopic polarity isn't great": the run's name,
// its direction and its Adjust row are the lane toolbar's now, right of Track's cog.
//   1. no run: no run controls (the Track buttons as before);
//   2. a run plays at the playhead: its chip and its direction sit in the toolbar row after the cog (one line), the band under the
//      lane holds no copy (its ▾ and Detail stay), nothing selected = the run whose range plays (bandRun); the chip's click selects
//      it, then the pickers are there; again = the next run here; its right-click = its range's menu;
//   3. the direction: at least a toolbar button's size, in words; a click flips the scene under the playhead (the script there
//      inverts, the toggle says flipped), F flips it back (the script as before);
//   4. a narrow window: the tail folds into the one … popover, nothing lost (as many controls wide as narrow), the chip and the
//      direction never fold, the row is not cut;
//   5. the run strip under the lane: a clean bar (>= 6 px, no glyphs), a click picks its run.
//   node dev/runbar-check.mjs <clip> [--shots <dir>]   (--shots: runbar-wide.png / runbar-narrow.png of the toolbar row)
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';
import { runCtl, runClose, runBarCount } from './run-bar.mjs';

const argv = process.argv.slice(2), opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
const clip = argv[0], shots = opt('--shots');
if (!clip) { console.error('usage: node dev/runbar-check.mjs <clip> [--shots <dir>]'); process.exit(2); }
if (shots) mkdirSync(shots, { recursive: true });
const fx = JSON.parse(readFileSync(new URL('../test/fixtures/rederive-run.json', import.meta.url), 'utf8'));
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); return c; };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
const R = (sel) => ev((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; }, sel);
const shotRow = async (name) => {
  if (!shots) return;
  await page.mouse.move(2, 2); await wait(300);
  const r = await R('.stack .bar'), b = await R('[data-testid="run-more-body"]');
  const vw = await ev(() => innerWidth), vh = await ev(() => innerHeight), y = Math.max(0, r.y - 4);
  await page.screenshot({ path: join(shots, name), clip: { x: 0, y, width: Math.min(vw, r.r + 4), height: Math.min(vh - y, Math.max(r.b, b?.b ?? 0) - y + 8) } });
};

try {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.reload(); await page.waitForFunction(() => window.app?.project && window.__pawDev, null, { timeout: 30000 }); await wait(1200);
  for (let k = 0; k < 3; k++) {
    await ev(async (p) => {
      clearInterval(window.__noRecover);
      window.__noRecover = setInterval(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /changed outside/.test(t) ? 'project' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null, { trusted: true }); }, 150);
      app.settings.set('lanes.hoverScrub', false);
      await app.project.openVideo(p, { force: true });
    }, resolve(clip));
    if (await page.waitForFunction(() => app.doc.media && (app.player.error || (app.player.ready && app.player.vw > 0)), null, { timeout: 20000 }).then(() => true, () => false)) break;
  }
  await wait(600);
  // ---- 1. no run ----
  await ev(() => {
    const tr = window.__pawDev.trackingFor(app);
    window.TR = tr; tr.runs = []; app.doc.ghosts = []; tr.select(''); app.doc.runRanges = null;
    app.transact('check shots', () => { app.doc.scenes = [{ start_ms: 0, end_ms: 8000 }, { start_ms: 8000, end_ms: 14000 }, { start_ms: 14000, end_ms: Math.round(app.durationMs) }]; app.doc.axes.stroke = []; });
    app.setMode('track'); app.player.pause(); app.player.seek(2000);
    app.setView({ start: 0, span: 14000 });
  });
  await page.waitForSelector('[data-btn="track"]', { timeout: 15000 }); await wait(500);
  ok(await ev(() => !document.querySelector('[data-testid="run-bar"]') && !!document.querySelector('[data-btn="track-menu"]')), 'no run: no run controls, Track and its cog as before');

  // ---- two runs: #1 plays 0-8 s, #2 plays 8-14 s ----
  await ev((fx) => {
    const D = window.__pawDev, tr = TR;
    const mk = (n, name) => {
      const notes = [0, 1].map((k) => ({ code: 'primary', scene_index: k, message: 'proj', data: { chosen: 'proj' } }));
      const run = D.makeRun({ n, tracker: { id: 'tapnext_points', name }, params: fx.auto.params, range: { start: 0, end: 14000 }, roi: null,
        result: { samples: fx.auto.channels.proj, points: [{ at: 100, pos: 0 }, { at: 7000, pos: 100 }, { at: 9000, pos: 0 }, { at: 13000, pos: 100 }], scenes: fx.scenes.map((s) => ({ ...s, sign: 1 })), channels: fx.auto.channels, notes },
        frames: D.newFrames(), runs: tr.runs });
      run.points = run.points0 = D.pointsFromChannel(run, 'proj');
      tr.runs = [...tr.runs, run];
      app.doc.ghosts = [...(app.doc.ghosts || []), tr.ghostOf(run)];
      return run.id;
    };
    window.IDS = [mk(1, 'TAPNext++'), mk(2, 'TAPNext++')];
    app.doc.runRanges = [{ id: 'rr1', run: IDS[0], t0: 0, t1: 8000, layer: 0 }, { id: 'rr2', run: IDS[1], t0: 8000, t1: 14000, layer: 0 }];
    window.script = (a, b) => (TR.ghost(IDS[0])?.script || []).filter((p) => p.at >= a && p.at < b).map((p) => [p.at, p.pos]);   // run #1's script there
  }, fx);
  const ids = await ev(() => IDS);
  await page.waitForSelector('[data-testid="run-bar"]', { timeout: 10000 }); await wait(500);

  // ---- 2. where it is ----
  const geo = await ev(() => {
    const B = (e) => e?.getBoundingClientRect();
    const bar = document.querySelector('.stack .bar'), rb = document.querySelector('[data-testid="run-bar"]'), cog = document.querySelector('[data-btn="track-menu"]');
    return { inBar: !!bar?.contains(rb), afterCog: B(rb).left >= B(cog).right - 1, oneLine: Math.abs(B(rb).top - B(cog).top) < 12, barH: Math.round(B(bar).height),
      chip: document.querySelector('[data-testid="run-chip"]')?.innerText.trim(), band: !!document.querySelector('[data-testid="inspector-band"] .pick'),
      more: !!document.querySelector('[data-testid="inspector-more"]'), sel: TR.selectedId };
  });
  ok(geo.inBar && geo.afterCog && geo.oneLine, `the run controls are in the lane toolbar row, right of Track's cog (${JSON.stringify({ inBar: geo.inBar, afterCog: geo.afterCog, oneLine: geo.oneLine })}; the row ${geo.barH} px)`);
  ok(/#1/.test(geo.chip) && /shot 1/.test(geo.chip), `nothing selected: the chip names the run that plays here (the tracker is in its tooltip): "${geo.chip}"`);
  ok(!geo.band && geo.more, 'the band under the lane holds no copy of the row (its ▾ stays)');
  await runCtl(page);
  ok(await ev(() => /Select a run/.test(document.querySelector('[data-testid="run-bar"]').innerText)), 'not picked yet: the row says to select the run');
  await page.click('[data-testid="run-chip"]'); await wait(400);
  ok(await ev((id) => TR.selectedId === id, ids[0]), 'the chip\'s click selects that run');
  await runCtl(page);
  ok(await ev(() => !!document.querySelector('.pick .src') && !!document.querySelector('[data-testid="run-bar"] .g[data-group="base"]')), 'then its pickers are there (source ... baseline)');
  await runClose(page);
  await page.click('[data-testid="run-chip"]'); await wait(400);
  ok(await ev((id) => TR.selectedId === id, ids[1]), 'a second click: the next run tracked here');
  await page.click('[data-testid="run-chip"]'); await wait(400);
  ok(await ev((id) => TR.selectedId === id, ids[0]), 'and round again');
  await page.click('[data-testid="run-chip"]', { button: 'right' }); await wait(400);
  const menu = await ev(() => document.querySelector('[role=menu]')?.innerText || '');
  ok(/Invert this range/.test(menu) && /Use another run here/.test(menu), `its right-click is its range's menu: "${menu.replace(/\s+/g, ' ').slice(0, 90)}"`);
  await page.keyboard.press('Escape'); await wait(200);

  // ---- 3. the direction ----
  const pol = await ev(() => {
    const p = document.querySelector('[data-testid="run-polarity"]'), t = document.querySelector('[data-btn="track"]'), a = p.getBoundingClientRect(), b = t.getBoundingClientRect();
    return { w: Math.round(a.width), h: Math.round(a.height), th: Math.round(b.height), text: p.innerText.trim(), pressed: p.getAttribute('aria-pressed'), cmd: p.dataset.command, folded: !!p.closest('[data-testid="run-more-body"]') };
  });
  ok(pol.h >= pol.th && pol.w >= 40, `the direction is a toolbar button's size: ${pol.w} x ${pol.h} px (Track is ${pol.th} px high)`);
  ok(pol.text === 'normal' && pol.pressed === 'false' && pol.cmd === 'track.flipAtPlayhead' && !pol.folded, `it says the direction in words ("${pol.text}") and is the F command (${pol.cmd})`);
  await page.hover('[data-testid="run-polarity"]'); await wait(900);
  const tip = await ev(() => [...document.querySelectorAll('[role=tooltip]')].map((e) => e.innerText).join(' | '));
  ok(/Direction at the playhead/.test(tip) && /\bF\b/.test(tip), `its tooltip says what it does and its key: "${tip.replace(/\s+/g, ' ').slice(0, 120)}"`);
  const s0 = await ev(() => script(500, 7500));
  await page.click('[data-testid="run-polarity"]'); await wait(800);
  const s1 = await ev(() => script(500, 7500)), p1 = await ev(() => ({ text: document.querySelector('[data-testid="run-polarity"]').innerText.trim(), pressed: document.querySelector('[data-testid="run-polarity"]').getAttribute('aria-pressed'), flips: TR.run(IDS[0]).flips }));
  const corr = (a, b) => { const n = Math.min(a.length, b.length); if (n < 3) return 0; const x = a.slice(0, n).map((p) => p[1]), y = b.slice(0, n).map((p) => p[1]), mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } return sxy / Math.sqrt(sxx * syy || 1); };
  const c1 = corr(s0, s1);
  ok(p1.text === 'flipped' && p1.pressed === 'true' && p1.flips.includes(0), `a click flips the scene under the playhead: "${p1.text}", flips ${JSON.stringify(p1.flips)}`);
  ok(s0.length > 2 && c1 < -0.8, `the script there inverts (${s0.length} points, correlation before / after ${c1.toFixed(2)})`);
  await page.mouse.move(2, 2); await ev(() => document.activeElement?.blur()); await wait(100);
  await page.keyboard.press('f'); await wait(800);
  const s2 = await ev(() => script(500, 7500)), p2 = await ev(() => document.querySelector('[data-testid="run-polarity"]').innerText.trim());
  ok(p2 === 'normal' && JSON.stringify(s2) === JSON.stringify(s0), `F flips it back: "${p2}", the script as before (${s2.length} points)`);

  // ---- 4. wide vs narrow: nothing lost, the chip and the direction never fold ----
  await ev((id) => { TR.select(id); TR.setSource('fused'); }, ids[0]); await wait(800);   // fused (no painted parts here: no pad / depth; dev/tracklane-check.mjs counts those, 15 = 15)
  await runClose(page);
  await shotRow('runbar-wide.png');
  const wide = await runBarCount(page);
  await runClose(page);
  const wideCut = await ev(() => { const b = document.querySelector('.stack .bar'), rb = document.querySelector('[data-testid="run-bar"]'); return { over: rb.scrollWidth - rb.clientWidth, right: Math.round(rb.getBoundingClientRect().right - b.getBoundingClientRect().right) }; });
  await page.setViewportSize({ width: 1100, height: 800 }); await wait(900);
  const narrowGeo = await ev(() => {
    const B = (s) => document.querySelector(s)?.getBoundingClientRect(), bar = B('.stack .bar'), rb = B('[data-testid="run-bar"]'), more = B('[data-testid="run-more"]'), chip = B('[data-testid="run-chip"]'), pol = B('[data-testid="run-polarity"]');
    // painted, not only inside the toolbar's box: what is at both ends of it is the control itself (a parent's overflow clips)
    const shown = (s) => { const e = document.querySelector(s), r = e?.getBoundingClientRect(); if (!r || !r.width) return false; const y = r.top + r.height / 2; return [r.left + 3, r.right - 3].every((x) => e.contains(document.elementFromPoint(x, y))); };
    const inside = (r) => !!r && r.width > 0 && r.left >= bar.left - 1 && r.right <= bar.right + 1;
    const pe = document.querySelector('[data-testid="run-polarity"]');
    return { more: inside(more) && shown('[data-testid="run-more"]'), chip: inside(chip) && shown('[data-testid="run-chip"]') && chip.width >= 48, pol: inside(pol) && shown('[data-testid="run-polarity"]'), polW: Math.round(pol?.width || 0), polH: Math.round(pol?.height || 0),
      polSays: (pe?.innerText.trim() || pe?.getAttribute('aria-label') || '').replace(/\s+/g, ' '), tight: !!document.querySelector('[data-testid="run-bar"].tight'), rbRight: Math.round(rb.right), barRight: Math.round(bar.right), barH: Math.round(bar.height) };
  });
  const narrow = await runBarCount(page);
  await shotRow('runbar-narrow.png');
  console.log(`     wide ${JSON.stringify(wide)} · narrow ${JSON.stringify(narrow)}`);
  ok(wide.total === narrow.total && narrow.total >= 9, `as many controls wide as narrow: ${wide.total} = ${narrow.total} (wide: ${wide.row} in the row, ${wide.folded} folded; narrow: ${narrow.row} in the row, ${narrow.folded} folded)`);
  ok(narrow.folded > wide.folded && narrowGeo.more, `narrow: more of them are in the … popover (${narrow.folded} > ${wide.folded}), its button on the row`);
  // ae6f165: at the narrowest row (RunBar .tight) the direction is its icon and pressed state, the words in its name, a button's size still
  const polFull = narrowGeo.tight ? narrowGeo.polW >= pol.th - 1 && narrowGeo.polH >= pol.th && /^Direction: normal$/.test(narrowGeo.polSays) : narrowGeo.polW >= 40 && narrowGeo.polSays === 'normal';
  ok(narrowGeo.chip && narrowGeo.pol && polFull && narrow.fixed === 2, `the chip and the direction stay in the row, the direction a button's size saying it (${narrowGeo.polW} x ${narrowGeo.polH} px, "${narrowGeo.polSays}"${narrowGeo.tight ? ', the narrowest row: its icon' : ''})`);
  ok(wideCut.over <= 1 && wideCut.right <= 1 && narrowGeo.rbRight <= narrowGeo.barRight + 1 && narrowGeo.barH === geo.barH, `the row is not cut and stays one line (over ${wideCut.over} px; ${narrowGeo.barH} px high)`);
  await runClose(page); await page.setViewportSize({ width: 1920, height: 1080 }); await wait(800);

  // ---- 5. the run strip ----
  const rr = await ev(() => { const b = document.querySelector('[data-testid="run-range"] .body'), r = b.getBoundingClientRect(); return { h: Math.round(r.height), text: document.querySelector('[data-testid="run-strip"]').innerText.trim(), inv: document.querySelectorAll('[data-testid="run-range"] .inv, [data-testid="run-range"] .nm').length }; });
  ok(rr.h >= 6 && rr.text === '' && rr.inv === 0, `the run strip is a clean bar: ${rr.h} px, no text, no ± (${rr.inv})`);
  await ev(() => { TR.select(''); TR.rangeSel = ''; }); await wait(200);
  const body2 = await R(`[data-testid="run-range"][data-run="${ids[1]}"] .body`);
  await page.mouse.click(body2.x + body2.w / 2, body2.y + body2.h / 2); await wait(400);
  ok(await ev((id) => TR.selectedId === id && TR.rangeSel === 'rr2', ids[1]), 'a click on its bar picks that run');

  // ---- 6. the strips' size (the owner: "this shit is microscopic"): a range override's words in the kit's small type, one line,
  //      unclipped, its × a small control wide; their heights follow the app's one size setting (ui.density) ----
  await ev((id) => { TR.rangeSel = ''; TR.select(id); TR.addSignalSpan(2000, 5000); TR.sigSel = null; app.player.seek(6500); }, ids[0]); await wait(700);
  const strip = () => ev(() => {
    const px = (v) => parseFloat(v), root = getComputedStyle(document.documentElement), q = (s) => document.querySelector(s), H = (e) => Math.round(e?.getBoundingClientRect().height || 0);
    const b = q('[data-testid="override-strip"] .ovb'), x = q('[data-testid="override-strip"] .ovx');
    return { fs1: px(root.getPropertyValue('--fs-1')), ctl: px(root.getPropertyValue('--ctl-h-sm')), font: b ? px(getComputedStyle(b).fontSize) : 0, clip: b ? b.scrollHeight - b.clientHeight : 99, text: b?.innerText.trim() || '',
      xw: Math.round(x?.getBoundingClientRect().width || 0), edge: H(q('[data-testid="lane-edge"]')), run: H(q('[data-testid="run-strip"]')), ov: H(q('[data-testid="override-strip"]')), band: H(q('[data-testid="inspector-band"]')) };
  });
  const sizes = {};
  for (const d of ['default', 'compact', 'comfortable']) {
    await ev((d) => app.settings.set('ui.density', d), d); await wait(600);
    sizes[d] = await strip();
  }
  await ev(() => app.settings.set('ui.density', 'default')); await wait(400);
  const s = sizes.default;
  console.log(`     strips: ${JSON.stringify(sizes)}`);
  ok(!!s.text && s.font >= s.fs1 && s.clip <= 0, `default density: the override's words are the kit's small type (${s.font} px >= --fs-1 ${s.fs1} px), one line, not clipped ("${s.text}")`);
  ok(s.xw >= s.ctl, `its × is a small control wide (${s.xw} px >= --ctl-h-sm ${s.ctl} px)`);
  ok(sizes.compact.font >= sizes.compact.fs1 && sizes.compact.clip <= 0 && sizes.comfortable.clip <= 0, `compact / comfortable: still the small type, unclipped (${sizes.compact.font} / ${sizes.comfortable.font} px)`);
  ok(sizes.compact.edge < s.edge && s.edge < sizes.comfortable.edge, `ui.density sizes the strips: the band inside the lane ${sizes.compact.edge} / ${s.edge} / ${sizes.comfortable.edge} px (compact / default / comfortable)`);
  console.log(`     under the lane's plot at the default density: the edge band ${s.edge} px (run strip ${s.run} + overrides ${s.ov}) + the band row ${s.band} px = ${s.edge + s.band} px`);
  console.log(fails ? `${fails} FAILED` : 'all ok');
} catch (e) { fails++; console.log('FAIL ' + (e?.stack || e)); }
await browser.close().catch(() => {});
process.exit(fails ? 1 : 0);
