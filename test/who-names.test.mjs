// paw-uzzr: c1 = Bottom, c2 = Top, x = Extra. The stored ids never change; people read one mapping (groups.js whoName).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WHOS, WHO_ROLE, whoName, whoShort, nextWho, legacyWho, splitName, groupName, partLabel, swapWho, setGroups } from '../src/features/tracking/groups.js';
import { groupColor, whoColor, WHO_BASE } from '../src/features/tracking/colors.js';
import { whoLabel, primaryHow } from '../src/lib/runs-channel.js';
import { makeLabel, parseLabel, restoreGroups } from '../src/features/labelling/labels.js';
import * as L from '../src/app/project-logic.js';
import { parse, serialize } from '../src/lib/io/index.js';

test('the display mapping: Bottom, Top, Extra; B / T / X where space is tight; roles said plainly', () => {
  assert.deepEqual(WHOS, ['c1', 'c2', 'x']);
  assert.deepEqual(WHOS.map(whoName), ['Bottom', 'Top', 'Extra']);
  assert.deepEqual(WHOS.map(whoShort), ['B', 'T', 'X']);
  assert.match(WHO_ROLE.c1, /receiving, or the only character/); assert.match(WHO_ROLE.c2, /the one giving/); assert.match(WHO_ROLE.x, /second penis, a third character, an object/);
  assert.equal(whoName('zz'), 'zz'); assert.equal(whoName(null), '');
  assert.deepEqual(['c1', 'c2', 'x', 'c1'].map(nextWho), ['c2', 'x', 'c1', 'c2'], 'the cycle');
  assert.equal(legacyWho('anus (C2) contraction'), 'anus (Top) contraction'); assert.equal(legacyWho('balls (C1)'), 'balls (Bottom)'); assert.equal(legacyWho('ABC1'), 'ABC1');
  assert.deepEqual([partLabel('c1_penis'), partLabel('c2_hand_l'), partLabel('x_tail2'), partLabel('x_paws_r')], ['Bottom penis', 'Top L hand', 'Extra tail 2', 'Extra R paws']);
  assert.deepEqual([whoLabel('who_c1_proj'), whoLabel('who_c2_proj'), whoLabel('who_x_proj'), whoLabel('who_pair_proj'), whoLabel('who_p1h2_proj'), whoLabel('who_p2h1_dist')],
    ['Bottom center', 'Top center', 'Extra center', 'Bottom ↔ Top', 'Bottom penis ↔ Top hips', 'Top penis ↔ Bottom hips dist']);
  assert.match(primaryHow('who_x_proj'), /^Extra's center/); assert.match(primaryHow('sem_x_hips_proj'), /Extra hips/);
});

test('name parsing with x: it cannot be taken for a part or a side', () => {
  assert.deepEqual(splitName('x_paws_l'), { who: 'x', part: 'paws', side: 'l' });
  assert.deepEqual(splitName('x_penis2'), { who: 'x', part: 'penis', side: null });
  assert.deepEqual(splitName('x_hips'), { who: 'x', part: 'hips', side: null });
  assert.deepEqual(splitName('c2_thighs_r3'), { who: 'c2', part: 'thighs', side: 'r' });
  for (const n of ['xpenis', 'x', 'x_', 'extra_penis', 'penis_x', 'x2_penis']) assert.equal(splitName(n).who, null, n);
  assert.deepEqual(splitName('penis2'), { who: null, part: 'penis', side: null });
  assert.equal(groupName({ who: 'x', part: 'paws', side: 'l' }), 'x_paws_l'); assert.equal(groupName({ who: 'x', part: 'penis' }), 'x_penis');
});

test('swap is Bottom <-> Top only; Extra and unassigned are untouched', () => {
  const g = (name, who) => ({ name, ...(who ? { who } : {}), part: splitName(name).part });
  assert.deepEqual(swapWho([g('c1_penis', 'c1'), g('c2_hips', 'c2'), g('x_penis', 'x'), g('hips')]).map((q) => [q.name, q.who]),
    [['c2_penis', 'c2'], ['c1_hips', 'c1'], ['x_penis', 'x'], ['hips', undefined]]);
});

test("Extra's colour family: clearly apart from Bottom's and Top's, every part its own shade", () => {
  assert.deepEqual(Object.keys(WHO_BASE), WHOS);
  assert.equal(new Set(WHOS.map(whoColor)).size, 3);
  const fam = Object.fromEntries(WHOS.map((w) => [w, ['penis', 'hips', 'balls', 'torso', 'head'].map((p) => groupColor(`${w}_${p}`))]));
  for (const a of WHOS) for (const b of WHOS) if (a < b) assert.ok(fam[a].every((c) => !fam[b].includes(c)), `${a} / ${b} share no colour`);
  assert.equal(new Set(fam.x).size, 5);
});

// -------- no raw "C1" / "C2" in what people read
const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const SKIP = ['lib/valence', 'features/machine', 'lib/analyze', 'ui/kit/icons.js', 'lib/director/README.md'];
function files(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) files(p, out); else if (/\.(js|svelte|md)$/.test(f)) out.push(p);
  }
  return out;
}
const uncomment = (t) => t.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

test('no raw "C1" / "C2" / "character 1" left in UI source outside the one mapping (comments aside)', () => {
  const bad = [];
  for (const p of files(SRC)) {
    const rel = relative(SRC, p).replace(/\\/g, '/');
    if (SKIP.some((s) => rel.startsWith(s))) continue;
    uncomment(readFileSync(p, 'utf8')).split(/\r?\n/).forEach((l, i) => {
      if (rel === 'features/tracking/groups.js' && /legacyWho = /.test(l)) return;   // the mapping itself: reads old stored text
      if (rel === 'app/fixlog.js' && /swap \(\?:C1 and C2\|Bottom and Top\)/.test(l)) return;   // an old log's phrase
      if (/\b[Cc]haracter [12]\b|\bC[12]\b/.test(l)) bad.push(`${rel}:${i + 1}: ${l.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(bad, []);
});

// -------- nothing saved breaks
const SQ = [[0.1, 0.1], [0.4, 0.1], [0.4, 0.4]];
const mask = { w: 4, h: 2, rle: [0, 4, 15, 4] };
const rows = [['c1_penis', 'c1', 'penis'], ['c2_hand_l', 'c2', 'hand', 'l'], ['x_penis', 'x', 'penis'], ['x_paws_r', 'x', 'paws', 'r'], ['x_penis2', 'x', 'penis'], ['unassigned_1']];
const groups = rows.map(([name, who, part, side]) => ({ name, ...(who ? { who, part } : {}), ...(side ? { side } : {}), poly: SQ, mask, t_ms: 5, pinned: true, source: 'user' }));
const view = (gs) => gs.map((g) => [g.name, g.who, g.part, g.side]);

test('a label file with c1_ / c2_ / x_ groups reads back unchanged (and an old one, written before Extra, too)', () => {
  const lab = makeLabel({ image: 'C:/i/a.png', key: 'i1', w: 8, h: 4, groups, now: 1 });
  const back = parseLabel(JSON.stringify(lab));
  assert.deepEqual(view(back.groups), view(groups), 'names and ids kept');
  assert.deepEqual(restoreGroups(back).map((g) => g.name), groups.map((g) => g.name));
  const old = parseLabel(JSON.stringify({ image: 'x.png', key: 'i2', groups: [{ name: 'c1_hips', who: 'c1', part: 'hips', poly: SQ, mask }, { name: 'c2_hips', who: 'c2', part: 'hips', poly: SQ, mask }] }));
  assert.deepEqual(old.groups.map((g) => g.name), ['c1_hips', 'c2_hips']);
});

test('a project with c1_ / c2_ / x_ groups saves and loads with the same names and whos', () => {
  const scenes = setGroups([{ start_ms: 0, end_ms: 10000 }], 0, groups.map((g) => ({ ...g })));
  const d = { media: null, axes: { stroke: [] }, activeAxis: 'stroke', chapters: [], bookmarks: [], loops: [], plan: [], ghosts: [], scenes, fx: [], settings: {}, project: {} };
  const at = '2026-11-13T00:00:00.000Z', text = serialize(L.projectDoc(d), { savedAt: at });
  const back = L.appDocFrom(parse(text));
  assert.deepEqual(view(back.scenes[0].groups), view(groups));
  assert.ok(!/Bottom|Top|Extra/.test(text), 'only the ids are stored');
  assert.equal(serialize(L.projectDoc({ ...d, scenes: back.scenes }), { savedAt: at }), text, 'a fixed point');
});
