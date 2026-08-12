/**
 * HighlightRenderer — draws selection, hover, and valid-move highlights on top
 * of the tile layer.
 *
 * It is a pure Canvas 2D helper: given a 2D context and a set of tile
 * rectangles, it paints the visual affordances that make interaction legible:
 *   - hover: a soft outer glow around the tile under the cursor
 *   - selected: a bright border + a raised (lifted) tile drawn above the row
 *   - valid move: a subtle tint on tiles the player may discard
 *
 * The renderer does not own the game state or the input state; the caller
 * passes in which tiles are hovered/selected/valid each frame. This keeps it
 * decoupled from the in-flight game engine and trivially testable.
 */

import { type TileRect } from '../input/tile-picker';

export interface HighlightState {
  /** Tile ids currently under the cursor. */
  readonly hovered: ReadonlySet<string>;
  /** The single selected tile id, if any. */
  readonly selected: string | null;
  /** Tile ids the player may legally discard this turn. */
  readonly validMoves: ReadonlySet<string>;
}

export interface HighlightRendererOptions {
  /** How far the selected tile rises above its row baseline (CSS px). */
  lift?: number;
  /** Border color for the selected tile. */
  selectedColor?: string;
  /** Glow color for the hovered tile. */
  hoverColor?: string;
  /** Tint color for valid-move tiles. */
  validColor?: string;
}

export class HighlightRenderer {
  private readonly lift: number;
  private readonly selectedColor: string;
  private readonly hoverColor: string;
  private readonly validColor: string;

  constructor(options: HighlightRendererOptions = {}) {
    this.lift = options.lift ?? 10;
    this.selectedColor = options.selectedColor ?? '#ffd54f';
    this.hoverColor = options.hoverColor ?? 'rgba(255, 255, 255, 0.35)';
    this.validColor = options.validColor ?? 'rgba(76, 175, 80, 0.18)';
  }

  /**
   * Draw all highlights for the given rects. `state` describes which tiles are
   * hovered/selected/valid. The selected tile is drawn lifted above its row.
   */
  draw(ctx: CanvasRenderingContext2D, rects: readonly TileRect[], state: HighlightState): void {
    // Valid-move tint first (under everything else).
    for (const rect of rects) {
      if (state.validMoves.has(rect.tileId)) {
        this.fillTint(ctx, rect, this.validColor);
      }
    }

    // Hover glow.
    for (const rect of rects) {
      if (state.hovered.has(rect.tileId)) {
        this.drawGlow(ctx, rect, this.hoverColor);
      }
    }

    // Selected tile: draw lifted + bordered last so it sits on top.
    if (state.selected !== null) {
      const rect = rects.find((r) => r.tileId === state.selected);
      if (rect) {
        this.drawSelected(ctx, rect);
      }
    }
  }

  /** The y-offset a selected tile should be drawn at (negative = up). */
  getLiftOffset(): number {
    return -this.lift;
  }

  private fillTint(ctx: CanvasRenderingContext2D, rect: TileRect, color: string): void {
    ctx.save();
    ctx.fillStyle = color;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.restore();
  }

  private drawGlow(ctx: CanvasRenderingContext2D, rect: TileRect, color: string): void {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
    ctx.restore();
  }

  private drawSelected(ctx: CanvasRenderingContext2D, rect: TileRect): void {
    const y = rect.y - this.lift;
    ctx.save();
    // Bright border around the lifted tile.
    ctx.strokeStyle = this.selectedColor;
    ctx.lineWidth = 3;
    ctx.strokeRect(rect.x + 1, y + 1, rect.width - 2, rect.height - 2);
    // Soft glow behind the lifted tile so it reads as "raised".
    ctx.shadowColor = this.selectedColor;
    ctx.shadowBlur = 16;
    ctx.fillStyle = 'rgba(255, 213, 79, 0.12)';
    ctx.fillRect(rect.x, y, rect.width, rect.height);
    ctx.restore();
  }
}
