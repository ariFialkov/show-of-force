// Low-poly procedural models: soldiers and squad vehicles.
// Everything is built from primitives so the game ships with zero assets.

import * as THREE from 'three';

const mat = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });

function box(w, h, d, color) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  return m;
}

// ---------------------------------------------------------------- soldiers

export function makeSoldier(camo) {
  const g = new THREE.Group();

  const legL = box(0.16, 0.5, 0.18, camo.cloth);
  const legR = legL.clone();
  legL.position.set(-0.11, 0.25, 0);
  legR.position.set(0.11, 0.25, 0);
  // pivot legs at hip for walk anim
  legL.geometry = legL.geometry.clone(); legL.geometry.translate(0, -0.25, 0); legL.position.y = 0.5;
  legR.geometry = legR.geometry.clone(); legR.geometry.translate(0, -0.25, 0); legR.position.y = 0.5;

  const torso = box(0.44, 0.52, 0.26, camo.cloth);
  torso.position.y = 0.76;
  const vest = box(0.5, 0.34, 0.32, camo.vest);
  vest.position.y = 0.8;

  const head = box(0.22, 0.22, 0.22, camo.skin);
  head.position.y = 1.14;
  const helmet = box(0.28, 0.14, 0.28, camo.helmet);
  helmet.position.y = 1.25;

  const armL = box(0.13, 0.42, 0.15, camo.cloth);
  armL.geometry.translate(0, -0.18, 0);
  armL.position.set(-0.29, 0.98, 0);
  const armR = armL.clone();
  armR.position.x = 0.29;

  // rifle held forward
  const rifle = new THREE.Group();
  const body = box(0.06, 0.09, 0.62, 0x14161a);
  const magazine = box(0.05, 0.14, 0.08, 0x1c1f24);
  magazine.position.set(0, -0.1, 0.02);
  const stock = box(0.05, 0.1, 0.16, 0x22262c);
  stock.position.set(0, -0.01, -0.34);
  rifle.add(body, magazine, stock);
  rifle.position.set(0.12, 0.92, 0.3);
  rifle.rotation.x = -0.06;

  g.add(legL, legR, torso, vest, head, helmet, armL, armR, rifle);

  // muzzle tip in soldier-local space (for tracer origins)
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0.12, 0.9, 0.65);
  g.add(muzzle);

  g.userData.parts = { legL, legR, armL, armR, torso, head, rifle, muzzle };
  g.traverse((o) => { o.userData.soldierRoot = g; });
  // scale to human height (~1.75m) so soldiers stand eye-to-eye with the
  // first-person camera
  g.scale.setScalar(1.32);
  return g;
}

export function animateWalk(soldier, t, speed = 1) {
  const p = soldier.userData.parts;
  const s = Math.sin(t * 7 * speed) * 0.5;
  p.legL.rotation.x = s;
  p.legR.rotation.x = -s;
}

export function poseIdle(soldier) {
  const p = soldier.userData.parts;
  p.legL.rotation.x = 0;
  p.legR.rotation.x = 0;
}

// ---------------------------------------------------------------- vehicles

export function makeVehicle(type) {
  switch (type) {
    case 'boat': return makeBoat();
    case 'heli': return makeHeli();
    case 'parachute': return makeParachute();
    case 'apc': return makeApc();
    case 'truck': return makeTruck();
    case 'humvee':
    default: return makeHumvee();
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
export function makeCar(rng) {
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
  g.add(body, cabin, glass, bumperF, bumperB);
  wheels(g, [[-0.88, 0.34, 1.3], [0.88, 0.34, 1.3], [-0.88, 0.34, -1.3], [0.88, 0.34, -1.3]], 0.34);
  g.userData.wreck = () => {
    g.traverse((o) => {
      if (o.isMesh) o.material = new THREE.MeshLambertMaterial({ color: 0x181614 });
    });
    g.scale.y = 0.72;
  };
  return g;
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
