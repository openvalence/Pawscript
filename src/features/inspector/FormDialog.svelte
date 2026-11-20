<script>
  // The numeric go-to / set commands' form: kit Dialog + Fields. Mounted on document.body by dialogs.js.
  // fields: [{key, label, value, hint, kind, parse(text) -> value, optional}]; onsubmit(values) -> error text | void.
  import { untrack } from 'svelte';
  import './inspector.css';
  import Dialog from '../../ui/kit/Dialog.svelte';
  import Field from '../../ui/kit/Field.svelte';
  import TextField from '../../ui/kit/TextField.svelte';
  import Button from '../../ui/kit/Button.svelte';
  let { title, fields, ok = 'OK', note = '', onsubmit, onclose } = $props();
  let open = $state(true);
  let vals = $state(untrack(() => Object.fromEntries(fields.map((f) => [f.key, String(f.value ?? '')]))));
  let err = $state({ key: '', msg: '' }), first = $state();
  // Dialog focuses the first field; select its text so typing replaces it
  $effect(() => { if (first) setTimeout(() => first.select(), 0); });

  function submit() {
    const out = {};
    for (const f of fields) {
      const raw = vals[f.key];
      if (f.optional && String(raw).trim() === '') { out[f.key] = null; continue; }
      const v = f.parse ? f.parse(raw) : raw;
      if (typeof v === 'number' && !Number.isFinite(v)) { err = { key: f.key, msg: `Not a valid ${f.kind ?? 'value'} (try ${f.hint ?? 'a number'})` }; return; }
      out[f.key] = v;
    }
    const msg = onsubmit(out);
    if (typeof msg === 'string' && msg) { err = { key: fields[fields.length - 1].key, msg }; return; }
    open = false; onclose();
  }
</script>

<Dialog bind:open {title} size="sm" onclose={() => onclose()}>
  <div class="form">
    {#each fields as f, i (f.key)}
      <Field inline label={f.label} error={err.key === f.key ? err.msg : ''} hint={i === fields.length - 1 ? note : ''}>
        {#snippet children(c)}
          <TextField id={c.id} aria-describedby={c.describedby} full class="k-num" placeholder={f.hint ?? ''} invalid={err.key === f.key}
            bind:value={vals[f.key]} oninput={() => (err = { key: '', msg: '' })} onenter={submit}
            bind:inputEl={() => (i === 0 ? first : undefined), (el) => { if (i === 0) first = el; }} spellcheck="false" />
        {/snippet}
      </Field>
    {/each}
  </div>
  {#snippet footer()}
    <Button onclick={() => { open = false; onclose(); }}>Cancel</Button>
    <Button variant="primary" onclick={submit}>{ok}</Button>
  {/snippet}
</Dialog>

<style>
  .form { display: flex; flex-direction: column; gap: var(--space-4); --field-label-w: 88px; }
</style>
