<script>
  // Mounted once with the shown app (modal.js; Shell keys the modals by app): the Quick menu's right-click contract on every
  // [data-command] element and the pointer it opens at (quick.js). Draws nothing.
  import { installQuick } from './quick.js';

  let { app } = $props();
  $effect(() => installQuick(app));
</script>
