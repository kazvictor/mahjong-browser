// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { TileRenderer, tileZOrder } from './tile-renderer';
import type { AssetLoader } from './asset-loader';

/** A stub AssetLoader that returns a fake image for any request. */
function makeLoader(): AssetLoader {
  const img = new Image();
  return {
    getBack: () => img,
    getFace: () => img,
    get: () => img,
  } as unknown as AssetLoader;
}

/** A stub 2D context with the methods TileRenderer calls. */
function makeCtx(): CanvasRenderingContext2D {
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    clip: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    shadowColor: '',
    shadowBlur: 0,
  } as unknown as CanvasRenderingContext2D;
  return ctx;
}

describe('TileRenderer', () => {
  it('draws a face-up tile at the given position', () => {
    const ctx = makeCtx();
    const drawImage = vi.spyOn(ctx, 'drawImage');
    const r = new TileRenderer(makeLoader());
    r.draw(ctx, 'bamboo', 1, 10, 20);
    expect(drawImage).toHaveBeenCalled();
    // drawImage is called with (img, x, y, w, h).
    const [, x, y, w, h] = drawImage.mock.calls[0] as unknown[];
    expect(x).toBe(10);
    expect(y).toBe(20);
    expect(w).toBe(40);
    expect(h).toBe(60);
  });

  it('lifts the selected tile above its baseline', () => {
    const ctx = makeCtx();
    const drawImage = vi.spyOn(ctx, 'drawImage');
    const r = new TileRenderer(makeLoader(), { lift: 10 });
    r.draw(ctx, 'dots', 5, 0, 100, { selected: true });
    const [, , y] = drawImage.mock.calls[0] as unknown[];
    expect(y).toBe(90); // 100 - 10
  });

  it('draws the back sprite when face-down', () => {
    const ctx = makeCtx();
    const loader = makeLoader();
    const getBack = vi.spyOn(loader, 'getBack');
    const r = new TileRenderer(loader);
    r.draw(ctx, 'bamboo', 1, 0, 0, { faceDown: true });
    expect(getBack).toHaveBeenCalled();
  });

  it('draws the face sprite when face-up', () => {
    const ctx = makeCtx();
    const loader = makeLoader();
    const getFace = vi.spyOn(loader, 'getFace');
    const r = new TileRenderer(loader);
    r.draw(ctx, 'characters', 3, 0, 0);
    expect(getFace).toHaveBeenCalledWith('characters', 3);
  });

  it('tints valid-move tiles', () => {
    const ctx = makeCtx();
    const fillRect = vi.spyOn(ctx, 'fillRect');
    const r = new TileRenderer(makeLoader());
    r.draw(ctx, 'bamboo', 1, 0, 0, { valid: true });
    expect(fillRect).toHaveBeenCalledWith(0, 0, 40, 60);
  });

  it('draws a border on the selected tile', () => {
    const ctx = makeCtx();
    const strokeRect = vi.spyOn(ctx, 'strokeRect');
    const r = new TileRenderer(makeLoader());
    r.draw(ctx, 'bamboo', 1, 0, 0, { selected: true });
    expect(strokeRect).toHaveBeenCalled();
  });

  it('reports the lift offset', () => {
    const r = new TileRenderer(makeLoader(), { lift: 8 });
    expect(r.getLiftOffset()).toBe(-8);
  });

  it('draws by file name (e.g. a wall back)', () => {
    const ctx = makeCtx();
    const drawImage = vi.spyOn(ctx, 'drawImage');
    const r = new TileRenderer(makeLoader());
    r.drawByFile(ctx, 'tile-back.png', 5, 5);
    expect(drawImage).toHaveBeenCalled();
  });
});

describe('tileZOrder', () => {
  it('ranks selected above hovered above valid above base', () => {
    expect(tileZOrder({ selected: true })).toBeGreaterThan(tileZOrder({ hovered: true }));
    expect(tileZOrder({ hovered: true })).toBeGreaterThan(tileZOrder({ valid: true }));
    expect(tileZOrder({ valid: true })).toBeGreaterThan(tileZOrder({}));
  });

  it('returns 0 for a plain tile', () => {
    expect(tileZOrder({})).toBe(0);
  });
});
