/**
 * Builds a contact sheet of all tile sprites for visual inspection.
 * Run: node scripts/make-contact-sheet.mjs
 */
import { chromium } from 'playwright';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TILES_DIR = join(__dirname, '..', 'assets', 'tiles');
const OUT = join(__dirname, '..', 'assets', 'tiles', '_contact-sheet.png');

const COLS = 8;
const CELL = 80;
const GAP = 4;
const LABEL_H = 16;

async function main() {
  const files = readdirSync(TILES_DIR).filter((f) => f.endsWith('.png') && !f.startsWith('_'));
  files.sort();
  const rows = Math.ceil(files.length / COLS);
  const width = COLS * (CELL + GAP) + GAP;
  const height = rows * (CELL + LABEL_H + GAP) + GAP;

  // Read each PNG in Node and pass it as a data URL so the page can draw it
  // without file:// access (which Chromium blocks in page context).
  const dataUrls = files.map((f) => {
    const buf = readFileSync(join(TILES_DIR, f));
    return `data:image/png;base64,${buf.toString('base64')}`;
  });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto('about:blank');

  const dataUrl = await page.evaluate(
    async ({ files, dataUrls, COLS, CELL, GAP, LABEL_H, width, height }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#123524';
      ctx.fillRect(0, 0, width, height);

      const load = (src) =>
        new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = src;
        });

      for (let i = 0; i < files.length; i++) {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const x = GAP + col * (CELL + GAP);
        const y = GAP + row * (CELL + LABEL_H + GAP);
        const img = await load(dataUrls[i]);
        ctx.drawImage(img, x, y, CELL, CELL);
        ctx.fillStyle = '#ffffff';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(files[i].replace('tile_', '').replace('.png', ''), x + CELL / 2, y + CELL + 12);
      }
      return canvas.toDataURL('image/png');
    },
    { files, dataUrls, COLS, CELL, GAP, LABEL_H, width, height },
  );

  writeFileSync(OUT, Buffer.from(dataUrl.split(',')[1], 'base64'));
  await browser.close();
  console.log(`Contact sheet written to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
