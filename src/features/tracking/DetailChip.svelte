<script module>
  // paw-izk: Detail = a scene default, shot and area overrides (lib/detail.js), the stroke-shape model (lib/stroke-shape.js)
  import { SHAPE_NAMES, RENDER_MODEL } from '../../lib/stroke-shape.js';
  import { fmtSpan } from '../../lib/time-format.js';
  export const SHAPE_OPTIONS = [
    { value: 'turns', label: 'turns', tip: 'Turns only: two points per half-stroke, the smoothest' },
    { value: 'mid', label: '+ mid', tip: 'A midpoint where a move changes speed' },
    { value: 'hold', label: '+ mid + hold', tip: 'Midpoints, and holds where the motion dwells' },
    { value: 'render', label: 'render', tip: `Points so the device's curve follows the trace (${RENDER_MODEL})` },
    { value: 'free', label: 'free', tip: 'Every bend over a tolerance, can be jerky' },
  ];
  /** The Tracker lane's right-click on the run at shot i: the scene's and the shot's Detail as radios, Simplify. */
  export function detailMenu(tr, i) {
    if (i < 0 || !tr.deriveRun(i)) return [];
    const sc = tr.detailShown(i, 'scene'), sh = tr.detailShown(i, 'shot');
    const radios = (level, cur) => SHAPE_OPTIONS.map((o) => ({ label: SHAPE_NAMES[o.value], type: 'radio', checked: cur?.shape === o.value,
      run: () => tr.setDetailAt(i, level, { shape: o.value, sens: cur?.sens ?? 50 }) }));
    return [{ section: 'Detail · the scene' }, ...radios('scene', sc), { section: 'Detail · this shot' }, ...radios('shot', sh),
      { label: 'Shot: follow the scene', disabled: !sh?.own, run: () => tr.setDetailAt(i, 'shot', null) },
      { separator: true }, { label: 'Simplify to this detail…', run: () => tr.simplifyPreview() }];
  }
</script>

<script>
  // The Detail of the run under the current shot (paw-e82: moved here from Runs > Adjust > Strokes, the owner: "I feel
  // like it should be tied to the run in the timeline"): a chip on the Tracker lane at the shot's start, its popover the
  // scene default / shot / area override, the sensitivity, and Simplify. One undo step per change (tr.setDetailAt).
  import Button from '../../ui/kit/Button.svelte';
  import { cmd } from '../../app/cmd.js';
  import Slider from '../../ui/kit/Slider.svelte';
  import Popover from '../../ui/kit/Popover.svelte';
  import SegmentedControl from '../../ui/kit/SegmentedControl.svelte';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { shotLabel, sceneNo } from '../timeline/shots.js';
  import { freeTol } from '../../lib/stroke-shape.js';
  import { msToX, tickStep } from '../../lib/lane.js';
  import { trackingFor } from './tracking.svelte.js';

  let { app, w = 0, inline = false } = $props();   // inline (paw-unuy): in the combined lane's inspector band, not over the trace
  // svelte-ignore state_referenced_locally
  const tr = trackingFor(app);
  const i = $derived(tr.currentScene);
  const run = $derived(i >= 0 ? tr.deriveRun(i) : null);
  const SHORT = { turns: 'turns', mid: '+mid', hold: '+mid+hold', render: 'render', free: 'free' };
  const DETAIL_TIP = 'What goes between two turns. Set once for the scene; a shot or an area (the I-O range or a loop) can override it. Alike strokes get the same layout; the turns never move';
  const SIMPLIFY_TIP = 'Re-fit the points already in the script to this detail (turns kept exactly, at most one midpoint per half-stroke and one hold per turn): the selected points, else the selected shots, else this scene. Shows a gold ghost; Accept writes it (one undo step)';
  const lvl = $derived(tr.detailLevel === 'area' && !tr.detailArea(i) ? 'scene' : tr.detailLevel);
  const shown = $derived(i >= 0 ? tr.detailShown(i, lvl) : null);
  const here = $derived(i >= 0 && tr.scenes[i] ? tr.detailShown(i, 'shot') : null);   // what governs this shot
  const overrides = $derived(i >= 0 ? tr.detailOverrides(i) : []);
  const own = $derived(overrides.some((o) => o.shot === i));
  const spanText = (o) => (o.shot >= 0 ? `Shot ${shotLabel(tr.scenes, o.shot)}` : fmtSpan(o.t0, o.t1));
  const levelOptions = $derived([
    { value: 'scene', label: 'scene', tip: 'The default for every shot of this scene' },
    { value: 'shot', label: 'shot', tip: 'An override for this shot only' },
    { value: 'area', label: 'area', tip: tr.detailArea(i) ? 'An override for the range or loop' : 'Set a range (I / O) or a loop first', disabled: !tr.detailArea(i) },
  ]);
  const levelText = $derived.by(() => {
    if (i < 0) return '';
    const sn = sceneNo(tr.scenes, i) + 1, a = tr.detailArea(i);
    if (lvl === 'scene') return `Editing: scene ${sn} default`;
    if (lvl === 'shot') return `Editing: shot ${shotLabel(tr.scenes, i)} ${shown?.own ? 'override' : 'override (follows the scene now)'}`;
    return a ? `Editing: ${fmtSpan(a.t0, a.t1)} ${shown?.own ? 'override' : 'override (follows the scene now)'}` : '';
  });
  // paw-otoh: what the Detail did in the shot's ghost, in plain words: how many half-strokes got a midpoint, how many
  // turns a hold (a half-stroke = turn to turn; Free: its points per half-stroke)
  const count = $derived.by(() => {
    const g = run && tr.ghost(run.id), s = tr.scenes[i];
    if (!g || !s) return null;
    const pts = (g.script || []).filter((p) => p.at >= s.start_ms && p.at < s.end_ms), why = pts.map((p) => tr.whyAt(run, p.at));
    if (pts.length < 2) return null;
    let halves = 0, mids = 0, extra = 0, inHalf = false, mid = false;
    why.forEach((w) => {
      if (w === 'turn' || w === 'clamped') { if (inHalf) { halves++; if (mid) mids++; } inHalf = true; mid = false; }
      else if (w === 'mid' || w === 'detail' || w === 'shoulder') { mid = true; extra++; }
    });
    const turns = why.filter((w) => w === 'turn' || w === 'clamped').length, holds = why.filter((w) => w === 'hold').length, shoulders = why.filter((w) => w === 'shoulder').length;
    // paw-6t7d: the half-strokes whose shape By render had to give up to the Strokes speed cap (whys.cap, on the turn they leave)
    const wc = run.whys, capped = wc?.cap ? pts.filter((p, k) => (why[k] === 'turn' || why[k] === 'clamped') && wc.cap[wc.at.indexOf(p.at)]).length : 0;
    return { n: pts.length, halves, mids, turns, holds, extra, shoulders, capped };
  });
  const countText = $derived.by(() => {
    const c = count, sh = here?.shape;
    if (!c) return 'no points here yet';
    if (!c.halves) return `${c.n} pts, no full stroke`;
    if (sh === 'free') return `Free: ${c.extra} points between turns on ${c.halves} half-strokes`;
    if (sh === 'turns') return `Turns only: ${c.halves} half-strokes`;
    if (sh === 'render') return `By render: ${c.extra - c.shoulders} mids, ${c.shoulders} shoulders, ${c.holds} flat holds on ${c.halves} half-strokes` + (c.capped ? ` · the speed cap (Max speed in Strokes) limited the shape of ${c.capped}: the curve follows the trace only as far as the cap allows` : '');
    return `+ Midpoint on ${c.mids} of ${c.halves} half-strokes` + (sh === 'hold' ? ` · hold on ${c.holds} of ${c.turns} turns` : '');
  });
  const chipCount = $derived(count?.halves && (here?.shape === 'mid' || here?.shape === 'hold') ? ` ${count.mids}/${count.halves}` : count?.halves && here?.shape === 'render' ? ` ${count.extra + count.holds}/${count.halves}${count.capped ? ' · speed cap' : ''}` : '');
  // on the run: at the current shot's start, kept inside the lane
  // ...and clear of the lane's time labels (lib/lane.js drawLane: '30s' at a tick + 3 px, 10 px mono), which it used to cover
  let btn = $state(), open = $state(false), cw = $state(48);
  const left = $derived.by(() => {
    if (!(i >= 0 && tr.scenes[i] && w > 0)) return 2;
    const v = app.view, step = tickStep(v.span, w);
    let x = Math.max(2, msToX(v, w, tr.scenes[i].start_ms) + 2);
    for (let t = Math.ceil(v.start / step) * step; t <= v.start + v.span; t += step) {
      const l0 = Math.round(msToX(v, w, t)) + 3, l1 = l0 + 6.2 * String(step >= 1000 ? t / 1000 + 's' : t + 'ms').length;
      if (l0 > x + cw) break;
      if (l1 + 3 > x) x = l1 + 3;
    }
    return Math.min(x, Math.max(2, w - cw - 2));
  });
</script>

{#if i >= 0 && run}
  <button bind:this={btn} bind:offsetWidth={cw} class="dchip num" class:own class:inline data-testid="detail-chip" style:left={inline ? null : left + 'px'} aria-haspopup="dialog" aria-expanded={open}
    {@attach tooltip(`Detail of shot ${shotLabel(tr.scenes, i)}: ${here ? SHAPE_NAMES[here.shape] + (here.shape === 'turns' ? '' : ` ${here.sens} %`) : ''}${own ? ' (shot override)' : ''}. ${countText}. Click to set it for the scene, the shot or an area`)}
    onclick={() => (open = !open)}>{here ? SHORT[here.shape] : 'detail'}{chipCount}{own ? ' ·shot' : ''}</button>
  {#if open && btn}
    <Popover open={true} anchor={btn} label="Detail" class="dpop" onclose={() => (open = false)}>
      <div class="dt" data-testid="detail">
        <div class="row"><span class="lbl k-caps" {@attach tooltip(DETAIL_TIP)}>Detail</span>
          <span class="k-hint grow ell" data-testid="detail-level">{levelText}</span></div>
        <SegmentedControl size="sm" full label="Detail applies to" options={levelOptions} value={lvl} onchange={(v) => (tr.detailLevel = v)} />
        <SegmentedControl size="sm" full label="Detail" options={SHAPE_OPTIONS} value={shown?.shape} onchange={(v) => tr.setDetailAt(i, lvl, { shape: v, sens: shown?.sens ?? 50 })} />
        <div class="row"><span class="lbl k-caps" {@attach tooltip(shown?.shape === 'free' ? 'Higher: smaller tolerance, more points' : 'Higher: more midpoints and holds')}>Sensitivity</span>
          <Slider size="sm" full label="Detail sensitivity" min={0} max={100} step={5} value={shown?.sens ?? 50} disabled={shown?.shape === 'turns'} showValue format={(v) => (shown?.shape === 'free' ? `tol ${Math.round(freeTol(v))}` : v + ' %')}
            onchange={(v) => tr.setDetailAt(i, lvl, { shape: shown?.shape, sens: v }, { commit: false })} oncommit={(v) => tr.setDetailAt(i, lvl, { shape: shown?.shape, sens: v })} /></div>
        <div class="row"><span class="k-hint grow num" data-testid="detail-count" {@attach tooltip('What Detail did in this shot\'s ghost')}>{countText}</span>
          <Button size="sm" variant="ghost" disabled={!shown?.own} onclick={() => tr.setDetailAt(i, lvl, null)} tip={lvl === 'scene' ? 'Scene back to the default, overrides stay' : 'Remove this override'}>{lvl === 'scene' ? 'Default' : 'Clear'}</Button></div>
        {#if shown?.shape === 'free'}<p class="k-hint warn">Free keeps every bend over the tolerance: many close points can make the motion jerky.</p>{/if}
        {#if overrides.length}
          <div class="ovs" data-testid="detail-overrides">
            {#each overrides as o (o.t0 + ':' + o.t1)}
              <div class="row ov"><span class="grow ell" {@attach tooltip(`${spanText(o)}: ${SHAPE_NAMES[o.shape]}${o.shape === 'turns' ? '' : ` at ${o.sens} %`} instead of the scene default`)}>{spanText(o)} · {SHAPE_NAMES[o.shape]}{o.shape === 'turns' ? '' : ` ${o.sens} %`}</span>
                <Button size="sm" variant="ghost" onclick={() => tr.setDetailAt(i, 'area', null, { span: { t0: o.t0, t1: o.t1 } })} tip="Clear this override (back to the scene default)">×</Button></div>
            {/each}
          </div>
        {/if}
        {#if tr.simplify}
          <div class="row" data-testid="simplify-pending"><span class="k-hint grow">Simplify {tr.simplify.what}: {tr.simplify.n0} → {tr.simplify.n1} points</span>
            <Button size="sm" variant="primary" {...cmd(app, 'track.simplifyAccept', undefined, { tip: "Write the gold ghost's points into the script" })}>Use</Button>
            <Button size="sm" variant="ghost" {...cmd(app, 'track.simplifyCancel', undefined, { tip: 'Drop the preview' })}>Cancel</Button></div>
        {:else}
          <Button size="sm" full {...cmd(app, 'track.simplifyDetail', undefined, { tip: SIMPLIFY_TIP })}>Simplify to this detail</Button>
        {/if}
      </div>
    </Popover>
  {/if}
{/if}

<style>
  .dchip { position: absolute; top: 2px; z-index: 2; padding: 0 5px; border-radius: var(--radius); color: var(--tx-mut); background: var(--line-1); font: var(--fs-1)/14px var(--mono); white-space: nowrap; }
  .dchip.inline { position: static; flex: none; height: 18px; font-size: var(--fs-1); line-height: 18px; }
  .dchip:hover { background: var(--line-3); color: var(--tx-hi); }
  .dchip.own { color: var(--highlight); background: rgba(var(--highlight-rgb), .18); }
  .dchip:focus-visible { outline: var(--ring-w, 2px) solid var(--focus); outline-offset: -1px; }
  .dt { display: grid; gap: var(--space-1); width: 280px; min-width: 0; }
  .row { display: flex; gap: var(--space-3); align-items: center; min-width: 0; }
  .lbl { min-width: 5.5em; flex: none; white-space: nowrap; color: var(--tx-mut); cursor: help; }   /* "SENSITIVITY" in caps is wider than 5.5em: it ran under the slider */
  .num { font-family: var(--mono); font-variant-numeric: tabular-nums; }
  p { margin: 0; }
  .warn { color: var(--warn-ink); }
  .grow { flex: 1; min-width: 0; }
  .ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ovs { display: grid; gap: 1px; }
  .ov { gap: var(--space-2); font-size: var(--fs-1); }
</style>
