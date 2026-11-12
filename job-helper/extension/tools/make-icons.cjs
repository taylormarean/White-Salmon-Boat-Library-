// Draws the helper's icons (a green circle with a white "N") as PNG files.
// Not needed to use the extension: the PNGs are already in icons/.
// Run again with:  node tools/make-icons.cjs
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const GREEN = [46, 125, 79];
const WHITE = [255, 255, 255];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function draw(size) {
  const ss = 4; // supersampling
  const out = Buffer.alloc(size * size * 4);
  const stroke = size <= 16 ? 0.15 : 0.12;
  const L = 0.31, R = 0.69, T = 0.27, B = 0.73;
  const segs = [[L, T, L, B], [R, T, R, B], [L, T, R, B]];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inCircle = 0, inN = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / size;
          const v = (y + (sy + 0.5) / ss) / size;
          if (Math.hypot(u - 0.5, v - 0.5) <= 0.48) {
            inCircle++;
            if (segs.some((s) => distToSeg(u, v, ...s) <= stroke / 2)) inN++;
          }
        }
      }
      const n = ss * ss;
      const a = inCircle / n;
      const w = inCircle ? inN / inCircle : 0;
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(GREEN[c] * (1 - w) + WHITE[c] * w);
      out[i + 3] = Math.round(a * 255);
    }
  }
  return png(size, out);
}

const dir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(dir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  fs.writeFileSync(path.join(dir, `icon${size}.png`), draw(size));
  console.log(`icons/icon${size}.png`);
}
