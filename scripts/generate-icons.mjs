#!/usr/bin/env node
/** Generate Session Tracker app icons from a single programmatic design.

Design: dark slate circle (#24292E) with a white clock hand (no text).
Outputs:
  - public/icon-192.png
  - public/icon-512.png
  - public/icon-512-maskable.png  (masked play area per PWA maskable guideline)
*/
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const PUBLIC = path.resolve(process.cwd(), "public");
fs.mkdirSync(PUBLIC, { recursive: true });

const SLATE = "#24292e";
const WHITE = "#ffffff";

/** SVG string for the icon, in a 100x100 viewBox. */
function iconSvg(maskable) {
  const pad = maskable ? 0.18 : 0.12;
  const inner = 1 - 2 * pad;
  const r = inner * 0.52;
  const cx = 0.5;
  const cy = 0.52;
  const handLen = r * 0.72;
  const hourAngle = -0.55;
  const minAngle = 1.05;
  const hx = cx + Math.sin(hourAngle) * handLen;
  const hy = cy - Math.cos(hourAngle) * handLen;
  const mx = cx + Math.sin(minAngle) * handLen;
  const my = cy - Math.cos(minAngle) * handLen;
  const hubR = r * 0.14;
  const tickLen = r * 0.18;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
    <rect x="0" y="0" width="100" height="100" fill="#ffffff"/>
    <circle cx="${(cx * 100).toFixed(3)}" cy="${(cy * 100).toFixed(3)}" r="${(r * 100).toFixed(3)}" fill="${SLATE}"/>
    <line x1="${(cx * 100).toFixed(3)}" y1="${(cy * 100).toFixed(3)}" x2="${(hx * 100).toFixed(3)}" y2="${(hy * 100).toFixed(3)}"
          stroke="${WHITE}" stroke-width="6.2" stroke-linecap="round"/>
    <line x1="${(cx * 100).toFixed(3)}" y1="${(cy * 100).toFixed(3)}" x2="${(mx * 100).toFixed(3)}" y2="${(my * 100).toFixed(3)}"
          stroke="${WHITE}" stroke-width="3.4" stroke-linecap="round"/>
    <circle cx="${(cx * 100).toFixed(3)}" cy="${(cy * 100).toFixed(3)}" r="${(hubR * 100).toFixed(3)}" fill="${WHITE}"/>
    <line x1="${(cx * 100).toFixed(3)}" y1="${((cy - tickLen) * 100).toFixed(3)}" x2="${(cx * 100).toFixed(3)}" y2="${((cy - r * 0.02) * 100).toFixed(3)}"
          stroke="${WHITE}" stroke-width="2.4" stroke-linecap="round" opacity="0.92"/>
  </svg>`;
}

async function main() {
  const sizes = [192, 512];

  for (const size of sizes) {
    const svgPath = path.join(PUBLIC, `icon-${size}.tmp.svg`);
    await fs.promises.writeFile(svgPath, iconSvg(false), "utf8");
    await sharp(svgPath)
      .resize(size, size, { fit: "fill" })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(path.join(PUBLIC, `icon-${size}.png`));
    await fs.promises.unlink(svgPath);
    console.log(`wrote public/icon-${size}.png  (${size}x${size})`);
  }

  const maskSize = 512;
  const safe = Math.round(maskSize * 0.82);
  const svgPath = path.join(PUBLIC, `icon-${maskSize}-maskable.tmp.svg`);
  await fs.promises.writeFile(svgPath, iconSvg(true), "utf8");
  const pngPath = path.join(PUBLIC, `icon-${maskSize}-pre.tmp.png`);
  await sharp(svgPath)
    .resize(maskSize, maskSize, { fit: "fill" })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(pngPath);
  await fs.promises.unlink(svgPath);
  const half = Math.floor((maskSize - safe) / 2);
  await sharp(pngPath)
    .extract({ left: half, top: half, width: safe, height: safe })
    .resize(maskSize, maskSize, { fit: "fill" })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(path.join(PUBLIC, `icon-${maskSize}-maskable.png`));
  await fs.promises.unlink(pngPath);
  console.log(
    `wrote public/icon-${maskSize}-maskable.png  (centered ${safe}x${safe} safe area -> ${maskSize}x${maskSize})`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
