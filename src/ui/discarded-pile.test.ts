// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { DiscardedPile } from './discarded-pile';
import { TILE_WIDTH, TILE_HEIGHT } from '../input/tile-picker';

describe('DiscardedPile', () => {
  it('lays tiles in a grid left-to-right, top-to-bottom', () => {
    const pile = new DiscardedPile({ columns: 3, gap: 2, originX: 10, originY: 20 });
    expect(pile.cellForIndex(0)).toMatchObject({ x: 10, y: 20, width: TILE_WIDTH, height: TILE_HEIGHT });
    expect(pile.cellForIndex(1)).toMatchObject({ x: 10 + TILE_WIDTH + 2, y: 20 });
    expect(pile.cellForIndex(3)).toMatchObject({ x: 10, y: 20 + TILE_HEIGHT + 2 });
  });

  it('returns null for out-of-range indices', () => {
    const pile = new DiscardedPile();
    expect(pile.cellForIndex(-1)).toBeNull();
  });

  it('produces one cell per discard', () => {
    const pile = new DiscardedPile({ columns: 6 });
    expect(pile.cellsForCount(0)).toEqual([]);
    expect(pile.cellsForCount(4)).toHaveLength(4);
  });

  it('draws each tile through the provided callback', () => {
    // jsdom has no real 2D context; DiscardedPile only passes it through.
    const ctx = {} as CanvasRenderingContext2D;
    const pile = new DiscardedPile({ columns: 6 });
    const drawTile = vi.fn();
    pile.draw(ctx, ['t1', 't2', 't3'], drawTile);
    expect(drawTile).toHaveBeenCalledTimes(3);
    const first = drawTile.mock.calls[0]!;
    expect(first[2]).toBe('t1');
    expect(first[3]).toBe(0);
  });
});
