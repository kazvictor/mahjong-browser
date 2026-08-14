/**
 * RiichiDisplay — riichi sticks and honba (repeat-round) counter.
 *
 * A riichi stick is placed in the center of the table when a player declares
 * riichi; the honba counter tracks repeated rounds (each draw that ends in a
 * draw or a dealer win increments honba, raising the hand value next round).
 *
 * This module is split for testability:
 *   - {@link RiichiLayout} is a pure geometry module that positions a grid of
 *     sticks in the table's center plus a honba counter badge — headlessly
 *     unit-testable.
 *   - {@link RiichiDisplay} is the canvas owner that paints sticks and the
 *     counter using a caller-supplied tile-ish draw callback, so it stays
 *     independent of the concrete sprite renderer and of game state.
 *
 * The engine does not yet track riichi/honba state, so the UI reads that state
 * from a snapshot supplied by the caller each frame. See {@link RiichiState}.
 */

/** Logical (CSS-px) size of a riichi stick. */
export const STICK_W = 22;
export const STICK_H = 8;

/** Gap between adjacent sticks (CSS px). */
export const STICK_GAP = 3;

/** The center region a stick grid occupies (fraction of the smaller dimension). */
const CENTER_SIZE = 0.16;

/** Riichi + honba state to render for one frame. */
export interface RiichiState {
  /**
   * Player ids who have declared riichi, in seat order. The display shows one
   * stick per entry; the index is the seat.
   */
  readonly riichiPlayers: readonly number[];
  /** Number of repeated (honba) rounds. 0 when none. */
  readonly honba: number;
}

/** A single positioned riichi stick. */
export interface RiichiStick {
  readonly seat: number;
  readonly x: number;
  readonly y: number;
  /** 1-based index within the grid (for labeling / z-order). */
  readonly index: number;
}

/** The complete riichi layout for one frame. */
export interface RiichiLayoutFrame {
  readonly sticks: readonly RiichiStick[];
  /** Center point of the honba counter badge. */
  readonly honbaX: number;
  readonly honbaY: number;
}

/**
 * Pure layout engine for riichi sticks + honba counter. Stateless; instantiate
 * once and call {@link compute} each frame.
 */
export class RiichiLayout {
  /**
   * Compute stick positions in the table's center.
   *
   * @param width  Canvas logical width (CSS px).
   * @param height Canvas logical height (CSS px).
   * @param state  Current riichi / honba state.
   */
  compute(width: number, height: number, state: RiichiState): RiichiLayoutFrame {
    const cx = width / 2;
    const cy = height / 2;
    const count = state.riichiPlayers.length;

    const sticks: RiichiStick[] = [];
    if (count > 0) {
      const gridWidth = count * STICK_W + (count - 1) * STICK_GAP;
      const x0 = cx - gridWidth / 2;
      // Slight offset up from center so the honba badge can sit just below.
      const y0 = cy - STICK_H / 2 - STICK_H - 4;
      state.riichiPlayers.forEach((seat, i) => {
        sticks.push({ seat, x: x0 + i * (STICK_W + STICK_GAP), y: y0, index: i + 1 });
      });
    }

    const honbaRadius = CENTER_SIZE * Math.min(width, height);
    return {
      sticks,
      honbaX: cx,
      honbaY: cy + honbaRadius * 0.4,
    };
  }
}

/** Options accepted by the {@link RiichiDisplay} constructor. */
export interface RiichiDisplayOptions {
  /** Fill color for a riichi stick. */
  readonly stickColor?: string;
  /** Stroke color for a riichi stick. */
  readonly stickBorderColor?: string;
  /** Text/icon color for the honba badge. */
  readonly badgeColor?: string;
  /** Background color for the honba badge. */
  readonly badgeBackground?: string;
}

/**
 * Canvas renderer for riichi sticks and the honba counter. Uses a small
 * `drawIcon` callback so the caller supplies whatever glyph it wants (a
 * stick-shaped rect or a tile-like sprite) without coupling to a concrete
 * renderer.
 */
export class RiichiDisplay {
  private readonly layout = new RiichiLayout();
  private readonly stickColor: string;
  private readonly stickBorderColor: string;
  private readonly badgeColor: string;
  private readonly badgeBackground: string;

  constructor(options: RiichiDisplayOptions = {}) {
    this.stickColor = options.stickColor ?? '#d9a520';
    this.stickBorderColor = options.stickBorderColor ?? '#7a5c10';
    this.badgeColor = options.badgeColor ?? '#f5e9c8';
    this.badgeBackground = options.badgeBackground ?? 'rgba(20, 40, 30, 0.85)';
  }

  /**
   * Draw the riichi + honba overlay.
   *
   * @param ctx Canvas 2D context.
   * @param width  Canvas logical width (CSS px).
   * @param height Canvas logical height (CSS px).
   * @param state  Current riichi / honba state.
   * @param drawStick Optional callback to draw a stick body; when omitted a
   *                  default rounded rectangle is drawn.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    state: RiichiState,
    drawStick?: (ctx: CanvasRenderingContext2D, stick: RiichiStick) => void,
  ): void {
    const frame = this.layout.compute(width, height, state);

    for (const stick of frame.sticks) {
      if (drawStick) {
        drawStick(ctx, stick);
      } else {
        this.drawDefaultStick(ctx, stick);
      }
    }

    if (state.honba > 0) {
      this.drawHonba(ctx, frame.honbaX, frame.honbaY, state.honba);
    }
  }

  private drawDefaultStick(ctx: CanvasRenderingContext2D, stick: RiichiStick): void {
    ctx.save();
    ctx.fillStyle = this.stickColor;
    ctx.strokeStyle = this.stickBorderColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(stick.x, stick.y, STICK_W, STICK_H, 3);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawHonba(ctx: CanvasRenderingContext2D, x: number, y: number, honba: number): void {
    ctx.save();
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = `Honba ${honba}`;
    const width = ctx.measureText(label).width + 20;
    ctx.fillStyle = this.badgeBackground;
    ctx.beginPath();
    ctx.roundRect(x - width / 2, y - 14, width, 28, 14);
    ctx.fill();
    ctx.fillStyle = this.badgeColor;
    ctx.fillText(label, x, y);
    ctx.restore();
  }
}
