// setup-screen.js -- the shared build's one-time setup screen (paw-i7s). While the shell unpacks runtime.zip /
// code.zip beside the exe (src-tauri/src/portable.rs, command portable_status), or refuses to (a network drive, a
// folder it cannot write), the window shows this instead of the app; when the setup is done the page reloads into the
// app, so nothing in it ever saw a half-installed folder. A dev build has no zips (always 'ready'); a shell without
// the command (older build, harness) counts as ready too.
import { invoke } from '@tauri-apps/api/core';

const SAY = {
  checking: 'Setting up, one time: checking the files…',
  runtime: 'Setting up, one time: unpacking the runtime (Python, PyTorch, ffmpeg), about a minute.',
  'runtime-rocm': 'Setting up, one time: unpacking the AMD runtime (Python, PyTorch ROCm, ffmpeg), about a minute.',
  code: 'Setting up, one time: unpacking the tracker code…',
};

/** The words for a status ({state, what?, message?}). Pure. */
export function setupText(s) {
  if (s.state === 'unpacking') return SAY[s.what] || SAY.checking;
  return s.message || 'Setting up failed.';
}

/** true when the app may start now; false when this screen owns the window (it reloads the page once set up).
 *  paw-mn92: a later start's check of the files (a fraction of a second) shows nothing: the screen comes up only when
 *  checking takes longer than `grace` ms, or at once for an unpack, a refusal or a failure. */
export async function setupDone(status = () => invoke('portable_status'), target = document.getElementById('app'), grace = 1000) {
  let s;
  try { s = await status(); } catch { return true; }
  for (const t0 = Date.now(); s?.state === 'unpacking' && s.what === 'checking' && Date.now() - t0 < grace;) {
    await new Promise((r) => setTimeout(r, 50));
    try { s = await status(); } catch { return true; }
  }
  if (!s || s.state === 'ready') return true;
  const box = document.createElement('div');
  box.style.cssText = 'height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;'
    + 'padding:24px;text-align:center;font:15px var(--font);color:inherit;background:var(--bg)';
  const msg = document.createElement('p');
  const note = document.createElement('p');
  note.style.cssText = 'opacity:.6;font-size:13px;max-width:560px;margin:0';
  msg.style.cssText = 'max-width:560px;margin:0';
  const mark = document.createElement('img');   // the app icon (src/assets/brand, paw-mpor)
  mark.src = new URL('../assets/brand/pawscript-app.svg', import.meta.url).href;
  mark.alt = '';
  mark.width = mark.height = 64;
  box.append(mark, msg, note);
  target.replaceChildren(box);
  for (;;) {
    msg.textContent = setupText(s);
    note.textContent = s.state === 'unpacking' ? 'Pawscript opens by itself when it is done. Later starts are immediate.'
      : 'Close Pawscript, then see README.txt in this folder.';
    if (s.state !== 'unpacking') return false;   // refused / failed: the message stays
    await new Promise((r) => setTimeout(r, 400));
    try { s = await status(); } catch { s = { state: 'failed', message: 'Setting up failed: the app shell stopped answering.' }; }
    if (s.state === 'ready') { location.reload(); return false; }
  }
}
