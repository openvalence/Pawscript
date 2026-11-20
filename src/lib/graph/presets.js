// Worked preset graphs (contract §8, DESIGN §9): plain data in the graph's node/link shape with preset-local ids,
// remapped by model.js applyPreset on placement. `params` are partial (applyPreset fills defaults and fresh seeds).
// `slots` name the params integration binds from sources.list when a preset is placed:
//   'tracker'   the first ghost from a tracker      'reference'  the reference ghost
//   'run'       a tracking run (repeated 'run' slots take successive runs: the first slot the first run, …;
//               a slot with n: k takes the k-th run slot's run again, e.g. two channels of one run)
//   'axis:<id>' that axis id
// Every preset is also a test fixture: test/graph-nodes-presets.test.mjs compiles each with zero errors against the
// catalogue and evaluates it end to end on a synthetic document.
//
// PROVENANCE: the preset-as-data idea and the id remap on placement follow OpenValence/Phosphor (same owner,
// Apache-2.0) src/model/graph-presets.js and src/plugins/graph.js applyPreset (l.696).

// Column / row pitch in canvas units (multiples of GRID = 20). Rendered cards are 224 wide and up to ~223 tall
// (src.run: five outputs), so 260 × 280 leaves a 36 px wire gutter between columns and ~57 px between rows.
const X = 260, Y = 280;
const n = (id, type, col, row, params, extra = {}) => ({ id, type, x: col * X, y: row * Y, ...(params ? { params } : {}), ...extra });
const l = (from, out, to, inp) => ({ from, out, to, in: inp });
// A frame covers its cells exactly (40 px title band above the first row), so frames in adjacent cells touch but never overlap.
const frame = (id, title, c0, r0, c1, r1, color = null) => ({ id, title, x: c0 * X - 20, y: r0 * Y - 40, w: (c1 - c0 + 1) * X, h: (r1 - r0 + 1) * Y, color });

// The tracker clean-up chain shared by several presets: ghost -> micro-reversals -> savgol -> extremes only -> speed cap.
const cleanup = (row = 0, col = 0, prefix = '') => ({
  nodes: [
    n(prefix + 'src', 'src.ghost', col, row, {}, { label: 'Tracker' }),
    n(prefix + 'micro', 'edit.removeMicroReversals', col + 1, row, { threshold: 3 }),
    n(prefix + 'smooth', 'edit.smooth', col + 2, row, { method: 'savgol', window: 160 }),
    n(prefix + 'keep', 'edit.keepExtremes', col + 3, row, { minProminence: 8 }),
    n(prefix + 'cap', 'edit.capSpeed', col + 4, row, { maxSpeed: 450 }),
  ],
  links: [
    l(prefix + 'src', 'script', prefix + 'micro', 'script'),
    l(prefix + 'micro', 'script', prefix + 'smooth', 'script'),
    l(prefix + 'smooth', 'script', prefix + 'keep', 'script'),
    l(prefix + 'keep', 'script', prefix + 'cap', 'script'),
  ],
  slots: [{ node: prefix + 'src', param: 'ghost', auto: 'tracker' }],
});

const C = cleanup();

// [lo, hi] per plan kind for depth-by-kind (pos 0 = deepest)
const DEPTH_TABLE = { foreplay: [55, 95], oral: [40, 95], penetration: [0, 85], knotting: [0, 30], climax: [0, 90], orgasm: [0, 40], afterglow: [20, 90] };

export const PRESETS = [
  {
    id: 'tracker-cleanup', name: 'Tracker clean-up',
    description: 'A tracker ghost → remove micro-reversals → Savitzky–Golay smooth (160 ms) → keep extremes (prominence 8) → cap speed at 450 pos/s → stroke. The usual first pass over a raw track.',
    tags: ['tracker', 'clean', 'stroke'],
    nodes: [...C.nodes, n('out', 'out.axis', 5, 0, { axis: 'stroke' })],
    links: [...C.links, l('cap', 'script', 'out', 'script')],
    frames: [frame('f1', 'Clean-up', 0, 0, 4, 0)],
    slots: C.slots,
  },
  {
    id: 'depth-by-kind', name: 'Depth by plan kind',
    description: 'Tracker clean-up, then expand extremes (6 % of headroom) and remap every action\'s depth onto a [deep, out] range chosen by the plan segment it falls in (foreplay 55–95, oral 40–95, penetration 0–85, knotting 0–30, climax 0–90, orgasm 0–40, afterglow 20–90), crossfaded over 400 ms at segment boundaries. Edit the table on "Depth by kind".',
    tags: ['tracker', 'plan', 'depth', 'kinds', 'stroke'],
    nodes: [
      ...C.nodes,
      n('ext', 'edit.extremes', 5, 0, { amount: 6, relative: true }),
      n('plan', 'src.plan', 4, 1),
      n('range', 'spans.kindRange', 5, 1, { table: DEPTH_TABLE, default: [10, 90], fadeMs: 400 }),
      n('remap', 'amp.remap', 6, 0),
      n('out', 'out.axis', 7, 0, { axis: 'stroke' }),
    ],
    links: [
      ...C.links,
      l('cap', 'script', 'ext', 'script'),
      l('ext', 'script', 'remap', 'script'),
      l('plan', 'spans', 'range', 'spans'),
      l('range', 'lo', 'remap', 'p:lo'),
      l('range', 'hi', 'remap', 'p:hi'),
      l('remap', 'script', 'out', 'script'),
    ],
    frames: [frame('f1', 'Clean-up', 0, 0, 4, 0), frame('f2', 'Depth by kind', 4, 1, 6, 1, 'yellow')],
    slots: C.slots,
  },
  {
    id: 'mix-trackers', name: 'Mix two trackers by confidence',
    description: 'Two tracking runs blended sample by sample, each weighted by its confidence² (where one is lost the other carries), short dropouts bridged, smoothed without lag, then turned into strokes at the signal\'s extremes and speed-capped.',
    tags: ['tracker', 'run', 'confidence', 'blend', 'stroke'],
    nodes: [
      n('a', 'src.run', 0, 0, {}, { label: 'Run A' }),
      n('b', 'src.run', 0, 1, {}, { label: 'Run B' }),
      n('blend', 'sig.blend', 1, 0, { mode: 'blend', gamma: 2 }),
      n('fill', 'sig.fillGaps', 2, 0, { maxGapMs: 500, mode: 'linear' }),
      n('smooth', 'sig.smooth', 3, 0, { method: 'gaussian', windowMs: 120 }),
      n('fit', 'sig.toScript', 4, 0, { mode: 'extremes', minProminence: 4, minGapMs: 60 }),
      n('cap', 'edit.capSpeed', 5, 0, { maxSpeed: 450 }),
      n('out', 'out.axis', 6, 0, { axis: 'stroke' }),
    ],
    links: [
      l('a', 'signal', 'blend', 'a'), l('a', 'confidence', 'blend', 'ca'),
      l('b', 'signal', 'blend', 'b'), l('b', 'confidence', 'blend', 'cb'),
      l('blend', 'signal', 'fill', 'signal'), l('fill', 'signal', 'smooth', 'signal'),
      l('smooth', 'signal', 'fit', 'signal'), l('fit', 'script', 'cap', 'script'), l('cap', 'script', 'out', 'script'),
    ],
    slots: [{ node: 'a', param: 'run', auto: 'run' }, { node: 'b', param: 'run', auto: 'run' }],
  },
  {
    id: 'roll-from-phase', name: 'Roll from the stroke\'s phase',
    description: 'The stroke\'s phase (0 at the top, ½ at the bottom) drives a sine roll that peaks at the top of every stroke, 18 deep around 50 and scaled by the stroke\'s amplitude; sampled at the stroke\'s own action times plus midpoints, speed-capped, written to roll.',
    tags: ['multi-axis', 'roll', 'phase', 'derive'],
    nodes: [
      n('stroke', 'src.axis', 0, 0, { axis: 'stroke' }),
      n('phase', 'script.phase', 1, 0, { minProminence: 5 }),
      n('wave', 'sig.phaseWave', 2, 0, { shape: 'sine', cycles: 1, offset: 0.25, center: 50, depth: 18, followAmp: 1 }),
      n('at', 'sig.sampleAt', 3, 0, { also: 'mids' }),
      n('cap', 'edit.capSpeed', 4, 0, { maxSpeed: 450 }),
      n('out', 'out.axis', 5, 0, { axis: 'roll' }),
    ],
    links: [
      l('stroke', 'script', 'phase', 'script'), l('phase', 'phase', 'wave', 'phase'), l('phase', 'amp', 'wave', 'amp'),
      l('wave', 'signal', 'at', 'signal'), l('stroke', 'script', 'at', 'times'), l('at', 'script', 'cap', 'script'), l('cap', 'script', 'out', 'script'),
    ],
    slots: [{ node: 'stroke', param: 'axis', auto: 'axis:stroke' }],
  },
  {
    id: 'twist-from-phase', name: 'Twist from the stroke\'s phase',
    description: 'As "Roll from phase" but one twist swing per two strokes (cycles ½), offset ½, centred at 50: a slow alternating twist locked to the stroke rhythm.',
    tags: ['multi-axis', 'twist', 'phase', 'derive'],
    nodes: [
      n('stroke', 'src.axis', 0, 0, { axis: 'stroke' }),
      n('phase', 'script.phase', 1, 0, { minProminence: 5 }),
      n('wave', 'sig.phaseWave', 2, 0, { shape: 'sine', cycles: 0.5, offset: 0.5, center: 50, depth: 25, followAmp: 0.5 }),
      n('at', 'sig.sampleAt', 3, 0, { also: 'mids' }),
      n('cap', 'edit.capSpeed', 4, 0, { maxSpeed: 450 }),
      n('out', 'out.axis', 5, 0, { axis: 'twist' }),
    ],
    links: [
      l('stroke', 'script', 'phase', 'script'), l('phase', 'phase', 'wave', 'phase'), l('phase', 'amp', 'wave', 'amp'),
      l('wave', 'signal', 'at', 'signal'), l('stroke', 'script', 'at', 'times'), l('at', 'script', 'cap', 'script'), l('cap', 'script', 'out', 'script'),
    ],
    slots: [{ node: 'stroke', param: 'axis', auto: 'axis:stroke' }],
  },
  {
    id: 'climax-pulses', name: 'Orgasm pulses inside orgasm spans',
    description: 'Generates the owner\'s orgasm pulses (6.8 → 4.2 turns/s at the deep end) only inside plan segments of kind "orgasm" and splices them into the stroke with speed-capped 150 ms seams. Everything outside stays as it is.',
    tags: ['plan', 'orgasm', 'climax', 'generate', 'splice', 'stroke'],
    nodes: [
      n('plan', 'src.plan', 0, 1),
      n('climax', 'spans.filter', 1, 1, { kinds: ['orgasm'] }),
      n('pulses', 'gen.pulses', 2, 1, { rate: 6.8, rateEnd: 4.2, decayMs: 15000, lo: 1, hi: 34, amp: 23, ampEnd: 20 }),
      n('stroke', 'src.axis', 2, 0, { axis: 'stroke' }),
      n('splice', 'script.splice', 3, 0, { seam: 'blend', seamMs: 150, maxSpeed: 450 }),
      n('out', 'out.axis', 4, 0, { axis: 'stroke' }),
    ],
    links: [
      l('plan', 'spans', 'climax', 'spans'), l('climax', 'spans', 'pulses', 'where'),
      l('stroke', 'script', 'splice', 'base'), l('pulses', 'script', 'splice', 'insert'), l('climax', 'spans', 'splice', 'where'),
      l('splice', 'script', 'out', 'script'),
    ],
    slots: [{ node: 'stroke', param: 'axis', auto: 'axis:stroke' }],
  },
  {
    id: 'ab-smoothing', name: 'A/B two smoothing settings',
    description: 'One tracker, two smoothing chains shown side by side as ghosts (A: moving average 120 ms, sky; B: Savitzky–Golay 240 ms, orange), scored against each other (F1 of matched turns, lag), and a "Select input" to choose which one the stroke output bakes.',
    tags: ['a/b', 'compare', 'ghost', 'smooth'],
    nodes: [
      n('src', 'src.ghost', 0, 0, {}, { label: 'Tracker' }),
      n('a', 'edit.smooth', 1, 0, { method: 'moving', window: 120 }, { label: 'Smooth A' }),
      n('b', 'edit.smooth', 1, 1, { method: 'savgol', window: 240 }, { label: 'Smooth B' }),
      n('ga', 'out.ghost', 2, 0, { name: 'A: moving 120', color: 'sky' }),
      n('gb', 'out.ghost', 2, 1, { name: 'B: savgol 240', color: 'orange' }),
      n('cmp', 'an.compare', 2, 2, { tolMs: 150 }),
      n('pick', 'flow.select', 3, 0, { pick: 0 }),
      n('out', 'out.axis', 4, 0, { axis: 'stroke' }, { preview: false }),
    ],
    links: [
      l('src', 'script', 'a', 'script'), l('src', 'script', 'b', 'script'),
      l('a', 'script', 'ga', 'script'), l('b', 'script', 'gb', 'script'),
      l('b', 'script', 'cmp', 'cand'), l('a', 'script', 'cmp', 'ref'),
      l('a', 'script', 'pick', 'in0'), l('b', 'script', 'pick', 'in1'), l('pick', 'out', 'out', 'script'),
    ],
    slots: [{ node: 'src', param: 'ghost', auto: 'tracker' }],
  },
  {
    id: 'polish', name: 'Polish the stroke',
    description: 'A finishing pass over the existing stroke: simplify (tolerance 1), remove micro-reversals, enforce 50 ms minimum spacing, cap speed at 450 pos/s, quantise to the video\'s frames.',
    tags: ['polish', 'clean', 'stroke', 'device'],
    nodes: [
      n('stroke', 'src.axis', 0, 0, { axis: 'stroke' }),
      n('simplify', 'edit.simplify', 1, 0, { tolerance: 1 }),
      n('micro', 'edit.removeMicroReversals', 2, 0, { threshold: 3 }),
      n('space', 'edit.minSpacing', 3, 0, { minGapMs: 50 }),
      n('cap', 'edit.capSpeed', 4, 0, { maxSpeed: 450 }),
      n('frames', 'edit.quantize', 5, 0, { frameMs: 0 }),
      n('out', 'out.axis', 6, 0, { axis: 'stroke', mode: 'replace' }),
    ],
    links: [
      l('stroke', 'script', 'simplify', 'script'), l('simplify', 'script', 'micro', 'script'), l('micro', 'script', 'space', 'script'),
      l('space', 'script', 'cap', 'script'), l('cap', 'script', 'frames', 'script'), l('frames', 'script', 'out', 'script'),
    ],
    slots: [{ node: 'stroke', param: 'axis', auto: 'axis:stroke' }],
  },
  {
    id: 'fill-dropouts', name: 'Fill tracker dropouts',
    description: 'Where the run\'s confidence stays below 0.4 for at least half a second (lost samples count as 0), strokes are generated that follow the tracker\'s own turning-point rhythm and carry it through the gap, and spliced into the tracker\'s points.',
    tags: ['tracker', 'run', 'confidence', 'repair', 'follow'],
    nodes: [
      n('run', 'src.run', 0, 0),
      n('conf', 'sig.expr', 1, 1, { expr: 'nz(a, 0)' }, { label: 'Lost = 0' }),
      n('low', 'spans.threshold', 2, 1, { mode: 'below', level: 0.4, hysteresis: 0.05, minMs: 500, kind: 'dropout' }),
      n('turns', 'script.turns', 1, 2, { minProminence: 10 }),
      n('follow', 'gen.follow', 3, 1, { lo: 0, hi: 85, shape: 'sine' }),
      n('splice', 'script.splice', 4, 0, { seam: 'blend', seamMs: 150 }),
      n('out', 'out.axis', 5, 0, { axis: 'stroke' }),
    ],
    links: [
      l('run', 'confidence', 'conf', 'a'), l('conf', 'signal', 'low', 'signal'),
      l('run', 'points', 'turns', 'script'), l('turns', 'points', 'follow', 'turns'), l('low', 'spans', 'follow', 'where'),
      l('run', 'points', 'splice', 'base'), l('follow', 'script', 'splice', 'insert'), l('low', 'spans', 'splice', 'where'),
      l('splice', 'script', 'out', 'script'),
    ],
    slots: [{ node: 'run', param: 'run', auto: 'run' }],
  },
  {
    id: 'scene-flip-fix', name: 'Fix flipped scenes',
    description: 'Inverts the tracker\'s points inside every scene whose sign is negative (the camera flipped), so the whole track points the same way.',
    tags: ['tracker', 'run', 'scenes', 'invert', 'repair'],
    nodes: [
      n('run', 'src.run', 0, 0),
      n('flipped', 'spans.filter', 1, 1, { value: 'below', valueA: 0 }),
      n('invert', 'edit.invert', 2, 0),
      n('out', 'out.axis', 3, 0, { axis: 'stroke' }),
    ],
    links: [
      l('run', 'scenes', 'flipped', 'spans'), l('run', 'points', 'invert', 'script'), l('flipped', 'spans', 'invert', 'where'),
      l('invert', 'script', 'out', 'script'),
    ],
    slots: [{ node: 'run', param: 'run', auto: 'run' }],
  },
  {
    id: 'plan-plus-tracker', name: 'Plan inside, tracker elsewhere',
    description: 'Inside plan segments, each segment\'s recipe generates the motion (follow recipes use the tracker\'s turns); everywhere else the cleaned-up tracker is used. A one-node "Switch by spans" decides.',
    tags: ['plan', 'tracker', 'generate', 'switch', 'stroke'],
    nodes: [
      ...cleanup(0).nodes.filter((x) => x.id !== 'keep'),
      n('plan', 'src.plan', 0, 1),
      n('turns', 'script.turns', 1, 2, { minProminence: 10 }),
      n('gen', 'gen.plan', 2, 1, { maxSpeed: 450 }),
      n('switch', 'flow.switch', 5, 0, { fadeMs: 0 }),
      n('out', 'out.axis', 6, 0, { axis: 'stroke' }),
    ],
    links: [
      l('src', 'script', 'micro', 'script'), l('micro', 'script', 'smooth', 'script'), l('smooth', 'script', 'cap', 'script'),
      l('src', 'script', 'turns', 'script'), l('plan', 'spans', 'gen', 'segments'), l('turns', 'points', 'gen', 'turns'),
      l('cap', 'script', 'switch', 'a'), l('gen', 'script', 'switch', 'b'), l('plan', 'spans', 'switch', 'where'),
      l('switch', 'out', 'out', 'script'),
    ],
    slots: C.slots,
  },
  {
    id: 'tracked-effects', name: 'Tracked motion + modifiers',
    description: 'A tracker ghost with the Modifiers row laid over it (knotting, orgasm, throbbing, stroke shape ...): each modifier re-shapes the tracked strokes inside its span from their own turning points; everywhere else the tracker passes through. Written into the stroke inside the tracker\'s extent.',
    tags: ['tracker', 'modifiers', 'knot', 'orgasm', 'shape', 'stroke'],
    nodes: [
      n('src', 'src.ghost', 0, 0, {}, { label: 'Tracker' }),
      n('fx', 'src.fx', 0, 1),
      n('apply', 'fx.apply', 1, 0, { maxSpeed: 450 }),
      n('out', 'out.axis', 2, 0, { axis: 'stroke', mode: 'inside' }),
    ],
    links: [l('src', 'script', 'apply', 'script'), l('fx', 'spans', 'apply', 'where'), l('apply', 'script', 'out', 'script')],
    slots: [{ node: 'src', param: 'ghost', auto: 'tracker' }],
  },
  {
    id: 'loop-tiling', name: 'Tile a loop cycle',
    description: 'A hand-made cycle (edit the points on "Script template") repeated drift-free across the I/O range with a little seeded depth and timing variation, then spliced into the stroke with speed-capped seams.',
    tags: ['loop', 'tile', 'pattern', 'stroke'],
    nodes: [
      n('cycle', 'const.script', 0, 0, { points: [{ at: 0, pos: 95 }, { at: 180, pos: 60 }, { at: 420, pos: 5 }, { at: 620, pos: 40 }, { at: 800, pos: 95 }] }, { label: 'Cycle' }),
      n('range', 'src.range', 0, 1),
      n('tile', 'script.tile', 1, 0, { partial: 'clip', join: 'keep', variation: 0.08, jitterMs: 15 }),
      n('stroke', 'src.axis', 1, 2, { axis: 'stroke' }),
      n('splice', 'script.splice', 2, 1, { seam: 'blend', seamMs: 200 }),
      n('out', 'out.axis', 3, 1, { axis: 'stroke' }),
    ],
    links: [
      l('cycle', 'value', 'tile', 'template'), l('range', 'spans', 'tile', 'where'),
      l('stroke', 'script', 'splice', 'base'), l('tile', 'script', 'splice', 'insert'), l('range', 'spans', 'splice', 'where'),
      l('splice', 'script', 'out', 'script'),
    ],
    slots: [{ node: 'stroke', param: 'axis', auto: 'axis:stroke' }],
  },
  {
    id: 'humanise', name: 'Humanise',
    description: 'Makes a mechanical script feel hand-made: seeded timing and depth jitter on every action, stroke depth breathing slowly with smooth noise (gain 0.85–1 toward the out end), speed-capped afterwards.',
    tags: ['humanise', 'variation', 'noise', 'stroke'],
    nodes: [
      n('stroke', 'src.axis', 0, 0, { axis: 'stroke' }),
      n('human', 'edit.humanise', 1, 0, { preset: 'natural', amount: 1 }),
      n('noise', 'sig.noise', 1, 1, { smoothMs: 4000, lo: 0.85, hi: 1 }, { label: 'Depth breathing' }),
      n('gain', 'amp.gain', 2, 0, { pivot: 100 }),
      n('cap', 'edit.capSpeed', 3, 0, { maxSpeed: 450 }),
      n('out', 'out.axis', 4, 0, { axis: 'stroke' }),
    ],
    links: [
      l('stroke', 'script', 'human', 'script'), l('human', 'script', 'gain', 'script'), l('noise', 'signal', 'gain', 'p:gain'),
      l('gain', 'script', 'cap', 'script'), l('cap', 'script', 'out', 'script'),
    ],
    slots: [{ node: 'stroke', param: 'axis', auto: 'axis:stroke' }],
  },
];
