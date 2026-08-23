// Inspect vegetation FBX packs: top-level structure, meshes, tris, materials, bounds.
globalThis.window = globalThis;
const fakeEl = () => ({ style: {}, addEventListener: () => {}, removeEventListener: () => {}, setAttribute: () => {}, getContext: () => null });
globalThis.document = { createElementNS: fakeEl, createElement: fakeEl };

import fs from 'node:fs';
const THREE = await import('three');
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');

for (const f of process.argv.slice(2)) {
  const buf = fs.readFileSync(f);
  const obj = f.endsWith('.obj')
    ? new OBJLoader().parse(buf.toString('utf8'))
    : new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  obj.updateMatrixWorld(true);
  console.log('\n=== ' + f);
  console.log('top-level children:', obj.children.map(c => `${c.name}(${c.type})`).join(', ').slice(0, 400));
  let total = 0;
  obj.traverse(o => {
    if (o.isMesh) {
      const g = o.geometry;
      const tris = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
      total += tris;
      g.computeBoundingBox();
      const bb = g.boundingBox.clone().applyMatrix4(o.matrixWorld);
      const size = bb.getSize(new THREE.Vector3());
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const groups = g.groups?.length ?? 0;
      console.log(
        ` mesh "${o.name}" parent="${o.parent?.name}" tris=${tris | 0} groups=${groups}`,
        `size=${size.x.toFixed(1)}x${size.y.toFixed(1)}x${size.z.toFixed(1)}`,
        `min=(${bb.min.x.toFixed(1)},${bb.min.y.toFixed(1)},${bb.min.z.toFixed(1)})`,
        'mats=[' + mats.map(m => `${m.name}:#${m.color?.getHexString?.() ?? '??'}${m.map ? '+tex' : ''}`).join(', ').slice(0, 300) + ']'
      );
    }
  });
  console.log(' TOTAL tris:', total | 0);
}
