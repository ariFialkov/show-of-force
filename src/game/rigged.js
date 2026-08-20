// Rigged character pipeline.
//
// Loads the baked trooper binary (scripts/bake-trooper.mjs pre-merges the
// Mixamo FBX's 55 skinned parts into one mesh on a canonical skeleton,
// decimates ~418k tris to ~42k and quantizes attributes) and colors it per
// faction by painting vertex colors from each vertex's baked zone (helmet,
// face/balaclava, vest, camo cloth, gloves, boots). Instances share the
// vertex buffers; only the color attribute differs per palette. The
// embedded idle clip drives an AnimationMixer; walking and deaths are
// layered procedurally on top of the bones.

import * as THREE from 'three';
import { IS_TOUCH } from './controls.js';

const TARGET_HEIGHT = 1.76;

let template = null; // { position, normal, skinIndex, skinWeight, zones, index, boneDefs, boneInverses, clip, scale, minY, headY }
const paletteGeomCache = new Map();

export function riggedReady() {
  return template !== null;
}

// ------------------------------------------------------------------ load

export async function initRigged(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
    const buf = await res.arrayBuffer();
    const dv = new DataView(buf);
    if (dv.getUint32(0, false) !== 0x534f4631) throw new Error('bad magic'); // 'SOF1'
    const headerLen = dv.getUint32(4, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, headerLen)));
    const base = 8 + Math.ceil(headerLen / 4) * 4;
    const section = (name, Ctor) => {
      const s = header.sections[name];
      return new Ctor(buf, base + s.offset, s.length / Ctor.BYTES_PER_ELEMENT);
    };

    const boneDefs = header.bones.map((b) => ({
      name: b.name,
      parentIndex: b.parentIndex,
      local: new THREE.Matrix4().fromArray(b.local)
    }));
    const boneInverses = header.bones.map((b) => new THREE.Matrix4().fromArray(b.inverse));

    let clip = null;
    if (header.clip) {
      const tracks = header.clip.tracks.map((t) => {
        const times = section(t.timesSection, Float32Array);
        const values = section(t.valuesSection, Float32Array);
        return t.type === 'quaternion'
          ? new THREE.QuaternionKeyframeTrack(t.name, times, values)
          : new THREE.VectorKeyframeTrack(t.name, times, values);
      });
      clip = new THREE.AnimationClip(header.clip.name, header.clip.duration, tracks);
    }

    // bind pose is a T-pose, so derive height from the head bone, not the
    // arm-inflated bbox (head bone to crown ≈ 3.4 units on this export)
    const height = (header.headY + 3.4) - header.minY;

    template = {
      position: section('position', Float32Array),
      normal: section('normal', Int8Array),
      skinIndex: section('skinIndex', Uint8Array),
      skinWeight: section('skinWeight', Uint8Array),
      zones: section('zone', Uint8Array),
      index: header.indexType === 'u16' ? section('index', Uint16Array) : section('index', Uint32Array),
      boneDefs, boneInverses,
      clip,
      scale: TARGET_HEIGHT / height,
      minY: header.minY,
      headY: header.headY
    };
    return true;
  } catch (err) {
    console.warn('Rigged character unavailable, using procedural soldiers:', err);
    template = null;
    return false;
  }
}

// ------------------------------------------------------ palette geometry

function paletteKey(camo, mask) {
  return [camo.cloth, camo.vest, camo.helmet, camo.skin, mask ? 'm' : 'f'].join(':');
}

function getPaletteGeometry(camo, mask) {
  const key = paletteKey(camo, mask);
  if (paletteGeomCache.has(key)) return paletteGeomCache.get(key);

  const dark = (hex, f) => new THREE.Color(hex).multiplyScalar(f);
  const zoneColors = [
    new THREE.Color(camo.cloth),
    dark(camo.cloth, 0.8),
    new THREE.Color(camo.vest),
    new THREE.Color(camo.helmet),
    // the head mesh wears goggles + face cover — bare-skin paint reads
    // wrong on it, so soldiers get a dark balaclava; civilians keep skin
    mask ? dark(camo.cloth, 0.42) : new THREE.Color(camo.skin),
    new THREE.Color(0x232219),
    new THREE.Color(0x1b1c18)
  ];
  const n = template.zones.length;
  const colors = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const c = zoneColors[template.zones[i]];
    // deterministic per-vertex grain so surfaces don't read flat
    const g = 1 + (((i * 2654435761) >>> 16 & 255) / 255 - 0.5) * 0.09;
    colors[i * 3] = Math.min(255, c.r * 255 * g);
    colors[i * 3 + 1] = Math.min(255, c.g * 255 * g);
    colors[i * 3 + 2] = Math.min(255, c.b * 255 * g);
  }

  const geom = new THREE.BufferGeometry();
  geom.setIndex(new THREE.BufferAttribute(template.index, 1));
  geom.setAttribute('position', new THREE.BufferAttribute(template.position, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(template.normal, 3, true));
  geom.setAttribute('skinIndex', new THREE.BufferAttribute(template.skinIndex, 4));
  geom.setAttribute('skinWeight', new THREE.BufferAttribute(template.skinWeight, 4, true));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3, true));
  // generous bounds: animation moves limbs outside the bind-pose box
  geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, template.headY * 0.55, 0), template.headY * 1.4);
  geom.boundingBox = null;
  paletteGeomCache.set(key, geom);
  return geom;
}

// --------------------------------------------------------- instantiation

function buildBones() {
  const bones = template.boneDefs.map((d) => {
    const b = new THREE.Bone();
    b.name = d.name;
    d.local.decompose(b.position, b.quaternion, b.scale);
    return b;
  });
  const map = new Map();
  bones.forEach((b, i) => {
    const pi = template.boneDefs[i].parentIndex;
    if (pi >= 0) bones[pi].add(b);
    map.set(b.name, b);
  });
  return { root: bones[0], map, bones };
}

function makeRifle() {
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
  const box = (w, h, d, c) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
  const rifle = new THREE.Group();
  const receiver = box(0.055, 0.08, 0.42, 0x14161a);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.3, 8), mat(0x101215));
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.01, 0.33);
  const suppressor = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.12, 8), mat(0x0c0e10));
  suppressor.rotation.x = Math.PI / 2;
  suppressor.position.set(0, 0.01, 0.52);
  const magazine = box(0.045, 0.13, 0.07, 0x1c1f24);
  magazine.position.set(0, -0.1, 0.06);
  const stock = box(0.045, 0.09, 0.16, 0x22262c);
  stock.position.set(0, -0.005, -0.3);
  const optic = box(0.035, 0.05, 0.1, 0x0e1013);
  optic.position.set(0, 0.065, 0.02);
  rifle.add(receiver, barrel, suppressor, magazine, stock, optic);
  return rifle;
}

let blobTex = null;
function blobShadow(radius) {
  if (!blobTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
    grad.addColorStop(0, 'rgba(0,0,0,0.26)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    blobTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.02;
  m.renderOrder = 1;
  return m;
}

// Build one character. Returns a group with the same userData contract as
// the procedural soldiers (parts, tick, rig flag).
export function makeRiggedSoldier(camo, { rifle = true, mask = true } = {}) {
  const outer = new THREE.Group();

  const { root: boneRoot, map: boneMap, bones } = buildBones();
  const skeleton = new THREE.Skeleton(bones, template.boneInverses.map((m) => m.clone()));

  const mesh = new THREE.SkinnedMesh(
    getPaletteGeometry(camo, mask),
    new THREE.MeshLambertMaterial({ vertexColors: true })
  );
  mesh.add(boneRoot);
  mesh.bind(skeleton, new THREE.Matrix4());
  mesh.raycast = () => {}; // dense skin — raycasts hit the capsule hitbox instead
  mesh.castShadow = !IS_TOUCH;
  mesh.frustumCulled = true;

  const inner = new THREE.Group();
  inner.scale.setScalar(template.scale);
  inner.position.y = -template.minY * template.scale;
  inner.add(mesh);
  outer.add(inner);

  // simple hitbox the weapon raycasts hit instead of the dense skin
  const hitbox = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.42, 0.95, 2, 8),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hitbox.position.y = 0.95;
  outer.add(hitbox);
  outer.add(blobShadow(0.5));

  // idle clip via mixer — pose it once at t=0 so the rifle can be fitted
  // to the actual hand positions, then desync the instance
  let mixer = null;
  if (template.clip) {
    mixer = new THREE.AnimationMixer(mesh);
    const action = mixer.clipAction(template.clip);
    action.play();
    mixer.update(0.0001);
  }

  // rifle spanning the hands: grip at the right hand, barrel aimed at the
  // left hand (the idle clip holds a two-handed low-ready pose)
  let muzzle = new THREE.Object3D();
  const handR = boneMap.get('mixamorigRightHand');
  const handL = boneMap.get('mixamorigLeftHand');
  if (rifle && handR && handL) {
    outer.updateMatrixWorld(true);
    const rhP = new THREE.Vector3().setFromMatrixPosition(handR.matrixWorld);
    const lhP = new THREE.Vector3().setFromMatrixPosition(handL.matrixWorld);
    const helper = new THREE.Object3D();
    helper.position.copy(rhP);
    helper.lookAt(lhP); // +Z (barrel) toward the support hand
    helper.updateMatrix();
    const local = helper.matrix.clone()
      .premultiply(new THREE.Matrix4().copy(handR.matrixWorld).invert());
    const r = makeRifle();
    local.decompose(r.position, r.quaternion, r.scale);
    handR.add(r);
    r.translateZ(0.14 / template.scale); // slide grip back into the palm
    r.translateY(-0.03 / template.scale);
    muzzle.position.set(0, 0.01, 0.62);
    r.add(muzzle);
  } else {
    outer.add(muzzle);
    muzzle.position.set(0, 1.2, 0.4);
  }
  mixer?.update(Math.random() * 2); // desync instances

  // adapter so the existing bot/animation code can drive the rig
  const bone = (n) => boneMap.get('mixamorig' + n);
  const rig = {
    hips: bone('Hips'),
    legL: bone('LeftUpLeg'), legR: bone('RightUpLeg'),
    armL: bone('LeftArm'), armR: bone('RightArm'),
    spine: bone('Spine1'), head: bone('Head')
  };
  const rest = {};
  for (const [k, b] of Object.entries(rig)) {
    if (b) rest[k] = { q: b.quaternion.clone(), p: b.position.clone() };
  }

  outer.userData.rig = { ...rig, rest, mixer };
  outer.userData.tick = (dt) => { mixer?.update(dt); };
  outer.userData.parts = {
    legL: rig.legL, legR: rig.legR, armL: rig.armL, armR: rig.armR,
    torso: rig.spine, head: rig.head, rifle: null, muzzle
  };
  outer.traverse((o) => { o.userData.soldierRoot = outer; });
  return outer;
}

// procedural gait layered ON TOP of the mixer idle (called after tick).
// Only the legs are overridden — the idle clip owns arms/torso/hips, which
// keeps the weapon-holding upper-body pose intact while walking.
const qSwing = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0);

export function riggedWalk(soldier, t, speed = 1) {
  const r = soldier.userData.rig;
  if (!r) return;
  const ph = t * 7 * speed;
  const s = Math.sin(ph);
  const swing = (b, restQ, amt) => {
    if (!b || !restQ) return;
    qSwing.setFromAxisAngle(X_AXIS, amt);
    b.quaternion.copy(restQ.q).multiply(qSwing);
  };
  swing(r.legL, r.rest.legL, s * 0.62);
  swing(r.legR, r.rest.legR, -s * 0.62);
  soldier.rotation.x = 0.045 * Math.min(1, speed);
}

export function riggedIdle(soldier) {
  // the mixer's idle clip owns the pose; just clear the walk lean
  soldier.rotation.x = 0;
}
