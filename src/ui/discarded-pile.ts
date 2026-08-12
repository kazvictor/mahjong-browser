/**
 * DiscardedPile — renders the shared discard pool in the center of the table.
 *
 * Discarded tiles are laid out in a compact grid (left-to-right, top-to-bottom)
 * so the pool stays readable as it grows. This is a pure Canvas 2D helper: it
 * takes the discard list and a draw callback for each tile, so it stays
 * independent of whichever module owns tile sprite rendering (a sibling task).
 *
 * The class also exposes the computed grid rectangles so the input layer can
 * hit-test the pool (e.g. to highlight the most recent discard) and so the
 * discard animation can target the correct cell.
 */

import { TILE_WIDTH, TILE_HEIGHT, type TileRect } from '../input/tile-picker';

export interface DiscardedPileOptions {
  /** Columns in the discard grid. */
  columns?: number;
  /** Gap between tiles in the grid (CSS px). */
  gap?: number;
  /** Top-left corner of the pool area (CSS px). */
  originX?: number;
  originY?: number;
}

export class DiscardedPile {
  private readonly columns: number;
  private readonly gap: number;
  private readonly originX: number;
  private readonly originY: number;

  constructor(options: DiscardedPileOptions = {}) {
    this.columns = options.columns ?? 6;
    this.gap = options.gap ?? 2;
    this.originX = options.originX ?? 0;
    this.originY = options.originY ?? 0;
  }

  /**
   * Compute the grid cell for the tile at `index` in the discard order.
   * Returns null when `index` is out of range.
   */
  cellForIndex(index: number): TileRect | null {
    if (index < 0) return null;
    const col = index % this.columns;
    const row = Math.floor(index / this.columns);
    return {
      tileId: `discard-${index}`,
      x: this.originX + col * (TILE_WIDTH + this.gap),
      y: this.originY + row * (TILE_HEIGHT + this.gap),
      width: TILE_WIDTH,
      height: TILE_HEIGHT,
      z: index, // later discards overlap earlier ones
    };
  }

  /** All grid cells for the current discard list (in discard order). */
  cellsForCount(count: number): TileRect[] {
    const cells: TileRect[] = [];
    for (let i = 0; i < count; i++) {
      const cell = this.cellForIndex(i);
      if (cell) cells.push(cell);
    }
    return cells;
  }

  /**
   * Draw the discard pool. `drawTile(ctx, rect, tile, index)` is responsible
   * for painting the actual tile face; this class only positions it.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    tiles: readonly unknown[],
    drawTile: (ctx: CanvasRenderingContext2D, rect: TileRect, tile: unknown, index: number) => void,
  ): void {
    for (let i = 0; i < tiles.length; i++) {
      const cell = this.cellForIndex(i);
      if (!cell) continue;
      drawTile(ctx, cell, tiles[i], i);
    }
  }
}
