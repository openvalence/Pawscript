// Feedback notes and the fix log (paw-dze): ` opens the note field; Help has the paths an agent reads.
import { feedbackOf } from './feedback.svelte.js';

const G = { menu: 'Help', group: 'feedback' };
async function copy(app, text, what) {
  try { await navigator.clipboard.writeText(text); app.toast(`Copied ${what}: ${text}`, 'info', { timeout: 8000 }); }
  catch { app.toast(`${what}: ${text}`, 'info', { timeout: 15000 }); }
}
async function dataDir(app) {
  try { return (await app.backend?.appPaths?.())?.data_dir || ''; } catch { return ''; }
}

export default [
  // whileTyping false: a ` typed into another text field stays a character there
  { id: 'feedback.note', title: 'Feedback note (Enter saves, Esc cancels)', keys: ['`'], whileTyping: false, ...G, run: (app) => feedbackOf(app).start() },
  { id: 'feedback.copyPath', title: 'Copy feedback log path', ...G, run: async (app) => {
    const d = await dataDir(app);
    if (!d) return app.toast('Feedback notes are kept in a file only in the desktop app', 'quiet');
    await copy(app, await feedbackOf(app).path(), 'feedback log path');
  } },
  // paw-cz18: a command for the repo's dev/fix-report.mjs, meaningless outside a source checkout: only in the dev server
  { id: 'feedback.fixReport', title: 'Fix log: copy report command', ...G, hidden: !import.meta.env?.DEV, run: async (app) => {
    const d = await dataDir(app);
    if (!d) return app.toast('The fix log is written to a file only in the desktop app', 'quiet');
    await copy(app, `node dev/fix-report.mjs "${d}"`, 'fix report command');
  } },
  // the notes' dots lived on the Chapters row, which is gone (paw-1w0x); the notes are in feedback.jsonl (Copy feedback log path)
];
