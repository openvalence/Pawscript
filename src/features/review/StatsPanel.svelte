<script>
  import { untrack } from 'svelte';
  import './review.css';
  import { SegmentedControl, Select, IconButton, Section, EmptyState } from '../../ui/kit/index.js';
  import Chart from './Chart.svelte';
  import { getReview } from './state.svelte.js';
  import { statistics } from '../../lib/analyze/index.js';
  import { speedHistogram, amplitudeSeries, spmSeries, STAT_ROWS, statsAsText, fmtDur } from './logic/charts.js';
  import { fmtSpan } from '../../lib/time-format.js';

  let { app } = $props();
  const rv = getReview(app);
  const BINS = 40;

  let scope = $state('all');          // 'all' | 'range' | 'selection' (no chapters: paw-1w0x)
  let result = $state.raw(null), busy = $state(false), timer = 0;

  const script = $derived(app.script);
  const sel = $derived(app.doc.selection);

  function windowFor() {
    const s = app.script, d = app.doc, all = [s[0]?.at ?? 0, s.at(-1)?.at ?? 0];
    if (scope === 'range' && d.range) return { t: [d.range.t0, d.range.t1], note: '' };
    if (scope === 'selection' && d.selection.axis === d.activeAxis && d.selection.ats.size >= 2) { const a = [...d.selection.ats]; return { t: [Math.min(...a), Math.max(...a)], note: '' }; }
    return { t: all, note: scope === 'all' ? '' : `No ${scope} set: showing the whole script` };
  }

  function compute() {
    const s = app.script, prof = rv.profile, { t, note } = windowFor(), [t0, t1] = t;
    if (s.length < 2 || !(t1 > t0)) { result = null; busy = false; return; }
    const win = Math.max(1000, (t1 - t0) / BINS);
    const st = statistics(s, { t0, t1, windowMs: win, stepMs: win });
    const cap = Math.max(300, Math.ceil((prof.maxSpeed * 1.6) / 50) * 50);
    const sp = speedHistogram(s, t0, t1, { bins: 24, cap, limit: prof.maxSpeed });
    result = { st, sp, cap, t0, t1, note, spm: spmSeries(st.strokesPerMinSeries, t0, t1, BINS), amp: amplitudeSeries(s, t0, t1, BINS), prof };
    busy = false;
  }
  // live: recompute shortly after anything it depends on changes
  $effect(() => {
    void script; void scope; void rv.profile; void app.doc.range; void sel;
    clearTimeout(timer); busy = true;
    timer = setTimeout(() => untrack(compute), untrack(() => result) ? 160 : 0);   // untracked: compute() writes result
    return () => clearTimeout(timer);
  });

  const extra = $derived(result ? { overShare: result.sp.overShare } : null);
  async function copy() {
    if (!result) return;
    const text = statsAsText(`${app.doc.activeAxis}: ${fmtSpan(result.t0, result.t1)}`, result.st, extra);
    try { await navigator.clipboard.writeText(text); app.toast('Statistics copied', 'ok'); } catch { app.toast('Could not copy', 'error'); }
  }
  const SCOPES = [{ value: 'all', label: 'Whole' }, { value: 'range', label: 'Range' }, { value: 'selection', label: 'Selection' }];
  // below this width the scope segments truncate: show them as a Select instead
  let panelW = $state(0);
  const narrow = $derived(panelW > 0 && panelW < 340);
  const tickT = (r) => [0, 0.5, 1].map((f) => ({ f, label: fmtDur(r.t0 + (r.t1 - r.t0) * f) }));
</script>

<div class="rv kit-root" bind:clientWidth={panelW}>
  <div class="rv-head">
    <div class="rv-row">
      {#if narrow}
        <Select class="rv-grow" full label="Statistics scope" options={SCOPES} bind:value={scope} />
      {:else}
        <SegmentedControl label="Statistics scope" options={SCOPES} bind:value={scope} />
        <span class="rv-sp"></span>
      {/if}
      <IconButton variant="default" icon="copy" label="Copy as text" onclick={copy} disabled={!result} />
    </div>
    {#if result?.note}<div class="k-hint">{result.note}</div>{/if}
  </div>

  <div class="rv-body k-scroll" aria-busy={busy}>
    {#if !result}
      <EmptyState icon="heatmap" title="No statistics" description="Needs at least two points over a span." />
    {:else}
      <Section title="Numbers" count={fmtSpan(result.t0, result.t1)}>
        <div class="rv-kv">
          {#each STAT_ROWS as [label, fn] (label)}<span>{label}</span><span class="k-num">{fn(result.st, extra)}</span>{/each}
        </div>
      </Section>

      <Section title="Position" count="share of time">
        <div class="rv-chart"><Chart values={result.st.positionHist} ticks={[{ f: 0, label: '0' }, { f: 0.5, label: '50' }, { f: 1, label: '100' }]} height={62}
          readout={(i) => `${i * 5}-${i * 5 + 5}: ${(result.st.positionHist[i] * 100).toFixed(1)}%`} label="Position histogram" /></div>
        <div class="k-hint">0 is deepest, 100 is out. Tall bars at the ends mean the stroke sits at its limits.</div>
      </Section>

      <Section title="Speed">
        <div class="rv-chart"><Chart values={result.sp.counts} split={Math.ceil((result.prof.maxSpeed / result.cap) * result.sp.counts.length)}
          marker={{ f: Math.min(1, result.prof.maxSpeed / result.cap), label: `${result.prof.maxSpeed} u/s` }}
          ticks={[{ f: 0, label: '0' }, { f: 0.5, label: String(result.cap / 2) }, { f: 1, label: `${result.cap}+` }]} height={74}
          readout={(i) => `${Math.round((i * result.cap) / 24)}-${Math.round(((i + 1) * result.cap) / 24)} u/s: ${result.sp.counts[i]}`} label="Speed distribution" /></div>
        <div class="k-hint">Segments by speed; red bars are beyond {result.prof.name}.</div>
      </Section>

      <Section title="Strokes per minute">
        <Chart type="line" values={result.spm.values} ticks={tickT(result)} height={64} readout={(i) => (result.spm.values[i] == null ? '' : `${result.spm.values[i].toFixed(0)} /min`)} label="Strokes per minute over time" />
      </Section>

      <Section title="Amplitude">
        <Chart type="line" values={result.amp.values} yMax={100} ticks={tickT(result)} height={64} color="violet" readout={(i) => (result.amp.values[i] == null ? '' : `${result.amp.values[i].toFixed(0)} units`)} label="Mean amplitude over time" />
      </Section>
    {/if}
  </div>
</div>
