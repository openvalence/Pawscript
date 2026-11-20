<!--
  TrackerDock: the slim column on the video's left edge (paw-ufv; replaces the corner HUD as the first thing a scripter
  sees). Mounted by TrackingOverlay inside the video stage while the blobs view shows a run's frame.
  - Channels: one row per channel of the run scene on show (pinned parts "Bottom penis", motion groups, still, unassigned),
    its overlay colour, and the facts to weigh it by (dock.js channelStats): a bar for how much it moves on the stroke
    axis (against the most moving one), how closely it follows the run's stroke (r), and its share of points lost when
    that is high. Click: hide / show its points on the video (settings tracking.dock.hidden); Ctrl+click: only this one
    (again: all); hover: it is highlighted on the video. With pinned parts, the motion groups (g1..g4, retired from the
    primary UI by paw-9qm) fold into one "Motion groups" row, closed by default; a run without parts lists them as rows.
  - View toggles: points, paths, part outlines, heatmap, labels, camera, axis, fusion view, info card, each a
    tracking.blobs.* setting (the options popover keeps every one of them with the opacities and the rare ones).
  - Pick a pair: two clicks on the video make a moving part / the part it moves against the shot's signal (the store's
    pair flow, paw-9qm: tr.pairPick / tr.pickPairPart; the button shows only when the store has it).
  Collapses to icons (settings tracking.dock.collapsed).
-->
<script>
  import { Icon, IconButton, Popover, ParamForm, tooltip } from '../../ui/kit/index.js';
  import { dockChannels, channelStats } from './dock.js';

  let { app, view, schema, values, onchange, onhover = () => {}, colorOf, pick = null, onpick = null } = $props();

  const collapsed = $derived(!!app.settings.get('tracking.dock.collapsed', false));
  const hidden = $derived(app.settings.get('tracking.dock.hidden', []) || []);
  const get = (k, d) => app.settings.get('tracking.blobs.' + k, d);
  // the list and its facts change with the run scene on show, not with every frame (each part a derived of its own:
  // equal values stop the update, so rows and their tooltips stay put during playback)
  const run = $derived(view?.run ?? null), fr = $derived(view?.fr ?? null), tMin = $derived(view?.tMin ?? -Infinity), tMax = $derived(view?.tMax ?? Infinity), aspect = $derived(view?.aspect ?? 16 / 9);
  const chans = $derived(fr ? dockChannels(run, fr, tMin, tMax) : []);
  const ref = $derived(run ? run.lane || run.samples : null);
  const facts = $derived.by(() => {
    const st = chans.map((c) => channelStats(run, fr, c, tMin, tMax, { aspect, ref }));
    const top = Math.max(1e-9, ...st.map((s) => (s.moves === s.moves ? s.moves : 0)));
    return st.map((s) => ({ ...s, bar: s.moves === s.moves ? Math.min(1, s.moves / top) : null }));
  });
  // paw-9qm retired g1..g4: under a run's pinned parts they fold into one row (open on a click, per session)
  const isG = (c) => c.slot >= 0 && c.slot < 4;
  const fold = $derived(chans.some((c) => c.name) && chans.some(isG));
  const firstG = $derived(chans.findIndex(isG));
  let gOpen = $state(false);
  const pct = (v) => `${Math.round(v * 100)} %`;
  function tip(c, f) {
    const bits = [c.label];
    if (f?.bar != null) bits.push(`moves ${(f.moves * 100).toFixed(1)} % of the frame height on the stroke axis`);
    if (f?.agree === f?.agree && f?.agree != null) bits.push(`follows the stroke r ${f.agree.toFixed(2)}`);
    if (f?.lost === f?.lost && f?.lost != null) bits.push(`${pct(f.lost)} of its points lost`);
    return bits.join(' · ') + ' — click: hide / show, Ctrl+click: only this';
  }
  function toggle(c, e) {
    const keys = chans.map((x) => x.key);
    let next;
    if (e.ctrlKey || e.metaKey) {
      const solo = keys.every((k) => (k === c.key) !== hidden.includes(k));   // already only this one: show all
      next = solo ? hidden.filter((k) => !keys.includes(k)) : [...hidden.filter((k) => !keys.includes(k)), ...keys.filter((k) => k !== c.key)];
    } else next = hidden.includes(c.key) ? hidden.filter((k) => k !== c.key) : [...hidden, c.key];
    app.settings.set('tracking.dock.hidden', next);
  }
  const VIEW = [
    { k: 'points', icon: 'dot', label: 'Points' },
    { k: 'trails', icon: 'history', label: 'Centre paths' },
    { k: 'seeded', icon: 'target', label: 'Part outlines' },
    { k: 'heat', icon: 'heatmap', label: 'Heatmap' },
    { k: 'labels', icon: 'flag', label: 'Labels', on: (v) => v !== 'off', set: (v) => (v === 'off' ? 'short' : 'off') },
    { k: 'camera', icon: 'film', label: 'Camera motion' },
    { k: 'axis', icon: 'axis', label: 'Stroke axis + pair' },
    { k: 'fusion', icon: 'layers', label: 'Fusion view: how each part feeds the fused stroke (when the shot uses Fused)' },
    { k: 'hud', icon: 'info', label: 'Info card: the run\'s numbers, the sidecar\'s pick and why, a sparkline' },
  ];
  const isOn = (o) => { const v = get(o.k, undefined); return o.on ? o.on(v) : !!v; };
  const flip = (o) => { const v = get(o.k, undefined); app.settings.set('tracking.blobs.' + o.k, o.set ? o.set(v) : !v); };
</script>

<div class="tdock" class:col={collapsed} data-testid="tracker-dock">
  <div class="head">
    <IconButton icon={collapsed ? 'chevron-right' : 'chevron-left'} size="sm" label={collapsed ? 'Expand the tracker dock' : 'Collapse the tracker dock to icons'} onclick={() => app.settings.set('tracking.dock.collapsed', !collapsed)} />
    {#if !collapsed}<span class="k-caps grow">Trackers</span>{/if}
    <Popover title="Tracker view options" placement="right-start">
      {#snippet trigger({ props })}<IconButton {...props} icon="sliders" size="sm" label="Tracker view options: opacity, heat, smoothing, ..." />{/snippet}
      <div class="opts"><ParamForm {schema} {values} {onchange} collapsible={false} /></div>
    </Popover>
  </div>
  <div class="chans" role="group" aria-label="Channels">
    {#each chans as c, n (c.key)}
      {@const f = facts[n]}
      {@const off = hidden.includes(c.key)}
      {#if fold && n === firstG}
        <button class="row fold" aria-expanded={gOpen} data-key="groups" onclick={() => (gOpen = !gOpen)}
          {@attach tooltip(gOpen ? 'Hide the motion group rows' : `Motion groups (${chans.filter(isG).length}), kept for old projects`)}>
          <Icon name={gOpen ? 'chevron-down' : 'chevron-right'} size={10} />
          {#if !collapsed}<span class="nm">Motion groups</span>{/if}
        </button>
      {/if}
      {#if !(fold && isG(c) && !gOpen)}
      <button class="row" class:off style:--c={colorOf(c)} data-key={c.key} aria-pressed={!off}
        onclick={(e) => toggle(c, e)} onpointerenter={() => onhover(c)} onpointerleave={() => onhover(null)} {@attach tooltip(tip(c, f))}>
        <span class="sw"></span>
        {#if !collapsed}
          <span class="nm">{c.label}</span>
          <span class="bar">{#if f?.bar != null}<i style:width="{Math.max(6, f.bar * 100)}%"></i>{/if}{#if f?.lost >= 0.15}<b style:width="{f.lost * 100}%"></b>{/if}</span>
          <span class="k-num r" class:low={f?.agree < 0.4}>{f?.agree === f?.agree && f?.agree != null ? (f.agree >= 0.995 ? '1' : f.agree.toFixed(2).slice(1)) : ''}</span>
        {/if}
      </button>
      {/if}
    {/each}
  </div>
  <div class="views">
    {#if onpick}
      <button class="tg" class:on={!!pick} aria-pressed={!!pick} onclick={onpick} {@attach tooltip({ text: pick ? 'Click the moving part, then its reference (Esc cancels)' : 'Pick a pair: the moving part, then its reference' })}><Icon name="link" /></button>
    {/if}
    {#each VIEW as o (o.k)}
      <button class="tg" class:on={isOn(o)} aria-pressed={isOn(o)} aria-label={o.label} onclick={() => flip(o)} {@attach tooltip(o.label)}><Icon name={o.icon} /></button>
    {/each}
  </div>
</div>

<style>
  .tdock { pointer-events: auto; width: 176px; display: flex; flex-direction: column; gap: var(--space-2); max-height: 100%; overflow: hidden;
    background: var(--glass); backdrop-filter: var(--glass-blur); border: var(--bw) solid var(--line-2); border-left: 0; border-radius: 0 var(--radius) var(--radius) 0; padding: var(--space-1) var(--space-2) var(--space-2); color: var(--tx); font-size: var(--fs-1); }
  .tdock.col { width: 34px; padding: var(--space-1) 2px var(--space-2); align-items: center; }
  .head { display: flex; align-items: center; gap: var(--space-1); color: var(--tx-mut); }
  .col .head { flex-direction: column; }
  .grow { flex: 1; }
  .chans { display: flex; flex-direction: column; gap: 1px; min-height: 0; overflow: hidden auto; }   /* the rows scroll, the head and the view toggles stay */
  .head, .views { flex: none; }
  .row { all: unset; box-sizing: border-box; display: grid; grid-template-columns: 10px minmax(0, 1fr) 28px 24px; align-items: center; gap: 5px; padding: 2px var(--space-1); border-radius: var(--radius); cursor: pointer; }
  .col .row { grid-template-columns: 10px; padding: 3px 6px; }
  .row:hover { background: var(--bg-hover); }
  .row.fold { grid-template-columns: 10px minmax(0, 1fr); color: var(--tx-mut); }
  .col .row.fold { grid-template-columns: 10px; }
  .row:focus-visible { outline: 2px solid var(--focus); }
  .sw { width: 10px; height: 10px; border-radius: var(--radius); background: var(--c); box-shadow: 0 0 0 1px color-mix(in srgb, var(--media-bg) 60%, transparent); }
  .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar { display: flex; flex-direction: column; gap: 1px; }
  .bar i { display: block; height: 4px; border-radius: var(--radius); background: var(--c); }
  .bar b { display: block; height: 2px; border-radius: var(--radius); background: var(--warn); }   /* its share of points lost (>= 15 %) */
  .r { text-align: right; color: var(--tx-mut); }
  .r.low { color: var(--warn); }
  .row.off .sw { background: transparent; box-shadow: inset 0 0 0 1.5px var(--c); }
  .row.off .nm, .row.off .r { color: var(--tx-faint); text-decoration: line-through; }
  .row.off .bar { opacity: .35; }
  .views { display: grid; grid-template-columns: repeat(5, 1fr); gap: 2px; border-top: 1px solid var(--line-1); padding-top: var(--space-2); }
  .col .views { grid-template-columns: 1fr; }
  .col .tg { height: 22px; width: 26px; }
  .tg { all: unset; box-sizing: border-box; display: grid; place-items: center; height: 24px; border-radius: var(--radius); color: var(--tx-mut); cursor: pointer; }
  .tg:hover { background: var(--bg-hover); color: var(--tx); }
  .tg.on { color: var(--tx-hi); background: var(--sel-bg); }
  .tg:focus-visible { outline: 2px solid var(--focus); }
  .opts { width: 300px; max-height: min(560px, 70vh); overflow: auto; }
</style>
