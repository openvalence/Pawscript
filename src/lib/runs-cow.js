// runs-cow.js -- paw-ee14: a project's .pawruns written copy-on-write (version 2, lib/runs-file.js; the shell half is
// src-tauri/src/cow.rs, dev/patches/paw-ee14-cow-shell.patch). Live data is never overwritten: a change appends its new
// blocks (fsync), then a small commit naming every block it uses; that commit is the one switch, so a crash, a forced close
// or a power cut at any moment leaves the last complete version. A flip, a rename or a discard writes one run record
// (~0.35 MB) or nothing but the commit (a few KB); a new run writes its blocks once. When dead bytes pile up (replaced
// records, discarded runs no history entry keeps) the next write compacts: the live blocks are copied by the shell into a
// new file, checked against their names, and swapped in whole. A version-1 file is migrated the same way on its first
// write (its frame sections copied by byte range, no re-encode; the old file goes to the rolling backups).
// Without the shell commands (cowShell false) the tracking store writes version 1 whole, as before.

import { planBlocks, encodeCommit, headV2 } from './runs-file.js';

export const PART = 1 << 23;   // bytes per IPC body (the webview copies each body on its main thread)
const GARBAGE = 32 << 20;      // dead bytes a file may hold (and more than half its live bytes) before a write compacts it

/** Does this shell write runs copy-on-write? */
export const cowShell = (be) => ['runsAppend', 'runsStageWrite', 'runsStageCopy', 'runsStageCommit', 'runsStageDrop'].every((k) => typeof be?.[k] === 'function');

const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
const same = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);
const entry = (off, b) => (b.deps ? [off, b.len, b.deps] : [off, b.len]);
let seq = 0;
const stageId = () => `cow${Date.now().toString(36)}${(++seq).toString(36)}`;

/**
 * runs -> path, copy-on-write. state: what is known of the file there (runsFileState of its decode, or what the last write
 * returned) | null (unknown: written whole). keep: record hashes history entries refer to; the file keeps them and their
 * sections while it holds them. compact: written whole now (Clean project). onProgress(done, total): bytes.
 * -> the new state ({v: 2, size, tail, blocks, runs, written, whole}) | null (nothing changed). Throws when the file could
 * not be written: it then holds its last complete version, and the state given stays right to try again with.
 */
export async function writeRunsCow(be, path, runs, state, { keep = [], compact = false, onProgress = null, budget = 8 } = {}) {
  if (state?.badBlocks) compact = true;   // paw-acfc: a damaged file is written anew (the damaged one kept as a backup)
  const plan = await planBlocks(runs, { budget }), live = plan.map((p) => p.rec.hash);
  const old = state?.v === 2 ? state.blocks : new Map();
  const at = (h, b) => (old.has(h) ? old.get(h)[0] : b?.of && b.of === state?.buf && b.at >= 0 ? b.at : -1);   // where the file read holds it
  // every block the commit names: the runs' own, then those of the history's records the file holds
  const need = new Map();
  for (const p of plan) {
    for (const s of p.secs) if (!need.has(s.hash)) need.set(s.hash, { len: s.bytes.length, bytes: s.bytes, src: at(s.hash, s) });
    if (!need.has(p.rec.hash)) need.set(p.rec.hash, { len: p.rec.bytes.length, bytes: p.rec.bytes, deps: p.secs.map((s) => s.hash), src: at(p.rec.hash) });
  }
  for (const h of keep) {
    const b = old.get(h), deps = Array.isArray(b?.[2]) ? b[2] : [];
    if (!b || need.has(h) || !deps.every((d) => old.has(d))) continue;
    need.set(h, { len: b[1], deps, src: b[0] });
    for (const d of deps) if (!need.has(d)) need.set(d, { len: old.get(d)[1], src: old.get(d)[0] });
  }
  if (state?.v === 2 && !compact && same(state.runs, live) && [...need.keys()].every((h) => old.has(h))) return null;
  let liveBytes = 0;
  for (const b of need.values()) liveBytes += b.len;
  if (state?.v === 2 && !compact && state.size - liveBytes < Math.max(GARBAGE, liveBytes / 2)) {
    try { return await appendTo(be, path, state, need, live, onProgress); }
    catch (e) { if (e?.code !== 'moved' && e?.code !== 'not_found') throw e; }   // not as this app left it (a write cut short, gone, another program): whole
  }
  return rewrite(be, path, state, need, live, onProgress);
}

/** paw-acfc: the state of a file some of whose blocks do not match their hash (verifyRuns(...).bad): those blocks, and every
 *  record needing one, out; everything else kept, so the next write still keeps the records the history refers to. Marked
 *  badBlocks: that write rewrites the file whole and the damaged file goes to the rolling backups first. */
export function withoutBad(state, bad) {
  if (state?.v !== 2 || !bad?.size) return state;
  const blocks = new Map([...state.blocks].filter(([h, b]) => !bad.has(h) && !(Array.isArray(b[2]) && b[2].some((d) => bad.has(d)))));
  return { ...state, blocks, badBlocks: true };
}

/** The new blocks appended (fsync after the last), then the commit (fsync). */
async function appendTo(be, path, state, need, live, onProgress) {
  const table = new Map(), fresh = [];
  for (const [h, b] of need) if (state.blocks.has(h)) table.set(h, state.blocks.get(h)); else fresh.push([h, b]);
  const total = fresh.reduce((s, [, b]) => s + b.len, 0);
  let pos = state.size, done = 0, tail = hex(state.tail), res = null;
  for (let i = 0; i < fresh.length; i++) {
    const [h, b] = fresh[i], off = pos;
    for (let o = 0; o < b.len; o += PART) {
      const part = b.bytes.subarray(o, o + PART), last = i === fresh.length - 1 && o + PART >= b.len;
      res = await be.runsAppend(path, pos, part, { tail, sync: last });   // the blocks on disk before a commit names them
      tail = undefined;
      pos += part.length; done += part.length;
      onProgress?.(done, total);
    }
    table.set(h, entry(off, b));
  }
  const commit = encodeCommit(table, live);
  res = await be.runsAppend(path, pos, commit, { tail, sync: true });
  pos += commit.length;
  return { v: 2, buf: null, size: pos, tail: commit.slice(commit.length - 16), blocks: table, runs: live, mtime: res?.mtime_ms ?? null, written: total + commit.length, whole: false };
}

/** A new file through a stage: what the file there already holds copied by the shell (checked against its name), the
 *  rest sent in parts, the commit last, then swapped in whole. A history record whose sections did not make it is left
 *  out; the runs' own blocks always make it (they are in memory). */
async function rewrite(be, path, state, need, live, onProgress) {
  const stage = stageId(), head = headV2(), order = [...need], table = new Map();
  const total = order.reduce((s, [, b]) => s + b.len, 0) + head.length;
  let done = 0;
  try {
    let pos = await be.runsStageWrite(path, stage, head);
    done += head.length;
    const copy = order.filter(([, b]) => b.src >= 0);
    let got = null;
    if (copy.length) {
      try { got = await be.runsStageCopy(path, stage, path, copy.map(([, b]) => [b.src, b.len])); }
      catch { pos = await be.runsStageWrite(path, stage, head); }   // the old file is gone or shorter: the stage began again
    }
    if (got) {
      let o = pos;
      copy.forEach(([h, b], i) => { if (String(got.sha256[i]).slice(0, 32) === h) table.set(h, entry(o, b)); o += b.len; });
      pos = got.size;
      done += pos - head.length;
      onProgress?.(done, total);
    }
    for (const [h, b] of order) {
      if (table.has(h) || !b.bytes) continue;
      const off = pos;
      for (let o = 0; o < b.len; o += PART) {
        const part = b.bytes.subarray(o, o + PART);
        pos = await be.runsStageWrite(path, stage, part);
        done += part.length;
        onProgress?.(done, total);
      }
      table.set(h, entry(off, b));
    }
    for (const [h, b] of table) if (b[2] && !b[2].every((d) => table.has(d))) table.delete(h);
    const commit = encodeCommit(table, live);
    pos = await be.runsStageWrite(path, stage, commit);
    const res = await be.runsStageCommit(path, stage, { backup: state?.v === 1 || !!state?.badBlocks });
    return { v: 2, buf: null, size: res?.size ?? pos, tail: commit.slice(commit.length - 16), blocks: table, runs: live, mtime: res?.mtime_ms ?? null, written: pos, whole: true };
  } catch (e) {
    await Promise.resolve(be.runsStageDrop(path, stage)).catch(() => {});
    throw e;
  }
}

/** path -> its bytes over the asset protocol (be.mediaUrl) in byte ranges, `par` at a time (paw-o60v.5: one IPC body of a
 *  100 MB runs file is copied on the webview's main thread in one task, 120-150 ms; the asset protocol answers a range
 *  with at most ~1 MB, each its own small task, 4 at a time as fast as the IPC read). Anything unexpected (no asset URL, a
 *  status other than 206, a short or inconsistent part, a missing file) reads with be.readBytes as before. The writers
 *  wait for the read (tracking runsLoad), so the file does not change under it. */
export async function readInParts(be, path, { par = 4 } = {}) {
  const u = be.mediaUrl?.(path);
  if (!u || !/^(https?|asset):/.test(u) || typeof fetch !== 'function') return be.readBytes(path);
  try {
    const part = async (o, len) => {
      const r = await fetch(u, { cache: 'no-store', headers: { Range: `bytes=${o}-${o + len - 1}` } });
      const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(r.headers.get('content-range') || '');
      if (r.status !== 206 || !m || +m[1] !== o) throw new Error('not a range');
      return { b: new Uint8Array(await r.arrayBuffer()), total: +m[3] };
    };
    const first = await part(0, PART), n = first.total, out = new Uint8Array(n), step = first.b.length;
    if (!step || (step < n && step > PART)) throw new Error('odd part');
    out.set(first.b);
    let next = step;
    const run = async () => {
      while (next < n) {
        const o = next, len = Math.min(step, n - o);
        next += len;
        const { b, total } = await part(o, len);
        if (b.length !== len || total !== n) throw new Error('short part');
        out.set(b, o);
      }
    };
    await Promise.all(Array.from({ length: par }, run));
    return out;
  } catch { return be.readBytes(path); }
}

/** bytes -> path through a stage in parts of PART (no IPC body over 8 MB), swapped in whole. -> {size, mtime_ms} */
export async function writeInParts(be, path, bytes) {
  const stage = stageId();
  try {
    for (let o = 0; o < bytes.length || o === 0; o += PART) { await be.runsStageWrite(path, stage, bytes.subarray(o, o + PART)); if (!bytes.length) break; }
    return await be.runsStageCommit(path, stage);
  } catch (e) {
    await Promise.resolve(be.runsStageDrop(path, stage)).catch(() => {});
    throw e;
  }
}
