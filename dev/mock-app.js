// dev/mock-app.js -- the `app` object for harness pages, in a plain browser (no Tauri).
// It IS the real shell store (src/app/app.svelte.js: document, undo/redo, commands + keymap, player, view,
// settings) with an in-memory backend, so what works here works in the app.
//
//   import { createMockApp, sampleDoc } from '../dev/mock-app.js';
//   const app = createMockApp({ commands: myCommands, video: videoElementOrNull });
//   // app.doc has sampleDoc() loaded; keys are live (window keydown) unless keys: false
//
// Options: { doc = sampleDoc(), commands = [] (your feature's), core = true (shell's own commands: transport,
//   undo/redo, point keys...), video = null (an HTMLVideoElement to drive app.player; else a timer clock),
//   keys = true, storage = null (settings in memory; pass localStorage to persist) }
// Toasts go to the console; app.confirm uses window.confirm. window.app is set for poking from devtools.

import { createApp } from '../src/app/app.svelte.js';
import { coreFor } from '../src/app/core-commands.js';
import { cowCommands } from './mock-cow.js';

/** Deterministic PRNG so sample docs are identical across reloads. */
function rng(seed = 1) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }

/**
 * A believable document: `minutes` long, stroke axis with a few thousand actions (varied tempo, holds, a fast
 * section, a gap), a roll axis, chapters, bookmarks, a loop, a plan segment, and two ghosts (a "tracker run"
 * and a pinned reference). Scripts obey src/lib/core/script.js (int ms, int pos, strictly increasing).
 */
export function sampleDoc({ minutes = 10, seed = 7, fps = 30 } = {}) {
  const r = rng(seed), dur = minutes * 60000, stroke = [], roll = [];
  const sections = [
    { t0: 0, t1: 0.12, period: 900, amp: [30, 70] },     // slow intro
    { t0: 0.12, t1: 0.35, period: 520, amp: [10, 90] },
    { t0: 0.35, t1: 0.42, period: 0 },                   // gap (nothing scripted)
    { t0: 0.42, t1: 0.7, period: 380, amp: [5, 95] },
    { t0: 0.7, t1: 0.82, period: 240, amp: [20, 80] },   // fast
    { t0: 0.82, t1: 1, period: 640, amp: [0, 100] },
  ];
  for (const s of sections) {
    if (!s.period) continue;
    let t = Math.round(s.t0 * dur) + 200, up = false;
    while (t < s.t1 * dur - 200) {
      const [lo, hi] = s.amp, j = (r() - 0.5) * 12;
      stroke.push({ at: t, pos: Math.max(0, Math.min(100, Math.round((up ? hi : lo) + j))) });
      t += Math.round((s.period / 2) * (0.85 + r() * 0.3));
      up = !up;
    }
  }
  for (let t = 1000; t < dur - 1000; t += 1500 + Math.round(r() * 1500)) roll.push({ at: t, pos: Math.round(50 + (r() - 0.5) * 60) });
  const ghost = stroke.filter((_, i) => i % 3 !== 1).map((a) => ({ at: a.at + 40, pos: Math.max(0, Math.min(100, a.pos + Math.round((r() - 0.5) * 20))) }));
  const fix = (s) => s.filter((a, i) => !i || a.at > s[i - 1].at);
  const C = ['#4DA6FF', '#A78BFA', '#1FE59A', '#FFC21F', '#FF5CB3'];
  return {
    axes: { stroke: fix(stroke), roll: fix(roll) },
    activeAxis: 'stroke',
    chapters: [
      { id: 'ch1', t0: 0, t1: Math.round(dur * 0.35), name: 'Intro', color: C[0] },
      { id: 'ch2', t0: Math.round(dur * 0.42), t1: Math.round(dur * 0.82), name: 'Main', color: C[1] },
      { id: 'ch3', t0: Math.round(dur * 0.82), t1: dur, name: 'Finale', color: C[4] },
    ],
    bookmarks: [{ id: 'bm1', at: Math.round(dur * 0.2), note: 'check sync here' }, { id: 'bm2', at: Math.round(dur * 0.71), note: 'tempo change' }],
    loops: [{ id: 'lp1', t0: Math.round(dur * 0.5), t1: Math.round(dur * 0.5) + 2400 }],
    plan: [{ id: 'pl1', t0: Math.round(dur * 0.35), t1: Math.round(dur * 0.42), kind: 'pattern', recipe: 'sine', params: { periodMs: 600, lo: 20, hi: 80 } }],
    ghosts: [
      { id: 'run1', name: 'Run 1: flow (sample)', color: '#1FE59A', script: fix(ghost), visible: true, source: { kind: 'tracker', tracker: 'flow' } },
      { id: 'ref', name: 'Reference sample.funscript', color: '#E8D8A0', script: fix(stroke), visible: false, pinned: true, source: { kind: 'reference', path: 'sample.funscript' } },
    ],
    media: { path: 'C:/videos/sample.mp4', name: 'sample.mp4', durationMs: dur, fps, isVfr: false, width: 1280, height: 720 },
  };
}

/** In-memory stand-in for app.backend (the real one wraps Tauri; see src/app/backend.js). cow: with the copy-on-write runs
 *  commands of the paw-ee14 shell (src-tauri/src/cow.rs semantics: append at the known length, stages swapped in whole). */
export function mockBackend({ cow = false } = {}) {
  const files = new Map(), mtimes = new Map(), written = new Map(), autosaves = new Map();
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(16).padStart(8, '0'); };
  const be = mockBase(files, mtimes, written, autosaves, hash);
  return cow ? Object.assign(be, cowCommands(files, mtimes)) : be;
}

function mockBase(files, mtimes, written, autosaves, hash) {
  let recent = [];
  return {
    files,
    isTauri: false,
    async exists(p) { return files.has(p); },
    async readText(p) { if (!files.has(p)) { const e = new Error('not found: ' + p); e.code = 'not_found'; throw e; } return files.get(p); },
    async writeText(p, s) { files.set(p, s); mtimes.set(p, Date.now()); },
    async readBytes(p) { const b = files.get(p); if (!(b instanceof Uint8Array)) { const e = new Error('not found: ' + p); e.code = 'not_found'; throw e; } return b.slice(); },
    async writeBytes(p, bytes) { files.set(p, bytes.slice()); mtimes.set(p, Date.now()); },
    async remove(p) { files.delete(p); mtimes.delete(p); },
    async makeDir() {},   // folders are implicit in the in-memory file map
    async copy(a, b) { files.set(b, files.get(a)); },
    async stat(p) { const s = files.get(p); return { exists: files.has(p), is_file: files.has(p), is_dir: false, size: s?.length ?? 0, mtime_ms: mtimes.get(p) ?? null, readonly: false }; },
    async readFile(p) { const text = await this.readText(p); return { text, sha256: hash(text), size: text.length, mtime_ms: mtimes.get(p) }; },
    async listDir(dir, { stem, ext } = {}) {
      const d = dir.replace(/[\\/]+$/, '').replace(/\\/g, '/') + '/';
      return [...files.keys()].map((p) => [p, p.replace(/\\/g, '/')]).filter(([, q]) => q.startsWith(d) && !q.slice(d.length).includes('/'))
        .map(([path, q]) => ({ name: q.slice(d.length), path, is_dir: false, size: files.get(path).length, mtime_ms: mtimes.get(path) }))
        .filter((e) => (!stem || e.name.toLowerCase().startsWith(stem.toLowerCase())) && (!ext || e.name.toLowerCase().endsWith(ext.toLowerCase())))
        .sort((a, b) => (a.name < b.name ? -1 : 1));
    },
    /** API.md write_with_backup: a file we did not write is copied to name.bak (name.N.bak) first. */
    async writeWithBackup(p, text, { expectedSha256 } = {}) {
      const had = files.has(p), old = files.get(p);
      if (expectedSha256 && had && hash(old) !== expectedSha256) { const e = new Error('changed on disk: ' + p); e.code = 'conflict'; throw e; }
      let first = null;
      if (had && written.get(p) !== hash(old) && old !== text) {
        first = p + '.bak';
        for (let n = 2; files.has(first) && files.get(first) !== old; n++) first = p + '.' + n + '.bak';
        files.set(first, old);
      }
      const unchanged = had && old === text;
      files.set(p, text); mtimes.set(p, Date.now()); written.set(p, hash(text));
      return { path: p, sha256: hash(text), size: text.length, mtime_ms: mtimes.get(p), first_backup: first, rolling_backup: null, unchanged };
    },
    /** API.md file_fingerprint / relink_search (q1 fingerprints; here a hash of the whole content). */
    async fileFingerprint(p) { if (!files.has(p)) { const e = new Error('not found: ' + p); e.code = 'not_found'; throw e; } const s = files.get(p); return { size: s.length, fingerprint: `q1-${s.length}-${hash(s)}` }; },
    async relinkSearch(dir, fingerprint) {
      const d = dir.replace(/[\\/]+$/, '').replace(/\\/g, '/') + '/';
      return [...files.keys()].filter((p) => p.replace(/\\/g, '/').startsWith(d) && `q1-${files.get(p).length}-${hash(files.get(p))}` === fingerprint);
    },
    async reveal() {},
    async openDialog() { return null; },
    async saveDialog({ defaultPath } = {}) { return defaultPath || null; },
    mediaUrl: (p) => p,
    async mediaProbe(path) { const e = new Error('no ffprobe in the mock: ' + path); e.code = 'ffmpeg_missing'; throw e; },
    async sidecar(request) { return { result: null, error: 'no sidecar in the mock (' + request.cmd + ')', cancelled: false }; },
    async cancelSidecar() {},
    async score(args) { return this.sidecar({ cmd: 'score', ...args }); },
    async autosaveWrite({ projectPath = null, session, title = '', content }) {
      const id = projectPath ? 'p-' + hash(projectPath).slice(0, 8) : 'u-' + session, saved_ms = Date.now();
      const c = autosaves.get(id) || { id, project_path: projectPath, session, title, snapshots: [] };
      c.title = title; c.updated_ms = saved_ms;
      c.snapshots = [{ id: String(saved_ms), path: `mock-autosave/${id}/${saved_ms}.pawproj`, saved_ms, size: content.length }, ...c.snapshots].slice(0, 10);
      files.set(c.snapshots[0].path, content); autosaves.set(id, c);
      return c.snapshots[0];
    },
    async autosaveList() { return [...autosaves.values()].map((c) => ({ ...c, project_mtime_ms: c.project_path ? mtimes.get(c.project_path) ?? null : null, unsaved_work: !c.project_path || !(mtimes.get(c.project_path) >= c.updated_ms) })).sort((a, b) => b.updated_ms - a.updated_ms); },
    async autosaveClear(id) { autosaves.delete(id); },
    async recentList() { return recent.map((r) => ({ ...r, exists: files.has(r.path) })); },
    async recentAdd(path) { recent = [{ path, name: path.split(/[\\/]/).pop(), kind: /\.pawproj$/i.test(path) ? 'project' : /\.funscript$/i.test(path) ? 'script' : 'media', opened_ms: Date.now() }, ...recent.filter((r) => r.path !== path)].slice(0, 30); return this.recentList(); },
    async recentRemove(path) { recent = path ? recent.filter((r) => r.path !== path) : []; return this.recentList(); },
    setTitle(t) { if (typeof document !== 'undefined') document.title = t; },
    async closeGuard() {},
    async windowCloseNow() {},
    async onCloseRequested() { return () => {}; },
    async onOpenPaths() { return () => {}; },
    async launchPaths() { return []; },
  };
}

export function createMockApp({ doc = sampleDoc(), commands = [], core = true, video = null, keys = true, storage = null, backend = mockBackend() } = {}) {
  // the shell's core commands, minus the ones a features/lanes list passed in implements itself
  const lanes = [commands].flat(Infinity).some((c) => c?.id?.startsWith('lanes.'));
  const app = createApp({ backend, storage, commands: core ? [commands, coreFor(lanes ? ['lanes'] : [])] : commands });
  app.load(doc);
  if (video) app.player.attach(video);
  if (keys && typeof window !== 'undefined') {
    window.addEventListener('pointerdown', (e) => app.commands.notePointer(e), true);
    window.addEventListener('keydown', (e) => app.commands.handleKey(e));
    window.addEventListener('keyup', (e) => app.commands.handleKeyUp(e));
  }
  if (typeof window !== 'undefined') window.app = app;
  return app;
}
