<!--
  IconsDemo: the icon review sheet. ?demo=icons [&mode=sheet|grid] [&only=play,pause,...]
  sheet: every icon at 12/14/16/20/32 in --tx, and at 16 in --tx-mut, on --bg and --bg-raised, a toolbar strip,
  the status and transport line-ups and the icons inside the real IconButton (when the kit has it).
  grid: each icon at 8x over its 16-unit grid with the keylines (live area 2..14, round overshoot r 6.5)
  beside its true 1x and 2x raster, magnified with no smoothing.
-->
<script>
  import Icon from '../Icon.svelte';
  import { ICON_NAMES, iconPaths } from '../icons.js';
  import { tooltip } from '../tooltip.js';

  // IconButton is another file of the kit; it may not exist yet.
  const ib = import.meta.glob('../IconButton.svelte');
  let IconButton = $state(null);
  Object.values(ib)[0]?.().then((m) => (IconButton = m.default));

  const q = new URLSearchParams(location.search);
  let mode = $state(q.get('mode') === 'grid' ? 'grid' : 'sheet');
  let only = $state(q.get('only') || '');
  const names = $derived.by(() => {
    const want = only.split(',').map((s) => s.trim()).filter(Boolean);
    return want.length ? ICON_NAMES.filter((n) => want.some((w) => n === w || n.includes(w))) : ICON_NAMES;
  });
  const SIZES = [12, 14, 16, 20, 32];
  const STATUS = ['info', 'warning', 'error', 'success', 'help', 'check'];
  const TRANSPORT = ['skip-back', 'step-back', 'rewind', 'play', 'pause', 'stop', 'record', 'fast-forward', 'step-forward', 'skip-forward', 'loop', 'speed', 'volume'];

  /** Draws the icon into a canvas at 16*dpr device pixels in the canvas' own color: the true raster. */
  function raster(name, dpr) {
    return (canvas) => {
      const px = 16 * dpr;
      canvas.width = canvas.height = px;
      const color = getComputedStyle(canvas).color;
      const { s, f } = iconPaths(name);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${px}" height="${px}">`
        + (f ? `<path d="${f}" fill="${color}"/>` : '')
        + (s ? `<path d="${s}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` : '')
        + '</svg>';
      const img = new Image();
      img.onload = () => { const g = canvas.getContext('2d'); g.clearRect(0, 0, px, px); g.drawImage(img, 0, 0); };
      img.src = 'data:image/svg+xml,' + encodeURIComponent(svg);
    };
  }
</script>

<div class="demo">
  <header>
    <div class="seg" role="radiogroup" aria-label="Mode">
      <label><input type="radio" bind:group={mode} value="sheet" /> Sheet</label>
      <label><input type="radio" bind:group={mode} value="grid" /> 16px grid</label>
    </div>
    <input class="only" placeholder="filter: play, zoom" bind:value={only} />
    <span class="count">{names.length} / {ICON_NAMES.length}</span>
  </header>

  {#if mode === 'sheet'}
    <section class="strip" data-shot="strip">
      <h3>Toolbar strip, 16px on --bg-raised</h3>
      <div class="row raised">{#each names as n}<span {@attach tooltip(n)}><Icon name={n} /></span>{/each}</div>
      <div class="row raised mut">{#each names as n}<Icon name={n} />{/each}</div>
      <div class="row">{#each names as n}<Icon name={n} />{/each}</div>
    </section>

    <section class="lineups" data-shot="lineups">
      <h3>Line-ups</h3>
      {#each [16, 32] as z}
        <div class="row">
          {#each STATUS as n}<Icon name={n} size={z} />{/each}
          <span class="sep"></span>
          {#each TRANSPORT as n}<Icon name={n} size={z} />{/each}
        </div>
      {/each}
      <div class="row">
        {#each ['chevron-left', 'chevron-right', 'chevron-up', 'chevron-down', 'arrow-left', 'arrow-right', 'arrow-up', 'arrow-down', 'add', 'remove', 'close', 'check', 'more', 'more-v', 'menu'] as n}<Icon name={n} />{/each}
        <span class="sep"></span>
        {#each ['select', 'roi', 'target', 'crosshair', 'export', 'import', 'upload', 'download', 'external', 'cut', 'split', 'fullscreen', 'expand', 'zoom-fit', 'maximize'] as n}<Icon name={n} />{/each}
      </div>
    </section>

    {#if IconButton}
      <section data-shot="buttons">
        <h3>In IconButton (ghost, default, sm)</h3>
        <div class="row btns">{#each names.slice(0, 40) as n}<IconButton icon={n} label={n} />{/each}</div>
        <div class="row btns">{#each names.slice(0, 40) as n}<IconButton icon={n} label={n} variant="default" />{/each}</div>
        <div class="row btns">{#each names.slice(0, 40) as n}<IconButton icon={n} label={n} size="sm" />{/each}</div>
      </section>
    {/if}

    <section class="sheet" data-shot="sheet">
      {#each names as n}
        <div class="cell" data-icon={n}>
          <div class="sizes">{#each SIZES as z}<Icon name={n} size={z} />{/each}</div>
          <div class="pair">
            <span class="mut"><Icon name={n} /></span>
            <span class="raised"><Icon name={n} /></span>
            <span class="raised mut"><Icon name={n} /></span>
          </div>
          <span class="name">{n}</span>
        </div>
      {/each}
    </section>
  {:else}
    <section class="gridview" data-shot="grid">
      {#each names as n}
        <div class="gcell" data-icon={n}>
          <div class="big">
            <Icon name={n} size={128} />
            <svg class="keys" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="2" y="2" width="12" height="12" />
              <circle cx="8" cy="8" r="6.5" />
              <line x1="8" y1="0" x2="8" y2="16" /><line x1="0" y1="8" x2="16" y2="8" />
            </svg>
          </div>
          <div class="rasters">
            <canvas class="x1" {@attach raster(n, 1)}></canvas>
            <canvas class="x2" {@attach raster(n, 2)}></canvas>
          </div>
          <span class="name">{n}</span>
        </div>
      {/each}
    </section>
  {/if}
</div>

<style>
  .demo { padding: var(--space-6); color: var(--tx); background: var(--bg); min-height: 100vh; }
  header { display: flex; gap: var(--space-5); align-items: center; margin-bottom: var(--space-5); font-size: var(--fs-2); }
  .seg { display: flex; gap: var(--space-4); }
  .only { background: var(--bg-sunken); color: var(--tx); border: 1px solid var(--line-ctl); padding: 2px 6px; font: inherit; }
  .count { color: var(--tx-mut); }
  h3 { font-size: var(--fs-1); font-weight: 500; color: var(--tx-mut); text-transform: uppercase; letter-spacing: var(--caps-track); margin: var(--space-5) 0 var(--space-3); }
  .row { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px; align-items: center; }
  .row.btns { gap: 2px; }
  .sep { width: 1px; align-self: stretch; background: var(--line-2); margin: 0 6px; }
  .raised { background: var(--bg-raised); }
  .mut { color: var(--tx-mut); }

  .sheet { display: grid; grid-template-columns: repeat(auto-fill, 216px); gap: 1px; margin-top: var(--space-6); }
  .cell { display: grid; grid-template-columns: auto auto; justify-content: space-between; align-items: center; gap: 6px; padding: 8px; border: 1px solid var(--line-1); }
  .sizes { display: flex; align-items: center; gap: 6px; }
  .pair { display: flex; }
  .pair > span { padding: 4px; display: block; }
  .name { grid-column: 1 / -1; font-size: var(--fs-2); color: var(--tx-mut); }

  .gridview { display: grid; grid-template-columns: repeat(auto-fill, 228px); gap: 8px; }
  .gcell { display: grid; grid-template-columns: 128px auto; gap: 4px 8px; padding: 6px; border: 1px solid var(--line-1); }
  .big { position: relative; width: 128px; height: 128px;
    background-image: linear-gradient(to right, var(--line-2) 1px, transparent 1px), linear-gradient(to bottom, var(--line-2) 1px, transparent 1px);
    background-size: 8px 8px; outline: 1px solid var(--line-2); }
  .big :global(.k-icon) { position: absolute; inset: 0; }
  .keys { position: absolute; inset: 0; width: 128px; height: 128px; fill: none; stroke: var(--accent-ink, #e44); stroke-width: .06; opacity: .7; pointer-events: none; }
  .rasters { display: flex; flex-direction: column; gap: 4px; }
  canvas { image-rendering: pixelated; color: var(--tx); background: var(--bg); outline: 1px solid var(--line-1); }
  canvas.x1 { width: 64px; height: 64px; }
  canvas.x2 { width: 64px; height: 64px; }
</style>
