// dev/run-bar.mjs -- paw-k8pe: on the Track tab the run's controls (source, Pair, vs camera, the fusion pad and its pin, depth,
// baseline) are the lane toolbar's, right of Track's cog (tracking/RunBar.svelte); what does not fit the row folds into its one …
// popover (data-testid run-more / run-more-body). A check reaches them with `await runCtl(page)` first: it waits for the bar and
// opens the popover when something is folded (nothing folded: nothing to do), so `.pick .src`, `[data-testid="fuse-pad"]`, ...
// are on screen either way. The popover stays open while one of its own menus is used (kit Popover: a .k-menu is inside).
export async function runCtl(page, { timeout = 10000 } = {}) {
  await page.waitForSelector('[data-testid="run-bar"]', { timeout });
  await page.waitForTimeout(250);   // the row measures its groups (a frame or two) before it folds the tail
  const opened = await page.evaluate(() => { const m = document.querySelector('[data-testid="run-more"]'); if (!m || m.getAttribute('aria-expanded') === 'true') return false; m.click(); return true; });
  if (opened) await page.waitForSelector('[data-testid="run-more-body"]', { timeout });
}

/** Folds the popover back (its … again; no Escape: that key has other meanings in the app). */
export async function runClose(page) {
  if (await page.evaluate(() => { const m = document.querySelector('[data-testid="run-more"]'); if (m?.getAttribute('aria-expanded') !== 'true') return false; m.click(); return true; })) await page.waitForTimeout(150);
}

/** The run bar's controls: how many are in the row, how many in the popover (opened to count), the popover's state. */
export async function runBarCount(page) {
  await runCtl(page);
  return page.evaluate(() => {
    const bar = document.querySelector('[data-testid="run-bar"]'), body = document.querySelector('[data-testid="run-more-body"]');
    const ctl = (el) => (el ? el.querySelectorAll('button, [role="note"]').length : 0);
    const row = [...bar.querySelectorAll(':scope > .g')].reduce((a, g) => a + ctl(g), 0), fixed = ctl(bar.querySelector(':scope > .fix'));
    return { fixed, row, folded: ctl(body), total: fixed + row + ctl(body), groups: [...bar.querySelectorAll('.g')].map((g) => g.dataset.group) };
  });
}
