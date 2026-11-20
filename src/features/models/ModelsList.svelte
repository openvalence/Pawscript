<!-- ModelsList (paw-cdot): the runtime and the models, each with its size, what it is for, its licence (the upstream page in
     your browser, the notice that ships) and its state; the models folder; Download / Re-download / Remove / Choose files.
     In Settings > Models, and on the first-start screen (`pick`: tick the optional ones, then one Download for all). Files
     dropped on the list (or on a row) are brought in as Choose files does (App.svelte routes a drop here). -->
<script>
  import { Button, Badge, Checkbox, ProgressBar } from '../../ui/kit/index.js';
  import Prop from '../../app/Prop.svelte';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { models, list, refresh, download, cancel, remove, verify, checkUpdates, chooseFiles, chooseFolder, setFolder, openFolder, openLink, folderOf, plan, needsRuntime, choice, runtimeChosen, removeRuntime } from './store.svelte.js';
  import { rowState, isRuntime, isManual, isHosted, otherVersion, toFetch, fmtBytes, runtimeThere, RUNTIME_IDS, RUNTIME_WORDS, STATE_WORDS } from './logic.js';
  import { onMount } from 'svelte';

  let { app, pick = false } = $props();
  // the notices that ship (dev/share/LICENSES/models), shown under a row on demand
  const NOTICES = Object.fromEntries(Object.entries(import.meta.glob('../../../dev/share/LICENSES/models/*.txt', { query: '?raw', import: 'default', eager: true })).map(([p, t]) => [p.split('/').pop(), t]));
  let open = $state(null), sure = $state(null), sureTimer = 0;
  onMount(() => { refresh(app); });

  // the chosen runtime (and why): the setting, else the one for the GPU found (paw-vdb3.3)
  const rtc = $derived((app.settings.values, models.gpu, models.rt, choice(app)));
  const shown = $derived((models.fetched, models.facts, list().filter((r) => !isRuntime(r.model) || (pick && r.model.id === rtc.id && needsRuntime(app)))));
  const st = (r) => (isRuntime(r.model) ? 'missing' : rowState(r, models.facts, models.verified));
  const size = (m) => fmtBytes(m.files.reduce((n, f) => n + f.bytes, 0));
  const busy = $derived(!!models.job);
  const dir = $derived((models.info, app.settings.values, folderOf(app)));
  const custom = $derived((app.settings.values, !!(app.settings.get('models.dir') || '').trim()));
  const ids = $derived(shown.filter((r) => (r.model.required || models.picked[r.model.id]) && !isManual(r.model) && st(r) !== 'installed').map((r) => r.model.id));
  const p = $derived((models.facts, models.rt, rtc, plan(ids, app)));
  const frac = $derived(models.job?.total ? models.job.done / models.job.total : null);

  const spare = $derived(RUNTIME_IDS.filter((id) => id !== rtc.id && runtimeThere(models.rt, id)));
  const rtState = $derived(runtimeThere(models.rt, rtc.id) ? 'Installed' : isHosted(list().find((r) => r.model.id === rtc.id)?.model) ? 'Not downloaded' : 'Not published yet');

  function removeTwice(id) {
    if (sure !== id) { sure = id; clearTimeout(sureTimer); sureTimer = setTimeout(() => (sure = null), 4000); return; }
    sure = null;
    remove(app, id);
  }
  function removeRuntimeTwice(id) {
    if (sure !== id) { sure = id; clearTimeout(sureTimer); sureTimer = setTimeout(() => (sure = null), 4000); return; }
    sure = null;
    removeRuntime(app, id);
  }
  export async function downloadPicked() { return download(app, ids); }
</script>

<div class="ml" data-models-drop data-testid="models-list">
  <div class="folder">
    <span class="k-hint">Models folder</span>
    <span class="path" {@attach tooltip(dir)} data-testid="models-folder">{custom ? dir : `Next to the app (${dir})`}</span>
    <div class="acts">
      <Button size="sm" icon="folder-open" disabled={busy} onclick={() => chooseFolder(app)}>Choose folder…</Button>
      {#if custom}<Button size="sm" disabled={busy} onclick={() => setFolder(app, '')} tip="The old folder keeps its files; it is no longer looked in">Next to the app</Button>{/if}
      <Button size="sm" icon="external" disabled={!models.info?.exists} tip={models.info?.exists ? '' : 'Nothing downloaded there yet'} onclick={() => openFolder(app)}>Open folder</Button>
    </div>
  </div>

  {#if models.gpu}
    <div class="rt" data-testid="runtime-choice" data-runtime={rtc.id}>
      <div class="what">
        <span class="title">Runtime: {RUNTIME_WORDS[rtc.id]}</span>
        <span class="doc k-hint" data-testid="runtime-why">{rtc.why}{#if rtc.note} · {rtc.note}{/if}</span>
      </div>
      {#if models.rt?.portable}
        <Prop {app} key="models.runtime" expand disabled={busy} oncommit={() => runtimeChosen(app, { fetch: !pick })} />
        <Badge tone={rtState === 'Installed' ? 'ok' : 'neutral'}>{rtState}</Badge>
        {#each spare as id (id)}
          <Button size="sm" icon="delete" variant={sure === id ? 'danger' : 'default'} disabled={busy} onclick={() => removeRuntimeTwice(id)} data-testid="runtime-remove">{sure === id ? `Remove ${RUNTIME_WORDS[id]}?` : `Remove ${RUNTIME_WORDS[id]}`}</Button>
        {/each}
      {/if}
    </div>
  {/if}

  {#each shown as r (r.model.id)}
    {@const m = r.model}
    {@const s = st(r)}
    <div class="row" data-model-id={m.id} data-state={s} data-testid="model-row">
      {#if pick}
        <Checkbox size="sm" checked={m.required || !!models.picked[m.id] || s === 'installed'} disabled={m.required || isManual(m) || s === 'installed' || busy}
          onchange={(v) => (models.picked[m.id] = v)} aria-label={m.title} />
      {/if}
      <div class="what">
        <span class="title">{m.title}{#if m.required}<span class="k-hint"> · needed</span>{/if}</span>
        <span class="doc k-hint">{m.for}{#if m.vramGb} · about {m.vramGb} GB of video memory{/if}</span>
        <span class="lic k-hint">
          {m.licence}
          {#if m.licenceUrl}<Button size="sm" variant="ghost" icon="external" onclick={() => openLink(app, m.licenceUrl)} tip={m.licenceUrl}>Licence</Button>{/if}
          {#if m.notice && NOTICES[m.notice]}<Button size="sm" variant="ghost" onclick={() => (open = open === m.id ? null : m.id)}>{open === m.id ? 'Hide notice' : 'Notice'}</Button>{/if}
          {#if isManual(m)}<Button size="sm" variant="ghost" icon="external" onclick={() => openLink(app, m.downloadPage)} tip={m.downloadPage}>Download page</Button><span>not hosted by Pawscript: get {m.files.map((f) => f.path.split('/').pop()).join(', ')} there, then Choose files… or drop them here</span>{/if}
          {#if otherVersion(m, models.verified)}· a different version than the one tested{/if}
        </span>
      </div>
      <span class="size k-num">{size(m)}</span>
      <Badge tone={s === 'installed' ? 'ok' : s === 'damaged' ? 'bad' : s === 'update' ? 'accent' : 'neutral'}>{isRuntime(m) ? 'Needed first' : STATE_WORDS[s]}</Badge>
      {#if !pick || s === 'damaged' || isManual(m)}
        <div class="acts">
          {#if isManual(m)}
            <Button size="sm" icon="import" disabled={busy} onclick={() => chooseFiles(app, m.id)}>Choose files…</Button>
          {:else if s !== 'installed'}
            <Button size="sm" icon="download" disabled={busy} onclick={() => download(app, [m.id])} data-testid="model-download">{s === 'damaged' ? 'Re-download' : s === 'update' ? 'Update' : `Download ${fmtBytes(toFetch(m, models.facts, models.verified).bytes)}`}</Button>
          {/if}
          {#if s !== 'missing' || m.files.some((f) => models.facts[f.path]?.exists || models.facts[f.path]?.part)}
            <Button size="sm" icon="delete" variant={sure === m.id ? 'danger' : 'default'} disabled={busy} onclick={() => removeTwice(m.id)} data-testid="model-remove">{sure === m.id ? `Remove ${size(m)}?` : 'Remove'}</Button>
          {/if}
        </div>
      {/if}
    </div>
    {#if open === m.id}<pre class="notice">{NOTICES[m.notice]}</pre>{/if}
  {/each}

  {#if models.job}
    <div class="job" data-testid="models-job">
      <ProgressBar value={frac} label={`${models.job.title || ''}${models.job.file ? ': ' + models.job.file.split('/').pop() : ''}`} showValue={frac != null} />
      {#if models.job.total}<span class="k-hint k-num">{fmtBytes(models.job.done)} of {fmtBytes(models.job.total)}</span>{/if}
      {#if models.job.id}<Button size="sm" onclick={() => cancel(app)}>Cancel</Button>{/if}
    </div>
  {/if}
  {#if models.error}<p class="err" data-testid="models-error">{models.error}</p>{:else if models.message}<p class="k-hint msg">{models.message}</p>{/if}

  <div class="foot">
    <span class="k-hint k-num">{p.words}</span>
    {#if !pick}
      <Button size="sm" icon="refresh" disabled={busy} tip="Asks the models server whether newer files exist" onclick={() => checkUpdates(app)}>Check for model updates</Button>
      <Button size="sm" icon="check" disabled={busy || !models.info?.exists} onclick={() => verify(app)}>Verify files</Button>
      <Button size="sm" icon="import" disabled={busy} onclick={() => chooseFiles(app)} tip="Files you have: checked, then moved into the models folder">Choose files…</Button>
    {/if}
  </div>
</div>

<style>
  /* minmax(0, 1fr): the folder's one-line path must not widen every row past the panel */
  .ml { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-2); padding: var(--space-2) var(--space-2) var(--space-3) var(--space-4); }
  .folder { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
  .path { color: var(--tx-val); font-size: var(--fs-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1 1 160px; }
  .rt { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-3); padding: var(--space-1) 0; }
  .acts { display: flex; flex-wrap: wrap; gap: var(--space-1); }
  /* wraps instead of a grid: in the narrow Settings panel the size, the state and the buttons go under the text rather
     than past the panel's edge, where nobody can click them */
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-3); padding: var(--space-1) 0; border-top: 1px solid var(--line-0, transparent); }
  .row .acts { flex-basis: 100%; justify-content: flex-end; }
  .what { display: grid; gap: 1px; min-width: 0; flex: 1 1 200px; }
  .title { color: var(--tx); font-size: var(--fs-2); }
  .doc, .lic { font-size: var(--fs-1); overflow-wrap: anywhere; }
  .size { color: var(--tx-val); font-size: var(--fs-1); }
  .lic { display: flex; flex-wrap: wrap; align-items: center; gap: 0 var(--space-2); }
  .notice { max-height: 200px; overflow: auto; font-size: var(--fs-1); white-space: pre-wrap; margin: 0; padding: var(--space-2); background: var(--bg-1, transparent); border: 1px solid var(--line-1); }
  .job { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: end; gap: var(--space-2); }
  .err { color: var(--bad-ink); font-size: var(--fs-1); margin: 0; overflow-wrap: anywhere; }
  .msg { margin: 0; font-size: var(--fs-1); }
  .foot { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
  .foot .k-num { flex: 1 1 auto; }
</style>
