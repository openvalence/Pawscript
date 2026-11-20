// UI uniformity guard (paw-hdxk), in the spirit of the strings lint. A component draws colour from theme.css tokens and its
// buttons from the kit; the files that still hold literal colours or raw <button>s are listed with their count, and a
// count may only go down (lower it here when you clean a file). Native title= is no-native-title.test.mjs's.
//   UI_UNIFORM_PRINT=1 node --test test/ui-uniform.test.mjs   prints the current counts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'svelte/compiler';
import { trackInputModality } from '../src/ui/kit/focus.js';

const src = fileURLToPath(new URL('../src', import.meta.url));
const read = (f) => readFileSync(join(src, f), 'utf8');
const svelte = readdirSync(src, { recursive: true }).filter((f) => f.endsWith('.svelte')).map((f) => f.replace(/\\/g, '/'))
  .filter((f) => !/^ui\/kit\/_(demo|gallery)\//.test(f)).sort();
// a hex colour (not an HTML entity), or rgb()/hsl() with literal numbers; comments do not count
const COLOR = /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?)\(\s*\d/g;
const uncomment = (t) => t.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
const count = (re, f) => (uncomment(read(f)).match(re) || []).length;

// Literal colours still in components. Legitimate: canvas drawing over the picture (white guides, black wells), the
// letterbox choices (data), dev overlays, and fallbacks a canvas uses before the theme is read. New code uses tokens
// (theme.css: --media-bg / --media-scrim / --on-media for the picture's surroundings, --glass for see-through surfaces).
const COLORS = {
  'app/ClosingPanel.svelte': 2, 'app/FallbackLane.svelte': 3, 'app/Shell.svelte': 1, 'features/assist/Frame.svelte': 1,
  'features/director/AskCard.svelte': 1, 'features/director/DecisionRow.svelte': 1,
  'features/graph/GraphEditor.svelte': 1, 'features/graph/NodeCard.svelte': 2,
  'features/labelling/DatasetPicker.svelte': 1, 'features/timeline/FxLane.svelte': 1,
  'features/timeline/RangeLane.svelte': 2, 'features/timeline/Ruler.svelte': 1,
  'features/timeline/ScenesLane.svelte': 2, 'features/tracking/GroupsOverlay.svelte': 11,
  'features/tracking/ShaftStrip.svelte': 1, 'features/video/Transport.svelte': 4, 'features/video/VideoPane.svelte': 3,
};
// Raw <button>s outside the kit (custom surfaces: canvases' chips, the tab strip, list rows). New controls are kit Buttons.
const BUTTONS = {
  'app/Area.svelte': 2, 'app/Areas.svelte': 2, 'app/ProjectPage.svelte': 1, 'app/Shell.svelte': 3,
  'app/StatusBar.svelte': 1, 'app/Timeline.svelte': 2, 'app/TopBar.svelte': 3, 'app/VideoArea.svelte': 3,
  'features/assist/AssistOverlay.svelte': 4, 'features/director/AskCard.svelte': 1,
  'features/director/DecisionRow.svelte': 2, 'features/graph/GraphEditor.svelte': 5,
  'features/graph/GraphPanel.svelte': 9, 'features/graph/NodeCard.svelte': 5,
  'features/graph/NodeInspector.svelte': 15, 'features/graph/Palette.svelte': 2, 'features/graph/ParamField.svelte': 4,
  'features/history/EntriesPanel.svelte': 1, 'features/inspector/QuickPanel.svelte': 1,
  'features/inspector/SnippetsPanel.svelte': 1, 'features/inspector/ToolsPanel.svelte': 1,
  'features/labelling/DatasetPicker.svelte': 4, 'features/labelling/LabelWorkspace.svelte': 2,
  'features/machine/MachinePanel.svelte': 1, 'features/machine/ToyPicker.svelte': 4,
  'features/onboard/NextStep.svelte': 2, 'features/palette/Help.svelte': 4, 'features/palette/KeysModal.svelte': 1,
  'features/palette/KeysPanel.svelte': 15, 'features/playback/DevicePanel.svelte': 1,
  'features/timeline/CumBar.svelte': 5, 'features/timeline/FxLane.svelte': 7,
  'features/timeline/PlanInspector.svelte': 1, 'features/timeline/RangeLane.svelte': 5,
  'features/timeline/RangePolicy.svelte': 1, 'features/timeline/SceneChips.svelte': 1,
  'features/timeline/SceneQuickBar.svelte': 2, 'features/timeline/ScenesLane.svelte': 1,
  'features/tracking/AxesLine.svelte': 1, 'features/tracking/BodyFigure.svelte': 3,
  'features/tracking/CopyStrip.svelte': 1, 'features/tracking/DetailChip.svelte': 1,
  'features/tracking/FusionPanel.svelte': 8, 'features/tracking/GroupsOverlay.svelte': 27,
  'features/tracking/GroupsPicker.svelte': 5, 'features/tracking/ReferenceStrip.svelte': 3,
  'features/tracking/RunRangeStrip.svelte': 2, 'features/tracking/ScenesPanel.svelte': 4,
  'features/tracking/ShaftStrip.svelte': 6, 'features/tracking/TrackerDock.svelte': 4,
  'features/tracking/TrackerPanel.svelte': 2, 'features/tracking/TrackingLane.svelte': 24,
  'features/video/PosBar.svelte': 6, 'features/video/Sr6View.svelte': 2, 'features/video/VideoPane.svelte': 1,
};

const tally = (re, skip = () => false) => Object.fromEntries(svelte.filter((f) => !skip(f)).map((f) => [f, count(re, f)]).filter(([, n]) => n));
const over = (now, allowed) => Object.entries(now).filter(([f, n]) => n > (allowed[f] || 0)).map(([f, n]) => `${f}: ${n} (allowed ${allowed[f] || 0})`);

test('no new literal colours in components (theme.css tokens instead)', () => {
  const now = tally(COLOR);
  if (process.env.UI_UNIFORM_PRINT) console.log('COLORS', JSON.stringify(now));
  assert.deepEqual(over(now, COLORS), []);
});

test('no new raw <button> outside the kit (kit Button / IconButton / ToggleButton instead)', () => {
  const now = tally(/<button\b/g, (f) => f.startsWith('ui/kit/'));
  if (process.env.UI_UNIFORM_PRINT) console.log('BUTTONS', JSON.stringify(now));
  assert.deepEqual(over(now, BUTTONS), []);
});

test('one control height per toolbar row: every kit control in the transport and the lane toolbar is size sm', () => {
  const KIT = new Set(['Button', 'IconButton', 'ToggleButton', 'NumberField', 'TextField', 'Select', 'SegmentedControl']);
  for (const f of ['features/video/Transport.svelte', 'features/lanes/LaneToolbar.svelte']) {
    const bad = [];
    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach(walk);
      if (n.type === 'Component' && KIT.has(n.name)) {
        const size = n.attributes.find((a) => a.name === 'size');
        if (!size || size.value?.[0]?.data !== 'sm') bad.push(`${n.name} @${n.start}`);
      }
      for (const k in n) if (k !== 'parent' && typeof n[k] === 'object') walk(n[k]);
    };
    walk(parse(read(f), { modern: true }).fragment);
    assert.deepEqual(bad, [], f);
  }
});

test('popovers are see-through like the surfaces over the picture (theme.css --glass)', () => {
  const theme = read('ui/kit/theme.css');
  assert.match(theme, /--glass:\s*color-mix\(in srgb, var\(--bg-card\) 72%, transparent\)/);
  assert.match(theme, /\[data-theme='contrast'\][\s\S]*--glass:\s*var\(--bg-card\)/, 'contrast stays opaque');
  assert.match(read('ui/kit/Popover.svelte'), /\.k-popover\s*\{[^}]*background:\s*var\(--glass\)[^}]*backdrop-filter:\s*var\(--glass-blur\)/);
  for (const f of ['features/video/Hud.svelte', 'features/video/VideoPane.svelte']) assert.match(read(f), /background:\s*var\(--glass\)/, f);
});

test('no focus ring after a pointer press; one after a key that moves focus', () => {
  const ls = {};
  const win = { document: { documentElement: { dataset: {} } }, addEventListener: (t, f) => { ls[t] = f; }, removeEventListener: (t) => { delete ls[t]; } };
  const off = trackInputModality(win);
  const mode = () => win.document.documentElement.dataset.input;
  ls.pointerdown({});
  assert.equal(mode(), 'pointer');
  // Escape closes a popover and its button takes focus back; a shortcut; Space: no ring
  for (const key of ['Escape', ' ', 'g', 'Shift', 'Enter']) { ls.keydown({ key }); ls.focusin({}); ls.keyup({ key }); assert.equal(mode(), 'pointer', key); }
  ls.keydown({ key: 'ArrowLeft' }); ls.keyup({ key: 'ArrowLeft' });   // the app took the arrow (playhead): focus did not move
  assert.equal(mode(), 'pointer');
  ls.focusin({});   // a later programmatic focus, no key down
  assert.equal(mode(), 'pointer');
  ls.keydown({ key: 'Tab' }); ls.focusin({});   // a dialog's Tab moved focus
  assert.equal(mode(), 'keys');
  off();
  assert.deepEqual(Object.keys(ls), []);
  const theme = read('ui/kit/theme.css');
  assert.match(theme, /:root\[data-input='pointer'\] :focus-visible:is\(button,[^)]*\) \{ --focus: transparent; \}/);
  assert.match(theme, /:root\[data-input='pointer'\] :focus-visible:not\(input, textarea, \[contenteditable\]\) \{ outline-color: transparent; \}/);
  assert.match(read('main.js'), /trackInputModality\(\)/);
});
