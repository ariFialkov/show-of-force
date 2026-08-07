// Low-poly procedural models: soldiers and squad vehicles.
// Everything is built from primitives so the game ships with zero assets.

import * as THREE from 'three';

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
  grad.addColorStop(0, 'rgba(0,0,0,0.42)');
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

// ---------------------------------------------------------------- soldiers

export function makeSoldier(camo) {
  const g = new THREE.Group();
  const dark = (c, f = 0.72) => new THREE.Color(c).multiplyScalar(f).getHex();

  // legs (pivot at hip for walk anim) with boots
  const legL = new THREE.Group();
  const thighL = box(0.15, 0.34, 0.17, camo.cloth);
  thighL.position.y = -0.17;
  const shinL = box(0.13, 0.16, 0.15, dark(camo.cloth, 0.85));
  shinL.position.y = -0.42;
  const bootL = box(0.15, 0.09, 0.24, 0x191a17);
  bootL.position.set(0, -0.53, 0.03);
  legL.add(thighL, shinL, bootL);
  legL.position.set(-0.11, 0.56, 0);
  const legR = legL.clone();
  legR.position.x = 0.11;

  // torso: shirt + plate carrier + pouches + belt + backpack
  const torso = box(0.42, 0.5, 0.24, camo.cloth);
  torso.position.y = 0.8;
  const vest = box(0.46, 0.32, 0.3, camo.vest);
  vest.position.y = 0.84;
  const pouchRow = new THREE.Group();
  for (let i = -1; i <= 1; i++) {
    const p = box(0.1, 0.1, 0.05, dark(camo.vest, 0.8));
    p.position.set(i * 0.13, 0.72, 0.17);
    pouchRow.add(p);
  }
  const belt = box(0.44, 0.06, 0.26, 0x24231c);
  belt.position.y = 0.57;
  const pack = box(0.34, 0.36, 0.14, dark(camo.cloth, 0.8));
  pack.position.set(0, 0.86, -0.2);
  const shoulderL = box(0.14, 0.07, 0.2, camo.vest);
  shoulderL.position.set(-0.26, 1.03, 0);
  const shoulderR = shoulderL.clone();
  shoulderR.position.x = 0.26;

  // head: face + goggle strip + rounded helmet with brim
  const head = box(0.2, 0.2, 0.2, camo.skin);
  head.position.y = 1.16;
  const goggles = box(0.21, 0.055, 0.21, 0x14161a);
  goggles.position.set(0, 1.19, 0.005);
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.155, 10, 7, 0, Math.PI * 2, 0, Math.PI / 1.9),
    new THREE.MeshLambertMaterial({ color: camo.helmet })
  );
  helmet.position.y = 1.235;
  helmet.scale.set(1, 0.85, 1.06);
  const brim = box(0.24, 0.03, 0.26, camo.helmet);
  brim.position.y = 1.245;

  // arms
  const armL = new THREE.Group();
  const upperL = box(0.12, 0.24, 0.14, camo.cloth);
  upperL.position.y = -0.1;
  const foreL = box(0.1, 0.18, 0.12, dark(camo.cloth, 0.85));
  foreL.position.y = -0.3;
  const gloveL = box(0.09, 0.07, 0.1, 0x1e1d19);
  gloveL.position.y = -0.41;
  armL.add(upperL, foreL, gloveL);
  armL.position.set(-0.28, 1.0, 0);
  const armR = armL.clone();
  armR.position.x = 0.28;

  // rifle: receiver + barrel + suppressor + foregrip + mag + stock + optic
  const rifle = new THREE.Group();
  const receiver = box(0.055, 0.08, 0.42, 0x14161a);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.3, 6), new THREE.MeshLambertMaterial({ color: 0x101215 }));
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.01, 0.33);
  const suppressor = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.12, 6), new THREE.MeshLambertMaterial({ color: 0x0c0e10 }));
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
    head, goggles, helmet, brim, armL, armR, rifle, shadow);

  // muzzle tip in soldier-local space (for tracer origins)
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0.12, 0.92, 0.88);
  g.add(muzzle);

  g.userData.parts = { legL, legR, armL, armR, torso, head, rifle, muzzle };
  g.traverse((o) => { o.userData.soldierRoot = g; });
  // scale to human height (~1.75m) so soldiers stand eye-to-eye with the
  // first-person camera
  g.scale.setScalar(1.32);
  return g;
}

// Unarmed civilian / asset for escort objectives.
export function makeCivilian(shirtColor = 0x7a6a4a) {
  const g = new THREE.Group();
  const legL = new THREE.Group();
  const thigh = box(0.14, 0.34, 0.16, 0x33383e);
  thigh.position.y = -0.17;
  const shin = box(0.12, 0.18, 0.13, 0x2b2f34);
  shin.position.y = -0.43;
  const shoe = box(0.13, 0.07, 0.2, 0x1c1c1a);
  shoe.position.set(0, -0.54, 0.02);
  legL.add(thigh, shin, shoe);
  legL.position.set(-0.1, 0.56, 0);
  const legR = legL.clone();
  legR.position.x = 0.1;
  const torso = box(0.4, 0.5, 0.22, shirtColor);
  torso.position.y = 0.8;
  const head = box(0.19, 0.2, 0.19, 0xc9a06c);
  head.position.y = 1.16;
  const hair = box(0.2, 0.07, 0.2, 0x2c2420);
  hair.position.y = 1.28;
  const armL = new THREE.Group();
  const upper = box(0.11, 0.24, 0.13, shirtColor);
  upper.position.y = -0.1;
  const fore = box(0.09, 0.18, 0.11, 0xc9a06c);
  fore.position.y = -0.3;
  armL.add(upper, fore);
  armL.position.set(-0.26, 1.0, 0);
  const armR = armL.clone();
  armR.position.x = 0.26;
  g.add(legL, legR, torso, head, hair, armL, armR, makeBlobShadow(0.45));
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.9, 0.4);
  g.add(muzzle);
  g.userData.parts = { legL, legR, armL, armR, torso, head, rifle: new THREE.Group(), muzzle };
  g.traverse((o) => { o.userData.soldierRoot = g; });
  g.scale.setScalar(1.3);
  return g;
}

// ------------------------------------------------------- decision gates

// Holographic route gate: a glimmering doorway-filling frame with a large
// floating option label plus its true odds and payout, styled like a
// modern military HUD projection. Risk class tints the whole gate.
const GATE_ACCENTS = {
  safe: { hex: 0x7dffa0, css: '125, 255, 160', text: '#d6ffe2' },
  std: { hex: 0xffd27a, css: '255, 210, 122', text: '#ffedc9' },
  risky: { hex: 0xff7a5a, css: '255, 122, 90', text: '#ffd9cd' }
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
  const riskTag = risk === 'safe' ? 'LOW RISK' : risk === 'risky' ? 'HIGH RISK' : 'STANDARD';
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

// Destructible / interactable objective targets.
export function makeObjectiveProp(kind) {
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
      const desk = box(1.3, 0.75, 0.7, 0x3c4148);
      desk.position.y = 0.38;
      const screen = box(0.7, 0.45, 0.06, 0x14181d);
      screen.position.set(0, 1.05, -0.2);
      screen.rotation.x = -0.15;
      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(0.6, 0.35),
        new THREE.MeshBasicMaterial({ color: 0x6fd6ff })
      );
      glow.position.set(0, 1.05, -0.165);
      glow.rotation.x = -0.15;
      const keyboard = box(0.5, 0.04, 0.25, 0x22262c);
      keyboard.position.set(0, 0.78, 0.1);
      g.add(desk, screen, glow, keyboard);
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
