<script>
  // Shows app.choose()/app.confirm() requests with the kit Dialog. One at a time (a new request answers the
  // previous one with null). Dismissing (Esc, backdrop, ×) answers null.
  // Each request gets its own Dialog instance (a keyed each of one) and its handlers close over THAT request: the native
  // `close` event of a dialog torn down after its answer arrives late (a task), and must not answer the next
  // request in a two-step chain (Export: "Which axes?" then "Export to").
  import Dialog from '../ui/kit/Dialog.svelte';
  import Button from '../ui/kit/Button.svelte';

  let { app } = $props();
  const d = $derived(app.dialog);
</script>

{#if d}
  {#each [d] as req (req)}
    <!-- 560 px at least (400 was cramped for a path and three buttons); many / long choices get 720 and wrap -->
    <Dialog open={true} title={req.title} class="choice" style="--k-dialog-w: {req.choices.reduce((n, c) => n + c.label.length + 6, 0) > 64 ? 720 : 560}px" onclose={() => req.resolve(null)}>
      {#if req.message}<p class="msg">{req.message}</p>{/if}
      {#if req.detail}<p class="k-hint det">{req.detail}</p>{/if}
      {#snippet footer()}
        {#each req.choices as c, i (c.id)}
          <Button variant={c.kind === 'danger' ? 'danger' : c.kind === 'primary' ? 'primary' : 'default'} data-autofocus={c.kind === 'primary' || (i === 0 && !req.choices.some((x) => x.kind === 'primary')) ? '' : undefined}
            onclick={(e) => req.resolve(c.id, { trusted: !!e?.isTrusted })}>{c.label}</Button>
        {/each}
      {/snippet}
    </Dialog>
  {/each}
{/if}

<style>
  .msg { white-space: pre-line; color: var(--tx); line-height: 1.5; }
  .det { margin-top: var(--space-4); white-space: pre-line; }
  .msg, .det { overflow-wrap: anywhere; }   /* long paths break instead of widening the box */
  :global(.k-dialog.choice .kit-dialog-foot) { flex-wrap: wrap; }
</style>
