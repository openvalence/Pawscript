// dev/bottom-check.mjs -- paw-idb5 / paw-1w0x in the REAL window (your test instance: node dev/test-app.mjs start ...; the CDP_*
// env it prints). The bottom of the window, asserted on what is painted, on a generated clip:
//   collapsed: nothing between the last timeline row and the status bar; the tray's Show button centred in the status bar;
//   no hint line, no hidden-rows strip, no Shortcuts rail; the Tracker row's height (Track, 1280x720 and 3000x1600).
//   open (the button): a docked panel under the timeline, the timeline shrinks by its height, the video does not move; its
//   tabs (Rows, Graph in Track) show their content; a Rows chip hides / shows a row; dragging its top edge resizes it;
//   Ctrl+J folds it. F1 opens the shortcut overlay with "Here: <tab>" in Scenes / Track / Refine / Review and on home.
//   No Chapters anywhere (row, panel tab, palette). Ctrl+W on home does nothing; the tab's x closes.
//   A .pawproj with chapters and a foreign funscript with metadata.chapters: open, save, the chapters byte-identical.
//   phase 'measure' only prints the Tracker row / section heights (run it against any build, e.g. HEAD's, for a before).
//   SHOT_DIR=<dir> node dev/bottom-check.mjs check|measure <clip.mp4>   (the clip's folder gets .pawproj / .funscript files)
//   PERSIST=1 ... check: stop after opening the tray at 1280x720 with Graph shown and 240 px (restart with the same --id, then)
//   node dev/bottom-check.mjs persisted <clip.mp4>: the tray still open, Graph, 240 px
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';

const [phase, clip] = process.argv.slice(2);
if (!['check', 'measure', 'persisted'].includes(phase) || !clip) { console.error('usage: node dev/bottom-check.mjs check|measure|persisted <clip.mp4>'); process.exit(2); }
const shots = process.env.SHOT_DIR || null;
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const answer = (found = 'ignore') => ev((found) => { const d = app.dialog; if (!d) return ''; const id = /^Found/.test(d.title) ? found : d.choices.find((c) => c.kind !== 'danger')?.id ?? null; d.resolve(id); return d.title; }, found);
const settle = () => ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 250)))));
const cdp = await page.context().newCDPSession(page);
const size = async (w, h) => { await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await settle(); await wait(300); };
const press = async (k) => { await page.keyboard.press(k); await settle(); };
const shot = async (name, clipRect) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png`, ...(clipRect ? { clip: clipRect } : {}) }); };

/** The bottom as painted: the timeline section, its last row, the tray, the status bar, the Show button, the Tracker row. */
const bottom = () => ev(() => {
  const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom), r: Math.round(r.right) } : null; };
  const tl = document.querySelector('.areas > [data-area=timeline]');
  const rows = [...tl.querySelectorAll('.stack > .row')].filter((e) => e.getBoundingClientRect().height > 0);
  const tracker = [...tl.querySelectorAll('.stack > .row')].find((e) => /^Tracker/.test(e.querySelector(':scope > .fold')?.textContent?.trim() || ''));
  const sb = document.querySelector('.k-status-bar');
  return {
    section: R(tl), lastRow: R(rows.at(-1)), video: R(document.querySelector('.areas > [data-area=video]')), tray: R(document.querySelector('.areas > [data-area=bottom]')),
    status: R(sb), button: R(document.querySelector('[data-testid=tray-toggle]')), buttonText: document.querySelector('[data-testid=tray-toggle]')?.textContent.trim() || '',
    tracker: R(tracker), hint: !!document.querySelector('[data-testid=scenes-hint]'), strip: !!document.querySelector('.stack > .folded'),
    rail: !!document.querySelector('.areas nav.rail.bottom'), shell: R(document.querySelector('.shell')),
    rowTitles: rows.map((e) => e.querySelector(':scope > .fold')?.textContent.replace('‹', '').trim()).filter(Boolean),
    rowPx: rows.map((e) => `${e.querySelector(':scope > .fold')?.textContent.replace('‹', '').trim() || 'fill'} ${Math.round(e.getBoundingClientRect().height)}`),
  };
});
const reset = (mode) => ev((m) => { app.layout.reset(); app.setMode(m); app.layout.toggle('bottom', false); document.activeElement?.blur?.(); }, mode);

/** Save without awaiting inside the page (a question would block it there), answering what it asks. */
async function save() {
  await ev(() => { window.__saving = Promise.resolve(app.project.save()).finally(() => { window.__saving = null; }); });
  for (let k = 0; k < 40 && (await ev(() => !!window.__saving)); k++) { await answer(); await wait(250); }
  await wait(300);
}
async function open(path, found = 'ignore') {
  const p = ev((v) => (/\.pawproj$/.test(v) ? app.project.openPaths([v], { force: true }) : app.project.openVideo(v, { force: true })), path);
  for (let k = 0; k < 8; k++) { await wait(300); await answer(found); }
  await p;
  await page.waitForFunction(() => app.doc.media && app.player.ready, null, { timeout: 60000 });
  await settle(); await wait(800);
}

try {
  await page.waitForFunction(() => window.app?.project, null, { timeout: 60000 });
  if (phase === 'persisted') {
    await open(clip);
    await ev(() => app.setMode('track')); await size(1280, 720);
    const b = await bottom(), tab = await ev(() => app.layout.cur.bottom.tab);
    ok(!!b.tray && b.buttonText === 'Hide', `after a restart the tray is still open (${b.tray?.h} px, button "${b.buttonText}")`);
    ok(tab === 'graph' && Math.abs((b.tray?.h || 0) - 240) <= 1, `its tab (${tab}) and height (${b.tray?.h}) remembered`);
    await shot('bottom-persisted-1280');
    process.exitCode = fails ? 1 : 0;
  } else if (phase === 'measure') {
    await ev(() => app.project.close({ force: true }));
    await open(clip);
    for (const [W, H] of [[1280, 720], [3000, 1600]]) {
      await size(W, H);
      for (const m of ['track', 'scenes', 'refine']) {
        await reset(m); await settle(); await wait(400);
        const b = await bottom();
        console.log(`${W}x${H} ${m}: section ${b.section?.h}, video ${b.video?.h}, tracker ${b.tracker?.h ?? '-'}, rows [${b.rowPx.join(', ')}], gap to status ${b.status.y - b.section.b}`);
      }
    }
  } else {
    // ---- chapters data (paw-1w0x): written in the HEAD formats before anything opens them ----
    const dir = clip.replace(/[\\/][^\\/]+$/, ''), base = clip.replace(/\.[^.]+$/, ''), fsPath = base + '.funscript', projPath = base + '-chapters.pawproj';
    for (const f of [fsPath, fsPath + '.bak', projPath, base + '-chapters.funscript', base + '.pawproj', base + '.pawruns']) if (existsSync(f)) rmSync(f);
    const foreignChapters = [{ name: 'Intro', startTime: '00:00:00.000', endTime: '00:00:02.000', other: { tool: 1 } }, { name: 'No end', startTime: '00:00:04.000' }, 'junk'];
    writeFileSync(fsPath, JSON.stringify({ version: '1.0', inverted: false, range: 100, metadata: { creator: 'OtherTool', chapters: foreignChapters, bookmarks: [{ name: 'bm', time: '00:00:01.000' }] }, actions: [{ at: 0, pos: 10 }, { at: 500, pos: 90 }] }));

    await ev(() => app.project.close({ force: true }));
    await open(clip, 'edit');
    ok((await ev(() => app.doc.chapters.length)) === 2, 'a foreign funscript\'s chapters load into the document (no UI)');
    await ev(() => app.edit('Add point', 'stroke', [...app.doc.axes.stroke, { at: 1000, pos: 40 }]));
    await save();
    const saved = JSON.parse(readFileSync(fsPath, 'utf8'));
    ok(JSON.stringify(saved.metadata.chapters) === JSON.stringify(foreignChapters), `saved: metadata.chapters exactly as the other tool wrote them (${JSON.stringify(saved.metadata.chapters).slice(0, 90)}…)`);
    ok(saved.actions.some((x) => x.at === 1000) && saved.metadata.creator === 'OtherTool' && saved.metadata.bookmarks?.[0]?.name === 'bm', `our edit written, the rest of the metadata kept (actions ${JSON.stringify(saved.actions)}, creator ${saved.metadata.creator}, bookmarks ${JSON.stringify(saved.metadata.bookmarks)})`);

    // ---- the bottom, collapsed, both sizes ----
    for (const [W, H] of [[1280, 720], [3000, 1600]]) {
      await size(W, H);
      for (const m of ['track', 'scenes', 'refine', 'review']) {
        await reset(m); await settle(); await wait(300);
        const b = await bottom();
        ok(!b.tray && !b.rail && !b.hint && !b.strip, `${W}x${H} ${m}: no tray, no rail, no hint line, no hidden-rows strip`);
        ok(Math.abs(b.section.b - b.status.y) <= 1 && Math.abs(b.lastRow.b - b.status.y) <= 2, `${W}x${H} ${m}: the last timeline row meets the status bar (row bottom ${b.lastRow.b}, section ${b.section.b}, status top ${b.status.y})`);
        ok(b.status.b === b.shell.b, `${W}x${H} ${m}: the status bar is the bottom edge (${b.status.b} / ${b.shell.b})`);
        const mid = b.button ? b.button.x + b.button.w / 2 : -1;
        ok(b.button && Math.abs(mid - (b.status.x + b.status.w / 2)) <= 2 && b.buttonText === 'Show', `${W}x${H} ${m}: the Show button is centred in the status bar (${Math.round(mid)} vs ${b.status.x + b.status.w / 2})`);
        ok(!b.rowTitles.includes('Chapters'), `${W}x${H} ${m}: no Chapters row (rows: ${b.rowTitles.join(', ')})`);
        if (m === 'track') console.log(`     Tracker row ${b.tracker?.h} px, section ${b.section.h}, video ${b.video.h}`);
        if (m === 'track' || m === 'scenes') await shot(`bottom-${m}-collapsed-${W}`, { x: 0, y: Math.max(0, b.section.y - 10), width: W, height: H - Math.max(0, b.section.y - 10) });
      }
    }

    // ---- the tray, open: 1280x720, Track ----
    await size(1280, 720);
    await reset('track'); await settle();
    const b0 = await bottom();
    await page.mouse.click(b0.button.x + b0.button.w / 2, b0.button.y + b0.button.h / 2); await settle(); await wait(300);
    const b1 = await bottom();
    ok(!!b1.tray && b1.buttonText === 'Hide', `the button opens the tray (${b1.tray?.h} px, now "${b1.buttonText}")`);
    ok(b1.video.h === b0.video.h, `the video does not move (${b0.video.h} -> ${b1.video.h})`);
    ok(b1.section.h === b0.section.h - b1.tray.h - 1, `the timeline gives the tray its height (${b0.section.h} -> ${b1.section.h}, tray ${b1.tray.h} + 1)`);
    ok(Math.abs(b1.tray.b - b1.status.y) <= 1 && Math.abs(b1.section.b + 1 - b1.tray.y) <= 1, `docked: under the timeline, on the status bar (tray ${b1.tray.y}..${b1.tray.b}, status ${b1.status.y})`);
    const tabs = await ev(() => [...document.querySelectorAll('[data-area=bottom] [role=tab]')].map((t) => t.textContent.trim()));
    ok(tabs.join() === 'Rows,Graph', `its tabs: ${tabs.join(', ')}`);
    ok(await ev(() => !!document.querySelector('[data-panel="timeline.rows"] [data-testid=tray-rows] .k-chip')), 'Rows shows the row chips');
    await shot('bottom-track-open-1280', { x: 0, y: b1.section.y - 10, width: 1280, height: 720 - b1.section.y + 10 });
    // a Rows chip hides a row, and shows it again
    const chip = page.locator('[data-panel="timeline.rows"] .k-chip', { hasText: 'Modifiers' }).locator('button');
    await chip.click(); await settle();
    ok(!(await bottom()).rowTitles.includes('Modifiers'), 'a Rows chip hides the Modifiers row');
    await chip.click(); await settle();
    ok((await bottom()).rowTitles.includes('Modifiers'), 'and shows it again');
    // Graph
    await page.locator('[data-area=bottom] [role=tab]', { hasText: 'Graph' }).click(); await settle(); await wait(1500);
    ok(await ev(() => { const e = document.querySelector('[data-panel=graph]'); return !!e && e.getBoundingClientRect().height > 50 && e.innerText.length + e.querySelectorAll('canvas, svg').length > 0; }), 'Graph shows its editor in the tray');
    // drag its top edge up 60 px
    const edge = await ev(() => { const t = document.querySelector('.areas > [data-area=bottom]').getBoundingClientRect(); const b = [...document.querySelectorAll('.areas > .border.col')].find((e) => Math.abs(e.getBoundingClientRect().bottom - t.top) <= 2); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    const g0 = await bottom();
    await page.mouse.move(edge.x, edge.y); await page.mouse.down();
    for (let k = 1; k <= 10; k++) await page.mouse.move(edge.x, edge.y - 6 * k);
    await page.mouse.up(); await settle();
    const g1 = await bottom();
    ok(Math.abs(g1.tray.h - g0.tray.h - 60) <= 2 && Math.abs(g0.section.h - g1.section.h - 60) <= 2 && g1.video.h === g0.video.h, `its top edge drags: tray ${g0.tray.h} -> ${g1.tray.h}, timeline ${g0.section.h} -> ${g1.section.h}, video ${g0.video.h} = ${g1.video.h}`);
    await shot('bottom-track-graph-1280', { x: 0, y: g1.section.y - 10, width: 1280, height: 720 - g1.section.y + 10 });
    await press('Control+j');
    ok(!(await bottom()).tray, 'Ctrl+J folds it');
    // the open tray at the owner's size
    await size(3000, 1600); await press('Control+j');
    const bb = await bottom();
    ok(!!bb.tray && bb.video.h > 0, `3000x1600: open ${bb.tray?.h} px, timeline ${bb.section.h}, video ${bb.video.h}`);
    await shot('bottom-track-open-3000', { x: 0, y: bb.section.y - 10, width: 3000, height: 1600 - bb.section.y + 10 });
    await press('Control+j');
    await size(1280, 720);

    // ---- F1 ----
    // 710c7ab: F1 opens on the help page picked last (a new profile: Quick start); these rows are on the Shortcuts page
    const keysPage = () => ev(() => { const b = document.querySelector('[data-testid=help-page-keys]'); if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); });
    for (const m of ['scenes', 'track', 'refine', 'review']) {
      await reset(m); await settle();
      await press('F1'); await wait(200); await keysPage(); await wait(200);
      const h = await ev(() => { const s = document.querySelector('[data-testid=help-here]'); return s ? { place: s.dataset.place, title: s.querySelector('h3').textContent, n: s.querySelectorAll('.row').length, first: s.querySelector('.row')?.innerText.replace(/\s+/g, ' ') } : null; });
      ok(h?.place === m && h.n > 0, `F1 in ${m}: the overlay, "${h?.title}" with ${h?.n} keys (first: ${h?.first})`);
      if (m === 'scenes') await shot('bottom-f1-scenes-1280');
      await press('Escape');
    }
    await ev(() => app.tabs.show('home')); await settle();
    await press('F1'); await wait(200); await keysPage(); await wait(200);
    const hh = await ev(() => { const s = document.querySelector('[data-testid=help-here]'); return s ? { place: s.dataset.place, rows: [...s.querySelectorAll('.row')].map((r) => r.innerText.replace(/\s+/g, ' ')) } : null; });
    ok(hh?.place === 'home' && hh.rows.some((r) => /Enter/.test(r)) && hh.rows.some((r) => /filter/.test(r)) && hh.rows.some((r) => /Ctrl/.test(r) && /Tab/.test(r)), `F1 on home: ${hh?.rows.join(' | ')}`);
    await shot('bottom-f1-home-1280');
    await press('Escape');
    ok(!(await ev(() => !!document.querySelector('.home .tips'))), 'no tips list on the project page');

    // ---- Ctrl+W on home ----
    await press('Control+w'); await wait(400);
    ok((await ev(() => app.tabs.list.length)) === 1 && (await ev(() => app.tabs.home)), 'Ctrl+W on home: nothing closes');

    // ---- no Chapters anywhere ----
    await ev(() => app.tabs.show(app.tabId)); await settle();
    for (const m of ['scenes', 'track', 'refine', 'review']) {
      await reset(m); await settle();
      const where = await ev(() => [...document.querySelectorAll('[role=tab], .rtab, .fold, .stack button')].filter((e) => /chapter/i.test(e.textContent)).map((e) => e.textContent.trim()));
      ok(!where.length, `${m}: no Chapters tab, row or button (${where.join(', ')})`);
    }
    const cmds = await ev(() => app.commands.list({ enabled: false }).filter((c) => /chapter/i.test(c.title) || /^chapters\./.test(c.id)).map((c) => c.id));
    ok(!cmds.length, `no chapter command in the palette / menus (${cmds.join(', ')})`);

    // ---- a .pawproj with chapters (the project just saved, the format HEAD writes, chapters put in): open, save, intact ----
    const projChapters = [{ id: 'ch1', t0: 0, t1: 1500, name: 'One', color: '#4DA6FF' }, { id: 'ch2', t0: 1000, t1: 3000, name: 'Overlap', color: null }];
    await ev(() => app.project.close({ force: true }));
    const savedProj = JSON.parse(readFileSync(base + '.pawproj', 'utf8'));
    writeFileSync(projPath, JSON.stringify({ ...savedProj, chapters: projChapters }));
    await open(projPath);
    ok((await ev(() => app.doc.chapters.length)) === 2, 'the HEAD project with chapters opens');
    await ev(() => app.edit('Add point', 'stroke', [...app.doc.axes.stroke, { at: 1400, pos: 30 }]));
    await save();
    const back = JSON.parse(readFileSync(projPath, 'utf8'));
    ok(JSON.stringify(back.chapters) === JSON.stringify(projChapters), `re-saved with its chapters intact (${JSON.stringify(back.chapters).slice(0, 100)}…)`);

    // ---- the tab's x closes (from the document; the doc is saved, so no question) ----
    await page.locator('[data-testid=tab-doc]').hover(); await page.locator('[data-testid=tab-close]').click(); await wait(500); await answer(); await settle();
    ok((await ev(() => app.tabs.list.length)) === 0, 'the tab\'s x closes the document');
    void dir;

    if (process.env.PERSIST) {
      await open(clip);
      await size(1280, 720); await reset('track');
      await ev(() => { app.layout.tab('bottom', 'graph'); app.layout.size('bottom', 240, 'graph'); }); await settle();
      const b = await bottom();
      ok(b.tray?.h === 240, `prepared for the restart: the tray open on Graph, ${b.tray?.h} px`);
    }
  }
} catch (e) { fails++; console.log('FAIL [exception]', e.stack || e); }
finally {
  console.log(fails ? `${fails} FAILED` : 'all ok');
  await browser.close().catch(() => {});
  process.exitCode = fails ? 1 : 0;
}
