// Procedural maze-like map generation, chunk-based.
//
// The map is a grid of cells. Each mission segment is built from a random
// "chunk" — winding corridor, split route (two lanes around a divider wall),
// pillared courtyard, or switchback — and ends in a carved 3x3 decision room
// with decoy branches, so the route branches and turns like a real compound
// even though the mission tree is really a line.

import { GAME } from '../config.js';

const key = (x, z) => `${x},${z}`;

export function generateMap(rng, opts = {}) {
  const segments = opts.segments ?? GAME.maxSteps;
  const cellSize = opts.cellSize ?? 6;

  for (let attempt = 0; attempt < 48; attempt++) {
    const map = tryGenerate(rng, segments, cellSize);
    if (map) return map;
  }
  return straightFallback(segments, 5, cellSize);
}

function tryGenerate(rng, segments, cellSize) {
  const b = {
    carved: new Set(),
    path: [],        // ordered spine cells {x, z, seg}
    rooms: [],       // decision room centers {x, z, seg}
    branches: [],    // decoy dead-end cells
    pillars: [],     // uncarved cells fully inside courtyards (render as low cover)
    cur: { x: 0, z: 0 },
    heading: { x: 0, z: 1 }
  };
  carve(b, b.cur.x, b.cur.z);
  b.path.push({ ...b.cur, seg: 0 });

  for (let seg = 1; seg <= segments; seg++) {
    const type = seg === 1
      ? 'corridor'
      : weighted(rng, [['corridor', 0.32], ['split', 0.24], ['courtyard', 0.26], ['switchback', 0.18]]);
    let ok = carveChunk(b, rng, seg, type);
    if (!ok && type !== 'corridor') ok = carveChunk(b, rng, seg, 'corridor');
    if (!ok) return null;
    if (!carveDecisionRoom(b, rng, seg, seg < segments)) return null;
  }

  const start = b.path[0];
  const end = b.rooms[b.rooms.length - 1];

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const c of b.carved) {
    const [x, z] = c.split(',').map(Number);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  const carved = b.carved;
  return {
    carved, path: b.path, rooms: b.rooms, branches: b.branches, pillars: b.pillars,
    start, end, cellSize, segments,
    bounds: { minX, maxX, minZ, maxZ },
    toWorld: (x, z) => ({ x: x * cellSize, z: z * cellSize }),
    cellAt: (wx, wz) => ({ x: Math.round(wx / cellSize), z: Math.round(wz / cellSize) }),
    isCarved: (x, z) => carved.has(key(x, z)),
    segOfCell: makeSegLookup(b.path)
  };
}

// ------------------------------------------------------------------ chunks

function carveChunk(b, rng, seg, type) {
  switch (type) {
    case 'split': return carveSplit(b, rng, seg);
    case 'courtyard': return carveCourtyard(b, rng, seg);
    case 'switchback': return carveSwitchback(b, rng, seg);
    case 'corridor':
    default: return carveCorridor(b, rng, seg);
  }
}

// Winding 1-wide corridor via non-self-touching walk.
function carveCorridor(b, rng, seg) {
  const len = rng.int(4, 6);
  for (let i = 0; i < len; i++) {
    const step = nextStep(b, rng);
    if (!step) return i >= 3; // a slightly short corridor is acceptable
    b.heading = step.dir;
    b.cur = { x: step.x, z: step.z };
    carve(b, b.cur.x, b.cur.z);
    b.path.push({ ...b.cur, seg });
  }
  return true;
}

// Two parallel lanes around an uncarved divider wall; forks then rejoins.
function carveSplit(b, rng, seg) {
  const h = b.heading;
  const s = { x: h.z, z: -h.x };
  const L = rng.int(4, 6);
  const cells = [];
  // footprint: lateral -2..2, forward 1..L+1 (+1 margin all around, minus entrance)
  if (!frameFree(b, h, s, -2, 2, 1, L + 2)) return false;

  const at = (f, lat) => ({ x: b.cur.x + h.x * f + s.x * lat, z: b.cur.z + h.z * f + s.z * lat });
  const junctionIn = at(1, 0);
  const junctionOut = at(L + 1, 0);
  cells.push(junctionIn);
  for (let i = 2; i <= L; i++) {
    cells.push(at(i, -1), at(i, 1));
  }
  cells.push(junctionOut);

  for (const c of cells) carve(b, c.x, c.z);
  // spine: entry junction, left lane, right lane, exit junction
  b.path.push({ ...junctionIn, seg });
  for (let i = 2; i <= L; i++) b.path.push({ ...at(i, -1), seg });
  for (let i = 2; i <= L; i++) b.path.push({ ...at(i, 1), seg });
  b.path.push({ ...junctionOut, seg });
  b.cur = junctionOut;
  return true;
}

// 5x5 open courtyard with 4 pillar cells; exit forward, left, or right.
function carveCourtyard(b, rng, seg) {
  const h = b.heading;
  const s = { x: h.z, z: -h.x };
  // center 3 cells ahead; footprint lateral -2..2, forward 1..5
  if (!frameFree(b, h, s, -3, 3, 1, 6)) return false;
  const center = { x: b.cur.x + h.x * 3, z: b.cur.z + h.z * 3 };

  for (let df = -2; df <= 2; df++) {
    for (let dl = -2; dl <= 2; dl++) {
      const x = center.x + h.x * df + s.x * dl;
      const z = center.z + h.z * df + s.z * dl;
      const pillar = Math.abs(df) === 1 && Math.abs(dl) === 1;
      if (pillar) {
        b.pillars.push({ x, z });
      } else {
        carve(b, x, z);
      }
    }
  }

  // choose exit direction: forward / left / right
  const exits = rng.shuffle([h, s, { x: -s.x, z: -s.z }]);
  let exitDir = null, exitCur = null;
  for (const e of exits) {
    const c = { x: center.x + e.x * 3, z: center.z + e.z * 3 };
    if (!b.carved.has(key(c.x, c.z)) && sideClear(b, center, e)) { exitDir = e; exitCur = c; break; }
  }
  if (!exitDir) return false;
  carve(b, exitCur.x, exitCur.z);

  // spine through the yard
  b.path.push({ x: b.cur.x + h.x, z: b.cur.z + h.z, seg });
  b.path.push({ x: b.cur.x + h.x * 2, z: b.cur.z + h.z * 2, seg });
  b.path.push({ x: center.x + s.x, z: center.z + s.z, seg });
  b.path.push({ x: center.x - s.x, z: center.z - s.z, seg });
  b.path.push({ ...center, seg });
  b.path.push({ x: center.x + exitDir.x * 2, z: center.z + exitDir.z * 2, seg });
  b.path.push({ ...exitCur, seg });
  b.cur = exitCur;
  b.heading = exitDir;
  return true;
}

// S-shaped zigzag: forward, jog to one side, forward, jog back.
function carveSwitchback(b, rng, seg) {
  const h = b.heading;
  const side = rng.chance(0.5) ? { x: h.z, z: -h.x } : { x: -h.z, z: h.x };
  const back = { x: -side.x, z: -side.z };
  const jog = rng.int(2, 3);
  const dirs = [h, ...Array(jog).fill(side), h, h, ...Array(jog).fill(back), h];
  const saved = snapshot(b);
  for (const d of dirs) {
    const x = b.cur.x + d.x, z = b.cur.z + d.z;
    if (!okToCarve(b, x, z, b.cur)) { restore(b, saved); return false; }
    b.cur = { x, z };
    b.heading = d;
    carve(b, x, z);
    b.path.push({ x, z, seg });
  }
  b.heading = h;
  return true;
}

// ------------------------------------------------------- decision rooms

function carveDecisionRoom(b, rng, seg, withDecoys) {
  const h = b.heading;
  const roomFwd = { x: b.cur.x + h.x, z: b.cur.z + h.z };
  const room = { x: roomFwd.x + h.x, z: roomFwd.z + h.z, seg };
  if (!roomClear(b, room, b.cur)) return false;
  carve(b, roomFwd.x, roomFwd.z);
  b.path.push({ ...roomFwd, seg });
  const roomCells = new Set();
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      carve(b, room.x + dx, room.z + dz);
      roomCells.add(key(room.x + dx, room.z + dz));
    }
  }
  b.path.push({ ...room, seg });
  b.rooms.push(room);

  if (withDecoys) {
    // 1-2 decoy branches off the room, length 2-4, sometimes ending in a pocket
    const sides = rng.shuffle([
      { x: h.z, z: -h.x }, { x: -h.z, z: h.x }, { x: -h.x, z: -h.z }
    ]);
    const nDecoys = rng.chance(0.55) ? 2 : 1;
    for (let d = 0; d < nDecoys && d < sides.length; d++) {
      carveDecoy(b, rng, sides[d], room, roomCells);
    }

    // continue main path out the far side of the room — the room spans
    // room±1, so the first fresh cell is two out from the center
    b.cur = { x: room.x + h.x * 2, z: room.z + h.z * 2 };
    if (b.carved.has(key(b.cur.x, b.cur.z))) return false;
    carve(b, b.cur.x, b.cur.z);
    b.path.push({ ...b.cur, seg });
  }
  return true;
}

function carveDecoy(b, rng, dir, room, allowed) {
  let prev = { x: room.x + dir.x, z: room.z + dir.z }; // room edge cell (carved)
  let cur = { x: room.x + dir.x * 2, z: room.z + dir.z * 2 };
  const len = rng.int(2, 4);
  let heading = dir;
  for (let i = 0; i < len; i++) {
    if (!decoyOk(b, cur.x, cur.z, prev, allowed)) return;
    carve(b, cur.x, cur.z);
    b.branches.push({ ...cur });
    prev = cur;
    // decoys can bend too
    if (rng.chance(0.35)) {
      heading = rng.chance(0.5) ? { x: heading.z, z: -heading.x } : { x: -heading.z, z: heading.x };
    }
    cur = { x: cur.x + heading.x, z: cur.z + heading.z };
  }
  // occasional 2x2 dead-end pocket, reads like a real side room
  if (rng.chance(0.5)) {
    const s = { x: heading.z, z: -heading.x };
    const pocket = [
      cur, { x: cur.x + s.x, z: cur.z + s.z },
      { x: cur.x + heading.x, z: cur.z + heading.z },
      { x: cur.x + heading.x + s.x, z: cur.z + heading.z + s.z }
    ];
    const allowedPocket = new Set([...allowed, key(prev.x, prev.z)]);
    for (const p of pocket) allowedPocket.add(key(p.x, p.z));
    if (pocket.every((p) => decoyOk(b, p.x, p.z, prev, allowedPocket))) {
      for (const p of pocket) {
        carve(b, p.x, p.z);
        b.branches.push({ ...p });
      }
    }
  }
}

// ------------------------------------------------------------- helpers

function carve(b, x, z) { b.carved.add(key(x, z)); }

function snapshot(b) {
  return { carvedSize: null, added: [], cur: { ...b.cur }, heading: { ...b.heading }, pathLen: b.path.length, carvedCopy: new Set(b.carved) };
}
function restore(b, s) {
  b.carved = s.carvedCopy;
  b.cur = s.cur;
  b.heading = s.heading;
  b.path.length = s.pathLen;
}

// Non-self-touching constraint for 1-wide passages: the candidate may not
// touch any carved cell except the one we came from and cells hugging it
// (its own predecessor chain) — that exception is what makes turns legal.
function okToCarve(b, x, z, from) {
  if (b.carved.has(key(x, z))) return false;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) continue;
      const nx = x + dx, nz = z + dz;
      if (!b.carved.has(key(nx, nz))) continue;
      if (Math.abs(nx - from.x) <= 1 && Math.abs(nz - from.z) <= 1) continue;
      return false;
    }
  }
  return true;
}

function decoyOk(b, x, z, prev, allowed) {
  if (b.carved.has(key(x, z))) return false;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) continue;
      const k = key(x + dx, z + dz);
      if (b.carved.has(k) && k !== key(prev.x, prev.z) && !allowed.has(k)) return false;
    }
  }
  return true;
}

// Rect in (forward, lateral) frame around b.cur must be entirely uncarved.
function frameFree(b, h, s, latMin, latMax, fwdMin, fwdMax) {
  for (let f = fwdMin; f <= fwdMax; f++) {
    for (let l = latMin; l <= latMax; l++) {
      const x = b.cur.x + h.x * f + s.x * l;
      const z = b.cur.z + h.z * f + s.z * l;
      if (b.carved.has(key(x, z))) return false;
    }
  }
  return true;
}

// Space beyond a courtyard exit must be open enough to keep walking.
function sideClear(b, center, e) {
  for (let f = 3; f <= 5; f++) {
    for (let l = -1; l <= 1; l++) {
      const x = center.x + e.x * f + e.z * l;
      const z = center.z + e.z * f - e.x * l;
      if (b.carved.has(key(x, z))) return false;
    }
  }
  return true;
}

function nextStep(b, rng) {
  const h = b.heading;
  const side1 = { x: h.z, z: -h.x };
  const side2 = { x: -h.z, z: h.x };
  let order;
  const r = rng.next();
  if (r < 0.45) order = [h, side1, side2];
  else if (r < 0.725) order = [side1, h, side2];
  else order = [side2, h, side1];
  for (const dir of order) {
    const x = b.cur.x + dir.x, z = b.cur.z + dir.z;
    if (okToCarve(b, x, z, b.cur)) return { x, z, dir };
  }
  return null;
}

function roomClear(b, room, from) {
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      const x = room.x + dx, z = room.z + dz;
      if (!b.carved.has(key(x, z))) continue;
      // cells hugging the entry (the chunk we just left) are fine
      if (Math.abs(x - from.x) <= 1 && Math.abs(z - from.z) <= 1) continue;
      return false;
    }
  }
  return true;
}

function weighted(rng, entries) {
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let r = rng.next() * total;
  for (const [v, w] of entries) {
    r -= w;
    if (r <= 0) return v;
  }
  return entries[entries.length - 1][0];
}

function makeSegLookup(path) {
  const m = new Map();
  for (const p of path) {
    const k = key(p.x, p.z);
    if (!m.has(k)) m.set(k, p.seg);
  }
  return (x, z) => m.get(key(x, z));
}

function straightFallback(segments, segLen, cellSize) {
  const carved = new Set();
  const path = [];
  const rooms = [];
  let z = 0;
  for (let seg = 0; seg <= segments; seg++) {
    const n = seg === 0 ? 1 : segLen + 2;
    for (let i = 0; i < n; i++) {
      carved.add(key(0, z));
      path.push({ x: 0, z, seg });
      z++;
    }
    if (seg > 0) {
      const room = { x: 0, z: z - 1, seg };
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) carved.add(key(room.x + dx, room.z + dz));
      rooms.push(room);
    }
  }
  const start = path[0];
  return {
    carved, path, rooms, branches: [], pillars: [], start, end: rooms[rooms.length - 1],
    cellSize, segments,
    bounds: { minX: -1, maxX: 1, minZ: 0, maxZ: z },
    toWorld: (x, zz) => ({ x: x * cellSize, z: zz * cellSize }),
    cellAt: (wx, wz) => ({ x: Math.round(wx / cellSize), z: Math.round(wz / cellSize) }),
    isCarved: (x, zz) => carved.has(key(x, zz)),
    segOfCell: makeSegLookup(path)
  };
}
