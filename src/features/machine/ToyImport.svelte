<!--
  ToyImport: add a toy that is not in the library from a silhouette picture (PNG / SVG / WebP / JPEG; the toy lying
  or standing along one axis; transparent or flat background). Traced per column (toys.js traceSilhouette), the
  wider end is the base (Flip swaps it); the real length is set by dragging the ruler's handle, then it is named and
  saved to the owner's toys (settings machine.toys, kept across projects). Shown over the Machine view.
-->
<script>
  import { Button, TextField } from '../../ui/kit/index.js';
  import { cssVar } from '../../ui/kit/color.js';
  import { traceSilhouette, toyFromTrace } from './toys.js';

  let { app, onsave, oncancel } = $props();
  let trace = $state.raw(null), name = $state(''), lengthMm = $state(180), flip = $state(false), error = $state(''), over = $state(false);
  let cv = $state(), w = $state(0), fileInput = $state(), dragging = false;
  const H = 150;

  /** Picture bytes -> RGBA ImageData, at most 1200 px on the long side. */
  async function decode(blob) {
    let src;
    if (blob.type === 'image/svg+xml') {
      const url = URL.createObjectURL(blob);
      try { src = await new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => bad(new Error('not a readable SVG')); im.src = url; }); }
      finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } else src = await createImageBitmap(blob);
    const W0 = src.naturalWidth || src.width || 600, H0 = src.naturalHeight || src.height || 300, k = Math.min(4, 1200 / Math.max(W0, H0));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(W0 * k)); c.height = Math.max(1, Math.round(H0 * k));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c.getContext('2d').getImageData(0, 0, c.width, c.height);
  }
  const TYPES = { png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
  async function load(blob, fileName) {
    error = '';
    try {
      const t = traceSilhouette(await decode(blob));
      if (!t || t.radii.length < 20) { error = 'No toy shape found in that picture.'; return; }
      trace = t; flip = false;
      name = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 60) || 'My toy';
    } catch (e) { error = `Could not read the picture (${e?.message || e}).`; }
  }
  async function choose() {
    if (!app.backend?.isTauri) { fileInput?.click(); return; }
    const p = await app.backend.openDialog({ title: 'Toy silhouette', filters: [{ name: 'Picture', extensions: Object.keys(TYPES) }] });
    if (!p) return;
    const ext = String(p).split('.').pop().toLowerCase();
    await load(new Blob([await app.backend.readBytes(p)], { type: TYPES[ext] || 'image/png' }), String(p).split(/[\\/]/).pop());
  }
  const picked = (e) => { const f = e.currentTarget.files?.[0]; if (f) load(f, f.name); e.currentTarget.value = ''; };
  function drop(e) { e.preventDefault(); over = false; const f = e.dataTransfer?.files?.[0]; if (f) load(f, f.name); }

  // ---- the preview: tip left, base right, at mm scale; the ruler handle at the base end sets the length ----
  const span = $derived(Math.max(300, Math.ceil((lengthMm * 1.3) / 50) * 50));
  const k = $derived(w > 0 ? (w - 24) / span : 1);
  const radii = $derived(trace ? (flip ? [...trace.radii].reverse() : trace.radii) : null);
  $effect(() => {
    if (!cv || !radii || !w) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr); cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d'), col = (n) => cssVar(n, cv);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, H);
    const x0 = 12, mid = 62, n = radii.length, mmPerPx = lengthMm / n;
    g.fillStyle = col('--series-violet');
    g.beginPath();
    for (let i = 0; i < n; i++) g.lineTo(x0 + i * mmPerPx * k, mid - radii[i] * mmPerPx * k);
    for (let i = n - 1; i >= 0; i--) g.lineTo(x0 + i * mmPerPx * k, mid + radii[i] * mmPerPx * k);
    g.fill();
    // ruler
    const ry = 122;
    g.strokeStyle = col('--line-3'); g.fillStyle = col('--tx-faint'); g.font = `10px ${col('--mono') || 'monospace'}`; g.textAlign = 'center'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x0, ry + 0.5); g.lineTo(x0 + span * k, ry + 0.5); g.stroke();
    for (let mm = 0; mm <= span; mm += 10) {
      const x = Math.round(x0 + mm * k) + 0.5, big = mm % 50 === 0;
      g.beginPath(); g.moveTo(x, ry); g.lineTo(x, ry + (big ? 7 : 4)); g.stroke();
      if (big) g.fillText(String(mm), x, ry + 17);
    }
    const hx = x0 + lengthMm * k;
    g.strokeStyle = col('--accent'); g.fillStyle = col('--accent');
    g.beginPath(); g.moveTo(hx, 8); g.lineTo(hx, ry); g.setLineDash([3, 3]); g.stroke(); g.setLineDash([]);
    g.beginPath(); g.moveTo(hx, ry - 2); g.lineTo(hx - 7, ry - 12); g.lineTo(hx + 7, ry - 12); g.closePath(); g.fill();
    g.fillStyle = col('--tx'); g.textAlign = 'left'; g.font = `11px ${col('--font') || 'sans-serif'}`;
    g.fillText(`${Math.round(lengthMm)} mm`, Math.min(w - 60, hx + 9), ry - 12);
  });
  const xOf = (e) => e.clientX - cv.getBoundingClientRect().left;
  const nearHandle = (e) => Math.abs(xOf(e) - (12 + lengthMm * k)) < 14;
  function down(e) { if (!nearHandle(e)) return; dragging = true; cv.setPointerCapture(e.pointerId); e.preventDefault(); }
  function move(e) {
    cv.style.cursor = dragging || nearHandle(e) ? 'ew-resize' : '';
    if (dragging) lengthMm = Math.round(Math.min(600, Math.max(30, (xOf(e) - 12) / k)));
  }
  function save() { onsave(toyFromTrace(trace.radii, { length_mm: lengthMm, name: name.trim() || 'My toy', flip })); }
</script>

<div class="imp" role="dialog" aria-label="Import a toy" tabindex="-1"
  ondragover={(e) => { e.preventDefault(); over = true; }} ondragleave={() => (over = false)} ondrop={drop} data-over={over || undefined}>
  <input type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg" hidden bind:this={fileInput} onchange={picked} />
  {#if !trace}
    <div class="empty">
      <p>Pick or drop a silhouette picture of the toy (lying or standing along one axis, any plain background).</p>
      <div class="acts"><Button variant="primary" icon="image" onclick={choose}>Choose picture</Button><Button onclick={oncancel}>Cancel</Button></div>
      {#if error}<p class="err">{error}</p>{/if}
    </div>
  {:else}
    <p class="hint">Drag the ruler's handle to the toy's real length. Tip on the left, base on the right.</p>
    <div class="pv" bind:clientWidth={w}>
      <canvas bind:this={cv} style:height="{H}px" aria-label="Traced toy, {Math.round(lengthMm)} mm"
        onpointerdown={down} onpointermove={move} onpointerup={() => (dragging = false)} onpointercancel={() => (dragging = false)}></canvas>
    </div>
    <div class="acts">
      <TextField size="sm" label="Toy name" bind:value={name} placeholder="Name" />
      <Button size="sm" icon="flip" onclick={() => (flip = !flip)} tip="Swap tip and base">Flip</Button>
      <span class="sp"></span>
      <Button size="sm" onclick={oncancel}>Cancel</Button>
      <Button size="sm" variant="primary" onclick={save}>Save toy</Button>
    </div>
  {/if}
</div>

<style>
  .imp { position: absolute; inset: 0; z-index: 2; display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4);
    background: color-mix(in srgb, var(--bg) 94%, transparent); overflow: auto; }
  .imp[data-over] { outline: 2px dashed var(--accent); outline-offset: -6px; }
  .empty { margin: auto; max-width: 280px; text-align: center; display: flex; flex-direction: column; gap: var(--space-4); color: var(--tx-mut); font-size: var(--fs-2); }
  .empty p { margin: 0; }
  .acts { display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; justify-content: center; }
  .sp { flex: 1; }
  .hint { margin: 0; font-size: var(--fs-2); color: var(--tx-mut); }
  .pv { width: 100%; }
  canvas { display: block; width: 100%; touch-action: none; }
  .err { color: var(--bad-ink); }
</style>
