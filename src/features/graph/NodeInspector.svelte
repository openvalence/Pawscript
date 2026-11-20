<!--
  NodeInspector: the 280 px column beside the canvas (DESIGN 8.4). For the selected node: label and colour,
  every param (schema-generated, per-kind override chips on perSpan nodes), diagnostics with one-click fixes,
  each input and output in detail (summary, a bigger plot over the time view, a value table), and actions.
  With nothing selected: the graph itself (name, signal rate, evaluation status, every problem).
-->
<script>
  import Icon from '../../ui/kit/Icon.svelte';
  import Button from '../../ui/kit/Button.svelte';
  import Section from '../../ui/kit/Section.svelte';
  import SegmentedControl from '../../ui/kit/SegmentedControl.svelte';
  import ColorSwatch from '../../ui/kit/ColorSwatch.svelte';
  import DataTable from '../../ui/kit/DataTable.svelte';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { isDefault } from '../../ui/kit/params.js';
  import ParamField from './ParamField.svelte';
  import Sparkline from './Sparkline.svelte';
  import { setParams, setByKind, setNodeProps, disconnect } from '../../lib/graph/model.js';
  import { summarize, TYPES } from '../../lib/graph/types.js';
  import { KINDS, kindOf } from '../timeline/kinds.js';
  import { titleOf, portLabel, BAKE_TEXT, shownType } from './editor/cards.js';
  import { createParamGesture, endOnRelease } from './editor/paramgesture.js';
  import { TYPE_COLOR, fmtNum, fmtT } from './editor/plot.js';

  let { app, ctl, ui } = $props();

  const g = $derived(ctl.graph);
  const reg = $derived(ctl.registry);
  const id = $derived(ui.one);
  const node = $derived(id ? g?.nodes.find((n) => n.id === id) ?? null : null);
  const frame = $derived(id && !node ? (g?.frames || []).find((f) => f.id === id) ?? null : null);
  const def = $derived(node ? reg.get(node.type) : null);
  const ports = $derived(node ? reg.portsOf(node, g) : null);
  const st = $derived(node ? ctl.statusOf?.(node.id) : null);
  const inLinks = $derived(new Map((g?.links || []).filter((l) => l.to === id).map((l) => [l.in, l])));
  const title = (n) => titleOf(n, reg.get(n.type));
  const nodeTitle = (nid) => { const n = g?.nodes.find((x) => x.id === nid); return n ? title(n) : nid; };
  /** Declared type of a port, or the compiler's resolution of 'any'. */
  function portTypeOf(nid, ps, side, port) {
    const p = ps && (side === 'out' ? ps.outs : [...ps.ins, ...ps.params]).find((q) => q.name === port);
    return p && p.type !== 'any' ? p.type : ctl.program?.types?.get(`${nid}:${port}`) || p?.type || 'any';
  }
  const typeOf = (side, port) => portTypeOf(id, ports, side, port);
  /** Resolved type of the upstream output feeding input `port` (null when unlinked). */
  function upstreamType(port) {
    const l = inLinks.get(port), n = l && g?.nodes.find((x) => x.id === l.from);
    return n ? portTypeOf(n.id, reg.portsOf(n, g), 'out', l.out) : null;
  }

  // ---- params, with per-kind overrides ----
  let kind = $state(null);
  $effect(() => { void id; kind = null; });
  const whereKinds = $derived.by(() => {
    if (!def?.perSpan) return [];
    const l = inLinks.get('where'), v = l ? ctl.valueOf?.(l.from, l.out) : null;
    const seen = new Set(Array.isArray(v) ? v.map((s) => s.kind).filter(Boolean) : []);
    return [...seen, ...KINDS.map((k) => k.id).filter((k) => !seen.has(k))].map((k) => ({ id: k, seen: seen.has(k) }));
  });
  const shown = $derived(node ? (kind ? { ...node.params, ...(node.byKind?.[kind] || {}) } : node.params) : {});
  const visibleParams = $derived((def?.params || []).filter((p) => !p.hidden));
  const gest = createParamGesture({ gesture: (l) => ctl.gesture(l), mutate: (l, fn) => ctl.mutate(l, fn) });   // a scrub = one undo entry
  $effect(() => endOnRelease(gest));
  function setParam(p, v, commit) {
    const label = `set ${p.label || p.key}${kind ? ' (' + kind + ')' : ''}`;
    const k = kind, nid = id;
    const f = (gr) => (k ? setByKind(gr, reg, nid, k, { [p.key]: v }) : setParams(gr, reg, nid, { [p.key]: v }));
    const why = gest.change(`${nid}:${p.key}:${k ?? ''}`, label, f, v, commit, shown[p.key]);
    if (why) ui.say(why);
  }
  const reset = (p) => setParam(p, kind ? node.params[p.key] : p.default, true);
  const overridden = (key) => !!(kind && node?.byKind?.[kind] && key in node.byKind[kind]);
  const seedKeys = $derived((def?.params || []).filter((p) => p.seed).map((p) => p.key));
  function reroll() { ctl.mutate('reroll seed', (gr) => setParams(gr, reg, id, Object.fromEntries(seedKeys.map((k) => [k, Math.floor(Math.random() * 2 ** 31)])))); }

  // ---- values in detail ----
  let table = $state(null);   // 'in:<port>' | 'out:<port>'
  const view = $derived(app.view);
  function valueOfPort(side, p) {
    if (side === 'out') return ctl.valueOf?.(id, p.name);
    const l = inLinks.get(p.name);
    return l ? ctl.valueOf?.(l.from, l.out) : undefined;
  }
  function sum(t, v) { try { return v === undefined ? 'no value' : summarize(t, v); } catch { return ''; } }
  function rowsOf(t, v) {
    if (v == null) return [];
    const t0 = view?.start ?? 0, t1 = t0 + (view?.span ?? Infinity);
    if (t === 'script') return v.filter((a) => a.at >= t0 && a.at <= t1).slice(0, 5000).map((a, i) => ({ id: i, t: fmtT(a.at), ms: a.at, v: a.pos }));
    if (t === 'signal') {
      const out = [], k0 = Math.max(0, Math.floor(t0 / v.dt) - v.i0), k1 = Math.min(v.v.length, Math.ceil(t1 / v.dt) - v.i0 + 1);
      for (let k = k0; k < k1 && out.length < 5000; k++) out.push({ id: k, t: fmtT((v.i0 + k) * v.dt), ms: (v.i0 + k) * v.dt, v: Number.isNaN(v.v[k]) ? 'NaN' : +v.v[k].toFixed(3) });
      return out;
    }
    if (t === 'spans') return v.slice(0, 5000).map((s, i) => ({ id: i, t: fmtT(s.t0), ms: s.t0, t1: fmtT(s.t1), dur: s.t1 - s.t0, kind: s.kind || '', label: s.label || '', v: s.value ?? '' }));
    return [{ id: 0, t: '', ms: 0, v: fmtNum(v) }];
  }
  const colsOf = (t) => t === 'spans'
    ? [{ key: 't', label: 'Start', width: '64px' }, { key: 't1', label: 'End', width: '64px' }, { key: 'kind', label: 'Kind' }, { key: 'v', label: 'Value', numeric: true, width: '52px' }]
    : t === 'number' ? [{ key: 'v', label: 'Value', numeric: true }]
      : [{ key: 't', label: 'Time', width: '80px' }, { key: 'ms', label: 'ms', numeric: true }, { key: 'v', label: t === 'script' ? 'Pos' : 'Value', numeric: true }];

  // ---- graph overview ----
  const errs = $derived((ctl.diags || []).filter((d) => d.severity === 'error'));
  const others = $derived((ctl.diags || []).filter((d) => d.severity !== 'error'));
  const res = $derived(ctl.result);
  const counts = $derived.by(() => {
    const c = { ok: 0, cached: 0, error: 0, blocked: 0 };
    for (const s of res?.status?.values?.() || []) if (s in c) c[s]++;
    return c;
  });
  function applyFix(fix) { const why = ctl.applyFix?.(fix); if (why) ui.say(why); }
  const sev = { error: 'error', warn: 'warning', info: 'info' };
</script>

{#snippet diagList(list, showNode)}
  {#each list as d (d.id)}
    <div class="gdiag" data-sev={d.severity}>
      <Icon name={sev[d.severity]} size={12} />
      <div class="gdiag-b">
        {#if showNode && d.node}<button type="button" class="gdiag-n" onclick={() => { ui.select([d.node]); ui.editor?.revealNode(d.node); }}>{nodeTitle(d.node)}</button>{/if}
        <span>{d.message}</span>
        {#if d.fix}<Button size="sm" variant="ghost" icon="wand" onclick={() => applyFix(d.fix)}>{d.fix.label}</Button>{/if}
      </div>
    </div>
  {/each}
{/snippet}

<aside class="gins k-scroll" aria-label="Node inspector" style:--ph={view ? (app.player?.timeMs - view.start) / view.span : -1}
       style:--hv={view && ctl.hoverTime != null ? (ctl.hoverTime - view.start) / view.span : -1}>
  {#if node}
    <header class="gins-h">
      <div class="gins-t">
        <input class="gins-name" value={node.label ?? ''} placeholder={def?.title || node.type} aria-label="Node label"
               onchange={(e) => ctl.mutate('rename', (gr) => setNodeProps(gr, id, { label: e.currentTarget.value.trim() || null }))} />
        <ColorSwatch value={node.color ?? undefined} label="Node colour" size="sm" onchange={(k) => ctl.mutate('colour', (gr) => setNodeProps(gr, id, { color: k }))} />
      </div>
      <div class="gins-type"><code>{node.type}</code>{#if def?.group}<span>· {def.group}</span>{/if}</div>
      {#if def?.help}<p class="gins-help">{def.help}</p>{:else if !def}<p class="gins-help gwarn">This node type is not in the catalogue. It is kept with its params and links; outputs that depend on it cannot evaluate.</p>{/if}
      <div class="gins-stat" data-s={st?.status}>
        <span class="gpill">{st?.status || '—'}</span>
        {#if st?.ms != null}<span class="k-num">{st.hit ? 'cache hit' : fmtNum(st.ms) + ' ms'}</span>{/if}
        {#if node.type === 'out.axis'}<span class="gpill" data-b={ctl.bakeStatus?.(id)}>{BAKE_TEXT[ctl.bakeStatus?.(id)] || ''}</span>{/if}
      </div>
    </header>

    <div class="gins-acts" role="toolbar" aria-label="Node actions">
      <button type="button" class="gact" onclick={() => ctl.setProbe?.(id)} aria-pressed={ctl.probe?.node === id} aria-label="Probe in the timeline" {@attach tooltip('Probe in the timeline', 'P')}><Icon name="target" size={14} /></button>
      <button type="button" class="gact" onclick={() => ctl.pin?.('A', ctl.pins?.A?.node === id ? null : id)} aria-pressed={ctl.pins?.A?.node === id} aria-label="Pin as A" {@attach tooltip('Pin as A', 'Alt+A')}>A</button>
      <button type="button" class="gact" onclick={() => ctl.pin?.('B', ctl.pins?.B?.node === id ? null : id)} aria-pressed={ctl.pins?.B?.node === id} aria-label="Pin as B" {@attach tooltip('Pin as B', 'Alt+B')}>B</button>
      <button type="button" class="gact" onclick={() => ctl.snapshot?.(id)} aria-label="Snapshot output to a ghost" {@attach tooltip('Snapshot output to a ghost', 'S')}><Icon name="pin" size={14} /></button>
      <button type="button" class="gact" onclick={() => ctl.mutate(node.muted ? 'un-bypass' : 'bypass', (gr) => setNodeProps(gr, id, { muted: !node.muted }))} aria-pressed={!!node.muted} aria-label="Bypass" {@attach tooltip('Bypass', 'M')}><Icon name="power" size={14} /></button>
      {#if seedKeys.length}<button type="button" class="gact" onclick={reroll} aria-label="Reroll seed" {@attach tooltip('Reroll seed')}><Icon name="random" size={14} /></button>{/if}
      <span class="gsp"></span>
      <button type="button" class="gact" onclick={() => ui.editor?.duplicate()} aria-label="Duplicate" {@attach tooltip('Duplicate', 'Ctrl+D')}><Icon name="duplicate" size={14} /></button>
      <button type="button" class="gact" data-danger onclick={() => ui.editor?.remove(false)} aria-label="Delete" {@attach tooltip('Delete', 'Del')}><Icon name="delete" size={14} /></button>
    </div>

    {#if st?.diags?.length}
      <Section title="Problems" count={st.diags.length}>{@render diagList(st.diags, false)}</Section>
    {/if}

    {#if visibleParams.length}
      <Section title="Parameters" count={visibleParams.length}>
        {#if def?.perSpan}
          <div class="gkchips" role="group" aria-label="Edit params for a span kind">
            <button type="button" class="gkchip" aria-pressed={!kind} onclick={() => (kind = null)}>All</button>
            {#each whereKinds as k (k.id)}
              {@const kd = kindOf(k.id)}
              <button type="button" class="gkchip" aria-pressed={kind === k.id} data-seen={k.seen ? '' : null} data-over={node.byKind?.[k.id] ? '' : null}
                      style:--kc={kd.color} onclick={() => (kind = kind === k.id ? null : k.id)}>{kd.label}</button>
            {/each}
          </div>
          {#if kind}
            <p class="gkhint">Editing overrides for <b>{kindOf(kind).label}</b> spans of the "Only inside" input.
              {#if node.byKind?.[kind]}<button type="button" class="glinkbtn" onclick={() => ctl.mutate('reset kind', (gr) => setByKind(gr, reg, id, kind, null))}>Reset kind</button>{/if}</p>
          {/if}
        {/if}
        {#each visibleParams as p (p.key)}
          {@const l = inLinks.get('p:' + p.key)}
          {@const mod = !kind ? !isDefault(p, node.params[p.key]) && p.type !== 'text' && typeof p.default !== 'object' : overridden(p.key)}
          <div class="gprow" data-over={overridden(p.key) ? '' : null}>
            <div class="gplbl">
              <span {@attach tooltip(p.hint || '')}>{p.label || p.key}{#if p.mod}<span class="gmod" {@attach tooltip(p.mod === 'signal' ? 'Can be driven by a signal (wire into its socket)' : 'Can be driven by a number')}>~</span>{/if}</span>
              {#if mod && !l}<button type="button" class="greset" onclick={() => reset(p)} aria-label={`Reset ${p.label}`} {@attach tooltip(kind ? 'Remove override' : 'Reset to default')}><Icon name="refresh" size={11} /></button>{/if}
            </div>
            {#if l}
              <div class="gplinked"><span>← {nodeTitle(l.from)}.{l.out}</span>
                <button type="button" class="greset" aria-label="Unlink" onclick={() => ctl.mutate('unlink param', (gr) => disconnect(gr, [l.id]))} {@attach tooltip('Unlink (the stored value applies again)')}><Icon name="unlink" size={12} /></button></div>
            {:else}
              <ParamField {p} value={shown[p.key]} values={shown} sources={ctl.sources} onchange={(v, c) => setParam(p, v, c)} />
            {/if}
            {#if p.hint}<p class="gphint">{p.hint}</p>{/if}
          </div>
        {/each}
      </Section>
    {/if}

    {#each [['in', ports.ins.concat(ports.params.filter((q) => inLinks.has(q.name)))], ['out', ports.outs]] as [side, list] (side)}
      {#if list.length}
        <Section title={side === 'in' ? 'Inputs' : 'Outputs'} count={list.length}>
          {#each list as p (p.name)}
            {@const t = typeOf(side, p.name)}
            {@const v = valueOfPort(side, p)}
            {@const l = side === 'in' ? inLinks.get(p.name) : null}
            {@const vt = shownType(t, l ? upstreamType(p.name) : null, v)}
            {@const adapter = l ? ctl.program?.adapters?.get(l.id) : null}
            <div class="gport">
              <div class="gport-h">
                <span class="gchip" style:--tc={`var(--series-${TYPE_COLOR[t] || 'grey'})`}></span>
                <span class="gport-n">{portLabel(p)}</span>
                <span class="gport-t">{TYPES[t]?.label || t}{p.required ? ' · required' : ''}{adapter ? ` · from ${TYPES[vt]?.label || vt} (${adapter})` : ''}</span>
                {#if v !== undefined && vt !== 'number'}
                  <button type="button" class="greset" aria-pressed={table === side + ':' + p.name} aria-label="Value table"
                          onclick={() => (table = table === side + ':' + p.name ? null : side + ':' + p.name)} {@attach tooltip('Table of values in the view')}><Icon name="list" size={12} /></button>
                {/if}
              </div>
              {#if side === 'in'}<div class="gport-src">{l ? `← ${nodeTitle(l.from)}.${l.out}` : p.required ? 'not connected (required)' : 'not connected'}</div>{/if}
              <div class="gport-sum k-num">{sum(vt, v)}</div>
              {#if v !== undefined && vt !== 'number' && view}
                <Sparkline type={vt} value={v} t0={view.start} t1={view.start + view.span} width={252} height={64} labels dots
                           onhover={(x) => (ctl.hoverTime = x)} onseek={(x) => app.player?.seek?.(x)} label={`${portLabel(p)} plot`} />
              {/if}
              {#if table === side + ':' + p.name}
                <div class="gtable"><DataTable columns={colsOf(vt)} rows={rowsOf(vt, v)} label={`${portLabel(p)} values`} multiple={false}
                                               onactivate={(r) => app.player?.seek?.(r.ms)} /></div>
              {/if}
            </div>
          {/each}
        </Section>
      {/if}
    {/each}
  {:else if frame}
    <header class="gins-h">
      <div class="gins-t"><span class="gins-big">{frame.note ? 'Note' : frame.title || 'Frame'}</span></div>
      <p class="gins-help">{frame.note ? 'A sticky note. Double-click it on the canvas to edit the text.' : 'A frame groups nodes visually. Dragging its title moves everything inside. It has no effect on evaluation.'}</p>
    </header>
  {:else if g}
    <header class="gins-h">
      <div class="gins-t"><input class="gins-name" value={g.name} aria-label="Graph name" onchange={(e) => ctl.renameGraph?.(g.id, e.currentTarget.value.trim() || 'Graph')} /></div>
      <div class="gins-type"><span>{g.nodes.length} nodes · {g.links.length} wires</span></div>
    </header>
    <Section title="Signal rate">
      <SegmentedControl size="sm" full label="Signal grid" value={g.rate} options={[25, 50, 100, 200].map((r) => ({ value: r, label: r + ' Hz' }))}
                        onchange={(r) => ctl.mutate('signal rate', (gr) => ({ ...gr, rate: r }))} />
      <p class="gphint">One sample grid for every signal in this graph ({1000 / g.rate} ms). Higher is finer and slower.</p>
    </Section>
    <Section title="Evaluation">
      <div class="gkv"><span>Last full run</span><b class="k-num">{res ? fmtNum(res.ms) + ' ms' : '—'}</b></div>
      <div class="gkv"><span>Computed / cached</span><b class="k-num">{counts.ok} / {counts.cached}</b></div>
      <div class="gkv"><span>Errors / blocked</span><b class="k-num">{counts.error} / {counts.blocked}</b></div>
      {#if ctl.slow}<p class="gphint gwarn">Slow graph: {fmtNum(ctl.slow.ms)} ms ({nodeTitle(ctl.slow.node)}). Previews update when you release.</p>{/if}
    </Section>
    <Section title="Problems" count={(ctl.diags || []).length}>
      {#if !(ctl.diags || []).length}<p class="gphint">No problems.</p>{/if}
      {@render diagList(errs, true)}
      {@render diagList(others, true)}
    </Section>
  {/if}
</aside>

<style>
  .gins { box-sizing: border-box; width: 100%; height: 100%; overflow-y: auto; background: var(--bg); border-left: 1px solid var(--line-1); font-size: var(--fs-2); }
  .gins-h { padding: 10px 12px 8px; border-bottom: 1px solid var(--line-1); }
  .gins-t { display: flex; align-items: center; gap: 6px; }
  .gins-name { flex: 1; min-width: 0; height: 26px; padding: 0 6px; font-family: var(--font-head, var(--font)); font-size: var(--fs-4); font-weight: 600; color: var(--tx-hi);
    background: none; border: 1px solid transparent; border-radius: var(--radius); outline: none; }
  .gins-name:hover { border-color: var(--line-2); }
  .gins-name:focus { border-color: var(--focus); background: var(--bg-sunken); }
  .gins-name::placeholder { color: var(--tx-hi); }
  .gins-big { font-family: var(--font-head, var(--font)); font-size: var(--fs-4); font-weight: 600; color: var(--tx-hi); }
  .gins-type { margin: 2px 6px 0; color: var(--tx-mut); font-size: var(--fs-1); display: flex; gap: 4px; }
  .gins-type code { font-family: var(--mono); color: var(--tx); }
  .gins-help { margin: 6px 6px 0; color: var(--tx); line-height: 1.45; }
  .gwarn { color: var(--warn-ink) !important; }
  .gins-stat { display: flex; align-items: center; gap: 6px; margin: 8px 6px 0; font-size: var(--fs-1); color: var(--tx-mut); }
  .gpill { padding: 1px 6px; border: 1px solid var(--line-2); border-radius: var(--radius); text-transform: uppercase; letter-spacing: .06em; font-size: 9px; /* micro, below --fs-1: its box is fixed */ }
  .gins-stat[data-s='error'] .gpill:first-child { color: var(--bad-ink); border-color: var(--bad-ink); }
  .gins-stat[data-s='ok'] .gpill:first-child, .gins-stat[data-s='cached'] .gpill:first-child { color: var(--ok-ink); border-color: color-mix(in srgb, var(--ok-ink) 50%, transparent); }
  .gpill[data-b='stale'], .gpill[data-b='axis-differs'] { color: var(--warn-ink); }
  .gins-acts { display: flex; align-items: center; gap: 2px; padding: 6px 10px; border-bottom: 1px solid var(--line-1); }
  .gact { display: grid; place-items: center; min-width: 26px; height: 24px; padding: 0 4px; font: inherit; font-size: var(--fs-1); font-weight: 700; color: var(--tx-mut);
    background: none; border: 1px solid transparent; border-radius: var(--radius); cursor: pointer; }
  .gact:hover { color: var(--tx-hi); border-color: var(--line-3); }
  .gact[aria-pressed='true'] { color: var(--reality); border-color: var(--reality); }
  .gact[data-danger]:hover { color: var(--bad-ink); border-color: var(--bad-ink); }
  .gsp { flex: 1; }
  .gins :global(.k-section) { border-bottom: 1px solid var(--line-1); }
  .gprow { padding: 4px 0 6px; }
  .gprow[data-over] .gplbl span:first-child { color: var(--highlight); }
  .gplbl { display: flex; align-items: center; gap: 4px; min-height: 18px; color: var(--tx-mut); font-size: var(--fs-1); }
  .gmod { margin-left: 3px; color: var(--reality); font-weight: 700; cursor: help; }
  .greset { display: grid; place-items: center; width: 18px; height: 18px; margin-left: auto; padding: 0; border: 1px solid transparent; border-radius: var(--radius);
    background: none; color: var(--tx-mut); cursor: pointer; }
  .greset:hover { color: var(--tx-hi); border-color: var(--line-3); }
  .greset[aria-pressed='true'] { color: var(--reality); }
  .gplinked { display: flex; align-items: center; gap: 4px; height: var(--ctl-h); padding: 0 6px; color: var(--reality); background: var(--bg-sunken); border: 1px dashed var(--line-3); border-radius: var(--radius); font-size: var(--fs-1); }
  .gplinked span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gphint { margin: 3px 0 0; color: var(--tx-mut); font-size: var(--fs-1); line-height: 1.4; }
  .gkchips { display: flex; flex-wrap: wrap; gap: 3px; margin-bottom: 6px; }
  .gkchip { padding: 1px 6px; font: inherit; font-size: var(--fs-1); color: var(--tx-mut); background: none; border: 1px solid var(--line-2); border-radius: var(--radius); cursor: pointer; }
  .gkchip:not([data-seen]):not([aria-pressed='true']):not(:first-child) { opacity: .55; }
  .gkchip[data-over] { border-color: var(--kc); color: var(--tx); }
  .gkchip[aria-pressed='true'] { color: var(--tx-hi); border-color: var(--kc, var(--reality)); background: color-mix(in srgb, var(--kc, var(--reality)) 20%, transparent); }
  .gkhint { margin: 0 0 6px; font-size: var(--fs-1); color: var(--tx-mut); line-height: 1.4; }
  .glinkbtn { padding: 0; font: inherit; color: var(--reality); background: none; border: 0; cursor: pointer; text-decoration: underline; }
  .gdiag { display: flex; gap: 6px; padding: 5px 0; font-size: var(--fs-1); line-height: 1.4; }
  .gdiag[data-sev='error'] { color: var(--bad-ink); }
  .gdiag[data-sev='warn'] { color: var(--warn-ink); }
  .gdiag[data-sev='info'] { color: var(--info-ink); }
  .gdiag :global(.k-icon) { margin-top: 2px; }
  .gdiag-b { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; min-width: 0; color: var(--tx); }
  .gdiag-n { padding: 0; font: inherit; font-weight: 600; color: var(--tx-hi); background: none; border: 0; cursor: pointer; text-align: left; }
  .gdiag-n:hover { text-decoration: underline; }
  .gport { padding: 6px 0 8px; border-top: 1px solid var(--line-1); }
  .gport:first-child { border-top: 0; }
  .gport-h { display: flex; align-items: center; gap: 6px; }
  .gchip { width: 8px; height: 8px; border-radius: 50%; background: var(--tc); flex: none; }
  .gport-n { font-weight: 600; color: var(--tx-hi); }
  .gport-t { color: var(--tx-mut); font-size: var(--fs-1); }
  .gport-h .greset { margin-left: auto; }
  .gport-src { margin: 2px 0 0 14px; color: var(--reality); font-size: var(--fs-1); }
  .gport-sum { margin: 2px 0 5px 14px; color: var(--tx-val); font-size: var(--fs-1); }
  .gtable { height: 180px; margin-top: 6px; display: flex; }
  .gtable :global(.k-data-table) { flex: 1; }
  .gkv { display: flex; justify-content: space-between; padding: 2px 0; color: var(--tx-mut); }
  .gkv b { color: var(--tx-val); font-weight: 400; }
</style>
