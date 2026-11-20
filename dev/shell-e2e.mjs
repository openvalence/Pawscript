// dev/shell-e2e.mjs -- end-to-end run of the real Tauri app through WebView2's DevTools port.
// Start YOUR test instance with node dev/test-app.mjs start --dir <scratch> --target <cargo target> and set the
// CDP_PORT / CDP_EXPECT_URL / CDP_TEST_ID it prints (dev/cdp-connect.mjs refuses anything else).
//   node dev/shell-e2e.mjs <clip.mp4 with clip.funscript beside it> <screenshot dir>
import { connectTestApp } from './cdp-connect.mjs';

const [clip, out = '.'] = process.argv.slice(2);
// fresh fixtures beside the clip every run: a hand-made stroke script with an unknown key and a chapter, a roll axis
import { writeFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, basename } from 'node:path';
{
  const dir = dirname(clip), stem = basename(clip).replace(/\.[^.]+$/, '');
  for (const f of readdirSync(dir)) if (f.startsWith(stem + '.') && /\.(bak|funscript)$/.test(f)) rmSync(dir + '/' + f);
  const a = []; for (let t = 500; t < 9000; t += 400) a.push({ at: t, pos: a.length % 2 ? 90 : 10 });
  writeFileSync(`${dir}/${stem}.funscript`, JSON.stringify({ version: '1.0', inverted: false, range: 100, myUnknownKey: { keep: 'me' }, metadata: { title: stem, chapters: [{ name: 'Start', startTime: '00:00:00.000', endTime: '00:00:04.000' }] }, actions: a }));
  const r = []; for (let t = 1000; t < 9000; t += 1500) r.push({ at: t, pos: 50 + (r.length % 2 ? 20 : -20) });
  writeFileSync(`${dir}/${stem}.roll.funscript`, JSON.stringify({ version: '1.0', actions: r }));
}
const { browser: b, page } = await connectTestApp();   // refuses unless this is provably your own test instance
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
const ev = (f, arg) => page.evaluate(f, arg);
const wait = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const results = [];
const check = (name, ok, info = '') => { results.push([ok ? 'PASS' : 'FAIL', name, info]); console.log(ok ? 'PASS' : 'FAIL', name, info); };
const key = async (...ks) => { for (const k of ks) { await page.keyboard.press(k); await wait(150); } };

/** Answer dialogs as they come: answers = {titleRegex: choiceIndex}; returns the titles seen. */
async function answer(answers, ms = 6000) {
  const seen = [], t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const d = await ev(() => app.dialog && { title: app.dialog.title, choices: app.dialog.choices.map((c) => c.id) });
    if (d) {
      seen.push(d.title);
      const k = Object.keys(answers).find((re) => new RegExp(re).test(d.title));
      await ev((id) => app.dialog.resolve(id), d.choices[k ? answers[k] : 0]);
      await wait(300);
    } else await wait(100);
    if (await ev(() => !app.dialog && !app.project.busy && !!app.doc.media) && seen.length) break;
  }
  return seen;
}
const doc = () => ev(() => ({ n: app.doc.axes.stroke?.length ?? 0, roll: app.doc.axes.roll?.length ?? 0, dirty: app.doc.dirty, undo: app.history.undoLabel, redo: app.history.redoLabel, chapters: app.doc.chapters.length, ghosts: app.doc.ghosts.length }));

// ---- 1. open ----
await ev(() => app.project.close({ force: true }));   // a test never answers Discard (that needs a real click); force keeps the autosave
await answer({ Recover: 1 }, 1500);   // a pending startup recovery: 'Discard' is refused from a script -> dismissed (later)
await ev(() => { if (app.devicePreview?.on) app.devicePreview.toggle(false); });
const opening = ev((p) => app.project.openVideo(p), clip);
const seen = await answer({ Recover: 1, Found: 0 });
await opening;
await wait(800);
let d = await doc();
check('open video with sibling scripts', d.n > 0 && d.roll > 0 && d.chapters > 0 && !d.dirty, JSON.stringify({ seen, ...d }));
await shot('e1-open');

// ---- 2. edit, undo, redo through keys ----
await page.mouse.click(5, 300);   // focus the page (not a text field)
await ev(() => app.player.seek(3450)); await wait(400);
const n0 = d.n;
await key('Numpad5'); d = await doc();   // paw-5zpf: the point keys are the NumPad's in the Blender keymap
// d.dirty is "not written yet" since the continuous write (paw-up1r): it clears about a second after an edit, so not asserted here
check('digit key adds a point', d.n === n0 + 1 && d.undo === 'Add point', JSON.stringify(d));
await key('Control+z'); d = await doc();
check('Ctrl+Z undoes it', d.n === n0 && !!d.redo, JSON.stringify(d));
await key('Control+y'); d = await doc();
check('Ctrl+Y redoes it', d.n === n0 + 1 && !d.redo, JSON.stringify(d));

// ---- 3. save / reopen round trip ----
// Ctrl+S is Commit since paw-up1r stage 2 (the project is written continuously); Publish (Ctrl+Alt+S) writes the funscript
await key('Control+Alt+s'); await answer({}, 1200); await wait(800); d = await doc();
check('Ctrl+Alt+S publishes', !d.dirty, JSON.stringify(d));
{
  const { readFileSync, existsSync } = await import('node:fs');
  const f = JSON.parse(readFileSync(clip.replace(/\.[^.]+$/, '.funscript'), 'utf8'));
  check('saved file keeps unknown keys + chapters, original backed up', f.myUnknownKey?.keep === 'me' && f.metadata?.chapters?.length === 1 && f.actions.length === n0 + 1 && existsSync(clip.replace(/\.[^.]+$/, '.funscript.bak')));
}
await ev(() => app.project.close()); await wait(300);
const re = ev((p) => app.project.openVideo(p), clip); await answer({ Recover: 1, Found: 0 }); await re; await wait(500);
d = await doc();
check('reopen shows the saved edit', d.n === n0 + 1, JSON.stringify(d));

// ---- 3b. export through the real dialog host (two choose() in a row; answered by keyboard, not app.dialog.resolve) ----
{
  await page.mouse.click(5, 300);
  await ev(() => { window.__exp = app.project.exportDialog(); });
  const titles = [];
  for (let i = 0; i < 2; i++) {
    await wait(500);
    titles.push(await ev(() => app.dialog?.title || null));
    await page.keyboard.press('Enter');   // the primary choice: all axes, then "Next to <video>"
  }
  await wait(1000);
  const ok = await ev(() => Promise.race([window.__exp, new Promise((r) => setTimeout(() => r('pending'), 2000))]));
  check('Ctrl+E export: both dialogs show and the export runs', titles[0] === 'Export funscripts' && titles[1] === 'Export to' && ok === true, JSON.stringify({ titles, ok }));
}

// ---- 4. autosave + crash recovery ----
await ev(() => app.player.seek(5650)); await wait(300);
await key('9');
await ev(() => app.project.flushAutosave()); await wait(500);
const before = (await doc()).n;
await page.reload(); await page.waitForFunction(() => window.app && app.project, null, { timeout: 15000 }); await wait(1500);
const seenR = await answer({ Recover: 0, Found: 0 }, 4000);   // the startup check offers it
if (!(await ev(() => !!app.doc.media))) { const o = ev((p) => app.project.openVideo(p), clip); seenR.push(...(await answer({ Recover: 0, Found: 0 }))); await o; }
await wait(800); d = await doc();
// paw-up1r stage 1: the project is written continuously, so a crash leaves nothing to recover and nothing is asked
check('the edit survives a reload with no Recover question (continuous write)', !seenR.some((t) => /Recover/.test(t)) && d.n === before, JSON.stringify({ seenR, ...d }));
// Ctrl+S opens the commit dialog (0378811, paw-up1r stage 2; its note field has the focus): Enter commits and closes it, so
// the keys below reach the app and not the note
await key('Control+s'); await page.locator('[data-testid="commit-note"]').waitFor({ timeout: 5000 }).catch(() => {}); await key('Enter'); await answer({}, 1200); await wait(600);
check('Ctrl+S, Enter: committed, the commit dialog closed', !(await ev(() => !!app.project.commitDraft)));

// ---- 5. modes ----
for (const [k, m] of [['Control+1', 'scenes'], ['Control+3', 'refine'], ['Control+4', 'review'], ['Control+2', 'track']]) {   // modes.js MODES order; Track last for section 6
  await key(k); await wait(700);
  check('mode ' + m, (await ev(() => app.mode)) === m);
  await shot('e5-' + m);
}

// ---- 6. tracker run over the scripted range -> Unbake -> live -> Bake -> undo (Track mode, fake sidecar; paw-x7w7, paw-j89h) ----
const trackerSelect = await page.evaluateHandle(() => [...document.querySelectorAll('select, [role=combobox]')].find((e) => /Fake/.test(e.textContent || e.value)));
const hasCombo = !!(await trackerSelect.asElement());
// the box tracker picked: the pick is remembered (tracking.lastTracker), so a check run before this one on the same instance
// (check-all) leaves its own (fake.groups: no painted groups here, empty runs)
await ev(() => { if (window.__pawDev?.trackingFor(app).trackers.some((t) => t.id === 'fake.box')) window.__pawDev.trackingFor(app).selectTracker('fake.box'); app.doc.range = { t0: 1000, t1: 8000 }; });
// paw-x8we: no box is drawn on the video any more; a box set by code (Describe, a plan, Fix) is what Ctrl+T tracks when no part
// is painted (the fake box tracker takes a box)
await ev(() => { const tr = window.__pawDev?.trackingFor(app); if (tr) tr.roi = { kind: 'box', x: 0.35, y: 0.35, w: 0.2, h: 0.25, t_ms: Math.round(app.player.timeMs) }; });
await wait(300);
const layer = await ev(() => app.player.overlays ? { tool: app.player.overlays.tool, drawers: app.player.overlays.drawers.map((d) => d.id) } : null);
if (layer) check('tracker ROI tool + drawer live on the player overlay layer', layer.tool === 'tracking.roi' && layer.drawers.includes('tracking.runs'), JSON.stringify(layer));
const roiSet = await ev(() => app.player.overlays ? true : null);
// never run a real tracker (GPU) from a test: the fake sidecar's trackers are named "Fake ..."
if (!hasCombo) { console.error('refusing to press T: the tracker list is not the fake sidecar (set PAWTRACK_CMD="node test/fake-pawtrack.mjs")'); process.exit(3); }
// the owner's ghosts only: every non-whole-frame run also makes the camera check's reference run, a hidden ghost tagged
// 'camera' (checkCamera; with the fake sidecar an empty fake.none run), which is not the track's
const own = () => ev(() => app.doc.ghosts.filter((g) => !g.source?.tag).map((g) => [g.id, g.script.length]));
const g0 = (await own()).length, a0 = (await doc()).n;
await key('Control+t');   // Track ROI is Ctrl+T since a8ea456 (T is the point grid); no part painted: the box set above
for (let i = 0; i < 80 && (await ev(() => app.tasks.length)) > 0; i++) await wait(150);
await wait(600);
const g1 = await own();
check('Ctrl+T runs the tracker into a ghost', g1.length === g0 + 1 && g1.at(-1)[1] > 0, JSON.stringify({ hasCombo, g1, tr: await ev(() => { const tr = window.__pawDev?.trackingFor(app); return tr && { id: tr.trackerId, can: tr.canTrack, roi: tr.trackRoi?.kind || null, error: tr.error, notice: tr.notice, runs: tr.runs.map((r) => [r.id, r.tracker?.id, r.points?.at?.length, r.tag]) }; }) }));
await shot('e6-tracked');
// 2e31f7a (paw-x7w7): a shot with points of its own (here the sibling script opened in section 1) is baked, and a run never
// changes baked points: the script is still the opened one. Unbake gives the range to the run; Bake makes it permanent again.
check('the run leaves the opened (baked) script as it was', (await ev(() => app.script.length)) === a0 && (await doc()).n === a0, String(a0));
await ev(() => app.commands.run('tracking.unbake', { range: { t0: 1000, t1: 8000 } })); await wait(300); d = await doc();
const a1 = d.n, live = await ev(() => app.script.length);
check('Unbake: the run plays live there (one undo entry)', /^Unbake/.test(d.undo) && a1 < a0 && live > a1, JSON.stringify({ a0, live, ...d }));
await ev(() => app.commands.run('tracking.bake', { range: { t0: 1000, t1: 8000 } })); await wait(300); d = await doc();
check('Bake writes the run (one undo entry)', d.n === live && /^Bake/.test(d.undo), JSON.stringify({ live, ...d }));
await shot('e6-baked');
await key('Control+z'); d = await doc();
check('Ctrl+Z undoes the Bake', d.n === a1 && /^Unbake/.test(d.undo), JSON.stringify(d));
await key('Control+z'); d = await doc();   // and the Unbake: the opened script again, as the sections after this one expect
check('Ctrl+Z again undoes the Unbake: the opened script is back', d.n === a0 && (await ev(() => app.script.length)) === a0, JSON.stringify(d));

// ---- 7. palette ----
await key('Control+k'); await wait(300);
await page.keyboard.type('zoom'); await wait(300);
await shot('e7-palette');
const pal = await ev(() => document.querySelector('dialog[open]')?.textContent.slice(0, 200) || '');
check('Ctrl+K opens the palette with matches', /zoom/i.test(pal), pal.slice(0, 80));
await key('Escape');

// ---- 8. rebinding ----
await ev(() => app.commands.setKeys('view.fit', ['Ctrl+Shift+F']));
await ev(() => app.setView({ start: 2000, span: 1000 }));
await key('Control+Shift+F'); await wait(200);
const span = await ev(() => app.view.span);
check('a rebound key runs its command', span > 5000, 'span ' + span);
await ev(() => app.commands.setKeys('view.fit', null));
await ev(() => app.commands.run('palette.keys')); await wait(500); await shot('e8-keys'); await key('Escape');   // an overlay since paw-idb5

// ---- 9. docks ----
const L0 = await ev(() => app.layout.cur.left.collapsed);
await key('Control+b'); await wait(300);
check('Ctrl+B toggles the left dock', (await ev(() => app.layout.cur.left.collapsed)) !== L0);
await key('Control+b');
// (the docks are areas since 626bf75, labelled by their panel: the right dock is the area painted against the window's right
// edge, unfolded first)
await ev(() => app.layout.toggle('right', true)); await wait(300);
await ev(() => app.layout.size('right', 420)); await wait(300);
const rightW = await ev(() => Math.max(0, ...[...document.querySelectorAll('section.area')].map((e) => e.getBoundingClientRect()).filter((r) => r.width && Math.abs(r.right - innerWidth) < 6 && r.top < innerHeight / 2).map((r) => r.width)));
check('right dock resizes', rightW >= 400, `${Math.round(rightW)} px`);
await shot('e9-docks');
await ev(() => app.layout.size('right', 330));

// ---- 10. assist: questions -> answer two by key -> undo one ----
if (await ev(() => !!app.commands.get('assist.open'))) {
  await key('Control+3');
  await ev(() => app.commands.run('track.detectScenes'));
  for (let i = 0; i < 60 && (await ev(() => app.tasks.length)) > 0; i++) await wait(150);
  await wait(500);
  await ev(() => app.commands.run('assist.regenerate')); await wait(300);
  await key('F6'); await wait(600);
  const open = await ev(() => !!document.querySelector('dialog[open]'));
  await shot('e10-assist');
  const h0 = await ev(() => app.history.index);
  await key('ArrowLeft'); await wait(400); await key('ArrowLeft'); await wait(400);
  const h1 = await ev(() => app.history.index);
  await shot('e10-assist-answered');
  await key('Control+z'); await wait(300);
  const h2 = await ev(() => app.history.index);
  check('assist opens, two answers by key (an answer that changes nothing makes no entry), Ctrl+Z takes one back', open && h1 > h0 && h2 === h1 - 1, JSON.stringify({ open, h0, h1, h2 }));
  await key('Escape'); await wait(300);
  check('Esc closes the assist overlay', !(await ev(() => !!document.querySelector('dialog[open]'))));
}

console.log('\nconsole errors:', errors.length ? errors.slice(0, 10) : 'none');
console.log(results.filter((r) => r[0] === 'FAIL').length + ' failed of ' + results.length);
await b.close().catch(() => {});
