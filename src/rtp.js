// Betting math for the stepper/crash round.
//
// The ONLY things that affect the payout are the bet amount and this module.
// Everything that happens in the 3D world (enemy fire, player kills, squad
// saves) is presentation layered on top of the outcome drawn here.

import { GAME } from './config.js';

// Per-step survival probabilities (step 1..10). The early steps are nearly
// safe; the hazard peaks around steps 4-5 and stays high to the end.
const SURVIVAL = [0.99, 0.97, 0.94, 0.88, 0.84, 0.83, 0.82, 0.81, 0.80, 0.79];

// Early-cashout discount on the fair ladder. Fair pay for step i is
// r / P(survive through i); scaling it below 1 early makes the first rungs
// pay LESS than the stake (break-even lands at step 4) and rewards riding
// deeper. The discount reaches 1.0 at step 10, so the ride-to-the-end
// strategy has EV exactly r * bet — that optimal strategy defines the RTP;
// every earlier cashout has EV r * discount <= r.
const DISCOUNT = [0.42, 0.55, 0.70, 0.82, 0.90, 0.94, 0.96, 0.98, 0.99, 1.00];

export function multipliers(rtp = GAME.rtp) {
  const out = [];
  let cum = 1;
  for (let i = 0; i < GAME.maxSteps; i++) {
    cum *= SURVIVAL[i];
    out.push((rtp / cum) * DISCOUNT[i]);
  }
  return out;
}

// Draw the whole round outcome up-front.
// Returns { mults, bustStep } where bustStep is 1-based, or null if the
// player is destined to clear all 10 steps.
export function drawRound(rng, rtp = GAME.rtp) {
  const mults = multipliers(rtp);
  let bustStep = null;
  for (let i = 0; i < GAME.maxSteps; i++) {
    if (!rng.chance(SURVIVAL[i])) { bustStep = i + 1; break; }
  }
  return { mults, bustStep, survival: SURVIVAL.slice() };
}

export function fmtMoney(v) {
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtMult(m) {
  return '×' + m.toFixed(2);
}
