# Copy

Pawscript's user-visible text follows the OpenValence family's string standard. This page only points to it and
holds Pawscript's own glossary; it does not restate the rules.

## Where the rules live

- **The standard:** `Nucleus/.claude/rules/strings.md`, "User-visible strings: the standard and the string pass".
  Sections that govern Pawscript's text:
  - *The rubric, Everywhere*: every string.
  - *By kind, Phosphor UI*: tooltips, hints, placeholders, status lines, toasts, dialogs (Pawscript is held to the
    same bar as Phosphor).
  - *By kind, Refusals*: error toasts and messages.
  - *By kind, Instructions*: `docs/guide/*.md`.
  - *Hard constraints*: text a test or parser matches changes with it, in the same commit.
  - *The method: the string pass*, and *When it runs*.
- **American English:** `Nucleus/.claude/rules/governance.md`, law C-11.
- **App mechanics** (tooltip length, story words, no trailing period, a tip never repeats its label):
  `Phosphor/docs/COPY.md`, rules 1 to 4 and 10. Pawscript's tooltip is the kit `tooltip` / `tip`, never `title=`.
- **Comments:** governance.md C-12. Rationale, history and owner quotes go in comments and the guide, never in a string.

`test/strings-standard.test.mjs` checks the mechanical part of these rules on the command registry and on every
literal tooltip, tip, placeholder and toast in `src/`; each assertion names the rule it enforces.

## Glossary: one name per thing

| Say | Never in UI text | Meaning |
|---|---|---|
| point | action, keyframe | one position at one time in a script |
| axis | channel, track | one funscript (stroke, roll, twist ...); its row is a *lane* |
| script | | the points of every axis |
| `.funscript` | | the file players read |
| scene | | the action and its tags, groups, modifiers: one or more shots |
| shot | clip, segment | a camera span inside a scene, between two cuts |
| cut / camera move | soft cut, hard cut | the boundary before a shot: a cut reseeds, a camera move is tracked through |
| action region | span | an act drawn over shots on the Actions strip |
| run | track result, tracking job | one tracker result over a range, drawn as a ghost |
| ghost | overlay, preview line | a run or reference drawn over a lane, not your points |
| group | blob, mask set | a painted set of parts on a shot's seed frame |
| part | | one painted part of a group (names come from the part label settings) |
| Bottom / Top | receiver / giver | the receiving and the penetrating character, capitalized |
| modifier | effect, fx | Orgasm, Knotting, Throbbing, Idle ... on the Modifiers row |
| spurt | pulse, shot | one cumshot marker on its frame |
| anchor | pin | a point you fix that the tracked script must pass through |
| the tracker | sidecar, pawtrack, backend | the tracking engine |
| proxy | transcode | a playable copy of the video |
| Bake | Apply (a run) | make the live tracked script permanent points (the Bake model) |
| checkpoint | snapshot, version | a stored state of the project you can go back to |
| Publish | | write the `.funscript` files beside the video (the Bake model) |
| Machine | simulator | the Machine panel's simulated machine and body |
| device | toy, hub (in general text) | real hardware played from the Device panel |
| range | selection span | the I/O range on the timeline |
| band | | an Autorange depth band on the Range row |
| plan / segment | | the Plan row and one block of it |
