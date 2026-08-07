// Mission / lobby generation: picks a location, matching team, mission type
// and subtype, an operation name, and a simulated-multiplayer bot roster.

import { TEAMS, LOCATIONS, DOMAIN_TEAM, MISSION_TYPES, CALLSIGNS, RANKS, OP_ADJ, OP_NOUN, DECISIONS, GAME } from './config.js';
import { makeRng, randomSeed } from './rng.js';

let lobbyCounter = 4200 + Math.floor(Math.random() * 900);

export function generateMission(seed = randomSeed()) {
  const rng = makeRng(seed);
  const location = rng.pick(Object.values(LOCATIONS));
  const team = TEAMS[DOMAIN_TEAM[location.domain]];
  const type = rng.pick(Object.values(MISSION_TYPES));
  const subtype = rng.pick(type.subtypes);
  const opName = `Operation ${rng.pick(OP_ADJ)} ${rng.pick(OP_NOUN)}`;
  const decisions = buildDecisionFlavors(rng, type.id);
  const roster = buildRoster(rng, team);
  lobbyCounter += rng.int(1, 7);
  return {
    seed,
    lobbyId: `SOF-${lobbyCounter}`,
    location,
    team,
    type,
    subtype,
    opName,
    title: `${subtype.toUpperCase()} — ${location.name.toUpperCase()}`,
    brief: type.brief,
    decisions,
    roster
  };
}

function buildDecisionFlavors(rng, typeId) {
  // One option-pair per possible decision point (after steps 1..maxSteps-1).
  const pool = DECISIONS[typeId];
  const out = [];
  for (let i = 0; i < GAME.maxSteps - 1; i++) {
    out.push(rng.pick(pool));
  }
  return out;
}

function buildRoster(rng, team) {
  const names = rng.shuffle(CALLSIGNS).slice(0, GAME.squadSize - 1);
  return names.map((n, i) => ({
    callsign: n,
    rank: rng.pick(RANKS),
    tag: `${team.tag}-${i + 2}`,
    // staggered fake "join" delays for the lobby screen (ms after rotation start)
    joinDelay: 900 + i * rng.int(1500, 3400)
  }));
}
