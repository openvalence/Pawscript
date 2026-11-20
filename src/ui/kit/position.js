/**
 * position.js -- placing a floating box (popover, menu, listbox, tooltip) next to an anchor.
 *
 * place() is pure (node-tested): side + alignment, flip to the other side when the preferred one is short
 * and the other has more room, then shift along the cross axis to stay `padding` inside the viewport, and
 * report the room left on the chosen side so the caller can cap the height (a long list scrolls).
 *
 * float() is the DOM half: shows `el` in the top layer (popover="manual", so no portal and no z-index war)
 * and keeps it placed while the page scrolls, resizes, or the box itself changes size.
 */

/** @typedef {{x:number,y:number,width:number,height:number}} Rect */
const SIDES = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/**
 * @param {{anchor: Rect, float: {width:number,height:number}, viewport: {width:number,height:number},
 *   placement?: string, offset?: number, padding?: number, flip?: boolean}} o
 *   placement: 'bottom' | 'bottom-start' | 'bottom-end' | 'top…' | 'left…' | 'right…'
 * @returns {{x:number, y:number, placement:string, side:string, maxWidth:number, maxHeight:number}}
 */
export function place({ anchor: a, float: f, viewport: v, placement = 'bottom-start', offset = 4, padding = 8, flip = true }) {
  let [side, align = 'center'] = placement.split('-');
  if (!(side in SIDES)) throw new Error('placement side: ' + side);
  const room = {
    top: a.y - offset - padding,
    bottom: v.height - (a.y + a.height) - offset - padding,
    left: a.x - offset - padding,
    right: v.width - (a.x + a.width) - offset - padding,
  };
  const vertical = side === 'top' || side === 'bottom';
  const need = vertical ? f.height : f.width;
  if (flip && room[side] < need && room[SIDES[side]] > room[side]) side = SIDES[side];

  let x, y;
  if (vertical) {
    y = side === 'bottom' ? a.y + a.height + offset : a.y - offset - f.height;
    x = align === 'start' ? a.x : align === 'end' ? a.x + a.width - f.width : a.x + (a.width - f.width) / 2;
    x = shift(x, f.width, v.width, padding);
    if (side === 'top') y = Math.max(padding, y);
  } else {
    x = side === 'right' ? a.x + a.width + offset : a.x - offset - f.width;
    y = align === 'start' ? a.y : align === 'end' ? a.y + a.height - f.height : a.y + (a.height - f.height) / 2;
    y = shift(y, f.height, v.height, padding);
    if (side === 'left') x = Math.max(padding, x);
  }
  return {
    x: Math.round(x), y: Math.round(y),
    placement: align === 'center' ? side : `${side}-${align}`, side,
    maxWidth: Math.max(0, vertical ? v.width - 2 * padding : room[side]),
    maxHeight: Math.max(0, vertical ? room[side] : v.height - 2 * padding),
  };
}

/** Keep [p, p+size] inside [pad, total-pad]; when it cannot fit, pin it to the start. */
function shift(p, size, total, pad) {
  return Math.max(pad, Math.min(p, total - size - pad));
}

const rectOf = (r) => ({ x: r.x ?? r.left, y: r.y ?? r.top, width: r.width ?? 0, height: r.height ?? 0 });

/**
 * Show `el` as a top-layer popover next to `anchor` (an Element, a {x,y,width?,height?} point/rect, or a
 * function returning either) and keep it there. Sets `data-side` on el (for an arrow or the rise
 * direction) and caps its max-height to the room on that side. -> { update(), destroy() }
 */
export function float(el, anchor, opts = {}) {
  if (!el.hasAttribute('popover')) el.setAttribute('popover', 'manual');
  if (!el.matches(':popover-open')) el.showPopover();
  const minHeight = opts.minHeight ?? 120;
  let raf = 0;
  const update = () => {
    raf = 0;
    if (!el.isConnected) return;
    const src = typeof anchor === 'function' ? anchor() : anchor;
    if (!src) return;
    const a = rectOf(src instanceof Element ? src.getBoundingClientRect() : src);
    const vv = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
    if (opts.matchWidth && src instanceof Element) el.style.minWidth = a.width + 'px';
    const scrolled = el.scrollTop;   // lifting the cap below lets the box grow, which clamps its scroll to 0
    el.style.maxHeight = '';
    const r = el.getBoundingClientRect();
    let p = place({ ...opts, anchor: a, float: { width: r.width, height: r.height }, viewport: vv });
    if (r.height > p.maxHeight) {
      // Too tall for its side: cap it (it scrolls), then place the capped box.
      el.style.maxHeight = Math.max(minHeight, p.maxHeight) + 'px';
      const h = el.getBoundingClientRect().height;
      p = place({ ...opts, flip: false, placement: p.placement, anchor: a, float: { width: r.width, height: h }, viewport: vv });
    }
    el.scrollTop = scrolled;
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
    el.dataset.side = p.side;
    el.style.setProperty('--k-dy', p.side === 'top' ? '1' : '-1');
  };
  // a scroll inside the box itself (a long menu) moves nothing the placement depends on
  const schedule = (e) => { if (e?.type === 'scroll' && e.target instanceof Node && el.contains(e.target)) return; if (!raf) raf = requestAnimationFrame(update); };
  update();
  const ro = new ResizeObserver(schedule);
  ro.observe(el);
  if (anchor instanceof Element) ro.observe(anchor);
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, true);
  return {
    update,
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      if (el.isConnected && el.matches(':popover-open')) el.hidePopover();
    },
  };
}

/**
 * Close-on-outside and close-on-Escape for a floating box. `inside` elements (the anchor, submenus) do
 * not count as outside. Escape is stopped here so an enclosing dialog stays open. -> off()
 */
export function dismiss(el, onDismiss, inside = []) {
  const isIn = (t) => t instanceof Node && (el.contains(t) || inside.some((n) => n && (typeof n === 'function' ? n(t) : n.contains(t))));
  const down = (e) => { if (!isIn(e.target)) onDismiss(e); };
  const key = (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); onDismiss(e); }
  };
  const blur = (e) => { if (e.target === window) onDismiss(e); };
  document.addEventListener('pointerdown', down, true);
  el.addEventListener('keydown', key);
  window.addEventListener('blur', blur);
  return () => {
    document.removeEventListener('pointerdown', down, true);
    el.removeEventListener('keydown', key);
    window.removeEventListener('blur', blur);
  };
}
