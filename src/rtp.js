// Betting math for the stepper/crash round.
//
// The ONLY things that affect the payout are the bet amount, the mission's
// step count, and this module. Everything in the 3D world (enemy fire,
// player kills, squad saves, objectives) is presentation on top of the
// outcome drawn here.
//
// Missions vary in length (3-10 checkpoints). Every mission's full ride
// survives with the same cumulative probability, so the max multiplier is
// ~4.3x regardless of length — shorter missions just have chunkier, riskier
// steps. The ladder ramps geometrically from a sub-stake first rung to the
// fair max, so break-even lands ~40-55% of the way through the mission,
// right around where the bust hazard peaks.

import { GAME } from './config.js';

const FULL_RIDE_SURVIVAL = 0.2325; // → max multiplier ≈ 4.3 at RTP 1
const START_MULT = 0.35;           // first rung pays ~0.35x the stake

// Hazard weight at mission fraction f (0..1]: gentle opening, danger fully
// ramped in by ~45% through, hot until the end.
function hazardWeight(f) {
  return Math.min(1, Math.max(0.12, Math.pow(f / 0.45, 1.6)));
}

export function survivalCurve(steps) {
  const w = [];
  for (let i = 1; i <= steps; i++) w.push(hazardWeight(i / steps));
  const sum = w.reduce((a, b) => a + b, 0);
  const lnC = Math.log(FULL_RIDE_SURVIVAL);
  return w.map((wi) => Math.exp(lnC * (wi / sum)));
}

export function multipliers(steps, rtp = GAME.rtp) {
  const surv = survivalCurve(steps);
  const cums = [];
  let c = 1;
  for (const s of surv) { c *= s; cums.push(c); }
  const maxM = rtp / cums[steps - 1];
  const out = [];
  for (let i = 0; i < steps; i++) {
    const frac = steps === 1 ? 1 : i / (steps - 1);
    const geo = START_MULT * Math.pow(maxM / START_MULT, frac);
    // no rung may pay above its fair value, or that rung would beat the RTP
    out.push(Math.min(geo, (rtp / cums[i]) * 0.995));
  }
  out[steps - 1] = maxM; // ride-to-the-end EV is exactly rtp * bet
  return out;
}

// Draw the whole round outcome up-front.
// Returns { mults, bustStep } — bustStep is 1-based, null = clears all steps.
export function drawRound(rng, steps, rtp = GAME.rtp) {
  const surv = survivalCurve(steps);
  const mults = multipliers(steps, rtp);
  let bustStep = null;
  for (let i = 0; i < steps; i++) {
    if (!rng.chance(surv[i])) { bustStep = i + 1; break; }
  }
  return { mults, bustStep, survival: surv, steps };
}

export function fmtMoney(v) {
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtMult(m) {
  return '×' + m.toFixed(2);
}
