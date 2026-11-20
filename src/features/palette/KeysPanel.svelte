<script>
  // Keybinding editor (in KeysModal: Ctrl+Alt+K, F1's Edit shortcuts). Click a binding to capture new keys (a chord, or up to three chords
  // as a sequence); Enter or leaving the cell saves, Esc cancels, Backspace clears (or, with nothing typed,
  // removes the binding). While capturing, a capture-phase window listener eats every key so the app's keymap
  // never sees it. Overrides persist through app.commands.setKeys (settings 'keys.overrides').
  import { tick } from 'svelte';
  import { ui } from './state.svelte.js';
  import { rank, segments } from './fuzzy.js';
  import { groupByMenu, conflictsById, describeConflict, nextKeys, previewConflicts } from './logic.js';
  import { eventChord, numpadChord, fmtKeys } from '../../app/keymap.js';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import Icon from '../../ui/kit/Icon.svelte';
  import Keys from './Keys.svelte';
  import Prop from '../../app/Prop.svelte';
  import './palette.css';

  let { app } = $props();
  let q = $state('');
  let filter = $state('all');          // 'all' | 'changed' | 'conflicts'
  let keyFilter = $state('');          // a chord picked with "find by key"
  let cap = $state(null);              // {id, slot, chords, mods, literal}; id null = capturing for "find by key"
  let search = $state(), root = $state();

  const all = $derived(app.commands.list());
  const titles = $derived(new Map(all.map((c) => [c.id, c.title])));
  const title = (id) => titles.get(id) || id;
  const conf = $derived(conflictsById(app.commands.conflicts()));
  const over = $derived(new Set(all.filter((c) => app.commands.isOverridden(c.id)).map((c) => c.id)));
  const nConf = $derived(all.filter((c) => conf.has(c.id)).length);
  const userConflict = (list) => list.some((x) => x.ids.some((id) => over.has(id)));

  const rows = $derived.by(() => {
    let list = all;
    if (filter === 'changed') list = list.filter((c) => over.has(c.id));
    else if (filter === 'conflicts') list = list.filter((c) => conf.has(c.id));
    if (keyFilter) list = list.filter((c) => c.keys.some((k) => k === keyFilter || k.startsWith(keyFilter + ' ')));
    const text = q.trim();
    if (text) return rank(list, text, { fields: (c) => [c.title, c.menu, c.id, c.keys.map(fmtKeys).join(' ')] }).map((r) => ({ c: r.item, hits: r.hits[0] }));
    return groupByMenu(list).flatMap((g) => [{ head: g.menu }, ...g.items.map((c) => ({ c, hits: [] }))]);
  });
  const shown = $derived(rows.filter((r) => r.c).length);
  // ~530 rows at once is a 100+ ms task and 8 000 elements: render a page, grow it as the end scrolls into view
  const PAGE = 80;
  let limit = $state(PAGE);
  $effect(() => { q; filter; keyFilter; limit = PAGE; });
  const visible = $derived(rows.length > limit ? rows.slice(0, limit) : rows);
  function more(el) {
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) limit += PAGE * 2; }, { root: el.closest('.scroll'), rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }

  // ---- capture ----
  const modsOf = (e) => [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean).join('+');
  const candidate = $derived(cap?.id ? cap.chords.join(' ') : '');
  const preview = $derived.by(() => {
    if (!candidate) return [];
    const bindings = all.flatMap((c) => c.keys.map((k) => [c.id, k]));
    const slot = cap.slot < app.commands.keysFor(cap.id).length ? cap.slot : -1;
    return previewConflicts(bindings, cap.id, slot, candidate);
  });

  function start(id, slot) { cap = { id, slot, chords: [], mods: '', literal: false }; }

  /** Attachment on the capture cell: focus it and own the keyboard until it goes away. */
  function capturing(el) {
    el.focus();
    const down = (e) => {
      const ch = numpadChord(e) || eventChord(e);   // paw-5zpf: a NumPad digit records as its own key (Num5)
      // Tab leaves the cell (keyboard users), it is never recorded; the blur ends the capture
      if ((ch === 'Tab' || ch === 'Shift+Tab') && !cap?.literal) { e.stopImmediatePropagation(); end(false); return; }
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!cap || e.repeat || e.isComposing) return;
      if (!ch) { cap.mods = modsOf(e); return; }
      if (cap.id == null) { if (ch !== 'Escape') { keyFilter = ch; filter = 'all'; } end(); return; }
      if (cap.literal) record(ch);   // "record Enter / Esc / Backspace as keys": saved with the Save button
      else if (ch === 'Escape') end();
      else if (ch === 'Enter') commit();
      else if (ch === 'Backspace') { if (cap.chords.length) cap.chords = []; else commit(true); }
      else record(ch);
    };
    const record = (ch) => {
      cap.chords = [...cap.chords, ch];
      cap.mods = '';
      if (cap.chords.length === 3) commit();
    };
    const up = (e) => { e.stopImmediatePropagation(); if (cap) cap.mods = modsOf(e); };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); };
  }

  async function refocus(id, slot) {
    await tick();
    if (id == null) return root?.querySelector('.findkey')?.focus();
    const tr = root?.querySelector(`tr[data-id="${CSS.escape(id)}"]`);
    (tr?.querySelectorAll('.key')[slot] || tr?.querySelector('.add'))?.focus();
  }
  // `focus` is false when the cell lost focus to a click elsewhere: focus stays where the user put it.
  function end(focus = true) {
    if (!cap) return;
    const { id, slot } = cap;
    cap = null;
    if (focus) refocus(id, slot);
  }
  /** Save the captured keys into binding `slot` (or remove that binding). Back to the defaults = no override. */
  function commit(remove = false, focus = true) {
    if (!cap) return;
    const { id, slot, chords } = cap;
    const cur = app.commands.keysFor(id);
    if (id == null || (remove ? slot >= cur.length : !chords.length)) return end(focus);
    cap = null;
    app.commands.setKeys(id, nextKeys(cur, app.commands.defaultKeys(id), slot, remove ? null : chords.join(' ')));
    if (focus) refocus(id, remove ? slot - 1 : slot);
  }
  function removeAt(c, i) {
    app.commands.setKeys(c.id, nextKeys(c.keys, app.commands.defaultKeys(c.id), i, null));
    refocus(c.id, Math.max(0, i - 1));
  }
  async function resetAll() {
    const n = over.size;
    const ok = await app.confirm({ title: 'Reset all shortcuts?', message: `${n} customized command${n === 1 ? '' : 's'} go back to the default keys`, ok: 'Reset all', danger: true });
    if (ok) app.commands.resetAll();
  }
  const defaultsText = (id) => (app.commands.defaultKeys(id)).map(fmtKeys).join(', ') || 'none';

  // palette.keys asks for focus: the search, or ({id, slot}, a right-click's Assign / Change shortcut) that command found and
  // capturing keys for its binding `slot` (-1: a new one)
  $effect(() => {
    const f = ui.focusKeys;
    if (!f) return;
    ui.focusKeys = false;
    const c = typeof f === 'object' ? app.commands.get(f.id) : null;
    if (c) {
      q = c.title || c.id; filter = 'all'; keyFilter = '';
      const n = app.commands.keysFor(c.id).length;
      tick().then(() => start(c.id, f.slot >= 0 && f.slot < n ? f.slot : n));
      return;
    }
    tick().then(() => { root?.scrollIntoView?.({ block: 'nearest' }); search?.focus(); search?.select(); });
  });

  function searchKey(e) {
    if (e.key === 'Escape' && (q || keyFilter)) { q = ''; keyFilter = ''; e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'ArrowDown') { root?.querySelector('tbody .key, tbody .add')?.focus(); e.preventDefault(); e.stopPropagation(); }
  }
</script>

{#snippet capture()}
  <button class="cap" aria-label="Press the new keys, Enter saves, Escape cancels" {@attach capturing} onblur={() => commit(false, false)}>
    {#each cap.chords as ch, i (i)}<Keys keys={ch} />{/each}
    {#if cap.mods}<span class="held">{cap.mods}+…</span>{:else if !cap.chords.length}<span class="wait">Press keys…</span>{/if}
  </button>
{/snippet}

<div class="kp" bind:this={root}>
  <div class="tools">
    <label class="pp-search find"><Icon name="search" size={12} />
      <input type="text" bind:this={search} bind:value={q} onkeydown={searchKey} spellcheck="false" placeholder="Search commands or keys" aria-label="Search shortcuts" /></label>
    {#if cap && cap.id == null}
      <button class="pp-btn on findkey" {@attach capturing} onblur={() => end(false)}>{#if cap.mods}{cap.mods}+…{:else}Press a key…{/if}</button>
    {:else if keyFilter}
      <span class="keyf"><Keys keys={keyFilter} /><button class="x" aria-label="Clear key filter" onclick={() => (keyFilter = '')}><Icon name="close" size={10} /></button></span>
    {:else}
      <button class="pp-btn findkey" onclick={() => start(null, 0)} {@attach tooltip('Find the command a key runs: press it')}><Icon name="keyboard" size={14} />Find by key</button>
    {/if}
    <div class="seg" role="radiogroup" aria-label="Show">
      <button role="radio" aria-checked={filter === 'all'} class="pp-btn" class:on={filter === 'all'} onclick={() => (filter = 'all')}>All</button>
      <button role="radio" aria-checked={filter === 'changed'} class="pp-btn" class:on={filter === 'changed'} onclick={() => (filter = 'changed')}>Changed <span class="n">{over.size}</span></button>
      <button role="radio" aria-checked={filter === 'conflicts'} class="pp-btn" class:on={filter === 'conflicts'} onclick={() => (filter = 'conflicts')}>Conflicts <span class="n" class:pp-warn={nConf}>{nConf}</span></button>
    </div>
    <span class="k-hint">{shown} command{shown === 1 ? '' : 's'}</span>
    <!-- paw-5zpf: the keymap preset these defaults come from; your own keys win over either and survive a switch -->
    <Prop {app} key="keys.preset" expand label="Keymap" data-testid="keys-preset" tip="Default keys: Blender or OFS; your own keys stay" />
    <span class="grow"></span>
    <button class="pp-btn danger" disabled={!over.size} onclick={resetAll}><Icon name="refresh" size={12} />Reset all</button>
  </div>

  <div class="scroll k-scroll">
    <table>
      <thead><tr><th class="k-caps">Command</th><th class="k-caps">Keys</th><th class="act"><span class="k-sr">Reset</span></th></tr></thead>
      <tbody>
        {#each visible as r (r.c ? r.c.id : 'h:' + r.head)}
          {#if !r.c}
            <tr class="sec"><th colspan="3" class="k-caps">{r.head}</th></tr>
          {:else}
            {@const c = r.c}
            {@const notes = conf.get(c.id)}
            {@const mine = cap?.id === c.id}
            <tr data-id={c.id} class:over={over.has(c.id)} class:mine>
              <td class="cmd">
                <span class="t">{#each segments(c.title, r.hits) as s, j (j)}{#if s.on}<mark>{s.t}</mark>{:else}{s.t}{/if}{/each}</span>
                {#if q.trim() && c.menu}<span class="tag">{c.menu}</span>{/if}
                {#if c.hidden}<span class="tag" {@attach tooltip('Not in menus or the palette, the keys still work')}>keys only</span>{/if}
                <span class="id">{c.id}</span>
              </td>
              <td class="bind">
                <div class="chips">
                  {#each c.keys as k, i (k)}
                    {#if mine && cap.slot === i}{@render capture()}
                    {:else}
                      {@const hot = notes?.find((x) => x.keys === k || x.longer === k)}
                      <span class="chip" class:warn={hot && userConflict([hot])} class:shared={hot && !userConflict([hot])}>
                        <button class="key" onclick={() => start(c.id, i)} aria-label="Change {fmtKeys(k)} for {c.title}"><Keys keys={k} /></button>
                        <button class="x" onclick={() => removeAt(c, i)} aria-label="Remove {fmtKeys(k)} from {c.title}" {@attach tooltip('Remove this binding')}><Icon name="close" size={10} /></button>
                      </span>
                    {/if}
                  {/each}
                  {#if mine && cap.slot >= c.keys.length}{@render capture()}
                  {:else}
                    <button class="add" onclick={() => start(c.id, c.keys.length)} aria-label="Add a binding for {c.title}" {@attach tooltip(c.keys.length ? 'Add another binding' : 'Add a binding')}><Icon name="add" size={10} />{#if !c.keys.length}<span>Add</span>{/if}</button>
                  {/if}
                </div>
                {#if mine}
                  {#each preview as x, i (i)}<div class="note pp-warn"><Icon name="warning" size={12} />{describeConflict(x, c.id, [candidate], title)}</div>{/each}
                  {#if cap.literal}
                    <div class="note k-hint">Every key is recorded, Enter, Esc and Backspace too.
                      <button class="pp-btn" onpointerdown={(e) => e.preventDefault()} onclick={() => commit()}>Save</button>
                      <button class="pp-btn ghost" onpointerdown={(e) => e.preventDefault()} onclick={() => end()}>Cancel</button></div>
                  {:else}
                    <div class="note k-hint"><Keys keys="Enter" /> save · <Keys keys="Escape" /> cancel · <Keys keys="Backspace" /> {cap.chords.length ? 'clear' : cap.slot < c.keys.length ? 'remove binding' : 'nothing to clear'} · another chord makes a sequence ·
                      <button class="pp-btn ghost lit" onpointerdown={(e) => e.preventDefault()} onclick={() => { cap.literal = true; cap.chords = []; }}>record Enter / Esc / Backspace</button></div>
                  {/if}
                {:else if notes}
                  {#each notes as x, i (i)}
                    {@const user = userConflict([x])}
                    <div class="note" class:pp-warn={user} class:pp-info={!user}><Icon name={user ? 'warning' : 'info'} size={12} />{describeConflict(x, c.id, c.keys, title)}{#if !user}<span class="why"> (defaults; whichever applies right now runs)</span>{/if}</div>
                  {/each}
                {/if}
              </td>
              <td class="act">
                {#if over.has(c.id)}
                  <button class="pp-btn ghost sq" onclick={() => app.commands.setKeys(c.id, null)} aria-label="Reset {c.title} to its default keys" {@attach tooltip('Reset to default: ' + defaultsText(c.id))}><Icon name="undo" size={12} /></button>
                {/if}
              </td>
            </tr>
          {/if}
        {/each}
        {#if visible.length < rows.length}<tr class="more" {@attach more}><td colspan="3" class="k-hint">{rows.length - visible.length} more…</td></tr>{/if}
        {#if !shown}
          <tr><td colspan="3" class="empty k-hint">{filter === 'changed' ? 'No shortcut has been changed.' : filter === 'conflicts' ? 'No conflicts.' : 'Nothing matches.'}</td></tr>
        {/if}
      </tbody>
    </table>
  </div>
</div>

<style>
  .kp { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--bg); color: var(--tx); font: var(--fs-ui) / var(--lh) var(--font); }
  .key, .x, .add, .cap { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
  .tools { display: flex; align-items: center; gap: var(--space-4); padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--line-1); background: var(--bg-raised); flex: none; flex-wrap: wrap; }
  .find { width: 220px; }
  .grow { flex: 1; }
  .seg { display: inline-flex; }
  .seg .pp-btn { border-radius: 0; margin-left: -1px; }
  .seg .pp-btn:first-child { border-radius: var(--radius) 0 0 var(--radius); margin-left: 0; }
  .seg .pp-btn:last-child { border-radius: 0 var(--radius) var(--radius) 0; }
  .seg .pp-btn.on { position: relative; z-index: 1; }
  .n { font: var(--fs-1) var(--mono); color: var(--tx-mut); }
  .on .n { color: inherit; }
  .keyf { display: inline-flex; align-items: center; gap: var(--space-2); padding: 0 var(--space-2); height: var(--ctl-h-sm); border: var(--bw) solid var(--reality); border-radius: var(--radius); color: var(--accent-ink); }
  .scroll { flex: 1; min-height: 0; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead th { position: sticky; top: 0; z-index: 1; background: var(--bg-raised); text-align: left; padding: var(--space-2) var(--space-4); border-bottom: 1px solid var(--line-1); font-weight: 500; }
  thead th:first-child { width: 38%; }
  th.act, td.act { width: 40px; }
  .sec th { text-align: left; padding: var(--space-4) var(--space-4) var(--space-2); color: var(--tx-val); border-bottom: 1px solid var(--line-1); }
  td { padding: var(--space-2) var(--space-4); border-bottom: 1px solid var(--line-0); vertical-align: top; }
  tr:hover td { background: var(--bg-hover); }
  tr.mine td { background: var(--sel-bg); }
  .cmd { padding-top: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .t { color: var(--tx); }
  tr.over .t { color: var(--tx-hi); }
  tr.over .t::after { content: '•'; margin-left: var(--space-2); color: var(--accent-ink); }
  .t mark { background: none; color: var(--accent-ink); text-decoration: underline; text-underline-offset: 2px; }
  .id { margin-left: var(--space-3); font: var(--fs-1) var(--mono); color: var(--tx-mut); white-space: nowrap; }
  .tag { margin-left: var(--space-3); padding: 0 var(--space-2); font-size: var(--fs-1); color: var(--tx-mut); border: 1px solid var(--line-2); border-radius: var(--radius); white-space: nowrap; }
  .chips { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); min-height: var(--ctl-h-sm); }
  .chip { display: inline-flex; align-items: stretch; height: var(--ctl-h-sm); border: var(--bw) solid var(--line-2); border-radius: var(--radius); color: var(--tx-val); }
  .chip:hover { border-color: var(--line-ctl); }
  .chip.warn { border-color: var(--warn); color: var(--warn-ink); }
  .chip.shared { border-style: dashed; }
  .key { display: inline-flex; align-items: center; padding: 0 var(--space-2); }
  .key:hover { color: var(--tx-hi); background: var(--bg-hover); }
  .x { display: inline-grid; place-items: center; width: 18px; color: var(--tx-mut); }
  .chip .x { border-left: 1px solid var(--line-1); }
  .x:hover { color: var(--bad-ink); background: var(--bg-hover); }
  .add { display: inline-flex; align-items: center; gap: var(--space-2); height: var(--ctl-h-sm); padding: 0 var(--space-2); color: var(--tx-mut); border: var(--bw) dashed var(--line-2); border-radius: var(--radius); font-size: var(--fs-2); opacity: .6; }
  tr:hover .add, .add:focus-visible, .add:only-child { opacity: 1; }
  .add:hover { color: var(--tx-hi); border-color: var(--line-ctl); }
  .cap { display: inline-flex; align-items: center; gap: var(--space-3); height: var(--ctl-h-sm); min-width: 120px; padding: 0 var(--space-3);
    border: var(--bw) solid var(--focus); border-radius: var(--radius); background: var(--bg-sunken); color: var(--tx-hi); box-shadow: var(--glow-highlight); outline: none; }
  .wait, .held { color: var(--tx-mut); font-size: var(--fs-2); animation: blink calc(var(--t-slow) * 4) steps(2, jump-none) infinite; }
  .held { font-family: var(--mono); font-size: var(--fs-1); }
  @keyframes blink { 50% { opacity: .55; } }
  .note { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-2); font-size: var(--fs-2); }
  .note :global(.pk) { color: var(--tx-val); }
  .why { color: var(--tx-mut); }
  .sq { width: var(--ctl-h-sm); padding: 0; }
  .empty { padding: var(--space-6) var(--space-4); text-align: center; }
  .more td { padding: var(--space-4); text-align: center; }
  .note .pp-btn { margin-left: var(--space-2); }
  .lit { min-height: 0; padding: 0 var(--space-2); font-size: var(--fs-1); }
  button:focus-visible { outline: var(--ring-w) solid var(--focus); outline-offset: var(--ring-offset); }
</style>
