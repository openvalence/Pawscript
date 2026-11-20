// The furry items setting (paw-43vn, settings 'content.furry', lib/content.js): off, the Groups picker offers no tail or sheath,
// paws read as feet and slit as vulva, the animal-only scene tags / tagger tags / species / Machine bodies are not offered; the knot
// stays; nothing stored changes, and a part a project already has (a tail group) still shows under its own name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile } from 'svelte/compiler';

registerHooks({
  load(url, ctx, next) {
    if (url.startsWith('file:') && url.endsWith('.svelte') && !url.includes('node_modules')) {
      const file = fileURLToPath(url);
      return { format: 'module', shortCircuit: true, source: compile(readFileSync(file, 'utf8'), { filename: file, generate: 'server' }).js.code };
    }
    return next(url, ctx);
  },
});
const { render } = await import('svelte/server');
const C = await import('../src/lib/content.js');
const { PARTS, PICK_PARTS, partWord, partLabel, chipParts, shownAt, trackGroups, groupName, ON_PART } = await import('../src/features/tracking/groups.js');
const { TARGETS, GENITALS, REGIONS, figureRegions } = await import('../src/features/tracking/figure.js');
const { proposalOf } = await import('../src/features/tracking/autoname.js');
const { partWord: shaftWord } = await import('../src/lib/shaft.js');
const { suggestWhere, TAG_CATEGORIES } = await import('../src/features/timeline/acts.js');
const { tagItems } = await import('../src/features/timeline/quickbar.js');
const { chipsOf } = await import('../src/features/timeline/scenes.js');
const { ALL_CHARACTERS } = await import('../src/features/machine/characters.js');
const { SCHEMA } = await import('../src/app/settings.svelte.js');
const { default: BodyFigure } = await import('../src/features/tracking/BodyFigure.svelte');
const { default: GroupsPicker } = await import('../src/features/tracking/GroupsPicker.svelte');

const settings = (furry) => ({ get: (k) => (k === C.FURRY ? furry : undefined) });
const off = () => C.bindSettings(settings(false)), on = () => C.bindSettings(settings(true));
const each = (fn) => { try { fn(); } finally { C.bindSettings(null); } };

test('the setting: default on, in the schema; unbound (tests, workers) = on', () => {
  assert.equal(SCHEMA['content.furry'].default, true);
  C.bindSettings(null); assert.equal(C.furryOn(), true);
  each(() => { off(); assert.equal(C.furryOn(), false); on(); assert.equal(C.furryOn(), true); });
});

test('picker lists: on offers every part as today; off offers no tail / sheath, the rest unchanged', () => each(() => {
  on();
  const keys = (l) => l.map((o) => o.part + (o.side || ''));
  const onT = TARGETS.filter((o) => C.partShown(o.part)), onFig = figureRegions().map((r) => r.part), onGen = GENITALS.filter(C.partShown);
  assert.deepEqual(keys(onT), keys(TARGETS));
  assert.ok(onFig.includes('tail') && onGen.includes('sheath'));
  assert.deepEqual(chipParts().map((c) => c.part), ['penis', 'balls', 'sheath', 'anus', 'slit', 'hips', 'head', 'tail']);
  off();
  const offT = TARGETS.filter((o) => C.partShown(o.part));
  assert.deepEqual(keys(TARGETS).filter((k) => !keys(offT).includes(k)), ['sheath', 'tail'], 'tail and sheath off the picker, nothing else');
  assert.ok(!figureRegions().some((r) => r.part === 'tail'), 'no tail on the figure');
  assert.deepEqual(GENITALS.filter(C.partShown), ['penis', 'balls', 'slit', 'anus']);
  assert.deepEqual(chipParts().map((c) => c.part), ['penis', 'balls', 'anus', 'slit', 'hips', 'head'], 'the dock chips');
  assert.deepEqual(chipParts(['tail', 'thighs']).map((c) => c.part + (c.side || '')).slice(0, 2), ['thighsl', 'thighsr'], 'a proposal of a tail is no chip');
  const head = figureRegions().find((r) => r.part === 'head'), head0 = REGIONS.find((r) => r.part === 'head');
  assert.ok(head.d.length < head0.d.length && head.deco.length < head0.deco.length, 'the head loses its animal ears and muzzle');
  assert.equal(REGIONS.length, figureRegions().length + 1, 'the stored layout itself is untouched');
}));

test('labels: paws read as feet and slit as vulva off (ids unchanged); hands stay hands', () => each(() => {
  on();
  assert.equal(partWord('paws'), 'paws'); assert.equal(partLabel('c1_paws_l'), 'Bottom L paws'); assert.equal(partWord('slit'), 'slit');
  off();
  assert.equal(partWord('paws'), 'feet'); assert.equal(partLabel('c1_paws_l'), 'Bottom L feet'); assert.equal(partLabel('c2_paws_r2'), 'Top R feet 2');
  assert.equal(partWord('slit'), 'vulva'); assert.equal(partWord('hand'), 'hand'); assert.equal(partWord('stomachbulge'), 'stomach bulge');
  assert.equal(shaftWord('c2_paws_r'), 'feet R'); assert.equal(shaftWord('c2_forearm_r'), 'forearm R');
  assert.equal(groupName({ who: 'c1', part: 'paws', side: 'l' }), 'c1_paws_l', 'the stored name never changes');
  assert.equal(C.partList(['penis', 'balls', 'hips', 'tail']), 'penis, balls, hips');
  assert.equal(C.partNote('head', ' (muzzle, mouth)'), ' (face, mouth)'); assert.equal(C.partNote('torso', ' (chest)'), ' (chest)');
}));

test('an existing project with a tail group: loads, shows "tail", tracks exactly as with the setting on', () => each(() => {
  const mask = { w: 4, h: 4, rle: [0, 6, 15, 4, 0, 6] };
  const scene = { start_ms: 0, end_ms: 4000, groups: [
    { name: 'c1_tail', who: 'c1', part: 'tail', t_ms: 500, source: 'user', mask, poly: [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5]] },
    { name: 'c1_paws_l', who: 'c1', part: 'paws', side: 'l', t_ms: 500, source: 'user', mask, poly: [[0.2, 0.2], [0.6, 0.2], [0.6, 0.6]] },
    { name: 'c2_penis', who: 'c2', part: 'penis', t_ms: 500, source: 'user', mask, poly: [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7]], knot: mask }] };
  const snap = JSON.stringify(scene);
  on(); const sent = JSON.stringify(trackGroups([scene], 0, 4000));
  assert.equal(JSON.parse(sent).length, 3);
  off(); assert.equal(JSON.stringify(trackGroups([scene], 0, 4000)), sent, 'Track sends the same groups (the sidecar sees no difference)');
  assert.equal(JSON.stringify(scene), snap, 'nothing stored is touched');
  assert.equal(partLabel('c1_tail'), 'Bottom tail', 'still shown under its own name');
  assert.ok(shownAt(scene.groups[0], 0.8), 'a painted tail group is shown');
  assert.ok(!shownAt({ name: 'c1_tail', part: 'tail', source: 'seeder', score: 0.99 }, 0.8), 'a suggested tail is held, like one below the confidence');
  assert.ok(shownAt({ name: 'c1_hips', part: 'hips', source: 'seeder', score: 0.99 }, 0.8));
  on(); assert.ok(shownAt({ name: 'c1_tail', part: 'tail', source: 'seeder', score: 0.99 }, 0.8));
}));

test('the knot is untouched: never a pickable part, the K section and knotting stay offered either way', () => each(() => {
  for (const f of [on, off]) {
    f();
    assert.ok(PARTS.includes('knot') && !PICK_PARTS.includes('knot'));
    assert.ok(C.partShown('knot') && C.partShown('penis') && C.partShown('balls'));
    assert.equal(partWord('knot'), 'knot');
    assert.ok(C.tagShown('knotting') && C.taggerShown('knot') && C.taggerShown('knotted_penis') && C.taggerShown('anal_knotting'));
    assert.deepEqual(ON_PART.knot, ['penis']);
  }
}));

test('auto-naming proposals: off drops a tail guess so the next best leads', () => each(() => {
  const blob = { part: [{ part: 'tail', p: 0.7 }, { part: 'thighs', p: 0.2 }], conf: 0.7, auto: true };
  on(); assert.deepEqual(proposalOf(blob).parts.map((x) => x.part), ['tail', 'thighs']);
  off(); assert.deepEqual(proposalOf(blob).parts.map((x) => x.part), ['thighs']);
}));

test('scene tags, tagger tags, species, Machine bodies', () => each(() => {
  const scene = { start_ms: 0, end_ms: 1000, tags: ['tailjob'], describe: { summary: { species: ['wolf'], acts: ['anal'] } } };
  const where = TAG_CATEGORIES.find((c) => c.id === 'where').tags.map((t) => t.id);
  const menu = (s) => tagItems(s, () => {}).filter((x) => x.label).map((x) => x.label);
  on();
  assert.ok(menu({ start_ms: 0, end_ms: 1000 }).includes('tail penetration'));
  assert.equal(chipsOf(scene)[0].text, 'wolf · anal');
  off();
  assert.deepEqual(C.shownTags(TAG_CATEGORIES.find((c) => c.id === 'where').tags).map((t) => t.id), where.filter((w) => w !== 'slit' && w !== 'sheath'));
  const m = menu({ start_ms: 0, end_ms: 1000 });
  for (const w of ['tail penetration', 'tailjob', 'slit', 'sheath']) assert.ok(!m.includes(w), `${w} not offered`);
  assert.ok(m.includes('anal') && m.includes('vaginal') && m.includes('footjob'));
  assert.ok(menu(scene).includes('tailjob'), 'a tag the scene has stays in its menu');
  const sug = suggestWhere({ start_ms: 0, end_ms: 1000, tags: ['penetration'] }, []).map((x) => x.id);
  assert.ok(sug.length && !sug.includes('slit') && !sug.includes('sheath'));
  assert.equal(chipsOf(scene)[0].text, 'anal', 'no species words');
  for (const t of ['tail', 'paws', 'hindpaw', 'pawpads', 'hooves', 'sheath', 'cloaca', 'genital_slit', 'tailjob', 'canine_penis', 'equine_penis', 'flared_penis']) assert.ok(!C.taggerShown(t), t);
  for (const t of ['penis', 'balls', 'anus', 'vulva', 'feet', 'butt', 'tongue', 'fellatio', 'knot', 'humanoid_penis']) assert.ok(C.taggerShown(t), t);
  assert.deepEqual(ALL_CHARACTERS.filter((c) => C.bodyShown(c.id)).map((c) => c.id), ['human']);
}));

test('rendered Groups picker: no "tail" / "paw" anywhere in its labels when off; on, as before', () => each(() => {
  const G = { groups: [{ name: 'unassigned_1' }], picker: { k: 0 }, whoSet: new Map(), who: 'c1', proposalFor: () => null, unassigned: [], app: null };
  const text = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  on();
  const fig = text(render(BodyFigure, { props: { who: 'c1' } }).body), pick = text(render(GroupsPicker, { props: { G, W: 800, H: 600 } }).body);
  assert.match(fig, /\btail\b/); assert.match(fig, /\bpaws\b/); assert.match(pick, /\bpaws\b/);
  off();
  for (const html of [render(BodyFigure, { props: { who: 'c1' } }).body, render(GroupsPicker, { props: { G, W: 800, H: 600 } }).body].map(text)) {
    const labels = [...html.matchAll(/>([^<>]+)</g), ...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]).join(' | ');
    assert.doesNotMatch(labels, /tail|paw|sheath|muzzle/i, labels);
    assert.match(labels, /\bfeet\b/); assert.match(labels, /\bvulva\b/); assert.match(labels, /\bhand\b/);
    assert.doesNotMatch(html, /data-drop-part="(tail|sheath)"/, 'no tail / sheath target');
  }
}));
