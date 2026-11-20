/**
 * toast.svelte.js -- transient notifications. ToastHost.svelte (mounted once) draws `toasts`.
 *
 *   toast('Saved video.funscript', { kind: 'ok', tip: fullPath });   (the tip option: the message's tooltip)
 *   const id = toast('Tracker crashed', { kind: 'bad', action: { label: 'Show log', run: openLog } });
 *   dismissToast(id);
 *
 * kind is a Tone. Every kind but 'bad' times out (`timeout` ms, default 4000; 0 = stays); 'bad' lives BAD_MS
 * unless given a longer or shorter timeout (0 too: an error never stays for ever). While the pointer or focus is on the stack the host calls
 * pauseToasts(true), which freezes every countdown (at least RESUME_MS is left when it resumes). Over
 * MAX_TOASTS the oldest one that would time out anyway goes at once, else the oldest (paw-ky2g: the stack is capped).
 * The same message and kind again while it shows is counted on it (`count`, the host shows "×3") and its countdown starts over.
 */
export const MAX_TOASTS = 4;
export const RESUME_MS = 1500;
export const BAD_MS = 60_000;   // paw-ky2g: a 'bad' toast's life when none (or 0) is given: long, never for ever
export const toasts = $state([]);

let seq = 0, paused = false;
const timers = new Map(); // id -> { left, end, t }

/** @returns {number} the toast's id (the one showing, for a repeat) */
export function toast(message, { kind = 'info', timeout, action, actions, tip = '' } = {}) {
  const ms = kind === 'bad' && !timeout ? BAD_MS : timeout ?? 4000;
  message = String(message);
  const same = toasts.find((t) => t.message === message && t.kind === kind);
  if (same) {
    same.count = (same.count || 1) + 1;
    if (action) same.action = action;
    if (actions) same.actions = actions;
    if (tip) same.tip = tip;
    clearTimeout(timers.get(same.id)?.t);
    timers.delete(same.id);
    count(same.id, ms);
    return same.id;
  }
  const id = ++seq;
  toasts.push({ id, message, kind, action: action ?? null, ...(actions?.length ? { actions } : {}), count: 1, tip: String(tip || '') });
  count(id, ms);
  if (toasts.length > MAX_TOASTS) dismissToast((toasts.find((t) => t.id !== id && timers.has(t.id)) ?? toasts[0]).id);
  return id;
}

function count(id, ms) {
  if (!(ms > 0 && Number.isFinite(ms))) return;
  timers.set(id, { left: ms, end: 0, t: 0 });
  if (!paused) arm(id);
}

/** Every toast away (the host's "Dismiss all"). */
export function dismissAll() { for (const t of [...toasts]) dismissToast(t.id); }

export function dismissToast(id) {
  clearTimeout(timers.get(id)?.t);
  timers.delete(id);
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}

/** Freeze (true) or resume (false) every countdown. */
export function pauseToasts(on) {
  if (!!on === paused) return;
  paused = !!on;
  for (const [id, x] of timers) {
    if (paused) { clearTimeout(x.t); x.left = Math.max(RESUME_MS, x.end - Date.now()); } else arm(id);
  }
}

function arm(id) {
  const x = timers.get(id);
  x.end = Date.now() + x.left;
  x.t = setTimeout(() => dismissToast(id), x.left);
}
