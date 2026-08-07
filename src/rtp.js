// Betting math for the stepper/crash round.
//
// The ONLY things that affect the payout are the bet amount and this module.
// Everything that happens in the 3D world (enemy fire, player kills, squad
// saves) is presentation layered on top of the outcome drawn here.

import { GAME } from './config.js';

// Per-step survival probabilities (step 1..10). Escalating danger.
const SURVIVAL = [0.88, 0.86, 0.84, 0.82, 0.80, 0.78, 0.76, 0.74, 0.72, 0.70];

// Multiplier ladder: with RTP r, cashing out after step i pays
// bet * r / P(surviving through step i)  =>  EV of any strategy is r * bet.
export function multipliers(rtp = GAME.rtp) {
  const out = [];
  let cum = 1;
  for (let i = 0; i < GAME.maxSteps; i++) {
    cum *= SURVIVAL[i];
    out.push((rtp / cum));
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
