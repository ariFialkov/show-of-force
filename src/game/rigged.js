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
const WEAPON_SCALE = 1.2; // held weapons read small against the bulky trooper
// A knife is held IN the fist, not carried out front like a long gun. The
// seat is solved rather than nudged: the point this far along the knife's
// own length (0 = butt, 1 = tip) is placed at the hand bone, so the handle
// lands in the palm and the rest of the blade projects forward. TWEAK is a
// small hand-local correction in metres for the palm centre vs bone origin.
const KNIFE_GRIP_FRAC = 0.18;
const KNIFE_TWEAK = { x: 0, y: -0.02, z: 0.05 };
// per-weapon carry scale: the knife reads toy-sized next to the long guns
// at the shared fit scale, so it gets its own multiplier
const weaponCarryScale = (n) => WEAPON_SCALE * (n === 'knife' ? 2 : 1);

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

    // Split masks so an upper-body gesture (reload, knife stance, knife
    // throw) can run while the legs keep their locomotion — those source
    // clips all have static legs, which looks wrong on a moving bot. Two
    // complementary variants are baked:
    //   <clip>-upper   torso + arms + head only (the gesture clips)
    //   <clip>-lower   hips + legs only, for every clip a gesture can sit on
    // Because the masks don't overlap, no bone is ever driven by two actions
    // at once (which would blend them and dilute both).
    const LOWER = [
      'Hips', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'LeftToe_End',
      'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase', 'RightToe_End'
    ];
    const isLower = (trackName) => {
      const node = trackName.split('.')[0];
      return LOWER.some((b) => node.endsWith(b));
    };
    const UPPER_GESTURES = ['reload', 'knife-idle', 'knife-throw'];
    let anyGesture = false;
    for (const src of UPPER_GESTURES) {
      if (!clips[src]) continue;
      anyGesture = true;
      clips[`${src}-upper`] = new THREE.AnimationClip(
        `${src}-upper`, clips[src].duration, clips[src].tracks.filter((t) => !isLower(t.name))
      );
    }
    if (anyGesture) {
      for (const base of ['idle', 'aim', 'fire', 'walk', 'run', 'crouch-idle', 'crouch-walk', 'unarmed-run']) {
        const c = clips[base];
        if (!c) continue;
        clips[`${base}-lower`] = new THREE.AnimationClip(
          `${base}-lower`, c.duration, c.tracks.filter((t) => isLower(t.name))
        );
      }
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
      weapons: header.weapons ?? {},
      weaponGeomCache: new Map(),
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

// Vertices whose dominant bone belongs to an arm — used to mask the body
// down to just the limbs the first-person camera would actually see.
let armMaskCache = null;
function armMask() {
  if (armMaskCache) return armMaskCache;
  const isArm = template.boneDefs.map((b) =>
    /Arm|ForeArm|Hand|Thumb|Index|Middle|Ring|Pinky/.test(b.name));
  const n = template.zones.length;
  const m = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    let maxK = 0;
    for (let k = 1; k < 4; k++) {
      if (template.skinWeight[v * 4 + k] > template.skinWeight[v * 4 + maxK]) maxK = k;
    }
    m[v] = isArm[template.skinIndex[v * 4 + maxK]] ? 1 : 0;
  }
  armMaskCache = m;
  return m;
}

function getPaletteGeometry(camo, mask, hideHelmet = false, armsOnly = false) {
  const key = paletteKey(camo, mask) + (hideHelmet ? ':hh' : '') + (armsOnly ? ':ao' : '');
  if (paletteGeomCache.has(key)) return paletteGeomCache.get(key);

  const dark = (hex, f) => new THREE.Color(hex).multiplyScalar(f);
  // One kit color across torso/arms/legs/helmet shell (soldierly, not
  // color-blocked), bare skin on hands/face, neutral webbing + boots, and
  // near-black for hard devices (goggles, antenna, belt kit). The lift is
  // only for dark fabric — skin tones are bright enough as authored.
  const zoneColors = [
    lift(new THREE.Color(camo.cloth)),                 // KIT
    lift(dark(camo.cloth, 0.93)),                      // KIT shaded (forearms, shins)
    lift(new THREE.Color(0x393d39)),                   // webbing / belt straps
    lift(mask ? dark(camo.cloth, 0.97) : new THREE.Color(camo.helmet)), // helmet shell = kit / civilian hair
    new THREE.Color(camo.skin),                        // face + neck
    new THREE.Color(camo.skin).multiplyScalar(0.96),   // hands
    new THREE.Color(0x3a362e),                         // boots
    new THREE.Color(0x2c2e33)                          // devices: goggles, antenna, pouch kit
  ];
  const n = template.zones.length;
  // RGBA: alpha 0 + material alphaTest discards geometry we don't want —
  // the modeled helmet under a full-head gear asset, or everything but the
  // arms for the first-person viewmodel
  const arms = armsOnly ? armMask() : null;
  const colors = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const zone = template.zones[i];
    const c = zoneColors[zone];
    // deterministic per-vertex grain so surfaces don't read flat
    const g = 1 + (((i * 2654435761) >>> 16 & 255) / 255 - 0.5) * 0.09;
    colors[i * 4] = Math.min(255, c.r * 255 * g);
    colors[i * 4 + 1] = Math.min(255, c.g * 255 * g);
    colors[i * 4 + 2] = Math.min(255, c.b * 255 * g);
    const hidden = (hideHelmet && zone === 3) || (arms && !arms[i]);
    colors[i * 4 + 3] = hidden ? 0 : 255;
  }

  const geom = new THREE.BufferGeometry();
  if (arms) {
    // viewmodel: drop hidden triangles from the index so the GPU never
    // transforms the ~90% of the body the camera can't see
    const src = template.index;
    const keep = [];
    for (let t = 0; t < src.length; t += 3) {
      if (arms[src[t]] && arms[src[t + 1]] && arms[src[t + 2]]) keep.push(src[t], src[t + 1], src[t + 2]);
    }
    const Ctor = template.position.length / 3 > 65535 ? Uint32Array : Uint16Array;
    geom.setIndex(new THREE.BufferAttribute(Ctor.from(keep), 1));
  } else {
    geom.setIndex(new THREE.BufferAttribute(template.index, 1));
  }
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

// ---------------------------------------------------------------- weapons

// Baked weapon prefab, tinted from the squad palette. Parts (connected
// components ranked by size at bake time) alternate gunmetal hardware and
// kit-toned furniture so the weapon matches the soldier without being one
// flat color. Canonical frame: barrel +Z, origin at the grip, metres.
export function makeWeaponMesh(name, camo) {
  if (!template?.weapons?.[name]) return null;
  const key = name; // colors no longer vary by team
  let geom = template.weaponGeomCache.get(key);
  if (!geom) {
    const pos = template.gearSection(`weapon:${name}:p`, Float32Array);
    const nrm = template.gearSection(`weapon:${name}:n`, Int8Array);
    const idx = template.gearSection(`weapon:${name}:i`, Uint16Array);
    const slot = template.gearSection(`weapon:${name}:s`, Uint8Array);
    // black-on-black hardware, matching the game's toy-soldier art style —
    // parts alternate close dark tones so shape still reads without any
    // realistic camo furniture
    const slotColors = [
      new THREE.Color(0x1e2126),
      new THREE.Color(0x2b2e33),
      new THREE.Color(0x16181b),
      new THREE.Color(0x33363b),
      new THREE.Color(0x212327),
      new THREE.Color(0x191b1e),
      new THREE.Color(0x282a2e),
      new THREE.Color(0x1d1f22)
    ];
    if (name === 'knife') {
      // blades are steel — only the grip stays dark
      slotColors[1] = new THREE.Color(0x9aa1a8);
      slotColors[3] = new THREE.Color(0x7c828a);
    }
    const n = slot.length;
    const colors = new Uint8Array(n * 3);
    for (let i = 0; i < n; i++) {
      const c = slotColors[slot[i]];
      const g = 1 + (((i * 2654435761) >>> 16 & 255) / 255 - 0.5) * 0.07;
      colors[i * 3] = Math.min(255, c.r * 255 * g);
      colors[i * 3 + 1] = Math.min(255, c.g * 255 * g);
      colors[i * 3 + 2] = Math.min(255, c.b * 255 * g);
    }
    geom = new THREE.BufferGeometry();
    geom.setIndex(new THREE.BufferAttribute(idx, 1));
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(nrm, 3, true));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3, true));
    geom.computeBoundingSphere();
    template.weaponGeomCache.set(key, geom);
  }
  // same reflective response as the soldier bodies so weapons sit in the
  // same material world instead of reading glossy-realistic
  const mesh = new THREE.Mesh(geom, new THREE.MeshPhongMaterial({
    vertexColors: true, specular: 0x2e2e2e, shininess: 22
  }));
  mesh.castShadow = !IS_TOUCH;
  mesh.userData.muzzleZ = template.weapons[name].muzzleZ;
  return mesh;
}

// A free-standing copy of a weapon at the size it is carried at, for
// projectiles that ARE the weapon (the thrown ballistic knife) so the round
// in flight matches the one in the hand. The baked geometry is centred on
// its own origin, so callers can tumble it about any axis directly.
export function makeThrownWeapon(name, camo = null) {
  const mesh = makeWeaponMesh(name, camo);
  if (mesh) mesh.scale.setScalar(weaponCarryScale(name));
  return mesh;
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
export function makeRiggedSoldier(camo, { rifle = true, mask = true, civilian = false, headgear = null, armsOnly = false, weapon = 'rifle', backupWeapon = null } = {}) {
  const outer = new THREE.Group();
  outer.userData.civilian = civilian;
  outer.userData.currentWeapon = rifle ? weapon : null;

  const { root: boneRoot, map: boneMap, bones } = buildBones();
  const skeleton = new THREE.Skeleton(bones, template.boneInverses.map((m) => m.clone()));

  // The modeled head is one helmet+goggles unit, so most headgear LAYERS
  // over it; full-head assets (balaclava) instead hide the modeled crown
  // via vertex alpha + alphaTest and take its place.
  const gearMeta = headgear ? template.gear[headgear] : null;
  const hideCrown = !!gearMeta?.replaceHead;
  const mesh = new THREE.SkinnedMesh(
    getPaletteGeometry(camo, mask, hideCrown, armsOnly),
    // subtle specular so helmets, vests and gear catch highlights and the
    // body shape reads even against a dark backdrop
    new THREE.MeshPhongMaterial({
      vertexColors: true, specular: 0x2e2e2e, shininess: 22,
      alphaTest: hideCrown || armsOnly ? 0.5 : 0,
      // viewmodel arms ride over the world so they never clip into cover
      depthTest: !armsOnly
    })
  );
  mesh.add(boneRoot);
  mesh.bind(skeleton, new THREE.Matrix4());
  mesh.raycast = () => {}; // dense skin — raycasts hit the capsule hitbox instead
  mesh.castShadow = !IS_TOUCH && !armsOnly;
  mesh.frustumCulled = !armsOnly;
  if (armsOnly) mesh.renderOrder = 500;

  const inner = new THREE.Group();
  inner.scale.setScalar(template.scale);
  inner.position.y = -template.minY * template.scale;
  inner.add(mesh);
  outer.add(inner);

  // simple hitbox the weapon raycasts hit instead of the dense skin
  if (!armsOnly) {
    const hitbox = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.42, 0.95, 2, 8),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hitbox.position.y = 0.95;
    outer.add(hitbox);
    outer.add(blobShadow(0.5));
  }

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
    // a one-shot (death, hit reaction, full-body reload) takes the whole
    // skeleton back — cancel any running partial-body overlay first. The
    // per-frame stance sync re-establishes a persistent loop afterwards.
    if (once && rigState.overlay) {
      actions[rigState.overlay]?.stop();
      rigState.overlay = null;
      rigState.overlayLoop = null;
    }
    // while an upper-body overlay runs, the base clip drives ONLY the lower
    // body, so the overlay owns the torso and arms outright. The bot logic
    // keeps requesting 'walk'/'aim' as usual and gets remapped here, which
    // means the base clip can still change freely mid-reload.
    if (rigState.overlay && actions[`${name}-lower`]) name = `${name}-lower`;
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
  // Overlay channel: a clip whose tracks cover only part of the skeleton
  // (reload-upper, knife-idle-upper…) layered on top of the base action —
  // the base keeps driving whatever bones the overlay doesn't touch.
  // `loop: true` makes it a persistent stance (knife carry) that survives
  // base changes and one-shot overlays: a one-shot fired on top of a stance
  // (the knife throw) crossfades back into the stance when it finishes.
  const playOverlay = (name, { fade = 0.12, timeScale = 1, loop = false } = {}) => {
    const a = actions[name];
    if (!a || rigState.busy) return 0;
    if (rigState.overlay === name) return a.getClip().duration / timeScale;
    const base = rigState.current?.endsWith('-lower')
      ? rigState.current.slice(0, -'-lower'.length)
      : rigState.current;
    // the base must have a lower-body-only twin, otherwise both actions
    // would fight over the torso
    if (!base || !actions[`${base}-lower`]) return 0;
    const prev = rigState.overlay ? actions[rigState.overlay] : null;
    a.reset();
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    a.clampWhenFinished = !loop;
    a.timeScale = timeScale;
    a.setEffectiveWeight(1);
    a.play();
    if (prev && prev !== a) a.crossFadeFrom(prev, fade, false);
    else a.fadeIn(fade);
    rigState.overlay = name;
    if (loop) rigState.overlayLoop = name;
    play(base, { fade: 0.1 }); // remaps to `${base}-lower` now the overlay is up
    return a.getClip().duration / timeScale;
  };
  // Drop the overlay channel entirely and hand the whole skeleton back to
  // the base clip (leaving a knife stance, or aborting one mid-gesture).
  const stopOverlay = (fade = 0.2) => {
    if (!rigState.overlay) return;
    actions[rigState.overlay]?.fadeOut(fade);
    rigState.overlay = null;
    rigState.overlayLoop = null;
    if (rigState.current?.endsWith('-lower')) {
      play(rigState.current.slice(0, -'-lower'.length), { fade });
    }
  };
  mixer?.addEventListener('finished', (e) => {
    if (rigState.overlay && e.action === actions[rigState.overlay]) {
      const back = rigState.overlayLoop && rigState.overlayLoop !== rigState.overlay
        ? actions[rigState.overlayLoop] : null;
      if (back) {
        // one-shot gesture over a stance: settle back into the stance loop
        back.reset();
        back.setLoop(THREE.LoopRepeat, Infinity);
        back.clampWhenFinished = false;
        back.setEffectiveWeight(1);
        back.play();
        back.crossFadeFrom(e.action, 0.16, false);
        rigState.overlay = rigState.overlayLoop;
      } else {
        e.action.fadeOut(0.2);
        rigState.overlay = null;
        rigState.overlayLoop = null;
        // hand the upper body back to the full-skeleton base clip
        if (rigState.current?.endsWith('-lower')) {
          play(rigState.current.slice(0, -'-lower'.length), { fade: 0.2 });
        }
      }
    } else {
      rigState.busy = false;
    }
  });

  // rifle spanning the hands: grip at the right hand, barrel aimed at the
  // left hand (the idle clip holds a two-handed low-ready pose)
  let muzzle = new THREE.Object3D();
  let alignWeapon = null;
  let swapWeapon = null;
  let heldWeapons = []; // exposed for grip tuning / inspection
  const handR = boneMap.get('mixamorigRightHand');
  const handL = boneMap.get('mixamorigLeftHand');
  if (rifle && handR && handL) {
    outer.updateMatrixWorld(true);
    const rhP = new THREE.Vector3().setFromMatrixPosition(handR.matrixWorld);
    const lhP = new THREE.Vector3().setFromMatrixPosition(handL.matrixWorld);
    // Orient from the hand span (natural roll/cant), then re-aim the barrel
    // exactly along the soldier's forward axis: aiming straight at the
    // support hand throws the muzzle across the body, and for the player
    // the barrel must agree with the center-screen crosshair.
    const helper = new THREE.Object3D();
    helper.position.copy(rhP);
    helper.lookAt(lhP); // +Z = barrel
    helper.updateMatrix();
    const local = helper.matrix.clone()
      .premultiply(new THREE.Matrix4().copy(handR.matrixWorld).invert());
    const scaleFor = weaponCarryScale;
    const r = makeWeaponMesh(weapon, camo) ?? makeRifle();
    local.decompose(r.position, r.quaternion, r.scale);
    r.scale.multiplyScalar(scaleFor(weapon));
    handR.add(r);
    // Optional second weapon in the same grip: every baked prefab shares the
    // canonical frame (barrel +Z, origin at the grip), so it inherits the
    // primary's fitted transform exactly and only visibility toggles.
    let rB = null;
    if (backupWeapon && backupWeapon !== weapon) {
      rB = makeWeaponMesh(backupWeapon, camo);
      if (rB) {
        rB.position.copy(r.position);
        rB.quaternion.copy(r.quaternion);
        rB.scale.copy(r.scale).multiplyScalar(scaleFor(backupWeapon) / scaleFor(weapon));
        rB.visible = false;
        handR.add(rB);
      }
    }
    const held = rB ? [r, rB] : [r];
    heldWeapons = held;
    // Minimal rotation that swings the barrel onto body-forward, applied in
    // hand-local space so the grip stays put. Re-runnable: the pose the
    // weapon was fitted in isn't the pose it is carried in, so the caller
    // can re-align once the character settles into its resting clip.
    alignWeapon = () => {
      outer.updateMatrixWorld(true);
      // NOTE: decompose, not setFromRotationMatrix — the bone's world matrix
      // carries the rig's uniform scale, which corrupts a raw quaternion read
      const handQ = new THREE.Quaternion();
      handR.matrixWorld.decompose(new THREE.Vector3(), handQ, new THREE.Vector3());
      const barrelWorld = new THREE.Vector3(0, 0, 1)
        .applyQuaternion(new THREE.Quaternion().copy(handQ).multiply(r.quaternion));
      // aim at the CHARACTER's forward, not world +Z: when this re-runs the
      // viewmodel is parented under the camera, so a world-space target
      // would peg the weapon to a fixed compass direction
      const fwd = new THREE.Vector3(0, 0, 1).transformDirection(outer.matrixWorld).normalize();
      const fix = new THREE.Quaternion().setFromUnitVectors(barrelWorld, fwd);
      const q = new THREE.Quaternion().copy(handQ).invert().multiply(fix).multiply(handQ);
      for (const w of held) w.quaternion.premultiply(q);
    };
    alignWeapon();
    for (const w of held) {
      if ((w === r ? weapon : backupWeapon) === 'knife') {
        // Solve the seat instead of offsetting the long-gun carry pose,
        // which left the blade's axis floating ~15cm clear of the fist.
        // Derived from the mesh's own bounds, so it stays correct whatever
        // internal origin the bake produced.
        w.geometry.computeBoundingBox();
        const kb = w.geometry.boundingBox;
        const gripLocal = new THREE.Vector3(
          (kb.min.x + kb.max.x) / 2,
          (kb.min.y + kb.max.y) / 2,
          kb.min.z + (kb.max.z - kb.min.z) * KNIFE_GRIP_FRAC
        ).multiply(w.scale).applyQuaternion(w.quaternion);
        w.position.copy(gripLocal).negate();
        w.position.x += KNIFE_TWEAK.x / template.scale;
        w.position.y += KNIFE_TWEAK.y / template.scale;
        w.position.z += KNIFE_TWEAK.z / template.scale;
        continue;
      }
      // carried well forward of the fists and riding above them; the
      // first-person viewmodel pushes further out and up so the barrel
      // clears the support hand on camera
      w.translateZ((armsOnly ? 0.48 : 0.32) / template.scale);
      w.translateY((armsOnly ? 0.14 : 0.05) / template.scale);
    }
    if (armsOnly) {
      // the held weapon rides over the world with the arms
      for (const w of held) {
        w.material = w.material.clone();
        w.material.depthTest = false;
        w.renderOrder = 501;
        w.castShadow = false;
      }
    }
    // each weapon carries its own muzzle point; swapping updates parts.muzzle
    muzzle.position.set(0, 0.01, r.userData.muzzleZ ?? 0.62);
    r.add(muzzle);
    if (rB) {
      const mB = new THREE.Object3D();
      mB.position.set(0, 0.01, rB.userData.muzzleZ ?? 0.62);
      rB.add(mB);
      swapWeapon = (toBackup) => {
        r.visible = !toBackup;
        rB.visible = toBackup;
        outer.userData.parts.muzzle = toBackup ? mB : muzzle;
        // the per-frame stance sync watches this to swap carry styles
        // (the knife is held one-handed, not shouldered like a rifle)
        outer.userData.currentWeapon = toBackup ? backupWeapon : weapon;
        return true;
      };
    }
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

  outer.userData.rig = { ...rig, rest, mixer, actions, play, playOverlay, stopOverlay, state: rigState, alignWeapon, swapWeapon, bodyScale: template.scale, held: heldWeapons };
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

// Per-frame carry-style sync: while a soldier's current weapon is the
// ballistic knife, the upper body holds the knife-idle stance as a looping
// overlay (one-handed carry) instead of the shouldered rifle pose, while
// the base clip keeps driving the legs. Returns true when the knife stance
// is (or is being) applied, so callers can substitute knife gestures.
export function riggedStance(soldier) {
  const r = soldier.userData.rig;
  if (!r?.playOverlay) return false;
  const knife = soldier.userData.currentWeapon === 'knife' && r.actions['knife-idle-upper'];
  if (knife) {
    if (r.state.overlayLoop !== 'knife-idle-upper' && !r.state.busy) {
      r.playOverlay('knife-idle-upper', { loop: true, fade: 0.2 });
    }
    return true;
  }
  if (r.state.overlayLoop === 'knife-idle-upper') r.stopOverlay(0.2);
  return false;
}

export function riggedWalk(soldier, t, speed = 1) {
  const r = soldier.userData.rig;
  if (!r) return;
  if (r.actions?.walk) {
    riggedStance(soldier);
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
  riggedStance(soldier);
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
// Always attempted as an upper-body overlay so the legs keep doing whatever
// they were doing — running, strafing or holding a stance — and can even
// change mid-reload. Falls back to the full-body clip only when no
// lower-body twin exists for the current stance.
export function riggedReload(soldier) {
  const r = soldier.userData.rig;
  if (!r?.play || !template?.clips.reload) return 0;
  if (r.playOverlay) {
    const d = r.playOverlay('reload-upper', { fade: 0.12 });
    if (d > 0) return d;
  }
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
  riggedStance(soldier);
  if (r.actions?.aim) r.play('aim', { fade: 0.2 });
  else riggedIdle(soldier);
}

export function riggedFire(soldier) {
  const r = soldier.userData.rig;
  if (!r) return;
  if (riggedStance(soldier)) {
    // knife carry: the shot is a throw gesture, not a trigger pull. Fired
    // over the stance loop, which the overlay channel returns to after.
    if (r.state.overlay === 'knife-idle-upper' && r.actions['knife-throw-upper']) {
      r.playOverlay('knife-throw-upper', { fade: 0.08 });
    }
    r.play('aim', { fade: 0.08 }); // legs hold the combat stance
    return;
  }
  if (r.actions?.fire) r.play('fire', { fade: 0.08 });
  else riggedAim(soldier);
}
