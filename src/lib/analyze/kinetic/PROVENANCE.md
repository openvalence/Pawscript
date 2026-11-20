# Vendored: Kinetic2 planner (kinetic.wasm as bytes.js)

The machine's own motion planner, used for accurate "what the machine will really do" previews. Owner-approved copy.

| | |
|---|---|
| Files | `bytes.js` (verbatim copy, base64 module, 219 540 B), `kinetic.pin` (verbatim copy), `bytes.sha256` (ours), `driver.js` (ours, adapted from Phosphor's `kinetic.js` / `scheduler.js`) |
| Source | `OpenValence/Phosphor\plugins\factory\funscript-player\kinetic\{bytes.js,kinetic.pin}` (Phosphor commit d2dd33d, 2026-10-25) |
| Built from | Nucleus `531ade38c7e57c754461e82c04c4746c6f4c0f05`, version string `nucleus 531ade38c7e5 kinetic2 2.0.0-dev`, wasm 164 530 B (Kinetic2 + MotionArbiter + ideal emitter, `Nucleus/tools/kinetic-wasm`) |
| sha256 of bytes.js | `9b20e5d5948754fd134e5c5c7b4f5d55be9f15d49b64b3542802110c982b2ee2` (also in `bytes.sha256`) |
| Licence | Apache-2.0 (Kinetic, Nucleus and Phosphor: "Copyright 2026 AtlanticTM"; each repo has LICENSE and NOTICE.md). `bytes.js` itself carries no header. |
| Pin test | `test/analyze-kinetic-pin.test.mjs` fails if the hash, the decoded wasm size or the version string drift from the recorded values. |

Note: Phosphor's pin is older than Nucleus HEAD (31f4b85) at the time of copying. We follow Phosphor's pin on purpose: the preview should equal what Phosphor's player renders.

## Refresh
1. In Phosphor: `node test/kinetic-pin.mjs --write` (rebuilds from a clean Nucleus, rewrites `bytes.js` and `kinetic.pin`).
2. Copy both files here, replacing ours (the originals stay read-only here).
3. `sha256sum bytes.js | cut -d' ' -f1 > bytes.sha256`; update the table above and `PIN` values in the pin test if you changed the version.
4. `npm run check`.
