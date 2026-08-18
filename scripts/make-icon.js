#!/usr/bin/env node
/**
 * Convert the source whale PNG into a Windows .ico (256x256, RGBA).
 *
 *   node scripts/make-icon.js
 *
 * Reads:  <projectRoot>/assets/whale.png
 * Writes: <projectRoot>/build/icon.ico
 */

'use strict';

const sharp = require('sharp');
const { default: pngToIco } = require('png-to-ico');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_PNG = path.join(ROOT, 'assets', 'whale.png');
const OUT_DIR = path.join(ROOT, 'build');
const OUT_ICO = path.join(OUT_DIR, 'icon.ico');

// Rounded-corner radius in pixels. Set to 0 to disable.
const RADIUS = 32;
const SIZE = 256;

function roundedRectSvg(size, radius) {
  return Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="white"/>` +
      `</svg>`
  );
}

async function main() {
  if (!fs.existsSync(SRC_PNG)) {
    console.error(`[make-icon] source image not found: ${SRC_PNG}`);
    console.error('Place the whale PNG at assets/whale.png and re-run.');
    process.exit(1);
  }

  await fs.promises.mkdir(OUT_DIR, { recursive: true });

  // 256x256 keeps the ICO small while staying crisp at every Explorer size.
  const resized = await sharp(SRC_PNG)
    .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // Render the rounded-rect SVG to a grayscale mask, then use it as the alpha
  // channel so everything outside the rounded rectangle becomes transparent.
  const mask = await sharp(roundedRectSvg(SIZE, RADIUS))
    .resize(SIZE, SIZE)
    .toColourspace('b-w')
    .toBuffer();

  const rounded = await sharp(resized)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  const ico = await pngToIco(rounded);
  await fs.promises.writeFile(OUT_ICO, ico);

  console.log(`[make-icon] wrote ${OUT_ICO} (${ico.length} bytes, ${RADIUS}px rounded corners)`);
}

main().catch((err) => {
  console.error('[make-icon] failed:', err);
  process.exit(1);
});
