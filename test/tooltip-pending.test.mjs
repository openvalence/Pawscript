// paw-6nf7: the kit tip of the trigger under the pointer must come even when another trigger's attachment is torn down (a
// component re-rendering, a reactive tip text re-attaching) or left during its hover delay; that used to clear the shared delay
// timer, and the tip never came on that hover (dev/axes-solo-check.mjs "its tooltip", late in long check runs).
import { test } from 'node:test';
import assert from 'node:assert/strict';

// the least DOM tooltip.js touches
const on = (o) => { o.ls = {}; o.addEventListener = (k, f) => ((o.ls[k] ||= []).push(f)); o.removeEventListener = (k, f) => { o.ls[k] = (o.ls[k] || []).filter((g) => g !== f); }; return o; };
const fire = (o, k, e = {}) => (o.ls[k] || []).forEach((f) => f({ pointerType: 'mouse', buttons: 0, target: o, ...e }));
const el = () => on({ attrs: {}, style: {}, kids: [], open: false, isConnected: true, offsetParent: {}, textContent: '',
  setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, getAttribute(k) { return this.attrs[k] ?? null; },
  hasAttribute(k) { return k in this.attrs; }, append(...n) { this.kids.push(...n); }, replaceChildren() { this.kids = []; },
  matches(s) { return s === ':hover' ? true : s === ':popover-open' ? this.open : false; }, closest() { return null; }, contains(n) { return n === this; },
  checkVisibility() { return true; }, showPopover() { this.open = true; }, hidePopover() { this.open = false; },
  getBoundingClientRect() { return { left: 10, top: 10, right: 60, bottom: 30, width: 50, height: 20 }; } });
const doc = on({ hidden: false, body: el(), documentElement: on({ clientWidth: 1000, clientHeight: 800 }), activeElement: null, createElement: () => el() });
doc.body.append = function (...n) { this.kids.push(...n); for (const x of n) x.isConnected = true; };
Object.assign(globalThis, { document: doc, HTMLElement: class {}, SVGElement: class {}, getComputedStyle: () => ({ position: 'static' }) });
globalThis.window ??= on({});
const { tooltip } = await import('../src/ui/kit/tooltip.js');
const tipText = () => { const t = doc.body.kids.find((k) => k.attrs.role === 'tooltip'); return t?.open ? t.kids.map((k) => k.textContent).join(' ') : ''; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("another trigger's teardown or leave during the hover delay does not cancel the hovered trigger's tip", async () => {
  const a = el(), b = el(), c = el();
  tooltip({ text: 'A tip', delay: 30 })(a);
  const offB = tooltip({ text: 'B tip', delay: 30 })(b);
  tooltip({ text: 'C tip', delay: 30 })(c);
  fire(a, 'pointerenter');
  offB();               // b re-renders: its attachment goes
  fire(c, 'pointerleave');   // and c reports a late leave
  await sleep(80);
  assert.equal(tipText(), 'A tip');
  // its own leave still hides it, and a leave during its own delay still cancels that delay
  fire(a, 'pointerleave');
  assert.equal(tipText(), '');
  await sleep(450);   // past the warm window: the next hover waits its delay again
  fire(a, 'pointerenter'); fire(a, 'pointerleave');
  await sleep(80);
  assert.equal(tipText(), '');
});
