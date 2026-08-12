// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { HighlightRenderer } from './highlight-renderer';
import type { TileRect } from '../input/tile-picker';

function makeCtx(): CanvasRenderingContext2D {
  // jsdom does not implement a real 2D context; provide a stub with the
  // methods HighlightRenderer calls so we can assert on the draw calls.
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    shadowColor: '',
    shadowBlur: 0,
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  return ctx;
}

const rects: TileRect[] = [
  { tileId: 'a', x: 0, y: 0, width: 40, height: 60 },
  { tileId: 'b', x: 42, y: 0, width: 40, height: 60 },
];

describe('HighlightRenderer', () => {
  it('draws without throwing for empty state', () => {
    const ctx = makeCtx();
    const r = new HighlightRenderer();
    expect(() => r.draw(ctx, rects, { hovered: new Set(), selected: null, validMoves: new Set() })).not.toThrow();
  });

  it('draws a lifted selected tile above its row', () => {
    const ctx = makeCtx();
    const strokeRect = vi.spyOn(ctx, 'strokeRect');
    const r = new HighlightRenderer({ lift: 10 });
    r.draw(ctx, rects, { hovered: new Set(), selected: 'a', validMoves: new Set() });
    // The selected tile is drawn at y = 0 - 10 = -10, and strokeRect adds +1.
    expect(strokeRect).toHaveBeenCalledWith(1, -9, 38, 58);
  });

  it('tints valid-move tiles', () => {
    const ctx = makeCtx();
    const fillRect = vi.spyOn(ctx, 'fillRect');
    const r = new HighlightRenderer();
    r.draw(ctx, rects, { hovered: new Set(), selected: null, validMoves: new Set(['b']) });
    // Valid tint fill for tile b at (42, 0).
    expect(fillRect).toHaveBeenCalledWith(42, 0, 40, 60);
  });

  it('reports the lift offset', () => {
    const r = new HighlightRenderer({ lift: 8 });
    expect(r.getLiftOffset()).toBe(-8);
  });
});
