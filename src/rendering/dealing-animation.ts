/**
 * Canvas animation that visualizes the opening deal.
 *
 * Given a {@link Wall} and a {@link DealResult}, renders the four wall rows and
 * animates each dealt tile gliding from its wall slot to the target player's
 * hand area. Uses an eased progress curve driven by requestAnimationFrame so the
 * deal reads as a traditional fan-out rather than an instant teleport.
 *
 * Rendering-only: it consumes the immutable deal result and mutates nothing in
 * the game logic. Draw order (z-order) is respected by painting the wall first,
 * then tiles, so tiles always appear on top of the table surface.
 */
import type { Wall } from '@game-logic/deal-wall';
import type { DealResult } from '@game-logic/dealing';

/** Logical (CSS-pixel) dimensions of a single tile as drawn. */
export const TILE_W = 40;
export const TILE_H = 60;
/** Gap between neighbouring tiles in a row. */
const TILE_GAP = 2;
/** Wall inset from the canvas edge. */
const WALL_MARGIN = 40;

/** Per-seat hand anchor on screen, in fractional coordinates of the canvas. */
const HAND_ANCHORS: ReadonlyArray<[number, number]> = [
  [0.5, 0.9], // South (you) at the bottom.
  [0.9, 0.5], // West at the right.
  [0.5, 0.1], // North at the top.
  [0.1, 0.5], // East at the left.
];

/** Ease-out cubic so tiles accelerate then settle naturally. */
function easeOutCubic(t: number): number {
  const x = 1 - t;
  return 1 - x * x * x;
}

/**
 * Renders the four wall rows and the dealing fan-out animation on a canvas.
 * Owns its own requestAnimationFrame loop while it is running.
 */
export class DealingAnimation {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly wall: Wall;
  private readonly deal: DealResult;

  /** Duration of a single tile flight in ms. */
  private readonly flightMs: number;
  /** How far apart in time successive tiles start (stagger). */
  private readonly staggerMs: number;

  private running = false;
  private rafId = 0;
  private startTime = 0;

  constructor(
    canvas: HTMLCanvasElement,
    wall: Wall,
    deal: DealResult,
    flightMs = 450,
    staggerMs = 90,
  ) {
    this.canvas = canvas;
    this.wall = wall;
    this.deal = deal;
    this.flightMs = flightMs;
    this.staggerMs = staggerMs;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable — dealing animation cannot start.');
    }
    this.ctx = ctx;
  }

  /** Kick off the animation loop. Idempotent: safe to call repeatedly. */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.startTime = performance.now();
    this.rafId = requestAnimationFrame((t: number) => this.tick(t));
  }

  /** Stop the loop and cancel any in-flight frame. */
  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private tick(now: number): void {
    if (!this.running) {
      return;
    }
    const elapsed = now - this.startTime;
    this.render(elapsed);

    // The animation is complete once the last tile has finished flying.
    const lastStart = (this.deal.steps.length - 1) * this.staggerMs;
    if (elapsed >= lastStart + this.flightMs) {
      this.running = false;
      return;
    }
    this.rafId = requestAnimationFrame((t: number) => this.tick(t));
  }

  /** Paint one frame for the given elapsed time. */
  private render(elapsed: number): void {
    const { width, height } = this.canvas;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, width, height);
    this.drawWall(ctx, width);

    // Paint every tile that has started flying, in deal order (later tiles on top).
    this.deal.steps.forEach((step, i) => {
      const startOffset = i * this.staggerMs;
      if (elapsed < startOffset) {
        return;
      }
      const local = Math.min(1, (elapsed - startOffset) / this.flightMs);
      const eased = easeOutCubic(local);
      const [ax, ay] = HAND_ANCHORS[step.seat] as [number, number];
      const targetX = ax * width - TILE_W / 2;
      const targetY = ay * height - TILE_H / 2;
      const from = this.wallSlotPosition(width, i);
      const x = from[0] + (targetX - from[0]) * eased;
      const y = from[1] + (targetY - from[1]) * eased;
      this.drawTileBack(ctx, x, y);
    });
  }

  /**
   * Estimate the screen position a dealt tile starts from, in draw order.
   * Maps linear deal order onto the wall grid so tiles visibly emanate from the
   * wall rather than from a fixed point.
   */
  private wallSlotPosition(width: number, index: number): [number, number] {
    const rowCount = this.wall.rows.length;
    const row = Math.floor(index / TILE_WALL_COLS) % rowCount;
    const col = index % TILE_WALL_COLS;
    const rowWidth = TILE_WALL_COLS * TILE_W + (TILE_WALL_COLS - 1) * TILE_GAP;
    const x = (width - rowWidth) / 2 + col * (TILE_W + TILE_GAP);
    const y = WALL_MARGIN + row * (TILE_H + 6);
    return [x, y];
  }

  /** Draw all four wall rows as face-down tile backs. */
  private drawWall(ctx: CanvasRenderingContext2D, width: number): void {
    const rowCount = this.wall.rows.length;
    for (let row = 0; row < rowCount; row++) {
      const rowTiles = this.wall.rows[row] as readonly unknown[];
      const n = rowTiles.length;
      const rowWidth = n * TILE_W + (n - 1) * TILE_GAP;
      const x0 = (width - rowWidth) / 2;
      const y0 = WALL_MARGIN + row * (TILE_H + 6);
      for (let col = 0; col < n; col++) {
        this.drawTileBack(ctx, x0 + col * (TILE_W + TILE_GAP), y0);
      }
    }
  }

  /** Draw a single face-down tile as a rounded rectangle. */
  private drawTileBack(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const radius = 6;
    ctx.beginPath();
    ctx.roundRect(x, y, TILE_W, TILE_H, radius);
    ctx.fillStyle = '#2e6b4f';
    ctx.fill();
    ctx.strokeStyle = '#1e4a35';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Inner face-down pip.
    ctx.fillStyle = '#3d8a63';
    ctx.beginPath();
    ctx.roundRect(x + 8, y + 10, TILE_W - 16, TILE_H - 20, 4);
    ctx.fill();
  }
}

/** Number of tile columns in a wall row (36 tiles per row). */
const TILE_WALL_COLS = 36;
