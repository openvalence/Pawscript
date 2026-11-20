// paw-5zpf: keymap presets (setting keys.preset): a command's per-preset default keys, user overrides winning over both and
// surviving a switch, an old settings file (no preset) reading as blender, the NumPad's own chord before the number row's digit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Registry, presetOf } from '../src/app/commands.js';
import { numpadChord, parseKeys, fmtKeys } from '../src/app/keymap.js';

function make(settings = {}) {
  const ran = [];
  const reg = new Registry({ app: {}, getSetting: (k, d) => (k in settings ? settings[k] : d), getOverrides: () => settings['keys.overrides'] || {}, setOverrides: (o) => { settings['keys.overrides'] = o; } });
  reg.register([
    { id: 'mode.point', keys: ['1'], presetKeys: { ofs: [] }, run: () => ran.push('mode.point') },
    { id: 'point.10', keys: ['Num1'], presetKeys: { ofs: ['1', 'Num1'] }, run: () => ran.push('point.10') },
    { id: 'record', keys: ['V'], presetKeys: { ofs: ['R'] }, run: () => ran.push('record') },
    { id: 'plain', keys: ['Q'], run: () => ran.push('plain') },
  ]);
  return { reg, ran, settings };
}
const key = (code, key, mods = {}) => ({ code, key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, timeStamp: 0, preventDefault() {}, target: null, ...mods });

test('presetOf: anything unknown (an old file: none stored) is blender', () => {
  assert.equal(presetOf(undefined), 'blender');
  assert.equal(presetOf('ofs'), 'ofs');
  assert.equal(presetOf('vim'), 'blender');
});

test('defaults follow the preset; a command without presetKeys has the same keys in both', () => {
  const { reg, settings } = make();
  assert.equal(reg.preset, 'blender');
  assert.deepEqual(reg.keysFor('mode.point'), ['1']);
  assert.deepEqual(reg.keysFor('point.10'), ['Num1']);
  assert.deepEqual(reg.keysFor('record'), ['V']);
  settings['keys.preset'] = 'ofs';
  assert.deepEqual(reg.keysFor('mode.point'), []);
  assert.deepEqual(reg.keysFor('point.10'), ['1', 'Num1']);
  assert.deepEqual(reg.keysFor('record'), ['R']);
  assert.deepEqual(reg.keysFor('plain'), ['Q']);
  assert.deepEqual(reg.defaultKeys('record'), ['R']);
});

test('a user override wins over either preset and survives switching back and forth', () => {
  const { reg, settings } = make({ 'keys.overrides': { record: ['Shift+V'] } });
  assert.deepEqual(reg.keysFor('record'), ['Shift+V']);
  settings['keys.preset'] = 'ofs';
  assert.deepEqual(reg.keysFor('record'), ['Shift+V']);
  settings['keys.preset'] = 'blender';
  assert.deepEqual(settings['keys.overrides'], { record: ['Shift+V'] }, 'the stored overrides are untouched');
  reg.setKeys('record', null);
  assert.deepEqual(reg.keysFor('record'), ['V'], 'reset: the preset default');
});

test('the key map follows a preset change at the next key; the number row and the NumPad reach different commands', () => {
  const { reg, ran, settings } = make();
  reg.handleKey(key('Digit1', '1'));
  reg.handleKey(key('Numpad1', '1'));
  assert.deepEqual(ran, ['mode.point', 'point.10']);
  settings['keys.preset'] = 'ofs';
  ran.length = 0;
  reg.handleKey(key('Digit1', '1'));
  reg.handleKey(key('Numpad1', '1'));
  reg.handleKey(key('KeyR', 'r'));
  assert.deepEqual(ran, ['point.10', 'point.10', 'record']);
});

test('numpadChord / parse / show', () => {
  assert.equal(numpadChord(key('Numpad5', '5')), 'Num5');
  assert.equal(numpadChord(key('Numpad0', '0', { ctrlKey: true })), 'Ctrl+Num0');
  assert.equal(numpadChord(key('Digit5', '5')), null);
  assert.equal(parseKeys('num5'), 'Num5');
  assert.equal(fmtKeys('Num5'), 'Num5');
});
