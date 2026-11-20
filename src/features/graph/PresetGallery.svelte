<!--
  PresetGallery: the template gallery (lib/graph presets.js PRESETS plus the user's saved presets in
  app.settings 'graph.presets'). Each card shows a mini diagram of the preset's nodes and wires, its
  description and tags. Place adds it to the open graph (slots bound from the document by the controller);
  New graph starts a graph from it. Saved presets can be deleted.
-->
<script>
  import Dialog from '../../ui/kit/Dialog.svelte';
  import Button from '../../ui/kit/Button.svelte';
  import Icon from '../../ui/kit/Icon.svelte';
  import { rank } from './editor/fuzzy.js';
  import { PRESETS } from './deps.js';

  let { app, open = $bindable(false), onplace, onnew } = $props();
  let q = $state('');
  let user = $state.raw([]);
  $effect(() => { if (open) user = app.settings?.get?.('graph.presets') || []; });
  const all = $derived([...PRESETS.map((p) => ({ ...p, key: p.id, title: p.name, help: p.description, aliases: p.tags || [], group: 'Built-in' })),
    ...user.map((p) => ({ ...p, key: p.id, title: p.name || 'Untitled', help: p.description || '', aliases: p.tags || [], group: 'Saved', user: true }))]);
  const shown = $derived(q.trim() ? rank(q, all) : all);
  function removeUser(id) { user = user.filter((p) => p.id !== id); app.settings?.set?.('graph.presets', user); }

  /** Mini diagram: node boxes and straight wires, scaled into 220 x 84. */
  function mini(p) {
    const ns = p.nodes || [];
    if (!ns.length) return { boxes: [], lines: [] };
    const x0 = Math.min(...ns.map((n) => n.x || 0)), y0 = Math.min(...ns.map((n) => n.y || 0));
    const x1 = Math.max(...ns.map((n) => (n.x || 0) + 200)), y1 = Math.max(...ns.map((n) => (n.y || 0) + 90));
    const s = Math.min(212 / Math.max(1, x1 - x0), 76 / Math.max(1, y1 - y0));
    const ox = 4 + (212 - (x1 - x0) * s) / 2, oy = 4 + (76 - (y1 - y0) * s) / 2;
    const at = new Map(ns.map((n) => [n.id, [ox + ((n.x || 0) - x0) * s, oy + ((n.y || 0) - y0) * s]]));
    const w = 200 * s, h = Math.max(6, 70 * s);
    return {
      boxes: ns.map((n) => ({ id: n.id, x: at.get(n.id)[0], y: at.get(n.id)[1], w, h, out: String(n.type).startsWith('out.'), src: String(n.type).startsWith('src.') })),
      lines: (p.links || []).filter((l) => at.has(l.from) && at.has(l.to)).map((l) => ({ a: [at.get(l.from)[0] + w, at.get(l.from)[1] + h / 2], b: [at.get(l.to)[0], at.get(l.to)[1] + h / 2] })),
    };
  }
</script>

<Dialog bind:open title="Graph presets" size="lg">
  <div class="gg">
    <label class="gg-search"><Icon name="search" size={14} /><input bind:value={q} placeholder="Search presets…" aria-label="Search presets" data-autofocus /></label>
    {#if !all.length}
      <p class="gg-none">No presets are available yet (lib/graph/presets.js has not landed). Save a selection with “Save selection as preset…”.</p>
    {/if}
    <div class="gg-grid k-scroll">
      {#each shown as p (p.key)}
        {@const m = mini(p)}
        <article class="gg-card">
          <svg class="gg-mini" viewBox="0 0 220 84" aria-hidden="true">
            {#each m.lines as l, i (i)}<path d={`M${l.a[0]} ${l.a[1]}C${l.a[0] + 14} ${l.a[1]} ${l.b[0] - 14} ${l.b[1]} ${l.b[0]} ${l.b[1]}`} />{/each}
            {#each m.boxes as b (b.id)}<rect x={b.x} y={b.y} width={b.w} height={b.h} rx="1" data-out={b.out ? '' : null} data-src={b.src ? '' : null} />{/each}
          </svg>
          <div class="gg-body">
            <div class="gg-t">{p.title}{#if p.user}<span class="gg-tag">saved</span>{/if}</div>
            <p class="gg-d">{p.help || `${(p.nodes || []).length} nodes`}</p>
            <div class="gg-tags">{#each (p.tags || []).slice(0, 4) as t (t)}<span class="gg-tag">{t}</span>{/each}<span class="gg-n k-num">{(p.nodes || []).length} nodes</span></div>
          </div>
          <div class="gg-acts">
            <Button size="sm" variant="primary" icon="add" onclick={() => { open = false; onplace?.(p); }}>Place</Button>
            {#if !p.user}<Button size="sm" variant="ghost" onclick={() => { open = false; onnew?.(p); }}>New graph</Button>{/if}
            {#if p.user}<Button size="sm" variant="ghost" icon="delete" onclick={() => removeUser(p.id)}>Delete</Button>{/if}
          </div>
        </article>
      {/each}
    </div>
  </div>
</Dialog>

<style>
  .gg { display: flex; flex-direction: column; gap: 10px; min-height: 360px; max-height: 70vh; }
  .gg-search { display: flex; align-items: center; gap: 6px; height: var(--ctl-h); padding: 0 8px; color: var(--tx-mut);
    background: var(--bg-sunken); border: 1px solid var(--line-ctl); border-radius: var(--radius); box-shadow: var(--recess); }
  .gg-search:focus-within { border-color: var(--focus); }
  .gg-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; font: inherit; color: var(--tx-hi); }
  .gg-none { color: var(--tx-mut); }
  .gg-grid { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); grid-auto-rows: max-content; gap: 10px; overflow-y: auto; padding: 2px; }
  .gg-card { display: flex; flex-direction: column; background: var(--bg-card); border: 1px solid var(--line-2); border-radius: var(--radius); }
  .gg-card:hover { border-color: var(--line-4); }
  .gg-mini { display: block; width: 100%; height: 84px; background: var(--bg-sunken); border-bottom: 1px solid var(--line-1); }
  .gg-mini path { fill: none; stroke: var(--series-sky); stroke-width: 1; opacity: .7; }
  .gg-mini rect { fill: var(--bg-card); stroke: var(--line-4); stroke-width: .75; }
  .gg-mini rect[data-out] { stroke: var(--series-pink); }
  .gg-mini rect[data-src] { stroke: var(--series-green); }
  .gg-body { flex: 1; padding: 8px 10px 4px; }
  .gg-t { display: flex; align-items: center; gap: 6px; font-family: var(--font-head, var(--font)); font-weight: 600; color: var(--tx-hi); }
  .gg-d { margin: 4px 0; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; font-size: var(--fs-1); line-height: 1.4; color: var(--tx); }
  .gg-tags { display: flex; flex-wrap: wrap; gap: 3px; align-items: center; }
  .gg-tag { padding: 0 5px; font-size: 9px; /* micro, below --fs-1: its box is fixed */ color: var(--tx-mut); border: 1px solid var(--line-2); border-radius: var(--radius); text-transform: uppercase; letter-spacing: .05em; }
  .gg-n { margin-left: auto; font-size: var(--fs-1); color: var(--tx-mut); }
  .gg-acts { display: flex; gap: 4px; padding: 6px 8px 8px; }
</style>
