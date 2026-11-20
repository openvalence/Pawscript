// Edit library entry point: every operation plus the OPS catalogue the inspector builds its forms from. See README.md.
export * from './util.js';
export * from './strokes.js';
export * from './points.js';
export * from './amplitude.js';
export * from './time.js';
export * from './density.js';
export * from './speed.js';
export * from './kinematics.js';
export * from './rhythm.js';
export * from './clipboard.js';
export * from './variation.js';
export * from './select.js';

import { setPointAt, numberKey, deletePoints, movePoints, nudgeTime, nudgePos, setPos, setTime } from './points.js';
import { scale, offset, invert, remapRange, limitRange, normalise, envelope, alignExtremes, extremes } from './amplitude.js';
import { shift, stretch, fitDuration, fitToRange, reverse, rippleInsert, rippleDelete, quantize, equaliseSpacing } from './time.js';
import { simplify, thinMinGap, keepExtremes, removeMicroReversals, addMidpoints, subdivide, smooth } from './density.js';
import { capSpeed, enforceMinSpacing } from './speed.js';
import { capKinematics } from './kinematics.js';
import { BUILTIN_PROFILES } from '../analyze/profiles.js';
import { doubleTime, halfTime, changeStrokeRate, repeatLastStroke, repeatSelection } from './rhythm.js';
import { duplicate } from './clipboard.js';
import { jitter, humanise } from './variation.js';
import { grow, shrink, everyNth, selectTurns, selectBySpeed, selectSimilar, invertSelection } from './select.js';

const num = (key, label, def, min, max, step = 1, unit = '') => ({ key, label, type: 'number', default: def, min, max, step, unit });
const bool = (key, label, def) => ({ key, label, type: 'bool', default: def });
const choice = (key, label, def, choices) => ({ key, label, type: 'choice', default: def, choices });
const COLLIDE = choice('collide', 'On collision', 'moved', ['moved', 'clamp']);
const PIVOT = [choice('pivot', 'Pivot', 'center', ['center', 'top', 'bottom', 'mean', 'mid', 'custom']), num('value', 'Custom pivot', 50, 0, 100, 1)];
const MODE = choice('mode', 'Mode', 'replace', ['replace', 'merge', 'insert']);

// playhead: key of the param the UI should fill with the playhead time. selection: true = result is a new selection, script unchanged.
const op = (id, title, group, params, fn, extra = {}) => ({ id, title, group, params, apply: (script, sel, p) => fn(script, sel, { ...Object.fromEntries(params.map((q) => [q.key, q.default])), ...p }), ...extra });

export const OPS = [
  // points
  op('setPoint', 'Set point at time', 'points', [num('at', 'Time', 0, 0, 1e9, 1, 'ms'), num('pos', 'Position', 50, 0, 100), num('tolerance', 'Replace within', 0, 0, 1000, 1, 'ms'), num('frameMs', 'Snap to frame', 0, 0, 1000, 0.01, 'ms')], setPointAt, { playhead: 'at' }),
  op('numberKey', 'Number key (pos = key x 10)', 'points', [num('key', 'Key', 5, 0, 10), num('at', 'Time', 0, 0, 1e9, 1, 'ms'), num('tolerance', 'Replace within', 40, 0, 1000, 1, 'ms'), num('frameMs', 'Snap to frame', 0, 0, 1000, 0.01, 'ms')], numberKey, { playhead: 'at' }),
  op('delete', 'Delete', 'points', [], deletePoints),
  op('move', 'Move by', 'points', [num('dt', 'Time', 0, -60000, 60000, 1, 'ms'), num('dpos', 'Position', 0, -100, 100, 1), COLLIDE, num('frameMs', 'Snap to frame', 0, 0, 1000, 0.01, 'ms')], movePoints),
  op('nudgeTime', 'Nudge time', 'points', [num('frames', 'Frames', 1, -100, 100, 1), num('frameMs', 'Frame length', 1000 / 30, 1, 1000, 0.01, 'ms'), choice('collide', 'On collision', 'clamp', ['moved', 'clamp'])], nudgeTime),
  op('nudgePos', 'Nudge position', 'points', [num('amount', 'Amount', 1, -100, 100, 1)], nudgePos),
  op('setPos', 'Set position', 'points', [num('pos', 'Position', 50, 0, 100, 1)], setPos),
  op('setTime', 'Set time of first point', 'points', [num('at', 'Time', 0, 0, 1e9, 1, 'ms'), COLLIDE], setTime, { playhead: 'at' }),
  // amplitude
  op('scale', 'Scale amplitude', 'amplitude', [num('factor', 'Factor', 1, 0, 5, 0.01), ...PIVOT], scale),
  op('offset', 'Offset position', 'amplitude', [num('amount', 'Amount', 0, -100, 100, 1)], offset),
  op('invert', 'Invert (100 - pos)', 'amplitude', [], invert),
  op('remapRange', 'Remap range', 'amplitude', [num('lo', 'New low', 0, 0, 100), num('hi', 'New high', 100, 0, 100), num('trim', 'Ignore outliers', 0, 0, 49, 1, '%')], remapRange),
  op('limitRange', 'Limit range', 'amplitude', [num('lo', 'Low', 0, 0, 100), num('hi', 'High', 100, 0, 100), choice('mode', 'Mode', 'clamp', ['clamp', 'compress'])], limitRange),
  op('normalise', 'Normalise to full range', 'amplitude', [num('trim', 'Ignore outliers', 0, 0, 49, 1, '%')], normalise),
  op('envelope', 'Amplitude envelope', 'amplitude', [num('from', 'Gain at start', 1, 0, 5, 0.01), num('to', 'Gain at end', 0.5, 0, 5, 0.01), choice('curve', 'Curve', 'linear', ['linear', 'easeIn', 'easeOut', 'easeInOut', 'sine']), ...PIVOT], envelope),
  op('alignExtremes', 'Align tops / bottoms', 'amplitude', [choice('which', 'Which', 'both', ['both', 'tops', 'bottoms']), choice('to', 'To', 'value', ['value', 'mean']), num('topValue', 'Top value', 100, 0, 100), num('bottomValue', 'Bottom value', 0, 0, 100), num('strength', 'Strength', 1, 0, 1, 0.05), num('minProminence', 'Min prominence', 0, 0, 100)], alignExtremes),
  op('extremes', 'Expand / soften extremes', 'amplitude', [num('amount', 'Amount (negative softens)', 5, -50, 50, 1), choice('which', 'Which', 'both', ['both', 'tops', 'bottoms']), bool('relative', 'As % of headroom', false), num('minProminence', 'Min prominence', 0, 0, 100)], extremes),
  // time
  op('shift', 'Shift in time', 'time', [num('dt', 'Offset', 0, -600000, 600000, 1, 'ms'), COLLIDE], shift),
  op('stretch', 'Stretch in time', 'time', [num('factor', 'Factor', 1, 0.05, 20, 0.01), choice('anchor', 'Anchor', 'start', ['start', 'end', 'center', 'playhead']), num('at', 'Anchor time', 0, 0, 1e9, 1, 'ms'), COLLIDE], stretch, { playhead: 'at' }),
  op('fitDuration', 'Fit to duration', 'time', [num('duration', 'Duration', 1000, 1, 3600000, 1, 'ms'), choice('anchor', 'Anchor', 'start', ['start', 'end', 'center']), COLLIDE], fitDuration),
  op('fitToRange', 'Fit to time range', 'time', [num('t0', 'Start', 0, 0, 1e9, 1, 'ms'), num('t1', 'End', 1000, 0, 1e9, 1, 'ms'), COLLIDE], fitToRange),
  op('reverse', 'Reverse in time', 'time', [], reverse),
  op('rippleInsert', 'Insert time (ripple)', 'time', [num('at', 'At', 0, 0, 1e9, 1, 'ms'), num('duration', 'Duration', 1000, 0, 3600000, 1, 'ms')], rippleInsert, { playhead: 'at' }),
  op('rippleDelete', 'Delete time (ripple)', 'time', [], rippleDelete),
  op('quantize', 'Quantise to frames', 'time', [num('frameMs', 'Frame length', 1000 / 30, 1, 1000, 0.01, 'ms'), num('origin', 'Grid origin', 0, 0, 1000, 0.01, 'ms')], quantize),
  op('equaliseSpacing', 'Equalise spacing', 'time', [COLLIDE], equaliseSpacing),
  // density
  op('simplify', 'Simplify (RDP)', 'density', [num('tolerance', 'Tolerance', 2, 0, 50, 0.5), choice('metric', 'Metric', 'vertical', ['vertical', 'perpendicular']), num('timeScale', 'Time scale (perpendicular)', 0.1, 0.001, 10, 0.01, 'pos/ms'), bool('keepTurns', 'Keep turning points', false), num('keepProminence', 'Turn prominence', 0, 0, 100)], simplify),
  op('thinMinGap', 'Thin by minimum gap', 'density', [num('minGapMs', 'Min gap', 100, 1, 5000, 1, 'ms'), choice('keep', 'Keep', 'first', ['first', 'extreme'])], thinMinGap),
  op('keepExtremes', 'Keep extremes only', 'density', [num('minProminence', 'Min prominence', 0, 0, 100), bool('keepEnds', 'Keep ends', true)], keepExtremes),
  op('removeMicroReversals', 'Remove micro-reversals', 'density', [num('threshold', 'Threshold', 3, 1, 50)], removeMicroReversals),
  op('addMidpoints', 'Add midpoints', 'density', [num('count', 'Per segment', 1, 1, 20), num('minSegmentMs', 'Min segment', 0, 0, 10000, 1, 'ms')], addMidpoints),
  op('subdivide', 'Subdivide with easing', 'density', [num('steps', 'Points per segment', 3, 1, 50), choice('shape', 'Shape', 'sine', ['linear', 'sine', 'easeIn', 'easeOut', 'easeInOut', 'twoSpeed']), num('ratio', 'Speed ratio (two-speed)', 2, 0.1, 20, 0.1), num('split', 'Split (two-speed)', 0.5, 0.05, 0.95, 0.05), num('stepMs', 'Or spacing', 0, 0, 5000, 1, 'ms')], subdivide),
  op('smooth', 'Smooth', 'density', [choice('method', 'Method', 'moving', ['moving', 'savgol']), num('window', 'Window', 200, 20, 5000, 10, 'ms'), num('order', 'Polynomial order', 2, 1, 5), num('step', 'Resample step', 20, 5, 200, 1, 'ms'), choice('refit', 'Refit', 'times', ['times', 'simplify']), num('tolerance', 'Tolerance (simplify)', 1, 0, 20, 0.5), bool('pinEnds', 'Pin ends', true)], smooth),
  // speed
  op('capSpeed', 'Cap speed', 'speed', [num('maxSpeed', 'Max speed', 400, 10, 2000, 5, 'pos/s'), choice('method', 'Method', 'pull', ['pull', 'retime']), bool('ripple', 'Ripple (retime)', false)], capSpeed),
  op('capKinematics', 'Cap to device kinematics', 'speed', [choice('profile', 'Profile', 'nucleus-capstan', BUILTIN_PROFILES.map((p) => p.id)), num('strokeMm', 'Stroke window', 200, 50, 400, 10, 'mm'), choice('method', 'Method', 'pull', ['pull', 'retime']), bool('ripple', 'Ripple (retime)', false), num('minProminence', 'Min prominence', 3, 0, 100)], capKinematics),
  op('minSpacing', 'Enforce minimum spacing', 'speed', [num('minGapMs', 'Min gap', 50, 1, 5000, 1, 'ms'), choice('method', 'Method', 'push', ['push', 'drop']), bool('ripple', 'Ripple (push)', false), choice('keep', 'Keep (drop)', 'first', ['first', 'extreme'])], enforceMinSpacing),
  // rhythm
  op('doubleTime', 'Double time', 'rhythm', [num('factor', 'Times', 2, 2, 8), num('minProminence', 'Min prominence', 0, 0, 100)], doubleTime),
  op('halfTime', 'Half time', 'rhythm', [num('factor', 'Divide by', 2, 2, 8), choice('keep', 'Keep', 'first', ['first', 'last']), num('minProminence', 'Min prominence', 0, 0, 100)], halfTime),
  op('changeStrokeRate', 'Change stroke rate', 'rhythm', [num('factor', 'Rate factor', 2, 0.1, 8, 0.05), choice('fill', 'Fill', 'repeat', ['repeat', 'ripple', 'none']), choice('seam', 'Seam', 'next', ['next', 'prev', 'mean'])], changeStrokeRate),
  op('repeatLastStroke', 'Repeat last stroke at playhead', 'rhythm', [num('at', 'Playhead', 0, 0, 1e9, 1, 'ms'), num('count', 'Copies', 1, 1, 100), choice('shape', 'Shape', 'cycle', ['cycle', 'stroke']), choice('mode', 'Mode', 'replace', ['replace', 'merge', 'insert']), num('minProminence', 'Min prominence', 0, 0, 100)], repeatLastStroke, { playhead: 'at' }),
  op('repeatSelection', 'Repeat selection', 'rhythm', [num('count', 'Extra copies', 1, 0, 1000), num('until', 'Until (0 = off)', 0, 0, 1e9, 1, 'ms'), num('period', 'Period (0 = span)', 0, 0, 3600000, 1, 'ms'), choice('seam', 'Seam', 'next', ['next', 'prev', 'mean']), MODE], (s, sel, p) => repeatSelection(s, sel, { ...p, until: p.until > 0 ? p.until : undefined }), { playhead: 'until' }),
  op('duplicate', 'Duplicate', 'rhythm', [num('count', 'Copies', 1, 1, 100), choice('mode', 'Mode', 'merge', ['merge', 'replace', 'insert'])], duplicate),
  // variation
  op('jitter', 'Jitter', 'variation', [num('timeMs', 'Time +-', 10, 0, 500, 1, 'ms'), num('amp', 'Position +-', 2, 0, 50, 1), num('seed', 'Seed', 1, 0, 1e9), choice('distribution', 'Distribution', 'uniform', ['uniform', 'gaussian']), choice('collide', 'On collision', 'clamp', ['clamp', 'moved']), bool('keepEnds', 'Keep ends', false)], jitter),
  op('humanise', 'Humanise', 'variation', [choice('preset', 'Preset', 'natural', ['subtle', 'natural', 'loose']), num('amount', 'Amount', 1, 0, 3, 0.1), num('seed', 'Seed', 1, 0, 1e9), bool('keepEnds', 'Keep ends', true)], humanise),
  // selection helpers
  op('selectTurns', 'Select tops / bottoms', 'select', [choice('which', 'Which', 'both', ['both', 'tops', 'bottoms']), num('minProminence', 'Min prominence', 0, 0, 100)], selectTurns, { selection: true }),
  op('grow', 'Grow selection', 'select', [num('count', 'Points', 1, 1, 100), choice('side', 'Side', 'both', ['both', 'before', 'after'])], grow, { selection: true }),
  op('shrink', 'Shrink selection', 'select', [num('count', 'Points', 1, 1, 100), choice('side', 'Side', 'both', ['both', 'before', 'after'])], shrink, { selection: true }),
  op('everyNth', 'Select every Nth', 'select', [num('n', 'N', 2, 1, 100), num('offset', 'Offset', 0, 0, 100)], everyNth, { selection: true }),
  op('selectBySpeed', 'Select by speed', 'select', [num('above', 'At least', 0, 0, 5000, 5, 'pos/s'), num('below', 'At most', 5000, 0, 5000, 5, 'pos/s'), choice('basis', 'Basis', 'max', ['max', 'in', 'out'])], selectBySpeed, { selection: true }),
  op('selectSimilar', 'Select similar strokes', 'select', [num('ampTol', 'Amplitude tolerance', 10, 0, 100), num('durTolPct', 'Duration tolerance', 25, 0, 200, 1, '%')], selectSimilar, { selection: true }),
  op('invertSelection', 'Invert selection', 'select', [], invertSelection, { selection: true }),
];

const BY_ID = new Map(OPS.map((o) => [o.id, o]));
export const getOp = (id) => BY_ID.get(id);
/** Run a catalogue op by id; missing params take their catalogue defaults. */
export function runOp(id, script, sel, params) {
  const o = BY_ID.get(id);
  if (!o) throw new Error(`unknown edit op: ${id}`);
  return o.apply(script, sel, params || {});
}
