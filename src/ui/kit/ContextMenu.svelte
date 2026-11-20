<!--
  ContextMenu: a region with a context menu (right-click, Shift+F10, the ContextMenu key).
  The same as {@attach contextMenu(items, { onselect })} on your own element.

  <ContextMenu items={(e) => itemsFor(e)} onselect={(it) => …}>…</ContextMenu>
-->
<script>
  import { contextMenu } from './contextmenu.js';

  let { items = [], onselect, onclose, children, class: cls = '', ...rest } = $props();
</script>

<div class="k-context-menu {cls}" {...rest} {@attach contextMenu(items, { onselect, onclose })}>
  {@render children?.()}
</div>
