// Bake vegetation / prop FBX packs into a compact runtime binary.
//
// Each pack file holds one or more model variants (five palms, three firs…).
// This script splits packs into variants, colours them per part (the sources
// ship with white materials or TGA textures we don't load), welds + decimates
// with meshoptimizer, ground-anchors and metre-scales each variant, and
// writes public/models/props.bin (JSON header + typed binary sections) that
// src/game/props.js parses.
//
// Usage: npm run bake:props

globalThis.window = globalThis;
const fakeEl = () => ({ style: {}, addEventListener: () => {}, removeEventListener: () => {}, setAttribute: () => {}, getContext: () => null });
globalThis.document = { createElementNS: fakeEl, createElement: fakeEl };

import fs from 'node:fs';
const THREE = await import('three');
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
const { MeshoptSimplifier } = await import('meshoptimizer');

const OUT = 'public/models/props.bin';
await MeshoptSimplifier.ready;

const BARK = 0x6e5236;
const BARK_DARK = 0x54402c;
const PALM_LEAF = 0x4f7c3a;
const PALM_LEAF_ALT = 0x446e31;
const FIR_LEAF = 0x3d6044;
const LEAFY_LEAF = 0x49692e;
const BUSH_LEAF = 0x3f5e2e;
const CACTUS = 0x4c7a3c;

function loadFbx(file) {
  const buf = fs.readFileSync(file);
  const obj = file.endsWith('.obj')
    ? new OBJLoader().parse(buf.toString('utf8'))
    : new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  obj.updateMatrixWorld(true);
  return obj;
}

const meshesOf = (obj) => {
  const out = [];
  obj.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.position) out.push(o); });
  return out;
};

const bboxOf = (mesh) => {
  mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
};

// hash → small deterministic tint variation per part
function tint(hex, seedStr, amount = 0.05) {
  let h = 0;
  for (const ch of seedStr) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const v = ((h % 1000) / 1000 - 0.5) * 2 * amount;
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, v);
  return c;
}

// Gather one variant's meshes into flat triangle soup with per-vertex colours.
// colorFor(mesh, materialIndex) -> THREE.Color
// `unit` converts the source's units to cm BEFORE welding — the 0.5cm weld
// grid destroys metre-unit sources otherwise.
function soup(meshes, colorFor, unit = 1) {
  const pos = [], col = [];
  const v = new THREE.Vector3();
  for (const mesh of meshes) {
    const g = mesh.geometry;
    const p = g.attributes.position;
    const idx = g.index;
    const triCount = idx ? idx.count / 3 : p.count / 3;
    const groups = g.groups?.length ? g.groups : [{ start: 0, count: (idx ? idx.count : p.count), materialIndex: 0 }];
    for (const grp of groups) {
      const c = colorFor(mesh, grp.materialIndex);
      const end = grp.start + grp.count;
      for (let i = grp.start; i < end; i++) {
        const vi = idx ? idx.getX(i) : i;
        v.fromBufferAttribute(p, vi).applyMatrix4(mesh.matrixWorld).multiplyScalar(unit);
        pos.push(v.x, v.y, v.z);
        col.push(c.r, c.g, c.b);
      }
    }
    void triCount;
  }
  return { pos, col };
}

// Weld triangle soup by quantized position + colour, then simplify to
// targetTris. Returns flat compacted soup (pos/col per vertex + indices).
function weldSimplify({ pos, col }, targetTris, err = 0.08, allowSloppy = true) {
  const Q = 2; // 0.5cm in source units (cm)
  const keyToIndex = new Map();
  const wp = [], wc = [];
  const indices = [];
  for (let i = 0; i < pos.length / 3; i++) {
    const key = `${Math.round(pos[i * 3] * Q)},${Math.round(pos[i * 3 + 1] * Q)},${Math.round(pos[i * 3 + 2] * Q)},${(col[i * 3] * 255) | 0},${(col[i * 3 + 1] * 255) | 0},${(col[i * 3 + 2] * 255) | 0}`;
    let vi = keyToIndex.get(key);
    if (vi === undefined) {
      vi = wp.length / 3;
      keyToIndex.set(key, vi);
      wp.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      wc.push(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]);
    }
    indices.push(vi);
  }
  const positions = Float32Array.from(wp);
  let idx = Uint32Array.from(indices);
  const srcTris = idx.length / 3;
  if (srcTris > targetTris) {
    const target = Math.min(targetTris * 3, idx.length);
    idx = MeshoptSimplifier.simplify(idx, positions, 3, target, err, [])[0];
    // foliage is usually disconnected card-soup the topological simplifier
    // can't collapse (every card edge is a locked border) — fall back to
    // sloppy positional clustering to actually hit the budget
    if (allowSloppy && idx.length / 3 > targetTris * 1.5) {
      idx = MeshoptSimplifier.simplifySloppy(idx, positions, 3, null, target, 1e30)[0];
    }
  }
  // compact: keep only referenced vertices
  const remap = new Map();
  const cp = [], cc = [];
  const ci = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) {
    let ni = remap.get(idx[i]);
    if (ni === undefined) {
      ni = cp.length / 3;
      remap.set(idx[i], ni);
      cp.push(positions[idx[i] * 3], positions[idx[i] * 3 + 1], positions[idx[i] * 3 + 2]);
      cc.push(wc[idx[i] * 3], wc[idx[i] * 3 + 1], wc[idx[i] * 3 + 2]);
    }
    ci[i] = ni;
  }
  return { srcTris, pos: cp, col: cc, idx: ci };
}

// Merge one or more welded parts, ground-anchor, compute normals, package.
function finalizeVariant(name, parts, srcTris = null) {
  const cp = [], cc = [], ciArr = [];
  let base = 0;
  for (const part of parts) {
    cp.push(...part.pos);
    cc.push(...part.col);
    for (const i of part.idx) ciArr.push(i + base);
    base += part.pos.length / 3;
  }
  const ci = Uint32Array.from(ciArr);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
  geo.setIndex(new THREE.BufferAttribute(ci, 1));
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) - cx, p.getY(i) - bb.min.y, p.getZ(i) - cz);
  }
  geo.computeVertexNormals();
  const height = bb.max.y - bb.min.y;
  const radius = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2;
  console.log(`  ${name}: ${srcTris} → ${ci.length / 3} tris, ${p.count} verts, h=${(height / 100).toFixed(2)}m`);
  return {
    name,
    positions: new Float32Array(p.array),
    normals: new Float32Array(geo.attributes.normal.array),
    colors: Uint8Array.from(cc.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255))),
    indices: ci,
    height, radius
  };
}

// One-call pipeline for regular packs.
function bakeVariant(name, meshes, colorFor, targetTris, err = 0.08, allowSloppy = true, unit = 1) {
  const part = weldSimplify(soup(meshes, colorFor, unit), targetTris, err, allowSloppy);
  return finalizeVariant(name, [part], part.srcTris);
}

// Cluster a foliage mesh's vertices on a coarse grid and emit low-poly
// blobs matching the needle distribution. Hair-thin needle geometry cannot
// survive decimation (it thins into invisible slivers), so the crown is
// rebuilt as an impostor cloud that keeps the real tree's silhouette.
function foliageBlobs(mesh, baseHex, { cell = 70, maxBlobs = 110, minCount = 6 } = {}) {
  const p = mesh.geometry.attributes.position;
  const v = new THREE.Vector3();
  const cells = new Map();
  const step = Math.max(1, Math.floor(p.count / 60000));
  for (let i = 0; i < p.count; i += step) {
    v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
    const key = `${Math.floor(v.x / cell)},${Math.floor(v.y / cell)},${Math.floor(v.z / cell)}`;
    let c = cells.get(key);
    if (!c) {
      c = { n: 0, min: new THREE.Vector3(Infinity, Infinity, Infinity), max: new THREE.Vector3(-Infinity, -Infinity, -Infinity) };
      cells.set(key, c);
    }
    c.n++;
    c.min.min(v);
    c.max.max(v);
  }
  const list = [...cells.values()].filter((c) => c.n >= minCount).sort((a, b) => b.n - a.n).slice(0, maxBlobs);
  const ico = new THREE.IcosahedronGeometry(1, 0); // non-indexed, 60 verts
  const ip = ico.attributes.position;
  const pos = [], col = [];
  const minSize = new THREE.Vector3(cell * 0.75, cell * 0.6, cell * 0.75);
  for (const c of list) {
    const ctr = c.min.clone().add(c.max).multiplyScalar(0.5);
    const size = c.max.clone().sub(c.min).multiplyScalar(0.95).max(minSize);
    const tc = tint(baseHex, `${ctr.x | 0},${ctr.y | 0},${ctr.z | 0}`, 0.05);
    for (let i = 0; i < ip.count; i++) {
      pos.push(ip.getX(i) * size.x + ctr.x, ip.getY(i) * size.y + ctr.y, ip.getZ(i) * size.z + ctr.z);
      col.push(tc.r, tc.g, tc.b);
    }
  }
  return { pos, col };
}

// Scale a baked variant's positions by s (also scales height/radius).
function scaleVariant(v, s) {
  for (let i = 0; i < v.positions.length; i++) v.positions[i] *= s;
  v.height *= s;
  v.radius *= s;
}

const variantsByKind = {};

// ------------------------------------------------------------------ palms
{
  console.log('palms:');
  const obj = loadFbx('assets-src/props/palms.fbx');
  const meshes = meshesOf(obj);
  const trunks = meshes.filter((m) => m.name.toLowerCase().startsWith('tronco'));
  const leaves = meshes.filter((m) => m.name.toLowerCase().startsWith('foglie'));
  const center = (m) => bboxOf(m).getCenter(new THREE.Vector3());
  const out = [];
  trunks.forEach((t, i) => {
    const tc = center(t);
    let best = null, bestD = Infinity;
    for (const l of leaves) {
      const lc = center(l);
      const d = (lc.x - tc.x) ** 2 + (lc.z - tc.z) ** 2;
      if (d < bestD) { bestD = d; best = l; }
    }
    const colorFor = (mesh, mi) =>
      mesh.name.toLowerCase().startsWith('tronco')
        ? tint(BARK, mesh.name)
        : tint(mi % 2 === 0 ? PALM_LEAF : PALM_LEAF_ALT, mesh.name + mi);
    out.push(bakeVariant(`palm${i}`, best ? [t, best] : [t], colorFor, 1400));
  });
  const maxH = Math.max(...out.map((v) => v.height));
  for (const v of out) scaleVariant(v, 420 / maxH); // tallest → 4.2m after cm→m
  variantsByKind.palm = out;
}

// ------------------------------------------------------------------- firs
{
  console.log('firs:');
  const obj = loadFbx('assets-src/props/firs.fbx');
  const roots = obj.children.filter((c) => c.isMesh && c.name.startsWith('tree'));
  const out = roots.map((root, i) => {
    // real (decimated) trunk + impostor-blob crown sampled from the needle
    // mesh — the needles themselves are hair-thin and vanish if decimated
    const leaves = meshesOf(root).filter((m) => m.name.startsWith('leaves'));
    const trunk = weldSimplify(soup([root], (mesh) => tint(BARK_DARK, mesh.name)), 2600, 0.25, true);
    const crown = leaves.map((l) => weldSimplify(foliageBlobs(l, FIR_LEAF), Infinity));
    return finalizeVariant(`fir${i}`, [trunk, ...crown]);
  });
  const maxH = Math.max(...out.map((v) => v.height));
  for (const v of out) scaleVariant(v, 780 / maxH);
  variantsByKind.fir = out;
}

// ------------------------------------------------------------------ leafy
{
  console.log('leafy:');
  const obj = loadFbx('assets-src/props/leafy.fbx');
  const meshes = meshesOf(obj);
  const colorFor = (mesh, mi) => {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const mname = (mats[mi]?.name ?? '').toLowerCase();
    return mname.includes('trunk') || mname.includes('bark')
      ? tint(BARK, mname)
      : tint(LEAFY_LEAF, mname + mi, 0.03);
  };
  const v = bakeVariant('leafy0', meshes, colorFor, 2600);
  scaleVariant(v, 330 / v.height);
  variantsByKind.leafy = [v];
}

// ------------------------------------------------------------------- bush
{
  console.log('bush:');
  const obj = loadFbx('assets-src/props/bush.fbx');
  const meshes = meshesOf(obj);
  const colorFor = (mesh) => tint(BUSH_LEAF, mesh.name, 0.06);
  const v = bakeVariant('bush0', meshes, colorFor, 1600);
  scaleVariant(v, 120 / v.height);
  variantsByKind.bush = [v];
}

// ------------------------------------------------------------------ cacti
{
  console.log('cacti:');
  const obj = loadFbx('assets-src/props/cacti.fbx');
  const meshes = meshesOf(obj).sort((a, b) => a.name.localeCompare(b.name));
  const out = meshes.map((m, i) => {
    const colorFor = (mesh) => tint(CACTUS, mesh.name, 0.05);
    return bakeVariant(`cactus${i}`, [m], colorFor, 700);
  });
  const maxH = Math.max(...out.map((v) => v.height));
  for (const v of out) scaleVariant(v, 240 / maxH);
  variantsByKind.cactus = out;
}

// --------------------------------------------------------------- barriers
{
  console.log('barriers:');
  const obj = loadFbx('assets-src/props/barriers.obj');
  // one scene, uniform scale: the standard jersey barrier (4.6 units tall)
  // maps to 1.1m, which sizes every other item plausibly
  const SCALE = 24;
  const COLORS = {
    warning_sing: 0xc9a542, warning_sign_back: 0xc9a542,
    wall_barrier: 0xb2ac9e, wall_barrier_painted: 0xa8a294,
    stick: 0xb5584a,
    short_barrier: 0xb2ac9e, short_barrier_painted: 0xaba590, short_barrier_signed: 0xb2ac9e,
    'None.002': 0xb2ac9e, // pyramid block
    fenced_barrier: 0x8a9094,
    None: 0xd2622e, 'None.001': 0xd2622e, 'None.003': 0xd2622e, 'None.004': 0xd2622e, // cones
    barrier: 0xb8b2a4, barrier_painted: 0xb2544c
  };
  const out = [];
  for (const mesh of meshesOf(obj)) {
    if (mesh.name === 'fence') continue; // 2-tri backdrop quad, not a prop
    const colorFor = (m, mi) => {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      return tint(COLORS[mats[mi]?.name] ?? 0xb2ac9e, m.name, 0.04);
    };
    const v = bakeVariant(`barrier:${mesh.name.slice(0, 24)}`, [mesh], colorFor, 900, 0.08, true, SCALE);
    out.push(v);
  }
  variantsByKind.barrier = out;
}

// ---------------------------------------------------------------- debris
{
  console.log('debris:');
  const obj = loadFbx('assets-src/props/debris.fbx');
  const DEBRIS_COLORS = {
    brick2: 0x9a8f80, stone1: 0x8a8272, plank1: 0x7c6248,
    stick1: 0x6b5638, aiStandardSurface1: 0xa8a49a, Default_Material: 0x8f8a7e
  };
  // curated top-level groups: each is a ready-made rubble pile; the
  // sprawling showcase rows (group1/6/26) are skipped
  // group2 (stacked concrete pipes) reads as construction, not rubble —
  // it joins the barrier kind instead
  const PILES = ['group3', 'group10', 'group11', 'group14', 'group19', 'group29', 'group18', 'group28', 'group31'];
  const out = [];
  for (const name of ['group2']) {
    const root = obj.children.find((c) => c.name === name);
    if (!root) continue;
    const v = bakeVariant('barrier:pipes', meshesOf(root), () => tint(0xa8a49a, name, 0.05), 1600, 0.08, true, 18);
    scaleVariant(v, Math.min(260 / (v.radius * 2), 170 / v.height));
    variantsByKind.barrier.push(v);
  }
  for (const name of PILES) {
    const root = obj.children.find((c) => c.name === name);
    if (!root) continue;
    const meshes = meshesOf(root);
    const colorFor = (m, mi) => {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      return tint(DEBRIS_COLORS[mats[mi]?.name] ?? 0x8f8a7e, m.name, 0.06);
    };
    const v = bakeVariant(`debris:${name}`, meshes, colorFor, 1600, 0.08, true, 18);
    // normalize footprint to ~2.6m, but never taller than 1.8m
    const foot = v.radius * 2;
    scaleVariant(v, Math.min(260 / foot, 180 / v.height));
    out.push(v);
  }
  variantsByKind.debris = out;
}

// --------------------------------------------------------- sandbag walls
{
  console.log('sandbags:');
  const obj = loadFbx('assets-src/props/sandbags.fbx');
  const meshes = meshesOf(obj);
  const KHAKI = 0x9a8a64;
  // the source bags are open thin shells (2.5k tris each) that shred under
  // decimation — rebuild each bag as an oriented plump blob instead, keeping
  // the pack's exact stacking layout
  const ico = new THREE.IcosahedronGeometry(1, 1); // 80 faces, reads as a stuffed bag
  const ip = ico.attributes.position;
  const bagSoup = (group, unit) => {
    const pos = [], col = [];
    const v = new THREE.Vector3();
    for (const mesh of group) {
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      const ctr = bb.getCenter(new THREE.Vector3());
      const half = bb.getSize(new THREE.Vector3()).multiplyScalar(0.5 * 0.96);
      const tc = tint(KHAKI, mesh.name, 0.07);
      for (let i = 0; i < ip.count; i++) {
        v.set(ip.getX(i) * half.x + ctr.x, ip.getY(i) * half.y + ctr.y, ip.getZ(i) * half.z + ctr.z)
          .applyMatrix4(mesh.matrixWorld)
          .multiplyScalar(unit);
        pos.push(v.x, v.y, v.z);
        col.push(tc.r, tc.g, tc.b);
      }
    }
    return { pos, col };
  };
  const out = [];
  for (const shape of ['straight', 'round', 'corner']) {
    const group = meshes.filter((m) => m.name.includes(`_${shape}_`));
    if (group.length === 0) continue;
    const part = weldSimplify(bagSoup(group, 100), Infinity);
    const v = finalizeVariant(`sandbag:${shape}`, [part], part.srcTris);
    scaleVariant(v, 1.3); // chest-high cover
    out.push(v);
  }
  variantsByKind.sandbag = out;
}

// ---------------------------------------------------------------- statues
{
  console.log('statues:');
  const obj = loadFbx('assets-src/props/statues.fbx');
  const STONE = 0x9aa0a4, BRONZE = 0x6e6a4e;
  const out = [];
  for (const mesh of meshesOf(obj)) {
    const hex = mesh.name.includes('bull') || mesh.name.includes('lion') ? BRONZE : STONE;
    const v = bakeVariant(`statue:${mesh.name}`, [mesh], (m) => tint(hex, m.name, 0.03), 2800, 0.08, true, 5);
    scaleVariant(v, 230 / v.height);
    out.push(v);
  }
  variantsByKind.statue = out;
}

// --------------------------------------------------------------- fountain
{
  console.log('fountain:');
  const obj = loadFbx('assets-src/props/fountain.fbx');
  const meshes = meshesOf(obj);
  const colorFor = (m, mi) => {
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    return tint((mats[mi]?.name ?? '').includes('Water') ? 0x7ab2c4 : 0x8d9296, m.name, 0.02);
  };
  const v = bakeVariant('fountain0', meshes, colorFor, 4200);
  scaleVariant(v, 300 / (v.radius * 2)); // ~3m basin so it fits a lane edge
  variantsByKind.fountain = [v];
}

// ------------------------------------------- objective set-pieces
{
  console.log('objectives:');
  // AA gun — long quad-barrel cannon, olive drab
  {
    const obj = loadFbx('assets-src/props/aa.fbx');
    const v = bakeVariant('aa0', meshesOf(obj), (m) => tint(0x4f5638, m.name, 0.05), 3200);
    scaleVariant(v, 280 / (v.radius * 2)); // ~2.8m cannon; the runtime mounts it
    variantsByKind.aa = [v];
  }
  // mortar + ammo, gunmetal tube / olive shells
  {
    const obj = loadFbx('assets-src/props/mortar.fbx');
    const colorFor = (m) => {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      return tint((mats[0]?.name ?? '').includes('phong') ? 0x6f6534 : 0x42463e, m.name, 0.04);
    };
    const v = bakeVariant('mortar0', meshesOf(obj), colorFor, 3000);
    scaleVariant(v, 265 / (v.radius * 2));
    variantsByKind.mortar = [v];
  }
  // diesel generator, olive drab
  {
    const obj = loadFbx('assets-src/props/generator.fbx');
    const v = bakeVariant('generator0', meshesOf(obj), (m) => tint(0x565c40, m.name, 0.03), 2600);
    scaleVariant(v, 115 / v.height);
    variantsByKind.generator = [v];
  }
  // satellite uplink dish, pale gray
  {
    const obj = loadFbx('assets-src/props/satdish.obj');
    const v = bakeVariant('comms0', meshesOf(obj), (m) => tint(0xb4b8bc, m.name, 0.02), 2800);
    scaleVariant(v, 235 / v.height);
    variantsByKind.comms = [v];
  }
  // weapons crate — the runtime stacks a few into a cache
  {
    const obj = loadFbx('assets-src/props/cache.fbx');
    const CRATE = { Wood: 0x71603c, Metal_1: 0x43484c, Metal_2: 0x2e3236, Decal: 0x933227 };
    const colorFor = (m, mi) => {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      return tint(CRATE[mats[mi]?.name] ?? 0x71603c, m.name + mi, 0.03);
    };
    const v = bakeVariant('cache0', meshesOf(obj), colorFor, 2400);
    scaleVariant(v, 1.08);
    variantsByKind.cache = [v];
  }
}

// ------------------------------------------------------- convert cm → m
for (const kind of Object.keys(variantsByKind)) {
  for (const v of variantsByKind[kind]) scaleVariant(v, 0.01);
}

// ------------------------------------------------------------------ write
const sections = [];
const header = { kinds: {} };
let offset = 0;
const align4 = (n) => (n + 3) & ~3;
const pushSection = (name, arr) => {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  const off = offset;
  sections.push({ bytes });
  offset = align4(offset + bytes.byteLength);
  return { off, len: bytes.byteLength };
};

for (const [kind, list] of Object.entries(variantsByKind)) {
  header.kinds[kind] = list.map((v) => ({
    name: v.name,
    verts: v.positions.length / 3,
    tris: v.indices.length / 3,
    height: +v.height.toFixed(3),
    radius: +v.radius.toFixed(3),
    p: pushSection(v.name + ':p', v.positions),
    n: pushSection(v.name + ':n', v.normals),
    c: pushSection(v.name + ':c', v.colors),
    i: pushSection(v.name + ':i', v.indices)
  }));
}

const headerJson = Buffer.from(JSON.stringify(header));
const headerLen = align4(headerJson.length);
const total = 8 + headerLen + offset;
const out = Buffer.alloc(total);
out.write('SOFP', 0, 'ascii');
out.writeUInt32LE(headerLen, 4);
headerJson.copy(out, 8);
{
  const base = 8 + headerLen;
  let o = 0;
  for (const s of sections) {
    out.set(s.bytes, base + o);
    o = align4(o + s.bytes.byteLength);
  }
}
fs.writeFileSync(OUT, out);
const totalTris = Object.values(variantsByKind).flat().reduce((a, v) => a + v.indices.length / 3, 0);
console.log(`\nwrote ${OUT}: ${(total / 1024).toFixed(0)}KB, ${totalTris} total tris across ${Object.values(variantsByKind).flat().length} variants`);
