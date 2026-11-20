// machines.js -- the machines the Machine panel can drive (a data list: add an entry to add one). forceLbf is the
// thrust cap in pounds-force (the owner's unit); the physics works in newtons (physics.js forceLimitN). Only the force
// limit is specified so far: stroke length and top speed are left for later (null = not modelled).

export const LBF_N = 4.4482216152605;   // 1 lbf in N (exact by definition of the pound and standard gravity)
export const lbfToN = (lbf) => lbf * LBF_N;
export const nToLbf = (n) => n / LBF_N;

export const MACHINES = Object.freeze([
  { id: 'capstan', name: 'Capstan', forceLbf: 60, strokeMm: null, maxSpeedMmS: null },   // the owner's figure: 60 lbf
  { id: 'custom', name: 'Custom', forceLbf: null, strokeMm: null, maxSpeedMmS: null },  // set with the slider
]);
export const FORCE_RANGE_LBF = Object.freeze([5, 150]);
export const machineOf = (id) => MACHINES.find((m) => m.id === id) || MACHINES[0];
