// dev/regions-check.mjs -- paw-2lp7.2 (action regions, stage 1) in YOUR test instance (node dev/test-app.mjs start ...; the CDP_*
// env it prints), on a copy of a generated clip (dev/assets/assist60.mp4) in a folder of yours (the project is saved beside it).
//   1. prepare: the clip opened alone; five scenes (one of two shots with an edited band, one with a second act, one untagged, one
//      idle); what the Scenes row paints recorded; saved; the saved file's `acts` taken out (a project as the scenes-only build
//      saved it); opened again: the toast "Scenes converted to N action regions", doc.acts as expected, the Scenes row painted the
//      same; tag a scene / join two scenes / undo: doc.acts changes and the row follows; saved (now with acts).
//   2. (restart the app with the same --id) check: opened again: no toast, doc.acts and the shots exactly as saved.
// Every page exception and console error fails it.
//   node dev/regions-check.mjs prepare|check <clip.mp4> <out dir>
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';

const [phase, clip, out] = process.argv.slice(2);
if (!['prepare', 'check'].includes(phase) || !clip || !out) { console.error('usage: node dev/regions-check.mjs prepare|check <clip.mp4> <out dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const proj = clip.replace(/\.[^.]+$/, '.pawproj'), saved = `${out}/regions-saved.json`;
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const answer = () => ev(() => { const d = app.dialog; if (!d) return; const t = d.title || ''; d.resolve(/^Recover/.test(t) ? 'discard' : /^Replace/.test(t) ? 'replace' : /changed outside/.test(t) ? 'project' : /Save changes/.test(t) ? 'discard' : d.choices?.[0]?.id ?? null); });
const settle = async (pred) => { for (let k = 0; k < 40; k++) { await answer(); if (await ev(pred).catch(() => false)) return true; await wait(500); } return false; };
const J = JSON.stringify;
const acts = () => ev(() => (app.doc.acts || []).map((r) => `${r.layer}:${r.kind}:${r.t0}-${r.t1}:${r.tags.join('+')}${r.range ? ':band' : ''}`));
const runs = () => ev(() => { const L = app.doc.scenes, o = []; L.forEach((s, i) => { if (i && s.join === true) o[o.length - 1][1] = i; else o.push([i, i]); }); return o; });
const steps = () => ev(() => app._history.entries.length);
const hook = () => ev(() => {
  window.__toasts = [];
  if (!app.__toastHooked) { const o = app.toast.bind(app); app.toast = (m, ...a) => { window.__toasts.push(String(m)); return o(m, ...a); }; app.__toastHooked = true; }
  window.__ft = [];
  if (!window.__ftHooked) {
    const o = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { const l = this.canvas?.closest?.('[data-tl-lane]')?.getAttribute('data-tl-lane'); if (l === 'scenes') window.__ft.push(String(t)); return o.call(this, t, ...a); };
    window.__ftHooked = true;
  }
});
/** What the Scenes row paints (its canvas text), after a forced repaint. */
const row = async () => { await ev(() => { window.__ft = []; app.setView({ start: 0, span: 60001 }); }); await wait(300); await ev(() => { window.__ft = []; app.setView({ start: 0, span: 60000 }); }); await wait(500); return ev(() => { const f = window.__ft.filter((t) => !t.startsWith('⤒')), e = f.indexOf('SHOTS'); return e >= 0 ? f.slice(0, e + 1) : f; }); };   // one paint (it may paint twice); the selected shot's cutaway button left out
const open = async () => {
  await hook();
  ev((f) => app.project.openProject(f, { force: true }), proj).catch(() => {});
  ok(await settle(() => app.doc.project?.path && app.doc.scenes.length > 0 && app.player.ready), `opened ${proj}`);
  await ev(() => { app.setMode('scenes'); app.player.pause(); });
  await wait(800);
};

try {
  if (phase === 'prepare') {
    await hook();
    await ev(() => app.load({}));   // a fresh document: the open below is the one waited for
    ev((p) => app.project.openVideo(p, { force: true }), clip).catch(() => {});
    ok(await settle(() => app.doc.media && app.player.ready && app.player.vw > 0), 'the clip opened');
    await ev(() => {
      app.setMode('scenes'); app.player.pause();
      app.doc.scenes = [
        { start_ms: 0, end_ms: 8000, tags: ['anal', 'penetration'], range: { lo: 20, hi: 70 } }, { start_ms: 8000, end_ms: 15000, join: true },
        { start_ms: 15000, end_ms: 25000, tags: ['oral', 'penetration', 'handjob'] },
        { start_ms: 25000, end_ms: 32000 },
        { start_ms: 32000, end_ms: 40000, tags: ['vaginal', 'penetration'] },
        { start_ms: 40000, end_ms: 60000, tags: ['idle'] },
      ];
      app.setView({ start: 0, span: 60000 });
    });
    const rowBefore = await row();
    ok(rowBefore.length > 0, `the Scenes row paints (${rowBefore.length} labels: ${rowBefore.slice(0, 6).join(' | ')} ...)`);
    await page.screenshot({ path: `${out}/0-scenes.png` });
    await ev(() => app.project.save()).catch((e) => console.log('save:', e?.message));
    ok(await settle(() => !app.doc.dirty), 'saved');
    const f = JSON.parse(readFileSync(proj, 'utf8'));
    ok(Array.isArray(f.acts) && f.acts.length === 5, `the new build saves acts (${f.acts?.length})`);
    delete f.acts;   // as the scenes-only build saved it
    writeFileSync(proj, JSON.stringify(f));
    await open();
    const n = await ev(() => app.doc.acts.length);
    ok((await ev(() => window.__toasts)).some((t) => t === `Scenes converted to ${n} action regions`), `the toast: ${J((await ev(() => window.__toasts)).filter((t) => /converted/.test(t)))}`);
    ok(J(await acts()) === J(['0:act:0-15000:anal+penetration:band', '0:act:15000-25000:oral+penetration', '0:act:32000-40000:vaginal+penetration', '0:idle:40000-60000:', '1:act:15000-25000:handjob']), `doc.acts: ${J(await acts())}`);
    ok(J(await runs()) === J([[0, 1], [2, 2], [3, 3], [4, 4], [5, 5]]), `the scenes as before: ${J(await runs())}`);
    const rowConv = await row();
    ok(J(rowConv) === J(rowBefore), `the Scenes row paints the same after conversion${J(rowConv) === J(rowBefore) ? '' : `: ${J(rowConv)} vs ${J(rowBefore)}`}`);
    await page.screenshot({ path: `${out}/1-converted.png` });

    // tag scene 4 (vaginal) with handjob from the palette command: its region keeps its id, a layer-1 handjob over it
    const id4 = await ev(() => app.doc.acts.find((r) => r.t0 === 32000).id);
    await ev(() => { app.player.seek(35000, { exact: true }); });
    await wait(600);
    let s0 = await steps();
    await ev(() => app.commands.run('timeline.scene.tag.handjob'));
    await wait(400);
    ok((await steps()) === s0 + 1, 'tag: one undo step');
    ok((await acts()).includes('1:act:32000-40000:handjob') && (await ev((id) => app.doc.acts.find((r) => r.id === id)?.t0, id4)) === 32000, `tag: doc.acts gains handjob over scene 4, its main region the same (${J(await acts())})`);
    const rowTag = await row();
    ok(rowTag.some((t) => /handjob/.test(t)) && J(rowTag) !== J(rowConv), `tag: the row follows (${rowTag.filter((t) => /handjob|vaginal/.test(t)).join(' | ')})`);
    // join scenes 3 and 4: one layer-0 region over both (paw-2lp7.5: the scene merge is a region now: Alt+Shift+J over the range)
    s0 = await steps();
    await ev(() => { app.doc.range = { t0: 25000, t1: 40000 }; app.commands.run('timeline.scene.mergeRange'); });
    await wait(400);
    ok((await steps()) === s0 + 1, 'join: one undo step');
    ok((await acts()).some((a) => a.startsWith('0:act:25000-40000:')) && J(await runs()) === J([[0, 1], [2, 2], [3, 4], [5, 5]]), `join: one region over shots 3-4 (${J(await acts())}; scenes ${J(await runs())})`);
    const rowJoin = await row();
    ok(J(rowJoin) !== J(rowTag), 'join: the row follows');
    await page.screenshot({ path: `${out}/2-joined.png` });
    await ev(() => app.undo()); await wait(400);
    ok((await acts()).includes('1:act:32000-40000:handjob') && J(await runs()) === J([[0, 1], [2, 2], [3, 3], [4, 4], [5, 5]]), `undo the join: regions and scenes back (${J(await acts())})`);
    const rowU = await row(); ok(J(rowU) === J(rowTag), `undo the join: the row back${J(rowU) === J(rowTag) ? '' : `: ${J(rowU)} vs ${J(rowTag)}`}`);
    await ev(() => app.undo()); await wait(400);
    ok(!(await acts()).includes('1:act:32000-40000:handjob'), 'undo the tag: handjob gone from doc.acts');
    const rowU2 = await row(); ok(J(rowU2) === J(rowConv), `undo the tag: the row as converted${J(rowU2) === J(rowConv) ? '' : `: ${J(rowU2)} vs ${J(rowConv)}`}`);
    await ev(() => app.redo()); await wait(300);   // keep the tag for the restart
    await ev(() => app.project.save()).catch((e) => console.log('save:', e?.message));
    ok(await settle(() => !app.doc.dirty), 'saved again');
    const g = JSON.parse(readFileSync(proj, 'utf8'));
    ok(Array.isArray(g.acts) && g.acts.length === 6, `saved with doc.acts (${g.acts?.length})`);
    writeFileSync(saved, JSON.stringify({ acts: await acts(), runs: await runs(), row: await row(), scenes: await ev(() => app.doc.scenes) }));
  } else {
    ok(existsSync(saved), 'the prepare phase ran');
    const want = JSON.parse(readFileSync(saved, 'utf8'));
    await open();
    ok(!(await ev(() => window.__toasts)).some((t) => /converted/.test(t)), 'reopened after a restart: no conversion toast');
    ok(J(await acts()) === J(want.acts), `doc.acts as saved (${J(await acts())})`);
    ok(J(await runs()) === J(want.runs) && J(await ev(() => app.doc.scenes)) === J(want.scenes), 'the shots exactly as saved');
    ok(J(await row()) === J(want.row), 'the Scenes row as before the restart');
    await page.screenshot({ path: `${out}/3-reopened.png` });
  }
} catch (e) { fails++; console.log('FAIL', e?.message || e); }
console.log(fails ? `${fails} FAILED` : 'all ok');
await browser.close();
process.exit(fails ? 1 : 0);
