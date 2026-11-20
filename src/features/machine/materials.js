// materials.js -- toy silicone grades (pure). The maker's firmness codes 2 / 3 / 5 / 8 read as Shore 00-20 / 00-30 /
// 00-50 / 00-80 (the owner: soft / medium / firm = 00-30 / 00-50 / 00-80, platinum silicone); split codes "3/8" =
// shaft / base. Generic material figures, ESTIMATED from hardness, not the maker's formulation.
//
// The modulus is the small-strain Young's modulus E, which is what governs how a toy squashes, bends and buckles at the
// strains here. (The datasheets' 100 % modulus, used before, compresses the soft grades together: Ecoflex 00-30 /
// 00-50 read 10 / 12 psi, yet feel clearly different, and it had firm only 3x medium.) One relation for all four:
// the durometer's own mechanics. ASTM D2240 Type 00: a 2.38 mm (3/32 in) ball indenter (R = 1.19 mm) on a spring of
// 203 mN + 9.08 mN per point, at an indentation of (100 - H) % of 2.54 mm; Hertz contact for a sphere,
// F = 4/3 E* sqrt(R) d^1.5, incompressible rubber E = 0.75 E*. Result:
//   00-20: 0.069 MPa    00-30: 0.103 MPa (1.5x)    00-50: 0.237 MPa (3.4x)    00-80: 1.32 MPa (19x; 5.6x 00-50)
// Cross-checks: published small-strain moduli of Ecoflex 00-30 (~70-125 kPa) and 00-50 (~100-220 kPa); 00-80 is
// about Shore A 28 on the usual equivalence charts, where Gent's relation, E = 0.0981 (56 + 7.62336 S) /
// (0.137505 (254 - 2.54 S)) MPa, gives 1.05 MPa, and Dragon Skin 20 / 30 class silicones measure ~0.5-1 MPa.

/** Young's modulus (MPa) from a Shore 00 reading, by the Type 00 durometer's spring and ball (Hertz). */
export function modulusFromShore00(H) {
  const R = 1.19, d = ((100 - H) / 100) * 2.54, F = 0.203 + 0.00908 * H;   // mm, mm, N
  return 0.75 * ((3 * F) / (4 * Math.sqrt(R) * d ** 1.5));                   // N/mm^2 = MPa
}

export const GRADES = Object.freeze({
  2: { code: '2', shore: '00-20', label: 'Extra soft (00-20)', E: modulusFromShore00(20) },
  3: { code: '3', shore: '00-30', label: 'Soft (00-30)', E: modulusFromShore00(30) },
  5: { code: '5', shore: '00-50', label: 'Medium (00-50)', E: modulusFromShore00(50) },
  8: { code: '8', shore: '00-80', label: 'Firm (00-80)', E: modulusFromShore00(80) },
  rigid: { code: 'rigid', shore: '-', label: 'Rigid (test limit)', E: 500 },   // tests only: the rigid limit
});
export const LOSS = 0.1;          // loss factor (tan delta) of platinum silicone, estimated (typically 0.05-0.15)
export const ALL_CODES = Object.freeze(['2', '3', '5', '8', '2/8', '3/8', '5/8']);
const LEGACY = { soft: '3', medium: '5', firm: '8', 'extra soft': '2' };

/** A firmness setting ('5', '3/8', or a legacy 'soft' / 'medium' / 'firm') -> {shaft, base} grades. */
export function parseFirmness(v) {
  const s = LEGACY[v] || String(v ?? '5');
  const [a, b] = s.split('/');
  const shaft = GRADES[a] || GRADES[5];
  return { shaft, base: GRADES[b] || shaft, code: GRADES[a] ? s : '5' };
}
/** The label for a firmness code: "Medium (00-50)", or "Soft shaft / firm base (00-30 / 00-80)". */
export function firmnessLabel(code) {
  const { shaft, base } = parseFirmness(code);
  return shaft === base ? shaft.label : `${shaft.label.split(' (')[0]} shaft / ${base.label.split(' (')[0].toLowerCase()} base (${shaft.shore} / ${base.shore})`;
}
/** Old saved "soft" / "medium" / "firm" -> the grade codes. */
export const migrateFirmness = (v) => LEGACY[v] || v;
