'use strict';

const fs   = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');

function getPixel(x, y, sz) {
  const cx = sz / 2, cy = sz / 2, r = sz * 0.45;
  const dx = x - cx, dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > r) return [5, 8, 16];
  if (dist > r - sz * 0.04) return [26, 37, 64];

  const nx = x / sz, ny = y / sz;
  const sTop     = nx > 0.25 && nx < 0.75 && ny > 0.25 && ny < 0.38;
  const sBottom  = nx > 0.25 && nx < 0.75 && ny > 0.62 && ny < 0.75;
  const sMiddle  = nx > 0.25 && nx < 0.75 && ny > 0.46 && ny < 0.54;
  const sTopLeft = nx > 0.25 && nx < 0.38 && ny > 0.25 && ny < 0.52;
  const sBotRight= nx > 0.62 && nx < 0.75 && ny > 0.48 && ny < 0.75;

  if (sTop || sBottom || sMiddle || sTopLeft || sBotRight) {
    const t = dist / r;
    return [
      Math.round(167 - t * 30),
      Math.round(139 - t * 20),
      Math.round(250 - t * 20),
    ];
  }

  const gx = Math.abs((nx * 2) % 1 - 0.5) < 0.03;
  const gy = Math.abs((ny * 2) % 1 - 0.5) < 0.03;
  if (gx || gy) return [11, 15, 28];

  return [8, 11, 20];
}

function makeImage(sz) {
  const rowPad  = (4 - ((sz * 3) % 4)) % 4;
  const rowSize = sz * 3 + rowPad;
  const maskRowSz = Math.ceil(sz / 8);
  const maskPad  = (4 - (maskRowSz % 4)) % 4;
  const maskRowSize = maskRowSz + maskPad;

  const bmpSize = 40 + rowSize * sz + maskRowSize * sz;
  const bmp = Buffer.alloc(bmpSize, 0);

  bmp.writeUInt32LE(40,        0);
  bmp.writeInt32LE(sz,         4);
  bmp.writeInt32LE(sz * 2,     8);
  bmp.writeUInt16LE(1,        12);
  bmp.writeUInt16LE(24,       14);
  bmp.writeUInt32LE(0,        16);
  bmp.writeUInt32LE(rowSize * sz, 20);
  bmp.writeUInt32LE(0,        24);
  bmp.writeUInt32LE(0,        28);
  bmp.writeUInt32LE(0,        32);
  bmp.writeUInt32LE(0,        36);

  let off = 40;
  for (let y = sz - 1; y >= 0; y--) {
    for (let x = 0; x < sz; x++) {
      const [r, g, b] = getPixel(x, y, sz);
      bmp[off++] = b;
      bmp[off++] = g;
      bmp[off++] = r;
    }
    for (let p = 0; p < rowPad; p++) bmp[off++] = 0;
  }

  return bmp;
}

function writeICO(sizes) {
  const images = sizes.map(makeImage);
  const count  = sizes.length;
  const dirSize = 6 + count * 16;

  const parts  = [Buffer.alloc(dirSize, 0)];
  let offset = dirSize;

  const dir = parts[0];
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(count, 4);

  images.forEach((img, i) => {
    const sz  = sizes[i];
    const base = 6 + i * 16;
    dir[base]     = sz >= 256 ? 0 : sz;
    dir[base + 1] = sz >= 256 ? 0 : sz;
    dir[base + 2] = 0;
    dir[base + 3] = 0;
    dir.writeUInt16LE(1,          base + 4);
    dir.writeUInt16LE(24,         base + 6);
    dir.writeUInt32LE(img.length, base + 8);
    dir.writeUInt32LE(offset,     base + 12);
    offset += img.length;
    parts.push(img);
  });

  return Buffer.concat(parts);
}

fs.mkdirSync(ASSETS, { recursive: true });

const ico = writeICO([16, 32, 48, 64, 128, 256]);
const icoPath = path.join(ASSETS, 'icon.ico');
fs.writeFileSync(icoPath, ico);
console.log(`icon.ico: ${(ico.length / 1024).toFixed(1)} KB (6 sizes: 16→256)`);
