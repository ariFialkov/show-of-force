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

    const clips = {};
    for (const c of header.clips ?? []) {
      const tracks = c.tracks.map((t) => {
        const times = section(t.timesSection, Float32Array);
        const values = section(t.valuesSection, Float32Array);
        return t.type === 'quaternion'
          ? new THREE.QuaternionKeyframeTrack(t.name, times, values)
          : new THREE.VectorKeyframeTrack(t.name, times, values);
      });
      clips[c.name] = new THREE.AnimationClip(c.name, c.duration, tracks);
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
      gear: header.gear ?? {},
      gearGeomCache: new Map(),
      gearSection: section,
      clips,
      // random pool for gunshot deaths; explosion deaths are cause-specific
      deathNames: Object.keys(clips).filter((n) => n.startsWith('death') && !n.includes('explosion')),
      hitNames: Object.keys(clips).filter((n) => n.startsWith('hit')),
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

// Readability lift: the faction palettes are authored dark (military), but
// under scene lighting near-black cloth renders as a silhouette. Raise
// lightness with a floor + gain, keeping hue/saturation, so every zone
// stays distinguishable in shadow without losing faction identity.
const liftHsl = { h: 0, s: 0, l: 0 };
function lift(c) {
  c.getHSL(liftHsl);
  c.setHSL(liftHsl.h, Math.min(1, liftHsl.s * 1.05), Math.min(0.82, 0.17 + liftHsl.l * 1.05));
  return c;
}

function getPaletteGeometry(camo, mask, hideHelmet = false) {
  const key = paletteKey(camo, mask) + (hideHelmet ? ':hh' : '');
  if (paletteGeomCache.has(key)) return paletteGeomCache.get(key);

  const dark = (hex, f) => new THREE.Color(hex).multiplyScalar(f);
  const zoneColors = [
    new THREE.Color(camo.cloth),
    dark(camo.cloth, 0.82),
    new THREE.Color(camo.vest),
    new THREE.Color(camo.helmet),
    // the head mesh wears goggles + face cover — bare-skin paint reads
    // wrong on it, so soldiers get a dark balaclava; civilians keep skin
    mask ? dark(camo.cloth, 0.6) : new THREE.Color(camo.skin),
    new THREE.Color(0x3a3c33),
    new THREE.Color(0x35362e)
  ].map(lift);
  const n = template.zones.length;
  // RGBA: alpha 0 + material alphaTest discards the built-in modeled
  // helmet/antenna when a real headgear asset replaces it
  const colors = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const zone = template.zones[i];
    const c = zoneColors[zone];
    // deterministic per-vertex grain so surfaces don't read flat
    const g = 1 + (((i * 2654435761) >>> 16 & 255) / 255 - 0.5) * 0.09;
    colors[i * 4] = Math.min(255, c.r * 255 * g);
    colors[i * 4 + 1] = Math.min(255, c.g * 255 * g);
    colors[i * 4 + 2] = Math.min(255, c.b * 255 * g);
    colors[i * 4 + 3] = hideHelmet && zone === 3 ? 0 : 255;
  }

  const geom = new THREE.BufferGeometry();
  geom.setIndex(new THREE.BufferAttribute(template.index, 1));
  geom.setAttribute('position', new THREE.BufferAttribute(template.position, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(template.normal, 3, true));
  geom.setAttribute('skinIndex', new THREE.BufferAttribute(template.skinIndex, 4));
  geom.setAttribute('skinWeight', new THREE.BufferAttribute(template.skinWeight, 4, true));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 4, true));
  // generous bounds: animations move limbs outside the bind-pose box, and
  // death clips translate the whole body away from the origin — the
  // explosion death launches it almost 3m
  geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, template.headY * 0.5, 0), template.headY * 4.2);
  geom.boundingBox = null;
  paletteGeomCache.set(key, geom);
  return geom;
}

// ------------------------------------------------------------------ gear

// Baked headgear geometry, already expressed in head-bone local space.
export function getGearGeometry(name) {
  if (!template.gear[name]) return null;
  if (template.gearGeomCache.has(name)) return template.gearGeomCache.get(name);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(template.gearSection(`gear:${name}:p`, Float32Array), 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(template.gearSection(`gear:${name}:n`, Int8Array), 3, true));
  geom.setIndex(new THREE.BufferAttribute(template.gearSection(`gear:${name}:i`, Uint16Array), 1));
  geom.computeBoundingSphere();
  template.gearGeomCache.set(name, geom);
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
  const mat = (c) => new THREE.MeshPhongMaterial({ color: c, specular: 0x555555, shininess: 30 });
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
export function makeRiggedSoldier(camo, { rifle = true, mask = true, civilian = false, headgear = null } = {}) {
  const outer = new THREE.Group();
  outer.userData.civilian = civilian;

  const { root: boneRoot, map: boneMap, bones } = buildBones();
  const skeleton = new THREE.Skeleton(bones, template.boneInverses.map((m) => m.clone()));

  // The modeled head is one helmet+goggles unit, so most headgear LAYERS
  // over it; full-head assets (balaclava) instead hide the modeled crown
  // via vertex alpha + alphaTest and take its place.
  const gearMeta = headgear ? template.gear[headgear] : null;
  const hideCrown = !!gearMeta?.replaceHead;
  const mesh = new THREE.SkinnedMesh(
    getPaletteGeometry(camo, mask, hideCrown),
    // subtle specular so helmets, vests and gear catch highlights and the
    // body shape reads even against a dark backdrop
    new THREE.MeshPhongMaterial({
      vertexColors: true, specular: 0x2e2e2e, shininess: 22,
      alphaTest: hideCrown ? 0.5 : 0
    })
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

  // animation state machine: one action per baked clip, crossfaded on
  // request. Start on idle, posed once at t=0 so the rifle can be fitted to
  // the actual hand positions; the instance is desynced afterwards.
  let mixer = null;
  const actions = {};
  const rigState = { current: null };
  if (template.clips.idle) {
    mixer = new THREE.AnimationMixer(mesh);
    for (const [name, clip] of Object.entries(template.clips)) {
      actions[name] = mixer.clipAction(clip);
    }
    actions.idle.play();
    rigState.current = 'idle';
    mixer.update(0.0001);
  }
  // While a one-shot action (hit reaction, death) runs, looping requests
  // from the per-frame bot logic are ignored so they can't cut it short;
  // the mixer 'finished' event lifts the gate and the next bot tick takes
  // back control.
  const play = (name, { fade = 0.18, once = false, timeScale = 1, force = false } = {}) => {
    const next = actions[name];
    if (!next) return false;
    if (rigState.busy && !force) return false;
    if (rigState.current === name && !once) {
      next.timeScale = timeScale;
      return true;
    }
    const prev = actions[rigState.current];
    next.reset();
    next.timeScale = timeScale;
    if (once) {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
      rigState.busy = true;
    }
    next.play();
    if (prev && prev !== next) next.crossFadeFrom(prev, fade, false);
    rigState.current = name;
    return true;
  };
  mixer?.addEventListener('finished', () => { rigState.busy = false; });

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
  // team headgear parented to the head bone (geometry is baked in
  // head-bone local space), tinted with the faction helmet color
  if (headgear) {
    const gg = getGearGeometry(headgear);
    const headB = boneMap.get('mixamorigHead');
    if (gg && headB) {
      const gm = new THREE.Mesh(gg, new THREE.MeshPhongMaterial({
        color: lift(new THREE.Color(camo.helmet)),
        specular: 0x2e2e2e,
        shininess: 18,
        // full-head gear shows its interior through eye/neck openings
        side: gearMeta?.replaceHead ? THREE.DoubleSide : THREE.FrontSide
      }));
      gm.castShadow = !IS_TOUCH;
      headB.add(gm);
    }
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

  outer.userData.rig = { ...rig, rest, mixer, actions, play, state: rigState };
  outer.userData.tick = (dt) => { mixer?.update(dt); };
  outer.userData.parts = {
    legL: rig.legL, legR: rig.legR, armL: rig.armL, armR: rig.armR,
    torso: rig.spine, head: rig.head, rifle: null, muzzle
  };
  outer.traverse((o) => { o.userData.soldierRoot = outer; });
  return outer;
}

// Locomotion: real walk/run clips when the bake includes them (speed is the
// caller's gait factor — roughly metres-per-second / 1.9), else a procedural
// leg swing layered on the idle clip as fallback.
const qSwing = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0);

export function riggedWalk(soldier, t, speed = 1) {
  const r = soldier.userData.rig;
  if (!r) return;
  if (r.actions?.walk) {
    if (soldier.userData.civilian && r.actions['unarmed-run']) {
      r.play('unarmed-run', { fade: 0.2, timeScale: Math.max(0.7, Math.min(1.4, 0.55 + speed * 0.35)) });
    } else if (soldier.userData.crouched && r.actions['crouch-walk']) {
      r.play('crouch-walk', { fade: 0.25, timeScale: Math.max(0.7, Math.min(1.5, 0.5 + speed * 0.5)) });
    } else if (speed >= 1.4 && r.actions.run) {
      r.play('run', { fade: 0.16, timeScale: Math.min(1.5, 0.75 + speed * 0.15) });
    } else {
      r.play('walk', { fade: 0.22, timeScale: Math.max(0.6, Math.min(1.6, 0.55 + speed * 0.55)) });
    }
    return;
  }
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
  const r = soldier.userData.rig;
  soldier.rotation.x = 0;
  if (!r?.play) return;
  if (soldier.userData.civilian && r.actions['scared-idle']) r.play('scared-idle', { fade: 0.25 });
  else if (soldier.userData.crouched && r.actions['crouch-idle']) r.play('crouch-idle', { fade: 0.25 });
  else r.play('idle', { fade: 0.25 });
}

// Flashbang daze: staggering stun loop while the timer runs.
export function riggedStun(soldier) {
  const r = soldier.userData.rig;
  if (!r?.play) return false;
  return r.play('stun', { fade: 0.15 });
}

// Play a baked death clip — the blast-thrown variant for explosive kills,
// otherwise a random pick from the gunshot pool. Returns its duration, or 0
// when none are baked (the caller then falls back to the procedural collapse).
export function riggedDeath(soldier, cause = 'gunfire') {
  const r = soldier.userData.rig;
  if (!r?.play || !template) return 0;
  let name = null;
  if (cause === 'explosion' && template.clips['death-explosion']) name = 'death-explosion';
  else if (template.deathNames.length) name = template.deathNames[Math.floor(Math.random() * template.deathNames.length)];
  if (!name || !r.play(name, { fade: 0.1, once: true, force: true })) return 0;
  return template.clips[name].duration;
}

// One-shot magazine change: weapon lowered, bot can't fire until it ends.
export function riggedReload(soldier) {
  const r = soldier.userData.rig;
  if (!r?.play || !template?.clips.reload) return 0;
  if (!r.play('reload', { fade: 0.14, once: true })) return 0;
  return template.clips.reload.duration;
}

// Seated transport idle for the insertion cinematic.
export function riggedSit(soldier) {
  const r = soldier.userData.rig;
  if (!r?.play) return false;
  return r.play('sit', { fade: 0.2 });
}

// Flinch from a non-lethal hit: one-shot reaction, after which the bot's
// per-frame state (aim/walk/idle) resumes on its own.
export function riggedHit(soldier) {
  const r = soldier.userData.rig;
  if (!r?.play || !template?.hitNames.length) return 0;
  const name = template.hitNames[Math.floor(Math.random() * template.hitNames.length)];
  if (!r.play(name, { fade: 0.08, once: true })) return 0;
  return template.clips[name].duration;
}

// Combat stances: weapon shouldered (aim) and firing. Fall back to the
// relaxed idle when the bake lacks these clips.
export function riggedAim(soldier) {
  const r = soldier.userData.rig;
  if (!r) return;
  if (r.actions?.aim) r.play('aim', { fade: 0.2 });
  else riggedIdle(soldier);
}

export function riggedFire(soldier) {
  const r = soldier.userData.rig;
  if (!r) return;
  if (r.actions?.fire) r.play('fire', { fade: 0.08 });
  else riggedAim(soldier);
}
