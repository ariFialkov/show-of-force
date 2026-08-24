// Report baked variant dimensions to catch mis-oriented (side-lying) assets.
import fs from 'node:fs';
const buf = fs.readFileSync('public/models/props.bin');
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
const headerLen = dv.getUint32(4, true);
const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf.buffer, buf.byteOffset + 8, headerLen)).replace(/\0+$/, ''));
const base = 8 + headerLen;
console.log('magic', magic);
for (const [kind, list] of Object.entries(header.kinds)) {
  for (const v of list) {
    const p = new Float32Array(buf.buffer, buf.byteOffset + base + v.p.off, v.verts * 3);
    let minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9,minZ=1e9,maxZ=-1e9;
    for (let i = 0; i < p.length; i += 3) {
      minX=Math.min(minX,p[i]); maxX=Math.max(maxX,p[i]);
      minY=Math.min(minY,p[i+1]); maxY=Math.max(maxY,p[i+1]);
      minZ=Math.min(minZ,p[i+2]); maxZ=Math.max(maxZ,p[i+2]);
    }
    const sx=maxX-minX, sy=maxY-minY, sz=maxZ-minZ;
    const flag = (kind==='palm'||kind==='fir'||kind==='leafy'||kind==='cactus') && (sy < Math.max(sx,sz)*0.85) ? '  <-- LYING DOWN?' : '';
    console.log(`${kind}/${v.name}: ${sx.toFixed(2)} x ${sy.toFixed(2)} x ${sz.toFixed(2)} (h=${v.height.toFixed(2)} r=${v.radius.toFixed(2)})${flag}`);
  }
}
