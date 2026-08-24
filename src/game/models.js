// Low-poly procedural models: soldiers and squad vehicles.
// Everything is built from primitives so the game ships with zero assets.

import * as THREE from 'three';
import { riggedReady, makeRiggedSoldier, riggedWalk, riggedIdle, riggedDeath, riggedHit, riggedAim, riggedFire, riggedStun, riggedReload, riggedSit, makeWeaponMesh } from './rigged.js';
import { makeVegetation, scorch } from './props.js';

const mat = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });

function box(w, h, d, color) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  return m;
}

// ------------------------------------------------------------ blob shadow

let blobTexture = null;
function getBlobTexture() {
  if (blobTexture) return blobTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, 'rgba(0,0,0,0.26)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  blobTexture = new THREE.CanvasTexture(c);
  return blobTexture;
}

export function makeBlobShadow(radius = 0.55) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({ map: getBlobTexture(), transparent: true, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.02;
  m.renderOrder = 1;
  return m;
}


// Flag every lit mesh in a model tree to cast/receive real-time shadows
// (basic/holographic materials are skipped).
export function enableShadows(obj, { cast = true, receive = true } = {}) {
  obj.traverse((o) => {
    if (o.isMesh && o.material?.isMeshLambertMaterial) {
      o.castShadow = cast;
      o.receiveShadow = receive;
    }
  });
  return obj;
}

// ---------------------------------------------------------------- soldiers

export function makeSoldier(camo, opts = {}) {
  if (riggedReady()) return makeRiggedSoldier(camo, opts);
  const g = new THREE.Group();
  const dark = (c, f = 0.72) => new THREE.Color(c).multiplyScalar(f).getHex();
  const capsule = (r, len, c) => new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 3, 10), mat(c));
  const sphere = (r, c, w = 10, h = 7) => new THREE.Mesh(new THREE.SphereGeometry(r, w, h), mat(c));

  // legs (groups pivot at the hip) — smooth capsule limbs, boots stay boxy
  const legL = new THREE.Group();
  const thighL = capsule(0.078, 0.19, camo.cloth);
  thighL.position.y = -0.15;
  const shinL = capsule(0.062, 0.2, dark(camo.cloth, 0.85));
  shinL.position.y = -0.4;
  const bootL = box(0.14, 0.09, 0.25, 0x191a17);
  bootL.position.set(0, -0.53, 0.04);
  legL.add(thighL, shinL, bootL);
  legL.position.set(-0.11, 0.56, 0);
  const legR = legL.clone();
  legR.position.x = 0.11;

  // torso: capsule body + plate carrier + pouches + belt + pack
  const torso = capsule(0.2, 0.3, camo.cloth);
  torso.position.y = 0.82;
  torso.scale.z = 0.72;
  const vest = box(0.42, 0.3, 0.27, camo.vest);
  vest.position.y = 0.86;
  const pouchRow = new THREE.Group();
  for (let i = -1; i <= 1; i++) {
    const pch = box(0.1, 0.1, 0.05, dark(camo.vest, 0.8));
    pch.position.set(i * 0.13, 0.72, 0.16);
    pouchRow.add(pch);
  }
  const belt = box(0.4, 0.06, 0.28, 0x24231c);
  belt.position.y = 0.57;
  const pack = capsule(0.16, 0.2, dark(camo.cloth, 0.8));
  pack.position.set(0, 0.86, -0.22);
  pack.scale.z = 0.6;
  const shoulderL = sphere(0.085, camo.vest, 8, 6);
  shoulderL.position.set(-0.25, 1.03, 0);
  const shoulderR = shoulderL.clone();
  shoulderR.position.x = 0.25;

  // head: neck + sphere head + goggle strip + rounded helmet with brim
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.09, 8), mat(camo.skin));
  neck.position.y = 1.06;
  const head = sphere(0.115, camo.skin);
  head.position.y = 1.17;
  head.scale.set(0.92, 1, 0.95);
  const goggles = box(0.2, 0.05, 0.2, 0x14161a);
  goggles.position.set(0, 1.19, 0.01);
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.9),
    mat(camo.helmet)
  );
  helmet.position.y = 1.225;
  helmet.scale.set(1, 0.88, 1.08);
  const brim = box(0.23, 0.028, 0.25, camo.helmet);
  brim.position.y = 1.245;

  // arms (groups pivot at the shoulder)
  const armL = new THREE.Group();
  const upperL = capsule(0.058, 0.14, camo.cloth);
  upperL.position.y = -0.1;
  const foreL = capsule(0.05, 0.14, dark(camo.cloth, 0.85));
  foreL.position.set(0, -0.29, 0.02);
  const gloveL = sphere(0.052, 0x1e1d19, 8, 6);
  gloveL.position.set(0, -0.4, 0.03);
  armL.add(upperL, foreL, gloveL);
  armL.position.set(-0.27, 1.0, 0);
  const armR = armL.clone();
  armR.position.x = 0.27;

  // rifle: receiver + barrel + suppressor + foregrip + mag + stock + optic
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
  magazine.rotation.x = 0.18;
  const grip = box(0.04, 0.09, 0.05, 0x1c1f24);
  grip.position.set(0, -0.08, -0.12);
  const foregrip = box(0.035, 0.07, 0.04, 0x1c1f24);
  foregrip.position.set(0, -0.06, 0.22);
  const stock = box(0.045, 0.09, 0.16, 0x22262c);
  stock.position.set(0, -0.005, -0.3);
  const optic = box(0.035, 0.05, 0.1, 0x0e1013);
  optic.position.set(0, 0.065, 0.02);
  rifle.add(receiver, barrel, suppressor, magazine, grip, foregrip, stock, optic);
  rifle.position.set(0.12, 0.94, 0.3);
  rifle.rotation.x = -0.06;

  const shadow = makeBlobShadow(0.5);

  g.add(legL, legR, torso, vest, pouchRow, belt, pack, shoulderL, shoulderR,
    neck, head, goggles, helmet, brim, armL, armR, rifle, shadow);

  // muzzle tip in soldier-local space (for tracer origins)
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0.12, 0.92, 0.88);
  g.add(muzzle);

  g.userData.parts = {
    legL, legR, armL, armR, torso, head, rifle, muzzle,
    torsoY: 0.82, rifleRotX: -0.06
  };
  g.traverse((o) => { o.userData.soldierRoot = g; });
  enableShadows(g);
  // scale to human height (~1.75m) so soldiers stand eye-to-eye with the
  // first-person camera
  g.scale.setScalar(1.32);
  return g;
}

// Unarmed civilian / asset for escort objectives.
export function makeCivilian(shirtColor = 0x7a6a4a) {
  if (riggedReady()) {
    return makeRiggedSoldier({
      cloth: shirtColor,
      vest: new THREE.Color(shirtColor).multiplyScalar(0.8).getHex(),
      helmet: 0x2c2420, // head-top zone reads as hair on civilians
      skin: 0xc9a06c
    }, { rifle: false, mask: false, civilian: true });
  }
  const g = new THREE.Group();
  const capsule = (r, len, c) => new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 3, 10), mat(c));
  const legL = new THREE.Group();
  const thigh = capsule(0.072, 0.19, 0x33383e);
  thigh.position.y = -0.15;
  const shin = capsule(0.058, 0.2, 0x2b2f34);
  shin.position.y = -0.4;
  const shoe = box(0.13, 0.07, 0.2, 0x1c1c1a);
  shoe.position.set(0, -0.53, 0.02);
  legL.add(thigh, shin, shoe);
  legL.position.set(-0.1, 0.56, 0);
  const legR = legL.clone();
  legR.position.x = 0.1;
  const torso = capsule(0.19, 0.28, shirtColor);
  torso.position.y = 0.8;
  torso.scale.z = 0.7;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 7), mat(0xc9a06c));
  head.position.y = 1.16;
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 10, 7, 0, Math.PI * 2, 0, Math.PI / 2.1), mat(0x2c2420));
  hair.position.y = 1.19;
  const armL = new THREE.Group();
  const upper = capsule(0.052, 0.14, shirtColor);
  upper.position.y = -0.1;
  const fore = capsule(0.045, 0.14, 0xc9a06c);
  fore.position.y = -0.29;
  armL.add(upper, fore);
  armL.position.set(-0.25, 1.0, 0);
  const armR = armL.clone();
  armR.position.x = 0.25;
  g.add(legL, legR, torso, head, hair, armL, armR, makeBlobShadow(0.45));
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.9, 0.4);
  g.add(muzzle);
  g.userData.parts = { legL, legR, armL, armR, torso, head, rifle: null, muzzle, torsoY: 0.8 };
  g.traverse((o) => { o.userData.soldierRoot = g; });
  enableShadows(g);
  g.scale.setScalar(1.3);
  return g;
}

// ------------------------------------------------------ backup viewmodels

// First-person models for each squad's backup weapon. Built around the same
// anchor/orientation as the primary rifle viewmodel (pointing -Z).
// Baked weapon prefab in a camera-ready wrapper (muzzle toward -Z, matching
// the viewmodel convention). Real-size weapons overwhelm the frame at arm
// distance, so each gets a first-person presentation scale. Null when the
// bake lacks the weapon.
// First-person viewmodel built from the SAME rigged trooper the squad and
// enemies use, masked down to the arms (everything else is discarded by
// vertex alpha). The body sits so the camera is at its eyes, so the baked
// aim/fire/reload clips drive the player's hands exactly as they drive a
// bot's — no separate viewmodel rig to keep in sync.
const VM_EYE = 1.5;
const VM_BODY_SCALE = 0.88;   // slightly reduced: real-scale hands at 30cm read as giant
const VM_DROP = 0.15;         // camera rides above the shoulders so the weapon sits low
const VM_FWD = 0.26;          // body pushed forward so hands are at arm's length

export function makeRiggedViewmodel(camo, weapon, headgear = null) {
  if (!riggedReady()) return null;
  const body = makeRiggedSoldier(camo, { armsOnly: true, weapon, headgear: null, mask: true });
  if (!body) return null;
  const wrap = new THREE.Group();
  // face the camera's forward (-Z); models face +Z
  body.rotation.y = Math.PI;
  body.scale.setScalar(VM_BODY_SCALE);
  // camera just above and behind the eyes, looking over the weapon
  body.position.set(0, -(VM_EYE * VM_BODY_SCALE) - VM_DROP, -VM_FWD);
  wrap.add(body);
  wrap.userData.rig = body.userData.rig;
  wrap.userData.tick = body.userData.tick;
  return wrap;
}

const VM_SCALE = { rifle: 0.72, shotgun: 0.62, harpoon: 0.58, flashgl: 0.85, rpg: 0.45, knife: 1.0 };
// hand anchors in wrapper space (probed against the rendered weapons):
// g = trigger hand at the pistol grip, s = support hand under the forend
const VM_HANDS = {
  rifle:   { fwd: 0.08, g: [0.052, -0.058, 0.06], s: [0.05, -0.028, -0.19] },
  shotgun: { fwd: 0.08, g: [0.052, -0.055, 0.05], s: [0.05, -0.032, -0.2] },
  harpoon: { fwd: 0.08, g: [0.052, -0.055, 0.02], s: [0.05, -0.036, -0.18] },
  flashgl: { fwd: 0.08, g: [0.052, -0.055, 0.0], s: [0.05, -0.03, -0.17] },
  rpg:     { fwd: 0.08, g: [0.052, -0.055, 0.02], s: [0.05, -0.042, -0.2] },
  knife:   { fwd: 0.0, g: [0.032, -0.04, 0.02], s: null }
};

// First-person arms: sleeved forearms in the squad kit color with bare
// hands, reaching from off-screen to the grip and the forend. They live
// inside the viewmodel group, so every existing motion (sway, bob, kick,
// the grenade-toss dip) animates them for free.
function makeViewmodelArms(camo, hands) {
  const arms = new THREE.Group();
  const sleeveMat = new THREE.MeshPhongMaterial({ color: new THREE.Color(camo.cloth).multiplyScalar(1.15), specular: 0x2e2e2e, shininess: 18 });
  const skinMat = new THREE.MeshPhongMaterial({ color: camo.skin, specular: 0x262626, shininess: 14 });
  const limb = (from, to, r0, r1, mat) => {
    const f = new THREE.Vector3(...from), t = new THREE.Vector3(...to);
    const dir = new THREE.Vector3().subVectors(t, f);
    const len = dir.length();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 10), mat);
    m.position.copy(f).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return m;
  };
  const hand = (at, mat) => {
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), mat);
    h.scale.set(1, 0.8, 1.25);
    h.position.set(...at);
    return h;
  };
  const g = hands.g;
  // trigger arm comes up from the lower right, hand wraps the grip
  arms.add(limb([0.17, -0.34, 0.28], [g[0] + 0.01, g[1] - 0.02, g[2] + 0.05], 0.05, 0.036, sleeveMat));
  arms.add(hand(g, skinMat));
  if (hands.s) {
    const s = hands.s;
    // support arm from the lower left, hand under the forend
    arms.add(limb([-0.16, -0.38, 0.14], [s[0] - 0.01, s[1] - 0.025, s[2] + 0.06], 0.05, 0.034, sleeveMat));
    arms.add(hand(s, skinMat));
  }
  return arms;
}

export function makeWeaponViewmodel(name, camo) {
  const m = makeWeaponMesh(name, camo);
  if (!m) return null;
  const g = new THREE.Group();
  const hands = VM_HANDS[name] ?? VM_HANDS.rifle;
  m.rotation.y = Math.PI; // canonical barrel +Z -> camera forward -Z
  m.scale.setScalar(VM_SCALE[name] ?? 0.7);
  m.position.z = -(hands.fwd ?? 0); // keep the stock off the near plane
  g.add(m);
  g.add(makeViewmodelArms(camo, hands));
  return g;
}

const BACKUP_WEAPON = { harpoon: 'harpoon', knife: 'knife', flashgl: 'flashgl', shotgun: 'shotgun', rpg: 'rpg' };

export function makeBackupViewmodel(kind, camo = null) {
  if (camo) {
    const baked = makeWeaponViewmodel(BACKUP_WEAPON[kind] ?? kind, camo);
    if (baked) return baked;
  }
  const g = new THREE.Group();
  const cyl = (r1, r2, len, c, seg = 10) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, seg), mat(c));
    m.rotation.x = Math.PI / 2;
    return m;
  };
  switch (kind) {
    case 'harpoon': {
      const tube = cyl(0.045, 0.05, 0.6, 0x2a3540);
      tube.position.z = -0.1;
      const bolt = cyl(0.012, 0.012, 0.78, 0x9aa4ac, 6);
      bolt.position.z = -0.25;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.11, 6), mat(0xb8c2c8));
      tip.rotation.x = -Math.PI / 2;
      tip.position.z = -0.68;
      const grip = box(0.045, 0.13, 0.06, 0x1c242c);
      grip.position.set(0, -0.12, 0.12);
      const guard = box(0.1, 0.03, 0.2, 0x232d36);
      guard.position.set(0, -0.05, 0);
      g.add(tube, bolt, tip, grip, guard);
      break;
    }
    case 'knife': {
      const housing = box(0.06, 0.08, 0.28, 0x2c3326);
      housing.position.z = 0.02;
      const blade = box(0.012, 0.05, 0.34, 0xaeb8be);
      blade.position.z = -0.28;
      const edge = box(0.006, 0.06, 0.3, 0xd6dde2);
      edge.position.set(0, -0.005, -0.26);
      const grip = box(0.05, 0.14, 0.07, 0x1a1f16);
      grip.position.set(0, -0.12, 0.1);
      const spring = cyl(0.03, 0.03, 0.1, 0x40483a, 8);
      spring.position.z = -0.08;
      g.add(housing, blade, edge, grip, spring);
      break;
    }
    case 'flashgl': {
      const barrel = cyl(0.065, 0.07, 0.42, 0x2e2c22);
      barrel.position.z = -0.12;
      const muzzleRing = cyl(0.075, 0.075, 0.05, 0x1c1a14);
      muzzleRing.position.z = -0.34;
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.09, 12), mat(0x3a382c));
      drum.rotation.z = Math.PI / 2;
      drum.position.set(0, -0.06, 0.1);
      const grip = box(0.05, 0.14, 0.07, 0x1c1a14);
      grip.position.set(0, -0.16, 0.2);
      const sight = box(0.03, 0.06, 0.05, 0x14120e);
      sight.position.set(0, 0.09, -0.05);
      g.add(barrel, muzzleRing, drum, grip, sight);
      break;
    }
    case 'shotgun': {
      const receiver = box(0.055, 0.09, 0.32, 0x27221c);
      receiver.position.z = 0.05;
      const barrel = cyl(0.026, 0.026, 0.5, 0x14161a);
      barrel.position.set(0, 0.02, -0.3);
      const magTube = cyl(0.02, 0.02, 0.42, 0x1c1e22);
      magTube.position.set(0, -0.03, -0.26);
      const pump = box(0.06, 0.06, 0.14, 0x3a2f24);
      pump.position.set(0, -0.03, -0.32);
      const stock = box(0.05, 0.1, 0.18, 0x3a2f24);
      stock.position.set(0, -0.02, 0.26);
      g.add(receiver, barrel, magTube, pump, stock);
      break;
    }
    case 'rpg': {
      const tube = cyl(0.055, 0.055, 0.85, 0x3a4034);
      tube.position.z = 0.05;
      const flare = cyl(0.085, 0.055, 0.16, 0x31362c);
      flare.position.z = 0.5;
      const warhead = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.3, 10), mat(0x4a5a3a));
      warhead.rotation.x = -Math.PI / 2;
      warhead.position.z = -0.5;
      const band = cyl(0.06, 0.06, 0.04, 0x8a4a2a);
      band.position.z = -0.34;
      const grip = box(0.05, 0.14, 0.07, 0x1c1a14);
      grip.position.set(0, -0.14, 0.1);
      g.add(tube, flare, warhead, band, grip);
      break;
    }
  }
  return g;
}

// ------------------------------------------------------- decision gates

// Holographic route gate: a glimmering doorway-filling frame with a large
// floating option label plus its true odds and payout, styled like a
// modern military HUD projection. Risk class tints the whole gate.
const GATE_ACCENTS = {
  safe: { hex: 0x7dffa0, css: '125, 255, 160', text: '#d6ffe2' },
  std: { hex: 0xffd27a, css: '255, 210, 122', text: '#ffedc9' },
  risky: { hex: 0xff7a5a, css: '255, 122, 90', text: '#ffd9cd' },
  locked: { hex: 0x9aa8a0, css: '154, 168, 160', text: '#c8d2cc' }
};

export function makeGate(text, { risk = 'std', pct = null, pay = null, width = 4.7 } = {}) {
  const g = new THREE.Group();
  const accent = GATE_ACCENTS[risk] ?? GATE_ACCENTS.std;
  const half = width / 2;

  const frameMat = new THREE.MeshBasicMaterial({
    color: accent.hex, transparent: true, opacity: 0.55, depthWrite: false
  });
  const postL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 3.0, 0.09), frameMat);
  postL.position.set(-half, 1.5, 0);
  const postR = postL.clone();
  postR.position.x = half;
  const topBar = new THREE.Mesh(new THREE.BoxGeometry(width + 0.1, 0.08, 0.08), frameMat);
  topBar.position.y = 3.0;
  const sill = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.05, 0.4),
    new THREE.MeshBasicMaterial({ color: accent.hex, transparent: true, opacity: 0.22, depthWrite: false })
  );
  sill.position.y = 0.03;
  g.add(postL, postR, topBar, sill);

  // label plate, drawn to canvas
  const c = document.createElement('canvas');
  c.width = 768; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 768, 256);
  ctx.fillStyle = 'rgba(6, 14, 10, 0.78)';
  ctx.beginPath();
  ctx.moveTo(36, 26); ctx.lineTo(732, 26); ctx.lineTo(752, 46); ctx.lineTo(752, 210);
  ctx.lineTo(732, 230); ctx.lineTo(36, 230); ctx.lineTo(16, 210); ctx.lineTo(16, 46);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = `rgba(${accent.css}, 0.95)`;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  // corner brackets
  ctx.lineWidth = 6;
  for (const [x, sx] of [[8, 1], [760, -1]]) {
    ctx.beginPath();
    ctx.moveTo(x + sx * 34, 12); ctx.lineTo(x, 12); ctx.lineTo(x, 44);
    ctx.moveTo(x + sx * 34, 244); ctx.lineTo(x, 244); ctx.lineTo(x, 212);
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(160, 175, 168, 0.95)';
  ctx.font = '600 22px monospace';
  const riskTag = risk === 'locked' ? 'SEALED'
    : risk === 'safe' ? 'LOW RISK' : risk === 'risky' ? 'HIGH RISK' : 'STANDARD';
  ctx.fillText(`◤ ROUTE — ${riskTag} ◥`, 384, 62);
  // big option text
  const label = text.toUpperCase();
  let size = 58;
  ctx.font = `700 ${size}px monospace`;
  while (ctx.measureText(label).width > 660 && size > 26) {
    size -= 2;
    ctx.font = `700 ${size}px monospace`;
  }
  ctx.shadowColor = `rgba(${accent.css}, 0.95)`;
  ctx.shadowBlur = 22;
  ctx.fillStyle = accent.text;
  ctx.fillText(label, 384, 138);
  ctx.shadowBlur = 0;
  // odds + payout line
  if (pct !== null) {
    ctx.font = '700 40px monospace';
    ctx.shadowBlur = 12;
    ctx.shadowColor = `rgba(${accent.css}, 0.8)`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`SUCCESS ${pct}%   ▸   PAYS ${pay}`, 384, 202);
    ctx.shadowBlur = 0;
  }

  const tex = new THREE.CanvasTexture(c);
  const textMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(4.35, 1.45),
    new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.94,
      side: THREE.DoubleSide, depthWrite: false
    })
  );
  textMesh.position.y = 1.85;
  g.add(textMesh);

  g.userData = { textMesh, textY: 1.85, frameMat };
  return g;
}

// ------------------------------------------------------- objective props

// Baked objective set-pieces. The cache is a stack of the baked weapons
// crate; the rest map straight onto their props.bin kind.
function makeBakedObjective(kind) {
  if (kind === 'cache') {
    const a = makeVegetation('cache');
    if (!a) return null;
    const g = new THREE.Group();
    const h = a.userData.vegHeight;
    g.add(a);
    const b = makeVegetation('cache');
    b.position.set(0.16, h * 0.98, 0.08);
    b.rotation.y = 0.42;
    const c = makeVegetation('cache');
    c.position.set(-1.02, 0, 0.55);
    c.rotation.y = -0.55;
    g.add(b, c);
    return g;
  }
  if (kind === 'aa') {
    // the cannon asset is bare — emplace it: pedestal + pivot, barrel up
    const gun = makeVegetation('aa');
    if (!gun) return null;
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.72, 0.36, 10), mat(0x3a3f36));
    base.position.y = 0.18;
    const pivot = box(0.36, 0.55, 0.36, 0x2f342c);
    pivot.position.y = 0.6;
    g.add(base, pivot);
    gun.position.y = 0.88;
    gun.rotation.z = 0.52; // barrel runs +x — tip the muzzle skyward
    g.add(gun);
    return g;
  }
  if (kind === 'comms' || kind === 'generator' || kind === 'mortar') {
    return makeVegetation(kind);
  }
  return null;
}

// Destructible / interactable objective targets. Baked set-piece assets
// (props.bin) are preferred; the primitive builders below are the fallback.
export function makeObjectiveProp(kind) {
  const baked = makeBakedObjective(kind);
  if (baked) return baked;
  const g = new THREE.Group();
  switch (kind) {
    case 'cache': {
      const crate = (x, y, z, w = 1.1) => {
        const c = box(w, 0.7, 0.8, 0x5d4f30);
        c.position.set(x, y, z);
        c.rotation.y = (x + z) * 0.4;
        return c;
      };
      g.add(crate(0, 0.35, 0), crate(0.9, 0.35, 0.3), crate(-0.7, 0.35, 0.5), crate(0.2, 1.02, 0.2));
      const tin = box(0.5, 0.3, 0.32, 0x3d4a35);
      tin.position.set(-0.6, 0.86, 0.4);
      g.add(tin);
      break;
    }
    case 'comms': {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 5.4, 6), new THREE.MeshLambertMaterial({ color: 0x4a4f55 }));
      mast.position.y = 2.7;
      const dish = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 7, 0, Math.PI), new THREE.MeshLambertMaterial({ color: 0x9aa2a8, side: THREE.DoubleSide }));
      dish.position.set(0.3, 4.3, 0);
      dish.rotation.z = -Math.PI / 2.4;
      const radio = box(1.0, 0.9, 0.7, 0x3a4046);
      radio.position.set(0.2, 0.45, 0.5);
      const cable = box(0.05, 0.05, 1.1, 0x22262a);
      cable.position.set(0.1, 0.06, 0);
      g.add(mast, dish, radio, cable);
      break;
    }
    case 'generator': {
      const body = box(1.7, 1.05, 0.95, 0x3d5238);
      body.position.y = 0.55;
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.5, 10), new THREE.MeshLambertMaterial({ color: 0x2f4029 }));
      tank.rotation.z = Math.PI / 2;
      tank.position.y = 1.3;
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 6), new THREE.MeshLambertMaterial({ color: 0x22262a }));
      pipe.position.set(0.6, 1.6, 0.2);
      g.add(body, tank, pipe);
      break;
    }
    case 'aa': {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.05, 0.5, 10), new THREE.MeshLambertMaterial({ color: 0x44483c }));
      base.position.y = 0.25;
      g.add(base);
      for (let i = 0; i < 4; i++) {
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.9, 8), new THREE.MeshLambertMaterial({ color: 0x53584a }));
        tube.position.set((i % 2 - 0.5) * 0.5, 1.05, (Math.floor(i / 2) - 0.5) * 0.5);
        tube.rotation.x = -Math.PI / 3.2;
        g.add(tube);
      }
      break;
    }
    case 'mortar': {
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.12, 10), new THREE.MeshLambertMaterial({ color: 0x3a3d35 }));
      plate.position.y = 0.06;
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.13, 1.3, 8), new THREE.MeshLambertMaterial({ color: 0x4a4e42 }));
      tube.position.set(0, 0.65, -0.15);
      tube.rotation.x = -0.5;
      const legA = box(0.06, 0.9, 0.06, 0x33362e);
      legA.position.set(0.3, 0.45, 0.25);
      legA.rotation.z = 0.4;
      const legB = legA.clone();
      legB.position.x = -0.3;
      legB.rotation.z = -0.4;
      const shells = box(0.7, 0.35, 0.5, 0x5d4f30);
      shells.position.set(0.9, 0.18, 0.3);
      g.add(plate, tube, legA, legB, shells);
      break;
    }
    case 'console': {
      const desk = box(1.25, 0.7, 0.66, 0x4d545c);
      desk.position.y = 0.35;
      const deskTop = box(1.34, 0.06, 0.74, 0x5b636c);
      deskTop.position.y = 0.72;
      g.add(desk, deskTop);
      const pc = makeVegetation('computer', null, { vary: false });
      if (pc) {
        // baked terminal standing on the desk, screen toward the player. The
        // lit-screen plane is derived from the model's own bounds so it lands
        // flush on the front face rather than at a guessed offset.
        const geo = pc.children[0].geometry;
        geo.computeBoundingBox();
        const bb = geo.boundingBox;
        const s = pc.children[0].scale.x;
        // isolate the monitor (everything in the model's top 40%) so the lit
        // screen lands on the display, not on the whole desktop's centre
        const p = geo.attributes.position;
        const cut = bb.min.y + (bb.max.y - bb.min.y) * 0.6;
        let sx = 0, n = 0, wMin = Infinity, wMax = -Infinity, frontZ = -Infinity;
        for (let i = 0; i < p.count; i++) {
          if (p.getY(i) < cut) continue;
          const x = p.getX(i);
          sx += x; n++;
          wMin = Math.min(wMin, x);
          wMax = Math.max(wMax, x);
          frontZ = Math.max(frontZ, p.getZ(i));
        }
        const glow = new THREE.Mesh(
          new THREE.PlaneGeometry(
            Math.max(0.12, (wMax - wMin) * s * 0.74),
            Math.max(0.1, (bb.max.y - cut) * s * 0.66)
          ),
          new THREE.MeshBasicMaterial({ color: 0x6fd6ff, transparent: true, opacity: 0.7 })
        );
        glow.position.set(
          n > 0 ? (sx / n) * s : 0,
          (cut + (bb.max.y - cut) * 0.55) * s,
          frontZ * s + 0.012
        );
        pc.add(glow);
        pc.scale.setScalar(1.25);
        pc.position.set(0, 0.75, -0.04);
        g.add(pc);
      } else {
        const screen = box(0.7, 0.45, 0.06, 0x14181d);
        screen.position.set(0, 1.05, -0.2);
        screen.rotation.x = -0.15;
        const glow = new THREE.Mesh(
          new THREE.PlaneGeometry(0.6, 0.35),
          new THREE.MeshBasicMaterial({ color: 0x6fd6ff })
        );
        glow.position.set(0, 1.05, -0.165);
        glow.rotation.x = -0.15;
        g.add(screen, glow);
      }
      const keyboard = box(0.5, 0.04, 0.25, 0x22262c);
      keyboard.position.set(0, 0.78, 0.24);
      g.add(keyboard);
      break;
    }
    case 'charge': {
      const stack = box(1.5, 0.9, 0.9, 0x41443c);
      stack.position.y = 0.45;
      const stack2 = box(1.0, 0.6, 0.7, 0x35382f);
      stack2.position.set(0.4, 1.2, 0);
      const stripe = box(1.52, 0.12, 0.92, 0x8a6a2a);
      stripe.position.y = 0.6;
      g.add(stack, stack2, stripe);
      break;
    }
  }
  g.add(makeBlobShadow(1.3));
  g.userData.wreck = () => {
    g.traverse((o) => {
      if (o.isMesh && !o.material?.map) {
        o.material = new THREE.MeshLambertMaterial({ color: 0x181614 });
      }
    });
    g.scale.y = Math.max(0.45, g.scale.y * 0.55);
  };
  return enableShadows(g);
}

export function animateWalk(soldier, t, speed = 1) {
  if (soldier.userData.rig) return riggedWalk(soldier, t, speed);
  const p = soldier.userData.parts;
  const ph = t * 7 * speed;
  const s = Math.sin(ph);
  p.legL.rotation.x = s * 0.55;
  p.legR.rotation.x = -s * 0.55;
  // arms counter-swing (kept subtle — hands are on the weapon)
  p.armL.rotation.x = -s * 0.22;
  p.armR.rotation.x = s * 0.16;
  // gait bounce + slight forward lean
  p.torso.position.y = (p.torsoY ?? 0.82) + Math.abs(Math.cos(ph)) * 0.022;
  soldier.rotation.x = 0.03 * Math.min(1, speed);
  if (p.rifle) p.rifle.rotation.x = (p.rifleRotX ?? -0.06) + Math.sin(ph * 2) * 0.012;
}

// Start a death animation ('gunfire' or 'explosion'). Returns the clip
// duration, or 0 when the model has no baked death clips (caller falls
// back to the procedural collapse).
export function startDeath(soldier, cause = 'gunfire') {
  if (soldier.userData.rig) return riggedDeath(soldier, cause);
  return 0;
}

// One-shot magazine change. Returns the clip duration (0 = unavailable).
export function startReload(soldier) {
  if (soldier.userData.rig) return riggedReload(soldier);
  return 0;
}

// Seated transport idle (insertion cinematic). Falls back to standing idle.
export function poseSit(soldier, t = 0) {
  if (soldier.userData.rig && riggedSit(soldier)) return;
  poseIdle(soldier, t);
}

// One-shot flinch on a non-lethal hit (no-op on procedural models).
export function startHit(soldier) {
  if (soldier.userData.rig) return riggedHit(soldier);
  return 0;
}

// Combat stances — weapon shouldered / firing. Procedural models keep
// their idle pose.
export function poseCombat(soldier, t = 0) {
  if (soldier.userData.rig) return riggedAim(soldier);
  poseIdle(soldier, t);
}

export function poseFire(soldier, t = 0) {
  if (soldier.userData.rig) return riggedFire(soldier);
  poseIdle(soldier, t);
}

// Flashbang daze. Procedural models sway in place instead.
export function poseStun(soldier, t = 0) {
  if (soldier.userData.rig && riggedStun(soldier)) return;
  poseIdle(soldier, t);
  soldier.rotation.y += Math.sin(t * 16) * 0.02;
}

export function poseIdle(soldier, t = 0) {
  if (soldier.userData.rig) return riggedIdle(soldier);
  const p = soldier.userData.parts;
  p.legL.rotation.x = 0;
  p.legR.rotation.x = 0;
  p.armL.rotation.x = 0;
  p.armR.rotation.x = 0;
  soldier.rotation.x = 0;
  // breathing + weapon sway
  p.torso.position.y = (p.torsoY ?? 0.82) + Math.sin(t * 1.7) * 0.008;
  if (p.rifle) p.rifle.rotation.x = (p.rifleRotX ?? -0.06) + Math.sin(t * 1.3) * 0.01;
}

// ---------------------------------------------------------------- vehicles

export function makeVehicle(type) {
  switch (type) {
    case 'boat': return enableShadows(makeBoat());
    case 'heli': return enableShadows(makeHeli());
    case 'parachute': return enableShadows(makeParachute());
    case 'apc': return enableShadows(makeApc());
    case 'truck': return enableShadows(makeTruck());
    case 'humvee':
    default: return enableShadows(makeHumvee());
  }
}

function wheels(g, positions, r = 0.32) {
  const geo = new THREE.CylinderGeometry(r, r, 0.22, 10);
  geo.rotateZ(Math.PI / 2);
  for (const [x, y, z] of positions) {
    const w = new THREE.Mesh(geo, mat(0x111214));
    w.position.set(x, y, z);
    g.add(w);
  }
}

function makeHumvee() {
  const g = new THREE.Group();
  const hull = box(1.9, 0.7, 3.4, 0x4c4a38);
  hull.position.y = 0.75;
  const cab = box(1.7, 0.55, 1.6, 0x54523e);
  cab.position.set(0, 1.35, -0.2);
  const turret = box(0.5, 0.3, 0.9, 0x3a3828);
  turret.position.set(0, 1.75, -0.2);
  g.add(hull, cab, turret);
  wheels(g, [[-0.95, 0.35, 1.15], [0.95, 0.35, 1.15], [-0.95, 0.35, -1.15], [0.95, 0.35, -1.15]]);
  return g;
}

function makeApc() {
  const g = new THREE.Group();
  const hull = box(2.1, 1.0, 4.2, 0x181b1f);
  hull.position.y = 0.95;
  const cab = box(1.9, 0.6, 1.8, 0x22262b);
  cab.position.set(0, 1.7, -0.5);
  g.add(hull, cab);
  wheels(g, [[-1.05, 0.4, 1.4], [1.05, 0.4, 1.4], [-1.05, 0.4, -1.4], [1.05, 0.4, -1.4]], 0.4);
  return g;
}

function makeTruck() {
  const g = new THREE.Group();
  const bed = box(1.8, 0.5, 2.2, 0x3f4a33);
  bed.position.set(0, 0.85, 0.7);
  const cab = box(1.8, 0.9, 1.3, 0x46523a);
  cab.position.set(0, 1.05, -1.0);
  const roll = box(1.7, 0.08, 0.08, 0x2a3322);
  roll.position.set(0, 1.6, 0.2);
  g.add(bed, cab, roll);
  wheels(g, [[-0.95, 0.4, 1.2], [0.95, 0.4, 1.2], [-0.95, 0.4, -1.2], [0.95, 0.4, -1.2]], 0.4);
  return g;
}

function makeBoat() {
  const g = new THREE.Group();
  const hullGeo = new THREE.CylinderGeometry(0.5, 0.5, 3.6, 8, 1);
  hullGeo.rotateX(Math.PI / 2);
  const tubeL = new THREE.Mesh(hullGeo, mat(0x20242a));
  const tubeR = tubeL.clone();
  tubeL.position.set(-0.75, 0.4, 0);
  tubeR.position.set(0.75, 0.4, 0);
  const deck = box(1.5, 0.18, 3.2, 0x2c3138);
  deck.position.y = 0.42;
  const console = box(0.6, 0.5, 0.4, 0x171a1f);
  console.position.set(0, 0.75, -0.6);
  const motor = box(0.3, 0.5, 0.25, 0x101215);
  motor.position.set(0, 0.55, -1.75);
  g.add(tubeL, tubeR, deck, console, motor);
  return g;
}

function makeHeli() {
  const g = new THREE.Group();
  const body = box(1.4, 1.1, 3.6, 0x2f3630);
  body.position.y = 1.2;
  const tail = box(0.4, 0.4, 2.4, 0x2a302b);
  tail.position.set(0, 1.4, -2.8);
  const rotor = box(0.14, 0.05, 7.5, 0x14161a);
  rotor.position.y = 1.95;
  rotor.name = 'rotor';
  const skidL = box(0.1, 0.1, 2.6, 0x1a1d20);
  const skidR = skidL.clone();
  skidL.position.set(-0.7, 0.25, 0);
  skidR.position.set(0.7, 0.25, 0);
  g.add(body, tail, rotor, skidL, skidR);
  return g;
}

// Hostile technical / getaway car for the 'car' set-piece. Returns a group
// with userData.wreck() that chars it into a burnt-out husk.
export function makeCar(rng, { burnt = false } = {}) {
  // baked vehicle when props.bin is loaded; wreck() chars the paint in place
  const baked = makeVegetation('car', rng, { vary: false, burnt });
  if (baked) {
    baked.add(makeBlobShadow(1.9));
    baked.userData.wreck = () => {
      scorch(baked);
      baked.scale.y = 0.86; // settles on its suspension
    };
    return enableShadows(baked);
  }
  const g = new THREE.Group();
  const paint = rng?.pick?.([0x7a2f28, 0x2f4a5c, 0x777d6a, 0x40403c]) ?? 0x7a2f28;
  const body = box(1.7, 0.55, 3.9, paint);
  body.position.y = 0.62;
  const cabin = box(1.55, 0.5, 1.9, paint);
  cabin.position.set(0, 1.08, -0.25);
  const glass = box(1.45, 0.34, 1.75, 0x1c262e);
  glass.position.set(0, 1.12, -0.25);
  const bumperF = box(1.75, 0.22, 0.25, 0x22242a);
  bumperF.position.set(0, 0.42, 2.0);
  const bumperB = bumperF.clone();
  bumperB.position.z = -2.0;
  g.add(body, cabin, glass, bumperF, bumperB, makeBlobShadow(1.9));
  wheels(g, [[-0.88, 0.34, 1.3], [0.88, 0.34, 1.3], [-0.88, 0.34, -1.3], [0.88, 0.34, -1.3]], 0.34);
  g.userData.wreck = () => {
    g.traverse((o) => {
      if (o.isMesh && !o.material?.map) {
        o.material = new THREE.MeshLambertMaterial({ color: 0x181614 });
      }
    });
    g.scale.y = 0.72;
  };
  return enableShadows(g);
}

function makeParachute() {
  const g = new THREE.Group();
  const canopyGeo = new THREE.SphereGeometry(2.6, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.6);
  const canopy = new THREE.Mesh(canopyGeo, mat(0x4a5240, { side: THREE.DoubleSide }));
  canopy.position.y = 4.6;
  g.add(canopy);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x0d0f11 });
  for (const [x, z] of [[-1.6, 0], [1.6, 0], [0, -1.6], [0, 1.6]]) {
    const pts = [new THREE.Vector3(x, 4.9, z), new THREE.Vector3(0, 1.4, 0)];
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
  }
  return g;
}
