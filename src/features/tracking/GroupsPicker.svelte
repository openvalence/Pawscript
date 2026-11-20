<script>
  // The Groups tool's assign picker (paw-1mo; a rig picker since paw-h8c): a small popover at the pointer (A, right
  // click on a group, the assign-all pass, or after each stroke when the tool asks), or where the owner last dragged it
  // by its title (settings 'tracking.groups.pickerAt', stage fractions; double-click the title: back to the pointer).
  // Bottom / Top / Extra (B / T / X) on top (keys 1 / 2 / 3), the character's body below (BodyFigure: click a part; the genitals are the chip row
  // under it); parts it has in this shot already are filled. Typing filters ("ba" Enter = balls; the free ones first),
  // arrows move, Enter or a click assigns and closes (the pass: on to the next unassigned group), Esc closes (stops the
  // pass). A part dragged off the figure onto a group on the video assigns that group (the overlay's grab).
  import { WHOS, WHO_ROLE, whoName, whoShort, partLabel, partWord, splitName, isUnassigned, IGNORE, isIgnore } from './groups.js';
  import { TARGETS, keyOf } from './figure.js';
  import { groupColor, whoColor } from './colors.js';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import BodyFigure from './BodyFigure.svelte';
  import { partShown } from '../../lib/content.js';
  import Button from '../../ui/kit/Button.svelte';
  import { cmd } from '../../app/cmd.js';

  let { G, x = 0, y = 0, W = 0, H = 0, grab = null, unlessDrag = (f) => f } = $props();
  let q = $state(''), hi = $state(0), input = $state();
  const g = $derived(G.groups[G.picker?.k]);
  // the character: the group's own, else the palette's
  let who = $state('c1');
  $effect(() => { const k = G.picker?.k; if (k != null) { const own = splitName(G.groups[k]?.name).who; who = own || G.whoSet.get(G.groups[k]) || G.who; q = ''; hi = 0; } });
  const used = $derived(new Set(G.groups.filter((x) => x !== g && !isUnassigned(x)).map((x) => { const s = splitName(x.name); return s.who === who ? s.part + (s.side || '') : ''; })));
  const opts = $derived.by(() => {
    const all = TARGETS.filter((o) => partShown(o.part)).map((o) => ({ ...o, label: o.side ? `${o.side.toUpperCase()} ${partWord(o.part)}` : partWord(o.part) }));
    const has = (o) => used.has(o.part + (o.side || ''));
    const f = q.trim().toLowerCase(), hit = (o) => !f || o.part.startsWith(f) || o.label.toLowerCase().startsWith(f) || (f.length > 1 && o.label.toLowerCase().replace(' ', '').startsWith(f));
    const top = new Map((G.proposalFor(g)?.parts || []).map((x, i) => [x.part, i]));   // paw-p9ve: the model's top guesses first (the owner's choice stays one key)
    const rank = (o) => (top.has(o.part) ? top.get(o.part) : 9);
    return [...all.filter((o) => !has(o)), ...all.filter(has)].filter(hit).map((o, i) => [o, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((x) => x[0]);
  });
  $effect(() => { opts; if (hi >= opts.length) hi = Math.max(0, opts.length - 1); });
  $effect(() => { if (input && G.picker) input.focus({ preventScroll: true }); });
  let eng = $state(false);   // the highlighted part counts (pointer over it, arrows, typing): else the first one is only the default
  $effect(() => { G.picker?.k; eng = false; });
  $effect(() => { if (q.trim()) eng = true; });
  $effect(() => { const o = eng ? opts[hi] : null; G.pickHover = o ? nameOf(o) : ''; return () => { G.pickHover = ''; }; });   // the overlay previews it on the group
  const hiKey = $derived(opts[hi] ? keyOf(opts[hi].part, opts[hi].side) : '');
  const dim = $derived(q.trim() ? new Set(TARGETS.map((o) => keyOf(o.part, o.side)).filter((k) => !opts.some((o) => keyOf(o.part, o.side) === k))) : null);
  const cur = $derived.by(() => { const s = splitName(g?.name); return g && !isUnassigned(g) && s.who === who ? keyOf(s.part, s.side) : ''; });
  const pick = (o) => o && G.choose({ who, part: o.part, side: o.side });
  const hover = (k) => { eng = true; const n = opts.findIndex((o) => keyOf(o.part, o.side) === k); if (n >= 0) hi = n; };
  const nameOf = (o) => `${who}_${o.part}${o.side ? '_' + o.side : ''}`;
  const grabPart = $derived(grab ? (e, o) => grab(e, { kind: 'label', who, part: o.part, side: o.side, text: partLabel(nameOf(o)), color: groupColor(nameOf(o)) }) : null);
  function key(e) {
    const k = e.key;
    if (k === 'Escape') { G.closePicker(); }   // Space types into the filter (the Groups tool's Space scrubs, never plays)
    else if (k === 'Enter') { if (ignHit && !opts.length) G.setIgnore(!ign); else pick(opts[hi]); }
    else if (k === '1' || k === '2' || k === '3') who = WHOS[+k - 1];
    else if (k === 'ArrowDown' || k === 'ArrowRight' || (k === 'Tab' && !e.shiftKey)) hi = (hi + 1) % Math.max(1, opts.length);
    else if (k === 'ArrowUp' || k === 'ArrowLeft' || (k === 'Tab' && e.shiftKey)) hi = (hi - 1 + opts.length) % Math.max(1, opts.length);
    else { e.stopPropagation(); return; }   // typing: the filter (never the app's keys)
    if (k.startsWith('Arrow') || k === 'Tab') eng = true;
    e.preventDefault(); e.stopPropagation();
  }
  // where: the owner's place for it (stage fractions), else next to the pointer; always on the stage
  const settings = $derived(G.app?.settings);
  const saved = $derived(settings?.get?.('tracking.groups.pickerAt', null));
  let moving = $state(null);   // [left, top] stage px while its title is dragged
  let pw = $state(252), ph = $state(220);
  const clampX = (v) => Math.max(4, Math.min(W - pw - 4, v)), clampY = (v) => Math.max(4, Math.min(H - ph - 4, v));
  const left = $derived(clampX(moving ? moving[0] : Array.isArray(saved) ? saved[0] * W : x + 14));
  const top = $derived(clampY(moving ? moving[1] : Array.isArray(saved) ? saved[1] * H : y + 14));
  function move(e) {
    if (e.button !== 0) return;
    const el = e.currentTarget, ox = e.clientX - left, oy = e.clientY - top;
    el.setPointerCapture?.(e.pointerId);
    const mv = (ev) => { moving = [ev.clientX - ox, ev.clientY - oy]; };
    const up = () => {
      el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      if (moving && W && H) settings?.set?.('tracking.groups.pickerAt', [+(clampX(moving[0]) / W).toFixed(4), +(clampY(moving[1]) / H).toFixed(4)]);
      moving = null; input?.focus({ preventScroll: true });
    };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }
  const left_pass = $derived(G.picker?.pass ? G.unassigned.length : 0);
  // paw-i5qx: Ignore is one of the picker's choices (the group becomes an ignore region, as V then a stroke makes one);
  // typing "ig" + Enter picks it when no part matches
  const ign = $derived(isIgnore(g));
  const ignHit = $derived(q.trim().length > 1 && IGNORE.startsWith(q.trim().toLowerCase()));
</script>

{#if g}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="gpick" class:moving={!!moving} tabindex="-1" bind:clientWidth={pw} bind:clientHeight={ph} style:left="{left}px" style:top="{top}px" role="dialog" aria-label="Assign {partLabel(g.name)}" data-testid="groups-picker"
    onpointerdown={(e) => e.stopPropagation()} onwheel={(e) => e.stopPropagation()}>
    <div class="hd">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span class="what" style:--c={groupColor(g.name)} onpointerdown={move} ondblclick={() => settings?.set?.('tracking.groups.pickerAt', null)}
        {@attach tooltip(Array.isArray(saved) ? 'Drag to move (double-click: back to the pointer)' : 'Drag to move the picker')}><i></i>{partLabel(g.name)}</span>
      <input bind:this={input} bind:value={q} oninput={() => (hi = 0)} onkeydown={key} class="flt" placeholder="type a part" aria-label="Filter parts" spellcheck="false" autocomplete="off" />
      {#each WHOS as w, n (w)}
        <button type="button" class="whob" class:on={who === w} style:--c={whoColor(w)} onclick={() => { who = w; input?.focus(); }} aria-pressed={who === w} aria-label={whoName(w)}
          {@attach tooltip({ text: `${whoName(w)}: ${WHO_ROLE[w]}, assign their parts`, shortcut: String(n + 1) })}>{whoShort(w)}</button>
      {/each}
    </div>
    <BodyFigure {who} has={used} {cur} hi={hiKey} {dim} onhover={hover} ongrab={grabPart} onpick={(o, e) => unlessDrag(() => pick(o))(e)}>
      {#snippet extra()}
        <button type="button" class="ign" class:on={ign} class:hi={ignHit} aria-pressed={ign} data-testid="groups-pick-ignore" onclick={() => G.setIgnore(!ign)}
          {@attach tooltip(ign ? 'Ignore region · click: back to unassigned' : 'Ignore region: training blacks it out')}>{ign ? '✓ ignore' : 'ignore'}</button>
        {#if !opts.length && !ignHit}<span class="ft">no match</span>{:else if G.picker?.pass}<span class="ft">{left_pass} left</span><button type="button" class="lnk" onclick={() => G.skip()} {@attach tooltip('Leave this group unassigned, on to the next one')}>skip</button>{/if}
        {#if splitName(g.name).part === 'penis'}<button type="button" class="lnk" data-testid="groups-find-knot" onclick={() => { const k = G.picker.k; G.closePicker(); G.findKnot(k); }} {@attach tooltip({ text: 'Find a knot on this shaft (Enter keeps it)', shortcut: 'Shift+K' })}>find knot</button>{/if}
        <button type="button" class="lnk" onclick={() => G.closePicker()} {@attach tooltip({ text: G.picker?.pass ? 'Stop assigning' : 'Close the picker', shortcut: 'Esc' })}>{G.picker?.pass ? 'stop' : 'close'}</button>
      {/snippet}
    </BodyFigure>
    <!-- paw-c1m1: what the part does on the next Track, the same switches as its list row's icons (commands: searchable, Quick menu, a reason when greyed) -->
    <div class="tg" data-testid="groups-pick-toggles">
      <Button size="sm" variant="ghost" icon="ruler" {...cmd(G.app, 'tracking.groupsDepth')}>measure depth</Button>
      <Button size="sm" variant="ghost" icon="heart-rate" {...cmd(G.app, 'tracking.groupsPulse')}>spurt cue</Button>
    </div>
  </div>
{/if}

<style>
  .gpick { position: fixed; z-index: 13; width: 252px; box-sizing: border-box; display: flex; flex-direction: column; gap: 6px; padding: 7px 8px 8px; user-select: none;
    background: var(--bg-card); border: 1px solid var(--line-2); border-radius: var(--radius); color: var(--tx); font-size: var(--fs-1);
    box-shadow: var(--shadow-2); pointer-events: auto; }
  .gpick.moving { opacity: .85; }
  .hd { display: flex; align-items: center; gap: 5px; }
  .what { display: inline-flex; align-items: center; gap: 5px; color: var(--tx-hi); font-weight: 600; white-space: nowrap; cursor: move; touch-action: none; }
  .what i { width: 9px; height: 9px; border-radius: 50%; background: var(--c); }
  .flt { flex: 1; min-width: 0; font: inherit; color: var(--tx-hi); background: var(--bg-sunken); border: 1px solid var(--line-1); border-radius: var(--radius); padding: 2px 5px; outline: none; }
  .flt:focus { border-color: var(--accent, var(--line-2)); }
  .whob { font: inherit; font-weight: 700; color: var(--c); background: none; border: 1px solid var(--line-1); border-radius: var(--radius); padding: 2px 7px; cursor: pointer; }
  .whob.on { background: color-mix(in srgb, var(--c) 28%, transparent); border-color: var(--c); color: var(--tx-hi); }
  .ft { color: var(--tx-mut); font-size: .92em; white-space: nowrap; }
  .ign { font: inherit; color: var(--tx-mut); background: none; border: 1px dashed var(--line-2); border-radius: var(--radius-pill); padding: 0 7px; line-height: 17px; cursor: pointer; }
  .ign:hover, .ign.hi { color: var(--tx-hi); border-color: var(--tx-mut); }
  .ign.on { color: var(--tx-hi); border-style: solid; border-color: var(--tx-hi); background: color-mix(in srgb, var(--tx-hi) 14%, transparent); }
  .tg { display: flex; gap: 4px; flex-wrap: wrap; }
  .lnk { font: inherit; color: var(--tx-mut); background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline dotted; }
</style>
