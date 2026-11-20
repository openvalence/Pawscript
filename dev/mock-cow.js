// dev/mock-cow.js -- paw-ee14: the copy-on-write runs commands of the shell (src-tauri/src/cow.rs semantics: append at the
// known length and tail, stages swapped in whole, copies hashed) over an in-memory file map. dev/mock-app.js mockBackend({cow})
// and test/runs-cow.test.mjs use it.

/** The paw-ee14 shell commands over the mock's file map. stages: path|stage -> bytes. */
export function cowCommands(files, mtimes = new Map()) {
  const stages = new Map(), fail = (code, m) => { const e = new Error(m); e.code = code; throw e; };
  const cat = (a, b) => { const n = new Uint8Array(a.length + b.length); n.set(a); n.set(b, a.length); return n; };
  const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
  const stage = (p, s, begin = true) => {
    const k = p + '|' + s;
    if (!stages.has(k)) { if (!begin) fail('not_found', 'no such write in progress'); for (const x of [...stages.keys()]) if (x.startsWith(p + '|')) stages.delete(x); stages.set(k, new Uint8Array(0)); }
    return k;
  };
  const backups = [];   // [path, bytes]: what a commit with backup copied to the rolling backups first
  return {
    stages,
    backups,
    async runsAppend(p, at, bytes, { tail, sync } = {}) {   // eslint-disable-line no-unused-vars
      const f = files.get(p);
      if (!(f instanceof Uint8Array)) fail('not_found', 'not found: ' + p);
      if (f.length !== at) fail('moved', `${p}: ${f.length} bytes on disk, ${at} expected`);
      if (tail && hex(f.subarray(f.length - tail.length / 2)) !== tail) fail('moved', `${p}: its last version is not the one this app wrote`);
      files.set(p, cat(f, bytes)); mtimes.set(p, Date.now());
      return { size: f.length + bytes.length, mtime_ms: mtimes.get(p) };
    },
    async runsStageWrite(p, s, bytes) { const k = stage(p, s); stages.set(k, cat(stages.get(k), bytes)); return stages.get(k).length; },
    async runsStageCopy(p, s, src, ranges) {
      const k = stage(p, s), f = files.get(src);
      if (!(f instanceof Uint8Array) || ranges.some(([o, l]) => o + l > f.length)) { stages.delete(k); fail(f ? 'invalid_input' : 'not_found', 'range past the end of ' + src); }
      const sha256 = [];
      for (const [o, l] of ranges) { const b = f.subarray(o, o + l); stages.set(k, cat(stages.get(k), b)); sha256.push(hex(new Uint8Array(await crypto.subtle.digest('SHA-256', b)))); }
      return { size: stages.get(k).length, sha256 };
    },
    async runsStageCommit(p, s, { backup = false } = {}) { const k = stage(p, s, false); if (backup && files.has(p)) backups.push([p, files.get(p)]); files.set(p, stages.get(k)); stages.delete(k); mtimes.set(p, Date.now()); return { size: files.get(p).length, mtime_ms: mtimes.get(p) }; },
    async runsStageDrop(p, s) { stages.delete(p + '|' + s); },
  };
}
