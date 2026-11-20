<script>
  // The project page (paw-xn04): every project the app knows as a card (a still, the video, its folder, duration, last
  // opened, how far along it is, the funscript beside it and who wrote it), unsaved autosaves included as their own
  // cards until saved or discarded. Self-contained: props {app, dropping}, no global listeners, opens only through
  // app.tabs.open (app.project.openPaths; the open document's card only switches to its tab, paw-shgb). Model: home.js.
  import { tooltip } from '../ui/kit/tooltip.js';
  import { showContextMenu } from '../ui/kit/contextmenu.js';
  import Button from '../ui/kit/Button.svelte';
  import IconButton from '../ui/kit/IconButton.svelte';
  import Icon from '../ui/kit/Icon.svelte';
  import glyph from '../assets/brand/pawscript-glyph.svg?raw';
  import Badge from '../ui/kit/Badge.svelte';
  import TextField from '../ui/kit/TextField.svelte';
  import { fmtKeys } from './keymap.js';
  import { homeCards, stateLine, ago, shortDir, fmtDuration, summarize, thumbKey, pathKey } from './home.js';
  import { parseAutosave, appDocFrom, VIDEO_EXT } from './project-logic.js';
  import { readProvenance, originText, originLabel } from '../lib/provenance.js';
  import FirstSteps from '../features/onboard/FirstSteps.svelte';

  let { app, dropping = false } = $props();
  const be = $derived(app.backend);
  const k = (id) => fmtKeys(app.commands.keysFor(id)[0] || '');
  const stem = (p) => String(p).replace(/\.[^.\\/]+$/, '');
  const fileName = (p) => String(p).split(/[\\/]/).pop();
  const yes = (p) => Promise.resolve(p).catch(() => null);

  // ---- unsaved autosaves: each snapshot read once per (id, time) for its video and summary ----
  const memo = new Map();
  let autosaves = $state([]);
  async function loadAutosaves() {
    if (typeof be.autosaveList !== 'function') return;
    const list = ((await yes(be.autosaveList())) || []).filter((c) => c.unsaved_work && c.snapshots?.length);
    const out = [];
    for (const c of list) {
      const key = c.id + ':' + c.updated_ms;
      let m = memo.get(key);
      if (!m) {
        try {
          const s = parseAutosave(await be.readText(c.snapshots[0].path)), d = appDocFrom(s.pd, { path: c.project_path || null, base: s.base });
          m = { base: s.base || null, video: d.media?.path || null, summary: summarize(d) };
        } catch { m = { base: null, video: null, summary: null }; }
        memo.set(key, m);
      }
      out.push({ ...c, ...m });
    }
    autosaves = out;
  }

  const recent = $derived(app.project?.recent || []);
  const cards = $derived(homeCards(recent, autosaves));
  $effect(() => { void recent; loadAutosaves(); });

  // ---- what is on disk now, per card: missing files, a still still valid for its video, the script beside the video ----
  let disk = $state({}), diskSeq = 0, recheck = $state(0);
  $effect(() => {
    const list = cards, seq = ++diskSeq;
    void recheck;
    (async () => {
      const out = {};
      await Promise.all(list.map(async (c) => {
        const o = {};
        if (c.path) o.missing = !(await yes(be.exists(c.path)));
        if (c.video) {
          const st = await yes(be.stat?.(c.video));
          o.videoMissing = !st?.exists;
          // a still is shown while it matches the video (a replaced video waits for its next open); video gone: the last still
          o.thumb = c.thumb && (st?.exists ? c.thumbKey === thumbKey(c.path, st) : true) ? c.thumb : null;
          const project = c.kind === 'project' && c.path ? fileName(c.path) : null;
          for (const f of [stem(c.video) + '.pawscript.funscript', stem(c.video) + '.funscript']) {
            const text = await yes(be.readText(f));
            if (text == null) continue;
            let info;
            try { info = readProvenance(JSON.parse(text)); } catch { info = { kind: 'unknown' }; }
            o.script = { file: fileName(f), label: originLabel(info), text: originText(info, { project }), kind: info.kind };
            break;
          }
        }
        out[c.key] = o;
      }));
      if (seq === diskSeq) disk = out;
    })();
  });

  // ---- filter + keyboard ----
  let q = $state(''), filterEl = $state(), gridEl = $state(), rootEl = $state();
  const shown = $derived(q.trim() ? cards.filter((c) => (c.name + ' ' + (c.path || '')).toLowerCase().includes(q.trim().toLowerCase())) : cards);
  $effect(() => { if (rootEl) rootEl.focus({ preventScroll: true }); });   // shown = the home tab picked: the page has the keys

  const cardEls = () => [...(gridEl?.querySelectorAll('.card-open') || [])];
  function onKey(e) {
    // the image labelling workspace opened over the page (no document open: home shows) has the keys, though the page kept
    // the focus: E (grow), A, digits went into the hidden filter until something was clicked (paw-mawd, groups-loosen)
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || app.labelling?.on) return;
    const els = cardEls(), i = els.indexOf(document.activeElement);
    const cols = gridEl ? getComputedStyle(gridEl).gridTemplateColumns.split(' ').length : 1;
    const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    if (move && els.length) {
      if (e.target === filterEl && e.key !== 'ArrowDown') return;
      e.preventDefault();
      els[i < 0 ? 0 : Math.max(0, Math.min(els.length - 1, i + move))].focus();
      return;
    }
    // type to filter: a printable key anywhere on the page but a text field goes to the filter (never Space)
    if (e.key.length === 1 && e.key !== ' ' && e.target !== filterEl && !e.target?.closest?.('input, textarea')) {
      e.preventDefault();
      q += e.key;
      filterEl?.focus();
    }
  }

  // ---- actions ----
  const P = () => app.project;
  const isOpen = (c) => !!app.tabs?.isOpen(c.path);
  // through the tabs (tabs.svelte.js): the open document's own card only switches to its tab, anything else opens a tab
  const openPaths = (paths, opts) => (app.tabs ? app.tabs.open(paths, opts) : P().openPaths(paths, opts));
  const into = (fn) => (app.tabs ? app.tabs.into(fn) : fn(app));
  function open(c) {
    const o = disk[c.key] || {};
    if (isOpen(c)) return app.tabs.showPath(c.path);
    if (c.autosave && (!c.path || o.missing)) return into((a) => a.project.restoreAutosave(c.autosave.id));
    // paw-pjlg: said, with Locate… (the open dialog never appears by itself on a click)
    if (o.missing) { app.toast(`${c.name} is no longer at ${c.path}`, 'warn', { timeout: 10000, action: { label: 'Locate…', run: () => locate(c) } }); return false; }
    return openPaths([c.path], { recover: !!c.autosave });
  }
  // a new empty script in a tab of its own (one-document harnesses: it replaces the open one, written and closed, no question)
  function emptyScript() {
    return into(async (a) => {
      if (a.project?.hasDoc && !(await a.project.close())) return false;
      a.load({ axes: { stroke: [] } });
      return true;
    });
  }
  async function locate(c) {
    const proj = c.kind === 'project';
    const p = await be.openDialog({ title: `Locate ${fileName(c.path)}`, multiple: false, filters: [proj ? { name: 'Pawscript project', extensions: ['pawproj'] } : { name: 'Video', extensions: VIDEO_EXT }] });
    const picked = Array.isArray(p) ? p[0] : p;
    if (!picked) return;
    P().removeRecent(c.path);
    openPaths([picked]);
  }
  const ownerOf = (c) => (app.tabs?.appFor(c.path) || app).project;   // the open card's own tab's project
  async function discard(c) { if (await P().discardAutosave(c.autosave.id, c.name)) { memo.clear(); loadAutosaves(); } }
  function menuItems(c) {
    const o = disk[c.key] || {}, where = c.path && !o.missing ? c.path : c.video && !o.videoMissing ? c.video : null;
    return [
      { label: 'Open', icon: 'folder-open', run: () => open(c) },
      ...(o.missing && !c.autosave ? [{ label: 'Locate…', icon: 'search', run: () => locate(c) }] : []),
      ...(where ? [{ label: 'Show in folder', icon: 'folder', run: () => be.reveal?.(where) }] : []),
      // paw-up1r: the open project's automatic checkpoints (after a track, before a discard, on close): back to one (the state left is one too)
      // stage 2: commits / publishes by their note or version; "Project history" opens the full list beside the editor (the
      // card's own tab: paw-shgb)
      ...(isOpen(c) && ownerOf(c).checkpoints?.length ? [{ label: 'Go back to…', icon: 'history', items: ownerOf(c).checkpoints.slice(0, 40).map((x) => ({ label: `${x.kind === 'publish' ? `v${x.version} ` : x.kind === 'commit' ? 'Commit ' : ''}${x.note ? '“' + x.note + '”' : x.kind === 'commit' || x.kind === 'publish' ? '' : x.label} · ${ago(x.at)}`.replace(/\s+·/, ' ·'), run: async () => { if (await ownerOf(c).restoreCheckpoint(x.id)) app.tabs.showPath(c.path); } })) },
        { label: 'Project history', icon: 'history', run: () => { app.tabs.showPath(c.path); (app.tabs.appFor(c.path) || app).showPanel?.('history.entries'); } }] : []),
      ...(c.kind !== 'unsaved' && c.path && !c.key.startsWith('autosave:') ? [{ label: c.pinned ? 'Unpin' : 'Pin to the top', icon: 'pin', run: () => P().pinRecent(c.path, !c.pinned) }] : []),
      { separator: true },
      ...(c.autosave && !isOpen(c) ? [{ label: c.unsaved ? 'Discard unsaved work…' : 'Discard recovered changes…', icon: 'trash', run: () => discard(c) }] : []),
      ...(!c.unsaved && c.path && !c.key.startsWith('autosave:') ? [{ label: 'Remove from list', icon: 'close', run: () => P().removeRecent(c.path) }] : []),
    ];
  }
  const tipFor = (c, o) => [c.path, c.video && c.video !== c.path ? 'Video: ' + c.video : '', o.script ? `${o.script.file}: ${o.script.text}` : ''].filter(Boolean).join('\n');
</script>

<!-- files moved or edited in Explorer meanwhile: look again when the window comes back -->
<svelte:window onfocus={() => { recheck++; loadAutosaves(); }} />

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (the page takes focus so arrows and type-to-filter work at once) -->
<div class="home" class:dropping bind:this={rootEl} tabindex="-1" role="region" aria-label="Projects" onkeydown={onKey} data-arrow-nav>
  <header class="head">
    <div class="brand">
      <span class="mark" aria-hidden="true">{@html glyph}</span>
      <h1>Projects</h1>
    </div>
    {#if cards.length}<TextField bind:value={q} bind:inputEl={filterEl} icon="search" clearable size="sm" placeholder="Filter by name" class="filter" />{/if}
    <div class="acts">
      <Button variant="primary" icon="folder-open" shortcut={k('file.open')} data-command="file.open" onclick={() => app.commands.run('file.open')}>Open video or project…</Button>
      <Button icon="import" shortcut={k('file.import')} data-command="file.import" onclick={() => app.commands.run('file.import')}>Import funscript…</Button>
      <Button icon="add" onclick={emptyScript}>Empty script</Button>
    </div>
  </header>

  {#if !cards.length}
    <div class="empty">
      <Icon name="film" size={28} />
      <p>Open a video to start a project, or drop a video, funscripts or a .pawproj anywhere in this window.</p>
      <!-- paw-kxwz / paw-a0eg: the five steps with their keys and the quick start (F1, docs/guide/quick-start.md) -->
      <FirstSteps {app} />
    </div>
  {:else}
    <div class="grid" bind:this={gridEl} data-testid="project-cards">
      {#each shown as c (c.key)}
        {@const o = disk[c.key] || {}}
        {@const s = stateLine(c.summary)}
        <article class="card" class:missing={o.missing && !c.autosave} class:gone={o.videoMissing} data-testid="project-card" data-path={c.path || ''} data-unsaved={c.unsaved ? '1' : ''}
          oncontextmenu={(e) => showContextMenu(e, menuItems(c))}>
          <button class="card-open" onclick={() => open(c)} {@attach tooltip(tipFor(c, o))}>
            <div class="thumb">
              {#if o.thumb}<img src={be.mediaUrl(o.thumb)} alt="" loading="lazy" draggable="false" onerror={(e) => { e.currentTarget.style.display = 'none'; }} />{/if}
              <Icon name={c.kind === 'unsaved' || c.kind === 'video' || c.video ? 'film' : c.kind === 'project' ? 'layers' : 'stroke'} size={22} class="ph" />
              <div class="badges">
                {#if isOpen(c)}<Badge tone="ok" variant="solid">open</Badge>{/if}
                {#if c.unsaved}<Badge tone="warn" variant="solid">not saved yet</Badge>
                {:else if c.autosave}<Badge tone="info" variant="solid">unsaved changes recovered</Badge>{/if}
                {#if o.missing && !c.autosave}<Badge tone="bad" variant="solid">missing</Badge>
                {:else if o.videoMissing}<Badge tone="bad" variant="solid">video missing</Badge>{/if}
              </div>
              {#if c.summary?.durationMs}<span class="dur k-num">{fmtDuration(c.summary.durationMs)}</span>{/if}
            </div>
            <div class="body">
              <span class="nm">{c.name}</span>
              <span class="meta"><span class="dir">{shortDir(c.path || c.video || '')}</span><span class="when">{ago(c.openedAt)}</span></span>
              {#if s.length}<span class="state">{s.join(' · ')}</span>{/if}
              <span class="script" class:none={!o.script} class:ours={o.script?.kind === 'pawscript'} class:changed={o.script?.kind === 'changed'} data-testid="card-script">
                {#if o.script}<Icon name="stroke" size={12} /> {o.script.file}: {o.script.label}{:else if c.video}no funscript beside the video{/if}
              </span>
            </div>
          </button>
          <IconButton icon="more" size="sm" label="More" class="more" onclick={(e) => showContextMenu(e.currentTarget, menuItems(c))} />
        </article>
      {/each}
      {#if !shown.length}<p class="k-hint nomatch">Nothing matches “{q}”.</p>{/if}
    </div>
  {/if}
  <p class="k-hint foot" data-testid="project-footer">Explicit content, legal age only · Free software under the GPL · No telemetry, online only when you ask</p>
</div>

<style>
  .home { position: relative; height: 100%; overflow: auto; display: flex; flex-direction: column; gap: var(--space-6); padding: var(--space-6) var(--space-7) var(--space-5); background: radial-gradient(ellipse at 50% 0%, rgba(var(--reality-rgb), .05), transparent 55%), var(--bg); outline: none; }
  .home.dropping { outline: 2px dashed var(--reality); outline-offset: -10px; }
  .head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-4) var(--space-6); max-width: 2200px; width: 100%; margin: 0 auto; }
  .brand { display: flex; align-items: center; gap: var(--space-4); color: var(--highlight); }
  .brand .mark :global(svg) { display: block; width: 24px; height: 24px; filter: drop-shadow(0 0 8px rgba(var(--highlight-rgb), .35)); }
  h1 { font: 500 var(--fs-6) var(--font-head, var(--font)); letter-spacing: .02em; color: var(--tx-hi); }
  .head :global(.filter) { width: 240px; }
  .foot { margin-top: auto; text-align: center; }
  .acts { display: flex; flex-wrap: wrap; gap: var(--space-3); margin-left: auto; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(clamp(250px, 15vw, 400px), 1fr)); gap: var(--space-5); align-content: start; max-width: 2200px; width: 100%; margin: 0 auto; }
  .card { position: relative; min-width: 0; border: 1px solid var(--line-1); border-radius: var(--radius); background: var(--bg-raised); overflow: hidden; transition: border-color var(--t-quick); }
  .card:hover, .card:focus-within { border-color: var(--line-3); }
  .card.missing { opacity: .6; }
  .card.gone .thumb img { filter: grayscale(1) brightness(.6); }
  .card-open { display: flex; flex-direction: column; width: 100%; text-align: left; color: var(--tx); }
  .card-open:focus-visible { outline: var(--ring-w, 2px) solid var(--focus); outline-offset: -2px; }
  .thumb { position: relative; aspect-ratio: 16 / 9; display: grid; place-items: center; background: var(--bg-sunken); overflow: hidden; }
  .thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 1; }
  .thumb :global(.ph) { color: var(--tx-ghost); }
  .badges { position: absolute; z-index: 2; top: var(--space-3); left: var(--space-3); display: flex; flex-wrap: wrap; gap: var(--space-2, 4px); }
  .dur { position: absolute; z-index: 2; right: var(--space-3); bottom: var(--space-3); padding: 1px 5px; border-radius: var(--radius); background: var(--media-scrim); color: var(--on-media); font-size: var(--fs-1); }
  .body { display: grid; gap: 3px; padding: var(--space-4); min-width: 0; }
  .nm { color: var(--tx-hi); font-size: var(--fs-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { display: flex; gap: var(--space-4); font-size: var(--fs-1); color: var(--tx-mut); min-width: 0; }
  .dir { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .when { flex: none; }
  .state { font-size: var(--fs-1); color: var(--tx); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: calc(2 * 1.35em); line-height: 1.35; }
  .script { display: flex; align-items: center; gap: 4px; font-size: var(--fs-1); color: var(--tx-mut); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-height: 16px; }
  .script.ours { color: var(--ok-ink, var(--ok)); }
  .script.changed { color: var(--warn-ink, var(--warn)); }
  .script.none { color: var(--tx-faint); }
  .card :global(.more) { position: absolute; z-index: 3; top: var(--space-3); right: var(--space-3); background: var(--media-scrim); color: var(--on-media); opacity: 0; }
  .card:hover :global(.more), .card:focus-within :global(.more) { opacity: 1; }
  .empty { flex: 1; display: grid; place-content: center; justify-items: center; gap: var(--space-4); color: var(--tx-mut); text-align: center; }
  .empty p { max-width: 460px; }
  .nomatch { grid-column: 1 / -1; }
</style>
