// bug-report.js -- paw-frhy: Help › Copy bug report (also on the crash screen) and the build line Help › About shows. The
// report is plain text for a stranger to paste into a message: version and build, Windows, GPU, the tracker runtime, the
// last console errors and the last sidecar error. Nothing from the user's files or usage: every line that is not ours goes
// through scrub(), which drops paths, URLs, file names, quoted text and the open document's names and tags.

import { APP_VERSION, APP_BUILD } from '../lib/provenance.js';
import { CONTACT as ISSUES } from './release.js';

/** Where a report goes (the address lives in release.js); shown in About and at the top of every report. Issues there
 *  are public, which is why the report carries no file names. */
export const CONTACT = `Paste this into a new issue at ${ISSUES.replace(/^https?:\/\//, '')}`;

export const buildLine = (b = APP_BUILD, v = APP_VERSION) => `Pawscript ${v}, build ${b.commit}${b.date ? ` (${b.date})` : ''}`;

// ---- the last console errors (kept from the start, scrubbed when the report is made) ----
const KEEP = 30;
const errors = [];
const asText = (x) => {
  if (x instanceof Error) return `${x.name}: ${x.message}`;   // never the stack: it names files
  if (x && typeof x === 'object') { try { return JSON.stringify(x).slice(0, 300); } catch { return String(x); } }
  return String(x);
};
/** Keeps the last KEEP console.error lines (with their time) for the report. Once, from the first import in a page. */
export function keepConsoleErrors(con = console) {
  if (con.__pawKept) return;
  const orig = con.error;
  con.error = function (...a) {
    try { errors.push(`${new Date().toTimeString().slice(0, 8)} ${a.map(asText).join(' ')}`.slice(0, 600)); if (errors.length > KEEP) errors.shift(); } catch { /* never stop an error */ }
    return orig.apply(this, a);
  };
  con.__pawKept = true;
}
export const keptErrors = () => [...errors];
if (typeof window !== 'undefined') keepConsoleErrors();

// ---- scrubbing ----
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const FILE_EXT = 'mp4|m4v|mkv|mov|webm|avi|wmv|flv|mpe?g|ts|m2ts|gif|png|jpe?g|webp|bmp|funscript|pawproj|pawruns|pawpack|pawhistory|pawgraph|json|jsonl|csv|txt|mp3|m4a|wav|flac|ogg|aac|srt|vtt';
/** `text` with nothing that could name the user's files or media: URLs, paths, file names, quoted text, and every one of
 *  `names` (the open document's name, its video's, its tags) replaced by placeholders. */
export function scrub(text, names = []) {
  let s = String(text ?? '');
  for (const n of [...new Set(names.map((x) => String(x || '').trim()).filter((x) => x.length >= 3))].sort((a, b) => b.length - a.length)) s = s.replace(new RegExp(esc(n), 'gi'), '<name>');
  return s
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, '<url>')
    .replace(/(?<!\w)(["'`“‘«])(?:(?!\1)[^\n]){1,200}?["'`”’»](?!\w)/g, '"…"')
    .replace(/\S*[\\/]\S*/g, '<path>')
    .replace(new RegExp(`[^\\s<>"]+\\.(?:${FILE_EXT})\\b`, 'gi'), '<file>');
}

/** The names a report must never carry: every open document's file names (with and without extension) and tags, the
 *  parked tabs' names too (not only the shown tab's). */
export function privateNames(app) {
  const out = [];
  const add = (p) => { if (!p) return; const f = String(p).split(/[\\/]/).pop(); out.push(f, f.replace(/\.[^.]+$/, '')); };
  for (const a of app?.tabs?.apps?.length ? app.tabs.apps : [app]) {
    const d = a?.doc || {};
    [d.project?.path, d.project?.base, d.media?.path, d.media?.name, a?.project?.name, a?.project?.path].forEach(add);
    for (const s of d.scenes || []) for (const t of [s?.describe?.tags, s?.tags].flat()) if (typeof t === 'string') out.push(t); else if (t?.name || t?.tag) out.push(t.name || t.tag);
  }
  for (const p of Object.values(app?.tabs?.parked || {})) { add(p?.key); add(p?.name); }
  return [...new Set(out)];
}

// ---- the machine ----
/** The GPU as the webview names it (no VRAM / driver): the fallback without the shell's system_info. */
export function webglGpu() {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return name ? String(name) : '';
  } catch { return ''; }
}
async function windowsOf(nav = globalThis.navigator) {
  try {
    const v = (await nav?.userAgentData?.getHighEntropyValues?.(['platformVersion']))?.platformVersion;
    if (v) return `Windows ${parseInt(v, 10) >= 13 ? '11' : '10'} (platform ${v})`;
  } catch { /* not Chromium */ }
  return /Windows NT [\d.]+/.exec(nav?.userAgent || '')?.[0] || 'unknown';
}
/** {windows, gpus, runtime}: the shell's system_info (patch ea-robustness-shell), else what the webview can tell. */
export async function machine(app) {
  let info = null;
  try { info = await app?.backend?.systemInfo?.(); } catch { /* an older shell */ }
  return {
    windows: info?.windows || (await windowsOf()),
    gpus: info?.gpus?.length ? info.gpus : [webglGpu() ? webglGpu() + ' (VRAM and driver unknown)' : 'unknown'],
    runtime: info?.runtime?.length ? info.runtime.join(', ') : info ? 'none (a dev build)' : 'unknown',
  };
}

/** The report text. m: machine(); errs: console lines; sidecar: {at, cmd, message} | null; names: privateNames(). */
export function reportText({ m, errs = [], sidecar = null, names = [], contact = CONTACT, build = buildLine() }) {
  const S = (x) => scrub(x, names);
  const side = sidecar ? `${new Date(sidecar.at).toTimeString().slice(0, 8)} ${S(sidecar.cmd || '')}: ${S(sidecar.message).split('\n').slice(0, 6).join(' | ')}` : 'none';
  return [
    'Pawscript bug report. It contains no file names, paths, project names or tags.',
    contact,
    '',
    `Version: ${build}`,
    `Windows: ${S(m.windows)}`,
    ...m.gpus.map((g) => `GPU: ${S(g)}`),
    `Tracker runtime: ${S(m.runtime)}`,
    `Last sidecar error: ${side}`,
    `Last ${errs.length} console errors:`,
    ...(errs.length ? errs.map(S) : ['none']),
  ].join('\n');
}

/** Help › Copy bug report: builds the report and puts it on the clipboard (or shows it when the clipboard refuses). */
export async function copyBugReport(app) {
  const { lastSidecarError } = await import('../lib/sidecar.js').catch(() => ({}));
  const text = reportText({ m: await machine(app), errs: keptErrors(), sidecar: lastSidecarError?.() || null, names: privateNames(app) });
  try { await navigator.clipboard.writeText(text); app.toast(`Bug report copied (no file names in it). ${CONTACT} (issues there are public).`, 'ok', { timeout: 8000 }); }
  catch { await app.choose?.({ title: 'Bug report', message: 'Copy this text (select it, Ctrl+C):', detail: text, choices: [{ id: 'ok', label: 'Close', kind: 'primary' }] }); }
  return text;
}
