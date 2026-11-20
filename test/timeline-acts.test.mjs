import assert from 'node:assert/strict';
import test from 'node:test';
import { tagsOf, detectedMods, sceneTags, hasTag, sceneView, isInternal, primaryAct, toggleTag, migrateScene, tintOf, actKind, actText, actWords, needsWhere,
  tagSpan, tagsAt, setTagStart, setTagEnd, TAG, TAG_CATEGORIES } from '../src/features/timeline/acts.js';
import { setTags, splitAt, mergeNext } from '../src/features/timeline/scenes.js';
import { cleanScenes } from '../src/app/project-logic.js';
import { KIND } from '../src/features/timeline/kinds.js';

const D = (acts, tags = [], positions = []) => ({ tags, summary: { acts, positions, views: [], count: 'duo', knot: false, rating: 'explicit' } });
const T = (...acts) => tagsOf(D(acts));

test('tagsOf: e621 names -> where x what, the umbrella names only when nothing specific gave that category', () => {
  assert.deepEqual(T('anal_penetration'), ['anal', 'penetration']);
  assert.deepEqual(T('anal', 'anal_fingering'), ['anal', 'fingering']);
  assert.deepEqual(T('anal', 'rimming'), ['anal', 'licking']);                                   // rimming = anal licking
  assert.deepEqual(T('cunnilingus'), ['vaginal', 'licking']);
  for (const n of ['fellatio', 'irrumatio', 'deep_throat', 'oral_penetration']) assert.deepEqual(T(n), ['oral', 'penetration'], n);
  assert.deepEqual(T('oral_penetration', 'tongue_in_ass'), ['anal', 'tonguefucking']);            // the tongue, not a mouth penetration
  assert.deepEqual(T('tongue_in_pussy'), ['vaginal', 'tonguefucking']);
  assert.deepEqual(T('tongue_in_mouth'), ['kissing']);
  assert.deepEqual(T('french_kiss'), ['kissing']);
  assert.deepEqual(T('vaginal_fisting'), ['vaginal', 'fisting']);
  assert.deepEqual(T('anal_dildo'), ['anal', 'toy']);
  assert.deepEqual(T('dildo_insertion'), ['toy']);
  assert.deepEqual(T('sex', 'penetration', 'double_penetration'), ['anal', 'vaginal', 'penetration']);
  assert.deepEqual(T('spitroast', 'vaginal_penetration'), ['vaginal', 'oral', 'penetration']);
  assert.deepEqual(T('anal', 'vaginal_penetration'), ['vaginal', 'penetration']);               // bare anal: only without a specific where
  assert.deepEqual(T('anal'), ['anal']);
  assert.deepEqual(T('sex'), ['penetration']);
  assert.deepEqual(T('thrusting', 'anal_fingering'), ['anal', 'fingering']);
  // knotting / orgasm: never a tag (paw-8b4h), the Modifiers row's suggestion (detectedMods)
  assert.deepEqual(T('anal_knotting', 'knotting'), ['anal', 'penetration']);
  assert.deepEqual(detectedMods({ describe: D(['anal_knotting', 'knotting']) }), ['knotting']);
  assert.deepEqual(tagsOf(D([], [], ['knot_sitting'])), []);
  assert.deepEqual(detectedMods({ describe: D([], [], ['knot_sitting']) }), ['knotting']);
  assert.deepEqual(tagsOf(D(['fellatio'], [{ tag: 'cumshot', score: 0.8 }])), ['oral', 'penetration']);
  assert.deepEqual(detectedMods({ describe: D(['fellatio'], [{ tag: 'cumshot', score: 0.8 }]) }), ['orgasm']);
  assert.deepEqual(detectedMods({ describe: D(['fellatio'], [{ tag: 'cumshot', score: 0.3 }]) }), []);   // below MIN_SCORE
  assert.deepEqual(detectedMods({ describe: D(['anal_penetration']), scene_describe: D([], [{ tag: 'cum', score: 0.9 }]) }), ['orgasm'], "a multi-shot scene: its scene's describe");
  assert.deepEqual(T('ball_lick', 'kissing'), ['licking', 'kissing']);
  assert.deepEqual(T('thigh_sex', 'handjob', 'footjob', 'titfuck'), ['grinding', 'handjob', 'footjob', 'titfuck']);
  assert.deepEqual(tagsOf({ tags: [{ tag: 'x-ray_view', score: 0.9 }, { tag: 'anal_penetration', score: 0.7 }] }), ['internal', 'anal', 'penetration']);   // no summary: the tags
  assert.deepEqual(tagsOf(null), []);
  assert.deepEqual(T('unknown_act'), []);
});

test('labels, aliases, colour: "anal penetration", "rimming", "double penetration + fellatio"; penetration takes its where\'s colour', () => {
  const s = (...tags) => ({ tags });
  assert.equal(actText(s('anal', 'penetration')), 'anal penetration');
  assert.equal(actText(s('anal', 'licking')), 'rimming');
  assert.equal(actText(s('vaginal', 'licking')), 'cunnilingus');
  assert.equal(actText(s('anal', 'vaginal', 'licking')), 'rimming + cunnilingus');
  assert.equal(actText(s('anal', 'vaginal', 'oral', 'penetration')), 'double penetration + fellatio');
  assert.equal(actText(s('anal', 'oral', 'penetration')), 'fellatio + anal penetration');
  assert.equal(actText(s('handjob', 'kissing')), 'handjob + kissing');
  assert.equal(actText(s('anal')), 'anal');
  assert.deepEqual(actWords(s('anal', 'licking', 'fingering')), { aliases: ['rimming'], wheres: [], whats: ['fingering'] });
  assert.equal(actKind(s('oral', 'penetration')), 'oral'); assert.equal(actKind(s('anal', 'penetration')), 'penetration');
  assert.equal(actKind(s('penetration')), 'penetration'); assert.equal(actKind(s('anal', 'fingering')), 'foreplay');
  assert.equal(primaryAct(s('anal', 'licking')), 'licking'); assert.equal(primaryAct(s('vaginal')), 'vaginal'); assert.equal(primaryAct({}), null);
  assert.equal(tintOf({ describe: D([], [{ tag: 'cum', score: 0.9 }]) }), null);                // the tagger's orgasm is no tag (paw-8b4h)
  assert.equal(tintOf({ start_ms: 0, end_ms: 9, tags: [{ id: 'orgasm', t0: 0, t1: 9 }] }), 'orgasm');   // no act, an Orgasm modifier over it: its colour
  for (const t of TAG_CATEGORIES.flatMap((c) => c.tags)) if (t.kind) assert.ok(KIND[t.kind], t.id);
});

test('alias round trip: picking rimming toggles anal + licking, picking it again removes both; a shared part stays', () => {
  const a = { tags: toggleTag({}, 'rimming') };
  assert.deepEqual(sceneTags(a), ['anal', 'licking']);
  assert.deepEqual(sceneTags({ tags: toggleTag(a, 'rimming') }), []);
  assert.deepEqual(sceneTags({ tags: toggleTag(a, 'analingus') }), []);                          // a synonym
  const both = { tags: toggleTag(a, 'cunnilingus') };
  assert.deepEqual(sceneTags(both), ['anal', 'vaginal', 'licking']);
  assert.deepEqual(sceneTags({ tags: toggleTag(both, 'rimming') }), ['vaginal', 'licking']);     // licking still serves cunnilingus
  const d = { describe: D(['anal_penetration']) };                                               // half of it from the describe
  assert.deepEqual(sceneTags({ ...d, tags: toggleTag(d, 'double penetration') }), ['anal', 'vaginal', 'penetration']);
});

test('paw-8b4h: a modifier is never a scene tag: toggleTag refuses it, a bare id or a removal counts for nothing, a projected span counts where it meets', () => {
  assert.equal(toggleTag({}, 'knotting'), undefined);
  const a = { tags: ['anal'] };
  assert.equal(toggleTag(a, 'orgasm'), a.tags);
  assert.deepEqual(sceneTags({ tags: ['anal', 'penetration', 'knotting', '-orgasm'] }), ['anal', 'penetration']);
  assert.equal(needsWhere({ tags: ['knotting'] }), false, 'a stored knotting asks for nothing');
  assert.deepEqual(sceneTags({ start_ms: 0, end_ms: 10, tags: ['anal', { id: 'orgasm', t0: 5, t1: 20 }] }), ['anal', 'orgasm'], 'mods.js withMods projection');
  assert.deepEqual(sceneTags({ start_ms: 0, end_ms: 10, tags: ['anal', { id: 'orgasm', t0: 10, t1: 20 }] }), ['anal'], 'only where it meets the scene');
  assert.deepEqual(toggleTag({ tags: ['anal', 'penetration'] }, 'penetration'), ['anal', '-penetration'], 'dropping penetration drops nothing else');
  assert.equal(needsWhere({ tags: ['fingering'] }), true); assert.equal(needsWhere({ tags: ['licking'] }), false);
});

test('spans: a tag may start / end inside its scene; tagsAt reads them; refused when it would be empty', () => {
  const s = { start_ms: 1000, end_ms: 9000, describe: D(['frottage']) };
  assert.deepEqual(tagSpan(s, 'grinding'), { t0: 1000, t1: 9000 });
  let x = { ...s, tags: toggleTag(s, 'penetration') };
  x = { ...x, tags: setTagStart(x, 'penetration', 4000) };
  x = { ...x, tags: setTagEnd(x, 'grinding', 4000) };
  x = { ...x, tags: toggleTag(x, 'kissing') };
  x = { ...x, tags: setTagStart(x, 'kissing', 7000) };
  assert.deepEqual(x.tags, [{ id: 'penetration', t0: 4000 }, { id: 'grinding', t1: 4000 }, { id: 'kissing', t0: 7000 }]);
  assert.deepEqual(tagsAt(x, 2000), ['grinding']);
  assert.deepEqual(tagsAt(x, 5000), ['penetration']);
  assert.deepEqual(tagsAt(x, 8000), ['penetration', 'kissing']);
  assert.deepEqual(tagSpan(x, 'kissing'), { t0: 7000, t1: 9000 });
  assert.equal(setTagEnd(x, 'kissing', 6000), x.tags);                                         // before its start: refused
  assert.deepEqual(setTagStart(x, 'penetration', null)[2], 'penetration');                      // back to the scene's edge: a plain id
  assert.deepEqual(tagSpan({ ...x, tags: setTagStart(x, 'kissing', 99999) }, 'kissing'), { t0: 7000, t1: 9000 });   // past the end: clipped -> empty -> refused
  assert.equal(setTagStart(x, 'internal', 5000), x.tags);                                       // view tags carry no span
  assert.deepEqual(sceneTags({ ...x, tags: toggleTag(x, 'penetration') }), ['grinding', 'kissing']);   // off: the span goes with it
});

test('view tags are exclusive: toggling one replaces the other, the user view replaces the detected one', () => {
  const xray = { describe: { tags: [{ tag: 'x-ray', score: 0.8 }] } };
  assert.equal(sceneView(xray), 'internal');
  const off = { ...xray, tags: toggleTag(xray, 'offscreen') };
  assert.deepEqual(sceneTags(off), ['offscreen']); assert.equal(isInternal(off), false);
  const back = { ...off, tags: toggleTag(off, 'internal') };
  assert.deepEqual(back.tags, ['internal']); assert.equal(sceneView(back), 'internal');
  const none = { ...xray, tags: toggleTag(xray, 'internal') };
  assert.deepEqual(none.tags, ['-internal']); assert.equal(sceneView(none), null);
  assert.equal(hasTag({ tags: toggleTag({}, 'internal') }, 'internal'), true);
});

test('migration: kind / sub / view and renamed ids -> tags on load; plain strings and spans pass through', () => {
  const anal = migrateScene({ start_ms: 0, end_ms: 10, kind: 'penetration', sub: 'anal', describe: D(['fellatio']) });
  assert.deepEqual(anal, { start_ms: 0, end_ms: 10, describe: D(['fellatio']), tags: ['anal', 'penetration', '-oral'] });
  assert.deepEqual(sceneTags(anal), ['anal', 'penetration']);
  assert.deepEqual(sceneTags(migrateScene({ kind: 'knotting', describe: D(['vaginal_penetration']) })), ['vaginal', 'penetration'], 'its knotting tag counts for nothing (the load turns it into the modifier: project-logic modsFromV2)');
  assert.deepEqual(migrateScene({ kind: 'knotting', sub: 'oral' }).tags, ['knotting', 'oral', 'penetration']);
  assert.deepEqual(migrateScene({ kind: 'penetration', sub: 'double' }).tags, ['anal', 'vaginal', 'penetration']);
  assert.deepEqual(migrateScene({ kind: 'oral', sub: 'penetration' }).tags, ['oral', 'penetration']);
  assert.deepEqual(migrateScene({ kind: 'penetration' }).tags, ['penetration']);
  assert.equal(migrateScene({ kind: 'penetration', describe: D(['anal_penetration']) }).tags, undefined);   // the describe already says so
  assert.deepEqual(migrateScene({ kind: 'oral', sub: 'licking', describe: D(['fellatio']) }).tags, ['licking', '-oral', '-penetration']);
  assert.deepEqual(migrateScene({ tags: ['sex', '-anal'] }).tags, ['penetration', '-anal']);   // renamed
  assert.deepEqual(migrateScene({ tags: ['rimming', 'knotting'] }).tags, ['anal', 'licking', 'knotting']);   // split into where + what
  assert.deepEqual(migrateScene({ tags: [{ id: 'rimming', t0: 5 }] }).tags, [{ id: 'anal', t0: 5 }, { id: 'licking', t0: 5 }]);
  assert.deepEqual(migrateScene({ kind: 'offscreen', continues: false }), { continues: false, tags: ['offscreen'] });
  assert.deepEqual(migrateScene({ view: 'internal' }).tags, ['internal']);
  assert.deepEqual(migrateScene({ view: '', describe: { tags: [{ tag: 'x-ray', score: 0.9 }] } }).tags, ['-internal']);
  assert.deepEqual(migrateScene({ kind: 'foreplay', sub: '' }), {});                                // "Any" over nothing: no tags
  for (const plain of [{ start_ms: 0, end_ms: 5, continues: true }, { tags: ['anal', 'penetration', '-oral'] }, { tags: [{ id: 'knotting', t0: 3 }] }]) assert.equal(migrateScene(plain), plain);
  assert.deepEqual(cleanScenes([{ start_ms: 0, end_ms: 5, kind: 'orgasm' }, { start_ms: 5, end_ms: 4 }]), [{ start_ms: 0, end_ms: 5, tags: ['orgasm'] }], 'an old kind becomes its tag (modifiers are made as modifiers now: paw-ef73.20)');
  assert.equal(TAG.throbbing.cat, 'modifier');
});

test('setTags: same list when unchanged, null / [] clears, split / merge carry the tags', () => {
  const list = [{ start_ms: 0, end_ms: 1000 }, { start_ms: 1000, end_ms: 2000 }];
  const a = setTags(list, 0, ['knotting']);
  assert.deepEqual(a[0].tags, ['knotting']); assert.equal(a[1], list[1]);
  assert.equal(setTags(a, 0, ['knotting']), a);
  assert.equal(setTags(a, 0, null)[0].tags, undefined);
  assert.equal(setTags(a, 0, [])[0].tags, undefined);
  assert.equal(setTags(list, 0, null), list);
  assert.equal(setTags(list, 5, ['x']), null);
  assert.equal(splitAt(a, 500).filter((s) => s.tags?.[0] === 'knotting').length, 2);
  assert.deepEqual(mergeNext(splitAt(a, 500), 0)[0].tags, ['knotting']);
});

test('paw-n00h dancing: from the describe tags (not in describe.py ACTS), a what of its own, solo-capable, foreplay family, busy, no where asked', async () => {
  const { structureAuto } = await import('../src/features/timeline/acts.js');
  const { TWO_ACTS, ACT_ROWS } = await import('../src/lib/fusion.js');
  const tg = (...n) => n.map((tag) => ({ tag, score: 0.9 }));
  for (const n of ['dancing', 'pole_dancing', 'twerking', 'shaking_butt']) assert.deepEqual(tagsOf(D([], tg(n))), ['dancing'], n);
  assert.deepEqual(tagsOf(D([], tg('erection', 'twerking'))), ['dancing'], 'a dance with the penis out is dancing, not exposed');
  assert.deepEqual(tagsOf(D(['anal_penetration'], tg('twerking'))), ['anal', 'penetration', 'dancing']);
  assert.deepEqual(tagsOf(D([], [{ tag: 'dancing', score: 0.3 }])), [], 'under MIN_SCORE');
  assert.deepEqual(tagsOf(D(['dancing'])), [], 'the summary acts never carry it: only the tags');
  const s = { start_ms: 0, end_ms: 1000, describe: D([], tg('dancing')) };
  assert.equal(primaryAct(s), 'dancing');
  assert.equal(actKind(s), 'foreplay');
  assert.equal(needsWhere(s), false);
  assert.equal(TAG.dancing.cat, 'what');
  assert.deepEqual(structureAuto([s]), [null], 'busy: an act');
  assert.ok(!TWO_ACTS.includes('dancing') && ACT_ROWS.some((e) => e.acts.join() === 'dancing'));
});

test('paw-210e tailjob / tail penetration / facesitting: Hydra names, kinds, wheres, the hidden penetration, no shaft, fusion rows', async () => {
  const { structureAuto } = await import('../src/features/timeline/acts.js');
  const { isShaft } = await import('../src/features/tracking/groups.js');
  const { TWO_ACTS, ACT_ROWS } = await import('../src/lib/fusion.js');
  const tg = (...n) => n.map((tag) => ({ tag, score: 0.9 }));
  // tailjob: its own what now, never handjob's
  assert.deepEqual(tagsOf(D(['tailjob'], tg('tailjob'))), ['tailjob']);
  assert.deepEqual(tagsOf(D([], tg('tail_around_penis'))), ['tailjob']);
  assert.deepEqual(tagsOf(D(['handjob'], tg('handjob', 'tailjob'))), ['handjob', 'tailjob'], 'a hand and a tail: both');
  assert.ok(!TAG.handjob.names.includes('tailjob'));
  // tail penetration: the implied anal_penetration / penetration go (no penis), the where stays
  assert.deepEqual(tagsOf(D(['anal', 'anal_penetration'], tg('tail_in_ass', 'tail_insertion', 'anal_penetration'))), ['anal', 'tailpen']);
  assert.deepEqual(tagsOf(D(['vaginal_penetration'], tg('tail_in_vagina', 'vaginal_penetration'))), ['vaginal', 'tailpen']);
  assert.deepEqual(tagsOf(D(['sex', 'penetration'], tg('tail_insertion', 'sex', 'penetration'))), ['tailpen'], 'no umbrella penetration either');
  assert.deepEqual(tagsOf(D(['anal_penetration'])), ['anal', 'penetration'], 'plain penetration unchanged');
  // facesitting: from the tags (it is a describe POSITION), with the licking that comes with it
  for (const n of ['facesitting', 'butt_smother']) assert.deepEqual(tagsOf(D([], tg(n))), ['facesitting'], n);
  assert.deepEqual(tagsOf(D(['cunnilingus'], tg('facesitting', 'cunnilingus'))), ['vaginal', 'licking', 'facesitting']);
  assert.deepEqual(tagsOf(D(['anal_penetration'])).includes('facesitting'), false);
  const sc = (tags) => ({ start_ms: 0, end_ms: 1000, tags });
  const tj = sc(['tailjob']), tp = sc(['anal', 'tailpen']), tp0 = sc(['tailpen']), fs = sc(['facesitting']);
  assert.deepEqual([actKind(tj), actKind(tp), actKind(fs)], ['foreplay', 'penetration', 'foreplay']);
  assert.deepEqual([needsWhere(tj), needsWhere(tp0), needsWhere(tp), needsWhere(fs)], [false, true, false, false]);
  assert.equal(actText(tp), 'anal tail penetration');
  assert.deepEqual(structureAuto([tj, tp, fs]), [null, null, null], 'busy: acts');
  const pen = { name: 'c1_penis', who: 'c1', part: 'penis', poly: [[0, 0], [0.1, 0], [0.1, 0.1]], t_ms: 100 };
  assert.ok(!isShaft(pen, tp) && isShaft(pen, sc(['anal', 'penetration'])), 'no shaft reading on a tail penetration');
  assert.ok(!TWO_ACTS.includes('tailjob') && !TWO_ACTS.includes('tailpen') && TWO_ACTS.includes('facesitting'));
  for (const a of ['tailjob', 'tailpen', 'facesitting']) assert.ok(ACT_ROWS.some((e) => e.acts.join() === a), a);
});

test('exposed: dick out, no act -- an umbrella over the describe tags, only when no other what hit; throbbing on a no-act scene', async () => {
  const { skipReason, structureAuto, isExposed } = await import('../src/features/timeline/acts.js');
  const tg = (...n) => n.map((tag) => ({ tag, score: 0.9 }));
  assert.deepEqual(tagsOf(D([], tg('erection'))), ['exposed']);
  for (const n of ['penis', 'genitals', 'exposed_penis', 'presenting', 'presenting_penis', 'knot', 'erect_penis']) assert.deepEqual(tagsOf(D([], tg(n))), ['exposed'], n);
  assert.deepEqual(tagsOf(D(['anal_penetration'], tg('erection', 'anal_penetration'))), ['anal', 'penetration']);   // a penetration scene never gets exposed too
  assert.deepEqual(tagsOf(D(['sex'], tg('erection'))), ['penetration']);   // a bare umbrella what still wins over exposed
  assert.deepEqual(tagsOf(D([], [{ tag: 'erection', score: 0.3 }])), []);   // under MIN_SCORE
  assert.deepEqual(tagsOf({ tags: tg('erection', 'handjob') }), ['handjob']);   // no summary: the tags are the acts pool, handjob hit
  assert.equal(TAG.exposed.cat, 'what');
  assert.equal(KIND.exposed.hex, '#B8695C');
  // a Throbbing modifier over a scene with no act (no implications, no where asked)
  const s = { start_ms: 0, end_ms: 1000, describe: D([], tg('erection')) };
  const t = { ...s, tags: [{ id: 'throbbing', t0: 0, t1: 1000 }] };   // as mods.js withMods projects it
  assert.deepEqual(sceneTags(t), ['exposed', 'throbbing']);
  assert.equal(needsWhere(t), false);
  // composes with structure: an exposed opening is still an intro (exposed is no act), and still tracked
  const list = [{ ...s }, { start_ms: 1000, end_ms: 2000, describe: D(['anal_penetration']) }];
  assert.deepEqual(structureAuto(list), ['intro', null]);
  assert.equal(isExposed(s), true);
  assert.equal(skipReason({ ...s, structure: 'intro' }), '');
  assert.equal(skipReason({ start_ms: 0, end_ms: 1000, structure: 'intro' }), 'intro: nothing to track, generated');
});
