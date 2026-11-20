// acts.js suggestWhat / suggestWhere (the quick bar's ghost chips) and tagSpans (Track's span labels from the tags);
// scenes.js coverage / sceneStatus (the Scenes panel's run status).
import assert from 'node:assert/strict';
import test from 'node:test';
import { suggestWhat, suggestWhere, tagSpans } from '../src/features/timeline/acts.js';
import { coverage, sceneStatus } from '../src/features/timeline/scenes.js';
import { continuations } from '../src/lib/scenes-continue.js';

const S = (t0, t1, tags = [], extra = {}) => ({ start_ms: t0, end_ms: t1, tags, ...extra });
const ids = (xs) => xs.map((x) => x.id);

test('suggestWhat: tagger confidence first (labels under MIN_SCORE count), other wheres ignored', () => {
  const describe = { tags: [{ tag: 'anal_fingering', score: 0.31 }, { tag: 'vaginal_penetration', score: 0.45 }, { tag: 'anal_dildo', score: 0.12 }] };
  const s = S(0, 1000, ['anal'], { describe });
  const out = suggestWhat(s, [s]);
  assert.deepEqual(ids(out), ['fingering', 'toy', 'penetration'], 'vaginal_penetration does not count for anal; fallback fills the rest');
  assert.equal(out[0].why, 'tagger 0.31');
  assert.equal(out[2].why, 'common');
});

test('suggestWhat: then the project\'s pairings, then the static order; nothing once a what is set', () => {
  const a = S(0, 1000, ['anal']);
  const others = [S(1000, 2000, ['anal', 'toy']), S(2000, 3000, ['anal', 'toy']), S(3000, 4000, ['anal', 'licking']), S(4000, 5000, ['vaginal', 'fisting'])];
  const out = suggestWhat(a, [a, ...others]);
  assert.deepEqual(ids(out), ['toy', 'licking', 'penetration']);
  assert.equal(out[0].why, '2 other scenes');
  assert.deepEqual(ids(suggestWhat(S(0, 1, ['anal']), [])), ['penetration', 'fingering', 'licking'], 'no evidence: the fallback order');
  assert.deepEqual(suggestWhat(S(0, 1, ['anal', 'toy']), []), [], 'has a what');
  assert.deepEqual(suggestWhat(S(0, 1, ['toy']), []), [], 'no where');
  assert.deepEqual(suggestWhat(null, []), []);
});

test('suggestWhat: alias words and implications map to the vocabulary', () => {
  const s = S(0, 1000, ['anal'], { describe: { tags: [{ tag: 'rimming', score: 0.2 }, { tag: 'anal_knotting', score: 0.4 }] } });
  assert.deepEqual(ids(suggestWhat(s, [s])).slice(0, 2), ['penetration', 'licking']);
});

test('suggestWhere: a what that happens in a where and no where -> wheres, same ranking', () => {
  const s = S(0, 1000, ['fingering'], { describe: { tags: [{ tag: 'vaginal_fingering', score: 0.3 }] } });
  const out = suggestWhere(s, [s, S(1000, 2000, ['anal', 'fingering'])]);
  assert.deepEqual(ids(out), ['vaginal', 'anal', 'oral']);
  assert.equal(out[1].why, '1 other scene');
  assert.deepEqual(suggestWhere(S(0, 1, ['handjob']), []), [], 'handjob needs no where');
  assert.deepEqual(suggestWhere(S(0, 1, ['anal', 'fingering']), []), [], 'has a where');
});

test('tagSpans: structure / blank -> idle, off-screen in a continuation -> carry, orgasm -> climax, manual wins', () => {
  const list = [
    S(0, 1000, ['intro']),
    S(1000, 3000, ['anal', 'penetration']),
    S(3000, 4000, ['offscreen']),                                    // a cutaway: scene 3 continues
    S(4000, 6000, ['anal', 'penetration', { id: 'orgasm', t0: 5000 }], { continues: true }),
    S(6000, 7000, ['offscreen']),                                    // off-screen, no continuation: active (no label)
    S(7000, 8000, [], { kind: 'blank' }),
    S(8000, 9000, ['after']),
  ];
  const conts = continuations(list);
  assert.deepEqual(tagSpans(list, conts), [
    { start_ms: 0, end_ms: 1000, state: 'idle' },
    { start_ms: 3000, end_ms: 4000, state: 'carry' },
    { start_ms: 5000, end_ms: 6000, state: 'climax' },
    { start_ms: 7000, end_ms: 8000, state: 'idle' },
    { start_ms: 8000, end_ms: 9000, state: 'idle' },
  ]);
  assert.deepEqual(tagSpans(list, conts, [{ start_ms: 500, end_ms: 1500, state: 'active' }]).slice(0, 2), [
    { start_ms: 0, end_ms: 500, state: 'idle' }, { start_ms: 500, end_ms: 1500, state: 'active' }], 'a manual label trims the derived one');
  assert.deepEqual(tagSpans([S(0, 1000, ['offscreen'], { continues: true })]), [{ start_ms: 0, end_ms: 1000, state: 'carry' }], 'marked continuing itself');
  assert.deepEqual(tagSpans([]), []);
});

test('coverage / sceneStatus: accepted when the axis covers half, else ghost, else none', () => {
  const P = (...at) => at.map((t) => ({ at: t, pos: 50 }));
  assert.equal(coverage(P(0, 500, 1000), 0, 1000), 1);
  assert.equal(coverage(P(0, 500, 4000, 4500), 0, 5000), 0.2, 'a gap over 2 s is not covered');
  assert.equal(coverage(P(-500, 1500), 0, 1000), 1, 'points around the span');
  assert.equal(coverage([], 0, 1000), 0);
  const sc = S(0, 1000);
  assert.deepEqual(sceneStatus(sc, P(0, 900)), { state: 'accepted', cover: 0.9 });
  assert.deepEqual(sceneStatus(sc, [], { script: P(0, 250) }), { state: 'ghost', cover: 0.25 });
  assert.deepEqual(sceneStatus(sc, []), { state: 'none', cover: 0 });
});
