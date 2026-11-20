// The director in a real browser (Playwright + Edge, headless): dev/director.html (the whole shell on the mock backend,
// the fake sidecar world, the scripted brain). A full run through the panel, escalation to you and to assist, re-decide,
// the agent over CDP (with a need round) and over the file mailbox, the project block round trip.
// Own Vite dev server on port 5197 (DIRECTOR_E2E_PORT). Skipped unless DIRECTOR_E2E=1:
//   DIRECTOR_E2E=1 node --test test/director-e2e.test.mjs     (DIRECTOR_SHOTS=<dir> also saves screenshots there)
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ON = process.env.DIRECTOR_E2E === '1';
const root = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.DIRECTOR_E2E_PORT || 5197);
const SHOTS = process.env.DIRECTOR_SHOTS || '';

describe('director e2e', { skip: !ON && 'set DIRECTOR_E2E=1 to run the browser checks' }, () => {
  let server, browser, base;
  before(async () => {
    const { createServer } = await import('vite');
    server = await createServer({ root, logLevel: 'error', server: { port: PORT, strictPort: true, hmr: false, ws: false, watch: null } });
    await server.listen();
    base = server.resolvedUrls.local[0];
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ channel: 'msedge', headless: true });
  });
  after(async () => { await browser?.close(); await server?.close(); });

  async function open(query = '') {
    const page = await (await browser.newContext({ viewport: { width: 1500, height: 1500 } })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + 'dev/director.html' + query);
    await page.waitForFunction(() => window.H);
    await page.evaluate(async () => { window.AS = await import('/src/features/assist/assist.svelte.js'); });
    page.errors = errors;
    return page;
  }
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, name + '.png') }); };
  const closeAssist = (page) => page.evaluate(() => { const A = AS.assistFor(app); if (A.open) A.close(); app.showPanel('director'); });

  test('full run from the panel: twelve steps, the trace-2 plan, two runs compared per span, every decision in the trace', async () => {
    const page = await open();
    await page.locator('.dp button', { hasText: 'Run' }).click();
    await page.waitForFunction(() => H.D.complete && !H.D.busy, null, { timeout: 60000 });
    const r = await page.evaluate(() => ({
      steps: H.D.view.map((s) => s.status), mode: H.D.mode,
      plan: H.app.doc.plan.map((s) => [s.kind, s.source || null]),
      runs: ['s1@4000', 's2@24000'].map((k) => H.app.doc.ghosts.filter((g) => g.source?.tag?.startsWith('director:') && g.source.range.t0 === +k.split('@')[1]).length),
      signs: ['s1@4000', 's2@24000'].map((k) => H.DIR.records['direction:' + k].value.sign),
      recs: Object.keys(H.DIR.records).length, points: H.app.doc.axes.stroke.length,
      queue: H.DIR.queue.map((q) => q.id).sort(), assistOpen: AS.assistFor(app).open,
      block: !!app.saveBlocks?.().director || !!H.DIR.save(),
    }));
    assert.deepEqual(r.steps, Array(12).fill('done'));
    assert.equal(r.mode, 'director');
    assert.deepEqual(r.plan.map((x) => x[0]), ['idle', 'penetration', 'knotting', 'offscreen', 'orgasm', 'outro']);
    assert.ok(r.plan[1][1] && r.plan[2][1] && !r.plan[3][1], 'the two visible spans are pinned to their kept runs, off-screen is not');
    assert.ok(r.runs.every((n) => n >= 2), 'at least two director runs per visible span: ' + r.runs);
    assert.deepEqual(r.signs, [1, -1]);
    assert.ok(r.points > 100);
    // rules decided the directions, so verify goes past rules (README §5) to you: two verify cards
    assert.deepEqual(r.queue, ['verify:s1@4000', 'verify:s2@24000']);
    assert.ok(r.block);
    await closeAssist(page);
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.dp .row').count(), r.recs);
    assert.equal(await page.locator('.dp .card').count(), 2);
    assert.match(await page.locator('.dp .foot').innerText(), /23 decisions · 21 R/);
    assert.match(await page.locator('.k-status-item', { hasText: 'Director' }).innerText(), /2 to answer/);
    await shot(page, 'director-full-run');
    // the verify card: "Looks right" -> status user, the queue drains
    await page.locator('.dp .card[data-id="verify:s1@4000"] button', { hasText: 'Looks right' }).click();
    await page.waitForFunction(() => !H.D.busy && H.DIR.records['verify:s1@4000'].status === 'user', null, { timeout: 30000 });
    assert.deepEqual(await page.evaluate(() => H.DIR.queue.map((q) => q.id)), ['verify:s2@24000']);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });

  test('escalation: unsure directions become cards (provisional applied), the run ends in assist; answering a card writes the fact', async () => {
    const page = await open('?brain=unsure');
    await page.evaluate(() => H.DIR.run());
    const r = await page.evaluate(() => ({ queue: H.DIR.queue.map((q) => q.id).sort(), assistOpen: AS.assistFor(app).open, facts: (app.doc.project?.extra?.assist?.direction || []).length,
      st: H.DIR.records['direction:s2@24000'].status, prov: H.DIR.records['direction:s2@24000'].value.sign, open: AS.assistFor(app).openCount }));
    assert.deepEqual(r.queue, ['direction:s1@4000', 'direction:s2@24000', 'verify:s1@4000', 'verify:s2@24000']);
    assert.equal(r.assistOpen, true, 'Run all hands off to assist when questions wait');
    assert.equal(r.facts, 0, 'guesses are not assist facts');
    assert.equal(r.st, 'queued');
    assert.equal(r.prov, -1);
    await shot(page, 'director-escalation-assist');
    await closeAssist(page);
    await page.waitForTimeout(300);
    const card = page.locator('.dp .card[data-id="direction:s2@24000"]');
    assert.equal(await card.locator('canvas').count(), 2, 'a blind A/B pair');
    await shot(page, 'director-cards');
    // the pre-selected choice is the provisional one; take it
    await card.locator('button.k-btn, button').filter({ hasText: /is deeper/ }).first().waitFor();
    const chosen = await card.evaluate((el) => [...el.querySelectorAll('button')].find((b) => /is deeper/.test(b.textContent) && b.className.includes('primary'))?.textContent.trim());
    await card.locator('button', { hasText: chosen }).click();
    await page.waitForFunction(() => !H.D.busy && H.DIR.records['direction:s2@24000'].status === 'user', null, { timeout: 30000 });
    const after = await page.evaluate(() => ({ queue: H.DIR.queue.map((q) => q.id).sort(), facts: (app.doc.project?.extra?.assist?.direction || []).map((f) => f.t0), sign: H.DIR.records['direction:s2@24000'].value.sign }));
    assert.equal(after.sign, -1);
    assert.deepEqual(after.facts, [24000]);
    assert.ok(!after.queue.includes('direction:s2@24000'));
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });

  test('re-decide: Ask me on a track row queues it with the runs as choices; the answer pins that run', async () => {
    const page = await open();
    await page.evaluate(() => H.DIR.run());
    await closeAssist(page);
    const before = await page.evaluate(() => H.DIR.records['track:s1@4000'].value);
    await page.locator('.dp .row[data-id="track:s1@4000"] button[aria-label^="Ask me"]').click();
    await page.waitForFunction(() => !H.D.busy && H.DIR.queue.some((q) => q.id === 'track:s1@4000'), null, { timeout: 30000 });
    const st = await page.evaluate(() => ({ rec: H.DIR.records['track:s1@4000'], runs: H.DIR.queue.find((q) => q.id === 'track:s1@4000').facts.runs }));
    assert.equal(st.rec.status, 'queued');
    assert.ok(st.rec.supersedes, 'the earlier decision is kept');
    const other = st.runs.find((r) => r.id !== before.keep && r.role === 'subject').id;
    await page.waitForTimeout(200);
    const labels = await page.locator('.dp .card[data-id="track:s1@4000"] button').allInnerTexts();
    assert.ok(labels.includes('Keep ' + other), `${other} is offered: ${labels.join(' / ')}`);
    await page.locator('.dp .card[data-id="track:s1@4000"] button', { hasText: 'Keep ' + other }).click();
    await page.waitForFunction(() => !H.D.busy && H.DIR.records['track:s1@4000'].status === 'user', null, { timeout: 30000 });
    const r = await page.evaluate(() => ({ src: H.app.doc.plan.find((s) => s.t0 === 4000).source, keep: H.DIR.records['track:s1@4000'].value.keep, steps: H.D.view.map((s) => s.status) }));
    assert.equal(r.keep, other);
    assert.equal(r.src, other);
    assert.deepEqual(r.steps, Array(12).fill('done'));
    // re-decide through the store with another brain: forced to that brain, everything else replays
    const n = await page.evaluate(async () => { const before = H.brain.log.length; await H.DIR.redecide('camera:s1', { brain: 'rules' }); return H.brain.log.slice(before); });
    assert.ok(n.includes('camera:s1') && !n.includes('camera:s0'), 'only the re-decided camera was asked again: ' + n.join(' '));
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });

  test('agent over CDP: pending, a need round with blind pairs, a pairs-only answer read back to a sign', async () => {
    const page = await open('?agent=cdp&brain=unsure');
    await page.evaluate(() => { window.RUN = H.DIR.run(); });
    await page.waitForFunction(() => app.director.pending().some((r) => r.id === 'direction:s2@24000'), null, { timeout: 30000 });
    const r1 = await page.evaluate(() => {
      const req = app.director.pending().find((r) => r.id === 'direction:s2@24000');
      const keep = H.DIR.records['track:s2@24000'].value.keep;
      return { req, err: app.director.answer(req.id, { round: 0, need: [{ tool: 'pairs', run: keep, t0: req.scope.t0, t1: req.scope.t1, k: 2 }] }), bad: app.director.answer(req.id, { round: 3, value: { sign: 1, pairs: [] } }) };
    });
    assert.equal(r1.err, null);
    assert.equal(r1.bad, 'not waiting for direction:s2@24000', 'answered: nothing waits until round 1 is posted');
    await page.waitForFunction(() => app.director.pending().some((r) => r.id === 'direction:s2@24000' && r.round === 1), null, { timeout: 30000 });
    const r2 = await page.evaluate(async () => {
      const req = app.director.pending().find((r) => r.id === 'direction:s2@24000');
      const sheet = await app.director.sheet(req.id);
      const pp = req.facts.pickPairs[0];   // the agent judges the frames; here: the truth (low end is out in s2)
      const stale = app.director.answer(req.id, { round: 0, value: { pairs: [] } });
      const err = app.director.answer(req.id, { round: 1, value: { pairs: [{ deep: pp.a.pos > pp.b.pos ? pp.a.at : pp.b.at, shallow: pp.a.pos > pp.b.pos ? pp.b.at : pp.a.at }] }, raw: 0.95, rationale: 'pair A deeper' });
      return { images: sheet.images.length, order: req.evidence.some((e) => e.data?.order), stale, err };
    });
    assert.ok(r2.images > 2, 'the primer pairs plus the two asked for: ' + r2.images);
    assert.equal(r2.order, false, "the agent's copy has no A/B order");
    assert.match(r2.stale, /stale round/);
    assert.equal(r2.err, null);
    // let every other agent request time out quickly: answer what comes with abstain
    await page.evaluate(async () => {
      const t = Date.now();
      while (H.D.busy && Date.now() - t < 30000) { for (const q of H.DIR.agentPending()) app.director.answer(q.id, { abstain: 'not looking' }); await new Promise((ok) => setTimeout(ok, 100)); }
      await window.RUN;
    });
    const rec = await page.evaluate(() => H.DIR.records['direction:s2@24000']);
    assert.equal(rec.brain, 'agent');
    assert.equal(rec.value.sign, -1, 'deep frame at the higher tracked pos: mirrored');
    assert.equal(rec.status, 'decided');
    assert.equal(rec.calibrated, false);
    assert.deepEqual(rec.tools.map((t) => [t.call.tool, t.round]), [['pairs', 0], ['pairs', 0]], 'the primer pairs, then the pairs it asked for (in the trace)');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });

  test('agent over the file mailbox: req file written, answer file picked up, a bad answer gets an error file', async () => {
    const page = await open('?agent=cdp&brain=unsure&mailbox');
    await page.evaluate(() => { window.RUN = H.DIR.run(); });
    await page.waitForFunction(() => [...H.app.backend.files.keys()].some((p) => p.endsWith('/req/direction_s1@4000.json')), null, { timeout: 30000 });
    const r = await page.evaluate(async () => {
      const files = H.app.backend.files, dir = H.DIR.mailbox.root(), sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
      const req = JSON.parse(files.get(dir + '/req/direction_s1@4000.json'));
      await H.app.backend.writeText(dir + '/ans/direction_s1@4000.json', JSON.stringify({ id: req.id, round: 0, value: { sign: 5, pairs: [] } }));
      await sleep(1200);
      const error = files.get(dir + '/ans/direction_s1@4000.error.json');
      await H.app.backend.writeText(dir + '/ans/direction_s1@4000.json', JSON.stringify({ id: req.id, round: 0, value: { sign: 1, pairs: [] }, raw: 0.95 }));
      await sleep(1200);
      const t = Date.now();
      while (H.D.busy && Date.now() - t < 30000) { for (const q of H.DIR.agentPending()) app.director.answer(q.id, { abstain: 'not looking' }); await sleep(100); }
      await window.RUN;
      return { session: JSON.parse(files.get(dir + '/session.json')), error: error && JSON.parse(error), rec: H.DIR.records['direction:s1@4000'], trace: (files.get(dir + '/trace.jsonl') || '').trim().split('\n').length, gone: !files.has(dir + '/req/direction_s1@4000.json') };
    });
    assert.equal(r.session.conventions.pos, '0=deepest,100=out');
    assert.match(r.error.error, /direction\.sign/);
    assert.equal(r.rec.brain, 'agent');
    assert.equal(r.rec.value.sign, 1);
    assert.ok(r.trace >= 20, 'trace.jsonl mirrors the records');
    assert.ok(r.gone, 'the answered request file is removed');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  });

  test('project block: records, overrides and the queue come back; draft comes back in director mode', async () => {
    const page = await open('?brain=unsure');
    await page.evaluate(() => H.DIR.run());
    const r = await page.evaluate(() => {
      const dir = app.blocks.get('director').save(app), dr = app.blocks.get('draft').save(app);
      const json = JSON.parse(JSON.stringify({ dir, dr }));
      app.loadBlocks({});
      const empty = { recs: Object.keys(H.DIR.records).length, mode: H.D.mode, queue: H.DIR.queue.length };
      app.loadBlocks({ director: json.dir, draft: json.dr });
      return { empty, recs: Object.keys(H.DIR.records).length, queue: H.DIR.queue.map((q) => q.id).sort(), mode: H.D.mode, steps: H.D.view.map((s) => s.status), noImages: !JSON.stringify(json.dir).includes('base64') };
    });
    assert.deepEqual(r.empty, { recs: 0, mode: 'rules', queue: 0 });
    assert.equal(r.recs, 23);
    assert.deepEqual(r.queue, ['direction:s1@4000', 'direction:s2@24000', 'verify:s1@4000', 'verify:s2@24000']);
    assert.equal(r.mode, 'director');
    assert.deepEqual(r.steps, Array(12).fill('done'));
    assert.ok(r.noImages);
    // H3: the draft dialog shows the Rules / Director toggle and the twelve director steps
    await page.evaluate(() => { AS.assistFor(app).close?.(); H.D.show = true; });
    const dlg = page.locator('.draft-dialog');
    await dlg.locator('[role="radio"]', { hasText: 'Director' }).waitFor();
    assert.equal(await dlg.locator('[role="radio"][aria-checked="true"]').innerText(), 'Director');
    assert.equal(await dlg.locator('.step').count(), 12);
    await shot(page, 'director-draft-dialog');
    await dlg.locator('[role="radio"]', { hasText: 'Rules' }).click();
    assert.equal(await dlg.locator('.step').count(), 8);
    assert.equal(await page.evaluate(() => H.D.mode), 'rules');
    await page.context().close();
  });
});
