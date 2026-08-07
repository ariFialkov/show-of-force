// Procedural maze-like map generation.
//
// The map is a grid of cells. A non-self-touching random walk carves the
// main mission path, split into `maxSteps` segments. Each segment ends in a
// carved 3x3 "decision room" with a short decoy branch, so the player always
// sees a believable fork even though the mission tree is really a line.

import { GAME } from '../config.js';

const DIRS = [
  { x: 0, z: 1 }, { x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: -1 }
];

const key = (x, z) => `${x},${z}`;

export function generateMap(rng, opts = {}) {
  const segments = opts.segments ?? GAME.maxSteps;
  const segLen = opts.segLen ?? 5;
  const cellSize = opts.cellSize ?? 6;

  for (let attempt = 0; attempt < 24; attempt++) {
    const map = tryGenerate(rng, segments, segLen, cellSize);
    if (map) return map;
  }
  // Extremely unlikely fallback: straight-line corridor.
  return straightFallback(segments, segLen, cellSize);
}

function tryGenerate(rng, segments, segLen, cellSize) {
  const carved = new Set();     // all walkable cells
  const path = [];              // ordered main-path cells {x, z, seg}
  const rooms = [];             // decision room centers {x, z, seg}
  const branches = [];          // decoy dead-end cells

  let cur = { x: 0, z: 0 };
  let heading = { x: 0, z: 1 };
  carve(carved, cur.x, cur.z);
  path.push({ ...cur, seg: 0 });

  const okToCarve = (x, z, from) => {
    if (carved.has(key(x, z))) return false;
    // Keep corridors from touching earlier corridors (8-neighborhood),
    // ignoring the cell we came from — this is what keeps it maze-like.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        const k = key(x + dx, z + dz);
        if (carved.has(k) && k !== key(from.x, from.z)) return false;
      }
    }
    return true;
  };

  for (let seg = 1; seg <= segments; seg++) {
    const len = segLen + rng.int(-1, 1);
    for (let i = 0; i < len; i++) {
      const step = nextStep(rng, cur, heading, okToCarve);
      if (!step) return null;
      heading = step.dir;
      cur = { x: step.x, z: step.z };
      carve(carved, cur.x, cur.z);
      path.push({ ...cur, seg });
    }

    // Decision room (skip after final segment — that's the exfil pad instead).
    const roomFwd = { x: cur.x + heading.x, z: cur.z + heading.z };
    const room = { x: roomFwd.x + heading.x, z: roomFwd.z + heading.z, seg };
    if (!roomClear(carved, room, cur)) return null;
    carve(carved, roomFwd.x, roomFwd.z);
    path.push({ ...roomFwd, seg });
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        carve(carved, room.x + dx, room.z + dz);
      }
    }
    path.push({ ...room, seg });
    rooms.push(room);

    if (seg < segments) {
      // Decoy branch out one side of the room.
      const side = rng.chance(0.5)
        ? { x: heading.z, z: -heading.x }
        : { x: -heading.z, z: heading.x };
      let b = { x: room.x + side.x * 2, z: room.z + side.z * 2 };
      for (let i = 0; i < rng.int(1, 2); i++) {
        if (!carved.has(key(b.x, b.z))) {
          carve(carved, b.x, b.z);
          branches.push({ ...b });
        }
        b = { x: b.x + side.x, z: b.z + side.z };
      }
      // Continue walk from the far edge of the room.
      cur = { x: room.x + heading.x, z: room.z + heading.z };
      if (carved.has(key(cur.x, cur.z))) return null;
      carve(carved, cur.x, cur.z);
      path.push({ ...cur, seg });
    }
  }

  const start = path[0];
  const end = rooms[rooms.length - 1];

  // Bounds
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const c of carved) {
    const [x, z] = c.split(',').map(Number);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  return {
    carved, path, rooms, branches, start, end, cellSize, segments,
    bounds: { minX, maxX, minZ, maxZ },
    toWorld: (x, z) => ({ x: x * cellSize, z: z * cellSize }),
    cellAt: (wx, wz) => ({ x: Math.round(wx / cellSize), z: Math.round(wz / cellSize) }),
    isCarved: (x, z) => carved.has(key(x, z)),
    segOfCell: makeSegLookup(path)
  };
}

function makeSegLookup(path) {
  const m = new Map();
  for (const p of path) {
    const k = key(p.x, p.z);
    if (!m.has(k)) m.set(k, p.seg);
  }
  return (x, z) => m.get(key(x, z));
}

function nextStep(rng, cur, heading, okToCarve) {
  // Prefer continuing straight, sometimes turn; never reverse.
  const side1 = { x: heading.z, z: -heading.x };
  const side2 = { x: -heading.z, z: heading.x };
  let order;
  const r = rng.next();
  if (r < 0.55) order = [heading, side1, side2];
  else if (r < 0.775) order = [side1, heading, side2];
  else order = [side2, heading, side1];
  for (const dir of order) {
    const x = cur.x + dir.x, z = cur.z + dir.z;
    if (okToCarve(x, z, cur)) return { x, z, dir };
  }
  return null;
}

function roomClear(carved, room, from) {
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      const k = key(room.x + dx, room.z + dz);
      if (carved.has(k) && k !== key(from.x, from.z)) return false;
    }
  }
  return true;
}

function carve(set, x, z) { set.add(key(x, z)); }

function straightFallback(segments, segLen, cellSize) {
  const carved = new Set();
  const path = [];
  const rooms = [];
  let z = 0;
  for (let seg = 0; seg <= segments; seg++) {
    const n = seg === 0 ? 1 : segLen + 2;
    for (let i = 0; i < n; i++) {
      carve(carved, 0, z);
      path.push({ x: 0, z, seg });
      z++;
    }
    if (seg > 0) {
      const room = { x: 0, z: z - 1, seg };
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) carve(carved, room.x + dx, room.z + dz);
      rooms.push(room);
    }
  }
  const start = path[0];
  return {
    carved, path, rooms, branches: [], start, end: rooms[rooms.length - 1],
    cellSize, segments,
    bounds: { minX: -1, maxX: 1, minZ: 0, maxZ: z },
    toWorld: (x, zz) => ({ x: x * cellSize, z: zz * cellSize }),
    cellAt: (wx, wz) => ({ x: Math.round(wx / cellSize), z: Math.round(wz / cellSize) }),
    isCarved: (x, zz) => carved.has(key(x, zz)),
    segOfCell: makeSegLookup(path)
  };
}
