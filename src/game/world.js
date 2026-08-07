// Builds the themed 3D environment from a generated map + location env spec.

import * as THREE from 'three';

const lambert = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });

// --------------------------------------------------- procedural textures
//
// Tiny canvas-generated tiling textures give surfaces grain and detail at
// near-zero memory/GPU cost (a handful of 128px textures per world).

function noiseTexture(hex, { speckle = 0.14, patches = 10, lines = 0 } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const col = new THREE.Color(hex);
  ctx.fillStyle = `#${col.getHexString()}`;
  ctx.fillRect(0, 0, 128, 128);
  // broad tonal patches
  for (let i = 0; i < patches; i++) {
    const v = (Math.random() - 0.5) * 0.16;
    const p = col.clone().offsetHSL(0, 0, v);
    ctx.fillStyle = `rgba(${p.r * 255 | 0},${p.g * 255 | 0},${p.b * 255 | 0},0.5)`;
    ctx.beginPath();
    ctx.ellipse(Math.random() * 128, Math.random() * 128, 18 + Math.random() * 34, 12 + Math.random() * 26, Math.random() * 3, 0, 7);
    ctx.fill();
  }
  // fine speckle
  for (let i = 0; i < 900; i++) {
    const v = (Math.random() - 0.5) * speckle;
    const p = col.clone().offsetHSL(0, 0, v);
    ctx.fillStyle = `#${p.getHexString()}`;
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 1.6, 1.6);
  }
  // horizontal courses (mud-brick / plank feel)
  for (let i = 0; i < lines; i++) {
    const y = (i + 0.5) * (128 / lines);
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.fillRect(0, y, 128, 1.4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function buildingTexture(hex, night) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const col = new THREE.Color(hex);
  ctx.fillStyle = `#${col.getHexString()}`;
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 500; i++) {
    const v = (Math.random() - 0.5) * 0.12;
    ctx.fillStyle = `#${col.clone().offsetHSL(0, 0, v).getHexString()}`;
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  // window rows
  for (let row = 0; row < 4; row++) {
    for (let colI = 0; colI < 4; colI++) {
      const lit = night && Math.random() < 0.3;
      ctx.fillStyle = lit ? 'rgba(255,214,140,0.9)' : 'rgba(10,12,14,0.55)';
      ctx.fillRect(14 + colI * 28, 16 + row * 28, 12, 16);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function gradientSkyTexture(topHex, horizonHex) {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#' + new THREE.Color(topHex).getHexString());
  grad.addColorStop(0.62, '#' + new THREE.Color(topHex).lerp(new THREE.Color(horizonHex), 0.55).getHexString());
  grad.addColorStop(1, '#' + new THREE.Color(horizonHex).getHexString());
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 128);
  return new THREE.CanvasTexture(c);
}

function sunTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,252,238,1)');
  grad.addColorStop(0.25, 'rgba(255,240,200,0.85)');
  grad.addColorStop(1, 'rgba(255,236,190,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export function buildWorld(scene, map, env, rng) {
  const group = new THREE.Group();
  group.name = 'world';

  scene.background = new THREE.Color(env.sky);
  scene.fog = new THREE.FogExp2(env.fog, env.fogDensity);

  // ---- lights
  const hemi = new THREE.HemisphereLight(env.hemi, env.hemiGround, env.night ? 0.55 : 0.9);
  const sun = new THREE.DirectionalLight(env.sun, env.sunIntensity);
  sun.position.set(40, 70, 25);
  group.add(hemi, sun);

  // ---- sky dome + sun impostor (fog-immune, so the horizon reads as haze)
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(340, 20, 12),
    new THREE.MeshBasicMaterial({
      map: gradientSkyTexture(env.sky, env.fog),
      side: THREE.BackSide,
      fog: false,
      depthWrite: false
    })
  );
  skyDome.name = 'skyDome';
  skyDome.renderOrder = -2;
  group.add(skyDome);
  if (!env.night) {
    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sunTexture(), fog: false, transparent: true, depthWrite: false
    }));
    sunSprite.scale.setScalar(90);
    sunSprite.position.set(140, 200, 90);
    sunSprite.name = 'sunSprite';
    group.add(sunSprite);
  }

  // ---- ground
  const S = map.cellSize;
  const { minX, maxX, minZ, maxZ } = map.bounds;
  const spanX = (maxX - minX + 24) * S;
  const spanZ = (maxZ - minZ + 24) * S;
  const cx = ((minX + maxX) / 2) * S;
  const cz = ((minZ + maxZ) / 2) * S;
  const groundColor = env.snow ? 0xd8dde2 : env.ground;
  const groundTex = noiseTexture(groundColor, { speckle: 0.2, patches: 14 });
  groundTex.repeat.set(spanX / 11, spanZ / 11);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(spanX, spanZ, 1, 1),
    new THREE.MeshLambertMaterial({ color: 0xffffff, map: groundTex })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, 0, cz);
  group.add(ground);

  // subtle path tint on carved cells
  const pathGeo = new THREE.PlaneGeometry(S, S);
  const pathMat = lambert(shade(groundColor, 0.92));
  const pathMesh = new THREE.InstancedMesh(pathGeo, pathMat, map.carved.size);
  const dummy = new THREE.Object3D();
  let pi = 0;
  for (const c of map.carved) {
    const [x, z] = c.split(',').map(Number);
    dummy.position.set(x * S, 0.02, z * S);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.updateMatrix();
    pathMesh.setMatrixAt(pi++, dummy.matrix);
  }
  group.add(pathMesh);

  // ---- walls along carved-cell edges facing uncarved cells
  const wallH = 3.1;
  const wallGeo = new THREE.BoxGeometry(S, wallH, 0.7);
  const wallTex = noiseTexture(0xffffff, { speckle: 0.1, patches: 8, lines: 5 });
  const wallMat = new THREE.MeshLambertMaterial({ color: env.wall, map: wallTex });
  const pillarSet = new Set((map.pillars ?? []).map((p) => `${p.x},${p.z}`));
  const edges = collectWallEdges(map, pillarSet);
  const walls = new THREE.InstancedMesh(wallGeo, wallMat, edges.length);
  const wallTint = new THREE.Color();
  edges.forEach((e, i) => {
    dummy.position.set(e.x, wallH / 2, e.z);
    dummy.rotation.set(0, e.rotY, 0);
    // vary height a touch so skylines aren't perfectly flat
    const n = ((e.x * 7 + e.z * 13) % 10 + 10) % 10;
    const s = 0.85 + n / 33;
    dummy.scale.set(1.02, s, 1);
    dummy.updateMatrix();
    walls.setMatrixAt(i, dummy.matrix);
    // subtle per-segment tint variation breaks up the uniformity
    walls.setColorAt(i, wallTint.set(0xffffff).offsetHSL(0, 0, (n - 5) / 90));
  });
  if (walls.instanceColor) walls.instanceColor.needsUpdate = true;
  // a coping lip along the top of every wall segment
  const copingGeo = new THREE.BoxGeometry(S * 1.04, 0.22, 0.92);
  const copingMat = lambert(env.wallAlt);
  const coping = new THREE.InstancedMesh(copingGeo, copingMat, edges.length);
  edges.forEach((e, i) => {
    const n = ((e.x * 7 + e.z * 13) % 10 + 10) % 10;
    const s = 0.85 + n / 33;
    dummy.position.set(e.x, wallH * s, e.z);
    dummy.rotation.set(0, e.rotY, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    coping.setMatrixAt(i, dummy.matrix);
  });
  group.add(walls, coping);

  // ---- courtyard pillars: low cover blocks instead of full walls
  if (pillarSet.size > 0) {
    const coverGeo = new THREE.BoxGeometry(S * 0.62, 1.35, S * 0.62);
    const coverMat = lambert(env.wallAlt);
    for (const p of map.pillars) {
      const c = new THREE.Mesh(coverGeo, coverMat);
      c.position.set(p.x * S, 0.68, p.z * S);
      group.add(c);
    }
  }

  // ---- fortress perimeter: outer wall ring, corner towers, entry gate
  buildPerimeter(group, map, env);

  // ---- watchtowers overlooking the route
  buildWatchtowers(group, map, env, rng);

  // ---- buildings / skyline beyond the walls, clustered into blocks
  const buildingMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: buildingTexture(env.building, env.night) });
  const buildingMatAlt = new THREE.MeshLambertMaterial({ color: 0xffffff, map: buildingTexture(env.wallAlt, env.night) });
  const anchors = pickBuildingCells(map, rng, 60);
  for (const b of anchors) {
    const cluster = rng.int(1, 3);
    for (let ci = 0; ci < cluster; ci++) {
      const h = rng.range(3.0, env.night ? 9 : 7) * (ci === 0 ? 1 : 0.7);
      const w = rng.range(0.6, 1.1) * S;
      const d = rng.range(0.6, 1.1) * S;
      const ox = ci === 0 ? 0 : rng.pick([-1, 1]) * S * rng.range(0.6, 0.95);
      const oz = ci === 0 ? 0 : rng.pick([-1, 1]) * S * rng.range(0.6, 0.95);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), rng.chance(0.5) ? buildingMat : buildingMatAlt);
      m.position.set(b.x * S + ox + rng.range(-1, 1), h / 2, b.z * S + oz + rng.range(-1, 1));
      m.rotation.y = rng.range(-0.06, 0.06);
      group.add(m);
      if (env.night && rng.chance(0.4)) {
        const win = new THREE.Mesh(
          new THREE.PlaneGeometry(0.7, 0.9),
          new THREE.MeshBasicMaterial({ color: 0xffd98a })
        );
        win.position.set(m.position.x, rng.range(1.5, Math.max(1.6, h - 1)), m.position.z + d / 2 + 0.02);
        group.add(win);
      }
    }
  }

  // ---- props scattered inside corridors and rooms
  scatterProps(group, map, env, rng);

  // ---- water plane for coastal maps
  if (env.water) {
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(spanX * 3, spanZ * 3),
      lambert(env.night ? 0x1d2b36 : 0x33566b, { transparent: true, opacity: 0.94 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(cx, -0.35, cz);
    group.add(water);
    ground.position.y = 0.001; // keep land above water
  }

  // ---- extraction pad at the final room
  const endW = map.toWorld(map.end.x, map.end.z);
  const pad = new THREE.Mesh(new THREE.CircleGeometry(S * 0.9, 24), lambert(0x2a2f2a));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(endW.x, 0.03, endW.z);
  const padRing = new THREE.Mesh(
    new THREE.RingGeometry(S * 0.72, S * 0.86, 24),
    new THREE.MeshBasicMaterial({ color: 0x7dffa0, side: THREE.DoubleSide, transparent: true, opacity: 0.65 })
  );
  padRing.rotation.x = -Math.PI / 2;
  padRing.position.set(endW.x, 0.05, endW.z);
  padRing.name = 'exfilRing';
  group.add(pad, padRing);

  scene.add(group);
  return group;
}

function collectWallEdges(map, pillarSet = new Set()) {
  const S = map.cellSize;
  const edges = [];
  const solid = (x, z) => !map.isCarved(x, z) && !pillarSet.has(`${x},${z}`);
  for (const c of map.carved) {
    const [x, z] = c.split(',').map(Number);
    if (solid(x, z + 1)) edges.push({ x: x * S, z: z * S + S / 2, rotY: 0 });
    if (solid(x, z - 1)) edges.push({ x: x * S, z: z * S - S / 2, rotY: 0 });
    if (solid(x + 1, z)) edges.push({ x: x * S + S / 2, z: z * S, rotY: Math.PI / 2 });
    if (solid(x - 1, z)) edges.push({ x: x * S - S / 2, z: z * S, rotY: Math.PI / 2 });
  }
  return edges;
}

// Outer fortress wall with corner towers and a gate on the side the squad
// drives in from (the insertion vehicle approaches behind the start cell).
function buildPerimeter(group, map, env) {
  const S = map.cellSize;
  const M = 4; // margin in cells
  const x0 = (map.bounds.minX - M) * S, x1 = (map.bounds.maxX + M) * S;
  const z0 = (map.bounds.minZ - M) * S, z1 = (map.bounds.maxZ + M) * S;
  const h = 4.8, t = 1.4;
  const mat = lambert(env.wallAlt);

  // approach direction = behind the first path step
  const a = map.path[0], b2 = map.path[1] ?? a;
  const dir = { x: Math.sign(b2.x - a.x), z: Math.sign(b2.z - a.z) };
  const gate = { x: a.x * S, z: a.z * S };
  const gap = S * 1.6;

  const seg = (cx, cz, len, horizontal) => {
    if (len <= 0.01) return;
    const m = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? len : t, h, horizontal ? t : len), mat);
    m.position.set(cx, h / 2, cz);
    group.add(m);
  };

  // each side; the side facing the approach gets a gate gap
  const sides = [
    { horizontal: true, fixed: z0, gateHere: dir.z > 0, gateAt: gate.x, from: x0, to: x1 },
    { horizontal: true, fixed: z1, gateHere: dir.z < 0, gateAt: gate.x, from: x0, to: x1 },
    { horizontal: false, fixed: x0, gateHere: dir.x > 0, gateAt: gate.z, from: z0, to: z1 },
    { horizontal: false, fixed: x1, gateHere: dir.x < 0, gateAt: gate.z, from: z0, to: z1 }
  ];
  for (const s of sides) {
    const place = (from, to) => {
      const len = to - from;
      const mid = (from + to) / 2;
      if (s.horizontal) seg(mid, s.fixed, len, true);
      else seg(s.fixed, mid, len, false);
    };
    if (s.gateHere) {
      place(s.from, s.gateAt - gap);
      place(s.gateAt + gap, s.to);
      // gate pillars
      for (const off of [-gap, gap]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(1.6, h + 1.2, 1.6), mat);
        if (s.horizontal) p.position.set(s.gateAt + off, (h + 1.2) / 2, s.fixed);
        else p.position.set(s.fixed, (h + 1.2) / 2, s.gateAt + off);
        group.add(p);
      }
    } else {
      place(s.from, s.to);
    }
  }

  // corner towers
  for (const [cx, cz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
    const tower = new THREE.Mesh(new THREE.BoxGeometry(3.4, 7.2, 3.4), mat);
    tower.position.set(cx, 3.6, cz);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.9, 4.2), lambert(env.wall));
    cap.position.set(cx, 7.4, cz);
    group.add(tower, cap);
  }
}

function buildWatchtowers(group, map, env, rng) {
  const S = map.cellSize;
  const count = rng.int(3, 5);
  const legMat = lambert(0x4a4438);
  const cabMat = lambert(env.wallAlt);
  let placed = 0;
  for (let i = 0; i < count * 6 && placed < count; i++) {
    const p = rng.pick(map.path);
    const dx = rng.pick([-2, -3, 2, 3]), dz = rng.pick([-2, -3, 2, 3]);
    const x = p.x + dx, z = p.z + dz;
    if (map.isCarved(x, z)) continue;
    let touching = false;
    for (let ax = -1; ax <= 1 && !touching; ax++) {
      for (let az = -1; az <= 1; az++) {
        if (map.isCarved(x + ax, z + az)) { touching = true; break; }
      }
    }
    if (touching) continue; // keep legs clear of the lanes
    const g = new THREE.Group();
    for (const [lx, lz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 5.2, 0.22), legMat);
      leg.position.set(lx, 2.6, lz);
      g.add(leg);
    }
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.5, 2.6), cabMat);
    cab.position.y = 5.6;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.3, 3.1), legMat);
    roof.position.y = 6.6;
    g.add(cab, roof);
    g.position.set(x * S, 0, z * S);
    g.rotation.y = rng.range(0, Math.PI * 2);
    group.add(g);
    placed++;
  }
}

function pickBuildingCells(map, rng, count) {
  const out = [];
  const tried = new Set();
  const pathArr = map.path;
  for (let i = 0; i < count * 3 && out.length < count; i++) {
    const p = rng.pick(pathArr);
    const dx = rng.int(-4, 4), dz = rng.int(-4, 4);
    if (Math.abs(dx) < 2 && Math.abs(dz) < 2) continue;
    const x = p.x + dx, z = p.z + dz;
    const k = `${x},${z}`;
    if (tried.has(k) || map.isCarved(x, z)) continue;
    // don't butt directly against a corridor cell
    let touching = false;
    for (let ax = -1; ax <= 1 && !touching; ax++) {
      for (let az = -1; az <= 1; az++) {
        if (map.isCarved(x + ax, z + az)) { touching = true; break; }
      }
    }
    tried.add(k);
    if (!touching) out.push({ x, z });
  }
  return out;
}

// ------------------------------------------------------------------ props

function scatterProps(group, map, env, rng) {
  const S = map.cellSize;
  const cells = [...map.carved];
  const propCount = Math.min(70, Math.floor(cells.length * 0.8));
  for (let i = 0; i < propCount; i++) {
    const c = rng.pick(cells);
    const [x, z] = c.split(',').map(Number);
    const type = rng.pick(env.props);
    const prop = makeProp(type, env, rng);
    if (!prop) continue;
    // hug corridor edges so the lane stays walkable
    const ox = rng.chance(0.5) ? rng.range(1.8, 2.4) : rng.range(-2.4, -1.8);
    const oz = rng.range(-2.0, 2.0);
    prop.position.set(x * S + ox, 0, z * S + oz);
    prop.rotation.y = rng.range(0, Math.PI * 2);
    group.add(prop);
  }
}

function makeProp(type, env, rng) {
  const g = new THREE.Group();
  switch (type) {
    case 'palm': {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 2.6, 6), lambert(0x7a5c38));
      trunk.position.y = 1.3;
      g.add(trunk);
      for (let i = 0; i < 5; i++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.5, 4), lambert(0x4d7a3a));
        leaf.position.y = 2.65;
        leaf.rotation.z = Math.PI / 2.4;
        leaf.rotation.y = (i / 5) * Math.PI * 2;
        leaf.translateY(0.55);
        g.add(leaf);
      }
      return g;
    }
    case 'tree': {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 1.6, 6), lambert(0x54402a));
      trunk.position.y = 0.8;
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(rng.range(1.0, 1.6), 0), lambert(0x39562c));
      crown.position.y = 2.2;
      g.add(trunk, crown);
      return g;
    }
    case 'pine': {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.0, 6), lambert(0x4a3826));
      trunk.position.y = 0.5;
      g.add(trunk);
      for (let i = 0; i < 3; i++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(1.0 - i * 0.26, 1.1, 7), lambert(env.snow ? 0x40584a : 0x2f4a34));
        cone.position.y = 1.2 + i * 0.7;
        g.add(cone);
      }
      return g;
    }
    case 'fern': {
      for (let i = 0; i < 6; i++) {
        const blade = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.9, 4), lambert(0x4a6e33));
        blade.position.y = 0.4;
        blade.rotation.z = rng.range(-0.7, 0.7);
        blade.rotation.y = (i / 6) * Math.PI * 2;
        g.add(blade);
      }
      return g;
    }
    case 'rock': {
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(rng.range(0.5, 1.1), 0), lambert(env.snow ? 0x9aa4ac : 0x8a8272));
      rock.position.y = 0.35;
      rock.scale.y = 0.7;
      g.add(rock);
      return g;
    }
    case 'crate': {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), lambert(0x6e5c3a));
      c.position.y = 0.45;
      g.add(c);
      if (rng.chance(0.5)) {
        const c2 = c.clone();
        c2.position.set(0.5, 0.4, 0.4);
        c2.scale.setScalar(0.8);
        g.add(c2);
      }
      return g;
    }
    case 'barrel': {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.95, 10), lambert(rng.chance(0.5) ? 0x5d3a2a : 0x3a4a56));
      b.position.y = 0.48;
      g.add(b);
      return g;
    }
    case 'container': {
      const c = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 1.1), lambert(rng.pick([0x7a3b30, 0x2f5d6b, 0x6b6b32])));
      c.position.y = 0.6;
      g.add(c);
      return g;
    }
    case 'hedge': {
      const h = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.0, 0.6), lambert(0x2f4a30));
      h.position.y = 0.5;
      g.add(h);
      return g;
    }
    case 'lamp': {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 6), lambert(0x22262a));
      pole.position.y = 1.6;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe9b0 }));
      bulb.position.y = 3.2;
      g.add(pole, bulb);
      return g;
    }
    case 'statue': {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.8), lambert(0x777d82));
      base.position.y = 0.25;
      const fig = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.4, 6), lambert(0x8b9196));
      fig.position.y = 1.2;
      g.add(base, fig);
      return g;
    }
    case 'cactus': {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 1.7, 8), lambert(0x4c7a3c));
      c.position.y = 0.85;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.7, 6), lambert(0x4c7a3c));
      arm.position.set(0.3, 1.0, 0);
      arm.rotation.z = -0.6;
      g.add(c, arm);
      return g;
    }
    case 'awning': {
      const posts = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.1, 5), lambert(0x6b5335));
      posts.position.set(-0.8, 1.05, 0);
      const posts2 = posts.clone(); posts2.position.x = 0.8;
      const cloth = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.06, 1.4), lambert(rng.pick([0x9c4c3a, 0x8a7a3a, 0x5c7a8a])));
      cloth.position.y = 2.1;
      cloth.rotation.z = 0.12;
      g.add(posts, posts2, cloth);
      return g;
    }
    case 'tent': {
      const t = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.2, 4), lambert(0x51584a));
      t.position.y = 0.6;
      t.rotation.y = Math.PI / 4;
      g.add(t);
      return g;
    }
    case 'antenna': {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 4.4, 5), lambert(0x3a3f45));
      m.position.y = 2.2;
      const dish = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6, 0, Math.PI), lambert(0x8a9096));
      dish.position.y = 3.6;
      dish.rotation.x = Math.PI / 2.3;
      g.add(m, dish);
      return g;
    }
    case 'dune': {
      const d = new THREE.Mesh(new THREE.SphereGeometry(rng.range(1.6, 2.6), 8, 6), lambert(0xd8b478));
      d.position.y = -rng.range(0.9, 1.4);
      d.scale.y = 0.5;
      g.add(d);
      return g;
    }
    case 'hut': {
      const walls = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.95, 1.1, 8), lambert(0x77613f));
      walls.position.y = 0.55;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.8, 8), lambert(0x8a7a4a));
      roof.position.y = 1.5;
      g.add(walls, roof);
      return g;
    }
    default:
      return null;
  }
}

function shade(hex, mult) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(mult);
  return c;
}
