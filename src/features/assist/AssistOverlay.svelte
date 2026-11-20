<!--
  AssistOverlay: the review flow, a full-window kit Dialog (modal.js). One question at a time: big frames, the question
  as the title, the answer keys as big kit Kbd caps, progress; the next question appears the moment a key is pressed
  (its frames were decoded in the background). Keys come from commands.js (scoped to this overlay being open); clicks
  on the keys / frames do the same.
-->
<script>
  import { assistFor } from './assist.svelte.js';
  import { DEPTH_PRESETS, fmtClock } from './model.js';
  import Frame from './Frame.svelte';
  import { eventChord } from '../../app/keymap.js';
  import { Dialog, Button, Kbd, Badge, ProgressBar, tooltip } from '../../ui/kit/index.js';

  let { app } = $props();
  const A = $derived(assistFor(app));

  const KIND = { direction: 'Direction', track: 'Track check', activity: 'Activity', depth: 'Depth', fallback: 'Fallback' };
  const TONE = { direction: 'accent', track: 'info', activity: 'ok', depth: 'neutral', fallback: 'warn' };
  const EVENT = { still: 'the tracker saw little motion', carry: 'the tracker carried the rhythm over a gap', idle: 'the tracker held still', gap: 'the script has no strokes' };

  const q = $derived(A.q);
  const p = $derived(A.progress);
  const sug = $derived(A.suggestion);
  const crop = $derived(A.crop?.[1] ?? null);
  const pair = $derived(q?.kind === 'direction' ? q.pairs[A.pairIdx] || q.pairs[0] : null);
  const dur = $derived(app.durationMs || 1);
  const depthMs = $derived(q?.kind === 'depth' ? (app.doc.axes[q.axis], A.deepestAt(q)) : null);
  const ghostColor = (id) => app.doc.ghosts?.find((g) => g.id === id)?.color || 'var(--highlight)';
  const title = $derived(A.mode === 'done' ? (p.open ? 'Skipped questions are left' : 'Nothing left to ask')
    : A.mode === 'split' ? 'Where does the direction change?' : q?.prompt || 'Assist');

  // The dialog traps Tab and takes Escape for itself; both are answer keys here, so they go to the command registry
  // first (capture phase). The other keys pass on (passKeys) to the registry's window listener, but only the ones it
  // gives to assist (answers, swallowed keys), undo / redo and save: anything else (rate, mode, docks, axis, the other
  // features' keys) would act behind the overlay, so it is stopped here (the registry ignores a prevented key).
  const PASS = /^(assist\.|edit\.(undo|redo)$|file\.save$)/;
  const route = (e) => {
    if (e.key === 'Tab' || e.key === 'Escape') { app.commands.handleKey(e); return; }
    const chord = eventChord(e), id = chord && app.commands.winner(chord);
    if (id && !PASS.test(id)) e.preventDefault();
  };
  // short spans: frames a tenth of a second apart would read the same
  const clk = (t) => fmtClock(t, q && q.t1 - q.t0 < 1000 ? 2 : 1);

  // time from the answer key to the next question's frames on screen (A.metrics; the harness reads it)
  let pending = null;
  $effect(() => {
    const x = q; A.mode;
    if (!x || !A.open || A.mode !== 'ask') return;
    const need = x.kind === 'direction' ? [pair.a.at, pair.b.at] : A.timesOf(x).slice(0, x.kind === 'track' ? 4 : 1);
    pending = { qid: x.id, kind: x.kind, need: new Set(need.map((t) => Math.floor(t / (A.frames?.frameMs || 33)))), at: A.pressAt, cached: need.every((t) => A.frames?.peek(t)) };
    if (pending.cached) { A.metrics.push({ qid: x.id, kind: x.kind, waitMs: performance.now() - pending.at, cached: true }); pending = null; }
  });
  function drawn(t) {
    if (!pending) return;
    pending.need.delete(Math.floor(t / (A.frames?.frameMs || 33)));
    if (!pending.need.size) { A.metrics.push({ qid: pending.qid, kind: pending.kind, waitMs: performance.now() - pending.at, cached: false }); pending = null; }
  }

  // the activity loop: the span, muted, over and over
  let loopEl = $state(null);
  $effect(() => {
    const v = loopEl, x = q;
    if (!v || !x || x.kind !== 'activity') return;
    v.playbackRate = x.t1 - x.t0 > 8000 ? 2 : 1;
    v.currentTime = x.t0 / 1000;
    v.play().catch(() => {});
  });
  const loopTick = () => { if (loopEl && q?.kind === 'activity' && loopEl.currentTime * 1000 >= q.t1) loopEl.currentTime = q.t0 / 1000; };

  const press = (k) => A.press(k);
  const noFocus = (e) => e.preventDefault();
</script>

<Dialog open={A.open} modal passKeys dismissible={false} {title} class="assist-dlg" onkeydowncapture={route}
  style="--k-dialog-w: 100vw; height: calc(100dvh - 2 * var(--space-6))">
  <!-- initial focus here, not on a button: Enter / Space must reach the command registry, not click the focused button -->
  <div class="top" tabindex="-1" data-autofocus>
    {#if A.mode === 'done'}<Badge tone="ok" variant="solid">Done</Badge>
    {:else if A.mode === 'split'}<Badge tone="warn" variant="solid">Split</Badge>
    {:else if q}<Badge tone={TONE[q.kind]} variant="solid">{KIND[q.kind]}</Badge>{/if}
    <ProgressBar class="bar" value={p.total ? p.done / p.total : 0} label="Answered" />
    <span class="prog k-num" {@attach tooltip('Answered of all · estimated stroke score gain')}>
      <b>{Math.min(p.total, p.done + (A.mode === 'done' ? 0 : 1))}</b> of {p.total} · est. <b>+{p.gain.toFixed(2)}</b>
    </span>
    <Button size="sm" variant="ghost" tabindex="-1" onmousedown={noFocus} onclick={() => press('Escape')}><Kbd keys="Escape" /> {A.mode === 'split' ? 'Cancel split' : 'Leave'}</Button>
  </div>

  <section class="where">
    {#if A.last}<span class="last">{A.last.text}{#if A.stack.length} · <Kbd keys="Backspace" /> take back{/if}</span>{/if}
    <span class="sp"></span>
    {#if q && A.mode !== 'done'}
      <span>span <b class="k-num">{q.label}</b></span>
      {#if q.evidence?.strokes}<span>{q.evidence.strokes} strokes</span>{/if}
      {#if q.kind === 'direction' && A.mode === 'ask'}<span>pair {A.pairIdx + 1} of {q.pairs.length}</span>{/if}
      {#if q.evidence?.presplit}<span class="warn">possible change at {fmtClock(q.evidence.presplit)}</span>{/if}
      {#if q.kind === 'track'}<span>run <b>{q.ghostName}</b></span>{/if}
    {/if}
  </section>

  <main class="stage">
    {#if A.mode === 'done'}
      <div class="done">
        <div class="big">{p.done} answered{p.open ? ` · ${p.open} open` : ''}</div>
        <div>Estimated gain <b>+{p.gain.toFixed(2)}</b> on the fixed-direction stroke score.</div>
        <div class="mut">Every answer is one undo step. The answers are saved with the project, so a new track does not ask again.</div>
      </div>
    {:else if A.mode === 'split' && A.split}
      {@const s = A.split}
      <div class="splitv">
        <div class="slot"><Frame {A} ms={s.cands[s.i].at} {crop} /><span class="tag">{fmtClock(s.cands[s.i].at)} · the direction changes from here</span></div>
        <div class="cands">
          {#each s.cands as c, i (c.at)}
            <button class="thumb" class:sel={i === s.i} class:before={i < s.i} tabindex="-1" onmousedown={noFocus} onclick={() => (A.split = { ...s, i: Math.max(1, i) })} ondblclick={() => A.doSplit(Math.max(1, i))}>
              <Frame {A} ms={c.at} {crop} /><span>{fmtClock(c.at)}</span>
            </button>
          {/each}
        </div>
        <p class="hint">These are the moments the script calls <b>deepest</b>. Step to the first one that is <b>not</b> deep and press <Kbd keys="Enter" />: both halves get their own question.</p>
      </div>
    {:else if q?.kind === 'direction' && pair}
      <div class="pair">
        {#each [['ArrowLeft', '1', 'left', pair.a], ['ArrowRight', '2', 'right', pair.b]] as [key, n, id, x] (id)}
          <button class="slot" class:sug={sug?.choice === id} tabindex="-1" onmousedown={noFocus} onclick={() => press(key)}>
            <Frame {A} ms={x.at} {crop} ondrawn={drawn} />
            <span class="badge"><Kbd keys={key} /><Kbd keys={n} /></span>
            <span class="tag">{fmtClock(x.at)}</span>
            {#if sug?.choice === id}<span class="sugtag"><Badge tone="info" variant="solid">suggested</Badge></span>{/if}
          </button>
        {/each}
      </div>
    {:else if q?.kind === 'track' || q?.kind === 'fallback'}
      {@const gid = q.kind === 'track' ? q.ghost : q.other || q.ghost}
      <div class="grid n{q.times.length}">
        {#each q.times as t (t)}
          <div class="slot"><Frame {A} ms={t} overlay={A.overlay(gid, t)} color={ghostColor(gid)} ondrawn={drawn} /><span class="tag">{clk(t)}</span></div>
        {/each}
      </div>
    {:else if q?.kind === 'activity'}
      <div class="act">
        <div class="slot">
          <!-- svelte-ignore a11y_media_has_caption -->
          <video bind:this={loopEl} src={A.url} muted playsinline ontimeupdate={loopTick}></video>
          <span class="tag">looping {fmtClock(q.t0)}–{fmtClock(q.t1)} · {((q.t1 - q.t0) / 1000).toFixed(1)} s · {EVENT[q.event] || q.event}</span>
        </div>
        <div class="film">{#each q.times as t, i (t)}<div class="slot"><Frame {A} ms={t} ondrawn={i === 0 ? drawn : null} /><span class="tag">{clk(t)}</span></div>{/each}</div>
      </div>
    {:else if q?.kind === 'depth'}
      <div class="depth">
        <div class="slot"><Frame {A} ms={depthMs} {crop} ondrawn={drawn} /><span class="tag">the deepest moment the script has here · {fmtClock(depthMs)}</span></div>
        <div class="presets">
          {#each DEPTH_PRESETS as d (d.id)}
            <button class="preset" tabindex="-1" onmousedown={noFocus} onclick={() => press(d.key)}>
              <span class="bar"><span class="fill" style="top:{100 - d.hi}%;bottom:{d.lo}%"></span></span>
              <Kbd keys={d.key} /><span>{d.label}</span><span class="mut k-num">{d.lo}–{d.hi}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </main>

  {#if sug && A.mode === 'ask'}
    <section class="suggest">
      <Kbd keys="Enter" /> <b>{sug.choice === 'left' ? 'Left' : 'Right'} is deeper</b>, suggested because {sug.reason}. Press <Kbd keys="Enter" /> to confirm, or answer yourself.
    </section>
  {:else}<div></div>{/if}

  <footer>
    <div class="caps">
      {#if A.mode === 'done'}
        <Button size="lg" variant="primary" tabindex="-1" onmousedown={noFocus} onclick={() => press('Enter')}><Kbd keys="Enter" /> Leave</Button>
        {#if A.stack.length}<Button size="lg" tabindex="-1" onmousedown={noFocus} onclick={() => press('Backspace')}><Kbd keys="Backspace" /> Take back</Button>{/if}
      {:else if A.mode === 'split'}
        <Button size="lg" tabindex="-1" onmousedown={noFocus} onclick={() => press('ArrowLeft')}><Kbd keys="ArrowLeft" /> Earlier</Button>
        <Button size="lg" tabindex="-1" onmousedown={noFocus} onclick={() => press('ArrowRight')}><Kbd keys="ArrowRight" /> Later</Button>
        <Button size="lg" variant="primary" tabindex="-1" onmousedown={noFocus} onclick={() => press('Enter')}><Kbd keys="Enter" /> Split here</Button>
      {:else if q}
        {#each q.choices as c (c.id)}
          <Button size="lg" variant={sug?.choice === c.id ? 'primary' : c.id === 'skip' ? 'ghost' : 'default'} tabindex="-1" onmousedown={noFocus} onclick={() => press(c.key)}>
            <Kbd keys={c.key} />{#if c.alt}<Kbd class="alt" keys={c.alt} />{/if} {c.label}
          </Button>
        {/each}
      {/if}
    </div>
    <div class="hints">
      {#if q?.kind === 'direction' && A.mode === 'ask' && q.pairs.length > 1}<span><Kbd keys="Tab" /> another pair</span>{/if}
      {#if A.mode === 'ask' && A.crop && (q?.kind === 'direction' || q?.kind === 'depth')}<span><Kbd keys="Z" /> showing {A.crop[0]}</span>{/if}
      {#if A.mode === 'split'}<span><Kbd keys="Shift+ArrowLeft" /> <Kbd keys="Shift+ArrowRight" /> 5 at a time</span>{/if}
      {#if A.mode === 'ask'}<span><Kbd keys="ArrowUp" /> previous</span>{/if}
      <span><Kbd keys="Backspace" /> take back</span>
      <span><Kbd keys="Escape" /> leave</span>
    </div>
  </footer>

  <nav class="strip" aria-label="Questions over time">
    {#each A.questions as x, i (x.id)}
      <button class="qb {A.stateOf(x)} r-{x.kind}" class:cur={i === A.cur} tabindex="-1" onmousedown={noFocus} onclick={() => A.goto(i)} aria-label="{KIND[x.kind]} {x.label}"
        style="left:{(x.t0 / dur) * 100}%;width:{Math.max(0.3, ((x.t1 - x.t0) / dur) * 100)}%" {@attach tooltip(`${KIND[x.kind]} ${x.label}: ${A.stateOf(x)}`)}></button>
    {/each}
  </nav>
</Dialog>

<style>
  :global(.k-dialog.assist-dlg) { background: var(--bg); }
  :global(.k-dialog.assist-dlg > .k-dialog-body) { display: grid; grid-template-rows: auto auto 1fr auto auto 22px; gap: var(--space-4); padding: 0 var(--space-6) var(--space-4); overflow: hidden; }
  .top { display: flex; align-items: center; gap: var(--space-6); outline: none; }
  .top :global(.bar) { flex: 1; }
  .prog { font-size: var(--fs-3); color: var(--tx-mut); white-space: nowrap; }
  .prog b { color: var(--tx-hi); font-weight: 500; }
  .where { display: flex; gap: var(--space-6); align-items: center; color: var(--tx-mut); font-size: var(--fs-2); min-height: 20px; }
  .where b { color: var(--tx); font-weight: 500; }
  .where .warn { color: var(--warn-ink); }
  .where .last { color: var(--ok-ink); }
  .sp { flex: 1; }

  .stage { min-height: 0; display: flex; }
  .stage > * { flex: 1; min-height: 0; }
  .slot { position: relative; display: block; padding: 0; border: 2px solid var(--line-2); background: var(--bg-sunken); border-radius: var(--radius); overflow: hidden; min-height: 0; color: inherit; font: inherit; cursor: pointer; transition: border-color var(--t-quick) var(--ease-out); }
  button.slot:hover { border-color: var(--line-4); }
  button.slot:active { border-color: var(--highlight); }
  .slot.sug { border-color: var(--intent); border-style: dashed; }
  .slot .tag { position: absolute; left: var(--space-4); bottom: var(--space-4); font: var(--fs-2) var(--mono); color: var(--tx-hi); background: var(--scrim); padding: var(--space-1) var(--space-3); border-radius: var(--radius); }
  .slot .badge { position: absolute; left: var(--space-5); top: var(--space-5); display: flex; gap: var(--space-2); }
  .slot .sugtag { position: absolute; right: var(--space-5); top: var(--space-5); }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-6); }
  .grid { display: grid; gap: var(--space-5); grid-template-columns: repeat(2, 1fr); grid-auto-rows: 1fr; }
  .grid.n3 { grid-template-columns: repeat(3, 1fr); grid-auto-rows: auto; align-content: center; }
  .grid.n3 .slot { aspect-ratio: 16 / 9; }
  .act { display: grid; grid-template-columns: 3fr 2fr; gap: var(--space-6); }
  .act video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: var(--bg-sunken); }
  .film { display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 1fr; gap: var(--space-4); min-height: 0; }
  .depth { display: grid; grid-template-columns: 3fr 2fr; gap: var(--space-6); }
  .presets { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-5); align-content: center; }
  .preset { display: grid; grid-template-columns: var(--space-7) auto 1fr; grid-template-rows: auto auto; column-gap: var(--space-4); align-items: center; padding: var(--space-5); border: var(--bw) solid var(--line-2); background: var(--bg-card); color: var(--tx); border-radius: var(--radius); font: inherit; cursor: pointer; text-align: left; }
  .preset:hover { border-color: var(--line-4); }
  .preset .bar { grid-row: 1 / 3; position: relative; width: var(--space-5); height: 64px; background: var(--bg-sunken); border: var(--bw) solid var(--line-ctl); }
  .preset .fill { position: absolute; left: 0; right: 0; background: var(--reality); }
  .preset .mut { grid-column: 2 / 4; }
  .mut { color: var(--tx-mut); }
  .splitv { display: grid; grid-template-columns: 3fr 2fr; grid-template-rows: 1fr auto; gap: var(--space-5); }
  .splitv .hint { grid-column: 1 / 3; margin: 0; color: var(--tx); font-size: var(--fs-4); }
  .cands { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); grid-auto-rows: 74px; gap: var(--space-3); overflow: auto; align-content: start; }
  .thumb { position: relative; padding: 0; border: 2px solid var(--line-2); background: var(--bg-sunken); border-radius: var(--radius); overflow: hidden; cursor: pointer; }
  .thumb.before { opacity: .55; }
  .thumb.sel { border-color: var(--warn-ink); }
  .thumb span { position: absolute; left: var(--space-1); bottom: var(--space-1); font: var(--fs-1) var(--mono); color: var(--tx-hi); background: var(--scrim); padding: 0 var(--space-2); }
  .done { display: flex; flex-direction: column; gap: var(--space-5); align-items: center; justify-content: center; font-size: var(--fs-4); }
  .done .big { font-size: var(--fs-7); color: var(--tx-hi); }
  .suggest { padding: var(--space-4) var(--space-5); border: var(--bw) dashed var(--intent); color: var(--tx); background: rgba(var(--intent-rgb), .08); border-radius: var(--radius); font-size: var(--fs-4); }

  footer { display: flex; flex-direction: column; gap: var(--space-4); align-items: center; }
  .caps { display: flex; gap: var(--space-5); flex-wrap: wrap; justify-content: center; }
  /* the answer keys: the kit's Kbd caps, drawn large */
  .caps :global(.k-kbd kbd), .slot .badge :global(.k-kbd kbd) { height: var(--space-8); min-width: var(--space-8); font-size: var(--fs-5); color: var(--tx-hi); }
  .caps :global(.k-kbd.alt kbd) { height: var(--space-7); min-width: var(--space-7); font-size: var(--fs-3); color: var(--tx-mut); }
  .caps :global(.k-button) { height: calc(var(--space-8) + 2 * var(--space-4)); gap: var(--space-4); font-size: var(--fs-4); }
  .hints { display: flex; gap: var(--space-7); color: var(--tx-mut); font-size: var(--fs-2); }

  .strip { position: relative; border-top: var(--bw) solid var(--line-1); background: var(--bg-sunken); }
  .qb { position: absolute; height: 4px; padding: 0; border: 0; background: var(--line-4); cursor: pointer; min-width: 3px; }
  .qb.r-direction { top: 3px; } .qb.r-track, .qb.r-fallback { top: 8px; } .qb.r-activity { top: 13px; } .qb.r-depth { top: 17px; height: 3px; }
  .qb.answered { background: var(--ok); } .qb.skipped { background: var(--tx-ghost); } .qb.split { background: var(--warn); }
  .qb.open { background: var(--reality); }
  .qb.cur { outline: var(--ring-w) solid var(--highlight); outline-offset: 1px; z-index: 1; }
</style>
