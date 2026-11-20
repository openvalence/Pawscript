<!--
  Palette: the node search (Shift+A, double-click, right-click, typing on the canvas, a wire dropped on empty
  canvas). Browsing is the nested group tree with Favourites and Recent first; typing ranks every item with the
  local fuzzy matcher (title, aliases, group, param labels, help) and flattens the list. A details pane shows
  the active item's help, ports and params. Keyboard complete: focus stays in the search box; Up/Down walk,
  Right/Left open and close a group, Enter places, Shift+Enter stars, Esc closes.

  PROVENANCE: ported from OpenValence/Phosphor (Apache-2.0) src/ui/graph/GraphPalette.svelte (measured clamping
  inside the editor box, header/item tree rows, keyboard model), with its rank() replaced by editor/fuzzy.js.
-->
<script>
  import { onMount, tick, untrack } from 'svelte';
  import Icon from '../../ui/kit/Icon.svelte';
  import { rank, highlights } from './editor/fuzzy.js';
  import { nestItems } from './editor/cards.js';
  import { TYPE_COLOR } from './editor/plot.js';

  let { items = [], x = 0, y = 0, vw = 800, vh = 600, query = '', flat = false, title = 'Add node', recent = [], favs = [], onfav, onpick, onclose } = $props();

  let q = $state(untrack(() => query));
  let cur = $state(0);
  let open = $state(new Set());
  let box = $state(), input = $state(), list = $state();
  let w = $state(0), h = $state(0);

  const byKey = $derived(new Map(items.map((it) => [it.key, it])));
  const favSet = $derived(new Set(favs));
  const tree = $derived.by(() => {
    const top = [];
    const f = favs.map((k) => byKey.get(k)).filter(Boolean);
    const r = recent.map((k) => byKey.get(k)).filter((it) => it && !favSet.has(it.key)).slice(0, 6);
    if (f.length) top.push({ name: '★ Favourites', items: f, groups: [], open: true });
    if (r.length) top.push({ name: 'Recent', items: r, groups: [], open: true });
    return [...top, ...nestItems(items)];
  });
  const rows = $derived.by(() => {
    if (q.trim()) return rank(q, items, { recent, favs, limit: 120 }).map((it) => ({ head: false, key: 'r/' + it.key, it, level: 0 }));
    if (flat) return rank('', items, { recent, favs }).map((it) => ({ head: false, key: 'r/' + it.key, it, level: 0 }));
    const out = [];
    const walk = (gs, path, level) => {
      for (const g of gs) {
        const id = path ? path + ' · ' + g.name : g.name;
        const isOpen = open.has(id) || (g.open && !open.has('!' + id));
        out.push({ head: true, key: 'h/' + id, g, id, parent: path, level, isOpen });
        if (!isOpen) continue;
        for (const it of g.items) out.push({ head: false, key: id + '/' + it.key, it, group: id, level: level + 1 });
        walk(g.groups, id, level + 1);
      }
    };
    walk(tree, '', 0);
    return out;
  });
  const active = $derived(rows[cur] && !rows[cur].head ? rows[cur].it : null);
  const total = (g) => g.items.length + g.groups.reduce((n, s) => n + total(s), 0);
  const wide = $derived(vw >= 620);
  const left = $derived(Math.max(8, Math.min(x, vw - w - 8)));
  const top = $derived(Math.max(8, Math.min(y, vh - h - 8)));

  onMount(() => { input?.focus({ preventScroll: true }); input?.setSelectionRange(q.length, q.length); });

  function toggle(r, on = !r.isOpen) {
    const n = new Set(open);
    n.delete(r.id); n.delete('!' + r.id);
    if (on) n.add(r.id); else if (r.g.open) n.add('!' + r.id);
    open = n;
  }
  async function show() { await tick(); list?.querySelector('[data-cur]')?.scrollIntoView({ block: 'nearest' }); }
  function act(r) { if (!r) return; if (r.head) toggle(r); else onpick?.(r.it); }
  function key(e) {
    const r = rows[cur];
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onclose?.(); return; }
    if (e.key === 'Enter' && e.shiftKey && r && !r.head) { e.preventDefault(); onfav?.(r.it.key); return; }
    if (e.key === 'Enter') { e.preventDefault(); act(r); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      const step = e.key.startsWith('Page') ? 10 : 1;
      cur = Math.max(0, Math.min(rows.length - 1, cur + (e.key === 'ArrowDown' || e.key === 'PageDown' ? step : -step)));
      show();
      return;
    }
    if (q || flat || !r) return;
    if (e.key === 'ArrowRight' && r.head) { e.preventDefault(); toggle(r, true); }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const id = r.head && r.isOpen ? r.id : r.head ? r.parent : r.group;
      const row = rows.find((x) => x.head && x.id === id);
      if (!row) return;
      toggle(row, false);
      cur = Math.max(0, rows.findIndex((x) => x.head && x.id === id));
    }
  }
  function marked(text) {
    const hs = q.trim() ? highlights(q, text) : [];
    const out = [];
    let at = 0;
    for (const [a, b] of hs) { if (a > at) out.push([text.slice(at, a), false]); out.push([text.slice(a, b), true]); at = b; }
    if (at < text.length) out.push([text.slice(at), false]);
    return out;
  }
  const chip = (t) => `var(--series-${TYPE_COLOR[t] || 'grey'})`;
</script>

<div class="gpal k-pop" role="dialog" aria-label={title} tabindex="-1" bind:this={box} bind:offsetWidth={w} bind:offsetHeight={h}
     data-wide={wide ? '' : null} style:left={left + 'px'} style:top={top + 'px'} onkeydown={key}>
  <div class="gpal-main">
    <div class="gpal-head">
      <span class="gpal-title k-caps">{title}</span>
      <span class="gpal-count k-num">{rows.filter((r) => !r.head).length}</span>
    </div>
    <label class="gpal-search">
      <Icon name="search" size={14} />
      <input bind:this={input} bind:value={q} oninput={() => (cur = 0)} placeholder="Search nodes, params, help…" aria-label="Search"
             role="combobox" aria-expanded="true" aria-controls="gpal-list" aria-activedescendant={rows[cur] ? 'gpal-r' + cur : undefined} spellcheck="false" autocomplete="off" />
    </label>
    <div class="gpal-list k-scroll" id="gpal-list" role="listbox" aria-label="Nodes" bind:this={list}>
      {#each rows as r, i (r.key)}
        {#if r.head}
          <button type="button" id={'gpal-r' + i} class="gpal-group" role="option" aria-selected={i === cur} data-open={r.isOpen ? '' : null}
                  data-cur={i === cur ? '' : null} style:--lv={r.level} tabindex="-1" onclick={() => { cur = i; toggle(r); }}>
            <Icon name={r.isOpen ? 'chevron-down' : 'chevron-right'} size={12} />
            <span class="gpal-label">{r.g.name}</span><span class="gpal-n k-num">{total(r.g)}</span>
          </button>
        {:else}
          <div class="gpal-item" id={'gpal-r' + i} role="option" aria-selected={i === cur} data-cur={i === cur ? '' : null} style:--lv={r.level}
               tabindex="-1" onpointerenter={() => (cur = i)} onclick={() => onpick?.(r.it)} onkeydown={() => {}}>
            <span class="gpal-label">{#each marked(r.it.title) as [s, m], j (j)}{#if m}<mark>{s}</mark>{:else}{s}{/if}{/each}</span>
            {#if r.it.hint}<span class="gpal-hint">{r.it.hint}</span>{/if}
            {#if !r.level || q}<span class="gpal-path">{r.it.group}</span>{/if}
            <span class="gpal-types" aria-hidden="true">
              {#each r.it.ins.slice(0, 3) as t, j (j)}<i style:--tc={chip(t)}></i>{/each}
              {#if r.it.ins.length || r.it.outs.length}<b>›</b>{/if}
              {#each r.it.outs.slice(0, 3) as t, j (j)}<i style:--tc={chip(t)}></i>{/each}
            </span>
            {#if onfav && !r.it.preset && r.it.type !== undefined}
              <button type="button" class="gpal-fav" tabindex="-1" aria-pressed={favSet.has(r.it.key)} aria-label="Favourite"
                      onclick={(e) => { e.stopPropagation(); onfav(r.it.key); }}>{favSet.has(r.it.key) ? '★' : '☆'}</button>
            {/if}
          </div>
        {/if}
      {:else}
        <p class="gpal-none">Nothing matches “{q}”</p>
      {/each}
    </div>
    <div class="gpal-foot"><kbd>↑↓</kbd> move <kbd>Enter</kbd> place <kbd>→←</kbd> groups <kbd>Shift+Enter</kbd> star <kbd>Esc</kbd> close</div>
  </div>
  {#if wide}
    <aside class="gpal-detail" aria-live="polite">
      {#if active}
        <div class="gpal-dt">{active.title}</div>
        <div class="gpal-dg">{active.group}{#if active.type} · <code>{active.type}</code>{/if}</div>
        {#if active.help}<p class="gpal-dh">{active.help}</p>{/if}
        {#if active.def}
          <div class="gpal-ports">
            {#each active.def.ins || [] as p (p.name)}<div class="gpal-port"><i style:--tc={chip(p.type)}></i><span>{p.label || p.name}</span><em>{p.type}{p.required ? ' · req' : ''}</em></div>{/each}
            {#if active.def.perSpan}<div class="gpal-port"><i style:--tc={chip('spans')}></i><span>Only inside</span><em>spans</em></div>{/if}
            {#each active.def.outs || [] as p (p.name)}<div class="gpal-port gpal-out"><span>{p.label || p.name}</span><em>{p.type}</em><i style:--tc={chip(p.type)}></i></div>{/each}
          </div>
          {#if active.params.length}<div class="gpal-dp"><span class="k-caps">Params</span> {active.params.slice(0, 8).join(' · ')}{active.params.length > 8 ? ' …' : ''}</div>{/if}
          {#if active.variant}<div class="gpal-dp"><span class="k-caps">Recipe</span> {active.variant.title}</div>{/if}
        {:else if active.preset}
          <div class="gpal-dp"><span class="k-caps">Preset</span> {active.preset.nodes.length} nodes{#if active.preset.tags?.length} · {active.preset.tags.join(', ')}{/if}</div>
        {/if}
      {:else}
        <p class="gpal-dh">Pick a node to see what it does.</p>
      {/if}
    </aside>
  {/if}
</div>

<style>
  .gpal { position: absolute; z-index: 10; display: flex; width: 340px; max-height: min(460px, calc(100% - 16px)); box-sizing: border-box;
    background: var(--bg-card); border: 1px solid var(--line-3); border-radius: var(--radius); box-shadow: var(--shadow-2); overflow: hidden; }
  .gpal[data-wide] { width: 600px; max-width: calc(100% - 16px); }
  .gpal-main { flex: 1 1 340px; min-width: 0; display: flex; flex-direction: column; }
  .gpal-head { display: flex; align-items: center; gap: 6px; padding: 6px 10px 2px; }
  .gpal-title { color: var(--tx-mut); font-size: var(--fs-1); }
  .gpal-count { margin-left: auto; color: var(--tx-mut); font-size: var(--fs-1); }
  .gpal-search { display: flex; align-items: center; gap: 6px; margin: 4px 8px 6px; padding: 0 8px; height: var(--ctl-h); color: var(--tx-mut);
    background: var(--bg-sunken); border: 1px solid var(--focus); border-radius: var(--radius); box-shadow: var(--recess), 0 0 0 1px var(--focus); }
  .gpal-search input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: none; color: var(--tx-hi); font: inherit; font-size: var(--fs-ui); }
  .gpal-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0 4px 4px; }
  .gpal-group, .gpal-item { position: relative; display: flex; align-items: center; gap: 6px; width: 100%; box-sizing: border-box; min-height: var(--row-h);
    padding: 0 6px 0 calc(6px + var(--lv, 0) * 14px); border: 0; border-radius: var(--radius); background: none; color: var(--tx); font: inherit; font-size: var(--fs-2); text-align: left; cursor: pointer; }
  .gpal-group { color: var(--tx-mut); font-weight: 600; }
  .gpal-group[data-cur], .gpal-item[data-cur] { background: var(--bg-hover); color: var(--tx-hi); }
  .gpal-group[data-cur]::before, .gpal-item[data-cur]::before { content: ''; position: absolute; left: 0; top: 3px; bottom: 3px; width: 2px; background: var(--focus); }
  .gpal-label { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gpal-label mark { background: none; color: var(--highlight); font-weight: 700; }
  .gpal-n { margin-left: auto; font-size: var(--fs-1); color: var(--tx-mut); font-weight: 400; }
  .gpal-path { flex: 0 1 auto; min-width: 0; margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-1); color: var(--tx-mut); }
  .gpal-hint { flex: none; font-size: 9px; /* micro, below --fs-1: its box is fixed */ padding: 0 4px; border: 1px solid var(--line-3); border-radius: var(--radius); color: var(--warn-ink); }
  .gpal-types { flex: none; display: inline-flex; align-items: center; gap: 2px; margin-left: 4px; }
  .gpal-label + .gpal-types { margin-left: auto; }
  .gpal-types i, .gpal-port i { width: 6px; height: 6px; border-radius: 50%; background: var(--tc); display: inline-block; }
  .gpal-types b { color: var(--tx-ghost); font-weight: 400; font-size: var(--fs-1); }
  .gpal-fav { flex: none; width: 18px; height: 18px; padding: 0; border: 0; background: none; color: var(--tx-ghost); cursor: pointer; font-size: var(--fs-2); line-height: 1; }
  .gpal-fav[aria-pressed='true'] { color: var(--series-yellow); }
  .gpal-item:not([data-cur]) .gpal-fav[aria-pressed='false'] { visibility: hidden; }
  .gpal-none { margin: 10px; color: var(--tx-mut); font-size: var(--fs-2); }
  .gpal-foot { display: flex; flex-wrap: wrap; gap: 3px 6px; padding: 5px 10px; border-top: 1px solid var(--line-1); color: var(--tx-mut); font-size: var(--fs-1); }
  .gpal-foot kbd { font-family: var(--mono); font-size: 9px; /* micro, below --fs-1: its box is fixed */ padding: 0 3px; border: 1px solid var(--line-3); border-radius: var(--radius); color: var(--tx); }
  .gpal-detail { flex: 0 0 240px; min-width: 0; padding: 10px 12px; border-left: 1px solid var(--line-1); background: var(--bg-raised); overflow-y: auto; font-size: var(--fs-2); }
  .gpal-dt { font-family: var(--font-head, var(--font)); font-size: var(--fs-4); font-weight: 600; color: var(--tx-hi); }
  .gpal-dg { margin-top: 2px; color: var(--tx-mut); font-size: var(--fs-1); }
  .gpal-dg code { font-family: var(--mono); }
  .gpal-dh { margin: 8px 0; color: var(--tx); line-height: 1.45; }
  .gpal-ports { display: flex; flex-direction: column; gap: 2px; margin: 8px 0; }
  .gpal-port { display: flex; align-items: center; gap: 6px; font-size: var(--fs-1); }
  .gpal-port em { color: var(--tx-mut); font-style: normal; font-size: var(--fs-1); }
  .gpal-out { justify-content: flex-end; }
  .gpal-dp { margin-top: 6px; color: var(--tx-mut); font-size: var(--fs-1); line-height: 1.5; }
</style>
