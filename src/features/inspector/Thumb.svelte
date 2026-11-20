<script>
  // Tiny canvas preview of a snippet (pos 100 at the top, like the lanes). Colours are kit tokens, re-read on a
  // theme / density change.
  import { cssVar } from '../../ui/kit/color.js';
  import { onThemeChange } from '../../ui/kit/tokens.js';
  let { actions, duration, h = 34 } = $props();
  let cv, w = $state(200), theme = $state(0);
  $effect(() => onThemeChange(() => theme++));
  $effect(() => {
    void theme;
    if (!cv) return;
    const dpr = devicePixelRatio || 1;
    cv.width = Math.max(1, w) * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);
    g.strokeStyle = cssVar('--line-1', cv); g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, Math.round(h / 2) + .5); g.lineTo(w, Math.round(h / 2) + .5); g.stroke();
    if (!actions.length) return;
    const X = (t) => 3 + (duration ? (t / duration) * (w - 6) : (w - 6) / 2), Y = (p) => 3 + (1 - p / 100) * (h - 6);
    g.strokeStyle = cssVar('--reality', cv); g.lineWidth = 1.5; g.lineJoin = 'round';
    g.beginPath();
    actions.forEach((a, i) => (i ? g.lineTo(X(a.at), Y(a.pos)) : g.moveTo(X(a.at), Y(a.pos))));
    g.stroke();
    if (actions.length <= 60) { g.fillStyle = cssVar('--tx-val', cv); for (const a of actions) g.fillRect(X(a.at) - 1.5, Y(a.pos) - 1.5, 3, 3); }
  });
</script>

<!-- the canvas is sized by CSS (width 100%), so the box can shrink as well as grow; `w` only sizes the backing store -->
<div class="thumb" bind:clientWidth={w}><canvas bind:this={cv} style:height="{h}px"></canvas></div>

<style>
  .thumb { width: 100%; min-width: 0; overflow: hidden; }
  canvas { display: block; width: 100%; background: var(--bg-sunken); box-shadow: inset 0 0 0 var(--bw) var(--line-1); border-radius: var(--radius); }
</style>
