<script>
  // A character's parts as a rig picker (paw-h8c): the front-facing figure (figure.js; paw-5r1: L / R = the character's own, so their L is on your right), the
  // genitals as a chip row under it, body / other after them. Every target is coloured in its part's overlay colour
  // (groupColor of who_part_side): outlined while free, filled once `has` it (assigned in this shot); body / other sit
  // in the top-left corner, the `extra` snippet in the top-right one. Reusable: no state of its own. Props: who ('c1' | 'c2' | 'x': Bottom, Top, Extra), has (Set of keyOf), cur (the key the group already is), hi (the
  // keyboard's key), dim (Set of keys the filter hides, or null), onpick({part, side}, event), onhover(key | ''),
  // ongrab(pointerdown event, {part, side}) (dragging a part off the figure), extra (a snippet).
  import { VIEW, LIMBS, figureRegions, GENITALS, EXTRA, FEATURES, SIDE_CAPTION, keyOf } from './figure.js';
  import { partWord, whoName } from './groups.js';
  import { partShown, partNote } from '../../lib/content.js';
  import { groupColor } from './colors.js';
  import { tooltip } from '../../ui/kit/tooltip.js';

  let { who = 'c1', has = new Set(), cur = '', hi = '', dim = null, onpick, onhover, ongrab, extra } = $props();
  const SIDE = { l: 'the character’s own left (on your right: the figure faces you)', r: 'the character’s own right (on your left: the figure faces you)' };
  const NOTE = { body: ': the whole character, not pinned (its points join the motion groups)', head: ' (muzzle, mouth)', torso: ' (chest, belly)', paws: ' (feet)', shoulder: ' (the upper arm)', shin: ' (the lower leg)' };
  const label = (part, side) => `${side ? side.toUpperCase() + ' ' : ''}${partWord(part)}`;
  const tip = (part, side) => `${whoName(who)} ${label(part, side)}${partNote(part, NOTE[part] || '')}${side ? ', ' + SIDE[side] : ''}${has.has(keyOf(part, side)) ? ' · assigned in this shot' : ''} · click assigns · drag onto a group`;
  const cls = (base, part, side) => { const k = keyOf(part, side); return [base, { has: has.has(k), cur: k === cur, hi: k === hi, dim: !!dim?.has(k) }]; };
  const on = (part, side) => ({
    'data-drop-part': part, 'data-drop-side': side || undefined, 'aria-label': `${whoName(who)} ${label(part, side)}`,
    style: `--c: ${groupColor(`${who}_${part}${side ? '_' + side : ''}`)}`,
    onclick: (e) => onpick?.({ part, side: side || null }, e),
    onpointerenter: () => onhover?.(keyOf(part, side)), onpointerleave: () => onhover?.(''),
    onpointerdown: (e) => ongrab?.(e, { part, side: side || null }),
  });
</script>

<div class="fig" data-testid="body-figure">
  <div class="chips extra">
    {#each EXTRA as p (p)}<button type="button" class={cls('chip', p)} {...on(p)} {@attach tooltip(tip(p))}>{p}{has.has(p) ? ' ✓' : ''}</button>{/each}
  </div>
  {#if extra}<div class="corner">{@render extra()}</div>{/if}
  <svg viewBox="0 0 {VIEW[0]} {VIEW[1]}" width={VIEW[0]} height={VIEW[1]} role="group" aria-label="{whoName(who)}'s body">
    <g class="limbs" aria-hidden="true">{#each LIMBS as d (d)}<path {d} />{/each}</g>
    {#each figureRegions() as r (keyOf(r.part, r.side))}
      <g role="button" tabindex="-1" class={cls('rg', r.part, r.side)} {...on(r.part, r.side)} {@attach tooltip(tip(r.part, r.side))}>
        <rect class="hit" x={r.hit[0]} y={r.hit[1]} width={r.hit[2]} height={r.hit[3]} rx="5" />
        {#each r.d as d (d)}<path class="sh" {d} />{/each}
        {#each r.deco || [] as x (x.d)}<path class={x.k} d={x.d} />{/each}
        {#if r.lbl}<text x={r.lbl[0]} y={r.lbl[1]}>{r.side.toUpperCase()}</text>{/if}
        <text class="nm" x={r.hit[0] + r.hit[2] / 2} y={r.hit[1] + 9}>{label(r.part, r.side)}</text>
      </g>
    {/each}
    {#each SIDE_CAPTION as c (c.side)}<text class="cap" x={c.x} y={c.y} {@attach tooltip(SIDE[c.side])}>{c.text}</text>{/each}
  </svg>
  <div class="chips gen" role="group" aria-label="Genitals">
    {#each GENITALS.filter(partShown) as p (p)}<button type="button" class={cls('chip', p)} {...on(p)} {@attach tooltip(tip(p))}>{partWord(p)}{has.has(p) ? ' ✓' : ''}</button>{/each}
  </div>
  <div class="chips gen" role="group" aria-label="Other features">
    {#each FEATURES as p (p)}<button type="button" class={cls('chip', p)} {...on(p)} {@attach tooltip(tip(p))}>{partWord(p)}{has.has(p) ? ' ✓' : ''}</button>{/each}
  </div>
</div>

<style>
  .fig { position: relative; display: flex; flex-direction: column; gap: 6px; }
  .chips.extra { position: absolute; left: 0; top: 0; flex-direction: column; align-items: stretch; }
  .corner { position: absolute; right: 0; top: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
  svg { display: block; margin: 0 auto; overflow: visible; }
  .limbs path { fill: color-mix(in srgb, var(--tx) 13%, var(--bg-card)); stroke: color-mix(in srgb, var(--tx) 30%, var(--bg-card)); stroke-width: 1; stroke-linejoin: round; pointer-events: none; }
  .rg { cursor: pointer; outline: none; }
  .rg .hit { fill: transparent; stroke: none; pointer-events: all; }
  .rg:hover .hit, .rg.hi .hit { fill: color-mix(in srgb, var(--c) 16%, transparent); stroke: var(--tx-hi); stroke-width: 1; stroke-dasharray: 3 2; }
  .rg .nm { display: none; font: 600 8.5px/1 var(--font-ui, sans-serif); fill: var(--tx-hi); text-anchor: middle; pointer-events: none; paint-order: stroke; stroke: var(--bg-card); stroke-width: 2.5px; }
  .rg:hover .nm, .rg.hi .nm { display: block; }
  .rg .sh { fill: color-mix(in srgb, var(--c) 14%, var(--bg-card)); stroke: color-mix(in srgb, var(--c) 72%, var(--tx)); stroke-width: 1.2; stroke-linejoin: round; transition: fill var(--t-quick); }
  .rg .muz { fill: color-mix(in srgb, var(--c) 30%, var(--bg-card)); stroke: none; pointer-events: none; }
  .rg .dot { fill: var(--tx-hi); stroke: none; opacity: .75; pointer-events: none; }
  .rg .line { fill: none; stroke: var(--c); stroke-width: .8; opacity: .45; pointer-events: none; }
  .rg text { font: 600 9px/1 var(--font-ui, sans-serif); fill: var(--tx-hi); text-anchor: middle; pointer-events: none; }
  .cap { font: 600 9px/1 var(--font-ui, sans-serif); fill: var(--tx-mut); text-anchor: middle; }
  .rg.has .sh { fill: color-mix(in srgb, var(--c) 72%, var(--bg-card)); }
  .rg.has .muz { fill: color-mix(in srgb, var(--c) 45%, white); }
  .rg.has .dot, .rg.has text { fill: var(--bg-card); }
  .rg:hover .sh, .rg.hi .sh { fill: color-mix(in srgb, var(--c) 45%, var(--bg-card)); stroke: var(--tx-hi); stroke-width: 1.8; }
  .rg.has:hover .sh, .rg.has.hi .sh { fill: color-mix(in srgb, var(--c) 85%, white); }
  .rg.cur .sh { stroke: var(--tx-hi); stroke-width: 1.8; stroke-dasharray: 3 2; }
  .rg.dim, .chip.dim { opacity: .22; }
  .chips { display: flex; gap: 3px; align-items: center; }
  .chips.gen { justify-content: center; }
  .chip { font: inherit; color: var(--tx); background: color-mix(in srgb, var(--c) 10%, transparent); border: 1px solid color-mix(in srgb, var(--c) 72%, var(--tx)); border-radius: var(--radius-pill); padding: 2px 8px; min-height: 26px; cursor: pointer; white-space: nowrap; }
  .chips.gen .chip { flex: 1 1 auto; padding: 4px 4px; min-height: 28px; }
  .chip.has { background: color-mix(in srgb, var(--c) 72%, var(--bg-card)); color: var(--bg-card); font-weight: 600; }
  .chip:hover, .chip.hi { background: color-mix(in srgb, var(--c) 40%, transparent); color: var(--tx-hi); }
  .chip.has:hover, .chip.has.hi { background: color-mix(in srgb, var(--c) 85%, white); color: var(--bg-card); }
  .chip.cur { outline: 1px dashed var(--tx-hi); outline-offset: 1px; }
</style>
