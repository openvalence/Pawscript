// dev/boot-store-check.mjs -- paw-pq6b in the REAL window (your test instance: node dev/test-app.mjs start ...; the CDP_* env it
// prints). The owner's log: "Cannot read properties of undefined (reading 'flatMap') in $effect in DraftChip.svelte in
// StatusBar.svelte" x5 at a start. The tracking store's always-on effects were made by the status bar's Draft chip (the first to
// ask for the store), so they hung under its error boundary. Asserted on a fresh start and a generated clip:
//   home: the status bar painted, no app:error; the tracking store's project blocks registered before any project opens;
//   the clip opened: the status bar's items painted, no app:error;
//   a tracking effect made to throw (reading an undefined list, as in the owner's log): reported as the store's own error,
//   never caught as the status bar's Draft chip ("[status draft]"), and the status bar still paints.
//   node dev/boot-store-check.mjs <clip.mp4>
import { connectTestApp } from './cdp-connect.mjs';

const [clip] = process.argv.slice(2);
if (!clip) { console.error('usage: node dev/boot-store-check.mjs <clip.mp4>'); process.exit(2); }
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const consoleErrors = [], pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) consoleErrors.push(m.text().slice(0, 300)); });
const appErrors = () => ev(() => app.usage.log.filter((e) => e.kind === 'app:error').map((e) => e.detail));
const statusBar = () => ev(() => ({ help: !!document.querySelector('[data-testid=status-help]')?.getBoundingClientRect().width, items: document.querySelectorAll('.sb .k-status-item, .sb [class*=item]').length }));
const answer = () => ev(() => { const d = app.dialog; if (!d) return ''; d.resolve(d.choices.find((c) => c.kind !== 'danger')?.id ?? null); return d.title; });

try {
  await page.waitForFunction(() => window.app?.project && window.__pawDev?.trackingFor, null, { timeout: 60000 });
  await wait(1500);
  let sb = await statusBar();
  ok(sb.help, `home: the status bar is painted (its F1 button), ${sb.items} items`);
  ok((await appErrors()).length === 0 && !pageErrors.length, `home: no app:error, no page error ${JSON.stringify([await appErrors(), pageErrors])}`);
  const blocks = await ev(() => ['tracking', 'runs', 'links', 'loopLinks', 'draft'].filter((k) => app.blocks.has(k)));
  ok(blocks.length === 5, `home: the tracking store's blocks are registered before any project opens: ${blocks}`);

  const p = ev((v) => app.project.openVideo(v, { force: true }), clip);
  for (let k = 0; k < 8; k++) { await wait(300); await answer(); }
  await p;
  await page.waitForFunction(() => app.doc.media && app.player.ready, null, { timeout: 60000 });
  await wait(1500);
  sb = await statusBar();
  const axis = await ev(() => [...document.querySelectorAll('.sb *')].some((e) => /points/.test(e.textContent || '')));
  ok(sb.help && axis, `the clip open: the status bar paints its items (axis / points: ${axis})`);
  ok((await appErrors()).length === 0 && !pageErrors.length && !consoleErrors.length, `the clip open: no app:error, no page / console error ${JSON.stringify([await appErrors(), pageErrors, consoleErrors])}`);

  // the owner's symptom: a tracking effect reading an undefined list. The bridges are a $derived since paw-x7w7 (2e31f7a), so
  // undefining them no longer breaks an effect: the store's always-on effect that re-stitches seeds on a shot change is made
  // to read one instead, and a shot change sets it off
  await ev(() => {
    const tr = window.__pawDev.trackingFor(app), none = undefined;
    tr.restitchSeeds = () => none.flatMap((x) => x);
    app.doc.scenes = [...(app.doc.scenes || [])];
  });
  await wait(1500);
  const draftCaught = consoleErrors.filter((t) => t.includes('[status draft]'));
  const reported = [...pageErrors, ...consoleErrors].filter((t) => t.includes("reading 'flatMap'"));
  ok(reported.length > 0, `the broken effect is reported (${reported.length}): ${reported[0]?.slice(0, 120)}`);
  ok(draftCaught.length === 0, `never caught as the status bar's Draft chip ("[status draft]": ${draftCaught.length})`);
  ok((await appErrors()).some((t) => /flatMap/.test(t)), 'logged as app:error (an app error, not hidden)');
  sb = await statusBar();
  ok(sb.help, 'the status bar still paints');
  await ev(() => { delete window.__pawDev.trackingFor(app).restitchSeeds; });   // the store's own method again for whatever runs next
} catch (e) {
  fails++;
  console.log('FAIL', e?.stack || e);
} finally {
  console.log(fails ? `${fails} FAILED` : 'all ok');
  await browser.close().catch(() => {});
  process.exit(fails ? 1 : 0);
}
