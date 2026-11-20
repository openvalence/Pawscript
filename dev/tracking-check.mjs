// node dev/tracking-check.mjs <outDir>  -- checks on dev/tracking.html (vite on :5200): empty lane, modes / pointer
// events, span labels + persistence key, key conflicts, Bake of a run, remove rules, a narrow dock.
import { chromium } from 'playwright';
const out = process.argv[2] || '.';
const b = await chromium.launch({ channel: 'msedge', headless: true });
const p = await b.newPage({ viewport: { width: 1500, height: 940 } });
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text()); });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(`http://localhost:${process.env.VITE_PORT || 5200}/dev/tracking.html`);   // VITE_PORT: another server than check-all's :5200
await p.waitForTimeout(1200);
const ok = (c, msg) => console.log((c ? 'ok   ' : 'FAIL ') + msg);
const ev = (f) => p.evaluate(f);

ok(await p.locator('.tl .empty').isVisible(), 'empty lane hint in track mode: ' + await p.locator('.tl .empty').textContent());
ok(await ev(() => getComputedStyle(document.querySelector('#overlay canvas')).pointerEvents === 'auto'), 'overlay takes the pointer in track mode (box tracker)');
await ev(() => H.app.setMode('refine'));
await p.waitForTimeout(100);
ok(await ev(() => getComputedStyle(document.querySelector('#overlay canvas')).pointerEvents === 'none'), 'overlay ignores the pointer in the Refine tab');
ok((await p.locator('.tl .empty').textContent()).includes('Track tab'), 'lane hint in the Refine tab');
await p.keyboard.press('t');
await p.waitForTimeout(200);
ok(await ev(() => !H.tr.busy && !H.tr.live), 'T does nothing outside the Track tab');
await ev(() => H.app.setMode('track'));

// keys: conflicts that involve track.* commands
// (Escape is shared on purpose: track.cancel is registered first and only enabled while a job runs)
const conf = await ev(() => H.app.commands.conflicts().filter((c) => c.ids.some((id) => id.startsWith('track.')) && c.keys !== 'Escape'));
ok(!conf.length, 'no key conflicts with track.* besides the intended Escape ' + JSON.stringify(conf));
await ev(() => { H.app.select([1000]); });
await p.keyboard.press('Escape');
ok(await ev(() => H.app.doc.selection.ats.size === 0), 'Esc still clears the selection when no job runs');
console.log('track commands:', JSON.stringify(await ev(() => H.app.commands.list().filter((c) => c.id.startsWith('track.')).map((c) => c.id + (c.keys.length ? '=' + c.keys.join('/') : '') + (c.menu === 'Track' ? '' : ' (no menu!)')))));

// manual span labels (hidden commands now: spans derive from the scene tags) over a range; persisted under tracking.spans:<path>
await ev(() => { H.app.doc.range = { t0: 2000, t1: 6000 }; H.app.setView({ start: 0, span: 30000 }); });
await ev(() => H.app.commands.run('track.span.idle'));
await ev(() => { H.app.doc.range = { t0: 10000, t1: 14000 }; });
await ev(() => H.app.commands.run('track.span.carry'));
const sp = await ev(() => H.app.settings.get('tracking.spans:C:/clips/cfr2997.mp4'));
ok(sp?.length === 2 && sp[0].state === 'idle' && sp[1].state === 'carry', 'spans saved: ' + JSON.stringify(sp));

// a track with spans, then Bake the run (paw-x7w7: it plays live; no Accept) and check one undo step
await p.locator('#pane').click({ position: { x: 500, y: 200 } });   // speck: box tracker ignores (w/h 0) -> draw a real one
// 0d08109 (paw-40ps): a piece whose axis has points is baked, not live; the harness doc has stroke points everywhere: clear the range first
await ev(() => { H.tr.roi = { kind: 'box', x: 0.4, y: 0.3, w: 0.15, h: 0.4 }; H.app.doc.range = { t0: 0, t1: 16000 }; H.app.doc.axes = { ...H.app.doc.axes, stroke: H.app.doc.axes.stroke.filter((q) => q.at > 16000) }; });
await p.keyboard.press('Control+t');   // paw-rw84: T is the point grid now; Ctrl+T (track.run) with no part painted tracks a box set by code (paw-x8we)
// the camera check after a track keeps a hidden whole-frame reference run (tag 'camera', features/tracking/api.js): the owner's runs are the untagged ones
await p.waitForFunction(() => H.tr.runs.filter((r) => !r.tag).length === 1 && !H.tr.busy, null, { timeout: 30000 });
console.log('events with spans:', JSON.stringify(await ev(() => H.tr.runs[0].events.map((e) => e.kind))));
const h0 = await ev(() => H.app.history.entries.length);
await ev(() => { H.tr.select(H.tr.runs[0].id); });
const n = await ev(() => H.tr.bake({ run: H.tr.runs[0].id }));
const h1 = await ev(() => H.app.history.entries.length);
ok(n > 0 && h1 === h0 + 1, `Bake the run: ${n} spans, history +${h1 - h0}`);
ok(await ev(() => H.app.doc.ghosts.some((g) => g.id === 'ref')), 'reference still there after the Bake');
await ev(() => H.tr.remove('ref'));
ok(await ev(() => H.app.doc.ghosts.some((g) => g.id === 'ref')), 'pinned reference cannot be removed');
await ev(() => H.app.undo());

// narrow dock with the run expanded
await ev(() => { H.setWidth(272); H.tr.select(H.tr.runs[0].id); H.app.doc.range = { t0: 0, t1: 16000 }; H.app.player.seek(3000); });
await p.waitForTimeout(500);
await p.locator('.ghost.sel').scrollIntoViewIfNeeded();
await p.screenshot({ path: `${out}/20-narrow.png` });
await p.locator('#panel').screenshot({ path: `${out}/21-panel.png` });

// flip via the strip, then remove the run: ghost gone, lane empty again
await p.locator('.strip .sign').nth(1).click();
ok(await ev(() => H.tr.runs[0].flips.join() === '1'), 'strip click flips scene 2');
const gs = await ev(() => H.app.doc.ghosts.find((g) => g.id === H.tr.runs[0].id).script.slice(0, 3));
console.log('ghost after flip (first 3):', JSON.stringify(gs));
const rid = await ev(() => H.tr.runs[0].id);
await ev(() => H.tr.remove(H.tr.runs[0].id));
// (the camera check's hidden reference run stays: it is its own record)
ok(await p.evaluate((id) => !H.tr.runs.some((r) => r.id === id || !r.tag) && !H.app.doc.ghosts.some((g) => g.id === id), rid), 'remove drops record and ghost');
await b.close();
