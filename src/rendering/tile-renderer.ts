/**
 * TileRenderer — draws a single Mahjong tile sprite onto a Canvas 2D context.
 *
 * Owns the visual presentation of one tile: which sprite to use (face vs.
 * back), the draw size (logical CSS px, scaled from the 2x sprite), and the
 * interaction states (selected, hovered) that make a tile legible. It draws
 * *one* tile at a time; layout (hand rows, wall rows, z-ordering across many
 * tiles) is the caller's responsibility, but the renderer exposes a stable
 * z-order contract so callers can sort tiles before drawing.
 *
 * The sibling HighlightRenderer paints overlay glows/borders on top of the
 * tile layer; TileRenderer keeps the base tile + a subtle per-tile state
 * treatment (lift + tint) so a tile is still visibly distinct even without
 * the overlay pass.
 */

import { TILE_BACK_FILE, type Suit } from '../game-logic/tile';
import { AssetLoader, TILE_HEIGHT, TILE_WIDTH } from './asset-loader';

/** Visual state of a tile for a single draw call. */
export interface TileDrawState {
  /** True to draw the face-down back instead of the face. */
  readonly faceDown?: boolean;
  /** True when the tile is currently selected (drawn lifted + tinted). */
  readonly selected?: boolean;
  /** True when the tile is under the cursor (drawn with a soft glow). */
  readonly hovered?: boolean;
  /** True when the tile is a legal move (drawn with a subtle tint). */
  readonly valid?: boolean;
}

/** Options accepted by the {@link TileRenderer} constructor. */
export interface TileRendererOptions {
  /** How far a selected tile rises above its baseline (CSS px). */
  readonly lift?: number;
  /** Tint color for the selected tile. */
  readonly selectedColor?: string;
  /** Glow color for the hovered tile. */
  readonly hoverColor?: string;
  /** Tint color for a valid-move tile. */
  readonly validColor?: string;
  /** Corner radius of the tile face (CSS px). */
  readonly radius?: number;
}

/**
 * Draws one tile sprite with its interaction-state treatment.
 *
 * The renderer is stateless between calls: every `draw` takes the full state
 * it needs, so the same instance can be reused across frames and tiles.
 */
export class TileRenderer {
  private readonly loader: AssetLoader;
  private readonly lift: number;
  private readonly selectedColor: string;
  private readonly hoverColor: string;
  private readonly validColor: string;
  private readonly radius: number;

  constructor(loader: AssetLoader, options: TileRendererOptions = {}) {
    this.loader = loader;
    this.lift = options.lift ?? 10;
    this.selectedColor = options.selectedColor ?? 'rgba(255, 213, 79, 0.28)';
    this.hoverColor = options.hoverColor ?? 'rgba(255, 255, 255, 0.30)';
    this.validColor = options.validColor ?? 'rgba(76, 175, 80, 0.16)';
    this.radius = options.radius ?? 6;
  }

  /** The y-offset a selected tile is drawn at (negative = up). */
  getLiftOffset(): number {
    return -this.lift;
  }

  /**
   * Draw a tile at (x, y) in logical CSS px.
   *
   * @param suit  The tile's suit (ignored when `faceDown`).
   * @param rank  The tile's rank (ignored when `faceDown`).
   * @param x     Left edge of the draw rect.
   * @param y     Top edge of the draw rect (before any selection lift).
   * @param state Interaction state for this draw.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    suit: Suit,
    rank: number,
    x: number,
    y: number,
    state: TileDrawState = {},
  ): void {
    const drawY = state.selected ? y - this.lift : y;

    // Valid-move tint sits under the sprite.
    if (state.valid) {
      this.fillTint(ctx, x, drawY, this.validColor);
    }

    const img = state.faceDown ? this.loader.getBack() : this.loader.getFace(suit, rank);
    this.drawImage(ctx, img, x, drawY);

    // Hover glow on top of the sprite.
    if (state.hovered) {
      this.drawGlow(ctx, x, drawY);
    }
    // Selected tint + border on top of everything.
    if (state.selected) {
      this.fillTint(ctx, x, drawY, this.selectedColor);
      this.drawBorder(ctx, x, drawY);
    }
  }

  /**
   * Draw a tile by its sprite file name (face or back) directly. Useful when
   * the caller already knows the exact asset (e.g. a face-down wall tile).
   */
  drawByFile(
    ctx: CanvasRenderingContext2D,
    fileName: string,
    x: number,
    y: number,
    state: TileDrawState = {},
  ): void {
    const drawY = state.selected ? y - this.lift : y;
    if (state.valid) {
      this.fillTint(ctx, x, drawY, this.validColor);
    }
    const img = fileName === TILE_BACK_FILE ? this.loader.getBack() : this.loader.get(fileName);
    this.drawImage(ctx, img, x, drawY);
    if (state.hovered) {
      this.drawGlow(ctx, x, drawY);
    }
    if (state.selected) {
      this.fillTint(ctx, x, drawY, this.selectedColor);
      this.drawBorder(ctx, x, drawY);
    }
  }

  private drawImage(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    x: number,
    y: number,
  ): void {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, TILE_WIDTH, TILE_HEIGHT, this.radius);
    ctx.clip();
    ctx.drawImage(img, x, y, TILE_WIDTH, TILE_HEIGHT);
    ctx.restore();
  }

  private fillTint(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
    ctx.save();
    ctx.fillStyle = color;
    ctx.fillRect(x, y, TILE_WIDTH, TILE_HEIGHT);
    ctx.restore();
  }

  private drawGlow(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.save();
    ctx.shadowColor = this.hoverColor;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = this.hoverColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, TILE_WIDTH - 2, TILE_HEIGHT - 2);
    ctx.restore();
  }

  private drawBorder(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.save();
    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1, y + 1, TILE_WIDTH - 2, TILE_HEIGHT - 2);
    ctx.restore();
  }
}

/**
 * Z-order contract for drawing many tiles.
 *
 * Lower values are drawn first (behind). The renderer itself draws one tile;
 * callers sort their tile list by this key before drawing so that, e.g., a
 * selected (lifted) tile paints above its neighbours.
 */
export function tileZOrder(state: TileDrawState): number {
  if (state.selected) return 3;
  if (state.hovered) return 2;
  if (state.valid) return 1;
  return 0;
}
