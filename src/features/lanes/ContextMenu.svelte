<script>
  // The lanes' context menu: shows st.menu = {x, y, items} (set by the canvas, the headers and the
  // lanes.contextMenu command) in the kit's context menu. Items are the lanes' own shape --
  // {label, cmd?, args?, run?, keys?, checked?, disabled?, items?} | {sep: true} -- mapped onto kit MenuItems here
  // (`items` = a submenu of the same shape).
  import { showContextMenu } from '../../ui/kit/contextmenu.js';
  import { fmtKeys } from '../../app/keymap.js';
  import { lanes } from './state.svelte.js';

  let { app, source = null } = $props();
  const L = $derived(lanes(app));

  // (a kit-shaped {section} / {separator} / {tip}, from another feature's items appended to a lane's menu, passes through)
  const toKit = (it) => it.sep || it.separator ? { separator: true } : it.section ? { section: it.section } : {
    label: it.label,
    shortcut: it.keys ? fmtKeys(it.keys) : it.shortcut,
    disabled: !!it.disabled,
    ...(it.tip && { tip: it.tip }),
    ...(it.checked !== undefined && { type: it.type === 'radio' ? 'radio' : 'checkbox', checked: !!it.checked }),
    ...(it.items ? { items: it.items.map(toKit) } : { run: () => (it.run ? it.run() : app.commands.run(it.cmd, it.args)) }),
  };

  $effect(() => {
    const m = L.menu;
    if (!m) return;
    return showContextMenu({ x: m.x, y: m.y }, m.items.map(toKit), {
      source, onclose: () => { if (L.menu === m) L.menu = null; },
    }); // close() is the cleanup: a new menu, or the stack unmounting, closes this one
  });
</script>
