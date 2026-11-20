<script>
  // Gallery.svelte -- the kit's full gallery (dev/kit.html with no ?demo). Top bar: theme, density, reduced
  // motion, side by side (the section in all three themes, data-theme on each column). Left nav: every
  // family demo found by dev/kit.js plus the gallery's own pages. Deep links: #<section>, #<section>/full
  // (no gallery chrome; screenshots of the editor mock), #<section>/sbs (side by side).
  import { setTheme, setDensity, THEMES, DENSITIES } from '../tokens.js';
  import { kit, failed as failedKit } from './kit.svelte.js';

  let { demos = {} } = $props();

  const title = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const families = Object.entries(demos)
    .map(([path, load]) => {
      const label = path.split('/').pop().replace('Demo.svelte', '');
      return { id: label.toLowerCase(), label, load };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const own = [
    { id: 'consistency', label: 'Consistency', load: () => import('./Consistency.svelte') },
    { id: 'mock', label: 'Editor mock', load: () => import('./EditorMock.svelte'), fill: true },
    { id: 'e2e', label: 'E2E fixtures', load: () => import('./E2E.svelte') },
  ];
  const all = [...families, ...own];

  const html = document.documentElement;
  let theme = $state(html.dataset.theme || 'dark');
  let density = $state(html.dataset.density || 'default');
  let motion = $state(html.dataset.motion === 'reduce');

  function parseHash() {
    const [id = '', ...flags] = decodeURIComponent(location.hash.slice(1)).split('/');
    return { id: all.some((s) => s.id === id) ? id : 'mock', full: flags.includes('full'), sbs: flags.includes('sbs') };
  }
  let route = $state(parseHash());
  const section = $derived(all.find((s) => s.id === route.id));
  const mod = $derived(section.load());

  function go(patch) {
    const r = { ...route, ...patch };
    location.hash = [r.id, r.full && 'full', r.sbs && 'sbs'].filter(Boolean).join('/');
  }

  $effect(() => {
    setTheme(theme); setDensity(density);
    if (motion) html.dataset.motion = 'reduce'; else delete html.dataset.motion;
    const q = new URLSearchParams(location.search);
    q.set('theme', theme); q.set('density', density);
    if (motion) q.set('motion', 'reduce'); else q.delete('motion');
    history.replaceState(null, '', '?' + q + location.hash);
  });

  const themeOpts = THEMES.map((t) => ({ value: t.id, label: t.id === 'contrast' ? 'Contrast' : t.label }));
  const densityOpts = DENSITIES.map((d) => ({ value: d, label: title(d) }));
  const loaded = $derived(Object.keys(kit).length);
  const broken = $derived(Object.keys(failedKit));
</script>

<svelte:window onhashchange={() => (route = parseHash())} />

{#snippet seg(label, opts, value, set)}
  {#if kit.SegmentedControl}
    <kit.SegmentedControl {label} options={opts} {value} size="sm" onchange={set} />
  {:else}
    <span class="fb-seg" role="radiogroup" aria-label={label}>
      {#each opts as o}
        <button type="button" role="radio" aria-checked={o.value === value} onclick={() => set(o.value)}>{o.label}</button>
      {/each}
    </span>
  {/if}
{/snippet}

{#snippet toggle(label, on, set, testid)}
  {#if kit.ToggleButton}
    <kit.ToggleButton pressed={on} size="sm" variant="default" onchange={set} data-testid={testid}>{label}</kit.ToggleButton>
  {:else}
    <button type="button" class="fb-btn" aria-pressed={on} onclick={() => set(!on)} data-testid={testid}>{label}</button>
  {/if}
{/snippet}

{#snippet body()}
  <svelte:boundary>
    {#await mod}
      <p class="k-hint pad">Loading {section.label}…</p>
    {:then m}
      <m.default />
    {:catch e}
      <pre class="err pad">{section.label} failed to load:
{e?.message || e}</pre>
    {/await}
    {#snippet failed(e, reset)}
      <pre class="err pad">{section.label} threw while rendering:
{e?.message || e}</pre>
      <button type="button" class="fb-btn" onclick={reset}>Retry</button>
    {/snippet}
  </svelte:boundary>
{/snippet}

{#snippet view()}
  {#if route.sbs}
    <div class="sbs">
      {#each THEMES as t}
        <div class="col" data-theme={t.id}>
          <p class="k-caps col-head">{t.label}</p>
          <div class="col-body" class:fill={section.fill}>{@render body()}</div>
        </div>
      {/each}
    </div>
  {:else}
    {@render body()}
  {/if}
{/snippet}

{#if route.full}
  <main class="full" class:fill={section.fill && !route.sbs} data-testid="gallery-full">{@render view()}</main>
{:else}
  <div class="gallery" data-testid="gallery">
    <header class="top">
      <strong class="brand">Pawscript kit</strong>
      <span class="k-sep"></span>
      {@render seg('Theme', themeOpts, theme, (v) => (theme = v))}
      {@render seg('Density', densityOpts, density, (v) => (density = v))}
      {@render toggle('Reduced motion', motion, (v) => (motion = v), 'g-motion')}
      {@render toggle('Side by side', route.sbs, (v) => go({ sbs: v }), 'g-sbs')}
      <span class="grow"></span>
      <a class="k-hint" href={'#' + [route.id, 'full', route.sbs && 'sbs'].filter(Boolean).join('/')}>Full page</a>
    </header>
    <nav class="nav k-scroll" aria-label="Sections">
      <p class="k-caps head">Families</p>
      {#each families as s}
        <a href={'#' + s.id} aria-current={s.id === route.id ? 'page' : undefined}>{s.label}</a>
      {/each}
      <p class="k-caps head">System</p>
      {#each own as s}
        <a href={'#' + s.id} aria-current={s.id === route.id ? 'page' : undefined}>{s.label}</a>
      {/each}
      <p class="k-hint foot">
        <span class="k-num">{loaded}</span> components loaded
        {#if broken.length}<br /><span class="bad">failed: {broken.join(', ')}</span>{/if}
      </p>
    </nav>
    <main class="content k-scroll" class:fill={section.fill && !route.sbs}>
      {@render view()}
    </main>
  </div>
{/if}

<style>
  .gallery {
    display: grid; grid-template: auto 1fr / 168px 1fr; height: 100vh;
    background: var(--bg); color: var(--tx);
  }
  .full { min-height: 100vh; display: flex; flex-direction: column; }
  .full.fill { height: 100vh; min-height: 0; }
  .top {
    grid-column: 1 / -1; display: flex; align-items: center; gap: var(--gap); flex-wrap: wrap;
    min-height: calc(var(--ctl-h) + 2 * var(--space-3)); padding: var(--space-2) var(--space-5);
    background: var(--bg-raised); border-bottom: var(--bw) solid var(--line-1);
  }
  .brand { font-size: var(--fs-4); font-weight: 500; color: var(--tx-hi); }
  .grow { flex: 1; }
  .top a { color: var(--accent-ink); text-decoration: none; }
  .top a:hover { text-decoration: underline; }
  .nav { display: flex; flex-direction: column; padding: var(--space-3) 0; border-right: var(--bw) solid var(--line-1); min-height: 0; }
  .head { padding: var(--space-4) var(--space-5) var(--space-2); }
  .nav a {
    position: relative; display: block; padding: 0 var(--space-5); line-height: var(--row-h);
    color: var(--tx); text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    transition: background-color var(--t-quick) var(--ease-out), color var(--t-quick) var(--ease-out);
  }
  .nav a:hover { background: var(--bg-hover); color: var(--tx-hi); }
  .nav a[aria-current] { background: var(--sel-bg); color: var(--accent-ink); }
  .nav a[aria-current]::before { content: ''; position: absolute; left: 0; top: 2px; bottom: 2px; width: 2px; background: var(--accent); }
  .nav a:focus-visible { outline: var(--ring-w) solid var(--focus); outline-offset: calc(-1 * var(--ring-w)); }
  .foot { margin-top: auto; padding: var(--space-5); }
  .bad { color: var(--bad-ink); }
  .content { min-width: 0; min-height: 0; }
  .content.fill { overflow: hidden; display: flex; flex-direction: column; }
  .pad { padding: var(--space-6); }
  .err { color: var(--bad-ink); font: var(--fs-2) / var(--lh) var(--mono); white-space: pre-wrap; }
  .sbs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); min-height: 100%; }
  .col { min-width: 0; background: var(--bg); color: var(--tx); border-right: var(--bw) solid var(--line-1); display: flex; flex-direction: column; }
  .col-head { padding: var(--space-3) var(--space-5); background: var(--bg-raised); border-bottom: var(--bw) solid var(--line-1); }
  .col-body { min-width: 0; overflow: auto; }
  .col-body.fill { height: 720px; display: flex; flex-direction: column; overflow: hidden; }

  /* plain-element fallbacks until the buttons family lands */
  .fb-seg { display: inline-flex; border: var(--bw) solid var(--line-2); border-radius: var(--radius); }
  .fb-seg button, .fb-btn {
    height: var(--ctl-h-sm); padding: 0 var(--pad-x); font-size: var(--fs-2); cursor: pointer;
    background: transparent; color: var(--tx); border: 0; border-radius: var(--radius);
  }
  .fb-btn { border: var(--bw) solid var(--line-2); }
  .fb-seg button[aria-checked='true'], .fb-btn[aria-pressed='true'] { color: var(--accent-ink); background: rgba(var(--reality-rgb), .12); }
  .fb-seg button:focus-visible, .fb-btn:focus-visible { outline: var(--ring-w) solid var(--focus); outline-offset: var(--ring-offset); }
</style>
