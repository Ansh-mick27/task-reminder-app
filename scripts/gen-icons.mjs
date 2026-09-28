// Generates the app's PNG icons (a Poké Ball on an ocean-mist background)
// with no dependencies. Run: node scripts/gen-icons.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

const OUT = new URL("../web/icons/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const BG = [79, 158, 168];     // --primary
const TOP = [232, 137, 125];   // soft coral (--red)
const LINE = [53, 80, 90];     // --ball-line
const WHITE = [253, 253, 253];

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Color of a point in unit space [0,1]² or null (transparent).
function pokeball(x, y, { bg, ballScale, corner, mono }) {
  const cx = x - 0.5, cy = y - 0.5;
  let base = null;
  if (bg) {
    // Rounded square (or full bleed if corner is 0)
    const r = corner, ax = Math.abs(cx) - (0.5 - r), ay = Math.abs(cy) - (0.5 - r);
    const outside = ax > 0 && ay > 0 ? Math.hypot(ax, ay) > r : false;
    base = outside ? null : BG;
  }
  const R = 0.5 * ballScale;
  const d = Math.hypot(cx, cy);
  const stroke = R * 0.09;
  if (d > R) return base;
  const color = (c) => (mono ? [255, 255, 255] : c);
  if (d > R - stroke) return color(LINE);
  if (d < R * 0.3) return d > R * 0.3 - stroke ? color(LINE) : (mono ? null : WHITE);
  if (Math.abs(cy) < stroke * 0.9) return color(LINE);
  if (mono) return [255, 255, 255];
  return cy < 0 ? TOP : WHITE;
}

function render(size, opts) {
  const ss = 4, buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const c = pokeball((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size, opts);
      if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
    }
    const i = (y * size + x) * 4;
    if (a) { buf[i] = r / a; buf[i + 1] = g / a; buf[i + 2] = b / a; }
    buf[i + 3] = Math.round((a / (ss * ss)) * 255);
  }
  return png(size, buf);
}

const icons = {
  "icon-192.png": [192, { bg: true, ballScale: 0.72, corner: 0.22 }],
  "icon-512.png": [512, { bg: true, ballScale: 0.72, corner: 0.22 }],
  "maskable-512.png": [512, { bg: true, ballScale: 0.56, corner: 0 }],
  "badge-72.png": [72, { bg: false, ballScale: 0.9, mono: true }],
};
for (const [name, [size, opts]] of Object.entries(icons)) {
  writeFileSync(new URL(name, OUT), render(size, opts));
  console.log("wrote", name);
}

// Android launcher icons for devices older than Android 8 (newer ones use
// the adaptive icon in android/app/src/main/res/mipmap-anydpi-v26).
const RES = new URL("../android/app/src/main/res/", import.meta.url);
const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [d, size] of Object.entries(densities)) {
  const dir = new URL(`mipmap-${d}/`, RES);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL("ic_launcher.png", dir), render(size, { bg: true, ballScale: 0.72, corner: 0.22 }));
  console.log(`wrote mipmap-${d}/ic_launcher.png`);
}
