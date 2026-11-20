// Stroke shapes: the profile of one half-stroke (one move from a turning point to the next), expressed as
// extra points inside it, because devices interpolate linearly between actions.
//
// A shape is a list of interior knots [u, v]: u = fraction of the half-stroke's time, v = fraction of its
// travel (0 = where it starts, 1 = where it ends). The knots ARE the motion; nothing is smoothed later.
//
// Shape spec (what params.shape holds):
//   'sine'                                     a name from SHAPES with its default params
//   { name: 'two-speed', ratio: 3, at: 0.4 }   a name plus params
//   { ..., dir: 'in' | 'out' }                 apply only to in-strokes (toward deep, pos falling) or out-strokes
//   { ..., prob: 0.25 }                        apply to a seeded random 25% of half-strokes (others linear)
//   { in: spec, out: spec }                    different shapes per direction
//
// Timing asymmetry between the in and the out half of a stroke ("fast in, slow out") is not a shape: it
// moves the turning point. The rate-driven generators take `inFrac` for it (see generators.js).

const sampled = (n, f) => Array.from({ length: n }, (_, i) => { const u = (i + 1) / (n + 1); return [u, f(u)]; });
const P = (key, label, dflt, min, max, step) => ({ key, label, type: 'number', default: dflt, min, max, step });

/** The vocabulary. Edit freely: { label, params: schema, knots(params, dir) -> [[u, v], ...] }. */
export const SHAPES = {
  linear: { label: 'Linear', params: [], knots: () => [] },
  sine: {
    label: 'Sine (ease in and out)',
    params: [P('samples', 'Points per half-stroke', 3, 1, 9, 1)],
    knots: ({ samples }) => sampled(samples, (u) => (1 - Math.cos(Math.PI * u)) / 2),
  },
  'ease-in': {
    label: 'Slow start, fast arrival',
    params: [P('power', 'Strength', 2, 1, 4, 0.1), P('samples', 'Points per half-stroke', 2, 1, 9, 1)],
    knots: ({ power, samples }) => sampled(samples, (u) => Math.pow(u, power)),
  },
  'ease-out': {
    label: 'Fast start, slow arrival',
    params: [P('power', 'Strength', 2, 1, 4, 0.1), P('samples', 'Points per half-stroke', 2, 1, 9, 1)],
    knots: ({ power, samples }) => sampled(samples, (u) => 1 - Math.pow(1 - u, power)),
  },
  'two-speed': {
    // one mid-stroke point; ratio = speed before the break / speed after it (2 = fast then slow)
    label: 'Two-speed',
    params: [P('ratio', 'Speed ratio (before / after)', 2, 0.1, 10, 0.1), P('at', 'Break point (time fraction)', 0.5, 0.05, 0.95, 0.05)],
    knots: ({ ratio, at }) => [[at, (ratio * at) / (ratio * at + 1 - at)]],
  },
  bounce: {
    // arrives early, rebounds by `amount` of the travel, settles: stays inside the range
    label: 'Bounce',
    params: [P('amount', 'Rebound (fraction of travel)', 0.12, 0, 0.5, 0.01)],
    knots: ({ amount }) => [[0.7, 1], [0.85, 1 - amount]],
  },
  'hold-top': {
    label: 'Hold at top',
    params: [P('dwell', 'Dwell (fraction of half-stroke)', 0.3, 0, 0.8, 0.05)],
    knots: ({ dwell }, dir) => (dir === 'out' && dwell > 0 ? [[1 - dwell, 1]] : []),
  },
  'hold-bottom': {
    label: 'Hold at bottom',
    params: [P('dwell', 'Dwell (fraction of half-stroke)', 0.3, 0, 0.8, 0.05)],
    knots: ({ dwell }, dir) => (dir === 'in' && dwell > 0 ? [[1 - dwell, 1]] : []),
  },
  'hold-both': {
    label: 'Hold at both ends',
    params: [P('dwell', 'Dwell (fraction of half-stroke)', 0.25, 0, 0.8, 0.05)],
    knots: ({ dwell }) => (dwell > 0 ? [[1 - dwell, 1]] : []),
  },
  custom: {
    label: 'Custom knots',
    params: [{ key: 'knots', label: 'Knots [[u, v], ...]', type: 'json', default: [] }],
    knots: ({ knots }) => knots.filter(([u]) => u > 0 && u < 1).sort((a, b) => a[0] - b[0]),
  },
};

export const SHAPE_NAMES = Object.keys(SHAPES);

const LINEAR = Object.freeze({ knots: [], slope: 1, prob: 1 });

/** Peak |dv/du| of a knot list (1 for linear): how much faster than the average the fastest part moves. */
export function knotSlope(knots) {
  let prev = [0, 0], s = 1;
  for (const k of [...knots, [1, 1]]) {
    const du = k[0] - prev[0];
    if (du > 0) s = Math.max(s, Math.abs(k[1] - prev[1]) / du);
    prev = k;
  }
  return s;
}

function one(spec, dir) {
  if (spec == null) return LINEAR;
  const s = typeof spec === 'string' ? { name: spec } : spec;
  if (s.dir && s.dir !== dir) return LINEAR;
  const def = SHAPES[s.name];
  if (!def) throw new Error(`unknown shape ${JSON.stringify(s.name)}`);
  const params = {};
  for (const p of def.params) params[p.key] = s[p.key] ?? p.default;
  const knots = def.knots(params, dir);
  return knots.length ? { knots, slope: knotSlope(knots), prob: s.prob ?? 1 } : LINEAR;
}

/** spec -> { in: {knots, slope, prob}, out: {...} }  ('in' = toward deep, pos falling). */
export function resolveShape(spec) {
  if (spec && typeof spec === 'object' && !spec.name && ('in' in spec || 'out' in spec)) {
    return { in: one(spec.in, 'in'), out: one(spec.out, 'out') };
  }
  return { in: one(spec, 'in'), out: one(spec, 'out') };
}

/** Interior points of one half-stroke from (t0, p0) to (t1, p1) for a shape spec (no endpoints). */
export function strokePoints(t0, p0, t1, p1, spec) {
  if (p0 === p1) return [];
  const sh = resolveShape(spec)[p1 < p0 ? 'in' : 'out'];
  return sh.knots.map(([u, v]) => ({ at: t0 + u * (t1 - t0), pos: p0 + v * (p1 - p0) }));
}
