// The Pawscript mark (paw-mpor): every candidate has its four sources, built on Valence's tile, the in-app glyph
// is one colour (currentColor, so it follows the theme), and the active set is one candidate's copy
// (dev/make-icons.mjs writes it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../src/assets/brand/${f}`, import.meta.url), 'utf8');
const IDS = readdirSync(new URL('../src/assets/brand/', import.meta.url)).map((f) => /^pawscript-(\w+)-app\.svg$/.exec(f)?.[1]).filter(Boolean);

test('each candidate: app/small/16 on the #111318 rounded tile, a currentColor glyph, no text, filters or gradients', () => {
  assert.deepEqual(IDS, ['r1'], 'one mark: r1');
  for (const x of IDS) {
    for (const [v, tile] of [['app', 'width="1024" height="1024" rx="225"'], ['small', 'width="30" height="30" rx="6.5"'], ['16', 'width="14" height="14" rx="3"']]) {
      const s = read(`pawscript-${x}-${v}.svg`);
      assert.ok(s.includes(`<rect ${tile} fill="#111318"/>`), `${x}-${v}: the chassis tile`);
      assert.doesNotMatch(s, /<text|<filter|Gradient|<image/, `${x}-${v}: flat vector only`);
    }
    const m = read(`pawscript-${x}-mono.svg`);
    assert.match(m, /viewBox="0 0 16 16"/);
    assert.doesNotMatch(m, /#[0-9a-f]{3,6}\b|<rect/i, `${x}-mono: no fixed colour, no tile`);
    assert.match(m, /currentColor/);
  }
});

test('the active set (what the app shows) is a copy of one candidate', () => {
  const which = IDS.filter((x) => read(`pawscript-${x}-mono.svg`) === read('pawscript-glyph.svg'));
  assert.equal(which.length, 1, 'pawscript-glyph.svg matches exactly one candidate mono');
  for (const v of ['app', 'small', '16']) assert.equal(read(`pawscript-${v}.svg`), read(`pawscript-${which[0]}-${v}.svg`), v);
});

test('the top bar and the Projects page draw the glyph, not their own inline zigzag', () => {
  for (const f of ['TopBar.svelte', 'ProjectPage.svelte']) {
    const s = readFileSync(new URL(`../src/app/${f}`, import.meta.url), 'utf8');
    assert.match(s, /pawscript-glyph\.svg\?raw/, f);
    assert.doesNotMatch(s, /L5 4 L8 10|L12 5 L22 17/, f);
  }
});
