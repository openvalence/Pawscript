// Output nodes (contract §7 "out.axis", DESIGN §7 "Outputs"). `result` is exactly what bake writes (out.axis) or what
// the preview ghost shows (out.ghost). Nothing here touches the document: bake is integration's job (doc.js bakePlan).

import { defineNode } from '../model.js';
import { upsert } from '../../core/script.js';
import { clipScript } from '../types.js';
import { num, text, choice, script, req, splice } from './util.js';

const G = 'Output';

export const axis = defineNode({
  type: 'out.axis', title: 'Axis output', group: G, icon: 'export',
  aliases: ['bake', 'write', 'result', 'stroke', 'roll', 'pitch', 'twist', 'output'],
  help: 'What Bake writes to an axis. Replace: the input becomes the axis. Inside: the input replaces the axis only inside "Only inside" (or the input\'s own extent), joined over Seam. Merge: the input\'s actions are added to the axis (input wins on equal times).',
  ins: [script('script', req)], outs: [script('result')],
  perSpan: true, // the engine-added optional 'where' input
  params: [
    text('axis', 'Axis', 'stroke', { editor: 'axis', inline: true }),
    choice('mode', 'Mode', 'replace', ['replace', 'inside', 'merge']),
    num('seamMs', 'Seam', 0, 0, 2000, 10, { unit: 'ms', hint: '0: hard cut, else points near a join yield to the speed cap' }),
    num('maxSpeed', 'Seam speed cap', 450, 10, 2000, 5, { unit: 'pos/s' }),
  ],
  reads: (p) => (p.mode === 'inside' || p.mode === 'merge' ? [['axis', p.axis]] : []),
  halo: (p) => (p.mode === 'inside' ? Infinity : 0), local: true,
  bypass: { result: 'script' },
  eval({ script: s, where }, p, ctx) {
    if (!p.axis) throw new Error('pick an axis');
    if (p.mode === 'replace') return { result: s };
    let cur = ctx.read('axis', p.axis) || [];
    if (ctx.window) cur = clipScript(cur, ctx.range.t0, ctx.range.t1);
    if (p.mode === 'merge') return { result: upsert(cur, s) };
    const W = where ?? (s.length ? [{ t0: s[0].at, t1: s[s.length - 1].at + 1 }] : []);
    return { result: splice(cur, s, W, { seam: p.seamMs > 0 ? 'blend' : 'cut', seamMs: p.seamMs, maxSpeed: p.maxSpeed, minGapMs: 1, warn: (m) => ctx.warn(m) }) };
  },
});

export const ghost = defineNode({
  type: 'out.ghost', title: 'Ghost preview', group: G, icon: 'ghost',
  aliases: ['preview', 'overlay', 'compare', 'a/b', 'show'],
  help: 'Shows its input as a ghost overlay on the lanes. Preview only: never baked.',
  ins: [script('script', req)], outs: [script('result')],
  params: [text('name', 'Name', ''), text('color', 'Colour', 'pink', { editor: 'color' })],
  halo: () => 0, local: true, bypass: { result: 'script' },
  eval: ({ script: s }) => ({ result: s }),
});

export const OUTPUTS = [axis, ghost];
