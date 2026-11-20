// The kit's pure parts: placement, keyboard navigation, typeahead, shortcut display, number maths, the
// virtual-list window, split clamping and the param schema.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { place } from '../src/ui/kit/position.js';
import { nextIndex, createTypeahead } from '../src/ui/kit/focus.js';
import { formatShortcut, shortcutText, parseShortcut } from '../src/ui/kit/keys.js';
import { snap, nudge, scrub, parseNumber, formatNumber, decimalsOf, windowRange, scrollToRow, clampSplit, fraction } from '../src/ui/kit/math.js';
import { coerce, defaultsOf, normalizeValues, groupsOf, stepOf, isDefault } from '../src/ui/kit/params.js';
import { series, SERIES } from '../src/ui/kit/tokens.js';
import { mayShowTip, keepTip, MAX_HOVER_MS } from '../src/ui/kit/tooltip.js';

const VP = { width: 1000, height: 800 };
const box = (x, y, width = 100, height = 24) => ({ x, y, width, height });

test('place: below, aligned to the anchor start', () => {
  const p = place({ anchor: box(100, 100), float: { width: 200, height: 150 }, viewport: VP, placement: 'bottom-start', offset: 4 });
  assert.deepEqual([p.x, p.y, p.placement], [100, 128, 'bottom-start']);
  assert.equal(p.maxHeight, 800 - 124 - 4 - 8);
});

test('place: flips to the top when the bottom is short and the top has more room', () => {
  const p = place({ anchor: box(100, 700), float: { width: 200, height: 150 }, viewport: VP, placement: 'bottom-start', offset: 4 });
  assert.equal(p.side, 'top');
  assert.equal(p.y, 700 - 4 - 150);
});

test('place: stays on its side when neither side fits and it has more room', () => {
  const p = place({ anchor: box(100, 300), float: { width: 200, height: 700 }, viewport: VP, placement: 'bottom-start' });
  assert.equal(p.side, 'bottom');
  assert.ok(p.maxHeight < 700, 'reports the room so the caller can cap it');
});

test('place: shifts along the cross axis to stay inside the viewport', () => {
  const p = place({ anchor: box(950, 100, 40), float: { width: 200, height: 100 }, viewport: VP, placement: 'bottom-start', padding: 8 });
  assert.equal(p.x, 1000 - 200 - 8);
  const q = place({ anchor: box(-50, 100, 40), float: { width: 200, height: 100 }, viewport: VP, placement: 'bottom-end', padding: 8 });
  assert.equal(q.x, 8);
});

test('place: right side for submenus, flipping left at the edge; centred tooltips', () => {
  const sub = place({ anchor: box(850, 200, 140, 24), float: { width: 180, height: 200 }, viewport: VP, placement: 'right-start', offset: 0 });
  assert.equal(sub.side, 'left');
  assert.equal(sub.x, 850 - 180);
  assert.equal(sub.y, 200);
  const tip = place({ anchor: box(400, 400, 24, 24), float: { width: 80, height: 20 }, viewport: VP, placement: 'top', offset: 6 });
  assert.deepEqual([tip.x, tip.y, tip.placement], [372, 374, 'top']);
});

test('place: a point anchor (context menu) opens down-right, up-left near the corner', () => {
  const p = place({ anchor: { x: 990, y: 790, width: 0, height: 0 }, float: { width: 200, height: 300 }, viewport: VP, placement: 'bottom-start', offset: 0 });
  assert.equal(p.side, 'top');
  assert.equal(p.x, 792);
});

test('nextIndex: arrows, wrap, Home/End, disabled items skipped', () => {
  const dis = (i) => i === 2;
  assert.equal(nextIndex(5, 1, 'ArrowDown', { disabled: dis }), 3);
  assert.equal(nextIndex(5, 4, 'ArrowDown'), 0);
  assert.equal(nextIndex(5, 4, 'ArrowDown', { loop: false }), 4);
  assert.equal(nextIndex(5, 0, 'ArrowUp'), 4);
  assert.equal(nextIndex(5, -1, 'ArrowDown'), 0);
  assert.equal(nextIndex(5, -1, 'ArrowUp'), 4);
  assert.equal(nextIndex(5, 3, 'Home', { disabled: (i) => i === 0 }), 1);
  assert.equal(nextIndex(5, 0, 'End', { disabled: (i) => i === 4 }), 3);
  assert.equal(nextIndex(5, 0, 'ArrowRight'), null, 'horizontal keys ignored by a vertical list');
  assert.equal(nextIndex(5, 0, 'ArrowRight', { orientation: 'horizontal' }), 1);
  assert.equal(nextIndex(50, 5, 'PageDown'), 15);
  assert.equal(nextIndex(50, 45, 'PageDown'), 49);
  assert.equal(nextIndex(3, 0, 'ArrowDown', { disabled: () => true }), 0, 'all disabled: stays');
});

test('typeahead: prefix search, repeated letter cycles, buffer resets after the timeout', () => {
  let t = 0;
  const ta = createTypeahead({ now: () => t, timeout: 500 });
  const L = ['Apple', 'Banana', 'Blueberry', 'Cherry', 'Bean'];
  assert.equal(ta('b', L, 0), 1);
  t += 100; assert.equal(ta('l', L, 1), 2, '"bl" -> Blueberry');
  t += 1000; assert.equal(ta('b', L, 2), 4, 'fresh "b" after Blueberry -> Bean');
  t += 100; assert.equal(ta('b', L, 4), 1, '"bb" cycles to the next b');
  t += 1000; assert.equal(ta('z', L, 0), null);
  t += 1000; assert.equal(ta(' ', L, 0), null, 'a lone space is not a search');
  assert.equal(ta('ArrowDown', L, 0), null);
});

test('shortcuts: platform display, order, chords, aliases', () => {
  assert.deepEqual(formatShortcut('Ctrl+Shift+Z', 'pc'), [['Ctrl', 'Shift', 'Z']]);
  assert.deepEqual(formatShortcut('Shift+Ctrl+z', 'pc'), [['Ctrl', 'Shift', 'Z']]);
  assert.deepEqual(formatShortcut('Ctrl+Shift+Z', 'mac'), [['⇧', '⌘', 'Z']]);
  assert.deepEqual(formatShortcut('Alt+Control+Mod+K', 'mac'), [['⌃', '⌥', '⌘', 'K']]);
  assert.deepEqual(formatShortcut('Shift+ArrowLeft', 'pc'), [['Shift', '←']]);
  assert.deepEqual(formatShortcut('Ctrl+K Ctrl+S', 'pc'), [['Ctrl', 'K'], ['Ctrl', 'S']]);
  assert.deepEqual(formatShortcut('Ctrl++', 'pc'), [['Ctrl', '+']]);
  assert.deepEqual(formatShortcut('Space', 'pc'), [['Space']]);
  assert.deepEqual(formatShortcut('Delete', 'mac'), [['⌦']]);
  assert.equal(shortcutText('Ctrl+Shift+Z', 'pc'), 'Ctrl+Shift+Z');
  assert.equal(shortcutText('Ctrl+Shift+Z', 'mac'), '⇧⌘Z');
  assert.deepEqual(parseShortcut('Cmd+Option+F1'), [{ mods: ['Ctrl', 'Alt'], key: 'F1' }]);
});

test('numbers: snap to the grid from min, clamp, no float noise', () => {
  assert.equal(snap(0.30000000000000004, { step: 0.1 }), 0.3);
  assert.equal(snap(7, { min: 1, step: 2 }), 7);
  assert.equal(snap(6, { min: 1, step: 2 }), 7, 'grid starts at min (6 is halfway, rounds up)');
  assert.equal(snap(100, { min: 0, max: 9, step: 2 }), 8, 'last grid point inside max');
  assert.equal(snap(-5, { min: 0, max: 10 }), 0);
  assert.equal(decimalsOf(0.25), 2);
  assert.equal(decimalsOf(1e-7), 7);
  assert.equal(decimalsOf(5), 0);
});

test('numbers: nudge, Shift fine x0.1, Ctrl to the next line of the snap grid, PageUp coarse x10 (Blender logic)', () => {
  const o = { min: 0, max: 100, step: 1 };
  assert.equal(nudge(5, 1, o), 6);
  assert.equal(nudge(5, -1, o, { shiftKey: true }), 4.9);
  assert.equal(nudge(5, 1, o, { coarse: true }), 15);
  assert.equal(nudge(99, 1, o, { coarse: true }), 100);
  assert.equal(nudge(5, 1, o, { ctrlKey: true }), 10, 'range 100: grid 10');
  assert.equal(nudge(10, 1, o, { ctrlKey: true }), 20);
  assert.equal(nudge(10, -1, o, { ctrlKey: true }), 0);
  assert.equal(nudge(12, 1, { min: 0, max: 50, step: 1 }, { ctrlKey: true }), 20, 'range 50: grid 10');
  assert.equal(nudge(120, 1, { min: 0, max: 1000, step: 1 }, { ctrlKey: true }), 200, 'range 1000: grid 100');
  assert.equal(nudge(5, 1, { step: 1 }, { ctrlKey: true }), 6, 'no finite range: a plain step');
  assert.equal(nudge(0.2, 1, { step: 0.1 }), 0.3);
  assert.equal(nudge(NaN, 1, o), 1);
});

test('numbers: scrub follows the pointer, coarse and fine, clamped', () => {
  const o = { min: 0, max: 100, step: 1, pxPerStep: 4 };
  assert.equal(scrub(50, 40, o), 60);
  assert.equal(scrub(50, 40, o, { shiftKey: true }), 51, 'Shift: a tenth of the rate');
  assert.equal(scrub(50, 28, o, { ctrlKey: true }), 60, 'Ctrl: onto the grid of 10');
  assert.equal(scrub(50, 2, o), 51, 'half a step rounds');
  assert.equal(scrub(0.5, 4, { step: 0.05, pxPerStep: 4 }), 0.55);
});

test('numbers: parse what people type, format for display', () => {
  assert.equal(parseNumber('12'), 12);
  assert.equal(parseNumber(' -3.5 '), -3.5);
  assert.equal(parseNumber('1,5'), 1.5);
  assert.equal(parseNumber('−2'), -2);
  assert.equal(parseNumber('40 ms'), 40);
  assert.equal(parseNumber('.5'), 0.5);
  assert.equal(parseNumber('+7'), 7);
  assert.ok(Number.isNaN(parseNumber('2+2')), 'no expressions');
  assert.ok(Number.isNaN(parseNumber('')));
  assert.ok(Number.isNaN(parseNumber('abc')));
  assert.equal(formatNumber(1.5, { step: 0.01 }), '1.50');
  assert.equal(formatNumber(-0.0001, { step: 0.1 }), '0.0');
  assert.equal(formatNumber(NaN), '');
  assert.equal(fraction(25, 0, 100), 0.25);
  assert.equal(fraction(5, 5, 5), 0);
});

test('virtual window: only visible rows plus overscan, 100 000 rows', () => {
  assert.deepEqual(windowRange(0, 240, 24, 100000, 5), { start: 0, end: 16 });
  const r = windowRange(24 * 50000, 240, 24, 100000, 5);
  assert.deepEqual(r, { start: 49995, end: 50016 });
  assert.deepEqual(windowRange(24 * 99995, 240, 24, 100000, 5), { start: 99990, end: 100000 });
  assert.deepEqual(windowRange(0, 240, 24, 0), { start: 0, end: 0 });
  assert.equal(scrollToRow(20, 0, 240, 24), 24 * 21 - 240);
  assert.equal(scrollToRow(2, 240, 240, 24), 48);
  assert.equal(scrollToRow(12, 240, 240, 24), 240);
});

test('split: both panes keep their minimums', () => {
  assert.equal(clampSplit(50, { min: 120, total: 1000 }), 120);
  assert.equal(clampSplit(950, { min: 120, minOther: 200, total: 1000 }), 800);
  assert.equal(clampSplit(500, { min: 120, max: 400, total: 1000 }), 400);
  assert.equal(clampSplit(100, { min: 120, minOther: 200, total: 250 }), 120, 'min wins when space runs out');
});

const SCHEMA = [
  { key: 'speed', label: 'Speed', type: 'float', default: 1.25, min: 0.25, max: 4, step: 0.05, unit: '×', group: 'Timing' },
  { key: 'count', label: 'Count', type: 'int', default: 4, min: 1, max: 16, group: 'Timing' },
  { key: 'invert', label: 'Invert', type: 'bool', default: false },
  { key: 'shape', label: 'Shape', type: 'choice', default: 'sine', choices: ['sine', 'saw', { value: 'sq', label: 'Square' }], group: 'Shape' },
  { key: 'depth', label: 'Depth', type: 'number', default: 50, min: 0, max: 100 },
];

test('params: coerce types, ranges and choices', () => {
  const [speed, count, invert, shape] = SCHEMA;
  assert.equal(coerce(speed, 9), 4);
  assert.equal(coerce(speed, '0.5'), 0.5);
  assert.equal(coerce(speed, 'x'), 1.25);
  assert.equal(coerce(count, 3.6), 4);
  assert.equal(coerce(count, 0), 1);
  assert.equal(coerce(invert, 'true'), true);
  assert.equal(coerce(invert, undefined), false);
  assert.equal(coerce(shape, 'sq'), 'sq');
  assert.equal(coerce(shape, 'triangle'), 'sine');
  assert.equal(stepOf(SCHEMA[4]), 1);
  assert.equal(stepOf({ type: 'float', min: 0, max: 1 }), 0.01);
  assert.equal(stepOf(count), 1);
});

test('params: defaults, normalisation keeps unknown keys, grouping in order', () => {
  assert.deepEqual(defaultsOf(SCHEMA), { speed: 1.25, count: 4, invert: false, shape: 'sine', depth: 50 });
  assert.deepEqual(normalizeValues(SCHEMA, { count: 99, extra: 'kept' }), { speed: 1.25, count: 16, invert: false, shape: 'sine', depth: 50, extra: 'kept' });
  assert.deepEqual(groupsOf(SCHEMA).map((g) => [g.name, g.params.length]), [['Timing', 2], ['', 2], ['Shape', 1]]);
  assert.equal(isDefault(SCHEMA[0], 1.25), true);
  assert.equal(isDefault(SCHEMA[0], 1.3), false);
});

test('series: eight solid, the rest dashed, cycling', () => {
  assert.equal(SERIES.slice(0, 8).every((s) => !s.dash), true);
  assert.ok(series(8).dash && series(9).dash);
  assert.ok(series(10).dash, 'the second lap is dashed');
  assert.equal(series(10).key, SERIES[0].key);
});

test('tooltip: never for touch or a held button; kept only while connected, rendered and hovered/focused', () => {
  assert.equal(mayShowTip({ pointerType: 'mouse' }), true);
  assert.equal(mayShowTip({ pointerType: 'pen' }), true);
  assert.equal(mayShowTip({ pointerType: 'touch' }), false);
  assert.equal(mayShowTip({ pointerType: 'mouse', buttons: 1 }), false);
  assert.equal(mayShowTip({ pointerType: 'mouse', pressed: true }), false);
  const ok = { connected: true, visible: true, via: 'hover', hovered: true, focused: false };
  assert.equal(keepTip(ok), true);
  assert.equal(keepTip({ ...ok, connected: false }), false, 'trigger removed');
  assert.equal(keepTip({ ...ok, visible: false }), false, 'trigger hidden');
  assert.equal(keepTip({ ...ok, hovered: false }), false, 'pointer left without a pointerleave');
  assert.equal(keepTip({ ...ok, via: 'focus', hovered: false, focused: true }), true, 'keyboard tip stays while focused');
  assert.equal(keepTip({ ...ok, via: 'focus', focused: false }), false);
  assert.equal(keepTip({ ...ok, expanded: true }), false, 'its menu or popover is open');
  assert.equal(keepTip({ ...ok, disabled: true }), false, 'the trigger became disabled (no pointerleave comes)');
  assert.equal(keepTip({ ...ok, inside: false }), false, 'the pointer is not over the trigger although :hover stuck');
  assert.equal(keepTip({ ...ok, via: 'focus', hovered: false, focused: true, inside: false }), true, 'a keyboard tip ignores the pointer');
  assert.equal(keepTip({ ...ok, idle: MAX_HOVER_MS - 1 }), true);
  assert.equal(keepTip({ ...ok, idle: MAX_HOVER_MS }), false, 'hard cap: no pointer move inside the trigger for MAX_HOVER_MS');
  assert.equal(keepTip({ ...ok, via: 'focus', hovered: false, focused: true, idle: 1e9 }), true, 'the cap is for hover tips only');
});
