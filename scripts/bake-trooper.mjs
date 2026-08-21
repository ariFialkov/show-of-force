// Bake the Mixamo trooper FBX into a compact runtime binary.
//
// The raw export is unusable directly in-game: 55 skinned parts, ~418k
// triangles, nested duplicate bones, 15.6MB of FBX. This script merges the
// parts onto one canonical skeleton, welds + decimates the mesh with
// meshoptimizer, quantizes attributes, and writes public/models/trooper.bin
// (JSON header + typed binary sections) that src/game/rigged.js parses.
//
// Usage: npm run bake:trooper [-- path/to/source.fbx] [targetTris]

globalThis.window = globalThis;
const fakeEl = () => ({ style: {}, addEventListener: () => {}, removeEventListener: () => {}, setAttribute: () => {}, getContext: () => null });
globalThis.document = { createElementNS: fakeEl, createElement: fakeEl };

import fs from 'node:fs';
import path from 'node:path';
const THREE = await import('three');
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
const { MeshoptSimplifier } = await import('meshoptimizer');

const SRC = process.argv[2] ?? 'assets-src/trooper.fbx';
const OUT = 'public/models/trooper.bin';
const TARGET_TRIS = Number(process.argv[3] ?? 42000);

const buf = fs.readFileSync(SRC);
const loader = new FBXLoader();
const obj = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
obj.updateMatrixWorld(true);

// ---------------------------------------------------------------- skeleton

let bestRoot = null, bestCount = -1;
obj.traverse((o) => {
  if (o.isBone && !(o.parent && o.parent.isBone)) {
    let n = 0;
    o.traverse(() => n++);
    if (n > bestCount) { bestCount = n; bestRoot = o; }
  }
});
if (!bestRoot) throw new Error('no skeleton in ' + SRC);

// dedupe nested duplicate bones: first occurrence per name wins, hierarchy
// rebuilt from bind-pose world matrices
const boneOrder = [];
const boneIndexByName = new Map();
bestRoot.traverse((b) => {
  if (b.isBone && !boneIndexByName.has(b.name)) {
    boneIndexByName.set(b.name, boneOrder.length);
    boneOrder.push(b);
  }
});
if (boneOrder.length > 255) throw new Error('more than 255 bones');

const meshes = [];
obj.traverse((o) => { if (o.isSkinnedMesh && o.geometry.attributes.position.count > 0) meshes.push(o); });
const inverseByName = new Map();
for (const m of meshes) {
  m.skeleton.bones.forEach((b, i) => {
    if (!inverseByName.has(b.name)) inverseByName.set(b.name, m.skeleton.boneInverses[i].clone());
  });
}

const bones = boneOrder.map((b, i) => {
  let p = b.parent;
  while (p && p.isBone && !boneIndexByName.has(p.name)) p = p.parent;
  const parentIndex = p && p.isBone ? boneIndexByName.get(p.name) : -1;
  const local = new THREE.Matrix4().copy(b.matrixWorld);
  if (parentIndex >= 0) {
    local.premultiply(new THREE.Matrix4().copy(boneOrder[parentIndex].matrixWorld).invert());
  }
  const inverse = inverseByName.get(b.name) ?? new THREE.Matrix4().copy(b.matrixWorld).invert();
  return { name: b.name, parentIndex, local: [...local.elements], inverse: [...inverse.elements] };
});

const headBone = boneOrder.find((b) => b.name.endsWith('Head'));
const headY = headBone ? new THREE.Vector3().setFromMatrixPosition(headBone.matrixWorld).y : 0;

// ------------------------------------------------------------------- merge

const ZONE = { KIT: 0, KIT_D: 1, WEB: 2, HELMET: 3, SKIN: 4, HAND: 5, BOOT: 6, GEAR: 7 };
function zoneFor(boneName, y) {
  const n = boneName.replace('mixamorig', '');
  if (/Hand|Thumb|Index|Middle|Ring|Pinky/.test(n)) return ZONE.HAND;
  if (/Foot|Toe/.test(n)) return ZONE.BOOT;
  if (/ForeArm/.test(n)) return ZONE.KIT_D;
  if (/Shoulder/.test(n)) return ZONE.WEB;
  if (/Arm/.test(n)) return ZONE.KIT;
  if (/Head/.test(n)) return y > headY + 1.1 ? ZONE.HELMET : ZONE.SKIN;
  if (/Neck/.test(n)) return ZONE.SKIN;
  if (/Spine1|Spine2/.test(n)) return ZONE.WEB;
  if (/Spine|Hips/.test(n)) return ZONE.KIT;
  if (/UpLeg/.test(n)) return ZONE.KIT;
  if (/Leg/.test(n)) return ZONE.KIT_D;
  return ZONE.KIT;
}

// Per-part zone overrides (part order in the FBX is stable; names are junk
// like "Cube018" but each garment/limb/device is its own part). Mapped by
// inspecting T-pose bounding boxes: torso/limb armor -> KIT, the helmet
// shell -> HELMET, hands + fingers + neck/lower face -> bare SKIN,
// goggles/antenna/small devices -> GEAR (black), belt ring -> webbing.
// -1 = fall through to the per-bone zoneFor.
const PART_ZONE = new Array(meshes.length).fill(-1);
const setZones = (zone, idxs) => { for (const i of idxs) PART_ZONE[i] = zone; };
setZones(ZONE.BOOT, [0, 16, 17, 18, 19, 20, 21, 25, 26, 27, 28, 29, 30]);
setZones(ZONE.SKIN, [1, 36, 38, 39, 40, 41, 42, 48, 49, 50, 51, 52, 53]); // neck/face + hands
setZones(ZONE.GEAR, [4, 9, 11, 31]); // helmet devices, goggles, antenna
setZones(ZONE.WEB, [8]); // belt pouch ring
setZones(ZONE.HELMET, [3]); // helmet shell
setZones(ZONE.KIT, [5, 6, 7, 12, 13, 14, 15, 22, 23, 24, 32, 33, 34, 35, 37, 43, 44, 45, 46, 47]);
// 2 and 10 (head + hood) stay bone/height-driven for the helmet/face split

let total = 0;
for (const m of meshes) total += m.geometry.attributes.position.count;
const position = new Float32Array(total * 3);
const normal = new Float32Array(total * 3);
const skinIndex = new Float32Array(total * 4); // float for mergeVertices hashing
const skinWeight = new Float32Array(total * 4);
const zone = new Float32Array(total);

let offset = 0;
meshes.forEach((m, pi) => {
  const g = m.geometry;
  const n = g.attributes.position.count;
  position.set(g.attributes.position.array, offset * 3);
  normal.set(g.attributes.normal.array, offset * 3);
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const localToCanon = m.skeleton.bones.map((b) => boneIndexByName.get(b.name) ?? 0);
  const partZone = PART_ZONE[pi];
  for (let v = 0; v < n; v++) {
    let domW = -1, domBone = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(v, k);
      const canon = localToCanon[si.getComponent(v, k)];
      skinIndex[(offset + v) * 4 + k] = canon;
      skinWeight[(offset + v) * 4 + k] = w;
      if (w > domW) { domW = w; domBone = canon; }
    }
    zone[offset + v] = partZone >= 0
      ? partZone
      : zoneFor(boneOrder[domBone].name, g.attributes.position.getY(v));
  }
  offset += n;
});
console.log(`merged: ${meshes.length} parts, ${total / 3} tris, ${bones.length} bones`);

// ------------------------------------------------------- weld + simplify

// weld purely by position (quantized) so the simplifier sees connected
// topology — exact attribute hashing merges almost nothing on this export
// because per-face normals differ across smoothing seams. The first vertex
// at each position donates its attributes; averaged normals would be
// slightly nicer but the visual difference is negligible at game distances.
const weldMap = new Map();
const weldRemap = new Uint32Array(total);
const weldSrc = [];
for (let v = 0; v < total; v++) {
  const key = `${Math.round(position[v * 3] * 500)},${Math.round(position[v * 3 + 1] * 500)},${Math.round(position[v * 3 + 2] * 500)}`;
  let idx = weldMap.get(key);
  if (idx === undefined) {
    idx = weldSrc.length;
    weldMap.set(key, idx);
    weldSrc.push(v);
  }
  weldRemap[v] = idx;
}
const weldedCount = weldSrc.length;
console.log(`welded: ${weldedCount} unique verts`);

const welded = {
  attributes: {
    position: { count: weldedCount, array: new Float32Array(weldedCount * 3) },
    normal: { array: new Float32Array(weldedCount * 3) },
    skinIndex: { array: new Float32Array(weldedCount * 4) },
    skinWeight: { array: new Float32Array(weldedCount * 4) },
    zone: { array: new Float32Array(weldedCount) }
  }
};
for (let j = 0; j < weldedCount; j++) {
  const v = weldSrc[j];
  for (let k = 0; k < 3; k++) {
    welded.attributes.position.array[j * 3 + k] = position[v * 3 + k];
    welded.attributes.normal.array[j * 3 + k] = normal[v * 3 + k];
  }
  for (let k = 0; k < 4; k++) {
    welded.attributes.skinIndex.array[j * 4 + k] = skinIndex[v * 4 + k];
    welded.attributes.skinWeight.array[j * 4 + k] = skinWeight[v * 4 + k];
  }
  welded.attributes.zone.array[j] = zone[v];
}

await MeshoptSimplifier.ready;
// drop triangles degenerated by the weld
const idxTmp = [];
for (let t = 0; t < total; t += 3) {
  const a = weldRemap[t], b = weldRemap[t + 1], c = weldRemap[t + 2];
  if (a !== b && b !== c && a !== c) idxTmp.push(a, b, c);
}
const srcIndex = Uint32Array.from(idxTmp);
const pos = welded.attributes.position.array;
const [simplified, simplifyError] = MeshoptSimplifier.simplify(
  srcIndex, pos, 3, TARGET_TRIS * 3, 0.08, []
);
console.log(`simplified: ${simplified.length / 3} tris (error ${simplifyError.toFixed(4)})`);

// compact to used vertices only
const remap = new Int32Array(weldedCount).fill(-1);
let used = 0;
for (const i of simplified) if (remap[i] === -1) remap[i] = used++;
console.log(`compact: ${used} verts`);

const outPos = new Float32Array(used * 3);
const outNorm = new Int8Array(used * 3);
const outSkinIdx = new Uint8Array(used * 4);
const outSkinW = new Uint8Array(used * 4);
const outZone = new Uint8Array(used);
const nrm = welded.attributes.normal.array;
const sIdx = welded.attributes.skinIndex.array;
const sW = welded.attributes.skinWeight.array;
const zn = welded.attributes.zone.array;
for (let i = 0; i < remap.length; i++) {
  const j = remap[i];
  if (j === -1) continue;
  for (let k = 0; k < 3; k++) {
    outPos[j * 3 + k] = pos[i * 3 + k];
    outNorm[j * 3 + k] = Math.max(-127, Math.min(127, Math.round(nrm[i * 3 + k] * 127)));
  }
  // renormalize weights so the quantized set sums to 255
  let sum = 0;
  for (let k = 0; k < 4; k++) sum += sW[i * 4 + k];
  let acc = 0, maxK = 0;
  for (let k = 0; k < 4; k++) {
    const q = sum > 0 ? Math.round((sW[i * 4 + k] / sum) * 255) : (k === 0 ? 255 : 0);
    outSkinIdx[j * 4 + k] = sIdx[i * 4 + k];
    outSkinW[j * 4 + k] = q;
    acc += q;
    if (outSkinW[j * 4 + maxK] < q) maxK = k;
  }
  outSkinW[j * 4 + maxK] += 255 - acc;
  outZone[j] = zn[i];
}
const outIndex = used <= 65535 ? new Uint16Array(simplified.length) : new Uint32Array(simplified.length);
for (let i = 0; i < simplified.length; i++) outIndex[i] = remap[simplified[i]];

let minY = Infinity;
for (let i = 1; i < outPos.length; i += 3) minY = Math.min(minY, outPos[i]);

// -------------------------------------------------------------------- clips

// All Mixamo clips share one unit quirk: the Hips.position track is authored
// in different units than the skeleton bind pose, and it is FLOOR-anchored
// (track y=0 is the ground) while the armature origin sits between hips and
// feet (bind feet at minY < 0). Remap with an affine transform so the
// clip's floor lands exactly on the skeleton's foot plane: scale so the
// standing hip height matches the bind hip-above-feet distance, then shift
// down by the foot depth. Anchoring to the bind hips alone would leave
// low poses (a body lying on the ground) floating by |minY|.
const hipsBone = boneOrder.find((b) => b.name.endsWith('Hips'));
let hipScale = 1;
if (obj.animations[0] && hipsBone) {
  const hipTrack = obj.animations[0].tracks.find((t) => t.name.endsWith('Hips.position'));
  if (hipTrack) {
    let mean = 0; // the trooper's embedded idle stands straight -> standing hip height
    for (let i = 1; i < hipTrack.values.length; i += 3) mean += hipTrack.values[i];
    mean /= hipTrack.values.length / 3;
    if (Math.abs(mean) > 1e-3) hipScale = (hipsBone.position.y - minY) / mean;
  }
}

function bakeClip(name, clipSrc) {
  const tracks = [];
  const data = [];
  for (const tr of clipSrc.tracks) {
    const isQuat = tr.name.endsWith('.quaternion');
    const isHipsPos = tr.name.endsWith('Hips.position');
    if (!isQuat && !isHipsPos) continue;
    const boneName = tr.name.split('.')[0];
    if (!boneIndexByName.has(boneName)) continue; // track for a bone we don't have
    const values = Float32Array.from(tr.values);
    if (isHipsPos) {
      for (let i = 0; i < values.length; i += 3) {
        values[i] *= hipScale;
        values[i + 1] = values[i + 1] * hipScale + minY;
        values[i + 2] *= hipScale;
      }
    }
    tracks.push({ name: tr.name, type: isQuat ? 'quaternion' : 'vector' });
    data.push({ times: Float32Array.from(tr.times), values });
  }
  return { meta: { name, duration: clipSrc.duration, tracks }, data };
}

const clips = [];
if (obj.animations[0]) clips.push(bakeClip('idle', obj.animations[0]));

// additional animation-only FBX exports (same rig, "Without Skin")
const ANIM_DIR = 'assets-src/anims';
if (fs.existsSync(ANIM_DIR)) {
  for (const f of fs.readdirSync(ANIM_DIR).sort()) {
    if (!f.toLowerCase().endsWith('.fbx')) continue;
    const name = f.replace(/\.fbx$/i, '').replace(/^rifle-/, '');
    const abuf = fs.readFileSync(path.join(ANIM_DIR, f));
    const aobj = new FBXLoader().parse(abuf.buffer.slice(abuf.byteOffset, abuf.byteOffset + abuf.byteLength), '');
    if (!aobj.animations[0]) { console.warn(`  ${f}: no animation, skipped`); continue; }
    const baked = bakeClip(name, aobj.animations[0]);
    clips.push(baked);
    console.log(`clip '${name}': ${baked.meta.duration.toFixed(2)}s, ${baked.meta.tracks.length} tracks`);
  }
}

// -------------------------------------------------------------------- gear
// Team headgear from assets-src/gear/: arbitrary FBX/OBJ assets are merged,
// welded, decimated and auto-fitted onto the trooper's measured head box,
// then stored in HEAD-BONE LOCAL space so the runtime simply parents them
// to the head bone. Per-asset fit tweaks below (tuned from screenshots).
const GEAR_DIR = 'assets-src/gear';
// anchor 'top': gear bbox top lands at head-box top + pad (caps/helmets)
// anchor 'center': gear bbox center at head center + dy (face-mounted gear)
// replaceHead: the asset IS a full head (balaclava) — the runtime hides the
// modeled helmet crown underneath via vertex alpha
const GEAR_FIT = {
  'helmet-delta':     { target: 3200, widthRel: 1.38, anchor: 'top', pad: 0.5, rot: [0, 0, 0], dz: 0 },
  'helmet-seal':      { target: 2800, widthRel: 1.08, anchor: 'center', dy: 0.55, rot: [-Math.PI / 2, Math.PI, 0], dz: 1.2 },
  'helmet-beret':     { target: 1600, widthRel: 1.30, anchor: 'top', pad: 0.55, rot: [0, 0, 0], dz: 0 },
  'helmet-balaclava': { target: 2400, widthRel: 1.12, anchor: 'top', pad: 0.25, rot: [0, 0, 0], dz: 0, replaceHead: true }
};

// head box from the final mesh: dominant-weight Head vertices, y-clamped to
// cut the antenna accessory and the neck out of the measurement
const headIdxCanon = boneIndexByName.get('mixamorigHead');
const headBox = new THREE.Box3();
for (let v = 0; v < used; v++) {
  let maxK = 0;
  for (let k = 1; k < 4; k++) if (outSkinW[v * 4 + k] > outSkinW[v * 4 + maxK]) maxK = k;
  if (outSkinIdx[v * 4 + maxK] !== headIdxCanon) continue;
  const y = outPos[v * 3 + 1];
  if (y < headY - 1.5 || y > headY + 3.6) continue;
  headBox.expandByPoint(new THREE.Vector3(outPos[v * 3], y, outPos[v * 3 + 2]));
}
const headSize = new THREE.Vector3();
headBox.getSize(headSize);
const headCenter = new THREE.Vector3();
headBox.getCenter(headCenter);
console.log('head box:', headSize.toArray().map((x) => +x.toFixed(2)), 'center', headCenter.toArray().map((x) => +x.toFixed(2)));

const headWorldInv = new THREE.Matrix4()
  .copy(boneOrder.find((b) => b.name.endsWith('Head')).matrixWorld).invert();

function bakeGearAsset(name, root, cfg) {
  root.updateMatrixWorld(true);
  // merge all meshes into one position soup (world-transformed)
  const soup = [];
  const tv = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const pos = g.attributes.position;
    const push = (vi) => {
      tv.fromBufferAttribute(pos, vi).applyMatrix4(o.matrixWorld);
      soup.push(tv.x, tv.y, tv.z);
    };
    if (g.index) for (let i = 0; i < g.index.count; i++) push(g.index.array[i]);
    else for (let i = 0; i < pos.count; i++) push(i);
  });
  const nVerts = soup.length / 3;

  // weld by quantized position (tolerance relative to asset size)
  const soupBox = new THREE.Box3();
  for (let i = 0; i < soup.length; i += 3) soupBox.expandByPoint(tv.set(soup[i], soup[i + 1], soup[i + 2]));
  const soupSize = new THREE.Vector3();
  soupBox.getSize(soupSize);
  const q = 2000 / Math.max(soupSize.x, soupSize.y, soupSize.z);
  const weldMapG = new Map();
  const remapG = new Uint32Array(nVerts);
  const uniq = [];
  for (let v = 0; v < nVerts; v++) {
    const key = `${Math.round(soup[v * 3] * q)},${Math.round(soup[v * 3 + 1] * q)},${Math.round(soup[v * 3 + 2] * q)}`;
    let idx = weldMapG.get(key);
    if (idx === undefined) {
      idx = uniq.length / 3;
      weldMapG.set(key, idx);
      uniq.push(soup[v * 3], soup[v * 3 + 1], soup[v * 3 + 2]);
    }
    remapG[v] = idx;
  }
  const idxArr = [];
  for (let t = 0; t < nVerts; t += 3) {
    const a = remapG[t], b = remapG[t + 1], c = remapG[t + 2];
    if (a !== b && b !== c && a !== c) idxArr.push(a, b, c);
  }
  const positions = Float32Array.from(uniq);
  const [simp] = MeshoptSimplifier.simplify(Uint32Array.from(idxArr), positions, 3, cfg.target * 3, 0.05, []);

  // compact
  const remap2 = new Int32Array(positions.length / 3).fill(-1);
  let usedG = 0;
  for (const i of simp) if (remap2[i] === -1) remap2[i] = usedG++;
  const outP = new Float32Array(usedG * 3);
  for (let i = 0; i < remap2.length; i++) {
    const j = remap2[i];
    if (j === -1) continue;
    outP[j * 3] = positions[i * 3];
    outP[j * 3 + 1] = positions[i * 3 + 1];
    outP[j * 3 + 2] = positions[i * 3 + 2];
  }
  const outI = new Uint16Array(simp.length);
  for (let i = 0; i < simp.length; i++) outI[i] = remap2[simp[i]];

  // fit: center -> rotate -> scale to head width -> place on the head, all
  // in bind-world space, then re-express in head-bone local space
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(outP, 3));
  geom.setIndex(new THREE.BufferAttribute(outI, 1));
  geom.computeBoundingBox();
  const c0 = new THREE.Vector3();
  geom.boundingBox.getCenter(c0);
  geom.translate(-c0.x, -c0.y, -c0.z);
  geom.rotateX(cfg.rot[0]); geom.rotateY(cfg.rot[1]); geom.rotateZ(cfg.rot[2]);
  geom.computeBoundingBox();
  const gs = new THREE.Vector3();
  geom.boundingBox.getSize(gs);
  const s = (cfg.widthRel * headSize.x) / Math.max(gs.x, gs.z);
  geom.scale(s, s, s);
  geom.computeBoundingBox();
  const bb = geom.boundingBox;
  let ty;
  if (cfg.anchor === 'top') ty = (headBox.max.y + (cfg.pad ?? 0)) - bb.max.y;
  else if (cfg.anchor === 'center') ty = (headCenter.y + (cfg.dy ?? 0)) - (bb.min.y + bb.max.y) / 2;
  else ty = (headBox.min.y + (cfg.yFrac ?? 0) * headSize.y) - bb.min.y;
  geom.translate(headCenter.x, ty, headCenter.z + (cfg.dz ?? 0));
  geom.applyMatrix4(headWorldInv); // into head-bone local space
  geom.computeVertexNormals();
  const nrmAttr = geom.attributes.normal;
  const outN = new Int8Array(usedG * 3);
  for (let i = 0; i < usedG * 3; i++) outN[i] = Math.max(-127, Math.min(127, Math.round(nrmAttr.array[i] * 127)));
  console.log(`gear '${name}': ${nVerts / 3} tris -> ${outI.length / 3} tris, ${usedG} verts`);
  return { name, position: geom.attributes.position.array, normal: outN, index: outI };
}

const gearBaked = [];
if (fs.existsSync(GEAR_DIR)) {
  for (const f of fs.readdirSync(GEAR_DIR).sort()) {
    const name = f.replace(/\.(fbx|obj)$/i, '');
    const cfg = GEAR_FIT[name];
    if (!cfg) { console.warn(`  ${f}: no GEAR_FIT entry, skipped`); continue; }
    let root;
    if (f.toLowerCase().endsWith('.obj')) {
      root = new OBJLoader().parse(fs.readFileSync(path.join(GEAR_DIR, f), 'utf8'));
    } else if (f.toLowerCase().endsWith('.fbx')) {
      const gbuf = fs.readFileSync(path.join(GEAR_DIR, f));
      root = new FBXLoader().parse(gbuf.buffer.slice(gbuf.byteOffset, gbuf.byteOffset + gbuf.byteLength), '');
    } else continue;
    gearBaked.push(bakeGearAsset(name, root, cfg));
  }
}

// ------------------------------------------------------------------- write

const sections = [];
const header = {
  version: 2,
  vertexCount: used,
  triCount: outIndex.length / 3,
  indexType: outIndex.BYTES_PER_ELEMENT === 2 ? 'u16' : 'u32',
  headY, minY,
  bones,
  clips: clips.map((c) => c.meta),
  sections: {}
};
let cursor = 0;
function addSection(name, arr) {
  const align = 4;
  cursor = Math.ceil(cursor / align) * align;
  header.sections[name] = { offset: cursor, length: arr.byteLength };
  sections.push({ at: cursor, bytes: new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength) });
  cursor += arr.byteLength;
}
addSection('position', outPos);
addSection('normal', outNorm);
addSection('skinIndex', outSkinIdx);
addSection('skinWeight', outSkinW);
addSection('zone', outZone);
addSection('index', outIndex);
clips.forEach((c, ci) => {
  c.meta.tracks.forEach((t, ti) => {
    addSection(`c${ci}t${ti}`, c.data[ti].times);
    addSection(`c${ci}v${ti}`, c.data[ti].values);
    t.timesSection = `c${ci}t${ti}`;
    t.valuesSection = `c${ci}v${ti}`;
  });
});
header.gear = {};
for (const g of gearBaked) {
  header.gear[g.name] = {
    vertexCount: g.position.length / 3,
    triCount: g.index.length / 3,
    replaceHead: !!GEAR_FIT[g.name]?.replaceHead
  };
  addSection(`gear:${g.name}:p`, g.position);
  addSection(`gear:${g.name}:n`, g.normal);
  addSection(`gear:${g.name}:i`, g.index);
}

const headerBytes = new TextEncoder().encode(JSON.stringify(header));
const headerPad = Math.ceil(headerBytes.length / 4) * 4;
const fileSize = 8 + headerPad + cursor;
const out = new Uint8Array(fileSize);
const dv = new DataView(out.buffer);
out.set([0x53, 0x4f, 0x46, 0x31]); // 'SOF1'
dv.setUint32(4, headerBytes.length, true); // real length; sections start at 8 + 4-byte-aligned length
out.set(headerBytes, 8);
for (const s of sections) out.set(s.bytes, 8 + headerPad + s.at);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out);
console.log(`wrote ${OUT}: ${(fileSize / 1e6).toFixed(2)} MB (${used} verts, ${outIndex.length / 3} tris)`);
