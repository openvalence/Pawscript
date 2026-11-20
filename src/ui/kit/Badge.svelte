<!--
  Badge: a small status or count label. soft = tinted fill + ink text, solid = tone fill, outline = ink frame.
  <Badge tone="ok">Saved</Badge>  <Badge tone="accent" variant="solid" num>12</Badge>
  num: tabular mono numerals (.k-num) instead of the caps label voice.
-->
<script>
  let { tone = 'neutral', variant = 'soft', num = false, children, class: cls = '', ...rest } = $props();
</script>

<span class="k-badge kit-badge-t-{tone} kit-badge-v-{variant} {cls}" class:k-num={num} class:kit-badge-num={num} {...rest}>{@render children?.()}</span>

<style>
  .k-badge {
    --c: var(--tx-mut); --ink: var(--tx); --on: var(--on-accent);
    display: inline-block; flex: none; box-sizing: border-box; text-align: center;
    height: var(--space-6); min-width: var(--space-6); max-width: 100%;
    padding: 0 calc(var(--space-2) - var(--caps-track)) 0 var(--space-2);
    border: var(--bw) solid transparent; border-radius: var(--radius);
    font-size: var(--fs-1); font-weight: 500; line-height: calc(var(--space-6) - 2 * var(--bw));
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: middle;
  }
  .k-badge:not(.kit-badge-num) { text-transform: uppercase; letter-spacing: var(--caps-track); }
  .kit-badge-num { padding: 0 var(--space-2); }

  .kit-badge-t-accent { --c: var(--accent); --ink: var(--accent-ink); --rgb: var(--reality-rgb); }
  .kit-badge-t-info { --c: var(--info); --ink: var(--info-ink); --rgb: var(--info-rgb); }
  .kit-badge-t-ok { --c: var(--ok); --ink: var(--ok-ink); --rgb: var(--ok-rgb); --on: var(--on-ok); }
  .kit-badge-t-warn { --c: var(--warn); --ink: var(--warn-ink); --rgb: var(--warn-rgb); --on: var(--on-warn); }
  .kit-badge-t-bad { --c: var(--bad); --ink: var(--bad-ink); --rgb: var(--bad-rgb); --on: var(--on-bad); }
  
  .kit-badge-v-soft { background: rgba(var(--rgb), .16); color: var(--ink); }
  .kit-badge-v-soft.kit-badge-t-neutral { background: var(--bg-active); color: var(--tx); }
  .kit-badge-v-solid { background: var(--c); color: var(--on); }
  .kit-badge-v-outline { border-color: var(--ink); color: var(--ink); }
  .kit-badge-v-outline.kit-badge-t-neutral { border-color: var(--line-ctl); color: var(--tx-mut); }
</style>
