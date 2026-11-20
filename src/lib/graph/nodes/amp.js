// Amplitude nodes (DESIGN §7 "Amplitude"): pointwise, exact per action, every number param time-varying
// (mod 'signal', read per action through ctx.param). Local with halo 0: each action maps on its own.

import { defineNode } from '../model.js';
import { clampPos } from '../../core/script.js';
import { CURVES } from '../../gen/util.js';
import { modNum, choice, script, req } from './util.js';

const G = 'Amplitude';
const base = { ins: [script('script', req)], outs: [script()], halo: () => 0, local: true, bypass: { script: 'script' } };

/** Map every action's pos through f(pos, at); actions whose pos does not change are shared. */
function mapPos(s, f) {
  const out = new Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const a = s[i], y = f(a.pos, a.at);
    if (!Number.isFinite(y)) throw new Error(`non-finite position at ${a.at} ms`);
    const pos = clampPos(y);
    out[i] = pos === a.pos ? a : { at: a.at, pos };
  }
  return out;
}

export const remap = defineNode({
  ...base, type: 'amp.remap', title: 'Remap depth', icon: 'expand', group: G,
  aliases: ['range', 'depth', 'lo hi', 'stroke length', 'scale range'],
  help: 'Maps pos 0..100 linearly onto Deep end..Out end per action. Wire signals into the ends to vary them over time (e.g. from "Depth by kind").',
  params: [modNum('lo', 'Deep end', 0, 0, 100, 1, { inline: true }), modNum('hi', 'Out end', 100, 0, 100, 1, { inline: true })],
  eval({ script: s }, _p, ctx) {
    const lo = ctx.param('lo'), hi = ctx.param('hi');
    return { script: mapPos(s, (pos, at) => { const l = lo(at); return l + (pos * (hi(at) - l)) / 100; }) };
  },
});

export const gain = defineNode({
  ...base, type: 'amp.gain', title: 'Gain', icon: 'sliders', group: G,
  aliases: ['amplify', 'scale', 'mirror', 'depth', 'invert'],
  help: 'pos = pivot + (pos − pivot) × gain. Gain −1 mirrors around the pivot.',
  params: [modNum('gain', 'Gain', 1, -5, 5, 0.01, { inline: true }), modNum('pivot', 'Pivot', 50, 0, 100, 1, { inline: true })],
  eval({ script: s }, _p, ctx) {
    const g = ctx.param('gain'), pv = ctx.param('pivot');
    return { script: mapPos(s, (pos, at) => { const c = pv(at); return c + (pos - c) * g(at); }) };
  },
});

export const offset = defineNode({
  ...base, type: 'amp.offset', title: 'Offset', icon: 'arrow-up', group: G,
  aliases: ['shift position', 'raise', 'lower', 'bias'],
  help: 'Adds an amount to every position (positive = toward out).',
  params: [modNum('amount', 'Amount', 0, -100, 100, 1, { inline: true })],
  eval({ script: s }, _p, ctx) {
    const a = ctx.param('amount');
    return { script: mapPos(s, (pos, at) => pos + a(at)) };
  },
});

export const clamp = defineNode({
  ...base, type: 'amp.clamp', title: 'Limit range', icon: 'normalize', group: G,
  aliases: ['clamp', 'limit', 'compress', 'device range'],
  help: 'Keeps positions inside Low..High: clamp cuts them off, compress squeezes 0..100 into the range.',
  params: [modNum('lo', 'Low', 0, 0, 100, 1, { inline: true }), modNum('hi', 'High', 100, 0, 100, 1, { inline: true }), choice('mode', 'Mode', 'clamp', ['clamp', 'compress'])],
  eval({ script: s }, p, ctx) {
    const lo = ctx.param('lo'), hi = ctx.param('hi');
    return { script: mapPos(s, (pos, at) => {
      let l = lo(at), h = hi(at);
      if (l > h) [l, h] = [h, l];
      return p.mode === 'compress' ? l + (pos * (h - l)) / 100 : Math.min(h, Math.max(l, pos));
    }) };
  },
});

export const curve = defineNode({
  ...base, type: 'amp.curve', title: 'Depth curve', icon: 'bezier', group: G,
  aliases: ['ease', 'gamma', 'response', 'easing'],
  help: 'Bends positions through an easing curve and a gamma (pos/100 → curve → ^gamma). Gamma > 1 spends more time deep.',
  params: [choice('curve', 'Curve', 'linear', Object.keys(CURVES).filter((c) => c !== 'step')), modNum('gamma', 'Gamma', 1, 0.1, 10, 0.05, { inline: true })],
  eval({ script: s }, p, ctx) {
    const f = CURVES[p.curve] ?? CURVES.linear, g = ctx.param('gamma');
    return { script: mapPos(s, (pos, at) => 100 * Math.pow(Math.min(1, Math.max(0, f(pos / 100))), Math.max(0.01, g(at)))) };
  },
});

export const AMP = [remap, gain, offset, clamp, curve];
