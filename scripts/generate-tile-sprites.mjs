/**
 * Generates the 144 Mahjong tile sprites (plus the face-down back) as 80×120
 * PNGs into assets/tiles/.
 *
 * Uses Playwright's bundled Chromium to render each tile face on an offscreen
 * canvas and screenshot it, so the output is a real PNG with correct
 * anti-aliasing — no native canvas dependency required.
 *
 * Run: node scripts/generate-tile-sprites.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'assets', 'tiles');
const FONT_PATH = '/tmp/NotoSansSC.ttf';

const W = 80;
const H = 120;

const SUIT_COLORS = {
  bamboo: '#2e7d32',
  characters: '#c62828',
  dots: '#1565c0',
  winds: '#37474f',
  dragons: '#6a1b9a',
  flowers: '#e65100',
  seasons: '#00695c',
};

const WIND_GLYPHS = { east: '東', south: '南', west: '西', north: '北' };
const DRAGON_GLYPHS = { red: '中', green: '發', white: '白' };
const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

// The drawing code runs inside the page context (page.evaluate), so it must be
// a self-contained string. We build it once and reuse it for every tile.
const DRAW_FN = `
  const SUIT_COLORS = ${JSON.stringify(SUIT_COLORS)};
  const WIND_GLYPHS = ${JSON.stringify(WIND_GLYPHS)};
  const DRAGON_GLYPHS = ${JSON.stringify(DRAGON_GLYPHS)};
  const NUMERALS = ${JSON.stringify(NUMERALS)};
  const W = 80, H = 120;

  function drawSuitSymbol(c, s, r) {
    const cx = W / 2, cy = H / 2;
    const color = SUIT_COLORS[s];
    c.fillStyle = color; c.strokeStyle = color;
    if (s === 'bamboo') {
      c.lineWidth = 4;
      c.beginPath(); c.moveTo(cx, 20); c.lineTo(cx, H - 20); c.stroke();
      c.lineWidth = 3;
      for (let i = 0; i < r; i++) {
        const y = 30 + i * ((H - 60) / Math.max(1, r - 1));
        c.beginPath(); c.ellipse(cx - 8, y, 10, 5, -0.5, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.ellipse(cx + 8, y, 10, 5, 0.5, 0, Math.PI * 2); c.fill();
      }
    } else if (s === 'dots') {
      const cols = [1,2,3,2,3,3,3,4,3][r-1];
      const rows = [1,1,1,2,2,2,3,2,3][r-1];
      const spX = 18, spY = 18, rad = 7;
      const sx = cx - ((cols-1)*spX)/2, sy = cy - ((rows-1)*spY)/2;
      let d = 0;
      for (let row = 0; row < rows && d < r; row++)
        for (let col = 0; col < cols && d < r; col++) {
          c.beginPath(); c.arc(sx + col*spX, sy + row*spY, rad, 0, Math.PI*2); c.fill(); d++;
        }
    } else if (s === 'characters') {
      c.font = 'bold 44px "Noto Sans SC", sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(NUMERALS[r-1], cx, cy);
    } else if (s === 'winds') {
      const names = ['east','south','west','north'];
      c.font = 'bold 44px "Noto Sans SC", sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(WIND_GLYPHS[names[r-1]], cx, cy);
    } else if (s === 'dragons') {
      const names = ['red','green','white'];
      c.font = 'bold 44px "Noto Sans SC", sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(DRAGON_GLYPHS[names[r-1]], cx, cy);
    } else if (s === 'flowers') {
      c.font = 'bold 20px "Noto Sans SC", sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(r), cx, cy + 14);
      for (let i = 0; i < 5; i++) {
        const a = (i/5)*Math.PI*2;
        c.beginPath(); c.ellipse(cx + Math.cos(a)*12, cy - 8 + Math.sin(a)*12, 7, 7, a, 0, Math.PI*2); c.fill();
      }
    } else if (s === 'seasons') {
      c.font = 'bold 20px "Noto Sans SC", sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(r), cx, cy + 14);
      c.beginPath(); c.ellipse(cx, cy - 8, 10, 6, 0.4, 0, Math.PI*2); c.fill();
    }
  }

  function drawFace(c, s, r) {
    c.clearRect(0,0,W,H);
    c.fillStyle = '#f5f0e1';
    c.beginPath(); c.roundRect(2,2,W-4,H-4,8); c.fill();
    c.strokeStyle = '#bdb7a8'; c.lineWidth = 2; c.stroke();
    c.strokeStyle = '#d8d2c2'; c.lineWidth = 1;
    c.beginPath(); c.roundRect(8,8,W-16,H-16,5); c.stroke();
    drawSuitSymbol(c, s, r);
  }
`;

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.goto('about:blank');

  // Register the CJK font so Chinese glyphs render. Chromium blocks file://
  // URLs in page context, so embed the font as a base64 data URL via the
  // FontFace API and await its load before drawing any glyphs.
  const fontB64 = readFileSync(FONT_PATH).toString('base64');
  const fontDataUrl = `data:font/otf;base64,${fontB64}`;
  await page.evaluate(async (fontDataUrl) => {
    const face = new FontFace('Noto Sans SC', `url(${fontDataUrl})`);
    await face.load();
    document.fonts.add(face);
    await document.fonts.ready;
  }, fontDataUrl);

  const suits = [
    ['bamboo', 9],
    ['characters', 9],
    ['dots', 9],
    ['winds', 4],
    ['dragons', 3],
    ['flowers', 4],
    ['seasons', 4],
  ];

  // Canonical sprite file names per the architecture doc and @game-logic/tile:
  //   tile_{suit}_{rank}.png for numbered/bonus suits,
  //   tile_wind_{east|south|west|north}.png and tile_dragon_{red|green|white}.png.
  const WIND_TOKENS = ['east', 'south', 'west', 'north'];
  const DRAGON_TOKENS = ['red', 'green', 'white'];

  let count = 0;
  for (const [suit, maxRank] of suits) {
    for (let rank = 1; rank <= maxRank; rank++) {
      let token;
      if (suit === 'winds') token = `wind_${WIND_TOKENS[rank - 1]}`;
      else if (suit === 'dragons') token = `dragon_${DRAGON_TOKENS[rank - 1]}`;
      else token = `${suit}_${rank}`;
      const fileName = `tile_${token}.png`;
      const dataUrl = await page.evaluate(
        ({ suit, rank, drawFn }) => {
          const canvas = document.createElement('canvas');
          canvas.width = 80;
          canvas.height = 120;
          const ctx = canvas.getContext('2d');
          // eslint-disable-next-line no-eval
          (0, eval)(drawFn);
          drawFace(ctx, suit, rank);
          return canvas.toDataURL('image/png');
        },
        { suit, rank, drawFn: DRAW_FN },
      );
      writeFileSync(join(OUT_DIR, fileName), Buffer.from(dataUrl.split(',')[1], 'base64'));
      count++;
    }
  }

  // Face-down back.
  const backDataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 80;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 80, 120);
    ctx.fillStyle = '#2e6b4f';
    ctx.beginPath();
    ctx.roundRect(2, 2, 76, 116, 8);
    ctx.fill();
    ctx.strokeStyle = '#1e4a35';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#3d8a63';
    ctx.beginPath();
    ctx.roundRect(10, 12, 60, 96, 5);
    ctx.fill();
    ctx.strokeStyle = '#2a5c44';
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(10 + i * 12, 12);
      ctx.lineTo(10 + i * 12, 108);
      ctx.stroke();
    }
    return canvas.toDataURL('image/png');
  });
  writeFileSync(join(OUT_DIR, 'tile-back.png'), Buffer.from(backDataUrl.split(',')[1], 'base64'));
  count++;

  await browser.close();
  console.log(`Generated ${count} sprites into ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
