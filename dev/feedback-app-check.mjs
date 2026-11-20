// dev/feedback-app-check.mjs -- the feedback note field and the fix log in YOUR test instance (node dev/test-app.mjs
// start ..., then the CDP_* env it prints; its own data dir app.pawscript.test-<id>). Opens <video>, plays it, ` opens
// the field while it plays, typing (Space included) stays in the field, Enter saves to feedback.jsonl, Esc cancels, a `
// in another text field stays a character, the note is kept with no Chapters row (removed: paw-1w0x), and a few store
// edits come out as one fix-log episode in fixes.jsonl.
//   node dev/feedback-app-check.mjs <video> [out.png]
import { connectTestApp } from './cdp-connect.mjs';

const [video, shot] = process.argv.slice(2);
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a);
const wait = (ms = 300) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const readData = (name) => ev(async (n) => { const d = (await app.backend.appPaths()).data_dir, p = d + (d.includes('\\') ? '\\' : '/') + n; return { dir: d, text: (await app.backend.exists(p)) ? await app.backend.readText(p) : null }; }, name);
try {
  await page.waitForFunction(() => window.app?.project, null, { timeout: 300000 });
  const dir = (await readData('x')).dir;
  ok(/app\.pawscript\.test-/.test(dir), `the test instance writes to its own data dir (${dir})`);
  await ev((v) => app.project.openVideo(v), video);
  await page.waitForFunction(() => app.doc.media && app.player.durationMs > 0, null, { timeout: 30000 });
  const d = await ev(() => app.player.durationMs);
  await ev((dur) => { app.setMode('refine'); app.doc.scenes = [{ start_ms: 0, end_ms: dur / 2 }, { start_ms: dur / 2, end_ms: dur }]; app.player.seek(dur * 0.6); }, d);
  await wait(600);
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await ev(() => document.activeElement?.blur?.());
  await page.keyboard.press('Space'); await wait(500);
  ok(await ev(() => app.player.playing), 'Space plays the video');
  await page.keyboard.press('Backquote'); await wait(400);
  const field = page.getByRole('textbox', { name: 'Feedback note' });
  ok(await field.isVisible(), '` opens the note field while the video plays');
  ok(await ev(() => document.activeElement?.getAttribute('aria-label') === 'Feedback note'), 'the field has the keyboard');
  ok(await ev(() => app.player.playing), 'opening it does not stop the video');
  await page.keyboard.type('! source jumps g s x at the cut', { delay: 15 });
  ok((await field.inputValue()) === '! source jumps g s x at the cut', `Space and letters type into the field, no shortcut fired (value "${await field.inputValue()}")`);
  ok(await ev(() => app.player.playing), 'Space inside the field typed a space instead of pausing');
  ok(await page.locator('.note .tone.bug').isVisible(), 'the leading ! shows the bug chip');
  await page.keyboard.press('Enter'); await wait(1200);
  ok(!(await field.isVisible().catch(() => false)), 'Enter closes the field');
  const notes = await ev(() => app.feedback.notes.map((n) => ({ ...n, recent: n.recent.length })));
  const n = notes[0];
  ok(notes.length === 1 && n.tone === 'bug' && n.text === 'source jumps g s x at the cut', `one note saved with its tone (${notes.length}, ${n?.tone}, "${n?.text}")`);
  ok(n && n.scene === 2 && n.shot === 2 && n.at > 0 && n.mode === 'refine' && n.project?.startsWith('n') && n.recent > 0 && n.screenshot === null && !String(n.video).includes('\\'), `its context: S${n?.scene} shot ${n?.shot} at ${n?.at} ms, mode ${n?.mode}, focus "${n?.focus}", ${n?.recent} recent events, no path`);
  await wait(500);
  const fb = await readData('feedback.jsonl');
  ok(fb.text && JSON.parse(fb.text.trim().split('\n').at(-1)).id === n.id, 'feedback.jsonl holds the note (append-only line)');
  await page.keyboard.press('Space'); await wait(300);
  ok(!(await ev(() => app.player.playing)), 'after the note, Space is play / pause again');
  await page.keyboard.press('Backquote'); await wait(300);
  await page.keyboard.type('never mind'); await page.keyboard.press('Escape'); await wait(300);
  ok(!(await field.isVisible().catch(() => false)) && (await ev(() => app.feedback.notes.length)) === 1, 'Esc cancels: nothing saved');
  // a ` typed into another text field stays a character there
  await ev(() => { const i = document.createElement('input'); i.id = 'probe-input'; document.body.append(i); i.focus(); });
  await page.keyboard.press('Backquote'); await wait(200);
  ok((await ev(() => document.getElementById('probe-input').value)) === '`' && !(await field.isVisible().catch(() => false)), '` inside another text field types ` and leaves the note closed');
  await ev(() => document.getElementById('probe-input').remove());
  // the notes' dots lived on the Chapters row, removed in 014f5cd (paw-1w0x): the notes are in feedback.jsonl only
  ok(!(await ev(() => document.querySelector('[data-tl-lane="chapters"]'))) && (await ev(() => app.feedback.notes.length)) === 1, 'no Chapters row; the note is kept (feedback.jsonl)');
  // the fix log: a run's source changed, a cut moved, undone within 10 s -> one episode in fixes.jsonl
  await ev((dur) => {
    const L = app.doc.scenes;
    app.transact('Signal: source', () => { app.doc.scenes = L.map((s, i) => (i === 1 ? { ...s, derive: { source: 'sem_c1_penis' } } : s)); });
    app.transact('Signal: source', () => { app.doc.scenes = app.doc.scenes.map((s, i) => (i === 1 ? { ...s, derive: { source: 'rel:sem_c1_penis:sem_c2_hips' } } : s)); });
    app.transact('Merge shots', () => { app.doc.scenes = app.doc.scenes.map((s, i) => (i === 1 ? { ...s, join: true } : s)); });
    app.undo();
    app.fixes.closeAll();
  }, d);
  await wait(800);
  const fx = await readData('fixes.jsonl');
  const last = fx.text ? JSON.parse(fx.text.trim().split('\n').at(-1)) : null;
  ok(last && /changed source sem_c1_penis -> rel:sem_c1_penis:sem_c2_hips 2x/.test(last.text) && /undid "Merge shots" within 10 s/.test(last.text), `fixes.jsonl has the episode: "${last?.text}"`);
  ok(!errs.length, `no console errors (${errs.slice(0, 3).join(' | ')})`);
} finally {
  await browser.close();
}
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
