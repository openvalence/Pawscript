# features/assist

The "ask the user" queue: the few decisions the automatic pipeline cannot make, each answered with one key, ordered by
expected gain, applied at once as one undo entry, remembered in the project.

| File | What |
|---|---|
| `model.js` | pure: `buildQueue(input)`, `pickPairs`, `directionSpans`, `flipHint`, `scriptGaps`, `splitQuestion`, `orderQueue`, `progress`, the decisions block (`readBlock`, `blockOf`, `decisionFor`, `withDecision`), `LIFT`, choice tables |
| `apply.js` | pure: `applyDirection` (inverts exactly `[t0, t1)` when the script disagrees; idempotent), `orientTo`, `applyActivity` (lib/gen plan segment + `doc.plan`), `applyDepth`, `applyFallback`, `cutPlan`, `choiceFor` |
| `learn.js` | pure: `suggest(q, samples, thumb)` (look-alike scene, or a cue that predicted >= 80 % of >= 3 answers) |
| `frames.js` | `createFrames({url})`: hidden `<video>` pool + priority queue + LRU (`get`, `peek`, `want`), `thumbOf` |
| `assist.svelte.js` | the store `assistFor(app)` / `peekAssist(app)`: queue, overlay state, answers, Backspace stack, persistence, preload, preview ghost |
| `commands.js` | `assist.open` (F6), `assist.regenerate`, `assist.reapply`, `assist.orientGhosts`, `assist.clearDecisions`, `assist.next/prev`; answer keys `assist.key.*` (hidden, `when` overlay open) and `assist.swallow` (digits, Delete, Q ... do nothing while open) |
| `modal.js` → `AssistOverlay.svelte` | full-window kit Dialog (`passKeys`: its keys are commands); a key the registry would give to anything but assist, undo / redo or save is stopped there, so nothing acts behind it; `Frame.svelte` draws one frame (crop to ROI, tracker overlay) |
| `panel.js` → `AssistPanel.svelte` | right dock, Track + Review: the queue (VirtualList), Regenerate (an "out of date" badge when the script changed, not by an answer), Start |
| `status.js` → `AssistChip.svelte` | "N questions" StatusItem (needs a shell glob for `features/*/status.js`) |

Tests: `test/assist-model.test.mjs`; browser: `ASSIST_E2E=1 node --test test/assist-e2e.test.mjs` (own Vite on 5474). Harness: `dev/assist.html` (port 5188), clip `bash dev/assets/make-assist-clip.sh`.

## Questions and keys
| kind | shows | keys |
|---|---|---|
| direction | two frames: consecutive extremes of the script, never across a scene, split, plan segment or tracker event span edge, preferring pairs far from them (Tab: next of ~5 pairs, Z: cycles contact zone / tracker region / whole frame; times snap to the tracker's own turning points) | ← / 1 left deeper, → / 2 right deeper, ↓ can't tell, S changes inside (split mode: ←/→ step through the frames the script calls deepest, Shift ×5, Enter split, Esc cancel) |
| track | 4 frames with the stored overlay of the run that covers the scene most (timeline chooseRun rule), taken from the part it covers; scenes no run covers are not asked | Y / N / ↓; N adds a **fallback** question (Y use the other run here — only when there is one —, R re-track: paint the part, Track ROI, N keep) |
| activity | the span looping muted + 6-frame filmstrip; a `assist-preview` ghost shows the carry result | Y carry the rhythm, N idle (hold), C orgasm (deep tremor), ↓ |
| depth | the deepest frame (Z crops like direction) + 4 range presets | 1-4, ↓ |
Everywhere: Enter confirms a suggestion, Backspace takes back the last answer (and its edit), ↑ / PageUp previous, Esc leaves.

## Persistence
`app.doc.project.extra.assist` (lib/io `setBlock`): `{v:1, direction:[{t0,t1,deep,shallow}], splits:[ms], track:[{t0,t1,ghost,ok}],
activity:[{t0,t1,state}], depth:[{t0,t1,preset}]}`. A direction decision is a fact ("the frame at `deep` is deeper than the one
at `shallow`"), so it holds for any later track: a span whose script agrees is not asked again; one that disagrees is asked with
the remembered answer as the suggestion (`assist.reapply` applies them all). An answer whose undo entry is undone (Ctrl+Z anywhere)
stops counting until it is redone. The block is only written into the document the queue was built for: another
document (open, close, restore) brings a fresh queue built from its own block. A write marks the document dirty.
