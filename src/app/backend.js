// backend.js -- app.backend for the real app: the native commands of src-tauri/API.md (wrapped in
// src-tauri/js/backend.js), the dialog plugin, the asset protocol and the sidecar. Every Tauri call in the
// front end goes through here; dev/mock-app.js mockBackend() implements the same surface in memory.
//
// Shell-level names (stable for features): exists, stat, readText (-> string), readFile (-> {text, sha256,
// size, mtime_ms}), writeText (atomic), writeWithBackup, readBytes (-> Uint8Array), writeBytes (atomic), listDir, remove, copy, reveal, openDialog,
// saveDialog, mediaUrl, mediaProbe, sidecar, cancelSidecar, score, autosave*, recent*, setTitle,
// closeGuard, windowCloseNow, onCloseRequested, onOpenPaths, launchPaths. Every other native wrapper
// (waveformPeaks, thumbnailStrip, extractFrame, transcodePreview, remuxMp4, scrubCache, mediaCacheLimit, fileFingerprint, ...) is passed through
// under its src-tauri/js/backend.js name.

import { convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWindow, PhysicalPosition } from '@tauri-apps/api/window';
import { open, save } from '@tauri-apps/plugin-dialog';
import * as native from '../../src-tauri/js/backend.js';
import { runSidecar, cancelSidecar } from '../lib/sidecar.js';
import { scoreRequest } from '../lib/protocol.js';
import { cowShell, writeInParts } from '../lib/runs-cow.js';

/** Errors from native commands are {code, message}; make them real Errors so toasts and logs read well. */
const err = (e) => { if (e instanceof Error) return e; const x = new Error(e?.message || String(e)); x.code = e?.code; return x; };
const wrap = (f) => async (...a) => { try { return await f(...a); } catch (e) { throw err(e); } };

export function tauriBackend() {
  const sidecar = (request, handlers) => runSidecar(request, handlers);
  return {
    ...native,
    isTauri: true,
    exists: wrap(async (p) => (await native.fileStat(p)).exists),
    stat: wrap((p) => native.fileStat(p)),
    readText: wrap(async (p) => (await native.readText(p)).text),
    readFile: wrap((p) => native.readText(p)),
    writeText: wrap((p, s) => native.writeTextAtomic(p, s)),
    writeWithBackup: wrap((p, s, o) => native.writeWithBackup(p, s, o)),
    readBytes: wrap(async (p) => new Uint8Array(await native.readBytes(p))),
    // paw-ee14: in parts of 8 MB through a stage when the shell has it (the webview copies each IPC body on its main thread)
    writeBytes: wrap((p, bytes) => (cowShell(native) ? writeInParts(native, p, bytes) : native.writeBytesAtomic(p, bytes))),
    listDir: wrap((dir, o) => native.listDir(dir, o)),
    remove: wrap((p) => native.removeFile(p)),
    copy: wrap(async (a, b) => native.writeTextAtomic(b, (await native.readText(a)).text)),
    reveal: wrap((p) => native.revealPath(p)),
    /** opts: {title, filters:[{name, extensions}], multiple, directory, defaultPath} -> path | path[] | null */
    openDialog: (opts = {}) => open({ multiple: false, ...opts }),
    saveDialog: (opts = {}) => save(opts),
    mediaUrl: (p) => convertFileSrc(p),
    mediaProbe: wrap((p) => native.mediaProbe(p)),
    sidecar,
    cancelSidecar: (owner) => cancelSidecar(owner),   // paw-shgb: an owner (a tab's tracking store) cancels only its own runs
    /** Sidecar `score`: same args as protocol.js scoreRequest -> {result:{overall, scenes}, error, cancelled}. */
    score: (args) => sidecar(scoreRequest(args)),
    autosaveWrite: wrap((o) => native.autosaveWrite(o)),
    autosaveList: wrap(() => native.autosaveList()),
    autosaveClear: wrap((id) => native.autosaveClear(id)),
    recentList: wrap(() => native.recentList()),
    recentAdd: wrap((p) => native.recentAdd(p)),
    recentRemove: wrap((p) => native.recentRemove(p)),
    setTitle: (t) => { try { return getCurrentWindow().setTitle(t).catch(() => {}); } catch { /* not in Tauri */ } },
    // paw-iwb7: the OS pointer to client point (x, y), css px. The window's client area takes physical px: devicePixelRatio is the
    // DPI scale times the webview zoom, so this holds at 100 %, 150 % and zoomed (the window's own position does not enter: tao
    // converts from the client area). Needs core:window:allow-set-cursor-position; refused or not in Tauri: nothing moves.
    setCursorPosition: (x, y) => { try { const d = window.devicePixelRatio || 1; return getCurrentWindow().setCursorPosition(new PhysicalPosition(Math.round(x * d), Math.round(y * d))).catch(() => {}); } catch { /* not in Tauri */ } },
  };
}
