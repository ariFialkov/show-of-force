// Loads the baked vegetation binary (scripts/bake-props.mjs decimates and
// colours the FBX packs offline) and hands out per-kind variant meshes.
// Kinds: palm (5), fir (3), leafy (1), bush (1), cactus (9). Every variant
// is ground-anchored at y=0 and metre-scaled at bake time.

import * as THREE from 'three';

let kinds = null;        // { kind: [ { geo, height, radius } ] }
let material = null;     // shared vertex-coloured lambert
let burntMaterial = null; // same geometry, charred: vertex colours scaled way down

export function propsReady() {
  return kinds !== null;
}

export async function initProps(url) {
  try {
    const buf = await (await fetch(url)).arrayBuffer();
    const dv = new DataView(buf);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== 'SOFP') throw new Error('bad props magic');
    const headerLen = dv.getUint32(4, true);
    const json = new TextDecoder().decode(new Uint8Array(buf, 8, headerLen)).replace(/\0+$/, '');
    const header = JSON.parse(json);
    const base = 8 + headerLen;
    const out = {};
    for (const [kind, list] of Object.entries(header.kinds)) {
      out[kind] = list.map((v) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, base + v.p.off, v.verts * 3), 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(buf, base + v.n.off, v.verts * 3), 3));
        geo.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(buf, base + v.c.off, v.verts * 3), 3, true));
        geo.setIndex(new THREE.BufferAttribute(new Uint32Array(buf, base + v.i.off, v.tris * 3), 1));
        return { geo, height: v.height, radius: v.radius };
      });
    }
    // foliage is single-sided card soup — double-side it or crowns look
    // hollow/grey from half the angles
    material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    // material colour multiplies the baked vertex colours, so one dark warm
    // grey turns any paint job into scorched metal
    burntMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true, side: THREE.DoubleSide, color: 0x2b2622
    });
    kinds = out;
  } catch (e) {
    console.warn('props.bin unavailable, using procedural fallbacks', e);
  }
}

// A vegetation instance: random variant + a little scale variance. The
// caller owns position/rotation. Returns null when the bin isn't loaded
// (world.js falls back to its procedural builders).
export function makeVegetation(kind, rng, { scale = 1, vary = true, burnt = false } = {}) {
  const list = kinds?.[kind];
  if (!list || list.length === 0) return null;
  const v = rng ? rng.pick(list) : list[Math.floor(Math.random() * list.length)];
  const mesh = new THREE.Mesh(v.geo, burnt ? burntMaterial : material);
  const s = (rng && vary ? rng.range(0.85, 1.15) : 1) * scale;
  mesh.scale.setScalar(s);
  const g = new THREE.Group();
  g.add(mesh);
  g.userData.vegHeight = v.height * s;
  g.userData.vegKind = kind;
  return g;
}

// Char an already-placed baked prop — used when a vehicle cooks off.
export function scorch(group) {
  if (!burntMaterial) return false;
  let hit = false;
  group.traverse((o) => {
    if (o.isMesh && o.material === material) { o.material = burntMaterial; hit = true; }
  });
  return hit;
}
