// Kit interaction checks in a real browser (Playwright + Edge) against the gallery's E2E fixtures
// (src/ui/kit/_gallery/E2E.svelte, dev/kit.html#e2e/full). Starts its own Vite dev server on a free port.
// Skipped unless KIT_E2E=1 so `npm run check` stays fast:  KIT_E2E=1 node --test test/kit-e2e.test.mjs
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ON = process.env.KIT_E2E === '1';
const root = fileURLToPath(new URL('..', import.meta.url));

describe('kit e2e', { skip: !ON && 'set KIT_E2E=1 to run the browser checks' }, () => {
  let server, browser, page, base;

  before(async () => {
    const { createServer } = await import('vite');
    server = await createServer({ root, logLevel: 'error', server: { port: 0, strictPort: false, hmr: false, ws: false } });
    await server.listen();
    base = server.resolvedUrls.local[0];
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ channel: 'msedge', headless: true });
  });
  after(async () => { await browser?.close(); await server?.close(); });

  beforeEach(async () => {
    await page?.context().close();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    await page.goto(`${base}dev/kit.html?motion=reduce#e2e/full`);
    await page.waitForSelector('[data-testid=log]');
    await page.waitForFunction(() => !document.querySelector('.e2e .k-hint')); // every fixture landed
  });

  const id = (t) => `[data-testid="${t}"]`;
  const text = (t) => page.locator(id(t)).textContent();
  const log = () => text('log');
  /** Label of the keyboard-active item: the focused element, or its aria-activedescendant. */
  const active = () => page.evaluate(() => {
    const a = document.activeElement;
    const d = a?.getAttribute('aria-activedescendant');
    const el = d ? document.getElementById(d) : a;
    return (el?.querySelector('.k-item-label')?.textContent ?? el?.textContent ?? '').trim();
  });
  const visibleMenus = () => page.locator('[role=menu]:visible').count();

  test('Menu: arrows, submenu in/out, Enter selects, Esc returns focus', async () => {
    await page.click(id('menu-btn'));
    await page.waitForSelector('[role=menu]:visible');
    await page.keyboard.press('ArrowDown');
    if ((await active()) !== 'Open…') await page.keyboard.press('ArrowDown'); // menus may open with nothing active
    assert.equal(await active(), 'Open…');
    await page.keyboard.press('ArrowDown');
    assert.equal(await active(), 'Recent');
    await page.keyboard.press('ArrowRight');
    assert.equal(await visibleMenus(), 2, 'submenu opens');
    assert.equal(await active(), 'alpha.funscript');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await visibleMenus(), 1, 'submenu closes');
    assert.equal(await active(), 'Recent');
    await page.keyboard.press('ArrowDown'); // skips the separator and the disabled item
    assert.equal(await active(), 'Save');
    await page.keyboard.press('Escape');
    assert.equal(await visibleMenus(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), 'menu-btn');
    await page.click(id('menu-btn'));
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    assert.match(await log(), /menu:save/);
    assert.equal(await visibleMenus(), 0);
  });

  test('MenuBar: arrows between menus, open with ArrowDown, Esc returns focus', async () => {
    await page.focus(id('before-menubar'));
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'File');
    await page.keyboard.press('ArrowRight');
    assert.equal(await active(), 'Edit');
    await page.keyboard.press('ArrowDown');
    await page.waitForSelector('[role=menu]:visible');
    assert.equal(await active(), 'Undo');
    await page.keyboard.press('ArrowRight'); // to the next menu, open
    assert.equal(await visibleMenus(), 1);
    assert.equal(await active(), 'Heatmap');
    await page.keyboard.press('Escape');
    assert.equal(await visibleMenus(), 0);
    assert.equal(await active(), 'View');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.match(await log(), /bar:open/);
  });

  test('Tabs: arrows move with automatic activation, disabled skipped', async () => {
    await page.click(`${id('tabs-block')} [role=tab]:has-text("Alpha")`);
    await page.keyboard.press('ArrowRight');
    assert.equal(await text('tab-value'), 'b');
    assert.match(await text('tab-panel'), /panel b/);
    await page.keyboard.press('ArrowRight');
    assert.equal(await text('tab-value'), 'c', 'disabled tab skipped');
    await page.keyboard.press('Home');
    assert.equal(await text('tab-value'), 'a');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await text('tab-value'), 'c', 'wraps');
  });

  test('Tabs: overflow menu lists every tab and selecting one activates it', async () => {
    assert.equal(await page.locator(`${id('tabs-block')} [aria-label="More tabs"]`).count(), 0, 'no button when the tabs fit');
    const more = page.locator(`${id('tabs-ov')} button[aria-label="More tabs"]`);
    await more.click();
    await page.waitForSelector('[role=menu]:visible');
    const items = page.locator('[role=menu]:visible [role=menuitemradio]');
    assert.deepEqual((await items.allTextContents()).map((s) => s.trim()), ['Alpha', 'Beta (3)', 'Off', 'Gamma', 'Delta', 'Omega']);
    assert.equal(await items.nth(0).getAttribute('aria-checked'), 'true', 'the active tab is checked');
    assert.equal(await items.nth(2).getAttribute('aria-disabled'), 'true', 'disabled tab disabled');
    assert.equal(await more.getAttribute('aria-expanded'), 'true');
    await page.waitForTimeout(700); // past the tooltip delay, pointer still on the button
    assert.equal(await page.evaluate(() => !!document.querySelector('.k-tip:popover-open')), false, 'no tip while the menu is open');
    await items.nth(5).click();
    assert.equal(await visibleMenus(), 0);
    assert.equal(await text('tab-ov-value'), 'omega');
    assert.match(await log(), /tabs-ov:omega/);
    const focused = await page.evaluate(() => {
      const a = document.activeElement, l = a.closest('[role=tablist]').getBoundingClientRect(), r = a.getBoundingClientRect();
      return { role: a.getAttribute('role'), sel: a.getAttribute('aria-selected'), text: a.textContent.trim(), inView: r.left >= l.left - 1 && r.right <= l.right + 1 };
    });
    assert.deepEqual(focused, { role: 'tab', sel: 'true', text: 'Omega', inView: true }, 'focus on the chosen tab, scrolled into view');
    // keyboard: the button is the next tab stop after the tablist; Esc returns focus to it
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'More tabs');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[role=menu]:visible');
    await page.keyboard.press('Escape');
    assert.equal(await visibleMenus(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'More tabs');
  });

  test('Slider: arrows, Shift ×10, Home/End', async () => {
    await page.focus(`${id('slider-block')} [role=slider]`);
    await page.keyboard.press('ArrowRight');
    assert.equal(await text('slider-value'), '51');
    await page.keyboard.press('Shift+ArrowRight');
    assert.equal(await text('slider-value'), '61');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await text('slider-value'), '50');
    await page.keyboard.press('End');
    assert.equal(await text('slider-value'), '100');
    await page.keyboard.press('Home');
    assert.equal(await text('slider-value'), '0');
  });

  test('Dialog: focus trap wraps, Esc closes, focus returns', async () => {
    await page.click(id('dlg-open'));
    await page.waitForSelector('dialog[open]');
    const focusId = () => page.evaluate(() => document.activeElement?.dataset.testid ?? document.activeElement?.tagName);
    const inDialog = () => page.evaluate(() => !!document.activeElement?.closest('dialog[open]'));
    assert.equal(await focusId(), 'dlg-first', 'focus starts on the first field');
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      assert.ok(await inDialog(), `Tab ${i + 1} stays inside`);
    }
    await page.focus(id('dlg-first'));
    await page.keyboard.press('Shift+Tab');
    assert.ok(await inDialog(), 'Shift+Tab from the first stop wraps inside');
    assert.notEqual(await focusId(), 'dlg-first');
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog[open]', { state: 'detached' }).catch(() => {});
    assert.equal(await page.locator('dialog[open]').count(), 0);
    assert.match(await log(), /dlg:escape/);
    assert.equal(await focusId(), 'dlg-open', 'focus back on the opener');
  });

  // App shortcuts listen on window: a modal Dialog and an open menu must keep their keystrokes to themselves.
  const windowKeys = () => page.evaluate(() => {
    window.__keys = [];
    window.addEventListener('keydown', (e) => window.__keys.push((e.ctrlKey ? 'Ctrl+' : '') + e.key));
  });
  const seen = () => page.evaluate(() => window.__keys.join(' '));

  test('Dialog: no keydown leaks to window listeners; fields still type, Tab still wraps', async () => {
    await windowKeys();
    await page.click(id('dlg-open'));
    await page.waitForSelector('dialog[open]');
    for (const k of ['5', 'i', 'Control+2', 'Delete', 'Backspace', 'Control+z', 'Tab', 'Enter']) await page.keyboard.press(k);
    assert.equal(await seen(), '', 'nothing reached window');
    await page.fill(id('dlg-first'), '');
    await page.keyboard.type('a5');
    assert.equal(await page.inputValue(id('dlg-first')), 'a5');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('dialog[open]').count(), 0);
    await page.keyboard.press('5');
    assert.equal(await seen(), '5', 'keys reach window again once it closes');
  });

  test('Menu: an open menu stops non-menu keys (digits, Ctrl combos) from reaching window', async () => {
    await windowKeys();
    await page.click(id('menu-btn'));
    await page.waitForSelector('[role=menu]:visible');
    for (const k of ['5', 'Control+2', '[', 'Delete']) await page.keyboard.press(k);
    assert.equal(await visibleMenus(), 1, 'still open');
    assert.equal(await seen(), '');
    await page.keyboard.press('Escape');
    assert.equal(await visibleMenus(), 0);
  });

  test('NumberField: drag to scrub changes the value, one commit', async () => {
    const box = await page.locator(`${id('number-block')} input`).boundingBox();
    const y = box.y + box.height / 2, x = box.x + box.width / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(x + i * 6, y);
    await page.mouse.up();
    await page.waitForTimeout(50);
    const v = Number(await text('num-value'));
    assert.ok(v > 10, `value grew from 10, got ${v}`);
    assert.ok(Number(await text('num-changes')) >= 1, 'onchange live');
    assert.equal(await text('num-commits'), '1', 'exactly one commit per gesture');
  });

  test('SplitPane: drag resizes and respects min / minOther', async () => {
    const sep = page.locator(`${id('split')} [role=separator]`);
    const b = await sep.boundingBox();
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y, { steps: 5 });
    await page.mouse.up();
    assert.equal(Number(await text('split-size')), 260);
    const w = async () => (await page.locator(id('split-first')).boundingBox()).width;
    await page.mouse.move(x + 60, y);
    await page.mouse.down();
    await page.mouse.move(x - 400, y, { steps: 8 });
    await page.mouse.up();
    assert.ok(Math.abs((await w()) - 100) <= 1, `held at min 100, got ${await w()}`);
    const b2 = await sep.boundingBox();
    await page.mouse.move(b2.x + b2.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(b2.x + 800, y, { steps: 8 });
    await page.mouse.up();
    const total = (await page.locator(id('split')).boundingBox()).width;
    const second = total - (await w()) - b2.width;
    assert.ok(second >= 150 - 2, `other pane kept its 150 minimum, got ${second}`);
  });

  test('VirtualList: 100 000 rows keep the DOM small', async () => {
    const rows = () => page.locator(id('vrow')).count();
    assert.ok((await rows()) < 60, `rendered ${await rows()} rows`);
    await page.locator(`${id('vlist')} .k-virtual-list, ${id('vlist')} [role=list], ${id('vlist')} [role=listbox]`).first().evaluate((el) => {
      const s = el.scrollHeight > el.clientHeight ? el : el.querySelector('*') ?? el;
      s.scrollTop = s.scrollHeight;
    });
    await page.waitForTimeout(100);
    assert.ok((await rows()) < 60);
    assert.ok(await page.locator(`${id('vrow')}:has-text("Row 99999")`).count(), 'last row reachable');
  });
  // ---- tooltip lifetime: a tip never outlives its trigger, its visibility, the hover or the focus ----
  // open, or still painted: a closed popover that keeps an author display (.k-tip's flex) stays drawn at its last place
  const tipOpen = () => page.evaluate(() => [...document.querySelectorAll('.k-tip')].some((t) => t.matches(':popover-open') || t.checkVisibility()));
  const hoverTip = async (t) => {
    const b = await page.locator(id(t)).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 });
    await page.waitForFunction(() => !!document.querySelector('.k-tip:popover-open'), null, { timeout: 2000 });
    return b;
  };

  test('Tooltip: moving the pointer away hides the tip (plain hover, no events lost)', async () => {
    const b = await hoverTip('tip-plain');
    await page.mouse.move(b.x + b.width / 2, b.y + b.height + 80, { steps: 4 });   // off the button, onto nothing
    await page.waitForTimeout(250);
    assert.equal(await tipOpen(), false, 'tip hidden after the pointer left');
    await hoverTip('tip-plain');
    await page.mouse.move(b.x + b.width / 2, b.y + b.height + 80, { steps: 1 });   // a jump: pointerleave is the only event
    await page.waitForTimeout(250);
    assert.equal(await tipOpen(), false, 'tip hidden after a jump away');
  });
  test('Tooltip: a trigger that removes itself on click takes its tip with it', async () => {
    await hoverTip('tip-self');
    await page.mouse.down();
    assert.equal(await tipOpen(), false, 'a press hides the tip at once');
    await page.mouse.up();
    assert.equal(await page.locator(id('tip-self')).count(), 0, 'the trigger is gone');
    await page.waitForTimeout(800); // longer than the show delay: nothing may come back under the still pointer
    assert.equal(await tipOpen(), false);
  });

  test('Tooltip: removed by keyboard while its keyboard-shown tip is open', async () => {
    await page.focus(id('tip-hidden'));
    await page.keyboard.press('Shift+Tab'); // keyboard focus on tip-keyed: :focus-visible shows the tip
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), 'tip-keyed');
    assert.equal(await tipOpen(), true, 'keyboard focus shows the tip');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator(id('tip-keyed')).count(), 0);
    await page.waitForTimeout(200);
    assert.equal(await tipOpen(), false);
  });

  test('Tooltip: a keyboard-shown tip hides when the mouse moves elsewhere', async () => {
    await page.mouse.move(5, 5);
    await page.focus(id('tip-hidden'));
    await page.keyboard.press('Shift+Tab');   // keyboard focus on tip-keyed shows its tip
    assert.equal(await tipOpen(), true);
    await page.mouse.move(40, 40, { steps: 2 });   // the pointer is nowhere near the focused trigger
    await page.waitForTimeout(100);
    assert.equal(await tipOpen(), false, 'moving the mouse elsewhere hides a focus-shown tip');
    await page.keyboard.press('Tab');   // leave the trigger focused elsewhere for the next test
  });
  test('Tooltip: a trigger hidden by its parent under a still pointer loses its tip', async () => {
    await hoverTip('tip-hidden');
    await page.evaluate(() => { document.querySelector('[data-testid=tip-parent]').style.display = 'none'; });
    await page.waitForTimeout(300);
    assert.equal(await tipOpen(), false, 'the watchdog hid it (display: none)');
    await page.evaluate(() => { document.querySelector('[data-testid=tip-parent]').style.display = ''; });
    await page.mouse.move(5, 5);
    await hoverTip('tip-hidden');
    await page.evaluate(() => { document.querySelector('[data-testid=tip-parent]').style.visibility = 'hidden'; });
    await page.waitForTimeout(300);
    assert.equal(await tipOpen(), false, 'the watchdog hid it (visibility: hidden)');
  });

  test('Tooltip: Escape, scroll and window blur hide; never shows with a button held; one at a time', async () => {
    await hoverTip('tip-plain');
    await page.keyboard.press('Escape');
    assert.equal(await tipOpen(), false, 'Escape');
    await page.mouse.move(5, 5);
    await hoverTip('tip-plain');
    await page.evaluate(() => document.dispatchEvent(new Event('scroll')));
    assert.equal(await tipOpen(), false, 'scroll');
    await page.mouse.move(5, 5);
    await hoverTip('tip-plain');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal(await tipOpen(), false, 'window blur');
    // press elsewhere, drag onto the trigger with the button held: no tip
    await page.mouse.move(5, 5);
    await page.waitForTimeout(500);
    await page.mouse.down();
    const b = await page.locator(id('tip-plain')).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
    await page.waitForTimeout(800);
    assert.equal(await tipOpen(), false, 'no tip while a button is held');
    await page.mouse.up();
    await page.mouse.move(5, 5);
    // one shared tip: hovering a second trigger replaces the first
    await hoverTip('tip-plain');
    await hoverTip('tip-hidden');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.k-tip:popover-open').length), 1);
    assert.equal(await page.evaluate(() => document.querySelector('.k-tip').textContent), 'Hidden by parent');
  });
  test('Tooltip: a native title= becomes a kit tip on hover (WebView2 leaves native ones up after the pointer leaves)', async () => {
    await page.evaluate(() => {
      const b = Object.assign(document.createElement('button'), { title: 'Native title', textContent: 'titled' });
      b.dataset.testid = 'tip-native';
      b.style.cssText = 'position:fixed;left:600px;top:400px';
      document.body.append(b);
    });
    await page.mouse.move(5, 5);
    await hoverTip('tip-native');
    assert.equal(await page.evaluate(() => document.querySelector('.k-tip').textContent), 'Native title');
    assert.deepEqual(await page.locator(id('tip-native')).evaluate((b) => [b.getAttribute('title'), b.getAttribute('aria-description')]),
      [null, 'Native title'], 'the title attribute is gone before the WebView can show its own tooltip; screen readers keep it');
    const b = await page.locator(id('tip-native')).boundingBox();
    for (let i = 1; i <= 6; i++) await page.mouse.move(b.x + b.width / 2 + i * 3, b.y + b.height / 2 + i * 15);
    await page.waitForTimeout(250);
    assert.equal(await tipOpen(), false, 'gone once the pointer left');
    await page.locator(id('tip-native')).evaluate((b) => b.setAttribute('title', 'Changed'));   // a component rewrote it
    await hoverTip('tip-native');
    assert.equal(await page.evaluate(() => document.querySelector('.k-tip').textContent), 'Changed', 're-adopted');
  });
  // ---- gaps closed after the feature migrations ----
  test('Section: wide content never widens it; actions show on focus within, or always', async () => {
    const w = (t) => page.locator(id(t)).evaluate((el) => el.getBoundingClientRect().width);
    assert.ok((await w('sec-wide')) <= 240, `section ${await w('sec-wide')}px stays inside its 240px dock`);
    const over = await page.locator(id('sec-wrap')).evaluate((el) => el.scrollWidth - el.clientWidth);
    assert.ok(over <= 1, `nothing overflows the dock (scrollWidth excess ${over}px)`);
    const op = (t) => page.locator(id(t)).evaluate((el) => +getComputedStyle(el.parentElement).opacity);
    assert.equal(await op('sec-act'), 0, 'hover-mode actions hidden at rest');
    assert.equal(await op('sec-act-always'), 1, "actionsVisible='always'");
    await page.focus(id('sec-inner'));
    await page.waitForTimeout(200);
    assert.equal(await op('sec-act'), 1, 'focus anywhere inside the Section shows its actions');
  });

  test('Button grow fills the free space of its row', async () => {
    const g = await page.locator(id('grow-btn')).boundingBox(), f = await page.locator(id('fixed-btn')).boundingBox();
    const row = await page.locator(id('grow-row')).boundingBox();
    assert.ok(Math.abs(f.x + f.width - (row.x + row.width)) <= 1, 'row filled to its end');
    assert.ok(g.width > f.width * 2, `grow ${g.width} vs fixed ${f.width}`);
  });

  test('Menu items take a custom {path} glyph; no tooltip on a button whose menu is open', async () => {
    const b = await page.locator(id('gap-menu-btn')).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 });
    await page.waitForFunction(() => !!document.querySelector('.k-tip:popover-open'));
    await page.mouse.down(); await page.mouse.up();
    await page.waitForSelector('[role=menu]:visible');
    assert.equal(await page.locator(id('gap-menu-btn')).getAttribute('aria-expanded'), 'true');
    await page.mouse.move(b.x + b.width / 2 + 1, b.y + b.height / 2, { steps: 2 });
    await page.waitForTimeout(800);
    assert.equal(await page.evaluate(() => !!document.querySelector('.k-tip:popover-open')), false, 'tip suppressed while open');
    const d = await page.locator('[role=menu] [role^=menuitem]').first().locator('path').first().getAttribute('d');
    assert.equal(d, 'M2.75 8h10.5M8 2.75v10.5');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator(id('gap-menu-btn')).getAttribute('aria-expanded'), null, 'restored on close');
  });
});
