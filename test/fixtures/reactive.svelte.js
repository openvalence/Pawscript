// reactive state for tests that drive real effects (client build)
/** A deep $state proxy of o. */
export function reactive(o) {
  const s = $state(o);
  return s;
}
/** {current}: a $state.raw cell (an object put in stays itself, not a proxy). */
export function cell(v) {
  let s = $state.raw(v);
  return { get current() { return s; }, set current(x) { s = x; } };
}
