// [review] one damaged block in a .pawruns must not cost the runs a history entry keeps (paw-s49h): the tracking store
// drops its copy-on-write state when verifyRuns finds a bad block (#checkRuns: this.#cow.delete), so the next write is
// writeRunsCow(..., state null), which ignores keep and replaces the file whole without a backup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeRuns, runsFileState, verifyRuns, decodeRecords } from '../src/lib/runs-file.js';
import { writeRunsCow, withoutBad } from '../src/lib/runs-cow.js';
import { cowCommands } from '../dev/mock-cow.js';
import { synthRuns } from '../dev/perf/synth-runs.mjs';

const P = 'C:/v/p.pawruns';
test('a bad frame block in run 2: the discarded run 0 that a checkpoint keeps survives the next write', async () => {
  const fx = synthRuns({ runs: 3, frames: 40, points: 64, groups: 3 });
  const files = new Map(), be = { files, ...cowCommands(files) };
  let st = await writeRunsCow(be, P, fx, null);
  const ref0 = st.runs[0];
  st = await writeRunsCow(be, P, fx.slice(1), st, { keep: [ref0] });   // run 0 discarded; a checkpoint keeps its record
  // one byte of run 2's frames flipped (disk error)
  const rs = runsFileState(decodeRuns(files.get(P)));
  const rec = JSON.parse(new TextDecoder().decode(rs.buf.subarray(rs.blocks.get(rs.runs[1])[0], rs.blocks.get(rs.runs[1])[0] + rs.blocks.get(rs.runs[1])[1])));
  const bad = new Uint8Array(files.get(P)); bad[rs.blocks.get(rec.frames.sec)[0] + 20] ^= 0x55; files.set(P, bad);
  const runs = decodeRuns(files.get(P)), v = await verifyRuns(runs);
  assert.equal(v.size, 1, 'the bad block is found');
  // tracking.svelte.js #checkRuns (paw-acfc): the state stays, without the bad blocks (it used to be dropped: state null)
  const live = runs.map((r) => (v.get(r.id) === 'frames' ? { ...r, frames: null } : r));
  const damaged = files.get(P);
  await writeRunsCow(be, P, live, withoutBad(runsFileState(runs), v.bad), { keep: [ref0] });
  assert.equal((await decodeRecords(files.get(P), [ref0])).length, 1, 'the kept record of the discarded run is gone from the file');
  // the damaged file went to the rolling backups before the rewrite; the new file reads clean
  assert.deepEqual(be.backups.map(([p, b]) => [p, b === damaged]), [[P, true]]);
  const again = decodeRuns(files.get(P));
  assert.equal((await verifyRuns(again)).size, 0);
  assert.equal(again.length, 2);
});
