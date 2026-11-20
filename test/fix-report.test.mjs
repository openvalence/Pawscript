// dev/fix-report.mjs (paw-dze): ranking by cost and by frequency, home-step attribution, success rate, replay of old
// logs, notes inline, filters, and a synthetic live session through FixLog end to end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { analyse, markdown, load, episodesFrom } from '../dev/fix-report.mjs';
import { FixLog } from '../src/app/fixlog.js';

const T0 = Date.parse('2026-11-11T10:00:00Z'), iso = (s) => new Date(T0 + s * 1000).toISOString();
const ep = (s, o) => ({ t: iso(s), s: 'a', kind: 'episode', project: 'p1', video: 'v.mp4', auto: [], ok: [], fixes: [], notes: [], cost: { s: 0, n: 0 }, text: '', ...o });

test('fix report: ranks by total cost and by frequency, shares an episode\'s cost by actions', () => {
  const eps = [
    ep(0, { scene: 1, shot: 1, t0: 0, t1: 9, auto: [{ step: 'track.run', t: iso(0) }], fixes: [{ kind: 'fix:signal.source', n: 3, t: iso(50) }, { kind: 'fix:signal.flip', n: 1, t: iso(60) }], cost: { s: 120, n: 4 } }),
    ep(200, { scene: 2, shot: 3, t0: 10, t1: 19, auto: [{ step: 'track.run', t: iso(200) }], fixes: [{ kind: 'fix:signal.flip', n: 1, t: iso(210) }], cost: { s: 10, n: 1 } }),
    ep(400, { scene: 3, shot: 4, t0: 20, t1: 29, auto: [{ step: 'track.run', t: iso(400) }], fixes: [{ kind: 'fix:signal.flip', n: 1, t: iso(405) }], cost: { s: 5, n: 1 } }),
    ep(600, { scene: 4, shot: 5, t0: 30, t1: 39, auto: [{ step: 'track.run', t: iso(600) }] }),   // untouched
  ];
  const m = analyse({ episodes: eps });
  const byCost = [...m.problems].sort((a, b) => b.totalS - a.totalS), byFreq = [...m.problems].sort((a, b) => b.episodes - a.episodes);
  assert.deepEqual(byCost.map((p) => [p.fix, p.totalS]), [['signal.source', 90], ['signal.flip', 45]]);
  assert.deepEqual(byFreq.map((p) => [p.fix, p.episodes, p.medianS]), [['signal.flip', 3, 10], ['signal.source', 1, 90]]);
  assert.deepEqual(m.success, [{ step: 'track.run', episodes: 4, untouched: 1, rate: 25 }]);
  const md = markdown(m);
  assert.match(md, /\| track\.run -> signal\.source \| 1 \| 3 \| 90 \| 90 \| v\.mp4 S1 \|/);
  assert.ok(md.indexOf('## 1. Top problems by manual cost') < md.indexOf('## 1b.'));
});

test('fix report: a fix with no automatic output in its episode goes to its home step, which then counts as changed', () => {
  const m = analyse({ episodes: [
    ep(0, { whole: true, auto: [{ step: 'shots.detect', t: iso(0) }] }),
    ep(500, { scene: 2, shot: 2, t0: 0, t1: 9, fixes: [{ kind: 'fix:structure.cut', n: 2, t: iso(520) }], cost: { s: 20, n: 2 } }),
    ep(900, { scene: 3, shot: 3, t0: 10, t1: 19, fixes: [{ kind: 'fix:fx.add', n: 1, t: iso(905) }], cost: { s: 5, n: 1 } }),
  ] });
  assert.deepEqual(m.problems.map((p) => `${p.auto} -> ${p.fix}`).sort(), ['(no automatic step) -> fx.add', 'shots.detect -> structure.cut']);
  assert.deepEqual(m.success, [{ step: 'shots.detect', episodes: 1, untouched: 0, rate: 0 }]);
});

test('fix report: replays an old log (labels, tracker notes, playhead), finds retry chains and quick undos, notes inline, filters', () => {
  const r = (s, k, o = {}) => ({ t: iso(s), s: 'old', k, ...o });
  const usage = [
    r(0, 'project:open', { file: 'clip.mp4' }),
    r(1, 'play:seek', { from: 0, to: 30000 }),
    r(2, 'tracking:runStart', { tracker: 'cotracker_points', label: 'track', t0: 28000, t1: 40000, params: '{}' }),
    r(30, 'tracking:runEnd', { tracker: 'cotracker_points', run: 'r1', points: 50, picked: 'sem_c1_penis' }),
    r(40, 'tracking:setChannel', { run: 'r1', scene: 4, from: 'primary', to: 'fused' }),
    r(45, 'tracking:setChannel', { run: 'r1', scene: 4, from: 'fused', to: 'rel:a:b' }),
    r(50, 'edit:commit', { label: 'Merge shots', paths: 'scenes' }),
    r(53, 'edit:undo', { label: 'Merge shots' }),
  ];
  const notes = [{ t: iso(46), k: 'note', id: 'n1', tone: 'bug', text: 'source jumps here', project: 'x', video: 'clip.mp4', at: 31000, scene: 4, shot: 6, mode: 'track', tool: '', focus: 'lane:stroke', sel: { points: 0, shots: [] }, run: { id: 'r1', tracker: 'cotracker_points', source: 'fused', direction: 'both' }, recent: [{ k: 'tracking:setChannel' }] }];
  const m = analyse({ usage, notes });
  assert.equal(m.episodes.length, 1);
  assert.ok(m.episodes[0].replayed);
  assert.match(m.episodes[0].text, /tracked \(cotracker_points, picked sem_c1_penis\); picked channel fused -> rel:a:b/);
  assert.deepEqual(m.retries.map((x) => [x.kind, x.n]), [['fix:signal.channel', 2]]);
  assert.deepEqual(m.undos, [{ label: 'Merge shots', n: 1 }]);
  const md = markdown(m);
  assert.match(md, /> note \[bug\] 2026-11-11 10:00 at 0:31\.0 S4 shot 6 · run r1 cotracker_points fused · track · lane:stroke: source jumps here/);
  assert.match(md, /signal\.channel 2x: fused -> rel:a:b/);
  assert.equal(analyse({ usage, notes }, { project: 'nomatch' }).episodes.length, 0);
  assert.equal(analyse({ usage, notes }, { since: '2026-11-12' }).episodes.length, 0);
  assert.equal(analyse({ usage, notes }, { project: 'CLIP' }).notes.length, 1);
});

test('fix report: a synthetic live session (FixLog -> usage JSONL + fixes.jsonl) read back from a data folder, CLI flags', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixrep-'));
  try {
    let now = T0;
    const usage = [], fixes = [];
    const scenes = [{ start_ms: 0, end_ms: 10000 }, { start_ms: 10000, end_ms: 20000 }];
    const log = new FixLog({ now: () => now, note: (k, d) => usage.push(JSON.stringify({ t: new Date(now).toISOString(), s: 'live', k, ...d })), sink: { append: (s) => fixes.push(s) },
      ctx: () => ({ project: 'n1234abcd', video: 'live.mp4', at: 12000, scenes }), axis: () => [], sid: () => 'live' });
    log.event({ t: now, k: 'tracking:runStart', tracker: 'tapnext_points', t0: 10000, t1: 20000, params: '{}' });
    log.event({ t: (now += 20000), k: 'tracking:runEnd', tracker: 'tapnext_points', run: 'r1', points: 30 });
    log.event({ t: (now += 5000), k: 'tracking:flip', run: 'r1', t0: 10000, t1: 20000 });
    const s1 = scenes.map((s, i) => (i === 1 ? { ...s, derive: { source: 'sem_c1_penis' } } : s));
    now += 5000; log.record('Signal: source', [{ path: 'scenes', before: scenes, after: s1 }]);
    log.closeAll();
    fs.writeFileSync(path.join(dir, 'usage-2026-11-11.jsonl'), usage.join('\n') + '\n');
    fs.writeFileSync(path.join(dir, 'fixes.jsonl'), fixes.join(''));
    fs.writeFileSync(path.join(dir, 'feedback.jsonl'), JSON.stringify({ t: iso(40), k: 'note', id: 'a', tone: 'note', text: 'gone', video: 'live.mp4' }) + '\n' + JSON.stringify({ t: iso(41), k: 'delete', id: 'a' }) + '\n');
    const data = load([dir]);
    assert.deepEqual([data.episodes.length, data.notes.length], [1, 0]);
    assert.equal(episodesFrom(data.usage, new Set(['live'])).length, 0);   // the session's episodes come from fixes.jsonl
    assert.equal(episodesFrom(data.usage).length, 1);                      // and regroup the same from its facts
    const out = execFileSync(process.execPath, ['dev/fix-report.mjs', dir], { encoding: 'utf8' });
    assert.match(out, /S2 · shot 2 \(0:10\.0–0:20\.0\): tracked \(tapnext_points\); flipped direction; changed source sem_c1_penis · 10 s, 2 actions/);
    assert.match(out, /\| track\.run -> signal\.flip \| 1 \| 1 \|/);
    const js = JSON.parse(execFileSync(process.execPath, ['dev/fix-report.mjs', dir, '--json', '--project', 'live'], { encoding: 'utf8' }));
    assert.deepEqual([js.episodes.length, js.success[0].step], [1, 'track.run']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
