<!--
  Toolbar: role=toolbar with one tab stop. Arrow keys (Left/Right, or Up/Down when vertical), Home and End
  move focus between its focusable descendants; a nested composite (SegmentedControl, Tabs) counts as one
  stop and keeps its own arrow keys. Text fields and sliders keep their arrows too. Separators: <span class="k-sep"></span>.
  <Toolbar label="Edit tools">
    <ToggleButton icon="pointer" label="Select" bind:pressed={sel} /> <span class="k-sep"></span> …
  </Toolbar>
-->
<script>
  import { nextIndex, TABBABLE } from './focus.js';

  let { label, orientation = 'horizontal', children, class: cls = '', ...rest } = $props();

  const COMPOSITE = '[role=radiogroup], [role=tablist], [role=listbox], [role=menubar], [role=menu], [role=tree], [role=grid], [role=toolbar]';
  const TYPING = 'textarea, select, [role=slider], [role=spinbutton], [role=combobox], '
    + 'input:not([type=button], [type=checkbox], [type=radio], [type=submit], [type=reset], [type=image], [type=color])';

  let root = null;
  let current = null;           // the stop that holds tabindex 0
  const comps = new WeakSet();  // stops that are nested composites

  /** The toolbar's stops in DOM order: focusable descendants, a nested composite counted once. */
  function stops() {
    const out = [];
    for (const el of root.querySelectorAll(`${TABBABLE}, [data-k-rove]`)) {
      if (el.matches(':disabled') || el.closest('[inert]') || !el.getClientRects().length) continue;
      const pop = el.closest('[popover]');
      if (pop && root.contains(pop)) continue;
      const c = el.parentElement.closest(COMPOSITE);
      const stop = c === root ? el : c?.parentElement?.closest(COMPOSITE) === root ? c : null;
      if (!stop || out.includes(stop)) continue;
      if (stop !== el) comps.add(stop);
      out.push(stop);
    }
    return out;
  }

  // A composite's own tab stop: its tabindex=0 member, or the one this toolbar parked at -1.
  const entry = (s) => (comps.has(s) ? s.querySelector('[tabindex="0"]') ?? s.querySelector('[data-k-entry]') ?? s.querySelector(TABBABLE) : s);

  function sync() {
    const list = stops();
    if (!list.includes(current)) current = list[0] ?? null;
    for (const s of list) {
      if (!comps.has(s)) { s.dataset.kRove = ''; s.tabIndex = s === current ? 0 : -1; continue; }
      const e = entry(s);
      if (!e) continue;
      if (s === current) { e.tabIndex = 0; delete e.dataset.kEntry; }
      else if (e.tabIndex === 0) { e.dataset.kEntry = ''; e.tabIndex = -1; }
    }
  }

  function onfocusin(e) {
    const s = stops().find((x) => x.contains(e.target));
    if (s && s !== current) { current = s; sync(); }
  }

  function onkeydown(e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.key.startsWith('Page')) return;
    if (e.target.isContentEditable || e.target.matches(TYPING)) return;
    const list = stops();
    const i = nextIndex(list.length, list.findIndex((x) => x.contains(e.target)), e.key, { orientation });
    if (i == null) return;
    e.preventDefault();
    current = list[i];
    sync();
    entry(current)?.focus();
  }

  function rove(node) {
    root = node;
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(node, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'inert'] });
    return () => mo.disconnect();
  }
</script>

<div class="k-toolbar {cls}" role="toolbar" aria-label={label} aria-orientation={orientation} {onkeydown} {onfocusin} {...rest} {@attach rove}>
  {@render children?.()}
</div>

<style>
  .k-toolbar { display: flex; align-items: center; gap: var(--space-1); min-width: 0; }
  .k-toolbar[aria-orientation='vertical'] { flex-direction: column; }
  .k-toolbar[aria-orientation='vertical'] > :global(.k-sep) { width: auto; height: 1px; margin: var(--space-2); }
</style>
