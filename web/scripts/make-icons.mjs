// Generates the PWA / home-screen icons as real PNGs.
//
// This machine has no SVG rasterizer (no ImageMagick, no rsvg-convert; only
// `sips`, which can't read SVG), so rather than add a build dependency we
// encode the PNGs directly: zlib is in Node, and a flat geometric icon is
// trivial to write as raw RGBA scanlines.
//
// The mark matches the nexus: black field, green orbit ring, white core —
// the same "agent constellation" language as the dashboard itself.
//
//   node web/scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

// ── minimal PNG encoder ─────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** rgba: Buffer of size*size*4 → PNG buffer */
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  // 10,11,12 = compression/filter/interlace, all 0

  // Each scanline gets a leading filter byte (0 = none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const o = y * (size * 4 + 1);
    raw[o] = 0;
    rgba.copy(raw, o + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── the mark ────────────────────────────────────────────────────────────────
const GREEN = [0x2b, 0xff, 0x88];
const WHITE = [0xe9, 0xf0, 0xea];
const RED = [0xff, 0x2d, 0x3f];

/**
 * @param size    pixel dimension
 * @param inset   0..1 — how much of the tile the mark occupies. Maskable icons
 *                need everything inside the centre ~80% so Android's circular
 *                crop doesn't cut it.
 */
function draw(size, inset) {
  const px = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const R = (size / 2) * inset;

  const put = (i, rgb, a) => {
    px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; px[i + 3] = Math.round(a * 255);
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const d = Math.hypot(x - c, y - c);
      // opaque black field
      px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 255;

      const ringR = R * 0.72, ringW = R * 0.085;
      const coreR = R * 0.2;
      const alertR = R * 0.95, alertW = R * 0.035;

      // soft 1px edge so the curves don't look jagged at 192px
      const band = (dist, radius, width) => {
        const e = Math.abs(dist - radius);
        return e <= width / 2 ? 1 : e <= width / 2 + 1 ? 1 - (e - width / 2) : 0;
      };

      const a1 = band(d, ringR, ringW);
      if (a1 > 0) put(i, GREEN, a1);

      const a2 = band(d, alertR, alertW);
      if (a2 > 0) put(i, RED, a2 * 0.55);

      if (d <= coreR + 1) put(i, WHITE, d <= coreR ? 1 : 1 - (d - coreR));
    }
  }
  return px;
}

mkdirSync(OUT, { recursive: true });
const files = [
  ['icon-192.png', 192, 0.78],
  ['icon-512.png', 512, 0.78],
  ['icon-maskable-512.png', 512, 0.62], // extra padding for Android's crop
  ['apple-touch-icon.png', 180, 0.78],  // iOS uses this for Add to Home Screen
];
for (const [name, size, inset] of files) {
  const buf = encodePng(size, draw(size, inset));
  writeFileSync(join(OUT, name), buf);
  console.log(`  ${name.padEnd(24)} ${size}x${size}  ${(buf.length / 1024).toFixed(1)} KB`);
}
console.log(`\nwrote ${files.length} icons to web/public/icons/`);
