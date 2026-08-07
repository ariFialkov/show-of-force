// Mission / lobby generation: picks a location, matching team, mission type
// and subtype, an operation name, a step count, an objective arc tailored to
// the mission type, and a simulated-multiplayer bot roster.

import { TEAMS, LOCATIONS, DOMAIN_TEAM, MISSION_TYPES, CALLSIGNS, RANKS, OP_ADJ, OP_NOUN, OBJECTIVE_ARCS, APPROACH, GAME } from './config.js';
import { makeRng, randomSeed } from './rng.js';

let lobbyCounter = 4200 + Math.floor(Math.random() * 900);

export function generateMission(seed = randomSeed()) {
  const rng = makeRng(seed);
  const location = rng.pick(Object.values(LOCATIONS));
  const team = TEAMS[DOMAIN_TEAM[location.domain]];
  const type = rng.pick(Object.values(MISSION_TYPES));
  const subtype = rng.pick(type.subtypes);
  const opName = `Operation ${rng.pick(OP_ADJ)} ${rng.pick(OP_NOUN)}`;
  const steps = rng.int(type.steps[0], type.steps[1]);
  const objectives = buildObjectives(rng, type.id, steps);
  const decisions = buildDecisions(rng, objectives);
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
    steps,
    title: `${subtype.toUpperCase()} — ${location.name.toUpperCase()}`,
    brief: type.brief,
    objectives,
    decisions,
    roster
  };
}

// Assemble the mission's objective sequence from its arc: a scripted
// opening, a middle drawn from the type's pool (no immediate repeats,
// last third leaning on the 'late' pool), and a scripted finale. The
// elimination arc guarantees the HVT kill lands right before the finale.
function buildObjectives(rng, typeId, steps) {
  const arc = OBJECTIVE_ARCS[typeId];
  const out = [];
  out.push(rng.pick(arc.open));
  const midCount = steps - 2;
  const used = new Set([out[0].title]);
  for (let i = 0; i < midCount; i++) {
    const inLateThird = (i + 2) / steps > 0.62;
    const pool = inLateThird && arc.late.length > 0 ? [...arc.late, ...arc.mid] : arc.mid;
    let objPick = null;
    for (let tries = 0; tries < 10; tries++) {
      const cand = rng.pick(pool);
      if (!used.has(cand.title)) { objPick = cand; break; }
    }
    objPick = objPick ?? rng.pick(pool);
    out.push(objPick);
    used.add(objPick.title);
  }
  if (typeId === 'elimination' && steps >= 2) {
    out[steps - 2] = arc.late[0]; // the HVT kill is always the penultimate step
  }
  out.push(rng.pick(arc.final));
  return out.slice(0, steps);
}

// Decision at checkpoint i previews objective i+1 — the two options are
// approaches to the fight that's actually coming.
function buildDecisions(rng, objectives) {
  return objectives.slice(1).map((obj) => {
    const pair = rng.pick(APPROACH[obj.mech] ?? APPROACH.sweep);
    return [{ t: pair[0] }, { t: pair[1] }];
  });
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
