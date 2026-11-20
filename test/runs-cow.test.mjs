// paw-ee14: the copy-on-write .pawruns (version 2, lib/runs-file.js + lib/runs-cow.js) against the shell's semantics
// (dev/mock-app.js cow commands = src-tauri/src/cow.rs): every derived result identical to version 1; a change writes only
// what changed; a version-1 file opens and is migrated by byte range; a write cut at ANY byte (or its tail zeroed, as after
// a power cut) opens to the previous or the new complete version, never a broken one; a bad block degrades one run; the
// history's runs stay in the file until no entry needs them (paw-s49h); session-tracked frames go lazy once written
// (paw-d1sq).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeRuns, decodeRuns, runsFileState, verifyRuns, decodeRecords, lightenFrames, lazyFrames, headV2 } from '../src/lib/runs-file.js';
import { writeRunsCow, writeInParts } from '../src/lib/runs-cow.js';
import { deriveChannels } from '../src/lib/rederive.js';
import { cowCommands } from '../dev/mock-cow.js';
import { synthRuns } from '../dev/perf/synth-runs.mjs';

const P = 'C:/v/p.pawruns';
const fixture = (n = 3, frames = 60) => {
  const runs = synthRuns({ runs: n, frames, points: 64, groups: 3 });
  const ov = runs[n - 1].frames.ov;
  ov[5] = null;
  ov[6] = { boxes: [[0.1, 0.1, 0.2, 0.2]] };
  ov[7] = { ...ov[7], points: [[0.5, 0.5]] };
  return runs;
};
/** A run's whole content as version 1 encodes it (the canonical bytes): equal = the same run. */
const v1 = (runs) => Buffer.from(encodeRuns(runs)).toString('base64');
const plain = (r) => ({ ...r, frames: r.frames && JSON.parse(JSON.stringify(r.frames)) });
const chans = (c) => JSON.stringify(Object.entries(c).map(([k, s]) => [k, Array.from(s.t), Array.from(s.v)]));
const DERIVES = [[{ cam: { mode: 'move', source: 'all', strength: 100, smoothMs: 0 } }], [{ cam: { mode: 'full', source: 'all', strength: 60, smoothMs: 0 }, axis: { mode: 'vertical' } }]];

/** The mock shell, counting what crosses IPC and what is written. */
function shell() {
  const files = new Map(), be = { files, ...cowCommands(files) }, log = { appended: 0, staged: 0, copied: 0, calls: [] };
  for (const k of ['runsAppend', 'runsStageWrite', 'runsStageCopy', 'runsStageCommit']) {
    const f = be[k].bind(be);
    be[k] = async (...a) => {
      log.calls.push(k);
      if (k === 'runsAppend') log.appended += a[2].length;
      if (k === 'runsStageWrite') log.staged += a[2].length;
      if (k === 'runsStageCopy') log.copied += a[3].reduce((s, [, l]) => s + l, 0);
      return f(...a);
    };
  }
  return { be, log };
}
const open = (be) => { const runs = decodeRuns(be.files.get(P)); return { runs, st: runsFileState(runs) }; };

test('version 2 holds exactly what version 1 does: frames, derives, records; an unchanged write writes nothing', async () => {
  const fx = fixture(), { be, log } = shell();
  const st = await writeRunsCow(be, P, fx, null);
  assert.ok(st.whole && st.v === 2);
  assert.equal(log.appended, 0, 'a first write goes through a stage');
  const { runs, st: rs } = open(be), ref = decodeRuns(encodeRuns(fx)).map(plain);
  assert.equal(rs.v, 2);
  assert.equal(v1(runs), v1(decodeRuns(encodeRuns(fx))));
  for (let k = 0; k < runs.length; k++) {
    assert.deepEqual(runs[k].frames, ref[k].frames);
    for (const d of DERIVES) assert.equal(chans(deriveChannels(runs[k], d, { aspect: 16 / 9, force: true }).channels), chans(deriveChannels(ref[k], d, { aspect: 16 / 9, force: true }).channels));
  }
  assert.equal((await verifyRuns(runs)).size, 0);
  // the reopened runs are the file: a write of them changes nothing, nothing is sent
  const calls = log.calls.length;
  assert.equal(await writeRunsCow(be, P, runs.map((r) => ({ ...r })), rs), null);
  assert.equal(log.calls.length, calls);
  // the head refuses an older reader: version 2 (a version-1 app says "version 2 is newer than this app reads (1)")
  const head = JSON.parse(new TextDecoder().decode(headV2().subarray(12)));
  assert.deepEqual(head, { format: 'pawruns', version: 2 });
  assert.equal(new TextDecoder().decode(be.files.get(P).subarray(0, 8)), 'PAWRUNS1');
});

test('a change writes what changed: a flip or a rename one record, a discard only a commit, a new run its blocks once', async () => {
  const fx = fixture(4, 90), { be, log } = shell();
  let st = await writeRunsCow(be, P, fx, null);
  const size0 = be.files.get(P).length, sec = st.blocks.get([...st.blocks.keys()][0])[1];
  const step = async (runs) => { const a = log.appended; st = await writeRunsCow(be, P, runs, st); return log.appended - a; };
  const flip = await step(fx.map((r, i) => (i === 1 ? { ...r, flips: [r.range.start + 300] } : r)));
  assert.ok(flip > 0 && flip < sec, `a flip appends one record + a commit (${flip} bytes, a frame section is ${sec})`);
  const named = fx.map((r, i) => (i === 1 ? { ...r, flips: [r.range.start + 300] } : i === 2 ? { ...r, name: 'Renamed' } : r));
  assert.ok((await step(named)) < sec);
  const gone = named.filter((_, i) => i !== 0), d = await step(gone);
  assert.ok(d < 4096, `a discard appends a commit only (${d} bytes)`);
  const more = [...gone, ...fixture(5, 90).slice(4)], m = await step(more);
  assert.ok(m >= sec, 'a new run appends its frames once');
  assert.equal(log.staged, size0, 'nothing but the first write went through a stage');
  const { runs } = open(be);
  assert.equal(v1(runs), v1(decodeRuns(encodeRuns(more))));
  assert.deepEqual(runs.map((r) => r.name || r.id), more.map((r) => r.name || r.id));
});

test('a version-1 file opens as before and its first copy-on-write write migrates it: sections copied by byte range, the old file to the backups', async () => {
  const fx = fixture(), { be, log } = shell();
  be.files.set(P, encodeRuns(fx));
  const { runs, st } = open(be);
  assert.equal(st.v, 1);
  let backup = null;
  const commit = be.runsStageCommit;
  be.runsStageCommit = (p, s, o) => { backup = o?.backup; return commit(p, s, o); };
  const flipped = runs.map((r, i) => (i ? r : { ...r, flips: [r.range.start + 100] }));
  const st2 = await writeRunsCow(be, P, flipped, st);
  assert.ok(st2.whole && backup === true);
  const secBytes = runs.reduce((s, r) => s + (runsFileState(runs) && r.frames ? 1 : 0), 0);
  assert.ok(secBytes && log.copied > 0, 'the frame sections were copied from the old file, not sent');
  assert.ok(log.staged < log.copied, `sent ${log.staged} bytes, copied ${log.copied}`);
  assert.equal(v1(open(be).runs), v1(decodeRuns(encodeRuns(flipped))));
});

/** A shell that dies after `budget` more bytes reach the disk: the cut bytes land (as zeros when `zero`), then it throws. */
function dying(be, budget, zero = false) {
  const d = Object.create(be), die = () => { const e = new Error('killed'); e.code = 'killed'; throw e; };
  d.runsAppend = async (p, at, bytes, o) => {
    if (budget <= 0) die();
    if (bytes.length > budget) { const cut = zero ? new Uint8Array(budget) : bytes.subarray(0, budget); budget = 0; await be.runsAppend(p, at, cut, o); die(); }
    budget -= bytes.length;
    return be.runsAppend(p, at, bytes, o);
  };
  d.runsStageWrite = async (p, s, bytes) => { if (budget <= 0) die(); budget -= bytes.length; if (budget < 0) { budget = 0; die(); } return be.runsStageWrite(p, s, bytes); };
  d.runsStageCopy = async (...a) => { if (budget <= 0) die(); return be.runsStageCopy(...a); };
  d.runsStageCommit = async (...a) => { if (budget <= 0) die(); budget = 0; return be.runsStageCommit(...a); };
  return d;
}

test('killed at any byte of a write (appends, a compaction, a migration), or with its tail zeroed: the previous or the new version, never broken; the next write recovers', async () => {
  const fx = fixture(3, 40);
  const cases = [
    ['flip', (r) => r.map((x, i) => (i === 1 ? { ...x, flips: [x.range.start + 200] } : x))],
    ['new run', (r) => [...r, ...fixture(4, 40).slice(3)]],
    ['discard', (r) => r.slice(1)],
  ];
  for (const [name, change] of cases) for (const mode of ['append', 'compact', 'migrate']) {
    const { be } = shell();
    if (mode === 'migrate') be.files.set(P, encodeRuns(fx)); else await writeRunsCow(be, P, fx, null);
    const base = be.files.get(P), { runs: before, st } = open(be), next = change(before);
    const old = v1(before), want = v1(decodeRuns(encodeRuns(next)));
    // how many bytes the whole write puts on disk
    const probe = shell(); probe.be.files.set(P, base);
    const full = await writeRunsCow(probe.be, P, next, st, { compact: mode === 'compact' });
    const total = full.written, start = full.whole ? 0 : base.length;
    // every byte offset near each boundary (a block's start and end, the commit's start and end), and 60 between
    const edges = [0, total, ...[...full.blocks.values()].filter((b) => b[0] >= start).flatMap((b) => [b[0] - start, b[0] + b[1] - start])];
    const cuts = new Set([...edges.flatMap((e) => Array.from({ length: 33 }, (_, i) => e - 16 + i)), ...Array.from({ length: 60 }, (_, i) => Math.round((i * total) / 60))].filter((c) => c >= 0 && c <= total));
    for (const zero of full.whole ? [false] : [false, true]) for (const cut of [...cuts].sort((a, b) => a - b)) {
      be.files.set(P, base);
      be.stages.clear();
      let threw = false;
      try { await writeRunsCow(dying(be, cut, zero), P, next, st, { compact: mode === 'compact' }); } catch (e) { threw = true; assert.equal(e.code, 'killed'); }
      const got = v1(decodeRuns(be.files.get(P)));
      assert.ok(got === old || (!threw && got === want) || (threw && got === want), `${name}/${mode}, cut at ${cut}${zero ? ' (zeroed)' : ''}: neither version`);
      if (!threw) assert.equal(got, want);
      // the app keeps its state and writes again: the new version, whole
      const again = await writeRunsCow(be, P, next, st, { compact: mode === 'compact' });
      assert.ok(again === null || again.v === 2);
      assert.equal(v1(decodeRuns(be.files.get(P))), want, `${name}/${mode}: the write after the cut at ${cut}`);
    }
  }
});

test('a torn tail is ignored; a bad block degrades its run only; a missing record leaves that run out, the others open', async () => {
  const fx = fixture(3, 40), { be } = shell();
  let st = await writeRunsCow(be, P, fx, null);
  st = await writeRunsCow(be, P, fx.map((r, i) => (i === 2 ? { ...r, name: 'B' } : r)), st);
  const good = be.files.get(P);
  // torn: garbage and half a trailer after the last commit
  const torn = new Uint8Array(good.length + 30);
  torn.set(good);
  torn.set(new TextEncoder().encode('xxPAWRTAIL\u0005\u0000'), good.length + 10);
  const t = decodeRuns(torn);
  assert.equal(runsFileState(t).torn, true);
  assert.equal(v1(t), v1(decodeRuns(good)));
  // the newest commit's trailer damaged: the version before it
  const cut = good.slice(0, good.length - 3);
  assert.equal(decodeRuns(cut)[2].name, fx[2].name, 'the earlier version (before the rename)');
  // a byte of run 1's frames flipped: verifyRuns names run 1's frames, nothing else
  const { runs, st: rs } = open(be), h = JSON.parse(new TextDecoder().decode(rs.buf.subarray(...((b) => [b[0], b[0] + b[1]])(rs.blocks.get(rs.runs[1]))))).frames.sec;
  const bad = new Uint8Array(good), off = rs.blocks.get(h)[0] + 20;
  bad[off] ^= 0x55;
  const br = decodeRuns(bad), v = await verifyRuns(br);
  assert.deepEqual([...v], [[runs[1].id, 'frames']]);
  // run 0's record unreadable: left out, said in damaged; the others decode
  const bad2 = new Uint8Array(good), r0 = rs.blocks.get(rs.runs[0]);
  bad2.fill(0xff, r0[0], r0[0] + 8);
  const b2 = decodeRuns(bad2);
  assert.deepEqual(b2.map((r) => r.id), [runs[1].id, runs[2].id]);
  assert.equal(runsFileState(b2).damaged.length, 1);
  // run 2's frames unreadable (truncated section): it opens without frames
  const bad3 = new Uint8Array(good), s2 = JSON.parse(new TextDecoder().decode(rs.buf.subarray(rs.blocks.get(rs.runs[2])[0], rs.blocks.get(rs.runs[2])[0] + rs.blocks.get(rs.runs[2])[1]))).frames.sec;
  const sb = rs.blocks.get(s2);
  new DataView(bad3.buffer).setUint16(sb[0] + 8, 0xfff0, true);   // the first frame claims 65520 points
  const b3 = decodeRuns(bad3);
  assert.equal(b3.length, 3);
  assert.equal(b3[2].frames, null);
  assert.ok(runsFileState(b3).damaged.some((d) => d.frames && d.id === runs[2].id));
});

test('paw-s49h: a discarded run stays in the file while a history entry keeps its record, comes back whole; a compaction drops what nobody keeps', async () => {
  const fx = fixture(3, 40), { be } = shell();
  let st = await writeRunsCow(be, P, fx, null);
  const refs = Object.fromEntries(fx.map((r, i) => [r.id, st.runs[i]]));
  st = await writeRunsCow(be, P, fx.slice(1), st, { keep: [refs[fx[0].id]] });   // discarded, a checkpoint keeps it
  const [back] = await decodeRecords(be.files.get(P), [refs[fx[0].id]]);
  assert.ok(back && back.id === fx[0].id);
  assert.equal(v1([back]), v1(decodeRuns(encodeRuns([fx[0]]))), 'frames and all');
  assert.ok(!lazyFrames(back.frames) || back.frames.ov.some(Boolean));
  // compacted while kept: still there
  st = await writeRunsCow(be, P, fx.slice(1), st, { keep: [refs[fx[0].id]], compact: true });
  assert.equal((await decodeRecords(be.files.get(P), [refs[fx[0].id]])).length, 1);
  const kept = be.files.get(P).length;
  // the entry pruned: the next compaction drops it
  st = await writeRunsCow(be, P, fx.slice(1), st, { keep: [], compact: true });
  assert.equal((await decodeRecords(be.files.get(P), [refs[fx[0].id]])).length, 0);
  assert.ok(be.files.get(P).length < kept - 1000);
  assert.equal(v1(open(be).runs), v1(decodeRuns(encodeRuns(fx.slice(1)))));
});

test('garbage triggers a compaction by itself: many record versions later the file is about its live size', async () => {
  const fx = fixture(2, 30), { be, log } = shell();
  let st = await writeRunsCow(be, P, fx, null), runs = fx;
  const live = be.files.get(P).length;
  for (let i = 0; i < 60; i++) { runs = runs.map((r, k) => (k ? r : { ...r, notes: [{ t: i, text: String(i).repeat(1 << 20) }] })); st = await writeRunsCow(be, P, runs, st); }
  assert.ok(log.calls.filter((c) => c === 'runsStageCommit').length >= 2, 'compacted along the way');
  assert.ok(be.files.get(P).length < Math.max(64 << 20, 4 * live), `${be.files.get(P).length} bytes`);
  assert.equal(v1(open(be).runs), v1(decodeRuns(encodeRuns(runs))));
});

test('paw-d1sq: frames tracked this session go lazy once written, with the same numbers; frames that would change keep their own', async () => {
  const fx = fixture(2, 40), { be } = shell();
  fx[1].frames.ov[3] = { ...fx[1].frames.ov[3], masks: [[[0.1, 0.1], [0.2, 0.2], [0.1, 0.2]]] };   // a mask: not stored, so not swapped
  const before = fx.map((r) => JSON.parse(JSON.stringify(r.frames)));
  await writeRunsCow(be, P, fx, null);
  let n = 0;
  for (const r of fx) n += await lightenFrames(r.frames);
  assert.ok(n >= 70, `${n} frames swapped`);
  assert.ok(lazyFrames(fx[0].frames));
  for (let k = 0; k < 2; k++) assert.deepEqual(JSON.parse(JSON.stringify(fx[k].frames)), before[k]);
  assert.ok(fx[1].frames.ov[3].masks, 'the masked frame kept its own overlay');
  // written again: the same file (the swapped frames encode from the same section)
  const again = shell();
  await writeRunsCow(again.be, P, fx, null);
  assert.equal(v1(open(again.be).runs), v1(open(be).runs));
});

test('writeInParts: no IPC body over 8 MB, swapped in whole', async () => {
  const { be, log } = shell(), big = new Uint8Array(20 << 20).map((_, i) => i & 255);
  const sizes = [], w = be.runsStageWrite;
  be.runsStageWrite = (p, s, b) => { sizes.push(b.length); return w(p, s, b); };
  await writeInParts(be, 'C:/x/a.pawruns', big);
  assert.deepEqual(sizes, [8 << 20, 8 << 20, 4 << 20]);
  assert.deepEqual(be.files.get('C:/x/a.pawruns'), big);
  assert.equal(log.calls.at(-1), 'runsStageCommit');
});
