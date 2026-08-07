// Generates PWA PNG icons without any image dependency: draws the crosshair
// mark into a raw RGBA buffer and encodes a minimal PNG via node:zlib.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const BG = [0x0b, 0x0e, 0x11, 255];
const GREEN = [0x7d, 0xff, 0xa0, 255];
const DARK_GREEN = [0x2c, 0x8a, 0x4d, 255];
const GOLD = [0xff, 0xd2, 0x7a, 255];

function drawIcon(size, { maskable = false } = {}) {
  const px = new Uint8Array(size * size * 4);
  const c = size / 2;
  // maskable icons need the mark inside the 80% safe zone
  const s = maskable ? 0.72 : 1;
  const rOuter = 0.293 * size * s;
  const rInner = 0.168 * size * s;
  const rDot = 0.051 * size * s;
  const tickIn = 0.305 * size * s;
  const tickOut = 0.5 * size * (maskable ? 0.78 : 0.9);
  const wRing = 0.0176 * size * s;
  const wRing2 = 0.0098 * size * s;
  const wTick = 0.0215 * size * s;
  const rx = maskable ? 0 : 0.1875 * size;

  const put = (i, col) => { px.set(col, i * 4); };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      // rounded-rect clip for non-maskable
      if (rx > 0) {
        const qx = Math.max(Math.abs(x - c) - (c - rx), 0);
        const qy = Math.max(Math.abs(y - c) - (c - rx), 0);
        if (Math.hypot(qx, qy) > rx) { put(i, [0, 0, 0, 0]); continue; }
      }
      put(i, BG);
      const dx = x - c, dy = y - c;
      const d = Math.hypot(dx, dy);
      if (Math.abs(d - rOuter) < wRing) put(i, GREEN);
      else if (Math.abs(d - rInner) < wRing2) put(i, DARK_GREEN);
      const ad = Math.min(Math.abs(dx), Math.abs(dy));
      const far = Math.max(Math.abs(dx), Math.abs(dy));
      if (ad < wTick && far > tickIn && far < tickOut) put(i, GREEN);
      if (d < rDot) put(i, GOLD);
    }
  }
  return px;
}

// ------------------------------------------------------------ PNG encode

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let cc = n;
    for (let k = 0; k < 8; k++) cc = cc & 1 ? 0xedb88320 ^ (cc >>> 1) : cc >>> 1;
    t[n] = cc >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let cc = 0xffffffff;
  for (const b of buf) cc = CRC_TABLE[(cc ^ b) & 0xff] ^ (cc >>> 8);
  return (cc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // no filter
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

for (const [name, size, opts] of [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }]
]) {
  writeFileSync(join(outDir, name), encodePng(size, drawIcon(size, opts)));
  console.log('wrote', name);
}
