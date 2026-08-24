globalThis.window = globalThis;
const fakeEl = () => ({ style: {}, addEventListener: () => {}, removeEventListener: () => {}, setAttribute: () => {}, getContext: () => null });
globalThis.document = { createElementNS: fakeEl, createElement: fakeEl };
import fs from 'node:fs';
const THREE = await import('three');
const { USDZLoader } = await import('three/examples/jsm/loaders/USDZLoader.js');
const buf = fs.readFileSync('assets-src/props/plane.usdz');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const loader = new USDZLoader();
const obj = loader.parse(ab);
obj.updateMatrixWorld(true);
let n = 0, tris = 0;
const mats = new Map();
const bb = new THREE.Box3();
obj.traverse(o => {
  if (o.isMesh && o.geometry?.attributes?.position) {
    n++;
    const t = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    tris += t;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    ms.forEach(m => mats.set(m.name || 'unnamed', (mats.get(m.name || 'unnamed') ?? 0) + t));
    o.geometry.computeBoundingBox();
    bb.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
  }
});
const s = bb.getSize(new THREE.Vector3());
console.log(`meshes=${n} tris=${tris|0} bbox=${s.x.toFixed(1)}x${s.y.toFixed(1)}x${s.z.toFixed(1)} minY=${bb.min.y.toFixed(1)}`);
console.log('mats:', [...mats.entries()].map(([k,v])=>`${k}(${v|0})`).join(', ').slice(0, 400));
const names = [];
obj.traverse(o => { if (o.isMesh) names.push(o.name); });
console.log('mesh names:', names.slice(0, 30).join(', ').slice(0, 400));
