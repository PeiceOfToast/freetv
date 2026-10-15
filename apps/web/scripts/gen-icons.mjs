// Rasterises public/favicon.svg into the PNG icons referenced by the web app manifest and
// <link rel="apple-touch-icon">. Run with `npm run icons` after changing the favicon.
//
// - icon-192 / icon-512: the mark on a transparent background ("any" purpose).
// - maskable-512 / apple-touch-icon: the mark on a full-bleed square, scaled to 80% so it stays
//   inside the maskable safe zone (and iOS's own corner mask).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = await readFile(path.join(root, "public", "favicon.svg"));
const outDir = path.join(root, "public", "icons");

// The favicon's own card colour (#18181b), used as the backdrop for masked icons.
const CARD = { r: 24, g: 24, b: 27, alpha: 1 };
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

/** The mark rasterised at `size` px; `inset` is the fraction of each side left empty. */
async function mark(size, inset = 0) {
  const inner = Math.round(size * (1 - 2 * inset));
  return sharp(svg, { density: 1200 })
    .resize(inner, inner, { fit: "contain", background: CLEAR })
    .png()
    .toBuffer();
}

async function plain(size) {
  return mark(size);
}

async function masked(size, inset = 0.1) {
  return sharp({ create: { width: size, height: size, channels: 4, background: CARD } })
    .composite([{ input: await mark(size, inset), gravity: "centre" }])
    .png()
    .toBuffer();
}

await mkdir(outDir, { recursive: true });
const outputs = {
  "icon-192.png": await plain(192),
  "icon-512.png": await plain(512),
  "maskable-512.png": await masked(512),
  "apple-touch-icon.png": await masked(180, 0.1),
};
for (const [name, buf] of Object.entries(outputs)) {
  await writeFile(path.join(outDir, name), buf);
  console.log(`wrote public/icons/${name} (${buf.length} bytes)`);
}
