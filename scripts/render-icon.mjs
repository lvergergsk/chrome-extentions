import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../utils/icons");
const INDIGO = [91, 92, 226];
const WHITE = [255, 255, 255];
const SIZES = [16, 32, 48, 128];

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const typeBuf = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
};

const encodePng = (width, height, rgba) => {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const dest = y * (width * 4 + 1);
    raw[dest] = 0;
    rgba.copy(raw, dest + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const rotate = (x, y, angle) => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [x * cos - y * sin, x * sin + y * cos];
};

const sdCircle = (x, y, radius) => Math.hypot(x, y) - radius;

const sdRoundedBox = (x, y, halfX, halfY, radius) => {
  const ax = Math.abs(x) - halfX + radius;
  const ay = Math.abs(y) - halfY + radius;
  return Math.hypot(Math.max(ax, 0), Math.max(ay, 0)) + Math.min(Math.max(ax, ay), 0) - radius;
};

const sdCapsule = (x, y, ax, ay, bx, by, radius) => {
  const pax = x - ax;
  const pay = y - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const denom = bax * bax + bay * bay;
  const h = denom === 0 ? 0 : Math.min(1, Math.max(0, (pax * bax + pay * bay) / denom));
  return Math.hypot(pax - bax * h, pay - bay * h) - radius;
};

const distToRay = (px, py, dx, dy) => {
  const t = Math.max(0, px * dx + py * dy);
  return Math.hypot(px - dx * t, py - dy * t);
};

const sdWedge = (x, y, halfAngle) => {
  const qy = Math.abs(y);
  const ang = Math.atan2(qy, x);
  const radius = Math.hypot(x, qy);
  if (ang <= halfAngle) {
    return -radius * Math.sin(halfAngle - ang);
  }
  return distToRay(x, qy, Math.cos(halfAngle), Math.sin(halfAngle));
};

const opUnion = (a, b) => Math.min(a, b);
const opSub = (a, b) => Math.max(a, -b);

const wrenchSd = (cx, cy, pixel) => {
  const [x, y] = rotate(cx, cy, (40 * Math.PI) / 180);
  const shaft = sdCapsule(x, y, -0.06, 0, 0.1, 0, 0.074);
  const headX = x + 0.25;
  const jawX = x - 0.25;
  const solid = opUnion(
    opUnion(shaft, sdRoundedBox(headX, y, 0.12, 0.12, 0.04)),
    sdCircle(jawX, y, 0.15),
  );
  const holeRadius = Math.max(0.05, pixel * 1.35);
  const cut = opUnion(
    opUnion(sdCircle(headX, y, holeRadius), sdCircle(jawX, y, 0.072)),
    sdWedge(jawX, y, 0.72),
  );
  return opSub(solid, cut);
};

const badgeSd = (cx, cy) => sdRoundedBox(cx, cy, 0.488, 0.488, 0.22);

const coverage = (distance, pixel) => Math.min(1, Math.max(0, 0.5 - distance / pixel));

const render = (size) => {
  const rgba = Buffer.alloc(size * size * 4);
  const samples = size <= 32 ? 5 : 3;
  const pixel = 1 / size;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const u = (px + (sx + 0.5) / samples) / size - 0.5;
          const v = (py + (sy + 0.5) / samples) / size - 0.5;
          const badge = coverage(badgeSd(u, v), pixel);
          if (badge <= 0) {
            continue;
          }
          const glyph = coverage(wrenchSd(u, v, pixel), pixel);
          r += (INDIGO[0] * (1 - glyph) + WHITE[0] * glyph) * badge;
          g += (INDIGO[1] * (1 - glyph) + WHITE[1] * glyph) * badge;
          b += (INDIGO[2] * (1 - glyph) + WHITE[2] * glyph) * badge;
          a += badge;
        }
      }
      const count = samples * samples;
      const i = (py * size + px) * 4;
      const alpha = a / count;
      rgba[i] = alpha > 0 ? Math.round(r / a) : 0;
      rgba[i + 1] = alpha > 0 ? Math.round(g / a) : 0;
      rgba[i + 2] = alpha > 0 ? Math.round(b / a) : 0;
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }

  return encodePng(size, size, rgba);
};

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  mkdirSync(outDir, { recursive: true });
  for (const size of SIZES) {
    writeFileSync(path.join(outDir, `${size}.png`), render(size));
  }
  console.log(`Wrote ${SIZES.map((size) => `${size}.png`).join(", ")} to ${outDir}`);
}
