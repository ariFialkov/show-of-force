// Builds the themed 3D environment from a generated map + location env spec.

import * as THREE from 'three';
import { makeVegetation } from './props.js';

const lambert = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });

// baked-FBX asset per prop name: [kind in props.bin, placement scale].
// Falls back to the procedural builders below when props.bin hasn't loaded.
const BAKED_KIND = {
  palm: ['palm', 1], tree: ['leafy', 1], pine: ['fir', 1], fern: ['bush', 0.85],
  cactus: ['cactus', 1], rock: ['debris', 0.55], statue: ['statue', 1],
  barrier: ['barrier', 1], debris: ['debris', 1], fountain: ['fountain', 1]
};

// --------------------------------------------------- procedural textures
//
// Canvas-generated tiling textures give surfaces grain and detail at
// near-zero memory/GPU cost (a couple of dozen small textures per world).

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

// Weathered plaster/mud-brick wall: mortar courses with staggered joints,
// cracks, rain streaks and a grime band at the base. Drawn on a near-white
// base so the env wall colour tints it via the material.
function wallSurfaceTexture() {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f2efe9';
  ctx.fillRect(0, 0, N, N);
  // tonal patches
  for (let i = 0; i < 16; i++) {
    const v = 225 + (Math.random() - 0.5) * 46;
    ctx.fillStyle = `rgba(${v | 0},${(v * 0.985) | 0},${(v * 0.95) | 0},0.45)`;
    ctx.beginPath();
    ctx.ellipse(Math.random() * N, Math.random() * N, 26 + Math.random() * 60, 18 + Math.random() * 44, Math.random() * 3, 0, 7);
    ctx.fill();
  }
  // fine speckle
  for (let i = 0; i < 2200; i++) {
    const v = (Math.random() - 0.5) * 44;
    ctx.fillStyle = `rgba(${(228 + v) | 0},${(224 + v) | 0},${(216 + v) | 0},0.8)`;
    ctx.fillRect(Math.random() * N, Math.random() * N, 2, 2);
  }
  // mortar courses with a little waviness + staggered vertical joints
  const course = 19;
  for (let y = course; y < N; y += course) {
    ctx.strokeStyle = 'rgba(40,32,22,0.09)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, y + Math.random() * 1.5);
    for (let x = 0; x <= N; x += 32) ctx.lineTo(x, y + (Math.random() - 0.5) * 2.4);
    ctx.stroke();
    const off = (y / course) % 2 === 0 ? 0 : 22;
    for (let x = off; x < N; x += 44) {
      ctx.fillStyle = 'rgba(40,32,22,0.055)';
      ctx.fillRect(x + (Math.random() - 0.5) * 6, y - course, 1.2, course);
    }
  }
  // chipped plaster patches exposing darker brick
  for (let i = 0; i < 3; i++) {
    const x = Math.random() * N, y = Math.random() * N;
    ctx.fillStyle = 'rgba(96,74,52,0.15)';
    ctx.beginPath();
    ctx.ellipse(x, y, 6 + Math.random() * 10, 4 + Math.random() * 8, Math.random() * 3, 0, 7);
    ctx.fill();
  }
  // cracks: dark random walks
  for (let i = 0; i < 2; i++) {
    let x = Math.random() * N, y = Math.random() * N * 0.4;
    ctx.strokeStyle = 'rgba(30,24,16,0.20)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 14; s++) {
      x += (Math.random() - 0.5) * 14;
      y += 6 + Math.random() * 10;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // rain streaks from the top
  for (let i = 0; i < 7; i++) {
    const x = Math.random() * N, len = 40 + Math.random() * 120;
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, 'rgba(40,36,30,0.12)');
    g.addColorStop(1, 'rgba(40,36,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 2.5 + Math.random() * 4, len);
  }
  // grime band at the base
  const g = ctx.createLinearGradient(0, N - 46, 0, N);
  g.addColorStop(0, 'rgba(30,26,20,0)');
  g.addColorStop(1, 'rgba(30,26,20,0.26)');
  ctx.fillStyle = g;
  ctx.fillRect(0, N - 46, N, 46);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Dirt/gravel ground: tonal patches, pebbles and hairline cracks.
function groundSurfaceTexture(hex) {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d');
  const col = new THREE.Color(hex);
  ctx.fillStyle = `#${col.getHexString()}`;
  ctx.fillRect(0, 0, N, N);
  for (let i = 0; i < 22; i++) {
    const p = col.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.075);
    ctx.fillStyle = `rgba(${p.r * 255 | 0},${p.g * 255 | 0},${p.b * 255 | 0},0.35)`;
    ctx.beginPath();
    ctx.ellipse(Math.random() * N, Math.random() * N, 24 + Math.random() * 60, 16 + Math.random() * 44, Math.random() * 3, 0, 7);
    ctx.fill();
  }
  for (let i = 0; i < 1300; i++) {
    const p = col.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.06);
    ctx.fillStyle = `#${p.getHexString()}`;
    ctx.fillRect(Math.random() * N, Math.random() * N, 1.8, 1.8);
  }
  // pebbles: subtly darker blob + faint light top edge
  for (let i = 0; i < 80; i++) {
    const x = Math.random() * N, y = Math.random() * N, r = 0.8 + Math.random() * 1.6;
    const dark = col.clone().offsetHSL(0, 0, -0.055);
    ctx.fillStyle = `#${dark.getHexString()}`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.8, 0, 0, 7);
    ctx.fill();
    const lit = col.clone().offsetHSL(0, 0, 0.05);
    ctx.fillStyle = `rgba(${lit.r * 255 | 0},${lit.g * 255 | 0},${lit.b * 255 | 0},0.4)`;
    ctx.beginPath();
    ctx.ellipse(x - r * 0.2, y - r * 0.35, r * 0.55, r * 0.4, 0, 0, 7);
    ctx.fill();
  }
  // hairline cracks
  for (let i = 0; i < 5; i++) {
    let x = Math.random() * N, y = Math.random() * N;
    ctx.strokeStyle = 'rgba(20,16,10,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 10; s++) {
      x += (Math.random() - 0.5) * 26;
      y += (Math.random() - 0.5) * 26;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Vertical wooden planks with grain, gaps and nail heads.
function plankTexture(hex) {
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d');
  const col = new THREE.Color(hex);
  ctx.fillStyle = `#${col.getHexString()}`;
  ctx.fillRect(0, 0, N, N);
  const plank = 32;
  for (let x = 0; x < N; x += plank) {
    const p = col.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.1);
    ctx.fillStyle = `#${p.getHexString()}`;
    ctx.fillRect(x, 0, plank, N);
    // grain
    for (let i = 0; i < 6; i++) {
      const gx = x + 4 + Math.random() * (plank - 8);
      ctx.strokeStyle = 'rgba(30,20,10,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.bezierCurveTo(gx + 3, N * 0.3, gx - 3, N * 0.6, gx + 2, N);
      ctx.stroke();
    }
    // plank gap
    ctx.fillStyle = 'rgba(15,10,5,0.5)';
    ctx.fillRect(x, 0, 2, N);
    // nails
    ctx.fillStyle = 'rgba(20,20,22,0.8)';
    ctx.fillRect(x + plank / 2, 8, 3, 3);
    ctx.fillRect(x + plank / 2, N - 12, 3, 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Painted metal with scratches and rust drips; optionally corrugated
// (vertical ridges — shipping containers, tin roofs).
function metalTexture(hex, { rust = 0.6, corrugated = false } = {}) {
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d');
  const col = new THREE.Color(hex);
  ctx.fillStyle = `#${col.getHexString()}`;
  ctx.fillRect(0, 0, N, N);
  // horizontal brushed variation
  for (let y = 0; y < N; y += 2) {
    const p = col.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.05);
    ctx.fillStyle = `rgba(${p.r * 255 | 0},${p.g * 255 | 0},${p.b * 255 | 0},0.5)`;
    ctx.fillRect(0, y, N, 2);
  }
  if (corrugated) {
    for (let x = 0; x < N; x += 10) {
      ctx.fillStyle = 'rgba(255,255,255,0.13)';
      ctx.fillRect(x, 0, 3, N);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(x + 6, 0, 3, N);
    }
  }
  // scratches
  for (let i = 0; i < 8; i++) {
    ctx.strokeStyle = 'rgba(220,220,215,0.25)';
    ctx.lineWidth = 1;
    const x = Math.random() * N, y = Math.random() * N;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 40, y + (Math.random() - 0.5) * 12);
    ctx.stroke();
  }
  // rust blooms + drips
  for (let i = 0; i < rust * 12; i++) {
    const x = Math.random() * N, y = Math.random() * N;
    ctx.fillStyle = 'rgba(112,62,30,0.4)';
    ctx.beginPath();
    ctx.ellipse(x, y, 3 + Math.random() * 9, 2 + Math.random() * 6, Math.random() * 3, 0, 7);
    ctx.fill();
    const len = 8 + Math.random() * 26;
    const g = ctx.createLinearGradient(0, y, 0, y + len);
    g.addColorStop(0, 'rgba(100,55,26,0.35)');
    g.addColorStop(1, 'rgba(100,55,26,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 1.5, y, 3, len);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Fabric: plain with wrinkle shading, or awning stripes when hexB given.
function clothTexture(hexA, hexB = null) {
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d');
  const a = new THREE.Color(hexA);
  ctx.fillStyle = `#${a.getHexString()}`;
  ctx.fillRect(0, 0, N, N);
  if (hexB !== null) {
    const b = new THREE.Color(hexB);
    for (let x = 0; x < N; x += 32) {
      ctx.fillStyle = `#${b.getHexString()}`;
      ctx.fillRect(x, 0, 16, N);
    }
  }
  // wrinkles: soft diagonal shading
  for (let i = 0; i < 10; i++) {
    const x = Math.random() * N;
    ctx.strokeStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.07})`;
    ctx.lineWidth = 3 + Math.random() * 5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (Math.random() - 0.5) * 30, N);
    ctx.stroke();
  }
  // sun-fade at one edge
  const g = ctx.createLinearGradient(0, 0, 0, N);
  g.addColorStop(0, 'rgba(255,250,240,0.14)');
  g.addColorStop(1, 'rgba(255,250,240,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, N, N);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Chain-link diamond lattice on a transparent canvas (alphaTest material).
function chainlinkTexture() {
  const N = 64;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, N, N);
  ctx.strokeStyle = 'rgba(150,155,158,1)';
  ctx.lineWidth = 1.6;
  const step = 16;
  for (let i = -N; i < N * 2; i += step) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + N, N); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i - N, N); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Weathered street poster / painted sign: coloured field, border, text bars.
function posterTexture() {
  const N = 64;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d');
  const bgs = ['#8a3b30', '#3f5d6b', '#8a7a3f', '#5a6b46', '#7d6a8a', '#b0a48a'];
  ctx.fillStyle = bgs[Math.floor(Math.random() * bgs.length)];
  ctx.fillRect(0, 0, N, N);
  ctx.strokeStyle = 'rgba(240,235,220,0.85)';
  ctx.lineWidth = 3;
  ctx.strokeRect(3, 3, N - 6, N - 6);
  // headline + text bars
  ctx.fillStyle = 'rgba(240,235,220,0.9)';
  ctx.fillRect(9, 10, N - 18, 9);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = 'rgba(240,235,220,0.55)';
    ctx.fillRect(9, 26 + i * 7, (N - 18) * (0.5 + Math.random() * 0.5), 3.4);
  }
  // grime / tears
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = 'rgba(30,25,18,0.18)';
    ctx.fillRect(Math.random() * N, Math.random() * N, 2, 2);
  }
  ctx.fillStyle = 'rgba(30,25,18,0.4)';
  ctx.beginPath();
  ctx.ellipse(Math.random() * N, N - 6, 12, 5, 0, 0, 7);
  ctx.fill();
  return new THREE.CanvasTexture(c);
}

function lightPoolTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,232,176,0.75)');
  grad.addColorStop(0.5, 'rgba(255,232,176,0.28)');
  grad.addColorStop(1, 'rgba(255,232,176,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
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

// --------------------------------------------------------- material kit
//
// One shared kit per world keeps material/texture count tiny even with
// hundreds of dressing meshes.

function makeKit(env) {
  const map = (tex) => new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex });
  const K = {
    crateWood: map(plankTexture(0x8f7548)),
    palletWood: map(plankTexture(0x796748)),
    darkWood: map(plankTexture(0x5c4a30)),
    barrel: [
      map(metalTexture(0x7a3527)), map(metalTexture(0x35505e)),
      map(metalTexture(0x4a5138)), map(metalTexture(0x6b5a30, { rust: 1.1 }))
    ],
    container: [
      map(metalTexture(0x7a3b30, { corrugated: true })),
      map(metalTexture(0x2f5d6b, { corrugated: true })),
      map(metalTexture(0x6b6b32, { corrugated: true, rust: 1.0 }))
    ],
    tin: map(metalTexture(0x8a9094, { corrugated: true, rust: 0.9 })),
    sandbag: lambert(0x9a8a64),
    bagGeo: new THREE.SphereGeometry(0.3, 7, 5),
    tarp: [map(clothTexture(0x4a5648)), map(clothTexture(0x5b5340)), map(clothTexture(0x39434e))],
    awningCloth: [
      new THREE.MeshLambertMaterial({ color: 0xffffff, map: clothTexture(0x9c4c3a, 0xe4d8c0), side: THREE.DoubleSide }),
      new THREE.MeshLambertMaterial({ color: 0xffffff, map: clothTexture(0x4a6b7a, 0xe4d8c0), side: THREE.DoubleSide }),
      new THREE.MeshLambertMaterial({ color: 0xffffff, map: clothTexture(0x7a7038, 0xe0d6bc), side: THREE.DoubleSide })
    ],
    laundry: [0xa8433a, 0x7a8a9a, 0xd8d2c0, 0x5b6b4a, 0x8a6b8a].map(
      (h) => new THREE.MeshLambertMaterial({ color: 0xffffff, map: clothTexture(h), side: THREE.DoubleSide })
    ),
    chain: new THREE.MeshLambertMaterial({
      color: 0xffffff, map: chainlinkTexture(), alphaTest: 0.35, side: THREE.DoubleSide
    }),
    posters: [posterTexture(), posterTexture(), posterTexture()].map(
      (t) => new THREE.MeshLambertMaterial({ color: 0xffffff, map: t })
    ),
    tire: lambert(0x1c1e20),
    cardboard: lambert(0xa5885c),
    paper: new THREE.MeshLambertMaterial({ color: 0xb8b1a0, side: THREE.DoubleSide }),
    dark: lambert(0x24282c),
    steel: lambert(0x5a6066),
    pipe: map(metalTexture(0x555a5f, { rust: 0.8 })),
    pole: map(plankTexture(0x6b5738)),
    rope: lambert(0x2e2e30),
    vine: new THREE.MeshLambertMaterial({ color: 0x3f5a2e, side: THREE.DoubleSide }),
    stain: new THREE.MeshBasicMaterial({
      color: 0x0c0c0c, transparent: true, opacity: 0.22, depthWrite: false
    }),
    lightPool: new THREE.MeshBasicMaterial({
      map: lightPoolTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    }),
    bulb: new THREE.MeshBasicMaterial({ color: 0xffe9b0 }),
    wire: lambert(0x1d1f22),
    rock: map(noiseTexture(env.snow ? 0x9aa4ac : 0x8a8272, { speckle: 0.22, patches: 12 })),
    hedge: map(noiseTexture(0x2f4a30, { speckle: 0.3, patches: 12 })),
    shardGeo: new THREE.IcosahedronGeometry(0.16, 0),
    stainGeo: new THREE.CircleGeometry(1, 10),
    clothGeo: new THREE.PlaneGeometry(0.5, 0.62),
    paperGeo: new THREE.PlaneGeometry(0.17, 0.23),
    tireGeo: new THREE.TorusGeometry(0.3, 0.13, 7, 14)
  };
  return K;
}

const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
const cyl = (rt, rb, h, seg, mat) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);

// A sagging wire between two points (power lines, laundry lines).
function wireMesh(a, b, sag, mat, radius = 0.018) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  mid.y -= sag;
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, radius, 5, false), mat);
  m.userData.noShadow = true;
  return { mesh: m, curve };
}

export function buildWorld(scene, map, env, rng) {
  const group = new THREE.Group();
  group.name = 'world';

  scene.background = new THREE.Color(env.sky);
  scene.fog = new THREE.FogExp2(env.fog, env.fogDensity);

  // ---- lights (sun casts real-time shadows; its frustum follows the player)
  // hemisphere runs a little hotter now that real shadows darken the
  // sun-averted faces
  const hemi = new THREE.HemisphereLight(env.hemi, env.hemiGround, env.night ? 0.85 : 1.2);
  const sun = new THREE.DirectionalLight(env.sun, env.sunIntensity);
  sun.position.set(40, 70, 25);
  sun.castShadow = true;
  const isCoarse = matchMedia('(pointer: coarse)').matches;
  sun.shadow.mapSize.set(isCoarse ? 1024 : 2048, isCoarse ? 1024 : 2048);
  sun.shadow.camera.left = -42;
  sun.shadow.camera.right = 42;
  sun.shadow.camera.top = 42;
  sun.shadow.camera.bottom = -42;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 200;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  group.add(hemi, sun, sun.target);
  group.userData.sun = sun;

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
  group.userData.skyDome = skyDome; // recentered on the camera every frame
  if (!env.night) {
    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sunTexture(), fog: false, transparent: true, depthWrite: false
    }));
    sunSprite.scale.setScalar(90);
    sunSprite.position.set(140, 200, 90);
    sunSprite.name = 'sunSprite';
    group.add(sunSprite);
    group.userData.sunSprite = sunSprite;
  }

  const K = makeKit(env);

  // ---- ground
  const S = map.cellSize;
  const { minX, maxX, minZ, maxZ } = map.bounds;
  const spanX = (maxX - minX + 24) * S;
  const spanZ = (maxZ - minZ + 24) * S;
  const cx = ((minX + maxX) / 2) * S;
  const cz = ((minZ + maxZ) / 2) * S;
  const groundColor = env.snow ? 0xd8dde2 : env.ground;
  const groundTex = groundSurfaceTexture(groundColor);
  groundTex.repeat.set(spanX / 9, spanZ / 9);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(spanX, spanZ, 1, 1),
    new THREE.MeshLambertMaterial({ color: 0xffffff, map: groundTex })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, 0, cz);
  group.add(ground);

  // subtle worn-path tint on carved cells (flat — the textured ground
  // beneath supplies the grain; stacking two noisy layers looked blotchy)
  const pathGeo = new THREE.PlaneGeometry(S, S);
  const pathMat = lambert(shade(groundColor, 0.82), { transparent: true, opacity: 0.4 });
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
  const wallTex = wallSurfaceTexture();
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

  // ---- set dressing: vignettes against walls, wall-mounted details,
  // overhead wires, litter — this is what makes the lanes read lived-in
  dressWorld(group, map, env, rng, K, edges, wallH);

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

  // ---- shadow flags: every lit surface casts + receives; the huge ground
  // and water planes only receive, decals/wires neither
  group.traverse((o) => {
    if (o.isMesh && o.material?.isMeshLambertMaterial && !o.userData.noShadow) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  ground.castShadow = false;
  pathMesh.castShadow = false;

  scene.add(group);
  return group;
}

function collectWallEdges(map, pillarSet = new Set()) {
  const S = map.cellSize;
  const edges = [];
  const solid = (x, z) => !map.isCarved(x, z) && !pillarSet.has(`${x},${z}`);
  // nx/nz point from the wall back into the carved cell it faces
  for (const c of map.carved) {
    const [x, z] = c.split(',').map(Number);
    if (solid(x, z + 1)) edges.push({ x: x * S, z: z * S + S / 2, rotY: 0, nx: 0, nz: -1 });
    if (solid(x, z - 1)) edges.push({ x: x * S, z: z * S - S / 2, rotY: 0, nx: 0, nz: 1 });
    if (solid(x + 1, z)) edges.push({ x: x * S + S / 2, z: z * S, rotY: Math.PI / 2, nx: -1, nz: 0 });
    if (solid(x - 1, z)) edges.push({ x: x * S - S / 2, z: z * S, rotY: Math.PI / 2, nx: 1, nz: 0 });
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
    if (map.isCarved(x, z) || inApproachLane(map, x, z)) continue;
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

// The squad's insertion vehicle approaches from behind the spawn cell —
// keep that lane clear of buildings and towers so the ride never clips.
function inApproachLane(map, x, z) {
  const a = map.path[0], b2 = map.path[1] ?? a;
  const dx = Math.sign(b2.x - a.x), dz = Math.sign(b2.z - a.z);
  const rx = x - a.x, rz = z - a.z;
  const behind = rx * -dx + rz * -dz;
  const lateral = Math.abs(rx * dz) + Math.abs(rz * dx);
  return behind >= -1 && lateral <= 2;
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
    if (tried.has(k) || map.isCarved(x, z) || inApproachLane(map, x, z)) continue;
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

// ---------------------------------------------------------- set dressing
//
// Instead of the old uniform scatter, dressing is placed the way people
// actually leave things: vignettes (a market stall, a sandbag position, a
// junk pile) pushed up against walls and facing the lane, details mounted
// on the walls themselves, wires strung overhead, litter and stains where
// the clutter is. Everything hugs within ~1.2m of the walls so the
// walkable lane the AI navigates stays untouched.

function dressWorld(group, map, env, rng, K, edges, wallH) {
  const S = map.cellSize;

  // cells to keep clear: spawn, extraction, checkpoint doorways (stack-ups)
  const skip = new Set([`${map.start.x},${map.start.z}`, `${map.end.x},${map.end.z}`]);
  for (let i = 0; i < map.path.length - 1; i++) {
    if (map.path[i].seg !== map.path[i + 1].seg) {
      skip.add(`${map.path[i].x},${map.path[i].z}`);
      skip.add(`${map.path[i + 1].x},${map.path[i + 1].z}`);
    }
  }

  const carved = (x, z) => map.isCarved(x, z);
  const cellsInfo = [];
  for (const c of map.carved) {
    const [x, z] = c.split(',').map(Number);
    if (skip.has(c)) continue;
    const dirs = [];
    if (!carved(x + 1, z)) dirs.push({ dx: 1, dz: 0 });
    if (!carved(x - 1, z)) dirs.push({ dx: -1, dz: 0 });
    if (!carved(x, z + 1)) dirs.push({ dx: 0, dz: 1 });
    if (!carved(x, z - 1)) dirs.push({ dx: 0, dz: 1 * -1 });
    cellsInfo.push({ x, z, dirs, key: c });
  }

  const stains = [];   // {x, z, r}
  const litter = [];   // {x, z, rot}
  const sprinkle = (wx, wz, n = 3, r = 1.4) => {
    for (let i = 0; i < n; i++) {
      litter.push({ x: wx + rng.range(-r, r), z: wz + rng.range(-r, r), rot: rng.range(0, Math.PI * 2) });
    }
  };

  const VIGNETTES = {
    camp: vCamp, defense: vDefense, market: vMarket, laundry: vLaundry,
    junk: vJunk, dock: vDock, garden: vGarden, power: vPower, fence: vFence
  };
  const list = env.props ?? [];
  const vigNames = list.filter((p) => VIGNETTES[p]);
  const legacyNames = list.filter((p) => !VIGNETTES[p]);

  // ---- vignettes against walls
  const wallCells = rng.shuffle(cellsInfo.filter((c) => c.dirs.length > 0));
  const vigCount = Math.min(58, Math.floor(wallCells.length * 0.62));
  for (let i = 0; i < vigCount && i < wallCells.length && vigNames.length > 0; i++) {
    const cell = wallCells[i];
    const d = rng.pick(cell.dirs);
    const name = rng.pick(vigNames);
    const v = VIGNETTES[name](K, env, rng);
    if (!v) continue;
    // origin sits just off the wall face, +z pointing into the lane
    const back = S / 2 - 0.35 - 0.18;
    const lateral = rng.range(-1.6, 1.6);
    const px = cell.x * S + d.dx * back + (d.dz !== 0 ? lateral : 0);
    const pz = cell.z * S + d.dz * back + (d.dx !== 0 ? lateral : 0);
    v.position.set(px, 0, pz);
    v.rotation.y = Math.atan2(-d.dx, -d.dz) + rng.range(-0.12, 0.12);
    group.add(v);
    if (v.userData.stainR) stains.push({ x: px, z: pz, r: v.userData.stainR });
    if (v.userData.litter) sprinkle(px, pz, v.userData.litter);
  }

  // ---- fountain: a wide centerpiece, so it gets an interior room cell
  // (never a route cell — the squad shouldn't walk through it)
  if (list.includes('fountain')) {
    const pathSet = new Set(map.path.map((p) => `${p.x},${p.z}`));
    const interior = cellsInfo.filter((c) => c.dirs.length === 0 && !pathSet.has(c.key));
    if (interior.length > 0) {
      const c = rng.pick(interior);
      const f = makeProp('fountain', env, rng, K);
      if (f) {
        f.position.set(c.x * S + rng.range(-0.5, 0.5), 0, c.z * S + rng.range(-0.5, 0.5));
        f.rotation.y = rng.range(0, Math.PI * 2);
        group.add(f);
      }
    }
  }

  // ---- legacy freestanding props (vegetation, rubble, statues, tents…)
  const scatterNames = legacyNames.filter((t) => t !== 'fountain');
  if (scatterNames.length > 0) {
    const cells = [...map.carved];
    const n = Math.min(36, Math.floor(cells.length * 0.4));
    for (let i = 0; i < n; i++) {
      const c = rng.pick(cells);
      if (skip.has(c)) continue;
      const [x, z] = c.split(',').map(Number);
      const type = rng.pick(scatterNames);
      const prop = makeProp(type, env, rng, K);
      if (!prop) continue;
      // hug corridor edges so the lane stays walkable
      const ox = rng.chance(0.5) ? rng.range(1.7, 2.4) : rng.range(-2.4, -1.7);
      const oz = rng.range(-2.1, 2.1);
      prop.position.set(x * S + ox, 0, z * S + oz);
      prop.rotation.y = rng.range(0, Math.PI * 2);
      group.add(prop);
    }
  }

  // ---- wall-mounted details (AC units, pipes, posters, vents, vines…)
  const mounts = env.mounts ?? [];
  if (mounts.length > 0 && edges.length > 0) {
    const pool = rng.shuffle([...edges]);
    const n = Math.min(38, Math.floor(edges.length * 0.16));
    for (let i = 0; i < n; i++) {
      const e = pool[i];
      const kind = rng.pick(mounts);
      const m = makeMount(kind, K, env, rng, wallH);
      if (!m) continue;
      const lateral = rng.range(-1.8, 1.8);
      m.position.set(
        e.x + e.nx * 0.38 + (e.nz !== 0 ? lateral : 0),
        0,
        e.z + e.nz * 0.38 + (e.nx !== 0 ? lateral : 0)
      );
      m.rotation.y = Math.atan2(e.nx, e.nz);
      group.add(m);
      if (kind === 'sconce') {
        const pool2 = new THREE.Mesh(new THREE.CircleGeometry(1.7, 12), K.lightPool);
        pool2.rotation.x = -Math.PI / 2;
        pool2.position.set(m.position.x + e.nx * 0.9, 0.03, m.position.z + e.nz * 0.9);
        pool2.userData.noShadow = true;
        group.add(pool2);
      }
    }
  }

  // ---- overhead wires strung across corridors (towny maps)
  if (env.wires) {
    const corridors = cellsInfo.filter((c) =>
      (!carved(c.x + 1, c.z) && !carved(c.x - 1, c.z)) ||
      (!carved(c.x, c.z + 1) && !carved(c.x, c.z - 1))
    );
    const used = [];
    let strung = 0;
    for (const c of rng.shuffle(corridors)) {
      if (strung >= 12) break;
      if (used.some((u) => Math.abs(u.x - c.x) + Math.abs(u.z - c.z) < 2)) continue;
      used.push(c);
      const alongX = !carved(c.x, c.z + 1) && !carved(c.x, c.z - 1); // walls on ±z → wire spans z
      const h = rng.range(2.9, 3.25);
      const off = rng.range(-1.6, 1.6);
      const a = new THREE.Vector3(
        c.x * S + (alongX ? off : -S / 2 + 0.15),
        h,
        c.z * S + (alongX ? -S / 2 + 0.15 : off)
      );
      const b = new THREE.Vector3(
        c.x * S + (alongX ? off : S / 2 - 0.15),
        h + rng.range(-0.15, 0.15),
        c.z * S + (alongX ? S / 2 - 0.15 : off)
      );
      const { mesh, curve } = wireMesh(a, b, rng.range(0.3, 0.5), K.wire);
      group.add(mesh);
      strung++;
      // pennant strings on some wires (souk / border-town flavour)
      if (env.pennants && rng.chance(0.55)) {
        const flagGeo = new THREE.PlaneGeometry(0.16, 0.22);
        for (let t = 0.15; t <= 0.85; t += 0.14) {
          const p = curve.getPoint(t);
          const flag = new THREE.Mesh(flagGeo, rng.pick(K.laundry));
          flag.position.set(p.x, p.y - 0.13, p.z);
          flag.rotation.y = (alongX ? 0 : Math.PI / 2) + rng.range(-0.3, 0.3);
          flag.rotation.x = rng.range(-0.1, 0.1);
          flag.userData.noShadow = true;
          group.add(flag);
        }
      }
    }
  }

  // ---- ground stains (oil / scorch / spill) near the clutter
  if (stains.length > 0) {
    const sm = new THREE.InstancedMesh(K.stainGeo, K.stain, stains.length);
    stains.forEach((s, i) => {
      const dummy = new THREE.Object3D();
      dummy.position.set(s.x + rng.range(-0.4, 0.4), 0.035, s.z + rng.range(-0.4, 0.4));
      dummy.rotation.x = -Math.PI / 2;
      dummy.scale.setScalar(s.r);
      dummy.updateMatrix();
      sm.setMatrixAt(i, dummy.matrix);
    });
    sm.userData.noShadow = true;
    group.add(sm);
  }

  // ---- litter: papers and scraps blown up against the walls
  if (litter.length > 0) {
    const lm = new THREE.InstancedMesh(K.paperGeo, K.paper, litter.length);
    litter.forEach((l, i) => {
      const dummy = new THREE.Object3D();
      dummy.position.set(l.x, 0.045, l.z);
      dummy.rotation.set(-Math.PI / 2 + rng.range(-0.12, 0.12), 0, l.rot);
      dummy.updateMatrix();
      lm.setMatrixAt(i, dummy.matrix);
    });
    lm.userData.noShadow = true;
    group.add(lm);
  }
}

// ------------------------------------------------------------ vignettes
//
// Each builder returns a group arranged with its back at z=0 and content
// extending toward +z (the lane). The caller pushes it against a wall.

function vCamp(K, env, rng) {
  const g = new THREE.Group();
  // pallet
  const pallet = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const slat = box(1.1, 0.04, 0.26, K.palletWood);
    slat.position.set(0, 0.14, -0.36 + i * 0.36);
    pallet.add(slat);
  }
  const bearer = box(1.1, 0.1, 0.09, K.palletWood);
  bearer.position.set(0, 0.06, 0);
  pallet.add(bearer);
  pallet.position.set(-0.1, 0, 0.5);
  g.add(pallet);
  // crates on and beside the pallet
  const c1 = box(0.8, 0.8, 0.8, K.crateWood);
  c1.position.set(-0.1, 0.6, 0.5);
  c1.rotation.y = rng.range(-0.2, 0.2);
  const c2 = box(0.62, 0.62, 0.62, K.crateWood);
  c2.position.set(0.85, 0.31, 0.35);
  c2.rotation.y = rng.range(-0.5, 0.5);
  g.add(c1, c2);
  if (rng.chance(0.6)) {
    const c3 = box(0.55, 0.55, 0.55, K.darkWood);
    c3.position.set(-0.95, 0.28, 0.4);
    c3.rotation.y = rng.range(-0.4, 0.4);
    g.add(c3);
  }
  // barrel pair, one with rib rings
  const bmat = rng.pick(K.barrel);
  const b1 = cyl(0.32, 0.32, 0.9, 10, bmat);
  b1.position.set(1.55, 0.45, 0.55);
  g.add(b1);
  for (const ry of [0.25, 0.65]) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.325, 0.02, 5, 12), bmat);
    rib.rotation.x = Math.PI / 2;
    rib.position.set(1.55, ry, 0.55);
    g.add(rib);
  }
  // tarp thrown over a low stack behind
  const tarp = box(1.5, 0.55, 0.8, rng.pick(K.tarp));
  tarp.position.set(0.5, 0.28, 0.02);
  tarp.rotation.y = rng.range(-0.15, 0.15);
  tarp.scale.y = rng.range(0.8, 1.1);
  g.add(tarp);
  g.userData.stainR = 0.7;
  g.userData.litter = 2;
  return g;
}

function vDefense(K, env, rng) {
  const g = new THREE.Group();
  // sandbag emplacement: baked wall sections turned to face the lane
  const wall = makeVegetation('sandbag', rng);
  if (wall) {
    // the merged wall's long axis varies per shape — lay it across the lane
    const geo = wall.children[0].geometry;
    geo.computeBoundingBox();
    const s = geo.boundingBox.getSize(new THREE.Vector3());
    if (s.z > s.x) wall.rotation.y = Math.PI / 2;
    wall.position.set(rng.range(-0.3, 0.3), 0, 0.55);
    g.add(wall);
    if (rng.chance(0.45)) {
      const wall2 = makeVegetation('sandbag', rng, { scale: 0.9 });
      if (wall2) {
        const geo2 = wall2.children[0].geometry;
        geo2.computeBoundingBox();
        const s2 = geo2.boundingBox.getSize(new THREE.Vector3());
        if (s2.z > s2.x) wall2.rotation.y = Math.PI / 2;
        wall2.rotation.y += rng.range(0.5, 0.9);
        wall2.position.set(rng.chance(0.5) ? -2.1 : 2.1, 0, 0.8);
        g.add(wall2);
      }
    }
  } else {
    // fallback: instanced bag arc (props.bin unavailable)
    const rows = [[0, 0.19, 5], [0.5, 0.5, 4]];
    let total = 0;
    for (const r of rows) total += r[2];
    const bags = new THREE.InstancedMesh(K.bagGeo, K.sandbag, total);
    const dummy = new THREE.Object3D();
    let bi = 0;
    for (const [stagger, y, count] of rows) {
      for (let i = 0; i < count; i++) {
        const t = (i - (count - 1) / 2) * 0.62 + stagger * 0.3;
        dummy.position.set(t, y, 0.5 + Math.abs(t) * -0.12 + rng.range(-0.03, 0.03));
        dummy.rotation.set(rng.range(-0.06, 0.06), rng.range(-0.25, 0.25), rng.range(-0.06, 0.06));
        dummy.scale.set(1.35, 0.62, 0.95);
        dummy.updateMatrix();
        bags.setMatrixAt(bi++, dummy.matrix);
      }
    }
    g.add(bags);
  }
  // ammo crate + tin
  const ammo = box(0.7, 0.4, 0.42, K.darkWood);
  ammo.position.set(0.9, 0.2, 1.05);
  ammo.rotation.y = rng.range(-0.4, 0.4);
  const tin = box(0.4, 0.24, 0.26, K.steel);
  tin.position.set(0.55, 0.12, 1.3);
  tin.rotation.y = rng.range(-0.6, 0.6);
  g.add(ammo, tin);
  g.userData.litter = 2;
  return g;
}

function vMarket(K, env, rng) {
  const g = new THREE.Group();
  // posts + sloped striped canopy
  const cloth = rng.pick(K.awningCloth);
  for (const x of [-1.05, 1.05]) {
    const post = cyl(0.045, 0.05, 2.2, 5, K.pole);
    post.position.set(x, 1.1, 0.95);
    g.add(post);
  }
  const canopy = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.5), cloth);
  canopy.position.set(0, 2.22, 0.5);
  canopy.rotation.x = -Math.PI / 2 + 0.22;
  g.add(canopy);
  // scalloped front edge: a narrow strip hanging off the canopy lip
  const valance = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.22), cloth);
  valance.position.set(0, 2.05, 1.18);
  g.add(valance);
  // table + goods
  const top = box(1.9, 0.07, 0.85, K.crateWood);
  top.position.set(0, 0.78, 0.55);
  for (const x of [-0.8, 0.8]) {
    const leg = box(0.08, 0.75, 0.6, K.darkWood);
    leg.position.set(x, 0.38, 0.55);
    g.add(leg);
  }
  g.add(top);
  const goods = [0x9c4c30, 0x7a8a3a, 0xc0a040];
  for (let i = 0; i < 3; i++) {
    const tray = box(0.5, 0.14, 0.4, K.darkWood);
    tray.position.set(-0.62 + i * 0.62, 0.88, 0.55);
    const pile = box(0.4, 0.12, 0.3, lambert(goods[i]));
    pile.position.set(-0.62 + i * 0.62, 0.99, 0.55);
    g.add(tray, pile);
  }
  // stacked spare crate under the table
  const spare = box(0.55, 0.5, 0.5, K.crateWood);
  spare.position.set(0.55, 0.25, 0.35);
  spare.rotation.y = rng.range(-0.3, 0.3);
  g.add(spare);
  g.userData.litter = 3;
  return g;
}

function vLaundry(K, env, rng) {
  const g = new THREE.Group();
  for (const x of [-1.5, 1.5]) {
    const pole = cyl(0.035, 0.045, 2.3, 5, K.pole);
    pole.position.set(x, 1.15, 0.55);
    pole.rotation.z = x < 0 ? 0.05 : -0.05;
    g.add(pole);
  }
  const a = new THREE.Vector3(-1.5, 2.25, 0.55);
  const b = new THREE.Vector3(1.5, 2.25, 0.55);
  const { mesh, curve } = wireMesh(a, b, 0.18, K.rope, 0.012);
  g.add(mesh);
  const n = rng.int(3, 5);
  for (let i = 0; i < n; i++) {
    const t = 0.16 + (i / (n - 1)) * 0.68;
    const p = curve.getPoint(t);
    const c = new THREE.Mesh(K.clothGeo, rng.pick(K.laundry));
    c.position.set(p.x, p.y - 0.33, p.z);
    c.rotation.y = rng.range(-0.2, 0.2);
    c.rotation.x = rng.range(-0.12, 0.04);
    c.scale.set(rng.range(0.8, 1.25), rng.range(0.85, 1.2), 1);
    g.add(c);
  }
  // washing basin at a pole's foot
  const basin = cyl(0.34, 0.28, 0.26, 9, K.steel);
  basin.position.set(-1.3, 0.13, 0.9);
  g.add(basin);
  return g;
}

function vJunk(K, env, rng) {
  const g = new THREE.Group();
  // tire stack + one leaning
  const n = rng.int(2, 4);
  for (let i = 0; i < n; i++) {
    const t = new THREE.Mesh(K.tireGeo, K.tire);
    t.rotation.x = Math.PI / 2;
    t.rotation.z = rng.range(0, 3);
    t.position.set(-0.9 + rng.range(-0.08, 0.08), 0.14 + i * 0.27, 0.45 + rng.range(-0.08, 0.08));
    g.add(t);
  }
  const lean = new THREE.Mesh(K.tireGeo, K.tire);
  lean.position.set(-0.15, 0.31, 0.5);
  lean.rotation.set(0.25, rng.range(0, 3), 1.35);
  g.add(lean);
  // collapsed cardboard boxes
  for (let i = 0; i < 2; i++) {
    const cb = box(rng.range(0.45, 0.7), rng.range(0.2, 0.42), rng.range(0.4, 0.55), K.cardboard);
    cb.position.set(0.7 + i * 0.55, cb.geometry.parameters.height / 2, 0.4 + rng.range(-0.2, 0.3));
    cb.rotation.y = rng.range(-0.7, 0.7);
    cb.rotation.z = rng.range(-0.08, 0.08);
    g.add(cb);
  }
  // rubble against the wall base: a small baked debris pile
  const pile = makeVegetation('debris', rng, { scale: 0.42 });
  if (pile) {
    pile.position.set(rng.range(-1.2, 1.4), 0, 0.3);
    pile.rotation.y = rng.range(0, Math.PI * 2);
    g.add(pile);
  } else {
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(K.shardGeo, K.rock);
      s.position.set(rng.range(-1.6, 1.7), 0.07, rng.range(0.0, 0.35));
      s.scale.setScalar(rng.range(0.5, 1.5));
      s.scale.y *= 0.6;
      s.rotation.y = rng.range(0, 3);
      g.add(s);
    }
  }
  g.userData.stainR = 0.9;
  g.userData.litter = 4;
  return g;
}

function vDock(K, env, rng) {
  const g = new THREE.Group();
  const cont = box(2.4, 1.25, 1.05, rng.pick(K.container));
  cont.position.set(-0.3, 0.63, 0.55);
  cont.rotation.y = rng.range(-0.08, 0.08);
  g.add(cont);
  // door bars on the visible end
  for (const off of [-0.3, 0.3]) {
    const bar = box(0.05, 1.1, 0.05, K.dark);
    bar.position.set(0.92, 0.62, 0.55 + off);
    g.add(bar);
  }
  if (rng.chance(0.5)) {
    const cont2 = box(2.0, 1.1, 0.95, rng.pick(K.container));
    cont2.position.set(0.15, 1.85, 0.4);
    cont2.rotation.y = rng.range(-0.12, 0.12);
    g.add(cont2);
  }
  const bmat = rng.pick(K.barrel);
  for (const [x, z] of [[1.5, 0.5], [1.85, 0.85]]) {
    const b = cyl(0.3, 0.3, 0.85, 10, bmat);
    b.position.set(x, 0.43, z);
    g.add(b);
  }
  // one tipped barrel + spill
  const tipped = cyl(0.3, 0.3, 0.85, 10, rng.pick(K.barrel));
  tipped.position.set(-1.9, 0.31, 0.85);
  tipped.rotation.set(0, rng.range(0, 3), Math.PI / 2);
  g.add(tipped);
  // rope coil
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.09, 6, 12), K.rope);
  coil.rotation.x = Math.PI / 2;
  coil.position.set(1.3, 0.09, 1.25);
  g.add(coil);
  g.userData.stainR = 1.0;
  g.userData.litter = 2;
  return g;
}

function vGarden(K, env, rng) {
  const g = new THREE.Group();
  // trimmed hedge pair with a stone planter between
  for (const x of [-1.15, 1.15]) {
    const h = box(1.3, 0.95, 0.55, K.hedge);
    h.position.set(x, 0.48, 0.4);
    h.scale.y = rng.range(0.9, 1.1);
    g.add(h);
  }
  const planter = box(0.75, 0.5, 0.75, lambert(0x848a8e));
  planter.position.set(0, 0.25, 0.45);
  const soil = box(0.62, 0.06, 0.62, lambert(0x3a3128));
  soil.position.set(0, 0.52, 0.45);
  const shrub = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), K.hedge);
  shrub.position.set(0, 0.75, 0.45);
  g.add(planter, soil, shrub);
  // low chain between short posts along the front
  for (const x of [-1.7, 1.7]) {
    const post = cyl(0.03, 0.03, 0.55, 5, K.dark);
    post.position.set(x, 0.27, 1.15);
    g.add(post);
  }
  const { mesh } = wireMesh(
    new THREE.Vector3(-1.7, 0.52, 1.15),
    new THREE.Vector3(1.7, 0.52, 1.15),
    0.12, K.rope, 0.014
  );
  g.add(mesh);
  return g;
}

function vPower(K, env, rng) {
  const g = new THREE.Group();
  const pole = cyl(0.07, 0.09, 4.6, 7, K.pole);
  pole.position.set(0, 2.3, 0.45);
  pole.rotation.z = rng.range(-0.03, 0.03);
  const arm = box(1.3, 0.09, 0.09, K.pole);
  arm.position.set(0, 4.25, 0.45);
  g.add(pole, arm);
  for (const x of [-0.55, 0.55]) {
    const ins = cyl(0.04, 0.05, 0.12, 5, K.dark);
    ins.position.set(x, 4.36, 0.45);
    g.add(ins);
    // wire drooping back over the wall behind
    const { mesh } = wireMesh(
      new THREE.Vector3(x, 4.3, 0.45),
      new THREE.Vector3(x * 2.6, 2.9, -0.4),
      0.35, K.wire
    );
    g.add(mesh);
  }
  // junction box at head height
  const jbox = box(0.3, 0.42, 0.16, K.dark);
  jbox.position.set(0, 1.7, 0.38);
  g.add(jbox);
  return g;
}

function vFence(K, env, rng) {
  const g = new THREE.Group();
  const len = 3.4, h = 1.8;
  for (const x of [-len / 2, 0, len / 2]) {
    const post = cyl(0.035, 0.035, h, 5, K.steel);
    post.position.set(x, h / 2, 0.5);
    g.add(post);
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(len, h - 0.1), K.chain);
  mesh.material.map.repeat.set(len / 0.9, (h - 0.1) / 0.9);
  mesh.position.set(0, (h - 0.1) / 2 + 0.05, 0.5);
  mesh.userData.noShadow = true;
  g.add(mesh);
  // top rail
  const rail = cyl(0.025, 0.025, len, 5, K.steel);
  rail.rotation.z = Math.PI / 2;
  rail.position.set(0, h - 0.03, 0.5);
  g.add(rail);
  // wind-blown scrap caught in the fence
  if (rng.chance(0.6)) {
    const scrap = new THREE.Mesh(K.paperGeo, K.paper);
    scrap.position.set(rng.range(-1.2, 1.2), rng.range(0.3, 1.1), 0.52);
    scrap.rotation.z = rng.range(0, 3);
    scrap.scale.setScalar(1.6);
    scrap.userData.noShadow = true;
    g.add(scrap);
  }
  g.userData.litter = 2;
  return g;
}

// -------------------------------------------------- wall-mounted details

function makeMount(kind, K, env, rng, wallH) {
  const g = new THREE.Group();
  switch (kind) {
    case 'ac': {
      const unit = box(0.72, 0.5, 0.42, K.steel);
      unit.position.set(0, rng.range(1.9, 2.3), 0.22);
      const grill = new THREE.Mesh(new THREE.CircleGeometry(0.17, 10), K.dark);
      grill.position.set(0.12, unit.position.y, 0.44);
      const bracket = box(0.6, 0.05, 0.4, K.dark);
      bracket.position.set(0, unit.position.y - 0.29, 0.2);
      g.add(unit, grill, bracket);
      // drip stain running down the wall
      const stain = new THREE.Mesh(
        new THREE.PlaneGeometry(0.3, unit.position.y - 0.35),
        K.stain
      );
      stain.position.set(-0.1, (unit.position.y - 0.35) / 2 + 0.1, 0.012);
      stain.userData.noShadow = true;
      g.add(stain);
      return g;
    }
    case 'pipe': {
      const h = rng.range(2.2, 2.6);
      const pipe = cyl(0.05, 0.05, h, 6, K.pipe);
      pipe.position.set(rng.range(-0.4, 0.4), h / 2 + 0.1, 0.1);
      const elbow = cyl(0.05, 0.05, 0.4, 6, K.pipe);
      elbow.rotation.x = Math.PI / 2;
      elbow.position.set(pipe.position.x, 0.12, 0.3);
      g.add(pipe, elbow);
      for (const y of [0.6, h - 0.3]) {
        const clamp = box(0.16, 0.06, 0.12, K.dark);
        clamp.position.set(pipe.position.x, y, 0.08);
        g.add(clamp);
      }
      return g;
    }
    case 'poster': {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.85), rng.pick(K.posters));
      p.position.set(0, rng.range(1.4, 1.8), 0.012);
      p.rotation.z = rng.range(-0.05, 0.05);
      p.userData.noShadow = true;
      g.add(p);
      return g;
    }
    case 'vent': {
      const v = box(0.5, 0.36, 0.16, K.dark);
      v.position.set(0, rng.range(2.0, 2.4), 0.1);
      const lip = box(0.54, 0.05, 0.2, K.steel);
      lip.position.set(0, v.position.y + 0.2, 0.11);
      g.add(v, lip);
      return g;
    }
    case 'sconce': {
      const arm = box(0.08, 0.08, 0.3, K.dark);
      arm.position.set(0, 2.25, 0.15);
      const head = box(0.22, 0.14, 0.22, K.dark);
      head.position.set(0, 2.2, 0.32);
      const glowMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1), K.bulb);
      glowMesh.rotation.x = Math.PI / 2;
      glowMesh.position.set(0, 2.12, 0.32);
      glowMesh.userData.noShadow = true;
      g.add(arm, head, glowMesh);
      return g;
    }
    case 'vine': {
      const n = rng.int(2, 3);
      for (let i = 0; i < n; i++) {
        const len = rng.range(0.8, 1.7);
        const v = new THREE.Mesh(new THREE.PlaneGeometry(rng.range(0.18, 0.34), len), K.vine);
        v.position.set(rng.range(-0.9, 0.9), 2.55 - len / 2, 0.03 + i * 0.015);
        v.rotation.z = rng.range(-0.08, 0.08);
        v.userData.noShadow = true;
        g.add(v);
      }
      return g;
    }
    default:
      return null;
  }
}

// ---------------------------------------------- freestanding legacy props

function makeProp(type, env, rng, K) {
  if (BAKED_KIND[type]) {
    const [kind, scale] = BAKED_KIND[type];
    const baked = makeVegetation(kind, rng, { scale });
    if (baked) return baked;
  }
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
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(rng.range(0.5, 1.1), 0), K.rock);
      rock.position.y = 0.35;
      rock.scale.y = 0.7;
      g.add(rock);
      if (rng.chance(0.6)) {
        const r2 = new THREE.Mesh(new THREE.IcosahedronGeometry(rng.range(0.2, 0.45), 0), K.rock);
        r2.position.set(rng.range(0.6, 1.0), 0.15, rng.range(-0.4, 0.4));
        r2.scale.y = 0.65;
        g.add(r2);
      }
      return g;
    }
    case 'crate': {
      const c = box(0.9, 0.9, 0.9, K.crateWood);
      c.position.y = 0.45;
      g.add(c);
      if (rng.chance(0.5)) {
        const c2 = box(0.72, 0.72, 0.72, K.crateWood);
        c2.position.set(0.5, 0.36, 0.4);
        c2.rotation.y = rng.range(-0.4, 0.4);
        g.add(c2);
      }
      return g;
    }
    case 'barrel': {
      const bmat = rng.pick(K.barrel);
      const b = cyl(0.35, 0.35, 0.95, 10, bmat);
      b.position.y = 0.48;
      g.add(b);
      for (const ry of [0.28, 0.7]) {
        const rib = new THREE.Mesh(new THREE.TorusGeometry(0.355, 0.02, 5, 12), bmat);
        rib.rotation.x = Math.PI / 2;
        rib.position.y = ry;
        g.add(rib);
      }
      if (rng.chance(0.4)) {
        const b2 = cyl(0.32, 0.32, 0.9, 10, rng.pick(K.barrel));
        b2.position.set(0.75, 0.33, 0.2);
        b2.rotation.set(0, rng.range(0, 3), Math.PI / 2);
        g.add(b2);
      }
      return g;
    }
    case 'container': {
      const c = box(2.4, 1.2, 1.1, rng.pick(K.container));
      c.position.y = 0.6;
      g.add(c);
      return g;
    }
    case 'hedge': {
      const h = box(1.8, 1.0, 0.6, K.hedge);
      h.position.y = 0.5;
      g.add(h);
      return g;
    }
    case 'lamp': {
      const pole = cyl(0.05, 0.06, 3.2, 6, K.dark);
      pole.position.y = 1.6;
      const arm = box(0.55, 0.06, 0.06, K.dark);
      arm.position.set(0.24, 3.15, 0);
      const head = box(0.3, 0.12, 0.18, K.dark);
      head.position.set(0.5, 3.1, 0);
      const bulb = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.14), K.bulb);
      bulb.rotation.x = Math.PI / 2;
      bulb.position.set(0.5, 3.03, 0);
      bulb.userData.noShadow = true;
      g.add(pole, arm, head, bulb);
      if (env.night) {
        const pool = new THREE.Mesh(new THREE.CircleGeometry(2.0, 12), K.lightPool);
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(0.5, 0.03, 0);
        pool.userData.noShadow = true;
        g.add(pool);
      }
      return g;
    }
    case 'statue': {
      const base = box(0.8, 0.5, 0.8, lambert(0x777d82));
      base.position.y = 0.25;
      const fig = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.4, 6), lambert(0x8b9196));
      fig.position.y = 1.2;
      g.add(base, fig);
      return g;
    }
    case 'cactus': {
      const c = cyl(0.18, 0.2, 1.7, 8, lambert(0x4c7a3c));
      c.position.y = 0.85;
      const arm = cyl(0.11, 0.11, 0.7, 6, lambert(0x4c7a3c));
      arm.position.set(0.3, 1.0, 0);
      arm.rotation.z = -0.6;
      g.add(c, arm);
      return g;
    }
    case 'awning': {
      const posts = cyl(0.04, 0.04, 2.1, 5, K.pole);
      posts.position.set(-0.8, 1.05, 0);
      const posts2 = posts.clone();
      posts2.position.x = 0.8;
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.4), rng.pick(K.awningCloth));
      cloth.position.y = 2.1;
      cloth.rotation.x = -Math.PI / 2 + 0.12;
      g.add(posts, posts2, cloth);
      return g;
    }
    case 'tent': {
      const t = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.2, 4), rng.pick(K.tarp));
      t.position.y = 0.6;
      t.rotation.y = Math.PI / 4;
      g.add(t);
      const flap = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.6), K.dark);
      flap.position.set(0, 0.32, 0.72);
      flap.rotation.x = -0.35;
      g.add(flap);
      return g;
    }
    case 'antenna': {
      const m = cyl(0.03, 0.05, 4.4, 5, K.dark);
      m.position.y = 2.2;
      const dish = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6, 0, Math.PI), lambert(0x8a9096));
      dish.position.y = 3.6;
      dish.rotation.x = Math.PI / 2.3;
      // guy wires
      for (const a of [0.7, 2.8, 4.9]) {
        const anchor = new THREE.Vector3(Math.sin(a) * 1.4, 0.02, Math.cos(a) * 1.4);
        const { mesh } = wireMesh(new THREE.Vector3(0, 3.4, 0), anchor, 0.05, K.wire, 0.012);
        g.add(mesh);
      }
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
      const walls = cyl(0.9, 0.95, 1.1, 8, lambert(0x77613f));
      walls.position.y = 0.55;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.8, 8), K.tin);
      roof.position.y = 1.5;
      const door = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.8), K.dark);
      door.position.set(0, 0.45, 0.93);
      g.add(walls, roof, door);
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
