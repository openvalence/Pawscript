// physics.js -- the Machine panel's model of a silicone toy, the anal canal and the body around it: plausible-looking
// dynamics for planning scripts and scenes, not a measurement of any toy or body and not guidance on what is safe for
// a person. Pure, no DOM.
//
// The script asks for a depth: target = offsetMm + (1 - pos/100) * strokeMm (pos 0 = deepest), capped at the toy's
// usable length. The machine is a closed-loop position servo with a force cap (forceLimitN): its CARRIAGE dc follows
// the target exactly while the force it puts through the toy stays under the cap, holds the cap and falls behind when
// the resistance needs more, and resumes tracking smoothly when it can (no lost position, no catch-up jump).
//
// The body is not bolted down (bodyGive, "Body give": Fixed .. Loose): the toy's push moves the hips away by xb (a
// spring-damper to rest, mass and stiffness from the height), so the carriage relative to the body is dc - xb and the
// real penetration d is measured from the opening (the stroke window shows d against the opening, exactly). At Fixed
// xb stays 0 and everything goes into the toy and the tissue.
//
// The toy is silicone, not rigid: its mechanics come from its material grade(s) (materials.js) and its own
// cross-sections (toyMechanics). It follows the body-relative carriage through its own axial mode, an underdamped
// spring-mass (period from axialMs, damping ratio toyDamp x the silicone's loss factor), but may only move while every
// station of the canal it reaches lets its (squashed) girth through. Stations resting on the toy press on it radially
// (their hold); on a sloped flank that pressure has an axial part (ringForce): it resists on a rising flank and
// ASSISTS on a falling one. So a knot is a snap-through (paw-tgq): pushed against the rim it stalls, the toy compresses
// and the ring is forced open (slowly, viscous); the moment its widest point passes the tightest station the ring
// closes on the falling flank (elastic, at once), the force on the toy reverses and the stored compression is
// released: the knot shoots in past the carriage, overshoots a little and settles. Pulled out, the mirror: the toy
// stretches, the rim is drawn out, and past the widest point it flies out.
//
// The anal canal is a short sleeve of `canalN` stations over its ~35 mm (scaled by height), each with its own
// aperture a[j], wrapped around the toy's profile wherever the toy is: a knot is gripped behind its widest point, a
// flare is held, a taper wedges it open progressively, and the most loaded station moves along the toy as it passes.
// Stations are coupled to their neighbours (one stretched station holds the next partly open). Openings up to a
// station's comfortable radius are free; past it the station yields at (|F| - hold) / viscosity, so a knot takes time
// and a too-brief push fails. Two sphincters set the tone (resistance and closing) along the canal:
//   - internal (smooth, involuntary): most of the resting tone, over the upper two-thirds; it relaxes slowly (tens of
//     seconds) under sustained stretch and recovers slowly (minutes): that relaxation w (0..1) IS the warm-up: it
//     raises the comfortable radius rc = restMm * (1 + (capacity - 1) * w) and lowers the resistance;
//   - external (striated, voluntary): lower and outer (its subcutaneous part at the verge); fast; a brief reflex
//     clench on a sudden fast stretch when cold (fading with warm-up / experience); it fatigues under sustained
//     stretch and recovers.
// Tone is calibrated by resting and squeeze pressures from anorectal manometry (typical values, large variation):
// Rao SSC et al., "Minimum standards of anorectal manometry", Neurogastroenterol Motil 2002;14:553-559; Carrington EV
// et al., "The international anorectal physiology working group (IAPWG) recommendations: standardized testing protocol
// and the London classification", Neurogastroenterol Motil 2020;32:e13679 (resting ~40-80 mmHg, ~70 % internal
// sphincter; squeeze increment ~100-180 mmHg).
// The tissue is viscoelastic: the force to hold a stretch relaxes over seconds (q, stress relaxation), and a long or
// wide stretch leaves a residual opening g that closes over minutes (gape): after a big toy or a knot the opening
// stays partly open (fast elastic recoil, then the slow part), so re-entry soon after is easier. Loading meets the
// viscous yield, unloading only the (relaxed) elastic part: in and out differ, and a fast thrust meets more.
// The canal is dragged along by friction (holeGive, "Hole give"; lube): the rim travels xi mm with the toy (in on the
// in-stroke, everting on the out-stroke) while the elastic return stays under static friction mu * N (N from how
// tightly the canal grips), then slides back; a bulge blocked against the canal drags it directly (a knot pulled from
// inside draws the whole area out before the pop). The stations ride xi; the knot passes the rim at d - xi.
//
// The knot (toys.js knotOf) is "pressing" while its front half is at the rim, "tied" once its widest point (of the
// real toy) has passed inside the rim; passing back out is a "pop". Knot attempts are timed against the carriage: the
// lag from "a rigid toy would be in now" to "it is in" (and the same for the pop), or a failure with how much longer
// the push had to be held. The state at any time is integrated from the start of the script on a fixed time grid
// (MachineSim, checkpoints every checkpointMs), so scrubbing and playing give the same answer.
// Depth (anatomy.js): past the canal the path turns at the anorectal flexure and again at the rectosigmoid junction.
// At each bend the tissue must leave a turn each station of the toy can take (its bending stiffness against the
// tissue's, and never tighter than bendFloor x its radius: silicone does not fold); the turn left = rest angle * (1 -
// depth readiness) * (1 - forced straightening). When it is more, the toy stalls at the bend like the knot at the
// rim; the push (force past bendF0, at most the toy's buckling load) straightens it at a finite rate (bendVisc, cold
// -> ready), slowly undone when the toy leaves (bendRecoverS). Depth readiness grows while the tip works near a bend
// (the flexure in tens of seconds, the rectosigmoid over minutes: depthWarmS) and fades when left alone (depthCoolS).
// The tube past the canal (paw-z0k): depth readiness is spatial. Every 5 mm from the top of the canal to the end of
// the sigmoid a station has a resting lumen (anatomy.js restRadius), a readiness (tone relaxed by depth work: builds
// while the toy works at or near it, fades when left alone) that widens its resting lumen, and a residual opening (the
// elastic part: builds toward a share of the stretch while the toy holds it open, recoils over seconds once empty), so
// after a deep toy the lumen closes fast at first (the residue) and then slowly (the tone coming back). Per segment
// (TUBE): the rectal ampulla a compliant reservoir (wide, low tone, slow to return), the rectosigmoid junction a tonic
// narrowing (opens over minutes of depth work, closes faster than the ampulla while little worked, more slowly once
// well worked), the sigmoid narrower, collapsing onto the toy and recovering quickly at first. The two bends'
// readiness (acc) IS the station's at the bend (one model; the readouts are its summary), and a residual opening at a
// bend makes it give faster (re-entry soon after is easier all the way down).
// Two slow states past the junction (paw-qin8; plausible estimates from anatomy texts and one person's measurement,
// not a measurement of anyone's body):
//   - the sigmoid straightens with use (sig, 0..1): mobile on its long mesentery, it is carried by the toy (the 3 s
//     envelope, TISSUE_RETURN) and, the longer and deeper and wider it is carried, its rest shape itself relaxes toward
//     a straighter path lying forward against the front abdominal wall (first order toward sigmoidMax x the drive over
//     sigmoidS while the tip works in it; back to 0 over sigmoidRecS once the tip has left it; SIGMOID); it takes part
//     of the rectosigmoid turn away and the view draws the loop forward (centreline.js solvePath forward);
//   - a modelled body's descending colon (classically fixed to the back wall; about a third of people have a mobile
//     portion) is a third bend whose turn readies far more slowly and less completely than the first two (descWarmS /
//     descCoolS, up to descCeil: descMax raised by descMobility, "Descending give"), needs a harder push to force
//     (DESC_BEND), and is only passed by a toy flexible enough for what is left of its turn: a stiffer toy stops there
//     (depthSummary fixedStop). How far a tip gets into the turn before it must take it (the owner saw ~20 mm between
//     toys) comes from the toy's tip: its radius profile and grade (descReach).

import { radiusTable, knotOf, radiusAt } from './toys.js';
import { GRADES, parseFirmness, LOSS } from './materials.js';
import { bendsAt, restAngles, bendWindows, restRadius, ANATOMY, SIDE } from './anatomy.js';
import { toyBend, carriedShare } from './centreline.js';

export const PARAMS = Object.freeze({
  experience: 'some',  // the experience preset (EXPERIENCE) the tissue values below come from
  restMm: 12,          // comfortable radius at the verge when cold, mm
  capacity: 3.2,       // fully relaxed comfortable radius = restMm * capacity
  closedFrac: 0.3,     // closed aperture with nothing inside = restMm * closedFrac
  gape: 0.35,          // internal-sphincter relaxation leaves the closed canal open by gape * w * (comfortable - closed)
  recoilMs: 150,       // fast elastic recoil time constant, ms
  warmS: 25,           // internal sphincter relaxation under sustained stretch, time constant, s ("Warm-up")
  coolS: 240,          // its recovery (tone returning) with nothing inside, s
  holdFactor: 6,       // in contact but stretched less than the relaxation reached: recovery this many times slower
  w0: 0,               // relaxation at the start of the script (experience)
  overRef: 0.3,        // overstretch (fraction past the comfortable radius) that reads as strain 1
  speedRef: 250,       // canal opening speed (mm/s) that reads as one unit of the speed term
  speedK: 0.35,        // weight of the speed term in the strain
  soften: 0.4,         // relaxation lowers the felt strain: strain * (1 - soften * w)
  readyStrain: 0.5,    // the knot is "ready" when taking it slowly would strain at most this
  // ---- calibration: the constants that set the force and time scales, in plain terms (Tuning > Calibration shows
  // them; anchors from real toys and bodies go here, no code change needed). The toy's are given for a reference
  // shaft (Medium 00-50, 32 mm wide, 200 mm long); every other toy and grade scales from it by its own modulus and
  // cross-sections (materials.js, toyMechanics).
  toyAxialRef: 1.5,    // N per mm the reference shaft resists being shortened
  toyBuckleRef: 126,   // N at which the reference shaft buckles sideways (braced by the tissue around it)
  toySquashRef: 0.12,  // the most a Medium toy's girth squashes at the opening (fraction)
  toySquashN: 150,     // N of push that squashes a Medium toy that far
  toyDamp: 4,          // the toy's axial damping ratio = toyDamp x the silicone's loss factor (materials.js LOSS 0.1 -> 0.4):
                       // the bare material rings far longer (ratio ~ loss / 2); lube and mucosa take the rest. Below 1:
                       // released compression shows as a lunge and a small overshoot (the knot's snap), not a creep
  bendTime: 1,         // x how long a bend takes to give way to a push (both bends' straightening viscosities)
  depthTime: 1,        // x how long depth readiness takes to build (both bends)
  firmness: '5',       // toy silicone grade code (materials.js): 2 / 3 / 5 / 8 = Shore 00-20 / 30 / 50 / 80, "3/8" = shaft / base
  // the canal sleeve and its two sphincters
  canalN: 8,           // stations along the anal canal
  tone: 60,            // resting anal pressure, mmHg ("Tightness"; typical 40-80): scales every station's hold and viscosity
  iasFrac: 0.7,        // share of the resting tone from the internal sphincter (manometry: ~55-85 %)
  iasRelax: 0.4,       // fraction of the internal sphincter's tone gone when fully relaxed (w = 1)
  squeezeMmHg: 120,    // voluntary squeeze increment over rest, mmHg (typical 100-180): the reflex clench reaches reflexMax of it
  reflexK: 0.6,        // reflex clench gain on a sudden fast stretch when cold (experience lowers it)
  reflexMax: 0.15,     // the strongest reflex clench, as a fraction of a full squeeze
  reflexS: 0.5,        // the clench fades over this, s
  fatigueS: 45,        // the external sphincter fatigues under sustained stretch over this, s (to half its tone)
  fatigueRecS: 120,    // and recovers over this, s
  profTop: 1.6,        // comfortable radius at the top of the canal vs at the verge (the high-pressure zone is low)
  couple: 0.85,        // a stretched station holds its neighbours open to this fraction of its aperture
  kRing: 2.5,          // N per mm a station is held open past its comfortable radius, at typical tone
  kPress: 0.4,         // N per mm of stretch past closed a station presses on the toy with by its tone alone (even within
                       // comfort): on a flank it pushes along the toy (ringForce), so even a warm knot pops, softly
  stretchMax: 1.1,     // past this x the fully relaxed comfortable radius the tissue stiffens steeply (J-shaped, collagen)
  stiffenMm: 3,        // ... its hold rising e-fold every this many mm past it: a knot far too big stalls even under a strong machine
  ringViscCold: 6,     // N s/mm: how hard it is to open a station past comfort quickly, cold
  ringViscWarm: 1.5,   // ... fully relaxed
  relaxS: 4,           // stress relaxation: the force to hold a stretch relaxes over this, s
  relaxFrac: 0.45,     // ... by up to this fraction
  relaxRecS: 20,       // and comes back over this once unloaded, s
  setFrac: 0.3,        // a long stretch leaves this fraction of it as a residual opening (gape)
  setS: 20,            // which builds over this while stretched, s
  setRecS: 60,         // and closes over this once empty, s (experience: longer)
  // friction and the rim's travel
  holeGive: 0.4,       // 0..1 ("Hole give"): how far the canal travels with the toy and how softly it is held
  lube: 1,             // 0 dry .. 1 well lubricated
  muWet: 0.04,         // kinetic friction, toy on lubricated mucosa (estimated)
  muDry: 0.3,          // ... dry (estimated)
  muStatic: 1.4,       // static / kinetic
  kN: 2,               // N of grip (normal force) per mm a station is stretched past closed, at typical tone
  xiIn: [3, 9],        // the rim's inward travel limit at hole give 0 / 1, mm (x height)
  xiOut: [4, 14],      // its outward travel (eversion) limit at hole give 0 / 1, mm (x height)
  kXi: 3,              // N per mm holding the canal at its place, at hole give 0 (1 -> kXi / 4)
  xiReturnMs: 300,     // the canal settles back over this with nothing inside, ms
  // the body
  bodyGive: 0.3,       // 0 Fixed (braced) .. 1 Loose (pushed along): body spring = bodyK / bodyGive; not from experience
  bodyK: 2.5,          // N/mm scale of the body's spring: k = bodyK ((1 - give) / give)^1.5 + bodyKLoose
  bodyKLoose: 0.3,     // N/mm left at Loose (the body rides along with a hard push)
  // past the hilt: the rig may send the carriage overMax mm past full insertion; the base then presses the body
  overMax: 40,         // mm the deep end may go past the hilt
  tissueE: 0.025,      // MPa: the soft tissue around the opening (buttocks, perineum), estimated (typical 10-40 kPa)
  tissueJmm: 8,        // mm of tissue compression per e-fold of its stiffening (it bottoms out on the pelvis); x (1 + weight)
  baseMm: 15,          // mm of the toy's base (flare / plate) that compresses against the body
  weight: 0.25,        // the build (0 slim .. 1 chubby): softer, deeper tissue around the opening
  bodyMassKg: 25,      // the moving mass at height scale 1 (x scale^3)
  bodyZeta: 0.9,       // its damping ratio
  jiggleHz: 2.5,       // the soft tissue's lagged follow (glutes): frequency, Hz
  jiggleZeta: 0.3,     // ... damping ratio
  capComp: 0.25,       // the toy compresses up to this fraction of its length, then goes hard (buckled)
  hardFactor: 12,      // axial stiffness past that, times the toy's own
  anatomy: true,       // the internal path's bends resist (false: a straight canal, the sleeve alone)
  bodyScale: 1,        // the height scale: the path's lengths scale with it, its bends straighten a little
  open: 1,             // anorectal openness (experience): the rest flexure angle x this
  bendFloor: 2.75,     // the toy's centreline never bends tighter than this x its local radius (see bendTake)
  bendF0: [3, 6],      // N of push a bend takes before it starts to straighten (anorectal, rectosigmoid)
  bendViscCold: [60, 360],     // N s per unit of forced straightening, depth readiness 0 (anorectal, rectosigmoid)
  bendViscReady: [12, 60],     // ... at full depth readiness
  bendRecoverS: [3, 10],       // forced straightening relaxes back over this, s, once the toy no longer holds it
  depthWarmS: [20, 180],       // depth readiness grows toward depthMax over this while the tip works near the bend, s
  depthCoolS: [600, 1200],     // and fades over this when depth is not worked, s
  depthMax: 0.85,              // the most the tissue straightens by readiness alone
  // the slow states past the junction (paw-qin8; see the header)
  sigmoidS: 420,               // the sigmoid's rest shape straightens toward sigmoidMax over this while the tip works in it, s
  sigmoidMax: 0.65,            // the straightest it gets (0..1 of SIGMOID's full straightening)
  sigmoidRecS: 2400,           // and recovers over this once the tip has left it, s
  descWarmS: 1200,             // the descending colon's turn readies over this while the tip works at it, s
  descCoolS: 900,              // and tightens back over this when it is not worked, s
  descMax: 0.3,                // the most its turn readies, a fixed descending colon (descCeil)
  descMobility: 0.33,          // "Descending give": 0 fixed to the back wall .. 1 a mobile portion (about a third of people have one)
  // where experience leaves the tissue between sessions (paw-hito: the owner, on whether the 280-300 mm mark stays the
  // point of resistance: "depending on experience"): readiness and straightening start there and settle back to it, so
  // an experienced body has little resistance at either bend and its colon lies along the toy almost from the start
  depthBase: [0, 0],           // the first two bends' (and the tube's) resting readiness, x depthMax (anorectal, rectosigmoid)
  descBase: 0,                 // the descending colon's turn's resting readiness, x its ceiling (descCeil)
  sigBase: 0,                  // the sigmoid's resting straightening (0..sigmoidMax)
  forceLimitN: Infinity,   // the machine's thrust cap, N (both directions); machines.js: the Capstan's 60 lbf = 267 N
  dtMs: 5,             // integration step, ms (a fast knot pass still gets ~10 steps; stable at every firmness)
  checkpointMs: 2000,  // cached states every 2 s of script
});

/** Experience presets: every level is at least as accommodating as the one before (larger, more relaxed, softer,
 *  more give, a more open flexure, faster depth readiness, a longer gape). The Tuning sliders show and override. */
export const EXPERIENCE = Object.freeze({
  beginner: { label: 'Beginner', short: 'New', restMm: 9, capacity: 2.6, tone: 75, warmS: 40, coolS: 180, w0: 0, gape: 0.25, recoilMs: 120, holeGive: 0.2, setFrac: 0.2, setRecS: 30,
    relaxS: 6, reflexK: 1, open: 1, depthWarmS: [30, 240], depthMax: 0.75, bendViscCold: [80, 480], bendViscReady: [16, 80], sigmoidS: 900, sigmoidMax: 0.5, descWarmS: 1800, descMax: 0.2, depthBase: [0, 0], descBase: 0, sigBase: 0 },
  some: { label: 'Some experience', short: 'Some', restMm: 12, capacity: 3.2, tone: 60, warmS: 25, coolS: 240, w0: 0, gape: 0.35, recoilMs: 150, holeGive: 0.4, setFrac: 0.3, setRecS: 60,
    relaxS: 4, reflexK: 0.6, open: 1, depthWarmS: [20, 180], depthMax: 0.85, bendViscCold: [60, 360], bendViscReady: [12, 60], sigmoidS: 420, sigmoidMax: 0.65, descWarmS: 1200, descMax: 0.3, depthBase: [0, 0], descBase: 0, sigBase: 0 },
  experienced: { label: 'Experienced', short: 'Exp.', restMm: 15, capacity: 3.6, tone: 50, warmS: 18, coolS: 360, w0: 0.1, gape: 0.45, recoilMs: 200, holeGive: 0.6, setFrac: 0.4, setRecS: 120,
    relaxS: 3, reflexK: 0.3, open: 0.92, depthWarmS: [15, 120], depthMax: 0.9, bendViscCold: [45, 240], bendViscReady: [9, 40], sigmoidS: 300, sigmoidMax: 0.8, descWarmS: 900, descMax: 0.4, depthBase: [0.35, 0.3], descBase: 0.4, sigBase: 0.35 },
  very: { label: 'Very experienced', short: 'Very', restMm: 18, capacity: 4, tone: 40, warmS: 12, coolS: 600, w0: 0.2, gape: 0.55, recoilMs: 260, holeGive: 0.8, setFrac: 0.5, setRecS: 240,
    relaxS: 2, reflexK: 0.1, open: 0.85, depthWarmS: [10, 80], depthMax: 0.93, bendViscCold: [30, 150], bendViscReady: [6, 25], sigmoidS: 200, sigmoidMax: 0.9, descWarmS: 600, descMax: 0.5, depthBase: [0.6, 0.55], descBase: 0.75, sigBase: 0.7 },
});
export const EXPERIENCE_LEVELS = Object.freeze(['beginner', 'some', 'experienced', 'very']);

/** The tube's segments past the canal, by arc from the verge (mm at 175 cm; a station blends its neighbours' values
 *  over 8 mm either side of a boundary). Typical anatomy, large individual variation; planning values, not
 *  measurements. The experience preset scales them through the depth constants they multiply (depthWarmS /
 *  depthCoolS of their bend, depthMax) and the canal's gape (setFrac, setRecS: x setFrac / 0.3, x setRecS / 60 s).
 *    warm, cool: x depthWarmS / depthCoolS of `bend` (0 the flexure's, 1 the rectosigmoid's);
 *    coolLow: the fade's time at low readiness, x cool (1 = the same at any readiness; < 1: closes faster while
 *      little worked, at the full time once well worked);
 *    comply: how much full readiness widens the resting lumen (fraction);
 *    setFrac: the share of a stretch left as the residual opening; fastS: its recoil once empty, s. */
export const TUBE = Object.freeze([
  // the anorectal junction and flexure: the top of the canal opens into the rectum; the first bend
  { from: 35, seg: 'flexure', bend: 0, warm: 1, cool: 1, coolLow: 1, comply: 0.25, setFrac: 0.35, fastS: 12 },
  // the rectal ampulla: a compliant reservoir, easily distended, low tone, slow to return
  { from: 75, seg: 'ampulla', bend: 0, warm: 1, cool: 1.5, coolLow: 1, comply: 0.45, setFrac: 0.55, fastS: 40 },
  // the rectosigmoid junction (~15 cm): a tonic narrowing; resists, opens with sustained / repeated depth work
  { from: 138, seg: 'junction', bend: 1, warm: 1, cool: 1, coolLow: 0.35, comply: 0.5, setFrac: 0.3, fastS: 8 },
  // the sigmoid: narrower, collapses onto the toy, recovers quickly at first
  { from: 175, seg: 'sigmoid', bend: 1, warm: 0.6, cool: 0.5, coolLow: 1, comply: 0.25, setFrac: 0.25, fastS: 3 },
]);
export const TUBE_STEP = 5;   // mm between stations (at 175 cm): the bends' arcs (35, 150 mm) fall on stations
/** Which way "more accommodating" goes per preset key: +1 larger, -1 smaller (the test walks the table with it). */
export const ACCOMMODATING = Object.freeze({ restMm: 1, capacity: 1, tone: -1, warmS: -1, coolS: 1, w0: 1, gape: 1, recoilMs: 1, holeGive: 1, setFrac: 1, setRecS: 1,
  relaxS: -1, reflexK: -1, open: -1, depthWarmS: -1, depthMax: 1, bendViscCold: -1, bendViscReady: -1, sigmoidS: -1, sigmoidMax: 1, descWarmS: -1, descMax: 1,
  depthBase: 1, descBase: 1, sigBase: 1 });

/** The handles the panel exposes in the Tuning strip (they override the experience preset). */
export const TUNABLE = Object.freeze([
  { key: 'tone', label: 'Tightness', min: 20, max: 120, step: 1, fmt: (v) => `${Math.round(v)} mmHg`, tip: 'Resting anal pressure: tighter resists more, closes faster' },
  { key: 'holeGive', label: 'Hole give', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)} %`, tip: 'How far the opening travels with the toy' },
  { key: 'warmS', label: 'Warm-up', min: 5, max: 240, step: 1, fmt: (v) => `${Math.round(v)} s`, tip: 'How fast stretching relaxes the internal sphincter' },
  { key: 'lube', label: 'Lubrication', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)} %`, tip: 'Less lubrication drags the opening further' },
  { key: 'descMobility', label: 'Descending give', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)} %`, tip: 'How far the descending colon turn opens (an estimate)' },
]);
/** Tuning > Calibration (hidden by default): the force and time scales in plain terms, for applying real anchors. */
export const CALIBRATION = Object.freeze([
  { key: 'toyAxialRef', label: 'Toy push stiffness', min: 0.3, max: 6, step: 0.05, fmt: (v) => `${v.toFixed(2)} N/mm`, tip: 'Axial stiffness of a Medium 32 x 200 mm shaft' },
  { key: 'toyBuckleRef', label: 'Toy buckling', min: 20, max: 500, step: 1, fmt: (v) => `${Math.round(v)} N`, tip: 'Push at which that shaft bows sideways in the body' },
  { key: 'toySquashRef', label: 'Toy squash', min: 0, max: 0.3, step: 0.01, fmt: (v) => `${Math.round(v * 100)} %`, tip: 'Most a Medium toy\'s girth squashes under a hard push' },
  { key: 'toySquashN', label: 'Squash force', min: 30, max: 600, step: 5, fmt: (v) => `${Math.round(v)} N`, tip: 'The push that squashes a Medium toy that far' },
  { key: 'kRing', label: 'Opening tension', min: 0.5, max: 10, step: 0.1, fmt: (v) => `${v.toFixed(1)} N/mm`, tip: 'Pull-back per mm held past comfortable' },
  { key: 'ringViscCold', label: 'Knot time, cold', min: 1, max: 20, step: 0.5, fmt: (v) => `${v.toFixed(1)} N·s/mm`, tip: 'How slowly a cold opening gives (larger: slower knots)' },
  { key: 'ringViscWarm', label: 'Knot time, relaxed', min: 0.2, max: 10, step: 0.1, fmt: (v) => `${v.toFixed(1)} N·s/mm`, tip: 'The same, fully relaxed' },
  { key: 'recoilMs', label: 'Recoil', min: 30, max: 800, step: 10, fmt: (v) => `${Math.round(v)} ms`, tip: 'How fast the opening snaps back toward closed' },
  { key: 'coolS', label: 'Relaxation fades', min: 30, max: 1800, step: 10, fmt: (v) => `${Math.round(v)} s`, tip: 'How long warm-up lasts with nothing inside' },
  { key: 'setRecS', label: 'Gape closes', min: 10, max: 900, step: 5, fmt: (v) => `${Math.round(v)} s`, tip: 'How long the residual opening after a big toy takes to close' },
  { key: 'bendTime', label: 'Bend time', min: 0.1, max: 5, step: 0.05, fmt: (v) => `x${v.toFixed(2)}`, tip: 'Scales how long a bend takes to give way to a push' },
  { key: 'depthTime', label: 'Depth readiness time', min: 0.1, max: 5, step: 0.05, fmt: (v) => `x${v.toFixed(2)}`, tip: 'Scales how long depth work takes to open the bends' },
  { key: 'muWet', label: 'Friction, lubricated', min: 0.005, max: 0.3, step: 0.005, fmt: (v) => v.toFixed(3), tip: 'Friction when well lubricated' },
  { key: 'bodyK', label: 'Body spring', min: 0.5, max: 20, step: 0.1, fmt: (v) => `${v.toFixed(1)} N/mm`, tip: 'Body push-back at Body give Loose' },
]);

/** The body give slider (about the setup, not the person: not from the experience preset). */
export const BODY_GIVE = Object.freeze({ key: 'bodyGive', label: 'Body give', min: 0, max: 1, step: 0.05,
  fmt: (v) => (v <= 0 ? 'Fixed' : v >= 1 ? 'Loose' : `${Math.round(v * 100)} %`),
  tip: 'Fixed: braced, full depth · Loose: pushed along, less depth' });

// Calibration of the material figures to the model's force scale (the tissue constants were tuned against it). The
// ratios between grades and between stations come from the material and the geometry; these four only set the scale.
const E_REF = GRADES[5].E;                       // 00-50: the reference grade
export const EI_REF = E_REF * Math.PI * 16 ** 4 / 4;   // the tissue's bending stiffness: a 00-50 section of radius 16 mm takes 45 deg at a bend
const KAX_GEOM = (E_REF * Math.PI * 16 ** 2) / 200;   // E A / L of the reference shaft (N/mm): toyAxialRef sets the model's scale for it

/** The toy's mechanics from its material(s) and its radius profile, per 1 mm station (u = mm from the tip): axial
 *  stiffness (stations in series, so it gives where it is thinnest), radial squash at the ring, bending stiffness E I,
 *  the turn its tip takes at a bend, its buckling load, its follow lag (one loss factor). Shaft and base may differ
 *  (split grades): the base starts past the knot, else at 84 % of the length. */
export function toyMechanics(toy, firmness, knot = knotOf(toy), cal = PARAMS) {
  const { shaft, base } = parseFirmness(firmness), t = radiusTable(toy), n = t.length;
  const baseLine = knot ? Math.min(n - 1, Math.round(knot.to_mm) + 2) : Math.round(0.84 * toy.length_mm);
  const E = new Float32Array(n), EI = new Float32Array(n), sq = new Float32Array(n), kRad = new Float32Array(n);
  let compliance = 0, eiMin = Infinity;
  for (let u = 0; u < n; u++) {
    const e = u < baseLine ? shaft.E : base.E, r = Math.max(1, t[u]);
    E[u] = e; EI[u] = (e * Math.PI * r ** 4) / 4;
    sq[u] = Math.max(0, Math.min(0.3, (cal.toySquashRef * E_REF) / e)); kRad[u] = (cal.toySquashN * e) / E_REF;
    compliance += 1 / (e * Math.PI * r * r);
    if (u > 0.2 * n && u < 0.9 * n) eiMin = Math.min(eiMin, EI[u]);   // the shaft's weakest section (not the tip)
  }
  const kAx = (cal.toyAxialRef / KAX_GEOM) / compliance, L = toy.length_mm;
  // the turn (deg) each station takes at a bend: tissue against the toy's bending stiffness there
  const takeTab = new Float32Array(n);
  for (let u = 0; u < n; u++) takeTab[u] = (90 * EI_REF) / (EI_REF + EI[u]);
  const take = takeTab[Math.min(n - 1, 15)];
  return { E, EI, sq, kRad, kAx, take, takeTab, baseLine, buckle: cal.toyBuckleRef * ((Number.isFinite(eiMin) ? eiMin : EI[0]) / EI_REF) * (200 / L) ** 2,   // Euler: ~ E I / L^2
    axialMs: Math.max(1, Math.min(80, 18 * Math.sqrt(1.5 / kAx) * (LOSS / 0.1))) };
}

/** The turn (deg) a toy station of radius r takes over a bend window of `len` mm: its stiffness share (takeTab), and
 *  never more than the curvature floor allows (centreline radius >= bendFloor x r). Why 2.75: bending a solid
 *  silicone rod to a centreline radius R puts its inner surface at a compressive strain of r / R; past ~35 % (R < ~2.75
 *  r) the inner side wrinkles and folds instead of bending (the minimum bend radius of soft elastomer rod / hose is
 *  quoted at 2.5-3x its radius), so the model never lets a toy bend tighter than that. */
export const bendTake = (take, r, len, floor = PARAMS.bendFloor) => Math.min(take, ((len / (floor * Math.max(1, r))) * 180) / Math.PI);

export const params = (over) => ({ ...PARAMS, ...(over || {}) });
/** The parameters for an experience level with the owner's overrides on top. */
export const paramsFor = (level, over) => ({ ...PARAMS, ...(EXPERIENCE[level] || EXPERIENCE.some), experience: EXPERIENCE[level] ? level : 'some', ...(over || {}) });

/** Tip depth past the ring (mm) for a script pos under the rig {strokeMm, offsetMm}. */
export const depthOf = (rig, pos) => rig.offsetMm + (1 - pos / 100) * rig.strokeMm;

/** The verge's rest radius for the body: the opening and its comfortable girth scale sub-linearly with height (sqrt). */
export const restOf = (P) => P.restMm * Math.sqrt(P.bodyScale || 1);
export const comfy = (P, w) => restOf(P) * (1 + (P.capacity - 1) * w);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The canal's stations for a context: rest positions (mm from the verge), comfort profile, sphincter weights. */
function canalStations(P) {
  const n = Math.max(2, P.canalN | 0), Lc = ANATOMY.canalLen * (P.bodyScale || 1), y = new Float64Array(n), prof = new Float64Array(n), wI = new Float64Array(n), wE = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const f = j / (n - 1);
    y[j] = f * Lc;
    prof[j] = 1 + (P.profTop - 1) * smooth(0, 0.5, f);   // tightest at the verge, roomier toward the rectum
    wI[j] = smooth(0.15, 0.4, f);                        // internal sphincter: the upper two-thirds
    wE[j] = 1 - smooth(0.6, 0.9, f);                     // external: lower and outer, its subcutaneous part at the verge
  }
  return { n, Lc, y, prof, wI, wE };
}

/** The toy's axial mode (rad/s from axialMs, damping ratio z) stepped exactly over h ms in 1..8 substeps: per
 *  substep count the decay e, cos and sin / wd of one substep (an exact step is stable at any stiffness). */
export function oscOf(axialMs, z, h) {
  const w = 1000 / axialMs, zeta = Math.max(0.05, Math.min(0.95, z)), wd = w * Math.sqrt(1 - zeta * zeta);
  return { w2: w * w, zw: zeta * w, zeta, sub: Array.from({ length: 8 }, (_, i) => { const t = h / 1000 / (i + 1); return { e: Math.exp(-zeta * w * t), c: Math.cos(wd * t), s: Math.sin(wd * t) / wd }; }) };
}

/** Everything the hot loop needs, built once per toy / rig / params. */
export function makeContext(toy, rig, P = PARAMS) {
  const knot = knotOf(toy);
  const m = toyMechanics(toy, P.firmness, knot, P), dt = P.dtMs / 1000, sc = P.bodyScale || 1, g = Math.max(0, Math.min(1, P.holeGive));
  const k = (tauS) => 1 - Math.exp(-dt / tauS);
  return { mech: m, P, rig, len: Math.min(toy.length_mm, toy.usable_mm || Infinity), L: toy.length_mm, table: radiusTable(toy), knot, events: null,
    osc: oscOf(m.axialMs, P.toyDamp * LOSS, P.dtMs), kAx: m.kAx, sqTab: m.sq, kRadTab: m.kRad, buckle: m.buckle,
    canal: canalStations(P), ...depthContext(toy, P, m), tube: tubeStations(P),
    kRecoil: Math.exp(-P.dtMs / P.recoilMs), kWarm: 1 - Math.exp(-P.dtMs / (P.warmS * 1000)), kCool: 1 - Math.exp(-P.dtMs / (P.coolS * 1000)), kHold: 1 - Math.exp(-P.dtMs / (P.coolS * P.holdFactor * 1000)),
    kRelax: k(P.relaxS), kRelaxRec: k(P.relaxRecS), kSet: k(P.setS), kSetRec: k(P.setRecS), kReflex: k(P.reflexS), kFat: k(P.fatigueS), kFatRec: k(P.fatigueRecS),
    xiIn: (P.xiIn[0] + (P.xiIn[1] - P.xiIn[0]) * g) * sc, xiOut: (P.xiOut[0] + (P.xiOut[1] - P.xiOut[0]) * g) * sc, kXi: P.kXi / (1 + 3 * g), kXiRet: k(P.xiReturnMs / 1000), kSlip: k(0.02),
    mu: P.muWet + (P.muDry - P.muWet) * (1 - Math.max(0, Math.min(1, P.lube))),
    body: bodyContext(P), hilt: hiltContext(toy, P, m) };
}

/** The hilt: where the toy can go in no further (its usable length) and the springs in series when its base presses the
 *  body: the base compressing (its own grade), the soft tissue around the opening (a flat punch, 2 E* a, stiffening
 *  e-fold every tissueJmm as it bottoms out; softer and deeper with weight); the toy's own axial spring is forceOf.
 *  The punch is the base's own profile from the hilt outward (paw-2ey): pressed delta mm past the hilt, its contact
 *  radius is the widest the base gets by H + delta, so a flared base seats progressively (stiffness 2 E* a(delta)
 *  e^(delta / j), integrated into a table F(delta)) rather than as one plane of its widest radius. */
function hiltContext(toy, P, m) {
  const H = Math.min(toy.length_mm, toy.usable_mm || Infinity), t = radiusTable(toy);
  let rb = 0;
  for (let u = Math.floor(H); u < t.length; u++) rb = Math.max(rb, t[u]);
  rb = Math.max(rb, t[Math.min(t.length - 1, Math.floor(H))], 5);
  const Eb = m.E[m.E.length - 1], w = Math.max(0, Math.min(1, P.weight ?? 0.25)), j = P.tissueJmm * (1 + w) * Math.sqrt(P.bodyScale || 1), kr = 2 * ((P.tissueE * (1 - 0.5 * w)) / 0.75);
  const N = Math.ceil((8 * j) / HILT_STEP), Ft = new Float64Array(N + 1);
  let a = Math.max(5, t[Math.min(t.length - 1, Math.floor(H))]);
  for (let i = 1; i <= N; i++) { a = Math.max(a, t[Math.min(t.length - 1, Math.floor(H + i * HILT_STEP))] || 0); Ft[i] = Ft[i - 1] + kr * a * Math.exp(((i - 0.5) * HILT_STEP) / j) * HILT_STEP; }
  return { H, rb, kBase: (Eb * Math.PI * rb * rb) / P.baseMm, j, Ft, kEnd: kr * a * Math.exp((N * HILT_STEP) / j) };
}
const HILT_STEP = 0.25;   // mm between entries of the base contact table
/** Tissue compression (mm) under a contact force F (N) (the base contact table, inverted), and the compliance of the
 *  whole series (toy, base, tissue). */
function tissueOf(h, F) {
  const T = h.Ft, N = T.length - 1;
  if (!(F > 0)) return 0;
  if (F >= T[N]) return N * HILT_STEP + (F - T[N]) / h.kEnd;
  let lo = 0, hi = N;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T[mid] <= F) lo = mid; else hi = mid; }
  return (lo + (F - T[lo]) / (T[hi] - T[lo])) * HILT_STEP;
}
const seriesOf = (ctx, F) => compOf(ctx, F) + F / ctx.hilt.kBase + tissueOf(ctx.hilt, F);
/** The contact force (N) when the body-relative carriage is o mm past the hilt (bisection on the series). */
function contactForce(ctx, o) {
  if (!(o > 0)) return 0;
  let lo = 0, hi = 1;
  while (seriesOf(ctx, hi) < o && hi < 1e6) hi *= 2;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (seriesOf(ctx, mid) < o) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/** The body's spring-damper (SI) for bodyGive, or null when Fixed. */
function bodyContext(P) {
  if (!(P.bodyGive > 0.005)) return null;
  const g = Math.min(1, P.bodyGive), m = P.bodyMassKg * (P.bodyScale || 1) ** 3, k = (P.bodyK * ((1 - g) / g) ** 1.5 + P.bodyKLoose) * 1000, c = 2 * P.bodyZeta * Math.sqrt(k * m), wj = 2 * Math.PI * P.jiggleHz;
  return { m, k, c, wj, cj: 2 * P.jiggleZeta * wj };
}

/** The bends for this toy and body: where they sit, their rest turns, the turn each toy station takes there. */
function depthContext(toy, P, m) {
  if (!P.anatomy) return { bends: null };
  // (a modelled body brings its own bend positions: P.bends {bends, windows}, anatomy.js bodyBends)
  const at = P.bends?.bends || bendsAt(P.bodyScale), rest = restAngles(P.bodyScale, P.open), win = P.bends?.windows || bendWindows(P.bodyScale), dt = P.dtMs / 1000, t = radiusTable(toy);
  // the toy's own rest curve helps where it bends the way the anatomy turns (its "bend prior", at its mounted facing):
  // the flexure turns dorsal (+V), the rectosigmoid forward and to the side; over the window a station takes the
  // tissue's share plus its own turn that way (less, if it curves the other way), never past the curvature floor
  const bend = toyBend(toy, P.toyRoll ?? ((toy.roll ?? -1) * Math.PI) / 2), side = P.side ?? SIDE, fw = (ANATOMY.rsSide * Math.PI) / 180;
  // (a modelled body's descending colon, paw-lcmb / paw-qin8: a third bend that readies slowly and only so far; the
  // toy reaches descReach mm into it before it must take what is left of its turn; no bend prior, it turns left and
  // back off the toy's plane)
  const desc = P.bends?.desc && P.bends.descTurn > 5 && P.bends.desc < 1e4 ? P.bends : null;
  const wins = desc ? [...win, [desc.desc, desc.desc + 30 * P.bodyScale]] : win;
  const dirs = [[0, 1], [side * Math.sin(fw), -Math.cos(fw)], [0, 0]], n = m.takeTab.length;
  const takes = wins.map(([a, b], i) => Float32Array.from(m.takeTab, (tk, u) => {
    let own = 0;
    if (bend) { const len = Math.round(b - a); for (let v = Math.max(0, u - len); v <= u && v < n; v++) own += bend[v * 2] * dirs[i][0] + bend[v * 2 + 1] * dirs[i][1]; }
    const share = 1 - tk / 90;   // the toy's stiffness share EI / (EI + tissue EI)
    return bendTake(Math.max(0, tk + share * (own * 180) / Math.PI), t[u], b - a, P.bendFloor);
  }));
  const k = (tauS) => 1 - Math.exp(-dt / tauS), reach = descReach(m, P.bodyScale || 1);
  const bends = [0, 1].map((i) => ({ s: at[i], at: at[i] + 4, rest: i ? rest.rs : rest.anorectal, F0: P.bendF0[i], vc: P.bendViscCold[i] * P.bendTime, vr: P.bendViscReady[i] * P.bendTime,
    kRec: k(P.bendRecoverS[i]), kWarm: k(P.depthWarmS[i] * P.depthTime), kCool: k(P.depthCoolS[i]), base: Math.max(0, Math.min(1, P.depthBase?.[i] || 0)) * P.depthMax }));
  if (desc) bends.push({ s: desc.desc, at: desc.desc + reach, reach, rest: desc.descTurn, desc: true, ceil: descCeil(P), F0: DESC_BEND.F0, vc: DESC_BEND.viscCold * P.bendTime, vr: DESC_BEND.viscReady * P.bendTime,
    kRec: k(DESC_BEND.recoverS), kWarm: k(P.descWarmS * P.depthTime), kCool: k(P.descCoolS), base: Math.max(0, Math.min(1, P.descBase || 0)) * descCeil(P) });
  // the sigmoid's slow straightening: driven while the tip works past the end of the rectosigmoid turn
  const sig = { from: (P.bends?.windows?.[1]?.[1] ?? (ANATOMY.rsJunction + ANATOMY.rsLen) * (P.bodyScale || 1)), max: Math.max(0, Math.min(1, P.sigmoidMax)), kOn: k(P.sigmoidS * P.depthTime), kRec: k(P.sigmoidRecS),
    base: Math.max(0, Math.min(P.sigmoidMax, P.sigBase || 0)) };
  return { bends, sig, take: takes[0][Math.min(takes[0].length - 1, 15)], takes, takeTab: takes[1] };
}

/** The sigmoid's slow straightening (paw-qin8): the drive (0..1, x sigmoidMax) grows with how far past the end of the
 *  rectosigmoid turn the tip works (full at depthMm, x the body's scale) and the toy's radius there (full at girthMm);
 *  at full straightening it takes rsShare of the rectosigmoid turn away; the view draws the loop forward
 *  (centreline.js SIGMOID_DRAW). Estimates from anatomy texts (a mobile loop on a long mesentery, routinely straightened
 *  in colonoscopy, lying against the front abdominal wall), not a measurement. */
export const SIGMOID = Object.freeze({ depthMm: 60, girthMm: 15, rsShare: 0.5 });
/** The sigmoid's straightening drive (0..sigmoidMax) with the tip at d. */
export function sigDrive(ctx, d) {
  const G = ctx.sig, into = G ? d - G.from : 0;
  return into > 0 ? G.max * Math.min(1, into / (SIGMOID.depthMm * (ctx.P.bodyScale || 1))) * Math.min(1, ringRadius(ctx, into) / SIGMOID.girthMm) : 0;
}
/** The descending colon's turn (paw-qin8): F0 N of push before forcing starts, the forcing viscosities (N s per unit,
 *  cold / at its ceiling; x bendTime), forcing relaxes back over recoverS s; its ceiling descCeil = descMax x (1 +
 *  mobileGain x descMobility), never past cap (the first two bends reach depthMax, 0.75-0.93). */
export const DESC_BEND = Object.freeze({ F0: 15, viscCold: 4000, viscReady: 600, recoverS: 30, mobileGain: 1, cap: 0.7 });
export const descCeil = (P) => Math.min(DESC_BEND.cap, P.descMax * (1 + DESC_BEND.mobileGain * Math.max(0, Math.min(1, P.descMobility ?? PARAMS.descMobility))));
/** How far into the descending colon's turn a tip gets before it must take it (paw-qin8; the owner saw ~20 mm between
 *  toys, the old constant was 10 mm): minMm + (maxMm - minMm) x f, f the tissue's share of the bending over the toy's
 *  first tipMm (the mean of EI_REF / (EI_REF + EI), toyMechanics takeTab / 90): a slender, soft tip curls into the turn's
 *  start; a wide, firm one meets the wall head on and stops at its small yield. Falls with the tip's radius and grade,
 *  within [minMm, maxMm]; x the body's scale. */
export const DESC_REACH = Object.freeze({ minMm: 2, maxMm: 20, tipMm: 30 });
export function descReach(mech, scale = 1) {
  const t = mech.takeTab, n = Math.max(1, Math.min(t.length, DESC_REACH.tipMm + 1));
  let f = 0;
  for (let u = 0; u < n; u++) f += t[u] / 90 / n;
  return (DESC_REACH.minMm + (DESC_REACH.maxMm - DESC_REACH.minMm) * Math.max(0, Math.min(1, f))) * scale;
}

/** The tube's stations for a context (null without the anatomy): arcs (mm from the verge), resting lumen, and per
 *  station the TUBE constants blended across segment boundaries, as per-step rates. i0 / i1: the bends' stations. */
function tubeStations(P) {
  if (!P.anatomy) return null;
  // updated every `every` steps (20 ms: its time constants are seconds and up), on the fixed grid
  const sc = P.bodyScale || 1, A = ANATOMY, every = Math.max(1, Math.round(20 / P.dtMs)), dt = (P.dtMs * every) / 1000, n = tubeN(P);
  const T = { n, every, dt, kSet: 1 - Math.exp(-dt / P.setS), s: new Float64Array(n), r0: new Float64Array(n), kW: new Float64Array(n), kC: new Float64Array(n), coolS: new Float64Array(n), low: new Float64Array(n),
    comply: new Float64Array(n), setFrac: new Float64Array(n), kFast: new Float64Array(n), seg: new Uint8Array(n),
    i0: 0, i1: Math.max(1, Math.min(n - 1, Math.round(((P.bends ? P.bends.rs / sc : A.rsJunction) - A.canalLen) / TUBE_STEP))) };
  const gape = P.setFrac / PARAMS.setFrac, slow = P.setRecS / PARAMS.setRecS;
  for (let j = 0; j < n; j++) {
    const mm = A.canalLen + TUBE_STEP * j, x = mm * sc;
    // the segment's values, blended with the next over 8 mm either side of each boundary
    const val = (f) => { let v = f(TUBE[0]); for (let i = 1; i < TUBE.length; i++) v += (f(TUBE[i]) - f(TUBE[i - 1])) * smooth(TUBE[i].from - 8, TUBE[i].from + 8, mm); return v; };
    let seg = 0; for (let i = 1; i < TUBE.length; i++) if (mm >= TUBE[i].from) seg = i;
    const warmS = val((r) => P.depthWarmS[r.bend] * r.warm) * P.depthTime, coolS = val((r) => P.depthCoolS[r.bend] * r.cool), low = val((r) => r.coolLow);
    T.s[j] = x; T.r0[j] = restRadius(x, sc); T.seg[j] = seg;
    T.kW[j] = 1 - Math.exp(-dt / warmS); T.coolS[j] = coolS; T.low[j] = low; T.kC[j] = low >= 1 - 1e-9 ? 1 - Math.exp(-dt / coolS) : 0;
    T.comply[j] = val((r) => r.comply); T.setFrac[j] = Math.min(0.9, val((r) => r.setFrac) * gape); T.kFast[j] = 1 - Math.exp(-dt / (val((r) => r.fastS) * slow));
  }
  T.base = tubeBase(P);
  return T;
}
/** The tube's resting readiness per station (paw-hito: experience, P.depthBase per bend blended over the segments as
 *  the other TUBE values, x depthMax): where it starts and what it settles back to. */
function tubeBase(P) {
  const n = tubeN(P), out = new Float64Array(n), base = (i) => Math.max(0, Math.min(1, P.depthBase?.[i] || 0)) * P.depthMax;
  if (!base(0) && !base(1)) return out;
  for (let j = 0; j < n; j++) {
    const mm = ANATOMY.canalLen + TUBE_STEP * j;
    let v = base(TUBE[0].bend); for (let i = 1; i < TUBE.length; i++) v += (base(TUBE[i].bend) - base(TUBE[i - 1].bend)) * smooth(TUBE[i].from - 8, TUBE[i].from + 8, mm);
    out[j] = v;
  }
  return out;
}

/** The residual opening's share of the room the toy still needs at bend i (0..1): te / (te + the toy's girth past the
 *  station's resting lumen there, at least 1 mm). 0 on a first insertion: the bend gives as calibrated; soon after a
 *  deep toy it gives faster. */
function residualAt(ctx, s, i, d) {
  const T = ctx.tube;
  if (!T) return 0;
  const j = i ? T.i1 : T.i0, e = s.te[j], rest = T.r0[j] * (1 + T.comply[j] * s.tr[j]);
  return e > 0 ? e / (e + Math.max(1, ringRadius(ctx, d - T.s[j]) - rest)) : 0;
}

/** The turn (deg) bend i asks now with nothing forcing it: its rest turn, the rectosigmoid's less what the sigmoid's
 *  straightening has taken (SIGMOID.rsShare x sig). */
const restNow = (ctx, s, i) => ctx.bends[i].rest * (i === 1 ? 1 - SIGMOID.rsShare * (s.sig || 0) : 1);
/** The turn (deg) the tissue still asks of the toy at bend i: restNow * (1 - readiness) * (1 - forced straightening)
 *  (forced false: readiness alone); the descending colon's never less than rest * (1 - its ceiling). */
export const bendLeft = (ctx, s, i, forced = true) => {
  const b = ctx.bends[i], f = (1 - s.acc[i]) * (forced ? 1 - s.yb[i] : 1);
  return b.desc ? b.rest * Math.max(1 - b.ceil, f) : restNow(ctx, s, i) * f;
};
/** The least turn (deg) the toy takes over the part of it that can span bend i. */
export function toyTake(ctx, i) {
  const len = Math.min(ctx.len, ctx.L), tt = ctx.takes[i], n = Math.max(1, Math.min(tt.length, Math.round(len - ctx.bends[i].s)));
  let m = 180;
  for (let u = 0; u < n; u++) m = Math.min(m, tt[u]);
  return m;
}
/** The readiness (acc, 0..1) bend i needs for this toy: 0 = always passes; past depthMax (the descending colon: its
 *  ceiling, ctx.bends[2].ceil) never. */
export const bendNeed = (ctx, s, i) => Math.max(0, 1 - toyTake(ctx, i) / (restNow(ctx, s, i) || 1));
/** What the view's path solve takes from the state (centreline.js solvePath): per bend the share of its rest turn
 *  still asked (left), deep readiness drawing the sigmoid to the midline (lateral), the sigmoid's straightening
 *  (forward) and how far the descending colon's turn has opened (descOpen). The panel and the phone share it. */
export function pathInputs(s, ctx) {
  const B = ctx.bends;
  if (!B) return { left: [1, 1], lateral: 0, forward: 0, descOpen: 0 };
  return { left: [0, 1].map((i) => bendLeft(ctx, s, i) / (B[i].rest || 1)), lateral: 0.6 * (s.acc[1] / ctx.P.depthMax), forward: s.sig || 0, descOpen: B[2] ? 1 - bendLeft(ctx, s, 2) / B[2].rest : 0 };
}

/** Toy radius (rest) at u mm from its tip (linear in the 1 mm table). */
export function ringRadius(ctx, u) {
  if (u <= 0) return 0;
  const x = Math.min(u, ctx.len), i = Math.floor(x), t = ctx.table;
  return i + 1 < t.length ? t[i] + (t[i + 1] - t[i]) * (x - i) : t[t.length - 1];
}

/** Prostate stimulation (paw-xdcy; a modelled body that has one: P.prostate = {s: the arc of the resting path
 *  nearest its centre, gap: mm from the path's axis to its near surface less the rectal wall}). Per step, with u the
 *  toy station at its level and R the toy's widest radius within PROSTATE.half of it:
 *    clearance g = gap - R (mm, < 0: the toy indents it)
 *    contact   c = clamp((PROSTATE.reach - g) / PROSTATE.reach, 0, 1)        (touching within `reach` mm)
 *    pressure  p = clamp(-g / PROSTATE.press, 0, 1)                         (indentation, full at `press` mm)
 *    stroking  v = c * clamp(|dd/dt| / PROSTATE.speed, 0, 1)                (sliding past it, full at `speed` mm/s)
 *    intensity I = clamp(c * (PROSTATE.wP * p + PROSTATE.wV * v), 0, 1), low-passed over PROSTATE.tauMs: s.pros.
 *  A spell above PROSTATE.on until it drops under PROSTATE.off is one event {kind: 'prostate', tRigid: start, t: end,
 *  peak, mean}. The toy is taken as round (its roll does not change it). For the view and the timeline only. */
export const PROSTATE = Object.freeze({ half: 12, reach: 6, press: 8, speed: 150, wP: 0.6, wV: 0.4, tauMs: 150, on: 0.25, off: 0.1 });
function prostateStep(s, d, ctx, dts) {
  const Q = PROSTATE, pr = ctx.P.prostate, u = d - pr.s;
  let R = 0;
  if (u > -Q.half) for (let x = Math.max(0, u - Q.half); x <= Math.min(ctx.len, u + Q.half); x += 2) R = Math.max(R, ringRadius(ctx, x));
  const g = pr.gap - R, c = Math.max(0, Math.min(1, (Q.reach - g) / Q.reach)), p = Math.max(0, Math.min(1, -g / Q.press));
  const v = c * Math.max(0, Math.min(1, Math.abs(d - s.d) / dts / Q.speed)), I = Math.max(0, Math.min(1, c * (Q.wP * p + Q.wV * v)));
  s.pros += (I - s.pros) * (1 - Math.exp(-(dts * 1000) / Q.tauMs));
  if (s.prosT < 0 && s.pros > Q.on) { s.prosT = s.t; s.prosPeak = 0; s.prosSum = 0; }
  if (s.prosT >= 0) {
    s.prosPeak = Math.max(s.prosPeak, s.pros); s.prosSum += s.pros * dts * 1000;
    if (s.pros < Q.off) { ctx.events?.push({ kind: 'prostate', tRigid: s.prosT, t: s.t, peak: s.prosPeak, mean: s.prosSum / Math.max(1, s.t - s.prosT) }); s.prosT = -1; }
  }
}
/** Prostate stimulation over [t0, t1] from simulateKnots' events: {spells, ms (time in them), peak, mean (time-weighted)}. */
export function prostateStats(events, t0 = -Infinity, t1 = Infinity) {
  const ev = (events || []).filter((e) => e.kind === 'prostate' && e.t >= t0 && e.tRigid <= t1), ms = ev.reduce((a, e) => a + (e.t - e.tRigid), 0);
  return { spells: ev.length, ms, peak: ev.reduce((a, e) => Math.max(a, e.peak), 0), mean: ms ? ev.reduce((a, e) => a + e.mean * (e.t - e.tRigid), 0) / ms : 0 };
}

/** Stations in the tube for params P (0 without the anatomy). */
const tubeN = (P) => (P.anatomy ? Math.floor((ANATOMY.rsJunction + ANATOMY.rsLen + ANATOMY.sigmoidLen - ANATOMY.canalLen) / TUBE_STEP) + 1 : 0);

export function initialState(P = PARAMS) {
  const n = Math.max(2, P.canalN | 0), a0 = restOf(P) * P.closedFrac, nt = tubeN(P), tr = tubeBase(P);
  // (paw-hito: experience's resting readiness and straightening, P.depthBase / descBase / sigBase)
  const ab = [0, 1].map((i) => Math.max(0, Math.min(1, P.depthBase?.[i] || 0)) * P.depthMax), a2 = Math.max(0, Math.min(1, P.descBase || 0)) * descCeil(P);
  const s0 = { t: 0, a: a0, ap: new Float64Array(n).fill(a0), q: new Float64Array(n), g: new Float64Array(n), w: P.w0 || 0, ext: 0, fat: 0, tr, te: new Float64Array(nt),
    xi: 0, xiStick: true, xiDir: 0, xb: 0, vb: 0, xj: 0, vj: 0, tight: -1, hiltComp: 0, hiltF: 0, hiltT: -1, hiltPeak: 0,
    d: -Infinity, dc: -Infinity, dt: -Infinity, lag: 0, limT: -1, limPeak: 0, limTotal: 0, r: 0, re: 0, F: 0, rate: 0, strain: 0, knot: 'out',
    ties: 0, lastInT: -Infinity, lastPopT: -Infinity, lastTiedT: -Infinity, wTied: 0, pressPeak: 0, inStrain: 0,
    acc: [...ab, a2], yb: [0, 0, 0], bendT: [-1, -1, -1], bendF: [0, 0, 0], bendBlocked: -1, deepT: -Infinity, accDeep: 0, bendLag: [NaN, NaN, NaN],
    bendFail: [-Infinity, -Infinity, -Infinity], bendForced: [false, false, false], sig: Math.max(0, Math.min(P.sigmoidMax ?? 1, P.sigBase || 0)),
    pushT: -1, pullT: -1, pushF: 0, lagIn: NaN, lagOut: NaN, failT: -Infinity, failNeed: NaN, popFailT: -Infinity, popFailNeed: NaN,
    v: 0, dcr: NaN, Fr: 0, snapKind: '', snapT: -Infinity, snapPeak: 0, snapV: 0, snapEv: -1, envR: 0, envS: 0, wob: 0, wobV: 0, wobPV: 0, pros: 0, prosT: -1, prosPeak: 0, prosSum: 0 };
  // (with the tube, the first two bends' readiness is their stations')
  if (nt) { const T = { i0: 0, i1: Math.max(1, Math.min(nt - 1, Math.round(((P.bends ? P.bends.rs / (P.bodyScale || 1) : ANATOMY.rsJunction) - ANATOMY.canalLen) / TUBE_STEP))) }; s0.acc[0] = tr[T.i0]; s0.acc[1] = tr[T.i1]; }
  return s0;
}

/** The turns (deg) of the drawn path now: at each bend the tissue's remaining turn, cut to what the toy takes once
 *  it spans the bend (a firm toy straightens the path, a soft one conforms). With straight: the path straightened as
 *  far as readiness alone can (a ghost). */
export function pathAngles(s, ctx, straight = false) {
  const rest = restAngles(ctx.P.bodyScale, ctx.P.open);
  if (!ctx.bends) return { anorectal: 0, sacral: 0, rs: 0 };
  if (straight) { const k = 1 - ctx.P.depthMax; return { anorectal: rest.anorectal * k, sacral: rest.sacral, rs: rest.rs * k }; }
  // the station of the toy at each bend now takes what its bending stiffness (and the curvature floor) lets it
  const turn = (i) => { const left = bendLeft(ctx, s, i), b = ctx.bends[i], tt = ctx.takes[i]; return s.d > b.s + 15 ? Math.min(left, tt[Math.max(0, Math.min(tt.length - 1, Math.round(s.d - b.s)))]) : left; };
  return { anorectal: turn(0), sacral: rest.sacral, rs: turn(1) };
}

/** A state copy that shares no arrays with the original (checkpoints must not move). */
export const copyState = (s) => ({ ...s, ap: s.ap.slice(), q: s.q.slice(), g: s.g.slice(), tr: s.tr.slice(), te: s.te.slice(), acc: [...s.acc], yb: [...s.yb], bendT: [...s.bendT], bendF: [...s.bendF], bendLag: [...s.bendLag], bendFail: [...s.bendFail], bendForced: [...s.bendForced] });

/** Axial force (N) of the toy compressed (+) or stretched (-) by comp mm, and its inverse: the toy's own spring up to
 *  capComp of its length, hardFactor times stiffer past it (buckled). */
const forceOf = (ctx, comp) => { const cap = ctx.P.capComp * ctx.L, m = Math.abs(comp); return Math.sign(comp) * (ctx.kAx * Math.min(m, cap) + ctx.kAx * ctx.P.hardFactor * Math.max(0, m - cap)); };
const compOf = (ctx, F) => { const cap = ctx.P.capComp * ctx.L, Fc = ctx.kAx * cap; return F <= Fc ? F / ctx.kAx : cap + (F - Fc) / (ctx.kAx * ctx.P.hardFactor); };

/** Effective (squashed) radius for a toy point of rest radius r at station u under axial force F. */
const squashed = (ctx, r, F, u = 0) => { const i = Math.max(0, Math.min(ctx.sqTab.length - 1, Math.round(u))); return r * (1 - Math.min(ctx.sqTab[i], Math.abs(F) / ctx.kRadTab[i])); };
export const squashAt = (ctx, u) => ctx.sqTab[Math.max(0, Math.min(ctx.sqTab.length - 1, Math.round(u)))];

/** Tone of canal station j now, relative to typical resting tone (1 = 60 mmHg, cold, unclenched). */
export function toneAt(ctx, s, j) {
  const P = ctx.P, C = ctx.canal, wI = C.wI[j] * P.iasFrac, wE = C.wE[j] * (1 - P.iasFrac);
  const sq = P.squeezeMmHg / (P.tone * (1 - P.iasFrac) || 1);
  const ias = 1 - P.iasRelax * s.w, eas = (1 + P.reflexMax * sq * s.ext) * (1 - 0.5 * s.fat);
  return (P.tone / 60) * (wI * ias + wE * eas) / (wI + wE || 1);
}
/** The force (N) holding station j open past its comfortable radius now (stress-relaxed). */
export const holdForce = (ctx, s, j) => holdOf(ctx.P, toneAt(ctx, s, j), s.ap[j], comfy(ctx.P, s.w) * ctx.canal.prof[j], s.q[j], ctx.canal.prof[j]);
/** Hold (N) of a station of tone T at aperture a, comfortable radius c, stress relaxation q: linear past comfort,
 *  stiffening steeply past stretchMax x the fully relaxed comfortable radius. */
export function holdOf(P, T, a, c, q = 0, prof = 1) {
  const aMax = restOf(P) * P.capacity * P.stretchMax * prof, x = a - aMax;
  return P.kRing * T * (Math.max(0, a - c) * (1 - P.relaxFrac * q) + (x > 0 ? 20 * Math.expm1(Math.min(30, x / P.stiffenMm)) : 0));
}
/** Where station j sits along the canal now (mm from the rest verge): the canal rides the rim's travel. */
const stationY = (C, j, xi) => C.y[j] + xi * (1 - C.y[j] / C.Lc);

const SNAP_MS = 150;
const KNOT_BAND = 2;   // mm: the knot is in past its widest point + this, out again past its widest point - this   // a knot's snap speed is its fastest over this long after the widest point passes

/** The ring's axial force (N, + inward) on the toy with its tip at depth d, from the canal as it is in state s: every
 *  station resting on the toy (its aperture at the toy's girth there) presses on it (its tone's elastic grip past
 *  closed, kPress, plus its hold past comfort), and on a flank of
 *  slope dr/du that pressure pushes along the toy by hold x slope: against the motion that would open it (a rising
 *  flank going in), with the motion that lets it close (a falling flank). At a knot's widest point it changes sign. */
export function ringForce(ctx, s, d) {
  const P = ctx.P, C = ctx.canal, rc = comfy(P, s.w);
  let F = 0;
  for (let j = 0; j < C.n; j++) {
    const u = d - stationY(C, j, s.xi);
    if (u <= 1) continue;
    const r = squashed(ctx, ringRadius(ctx, u), s.F, u);
    if (r < s.ap[j] - 0.25) continue;   // held open wider than the toy here: not pressing on it
    const T = toneAt(ctx, s, j), press = P.kPress * T * Math.max(0, r - restOf(P) * P.closedFrac * C.prof[j]) + holdOf(P, T, r, rc * C.prof[j], s.q[j], C.prof[j]);
    if (press > 0) F -= press * (ringRadius(ctx, u + 1) - ringRadius(ctx, u - 1)) / 2;
  }
  return F;
}

// scratch per call (no allocation in the hot loop): squashed toy radius at each station, blocked flag
let NEED = new Float64Array(16), PREV = new Float64Array(16);
/** The gut's return to rest after the toy leaves it (paw-ani1, owner: "it took some time to go back into place"): the
 *  rectum, held by the pelvic floor and its wall's tone, in about 0.75 s; the sigmoid, mobile on its mesentery and not a
 *  spring, slowly and passively, ~3 s to most of the way (first order: no overshoot); the descending colon is fixed to
 *  the back wall and barely moves. While stroking the sigmoid rides at the envelope of the deepest recent strokes. */
export const TISSUE_RETURN = Object.freeze({ rectumMs: 750, sigmoidMs: 3000 });
/** The tip's lateral wobble pushing in (paw-ani1): a few mm, ~2.5 Hz, damped over a couple of cycles; softer (lower
 *  EI) and longer toys wobble more and slower. */
export const WOBBLE = Object.freeze({ hz: 2.5, zeta: 0.3, gain: 1.5, maxMm: 6 });

/** Advance s by one step (P.dtMs) with the script at pos. Mutates s (hot loop: no allocation). With ctx.events an
 *  array, knot events are pushed to it: {kind: 'in' | 'pop' | 'fail' | 'popfail', t, tRigid, lag?, need?} (ms). */
export function step(s, pos, ctx) {
  const P = ctx.P, C = ctx.canal, n = C.n, dts = P.dtMs / 1000, h = ctx.hilt, target = Math.min(depthOf(ctx.rig, pos), ctx.len + P.overMax);
  if (NEED.length < n) { NEED = new Float64Array(n); PREV = new Float64Array(n); }
  if (!Number.isFinite(s.d)) {   // a script that starts deep: the canal wraps the toy
    s.d = target;
    for (let j = 0; j < n; j++) s.ap[j] = Math.max(s.ap[j], ringRadius(ctx, target - C.y[j]));
  }
  if (!Number.isFinite(s.dc)) s.dc = target;
  if (!Number.isFinite(s.dt)) s.dt = target;
  // the servo: the carriage goes where the script says unless that would push (or pull) the toy harder than the cap
  let dc = target;
  if (P.forceLimitN < Infinity) {
    const lim = compOf(ctx, P.forceLimitN), atHilt = s.d >= h.H - 0.5;
    dc = Math.max(s.d + s.xb - lim, Math.min(atHilt ? s.xb + h.H + seriesOf(ctx, P.forceLimitN) : s.d + s.xb + lim, target));
  }
  const dcr = dc - s.xb;   // the carriage relative to the (moving) body
  const rc = comfy(P, s.w), ap = s.ap, xi = s.xi;
  for (let j = 0; j < n; j++) PREV[j] = ap[j];
  let d = s.d;
  // free motion: the toy's axial mode about the carriage (exact steps; more substeps while it moves fast, the ring's
  // force following it), the ring's axial force from where it presses on the toy's flanks now
  // (in the carriage's frame, which moves at a constant speed over the step: no forcing from it)
  const c0 = Number.isFinite(s.dcr) ? s.dcr : dcr, vc = (dcr - c0) / dts, O = ctx.osc;
  let fx = d, v = s.v, Fr = 0;
  { const nSub = Math.min(8, 1 + Math.floor((Math.abs(v - vc) * dts) / 2)), K = O.sub[nSub - 1];
    for (let i = 0; i < nSub; i++) {
      const ca = c0 + ((dcr - c0) * i) / nSub, cb = c0 + ((dcr - c0) * (i + 1)) / nSub;
      Fr = ringForce(ctx, s, fx);
      const y0 = fx - ca - Fr / ctx.kAx, u0 = v - vc;
      fx = cb + Fr / ctx.kAx + K.e * (K.c * y0 + (u0 + O.zw * y0) * K.s); v = vc + K.e * (K.c * u0 - (O.w2 * y0 + O.zw * u0) * K.s);
    } }
  s.Fr = Fr;
  const free = Math.min(h.H + s.hiltComp, fx), dir = Math.sign(free - d);   // the base stops at the body
  if (free < fx) v = Math.min(v, 0);
  // move toward `free` while every station lets the squashed girth through: openings within comfort are free, past
  // it the station must yield first (below); the first station that blocks is the one that yields
  let blocked = -1;
  if (dir !== 0) {
    const m = Math.max(1, Math.ceil(Math.abs(free - d) / 0.5)), stepMm = (free - d) / m;
    let x = d;
    for (let i = 1; i <= m && blocked < 0; i++) {
      const yv = i === m ? free : d + stepMm * i;
      for (let j = 0; j < n; j++) {
        const u = yv - stationY(C, j, xi);
        if (u <= 0) continue;
        const need = squashed(ctx, ringRadius(ctx, u), s.F, u), cj = rc * C.prof[j];
        if (need > Math.max(ap[j], cj) + 1e-9) { blocked = j; break; }
      }
      if (blocked >= 0) break;
      for (let j = 0; j < n; j++) { const u = yv - stationY(C, j, xi); if (u > 0) { const need = squashed(ctx, ringRadius(ctx, u), s.F, u); if (need > ap[j]) ap[j] = need; } }
      x = yv;
    }
    d = x;
    if (blocked >= 0) v = 0;   // stopped against the canal: the motion goes into the toy's compression (or stretch)
  }
  // the bends: each station of the toy reaching a bend must take the turn the tissue still asks for there; a stiffer
  // (thicker, firmer) station that cannot stops the toy with that station at the bend until the bend gives
  let bendBlocked = -1;
  if (ctx.bends && d > s.d) for (let i = 0; i < ctx.bends.length; i++) {
    const b = ctx.bends[i], at = b.at;
    if (d <= at) continue;
    const left = bendLeft(ctx, s, i), tt = ctx.takes[i], u0 = Math.max(0, Math.floor(s.d - at)), u1 = Math.min(tt.length - 1, Math.ceil(d - at));
    for (let u = u0; u <= u1; u++) if (tt[u] < left) { d = Math.max(s.d, at + u - 0.5); bendBlocked = i; v = 0; break; }
    if (bendBlocked >= 0) break;
  }
  // axial force in the toy: + pushing in, - pulling out; it goes hard past capComp of the toy's length (buckled)
  // at the hilt the base presses the body: the force through toy, base and tissue in series; the tip goes in only by
  // what the tissue compresses (not the whole overtravel)
  let F;
  const Fc = d >= h.H - 1e-6 ? contactForce(ctx, dcr - h.H) : 0;
  if (Fc > 0) { s.hiltComp = tissueOf(h, Fc); d = Math.max(d, h.H + s.hiltComp); F = Fc; v = Math.min(v, 0); }
  else { s.hiltComp = 0; F = forceOf(ctx, dcr - d); }
  s.hiltF = Fc;
  // per station: the toy's squashed girth there now, tone; the blocked station yields at a finite rate, the others
  // follow the toy or recoil toward their relaxed size (closed + relaxation gape + residual set), held open by their
  // neighbours
  let contact = false, N = 0, wt = 0, strain = 0, openMax = 0, easOpen = 0, tight = -1, tightL = 0, rate = 0;
  for (let j = 0; j < n; j++) { const u = d - stationY(C, j, xi); NEED[j] = u > 0 ? squashed(ctx, ringRadius(ctx, u), F, u) : 0; if (NEED[j] > 0) contact = true; }
  for (let j = 0; j < n; j++) {
    const T = toneAt(ctx, s, j), cj = rc * C.prof[j], closed = restOf(P) * P.closedFrac * C.prof[j], need = NEED[j];
    if (j === blocked) {
      const hold = holdOf(P, T, ap[j], cj, s.q[j], C.prof[j]), visc = (P.ringViscCold + (P.ringViscWarm - P.ringViscCold) * s.w) * T;
      rate = Math.max(0, Math.abs(F) - hold) / visc;
      ap[j] += rate * dts;
    } else {
      // held open by the toy at its neighbours (and by a neighbour being forced open), not by their own recoil
      const nbr = (i) => (i < 0 || i >= n ? 0 : i === blocked ? ap[i] : NEED[i]), nb = P.couple * Math.max(nbr(j - 1), nbr(j + 1));
      const tgt = Math.max(need, closed + P.gape * s.w * (cj - closed) + s.g[j], nb);
      if (ap[j] > tgt) ap[j] = Math.max(need, tgt + (ap[j] - tgt) * ctx.kRecoil);
      else if (nb > ap[j]) ap[j] = nb;
    }
    // stress relaxation of the held stretch; the residual opening (set) builds while stretched, closes when empty
    const over = ap[j] - cj;
    s.q[j] += over > 0 ? (1 - s.q[j]) * ctx.kRelax : -s.q[j] * ctx.kRelaxRec;
    const gt = P.setFrac * Math.max(0, ap[j] - closed);
    s.g[j] += need > closed && gt > s.g[j] ? (gt - s.g[j]) * ctx.kSet : -s.g[j] * ctx.kSetRec;
    if (need > 0) {
      N += P.kN * T * Math.max(0, need - closed);
      if (C.wI[j] >= 0.5) wt = Math.max(wt, Math.min(1, Math.max(0, (need / restOf(P) - 1) / (P.capacity - 1))));
      const st = Math.max(0, need - cj) / cj / P.overRef, load = T * Math.max(0, need - cj);
      if (st > strain) strain = st;
      if (load > tightL) { tightL = load; tight = j; }
    }
    const op = need > 0 ? Math.max(0, (ap[j] - PREV[j]) / dts) : 0;
    if (op > openMax) openMax = op;
    if (C.wE[j] > 0.5 && op > easOpen) easOpen = op;
  }
  // the internal sphincter relaxes toward the level at which the current contact would be comfortable (warm-up)
  s.w += (wt - s.w) * (wt > s.w ? ctx.kWarm : contact ? ctx.kHold : ctx.kCool);
  // the external sphincter: a brief reflex clench on a sudden fast stretch when cold; fatigue under sustained stretch
  s.ext += (P.reflexK * (1 - s.w) * Math.max(0, easOpen - 40) / P.speedRef) * dts * 10 - s.ext * ctx.kReflex;
  s.ext = Math.max(0, Math.min(1, s.ext));
  s.fat += contact && strain > 0.05 ? (1 - s.fat) * ctx.kFat : -s.fat * ctx.kFatRec;
  s.strain = contact ? (strain + (P.speedK * openMax) / P.speedRef) * (1 - P.soften * s.w) : 0;
  // the rim's travel: dragged by friction (stick while the elastic return stays under static friction, then slide),
  // and directly by a bulge blocked against the canal
  const rel = d - s.d;
  if (!contact) { s.xi -= s.xi * ctx.kXiRet; s.xiStick = true; }
  else {
    const Fi = blocked >= 0 ? F : 0, fs = ctx.mu * P.muStatic * N, fk = ctx.mu * N, kx = ctx.kXi;
    let tgt = s.xi;
    if (s.xiStick) {
      const tryXi = s.xi + rel, f = kx * tryXi - Fi;
      if (Math.abs(f) <= fs) tgt = tryXi;
      else { s.xiStick = false; s.xiDir = Math.sign(rel) || Math.sign(f); tgt = (Fi + s.xiDir * fk) / kx; }
    } else if (rel === 0 || Math.sign(rel) !== s.xiDir || Math.abs(rel) < 0.002 * P.dtMs) { s.xiStick = true; }
    else tgt = (Fi + s.xiDir * fk) / kx;
    tgt = Math.max(-ctx.xiOut, Math.min(ctx.xiIn, tgt));
    s.xi = s.xiStick ? tgt : s.xi + (tgt - s.xi) * ctx.kSlip;
  }
  // the body: pushed by the toy while it is in, a spring-damper back to rest; the soft tissue follows it, lagged
  const B = ctx.body;
  if (B) {
    const Fb = d > 0 ? F : 0, x = s.xb / 1000, v = s.vb / 1000;
    const vn = v + ((Fb - B.k * x - B.c * v) / B.m) * dts;
    s.vb = vn * 1000; s.xb = (x + vn * dts) * 1000;
    s.vj += (B.wj * B.wj * (s.xb - s.xj) - B.cj * s.vj) * dts; s.xj += s.vj * dts;
  }
  if (ctx.bends) for (let i = 0; i < ctx.bends.length; i++) {
    // readiness builds while the toy works at or past the bend (a toy held through it stretches it too)
    const b = ctx.bends[i], near = d > b.s - 15, holds = d > b.s + 15;
    // a toy stalled at a bend buckles sideways rather than pushing harder: the bend sees at most its buckling load
    // a residual opening there (a deep toy shortly before) gives part of the room: the bend gives faster, from less push
    if (bendBlocked === i) {
      const o = b.desc ? 0 : residualAt(ctx, s, i, d), a = s.acc[i] + (1 - s.acc[i]) * o;
      s.yb[i] = Math.min(1, s.yb[i] + (Math.max(0, Math.min(Math.abs(F), ctx.buckle) - b.F0 * (1 - o)) / (b.vc + (b.vr - b.vc) * (b.desc ? a / b.ceil : a))) * dts);
    } else if (!holds) s.yb[i] -= s.yb[i] * b.kRec;
    // (the descending colon's readiness is its own, toward its ceiling; the first two's are the tube's stations')
    // (left alone they settle back to experience's resting readiness, b.base; paw-hito)
    if (b.desc) { if (near) s.acc[i] += (b.ceil - s.acc[i]) * b.kWarm; else if (d < b.s - 30) s.acc[i] -= (s.acc[i] - b.base) * b.kCool; }
    else if (!ctx.tube) { if (near) s.acc[i] += (P.depthMax - s.acc[i]) * b.kWarm; else if (d < b.s - 30) s.acc[i] -= (s.acc[i] - b.base) * b.kCool; }
  }
  // the sigmoid's slow straightening (SIGMOID): first order toward the drive while the tip works past the rectosigmoid
  // turn (held, not undone, while it works less deep than the drive reached), back toward 0 once the tip has left it
  const G = ctx.sig;
  if (G) {
    const drive = sigDrive(ctx, d);
    if (drive > s.sig) s.sig += (drive - s.sig) * G.kOn;
    else if (d <= G.from && s.sig > G.base) s.sig -= (s.sig - G.base) * G.kRec;
  }
  const T = ctx.tube;
  if (T && Math.round(s.t / P.dtMs) % T.every === 0) {
    // the tube: readiness builds while the toy works at or near a station (its tip within 15 mm short of it, or past
    // it) and fades once the tip is 30 mm short of it; the residual opening builds toward its share of the stretch while
    // the toy holds the station open and recoils once it does not; the bends' readiness is their stations'
    const tr = s.tr, te = s.te, dm = P.depthMax;
    for (let j = 0; j < T.n; j++) {
      const sj = T.s[j];
      const tb = T.base[j];   // (experience's resting readiness: it settles back to it, paw-hito)
      if (d > sj - 15) tr[j] += (dm - tr[j]) * T.kW[j];
      else if (tr[j] === tb && te[j] === 0) continue;   // never reached, or long since settled
      else if (d < sj - 30 && tr[j] > tb) { tr[j] -= (tr[j] - tb) * (T.kC[j] || T.dt / (T.coolS[j] * (T.low[j] + (1 - T.low[j]) * tr[j] / dm))); if (tr[j] - tb < 1e-7) tr[j] = tb; }
      const rest = T.r0[j] * (1 + T.comply[j] * tr[j]), girth = d > sj ? ringRadius(ctx, d - sj) : 0, gt = girth > rest ? T.setFrac[j] * (girth - rest) : 0;
      te[j] += (gt - te[j]) * (gt > te[j] ? T.kSet : T.kFast[j]);
      if (te[j] < 1e-6) te[j] = 0;
    }
    s.acc[0] = tr[T.i0]; s.acc[1] = tr[T.i1];
  }
  if (ctx.bends && d > ctx.bends[0].s) { s.deepT = s.t + P.dtMs; s.accDeep = s.acc[1]; }
  const dcPrev = s.dt;   // knot and bend attempts are timed from the script, the carriage may be held back
  if (s.pushT >= 0 || s.pullT >= 0) s.pushF = Math.max(s.pushF, Math.abs(F));   // the strongest push / pull of this attempt
  const dPrev = s.d;
  const r0 = ringRadius(ctx, d - s.xi);
  s.v = v; s.dcr = dcr;
  // the gut's slow return and the tip's wobble (paw-ani1; for the view only: nothing below reads them): how deep the
  // toy has held the rectum and the sigmoid lately (a fast attack, a slow over-damped release: TISSUE_RETURN), and a
  // lateral mode of the unsupported tip excited by pushing in past the first bend against resistance (a damped
  // oscillator: WOBBLE), from the step's own depth change, so a seek gives the same state as playing to it
  { const dd = Math.max(0, d), pd = Math.max(0, s.d), env = (e, tau) => (dd >= e ? dd : e + (dd - e) * (1 - Math.exp(-P.dtMs / tau)));
    s.envR = env(s.envR || 0, TISSUE_RETURN.rectumMs); s.envS = env(s.envS || 0, TISSUE_RETURN.sigmoidMs);
    // (driven by the tip's inward speed (low-passed over 40 ms: the depth moves in steps) changing, as it catches and slips past the bends: a steady push only leans it)
    const W = WOBBLE, v = (s.wobPV || 0) + ((d > pd ? (d - pd) / dts : 0) - (s.wobPV || 0)) * (1 - Math.exp(-P.dtMs / 40)), kick = ctx.bends && d > ctx.bends[0].s + 10 && F > 0 ? Math.max(0, v - (s.wobPV || 0)) / dts : 0;
    s.wobPV = v;
    const soft = Math.sqrt(EI_REF / Math.max(1, ctx.mech.EI[Math.min(ctx.mech.EI.length - 1, Math.round(ctx.len * 0.85))])), w0 = (2 * Math.PI * W.hz) / Math.max(0.6, Math.min(2, soft)) ** 0.5;
    const acc = W.gain * kick * Math.min(2, soft) * Math.min(1.5, ctx.len / 200) - 2 * W.zeta * w0 * (s.wobV || 0) - w0 * w0 * (s.wob || 0);
    s.wobV = (s.wobV || 0) + acc * dts; s.wob = Math.max(-W.maxMm, Math.min(W.maxMm, (s.wob || 0) + s.wobV * dts)); }
  if (P.prostate) prostateStep(s, d, ctx, dts);
  s.a = ap[0]; s.r = r0; s.re = r0 > 0 ? squashed(ctx, r0, F, d - s.xi) : 0; s.d = d; s.dc = dc; s.dt = target; s.F = F; s.rate = rate; s.t += P.dtMs; s.bendBlocked = bendBlocked; s.tight = tight;
  // at the force cap: the carriage behind the script (a normal state of a closed-loop machine, not a fault)
  s.lag = target - dc;
  // hilt contact per stroke, with its peak force (the event strip's "hilted")
  if (Fc > 0) { if (s.hiltT < 0) { s.hiltT = s.t; s.hiltPeak = 0; } s.hiltPeak = Math.max(s.hiltPeak, Fc); }
  else if (s.hiltT >= 0) { ctx.events?.push({ kind: 'hilt', t: s.t, tRigid: s.hiltT, peak: s.hiltPeak }); s.hiltT = -1; }
  const limited = Math.abs(s.lag) > 0.5;
  if (limited) { if (s.limT < 0) { s.limT = s.t; s.limPeak = 0; } s.limPeak = Math.max(s.limPeak, Math.abs(s.lag)); s.limTotal += P.dtMs; }
  else if (s.limT >= 0) { ctx.events?.push({ kind: 'limit', t: s.t, tRigid: s.limT, peak: s.limPeak }); s.limT = -1; }
  if (ctx.bends) for (let i = 0; i < ctx.bends.length; i++) {
    // timed like the knot: from the script putting a rigid toy past the bend to the real tip passing it
    const b = ctx.bends[i], at = b.at, ev = ctx.events;
    if (dcPrev < at && target >= at && dPrev <= at) { s.bendT[i] = s.t; s.bendF[i] = 0; }
    if (s.bendT[i] >= 0) s.bendF[i] = Math.max(s.bendF[i], Math.abs(F));
    if (dPrev <= at && d > at && s.bendT[i] >= 0) {
      s.bendLag[i] = s.t - s.bendT[i]; s.bendForced[i] = s.yb[i] > 0.35;   // mostly forced straight, not readiness: "forcing"
      ev?.push({ kind: 'bend', bend: i, t: s.t, tRigid: s.bendT[i], lag: s.bendLag[i], forced: s.bendForced[i] });
      s.bendT[i] = -1;
    }
    if (dcPrev >= at && target < at && s.bendT[i] >= 0) { s.bendFail[i] = s.t; ev?.push({ kind: 'bendstall', bend: i, t: s.t, tRigid: s.bendT[i] }); s.bendT[i] = -1; }
  }
  const k = ctx.knot;
  if (k) {
    // the knot against the rim (which rides the canal's travel)
    // in once its widest point is past the rim, out again once it is back past it, KNOT_BAND mm either side (a knot held
    // right at the rim does not flicker; the snap happens as it clears the band)
    const pk = k.peak_mm, kd = d - s.xi, was = s.knot, now = kd >= pk + (was === 'tied' ? -KNOT_BAND : KNOT_BAND) ? 'tied' : kd >= k.from_mm ? 'pressing' : 'out', ev = ctx.events;
    if (now === 'pressing') s.pressPeak = Math.max(was === 'pressing' ? s.pressPeak : 0, s.strain);
    // the carriage puts the knot's widest point past the ring (where a rigid toy would knot) / back out
    if (dcPrev < pk && target >= pk && was !== 'tied') { s.pushT = s.t; s.pushF = Math.abs(F); }
    if (dcPrev >= pk && target < pk) {
      if (was !== 'tied' && s.pushT >= 0) {   // came back before the knot went in: a failed knot
        s.failT = s.t; s.failNeed = needMs(ctx, s, k, rc); ev?.push({ kind: 'fail', t: s.t, tRigid: s.pushT, need: s.failNeed });
        s.pushT = -1;
      } else if (was === 'tied') { s.pullT = s.t; s.pushF = Math.abs(F); }
    }
    if (dcPrev < pk && target >= pk && was === 'tied' && s.pullT >= 0) {   // pushed back in before the pop: the pop failed
      s.popFailT = s.t; s.popFailNeed = needMs(ctx, s, k, rc); ev?.push({ kind: 'popfail', t: s.t, tRigid: s.pullT, need: s.popFailNeed });
      s.pullT = -1;
    }
    // the snap: the strongest push (pull) of the attempt and the knot's fastest speed over the next SNAP_MS
    if (s.t - s.snapT <= SNAP_MS) { s.snapV = Math.max(s.snapV, Math.abs(s.v)); if (ev && s.snapEv >= 0 && ev[s.snapEv]) ev[s.snapEv].speed = s.snapV; }
    const snap = (kind) => { s.snapKind = kind; s.snapT = s.t; s.snapPeak = s.pushT >= 0 || s.pullT >= 0 ? s.pushF : Math.abs(F); s.snapV = Math.abs(s.v); s.snapEv = ev ? ev.length : -1; };
    if (now === 'tied' && was !== 'tied') {
      s.ties++; s.lastInT = s.t; s.inStrain = Math.max(s.pressPeak, s.strain);
      snap('in');
      if (s.pushT >= 0) { s.lagIn = s.t - s.pushT; ev?.push({ kind: 'in', t: s.t, tRigid: s.pushT, lag: s.lagIn, peak: s.snapPeak, speed: s.snapV }); s.pushT = -1; } else s.snapEv = -1;
    }
    if (now !== 'tied' && was === 'tied') {
      s.lastPopT = s.t;
      snap('pop');
      if (s.pullT >= 0) { s.lagOut = s.t - s.pullT; ev?.push({ kind: 'pop', t: s.t, tRigid: s.pullT, lag: s.lagOut, peak: s.snapPeak, speed: s.snapV }); s.pullT = -1; } else s.snapEv = -1;
    }
    if (now === 'tied') { s.lastTiedT = s.t; s.wTied = s.w; }
    s.knot = now;
  }
  return s;
}

/** How much longer (ms) the push (or pull) would have had to be held at the strongest force it reached: the aperture
 *  still missing at the rim over its yield rate. Infinity when that force could never open the rim that far. */
function needMs(ctx, s, k, rc) {
  const P = ctx.P, F = Math.min(s.pushF, P.forceLimitN), want = squashed(ctx, k.radius, F, k.peak_mm) - s.a;
  if (want <= 0) return 0;
  const T = toneAt(ctx, s, 0), visc = (P.ringViscCold + (P.ringViscWarm - P.ringViscCold) * s.w) * T;
  const hold = holdOf(P, T, squashed(ctx, k.radius, F, k.peak_mm), rc);
  if (F <= hold) return Infinity;
  return (want / ((F - hold) / visc)) * 1000;
}

/** Strain of taking the knot slowly (no speed term) at warm-up w. */
export function knotStrain(P, knot, w) {
  if (!knot) return 0;
  const rc = comfy(P, w), r = knot.radius * (1 - Math.min(0.3, (P.toySquashRef * E_REF) / parseFirmness(P.firmness).shaft.E));   // squashed under load
  return (Math.max(0, r - rc) / rc / P.overRef) * (1 - P.soften * w);
}

/** The warm-up the knot needs to be "ready" (knotStrain <= readyStrain): 0 = always, > 1 = never. */
export function warmNeeded(P, knot) {
  if (!knot || knotStrain(P, knot, 0) <= P.readyStrain) return 0;
  if (knot.radius * (1 - Math.min(0.3, (P.toySquashRef * E_REF) / parseFirmness(P.firmness).shaft.E)) > restOf(P) * P.capacity * P.stretchMax) return Infinity;   // past what the tissue stretches to
  if (knotStrain(P, knot, 1) > P.readyStrain) return Infinity;
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (knotStrain(P, knot, m) > P.readyStrain) lo = m; else hi = m; }
  return hi;
}

/** Readiness 0..1 for the knot at warm-up w (1 = ready). */
export const readiness = (P, knot, w) => { const need = warmNeeded(P, knot); return need === 0 ? 1 : need === Infinity ? 0 : Math.min(1, w / need); };

/** The "current kind of stroking": the actions of the last `ms` before t, trimmed to start where the motion returns
 *  to the same pos it ends at so it loops without a jump. null when there is no motion. */
export function strokePattern(script, t, ms = 8000) {
  let i1 = upper(script, t) - 1;
  if (i1 < 1) return null;
  let i0 = upper(script, t - ms);
  if (i1 - i0 < 2) return null;
  const end = script[i1].pos;
  let start = i0;
  for (let i = i0; i < i1 - 1; i++) if (Math.abs(script[i].pos - end) <= 10) { start = i; break; }
  const pat = script.slice(start, i1 + 1);
  let lo = 100, hi = 0;
  for (const a of pat) { lo = Math.min(lo, a.pos); hi = Math.max(hi, a.pos); }
  return hi - lo >= 5 && pat.length >= 3 ? pat : null;
}

/** How long until the knot is ready if the stroking pattern keeps going (forward simulation from state s).
 *  -> {ms: 0 | n | Infinity, plateau: best readiness reached, idle: no motion to repeat}. */
export function timeToReady(s, script, t, ctx, { maxMs = 600000 } = {}) {
  const P = ctx.P, need = warmNeeded(P, ctx.knot);
  if (s.w >= need) return { ms: 0, plateau: 1, idle: false };
  if (need === Infinity) return { ms: Infinity, plateau: 0, idle: false, never: true };
  const pat = strokePattern(script, t);
  if (!pat) return { ms: Infinity, plateau: readiness(P, ctx.knot, s.w), idle: true };
  const x = copyState(s), t0 = pat[0].at, period = pat[pat.length - 1].at - t0;
  let best = x.w, j = 0;
  for (let el = 0; el < maxMs; el += P.dtMs) {
    const tt = t0 + (el % period);
    if (tt < pat[j].at) j = 0;
    while (j < pat.length - 2 && pat[j + 1].at <= tt) j++;
    const A = pat[j], B = pat[j + 1];
    step(x, A.pos + ((B.pos - A.pos) * (tt - A.at)) / (B.at - A.at), ctx);
    if (x.w >= need) return { ms: el + P.dtMs, plateau: 1, idle: false };
    if (x.w > best) best = x.w;
  }
  return { ms: Infinity, plateau: Math.min(1, best / need), idle: false };
}

/** Seconds a ready canal stays ready with nothing inside (w decays toward 0 over coolS). */
export function readyForMs(P, knot, w) {
  const need = warmNeeded(P, knot);
  if (!(need > 0) || need === Infinity || w < need) return need === 0 ? Infinity : 0;
  return P.coolS * 1000 * Math.log(w / need);
}

// ---- a warmed-up start (paw-9yqf) ----
export const WARMUPS = Object.freeze(['none', 'light', 'full']);
// (sig: the share of the sigmoid's straightening drive at the routine's depth the warm-up leaves at least, paw-qin8: its
// 2 s strokes spend little time deep in the sigmoid, a real warm-up session with depth work more)
const WARM = { light: { min: 2, ready: 0.5, sig: 0.25 }, full: { min: 5, ready: 1, sig: 0.5 } }, WARM_MAX_MIN = 15, warmCache = new Map();
/** The deepest the script takes the toy (mm inside), for the warm-up's routine. */
export const scriptDepth = (script, rig, toy) => (script?.length ? Math.min(Math.max(...script.map((p) => depthOf(rig, p.pos))), toy.usable_mm || toy.length_mm) : 0);
/** The state a warm-up leaves (paw-9yqf), defined by the model itself: from cold, slow strokes (2 s each, out to the
 *  rig's out position and in) with this toy, working up from a third of `depthMm` to all of it over the first two
 *  minutes and holding there; light: 2 minutes and, for a knotted toy, on until the ring is half ready for its knot;
 *  full: 5 minutes and on until it is ready (the knot taken without the cold-start resistance), never past 15 minutes
 *  (a knot this ring can never take: what that much stroking gives). Then 3 s out. The tissue's state (the ring's
 *  relaxation and reflex, the canal's apertures, relaxation and set, the bends' and the tube's readiness, residual
 *  openings, the descending colon's turn, the sigmoid's straightening: at least WARM.sig of its drive at that depth)
 *  starts the script: the toy out, the clock at 0, no events. null for none. Cached. -> state, and
 *  .warmMs: how long the routine ran. */
export function warmStart(toy, rig, P, level, depthMm) {
  const W = WARM[level];
  if (!W || !(depthMm > 0)) return null;
  const key = JSON.stringify([toy.id, toy.length_mm, toy.usable_mm, rig.offsetMm, rig.strokeMm, { ...P, warmup: '' }, level, Math.round(depthMm / 5)]);
  if (warmCache.has(key)) return copyState(warmCache.get(key));
  const P0 = { ...P, warmup: 'none' }, ctx = makeContext(toy, rig, P0), s = initialState(P0), dt = P0.dtMs, knot = ctx.knot;
  const posOf = (depth) => Math.max(0, Math.min(100, 100 * (1 - (depth - rig.offsetMm) / rig.strokeMm)));
  let t = 0;
  for (; t < WARM_MAX_MIN * 60000; ) {
    t += dt;
    const deep = depthMm * (1 / 3 + (2 / 3) * Math.min(1, t / 120000)), ph = 0.5 - 0.5 * Math.cos((2 * Math.PI * (t % 2000)) / 2000);
    step(s, posOf(rig.offsetMm + (deep - rig.offsetMm) * ph), ctx);
    if (t % 2000 === 0 && t >= W.min * 60000 && (!knot || readiness(P0, knot, s.w) >= W.ready)) break;
  }
  for (let k = 0; k < 3000 / dt; k++) step(s, 100, ctx);
  const out = { ...initialState(P0), a: s.a, ap: s.ap.slice(), q: s.q.slice(), g: s.g.slice(), w: s.w, ext: s.ext, fat: s.fat, tr: s.tr.slice(), te: s.te.slice(), acc: [...s.acc], accDeep: s.accDeep, sig: Math.max(s.sig, W.sig * sigDrive(ctx, depthMm)) };
  out.warmMs = t;
  warmCache.set(key, out);
  if (warmCache.size > 16) warmCache.delete(warmCache.keys().next().value);
  return { ...copyState(out), warmMs: t };
}
/** The script's starting state: warmed (P.warmup light / full) or cold. */
const startState = (script, toy, rig, P) => (P.warmup && P.warmup !== 'none' && warmStart(toy, rig, P, P.warmup, scriptDepth(script, rig, toy))) || initialState(P);

/** First index with at > t (binary search). */
function upper(script, t) {
  let lo = 0, hi = script.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (script[m].at <= t) lo = m + 1; else hi = m; }
  return lo;
}

/** The first time the scripts differ in what they produce: before it, posAt is identical. */
export function firstChangeMs(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i].at === b[i].at && a[i].pos === b[i].pos) i++;
  if (i === a.length && i === b.length) return Infinity;
  return i === 0 ? 0 : (i < n ? Math.min(a[i - 1].at, b[i - 1].at) : (a[i - 1] || b[i - 1]).at);
}

/** Cached, incremental integration of the model over a script. stateAt(t) is a pure function of
 *  (script, toy, rig, params, t): every step lands on the fixed grid k * dtMs from 0, checkpoints every
 *  checkpointMs are reused across calls, an edit drops only the checkpoints after the first change. */
/** What a MachineSim's context is keyed by: the toy and rig (setupKey), and the params. */
export const setupKey = (toy, rig) => JSON.stringify([toy.id, toy.length_mm, toy.usable_mm, toy.profile.length, toy.knot ?? '', rig.strokeMm, rig.offsetMm]);
export const simKey = (toy, rig, P) => `${setupKey(toy, rig)}|${JSON.stringify(P)}`;

export class MachineSim {
  script = []; ctx = null; key = ''; cps = [];
  /** The playback cursor of the traced calls: the state at its grid time tg and the steps since (t, strain, |F|, a ring)
   *  over the last traceMs, so playing forward integrates only the new steps (paw-h83k; null = start over). */
  cur = null;
  /** Set the inputs; keeps the checkpoints that are still valid. */
  configure(script, toy, rig, P = PARAMS) {
    const key = simKey(toy, rig, P);
    if (key !== this.key || !this.ctx) { this.key = key; this.setup = setupKey(toy, rig); this.ctx = makeContext(toy, rig, P); this.cps = []; this.cur = null; }
    if (script !== this.script) {
      const tc = firstChangeMs(this.script, script || []);
      this.script = script || [];
      if (tc !== Infinity) this.cps.length = Math.min(this.cps.length, Math.floor(tc / this.ctx.P.checkpointMs) + 1);
      if (this.cur && tc < this.cur.tg) this.cur = null;   // (posAt up to tc is unchanged: a cursor before it still holds)
      // (a warmed start depends on how deep the script goes: a new depth restarts it)
      const wd = P.warmup && P.warmup !== 'none' ? Math.round(scriptDepth(this.script, rig, toy) / 5) : 0;
      if (wd !== this.warmDepth) { this.warmDepth = wd; this.cps = []; this.cur = null; }
    }
    if (!this.cps.length) this.cps.push(startState(this.script, toy, rig, this.ctx.P));
    return this;
  }
  /** State at t (on the grid: floor(t / dtMs) * dtMs). With traceMs: also the max strain per `every` ms bucket
   *  over [t - traceMs, t] -> {state, trace: {t0, every, values}}. A traced call at or a little after the previous
   *  traced one continues from it (the same steps from the same state: bit-identical to integrating from a checkpoint). */
  stateAt(t, { traceMs = 0, every = 50 } = {}) {
    const P = this.ctx.P, dt = P.dtMs, CK = P.checkpointMs, tg = Math.max(0, Math.floor(t / dt) * dt);
    const sc = this.script, n = sc.length;
    let c = traceMs ? this.cur : null, s;
    if (c && c.traceMs === traceMs && tg >= c.tg && tg - c.tg <= traceMs) s = c.s;
    else {
      const from = Math.max(0, tg - traceMs), k = Math.min(this.cps.length - 1, Math.floor(from / CK));
      s = copyState(this.cps[k]);
      c = null;
      if (traceMs) { const cap = Math.ceil(traceMs / dt) + 2; c = this.cur = { s, tg, traceMs, cap, head: 0, len: 0, t: new Float64Array(cap), strain: new Float64Array(cap), F: new Float64Array(cap) }; }
    }
    let j = 0;
    if (n) { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (sc[m].at <= s.t) lo = m + 1; else hi = m; } j = Math.max(0, lo - 1); }
    while (s.t < tg) {
      const tt = s.t + dt;   // the step integrates the motion up to tt
      let pos = 50;
      if (n) {
        while (j < n - 1 && sc[j + 1].at <= tt) j++;
        const A = sc[j], B = sc[j + 1];
        pos = tt <= sc[0].at ? sc[0].pos : !B ? A.pos : A.pos + ((B.pos - A.pos) * (tt - A.at)) / (B.at - A.at);
      }
      step(s, pos, this.ctx);
      if (s.t % CK === 0 && s.t / CK === this.cps.length) this.cps.push(copyState(s));
      if (c) { const i = (c.head + c.len) % c.cap; c.t[i] = s.t; c.strain[i] = s.strain; c.F[i] = s.F; if (c.len < c.cap) c.len++; else c.head = (c.head + 1) % c.cap; }
    }
    let trace = null;
    if (c) {
      c.tg = tg;
      while (c.len && c.t[c.head] <= tg - traceMs) { c.head = (c.head + 1) % c.cap; c.len--; }
      // (the buckets filled in step order, as the steps came: the same comparisons, the same float32 values)
      const tr0 = Math.floor((tg - traceMs) / every) * every, values = new Float32Array(Math.ceil(traceMs / every) + 1), forces = new Float32Array(values.length);
      for (let q = 0; q < c.len; q++) {
        const i = (c.head + q) % c.cap, b = Math.floor((c.t[i] - tr0) / every);
        if (b >= 0 && b < values.length) { if (c.strain[i] > values[b]) values[b] = c.strain[i]; if (Math.abs(c.F[i]) > forces[b]) forces[b] = Math.abs(c.F[i]); }
      }
      trace = { t0: tr0, every, values, forces };
      s = copyState(s);   // (the caller's copy: the cursor's own state keeps integrating)
    }
    if (!Number.isFinite(s.d)) {   // before the first step (t < dtMs): the toy sits where the script puts the carriage
      const pos = !n ? 50 : sc[0].pos;
      s.d = s.dc = s.dt = Math.min(depthOf(this.ctx.rig, pos), this.ctx.len);
    }
    return trace ? { state: s, trace } : { state: s };
  }
  /** paw-mnd8: lay checkpoints toward t for at most ms of wall time (untraced stateAt calls, one checkpoint interval each:
   *  the same steps from the same states). True once a traced stateAt(t, {traceMs}) has at most one interval plus its
   *  trace left to integrate (cheap enough for a frame). */
  advance(t, ms = 5, traceMs = 10000) {
    const CK = this.ctx.P.checkpointMs, want = Math.floor(Math.max(0, t - traceMs) / CK), t0 = performance.now();
    while (this.cps.length - 1 < want) {
      if (performance.now() - t0 >= ms) return false;
      this.stateAt(this.cps.length * CK);
    }
    return true;
  }
  /** paw-mnd8: a quick look while the params change (a tuning slider dragged, or let go late in a long script): the state
   *  at t from this sim's checkpoints (the history under the params they were laid with) carried over the last windowMs
   *  under ctx (another context: the same toy, rig and script). Approximate; changes nothing here. null when the state's
   *  shape differs (the canal's stations, the tube) or the old history stops well before the window (a seek far ahead). */
  previewAt(t, ctx, windowMs = 4000) {
    const dt = ctx.P.dtMs, tg = Math.max(0, Math.floor(t / dt) * dt), CK = this.ctx.P.checkpointMs, sc = this.script, n = sc.length;
    const k = Math.max(0, Math.min(this.cps.length - 1, Math.floor((tg - windowMs) / CK)));
    if (tg - this.cps[k].t > windowMs + 2 * CK) return null;
    const s = copyState(this.cps[k]), s0 = initialState(ctx.P);
    if (s.ap.length !== s0.ap.length || s.te.length !== s0.te.length) return null;
    let j = 0;
    if (n) { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (sc[m].at <= s.t) lo = m + 1; else hi = m; } j = Math.max(0, lo - 1); }
    while (s.t < tg) {
      const tt = s.t + dt;
      let pos = 50;
      if (n) { while (j < n - 1 && sc[j + 1].at <= tt) j++; const A = sc[j], B = sc[j + 1]; pos = tt <= sc[0].at ? sc[0].pos : !B ? A.pos : A.pos + ((B.pos - A.pos) * (tt - A.at)) / (B.at - A.at); }
      step(s, pos, ctx);
    }
    if (!Number.isFinite(s.d)) s.d = s.dc = s.dt = Math.min(depthOf(ctx.rig, n ? sc[0].pos : 50), ctx.len);
    return s;
  }
}

/** Every knot event over the whole script (pure; the same integration as MachineSim): [{kind: 'in' | 'pop' | 'fail' |
 *  'popfail', t, tRigid (when a rigid toy would have done it: the carriage put the knot's widest point past the
 *  ring), lag? (ms), need? (ms more the push / pull had to be held)}]. For the panel's strip and summary, and later
 *  for the Knotting effect's push / pop defaults. */
export function simulateKnots(script, toy, rig, P = PARAMS) {
  const ctx = makeContext(toy, rig, P);
  if ((!ctx.knot && !ctx.bends && !P.prostate) || !script?.length) return [];
  ctx.events = [];
  const s = startState(script, toy, rig, P), end = script[script.length - 1].at + 1000;
  let j = 0;
  while (s.t < end) {
    const tt = s.t + P.dtMs;
    while (j < script.length - 1 && script[j + 1].at <= tt) j++;
    const A = script[j], B = script[j + 1];
    step(s, tt <= script[0].at ? script[0].pos : !B ? A.pos : A.pos + ((B.pos - A.pos) * (tt - A.at)) / (B.at - A.at), ctx);
  }
  return ctx.events;
}

/** Only the depth events (bend passed / stalled) of simulateKnots. */
export const simulateDepth = (script, toy, rig, P = PARAMS) => simulateKnots(script, toy, rig, P).filter((e) => e.kind === 'bend' || e.kind === 'bendstall');

/** Counts and median lag of the events in [t0, t1]: attempts = knots taken + failed. */
export function knotStats(events, t0 = -Infinity, t1 = Infinity) {
  const ev = events.filter((e) => e.tRigid >= t0 && e.tRigid <= t1), ins = ev.filter((e) => e.kind === 'in'), pops = ev.filter((e) => e.kind === 'pop');
  const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : NaN);
  return { attempts: ins.length + ev.filter((e) => e.kind === 'fail').length, taken: ins.length, failed: ev.filter((e) => e.kind === 'fail').length,
    hilts: (() => { const h = ev.filter((e) => e.kind === 'hilt'); return { count: h.length, peak: h.reduce((x, e) => Math.max(x, e.peak), 0) }; })(),
    pops: pops.length, popFails: ev.filter((e) => e.kind === 'popfail').length, lagIn: med(ins.map((e) => e.lag)), lagOut: med(pops.map((e) => e.lag)),
    limit: (() => { const l = ev.filter((e) => e.kind === 'limit'); return { count: l.length, ms: l.reduce((x, e) => x + (e.t - e.tRigid), 0), peak: l.reduce((x, e) => Math.max(x, e.peak), 0) }; })(),
    bends: [0, 1, 2].map((i) => { const p = ev.filter((e) => e.kind === 'bend' && e.bend === i); return { passed: p.length, forced: p.filter((e) => e.forced).length,
      stalled: ev.filter((e) => e.kind === 'bendstall' && e.bend === i).length, lag: med(p.map((e) => e.lag)) }; }) };
}

/** The opening now: rim diameter (mm) and its relaxed diameter (the resting radius x 2: the stretch is gape / relaxed),
 *  whether it is still closing (gape after a toy left), the rim's travel (mm, + in / - everted), the body's recoil (mm). */
export function openingSummary(s, ctx) {
  const P = ctx.P, C = ctx.canal, rc = comfy(P, s.w), closed = restOf(P) * P.closedFrac, empty = !(s.d - s.xi > 0);
  const rest = closed + P.gape * s.w * (rc - closed);
  return { gape: 2 * s.a, relaxed: 2 * restOf(P), closing: empty && s.a > rest + 0.5, empty, xi: s.xi, xb: s.xb, tight: s.tight >= 0 ? C.y[s.tight] : null, hiltF: s.hiltF, hiltMm: s.hiltComp };
}

/** Readouts at state s: knot label, readiness 0..1, readiness lost since the last tie and the time since, how long
 *  a ready canal stays ready at rest; the opening. Pure; the panel adds timeToReady (throttled). */
export function summary(s, ctx) {
  const P = ctx.P, k = ctx.knot, t = s.t, depth = depthSummary(s, ctx), opening = openingSummary(s, ctx);
  if (!k) return { label: 'No knot', tone: 'neutral', ready: null, depth, opening };
  const ready = readiness(P, k, s.w);
  const label = s.knot === 'tied' ? (t - s.lastInT < 500 ? 'Knot in' : 'Tied')
    : t - s.lastPopT < 700 ? 'Pop' : s.knot === 'pressing' ? 'Pressing' : 'Knot out';
  const tone = label === 'Tied' || label === 'Knot in' ? 'accent' : label === 'Pop' ? 'warn' : label === 'Pressing' ? 'info' : 'neutral';
  return { label, tone, ready, need: warmNeeded(P, k), w: s.w, ties: s.ties,
    lost: s.ties ? Math.max(0, readiness(P, k, s.wTied) - ready) : null, since: s.ties && s.knot !== 'tied' ? t - s.lastTiedT : null,
    readyFor: ready >= 1 ? readyForMs(P, k, s.w) : 0, inStrain: s.ties ? s.inStrain : null,
    pushing: s.pushT >= 0 ? t - s.pushT : null, pulling: s.pullT >= 0 ? t - s.pullT : null,
    lagIn: s.lagIn, lagOut: s.lagOut, fail: s.failT > -Infinity && s.failT > s.lastInT ? s.failNeed : null,
    popFail: s.popFailT > -Infinity && s.popFailT > s.lastPopT ? s.popFailNeed : null, depth, opening,
    snap: s.snapKind ? { kind: s.snapKind, peak: s.snapPeak, speed: s.snapV } : null };
}

/** Depth readouts: how deep is comfortable now (no bend left that the toy cannot take), the rectosigmoid verdict
 *  (ready / how much more depth work at the current rate / not with this toy), the same for a modelled body's
 *  descending colon (desc: its verdict, readiness, ceiling and how far this toy's tip gets into its turn, reach / at),
 *  the sigmoid's straightening (sig), depth readiness 0..1 per bend, time since depth was worked and readiness lost
 *  since. fixedStop: stalled at the descending colon and too stiff for the turn it has left even at its ceiling.
 *  null without the anatomy. */
export function depthSummary(s, ctx) {
  if (!ctx.bends) return null;
  const [b0, b1, b2] = ctx.bends, P = ctx.P, len = Math.min(ctx.len, ctx.L);
  const ok = (i) => bendLeft(ctx, s, i, false) <= toyTake(ctx, i);
  const why = !ok(0) ? 0 : !ok(1) ? 1 : b2 && len > b2.s && !ok(2) ? 2 : -1, comfortable = why === 0 ? b0.s : why === 1 ? b1.s : why === 2 ? b2.at : len;
  // the readiness a bend needs, and the time to it while working near it (acc -> its most over its warm-up time)
  const verdict = (i, max, warmS) => {
    const need = bendNeed(ctx, s, i);
    if (len < ctx.bends[i].s + 15) return { verdict: 'short', need };
    if (need <= 0 || s.acc[i] >= need) return { verdict: 'ready', need };
    if (need > max) return { verdict: 'firm', need };
    return { verdict: 'work', need, ms: warmS * 1000 * Math.log((max - s.acc[i]) / (max - need)) };
  };
  const rs = verdict(1, P.depthMax, P.depthWarmS[1] * P.depthTime), need = rs.need;
  const desc = b2 ? { ...verdict(2, b2.ceil, P.descWarmS * P.depthTime), acc: s.acc[2], ceil: b2.ceil, reach: b2.reach, at: b2.at } : null;
  // (carried: how far the gut lies along the toy, up the belly's midline; paw-hito, centreline.js MIDLINE)
  const pin = pathInputs(s, ctx), carried = carriedShare(pin.forward, pin.descOpen, !!b2);
  return { comfortable: Math.round(Math.min(comfortable, len)), why: comfortable < len ? why : -1, rs, desc, sig: s.sig || 0, carried, need, acc: [...s.acc], map: depthMap(s, ctx, need), blocked: s.bendBlocked, forced: s.bendBlocked >= 0 && s.yb[s.bendBlocked] > 0.35, fixedStop: s.bendBlocked === 2 && desc?.verdict === 'firm',
    since: Number.isFinite(s.deepT) && s.d <= b0.s ? s.t - s.deepT : null, lost: Number.isFinite(s.deepT) ? Math.max(0, s.accDeep - s.acc[1]) : null,
    lag: s.bendLag, stalled: s.bendFail.map((x, i) => x > -Infinity && (Number.isNaN(s.bendLag[i]) || x > s.t - 1e9) ? x : null), yb: [...s.yb] };
}

/** The readout's headline for where the toy is held (depthSummary -> text; name(i): the bend's name; '' when free): a toy
 *  held in the descending colon's turn that is still opening is working through it (N %: its readiness of what this toy
 *  needs), not stalled; one too stiff for what that turn has left at its ceiling stopped there. */
export function stallText(ds, name) {
  if (!ds || ds.blocked < 0) return '';
  if (ds.fixedStop) return 'Stopped at the descending colon: too stiff for the turn it has left';
  if (ds.forced) return `Forcing the ${name(ds.blocked)}`;
  if (ds.blocked === 2 && ds.desc) return `Working through the descending turn: ${Math.round(100 * (ds.desc.need > 0 ? Math.min(1, ds.desc.acc / ds.desc.need) : 1))} % of the way`;
  return `Stalled at the ${name(ds.blocked)}`;
}

/** The tube now (null without the anatomy): per station its arc (mm from the verge), its empty lumen (mm: the resting
 *  lumen widened by readiness, plus the residual opening; where the toy is, the toy holds it open further) and its
 *  readiness (0..1 of the most depth work relaxes it, depthMax). */
export function tubeState(s, ctx) {
  const T = ctx.tube;
  if (!T) return null;
  const lumen = new Float32Array(T.n), ready = new Float32Array(T.n), dm = ctx.P.depthMax;
  for (let j = 0; j < T.n; j++) { lumen[j] = T.r0[j] * (1 + T.comply[j] * s.tr[j]) + s.te[j]; ready[j] = s.tr[j] / dm; }
  return { s: T.s, r0: T.r0, lumen, ready, seg: T.seg, i1: T.i1 };
}

/** The depth map (bars, 0..1): the canal's warm-up (its internal sphincter's relaxation), and readiness (of the
 *  most depth work relaxes it) over the rectum (the flexure and the ampulla, mean), at the rectosigmoid junction, and
 *  over the sigmoid (mean); `need`: the junction readiness this toy needs, on the same scale; a modelled body's
 *  descending colon (desc: its readiness of its ceiling, descNeed: this toy's need on that scale, > 1 never; null
 *  without one); straight: the sigmoid's straightening (0..1). */
function depthMap(s, ctx, need) {
  const T = ctx.tube, dm = ctx.P.depthMax, b2 = ctx.bends[2];
  const desc = b2 ? { desc: s.acc[2] / b2.ceil, descNeed: bendNeed(ctx, s, 2) / b2.ceil } : { desc: null, descNeed: null }, straight = s.sig || 0;
  if (!T) return { canal: s.w, rectum: s.acc[0] / dm, junction: s.acc[1] / dm, sigmoid: 0, need: Math.max(0, need) / dm, ...desc, straight };
  let r = 0, nr = 0, g = 0, ng = 0;
  for (let j = 0; j < T.n; j++) { if (T.seg[j] <= 1) { r += s.tr[j]; nr++; } else if (T.seg[j] === 3) { g += s.tr[j]; ng++; } }
  return { canal: s.w, rectum: r / (nr || 1) / dm, junction: s.tr[T.i1] / dm, sigmoid: g / (ng || 1) / dm, need: Math.max(0, need) / dm, ...desc, straight };
}

/** Prime the depth readiness (tests, and a session that starts warm): the rectum's stations (flexure and ampulla) to
 *  a0, the junction's and the sigmoid's to a1; the bends' readiness follows (the descending colon's, a2, its own). */
export function primeDepth(s, ctx, [a0, a1, a2 = s.acc[2] || 0]) {
  const T = ctx.tube;
  if (T) { for (let j = 0; j < T.n; j++) s.tr[j] = T.seg[j] <= 1 ? a0 : a1; s.acc = [s.tr[T.i0], s.tr[T.i1], a2]; }
  else s.acc = [a0, a1, a2];
  return s;
}

/** "42 s", "3 min 05 s", "1 h 02 min". */
export function fmtDuration(ms) {
  if (!Number.isFinite(ms)) return '∞';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} min`;
}
