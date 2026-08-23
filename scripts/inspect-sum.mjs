globalThis.window = globalThis;
const fakeEl = () => ({ style: {}, addEventListener: () => {}, removeEventListener: () => {}, setAttribute: () => {}, getContext: () => null });
globalThis.document = { createElementNS: fakeEl, createElement: fakeEl };
import fs from 'node:fs';
const THREE = await import('three');
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
for (const f of process.argv.slice(2)) {
  const buf = fs.readFileSync(f);
  const obj = f.endsWith('.obj') ? new OBJLoader().parse(buf.toString('utf8'))
    : new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  obj.updateMatrixWorld(true);
  let n = 0, tris = 0;
  const mats = new Map();
  const tops = new Map();
  const bb = new THREE.Box3();
  obj.traverse(o => {
    if (o.isMesh && o.geometry?.attributes?.position) {
      n++;
      const t = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
      tris += t;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach(m => mats.set(m.name, (mats.get(m.name) ?? 0) + t));
      let top = o;
      while (top.parent && top.parent !== obj) top = top.parent;
      tops.set(top.name, (tops.get(top.name) ?? 0) + t);
      o.geometry.computeBoundingBox();
      bb.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
    }
  });
  const s = bb.getSize(new THREE.Vector3());
  console.log(`\n${f}: meshes=${n} tris=${tris|0} bbox=${s.x.toFixed(1)}x${s.y.toFixed(1)}x${s.z.toFixed(1)} minY=${bb.min.y.toFixed(1)}`);
  console.log(' mats:', [...mats.entries()].map(([k, v]) => `${k}(${v|0})`).join(', ').slice(0, 300));
  if (tops.size <= 20) console.log(' tops:', [...tops.entries()].map(([k, v]) => `${k}(${v|0})`).join(', ').slice(0, 400));
}
