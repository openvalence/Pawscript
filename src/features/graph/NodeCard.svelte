<!--
  NodeCard: one node on the canvas. Header (icon, title, diagnostics badge, status glyph, bypass, preview,
  collapse), port rows (inputs left, outputs right, sockets typed and colour-coded), inline params (scrub to
  edit; a mod param has its own socket), a sparkline of the main output over the shared time view, and a status
  line. Rows carry data-row / data-in / data-out so the editor measures socket positions (DESIGN 8.2): a card
  can never drift from its wires. Positioned by the editor (left/top in world units).
-->
<script>
  import Icon from '../../ui/kit/Icon.svelte';
  import ParamField from './ParamField.svelte';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { ICON_NAMES } from '../../ui/kit/icons.js';
  import Sparkline from './Sparkline.svelte';
  import { TYPE_COLOR, fmtNum } from './editor/plot.js';
  import { inlineParams, iconFor, titleOf, portLabel, BAKE_TEXT } from './editor/cards.js';

  let {
    node, def, ports, typeOf, inLinks, outCount, x, y, selected = false, status = null, bake = null,
    spark = null, sources = null, hints = null, armed = null, lod = false, diffOn = false, dropTarget = false,
    onparam, onprops, onsock, onhover, onseek, onbadge, measure,
  } = $props();

  const ICONS = new Set(ICON_NAMES);
  const missing = $derived(!def);
  const title = $derived(titleOf(node, def));
  const icon = $derived(iconFor(def, ICONS));
  const isOut = $derived(node.type === 'out.axis' || node.type === 'out.ghost');
  const inl = $derived(def ? inlineParams(def) : []);
  const rows = $derived.by(() => {
    const n = Math.max(ports.ins.length, ports.outs.length), out = [];
    for (let i = 0; i < n; i++) out.push({ i: ports.ins[i] || null, o: ports.outs[i] || null });
    return out;
  });
  const paramPort = (key) => ports.params.find((p) => p.name === 'p:' + key);
  // linked mod params that are not inline still get a row (their socket must exist for the wire)
  const extraLinked = $derived(ports.params.filter((p) => inLinks.has(p.name) && !inl.some((q) => 'p:' + q.key === p.name)));
  const st = $derived(status?.status || (missing ? 'error' : null));
  const errs = $derived((status?.diags || []).filter((d) => d.severity === 'error'));
  const warns = $derived((status?.diags || []).filter((d) => d.severity === 'warn'));
  const blockedBy = $derived(st === 'blocked' ? (status?.diags || []).find((d) => d.code === 'upstream') : null);
  const slow = $derived((status?.ms || 0) > 50);
  const tint = $derived(node.color ? `var(--series-${node.color})` : null);
  const badgeTip = $derived([...errs, ...warns].map((d) => (d.severity === 'error' ? '✖ ' : '▲ ') + d.message).join('\n'));
  const statusTip = { ok: 'Computed', cached: 'Cached: inputs unchanged', error: 'Error', blocked: 'Waiting on an upstream node', muted: 'Bypassed', skipped: 'Not needed by any output' };

  function key(side, port) { return `${node.id}:${side}:${port}`; }
  function sockAria(side, p) {
    const l = inLinks.get(p.name);
    return `${side === 'in' ? 'input' : 'output'} ${portLabel(p)} ${typeOf(side, p.name)}${p.required ? ' (required)' : ''}${l ? ', connected to ' + l.label : side === 'out' && outCount.get(p.name) ? ', ' + outCount.get(p.name) + ' links' : ''}`;
  }
</script>

{#snippet sock(side, p)}
  {@const t = typeOf(side, p.name)}
  <button type="button" class="gsock" data-sock data-owner={node.id} data-side={side} data-port={p.name}
          data-type={t} data-req={p.required ? '' : null} data-pts={p.hint === 'points' ? '' : null}
          data-linked={side === 'in' ? (inLinks.has(p.name) ? '' : null) : (outCount.get(p.name) ? '' : null)}
          data-hint={hints?.get(key(side, p.name)) ?? null} data-armed={armed === key(side, p.name) ? '' : null}
          style:--tc={`var(--series-${TYPE_COLOR[t] || 'grey'})`}
          aria-label={sockAria(side, p)} tabindex="-1"
          onclick={(e) => onsock?.(e, side, p.name)}
          {@attach tooltip(`${portLabel(p)} · ${t}${p.required ? ' · required' : ''}${inLinks.get(p.name) ? '\n← ' + inLinks.get(p.name).label : ''}`)}></button>
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="gnode" data-gid={node.id} data-type={node.type} {@attach measure}
     data-sel={selected ? '' : null} data-status={st} data-muted={node.muted ? '' : null} data-collapsed={node.collapsed ? '' : null}
     data-missing={missing ? '' : null} data-drop={dropTarget ? '' : null} data-lod={lod ? '' : null}
     style:left={x + 'px'} style:top={y + 'px'} style:--tint={tint}
     tabindex="0" role="group" aria-label={`${title}${st ? ', ' + st : ''}${selected ? ', selected' : ''}`}>
  <div class="ghead" data-head>
    <span class="gicon" style:color={tint}><Icon name={icon} size={14} /></span>
    <span class="gtitle" {@attach tooltip(def?.help || node.type)}>{title}</span>
    {#if errs.length || warns.length}
      <button type="button" class="gbadge" data-sev={errs.length ? 'error' : 'warn'} tabindex="-1" onclick={() => onbadge?.()}
              aria-label={`${errs.length} errors, ${warns.length} warnings`} {@attach tooltip(badgeTip)}>
        <Icon name={errs.length ? 'error' : 'warning'} size={12} /><span class="k-num">{errs.length + warns.length}</span>
      </button>
    {/if}
    <span class="gstat" data-s={st} {@attach tooltip(statusTip[st] || '')}>
      {#if st === 'error'}<Icon name="error" size={12} />{:else if st === 'muted'}<Icon name="eye-off" size={12} />{:else if st === 'cached'}<span class="gdot"></span>{:else if st === 'ok'}<span class="gdot" data-fresh></span>{/if}
    </span>
    {#if node.type === 'out.axis'}
      <button type="button" class="gbtn" tabindex="-1" aria-pressed={node.preview !== false} aria-label="Preview as ghost"
              onclick={() => onprops?.({ preview: node.preview === false })} {@attach tooltip('Preview as ghost')}>
        <Icon name={node.preview === false ? 'eye-off' : 'eye'} size={12} /></button>
    {/if}
    <button type="button" class="gbtn" tabindex="-1" aria-pressed={!!node.muted} aria-label={isOut ? 'Mute output' : 'Bypass'}
            onclick={() => onprops?.({ muted: !node.muted })} {@attach tooltip(isOut ? 'Mute output' : 'Bypass', 'M')}>
      <Icon name="power" size={12} /></button>
    <button type="button" class="gbtn" tabindex="-1" aria-expanded={!node.collapsed} aria-label={node.collapsed ? 'Expand' : 'Collapse'}
            onclick={() => onprops?.({ collapsed: !node.collapsed })} {@attach tooltip(node.collapsed ? 'Expand' : 'Collapse', 'H')}>
      <Icon name={node.collapsed ? 'chevron-right' : 'chevron-down'} size={12} /></button>
  </div>

  {#if node.collapsed}
    <!-- collapsed: every socket stacks on the header line (the editor places them there) -->
    <div class="gsocks-collapsed">
      {#each ports.ins as p (p.name)}{@render sock('in', p)}{/each}
      {#each ports.params.filter((q) => inLinks.has(q.name)) as p (p.name)}{@render sock('in', p)}{/each}
      {#each ports.outs as p (p.name)}{@render sock('out', p)}{/each}
    </div>
  {:else}
    <div class="gbody">
      {#if missing}<p class="gmissing">Missing node type<br /><code>{node.type}</code><br />Kept with its params and links.</p>{/if}
      {#each rows as r, i (i)}
        <div class="grow" data-row data-in={r.i?.name} data-out={r.o?.name}>
          {#if r.i}{@render sock('in', r.i)}<span class="glbl" data-linked={inLinks.has(r.i.name) ? '' : null}>{portLabel(r.i)}</span>{/if}
          {#if r.o}<span class="glbl gout">{portLabel(r.o)}</span>{@render sock('out', r.o)}{/if}
        </div>
      {/each}
      {#each inl as p (p.key)}
        {@const pp = paramPort(p.key)}
        {@const l = pp ? inLinks.get(pp.name) : null}
        <div class="grow gparam" data-row data-in={pp?.name}>
          {#if pp}{@render sock('in', pp)}{/if}
          <span class="glbl" {@attach tooltip(p.hint || p.label)}>{p.label || p.key}</span>
          {#if l}
            <span class="glink">← {l.label}</span>
          {:else}
            <span class="gctl"><ParamField {p} value={node.params[p.key]} values={node.params} {sources} compact onchange={(v, c) => onparam?.(p, v, c)} /></span>
          {/if}
        </div>
      {/each}
      {#each extraLinked as pp (pp.name)}
        <div class="grow gparam" data-row data-in={pp.name}>
          {@render sock('in', pp)}<span class="glbl">{portLabel(pp)}</span><span class="glink">← {inLinks.get(pp.name).label}</span>
        </div>
      {/each}
      {#if spark && !lod}
        <div class="gspk">
          <Sparkline {...spark} width={206} height={30} label={`${title} output`} onhover={onhover} onseek={onseek}
                     overlay={diffOn ? spark.overlay : null} />
        </div>
      {/if}
      <div class="gline" data-s={st} data-slow={slow ? '' : null}>
        {#if missing}
          <span>unknown type</span>
        {:else if st === 'error'}
          <span class="gerr">{errs[0]?.message || 'error'}</span>
        {:else if blockedBy}
          <span>{blockedBy.message || 'waiting on upstream'}</span>
        {:else if st === 'muted'}
          <span>bypassed</span>
        {:else}
          <span class="gsum">{status?.summary || (st === 'skipped' ? 'not used by an output' : '…')}</span>
        {/if}
        {#if !status?.hit && status?.ms >= 1 && st === 'ok'}
          <span class="gms k-num" {@attach tooltip("computed in")}>{fmtNum(status.ms)} ms</span>
        {/if}
      </div>
      {#if bake}
        <div class="gbake" data-b={bake}><Icon name={bake === 'baked' ? 'check' : bake === 'never' ? 'dot' : 'warning'} size={11} />{BAKE_TEXT[bake] || bake}</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .gnode {
    --gw: 224px;
    position: absolute; width: var(--gw); box-sizing: border-box; contain: layout style;
    background: var(--bg-card); color: var(--tx); border: 1px solid var(--line-2); border-radius: var(--radius);
    box-shadow: 0 1px 0 rgba(var(--shade-rgb), .25), 0 4px 14px -6px rgba(var(--shade-rgb), .55);
    font-size: var(--fs-1); cursor: default; outline: none; touch-action: none;
    user-select: none; -webkit-user-select: none;   /* Shift+click selects cards, never page text */
  }
  .gnode :global(input), .gnode :global(textarea) { user-select: text; -webkit-user-select: text; }
  .gnode::before { content: ''; position: absolute; inset: -1px -1px auto; height: 2px; background: var(--tint, transparent); border-radius: var(--radius) var(--radius) 0 0; pointer-events: none; }
  .gnode:hover { border-color: var(--line-4); }
  .gnode[data-sel] { border-color: var(--highlight); box-shadow: 0 0 0 1px var(--highlight), 0 6px 18px -6px rgba(var(--highlight-rgb), .35); }
  .gnode:focus-visible { outline: var(--ring-w) solid var(--focus); outline-offset: 2px; }
  .gnode[data-status='error'] { border-color: var(--bad-ink); }
  .gnode[data-status='blocked'], .gnode[data-status='skipped'] { opacity: .62; }
  .gnode[data-muted] .gbody, .gnode[data-muted] .gtitle { opacity: .5; }
  .gnode[data-muted] { border-style: dashed; }
  .gnode[data-missing] { border-style: dashed; border-color: var(--warn-ink); }
  .gnode[data-drop] { box-shadow: 0 0 0 2px var(--reality); }

  .ghead { display: flex; align-items: center; gap: 4px; height: 26px; padding: 0 4px 0 7px; border-bottom: 1px solid var(--line-1);
    background: color-mix(in srgb, var(--bg-raised) 60%, var(--bg-card)); border-radius: var(--radius) var(--radius) 0 0; cursor: grab; }
  .gnode[data-collapsed] .ghead { border-bottom: 0; border-radius: var(--radius); }
  .gicon { flex: none; display: grid; place-items: center; color: var(--tx-mut); }
  .gtitle { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-family: var(--font-head, var(--font)); font-size: var(--fs-2); font-weight: 600; color: var(--tx-hi); letter-spacing: .01em; }
  .gbtn { flex: none; display: grid; place-items: center; width: 18px; height: 18px; padding: 0; border: 1px solid transparent; border-radius: var(--radius);
    background: none; color: var(--tx-mut); cursor: pointer; transition: color var(--t-quick) var(--ease-out), border-color var(--t-quick) var(--ease-out); }
  .gbtn:hover { color: var(--tx-hi); border-color: var(--line-3); }
  .gbtn[aria-pressed='true'] { color: var(--warn-ink); }
  .gbtn[aria-label='Preview as ghost'][aria-pressed='true'] { color: var(--reality); }
  .gbadge { flex: none; display: inline-flex; align-items: center; gap: 2px; height: 16px; padding: 0 4px; border-radius: var(--radius);
    border: 1px solid currentColor; background: none; font-size: var(--fs-1); cursor: pointer; }
  .gbadge[data-sev='error'] { color: var(--bad-ink); }
  .gbadge[data-sev='warn'] { color: var(--warn-ink); }
  .gstat { flex: none; display: grid; place-items: center; width: 12px; color: var(--tx-mut); }
  .gstat[data-s='error'] { color: var(--bad-ink); }
  .gdot { width: 6px; height: 6px; border-radius: 50%; border: 1px solid var(--tx-mut); box-sizing: border-box; }
  .gdot[data-fresh] { background: var(--ok); border-color: var(--ok); }

  .gbody { padding: 3px 0 6px; }
  .grow { position: relative; display: flex; align-items: center; gap: 6px; min-height: 22px; padding: 0 10px; }
  .glbl { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--tx-mut); }
  .glbl[data-linked] { color: var(--tx); }
  .gout { margin-left: auto; text-align: right; color: var(--tx); }
  .gparam { gap: 6px; min-height: 26px; }
  .gparam .glbl { flex: 1 1 auto; }
  .gctl { flex: 0 0 104px; width: 104px; min-width: 0; display: flex; justify-content: flex-end; }
  .gctl :global(.gnum), .gctl :global(.gsel), .gctl :global(.k-select) { width: 100%; }
  .glink { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--reality); font-size: var(--fs-1); }
  .gspk { padding: 4px 8px 0; }
  .gline { display: flex; align-items: baseline; gap: 6px; padding: 4px 9px 0; min-height: 16px; color: var(--tx-mut); font-size: var(--fs-1); }
  .gsum { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--mono); }
  .gerr { flex: 1 1 auto; color: var(--bad-ink); overflow-wrap: anywhere; }
  .gms { flex: none; margin-left: auto; color: var(--tx-mut); }
  .gline[data-slow] .gms { color: var(--warn-ink); }
  .gbake { display: flex; align-items: center; gap: 4px; margin: 5px 8px 0; padding: 2px 6px; font-size: var(--fs-1); border-radius: var(--radius);
    border: 1px solid var(--line-2); color: var(--tx-mut); }
  .gbake[data-b='baked'] { color: var(--ok-ink); border-color: color-mix(in srgb, var(--ok-ink) 45%, transparent); }
  .gbake[data-b='stale'], .gbake[data-b='axis-differs'] { color: var(--warn-ink); border-color: color-mix(in srgb, var(--warn-ink) 45%, transparent); }
  .gbake[data-b='error'] { color: var(--bad-ink); }
  .gmissing { margin: 4px 10px; color: var(--warn-ink); font-size: var(--fs-1); line-height: 1.5; }
  .gmissing code { color: var(--tx); }

  /* sockets: hollow = optional, filled = required, diamond = points; colour = resolved type */
  .gsock { --s: 10px; position: absolute; top: 50%; width: 18px; height: 18px; margin-top: -9px; padding: 0; border: 0; background: none;
    display: grid; place-items: center; cursor: crosshair; z-index: 1; touch-action: none; }
  .grow > .gsock:first-child { left: -10px; }
  .grow > .gsock:last-child:not(:first-child), .gout + .gsock { right: -10px; left: auto; }
  .gsock::before { content: ''; width: var(--s); height: var(--s); box-sizing: border-box; border-radius: 50%;
    border: 2px solid var(--tc); background: var(--bg-card); transition: transform var(--t-quick) var(--ease-out), background-color var(--t-quick) var(--ease-out); }
  .gsock[data-req]::before, .gsock[data-linked]::before { background: var(--tc); }
  .gsock[data-pts]::before { border-radius: var(--radius); transform: rotate(45deg) scale(.85); }
  .gsock:hover::before, .gsock:focus-visible::before { transform: scale(1.3); background: var(--tc); }
  .gsock[data-pts]:hover::before { transform: rotate(45deg) scale(1.1); }
  .gsock:focus-visible { outline: none; }
  .gsock:focus-visible::before { box-shadow: 0 0 0 2px var(--focus); }
  .gsock[data-armed]::before { box-shadow: 0 0 0 3px rgba(var(--highlight-rgb), .6); background: var(--highlight); }
  .gsock[data-hint='ok']::before { transform: scale(1.35); box-shadow: 0 0 0 3px color-mix(in srgb, var(--tc) 40%, transparent); }
  .gsock[data-hint='adapter']::before { transform: scale(1.25); box-shadow: 0 0 0 3px color-mix(in srgb, var(--warn) 50%, transparent); }
  .gsock[data-hint='bad'] { opacity: .2; }
  .gparam > .gsock { --s: 8px; }

  .gsocks-collapsed { position: absolute; inset: 0; pointer-events: none; }
  .gsocks-collapsed .gsock { pointer-events: auto; top: 13px; }
  .gsocks-collapsed .gsock[data-side='in'] { left: -10px; }
  .gsocks-collapsed .gsock[data-side='out'] { right: -10px; }

  /* far zoom: keep the layout (sockets stay put), skip painting the fine print */
  .gnode[data-lod] .gparam > :not(.gsock):not(.glbl), .gnode[data-lod] .gline { visibility: hidden; }
  .gnode[data-lod] .gtitle { font-size: var(--fs-4); }

  @media (pointer: coarse) { .gsock { width: 32px; height: 32px; margin-top: -16px; } .grow > .gsock:first-child { left: -17px; } }
</style>
