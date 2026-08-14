/**
 * WinRevealAnimation — subtle tile flip/reveal played when a player wins.
 *
 * On a winning hand the winner's concealed tiles are shown face-up to every
 * player; the animation eases each tile's "reveal" progress from 0 → 1 over
 * a short window (default 250 ms, matching the task's 200–300 ms spec), with a
 * slight per-tile stagger so the reveal reads as a fan-out rather than an
 * instant snap. The winner's highlight is the caller's responsibility — the
 * per-tile draw callback paints the final tile and any glow, and receives the
 * reveal progress so it can fade a highlight in as the reveal settles.
 *
 * The module is split into two layers for testability:
 *   - {@link computeReveal} is a pure function of (elapsed, duration, stagger,
 *     count) returning per-tile progress — headlessly unit-testable.
 *   - {@link WinRevealAnimation} is the canvas owner: it owns the
 *     requestAnimationFrame loop and paints the reveal by delegating each
 *     tile to a caller-supplied draw callback, so it stays independent of the
 *     concrete TileRenderer (a sibling-owned module) and of game state.
 */

/** The reveal progress of one tile at a moment in time. */
export interface TileRevealState {
  readonly index: number;
  /** 0 (fully hidden) → 1 (fully revealed). */
  readonly progress: number;
}

/** Ease-out cubic so tiles accelerate then settle (matches dealing animation). */
export function easeOutCubic(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return 1 - Math.pow(1 - x, 3);
}

/**
 * Pure reveal-progress computation.
 *
 * @param elapsed  Milliseconds since the reveal started.
 * @param duration Total reveal duration in ms.
 * @param stagger  Per-tile stagger in ms (0 = all reveal simultaneously).
 * @param count    Number of tiles being revealed.
 * @returns Per-tile progress in the given tile order.
 */
export function computeReveal(
  elapsed: number,
  duration: number,
  stagger: number,
  count: number,
): TileRevealState[] {
  const states: TileRevealState[] = [];
  const safeDuration = duration <= 0 ? 1 : duration;
  for (let i = 0; i < count; i++) {
    const start = i * stagger;
    const local = elapsed - start;
    const clamped = local <= 0 ? 0 : local >= safeDuration ? 1 : local / safeDuration;
    states.push({ index: i, progress: easeOutCubic(clamped) });
  }
  return states;
}

/** True once every tile has finished revealing at `elapsed`. */
export function isRevealComplete(
  elapsed: number,
  duration: number,
  stagger: number,
  count: number,
): boolean {
  if (count === 0) return true;
  const lastStart = (count - 1) * stagger;
  return elapsed >= lastStart + duration;
}

/** Options accepted by the {@link WinRevealAnimation} constructor. */
export interface WinRevealOptions {
  /** Total reveal duration in ms (spec: 200–300). */
  readonly durationMs?: number;
  /** Per-tile stagger in ms. */
  readonly staggerMs?: number;
}

/** A single tile the reveal should draw. */
export interface RevealTile {
  readonly index: number;
  /**
   * Draw callback invoked each frame with the tile's current reveal progress
   * (0 hidden → 1 revealed). The callback owns the tile's position, sprite,
   * and any winner highlight it wants to paint as the reveal settles.
   */
  readonly draw: (ctx: CanvasRenderingContext2D, progress: number) => void;
}

/**
 * Canvas animation that reveals a winning hand's tiles.
 *
 * The caller supplies, per tile, a draw callback that paints the tile at its
 * final position, scaling its "flip" by the supplied progress. The animation
 * owns only the loop and progress computation; it knows nothing about suits,
 * ranks, or sprites.
 */
export class WinRevealAnimation {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tiles: readonly RevealTile[];
  private readonly durationMs: number;
  private readonly staggerMs: number;

  private running = false;
  private rafId = 0;
  private startTime = 0;

  constructor(
    ctx: CanvasRenderingContext2D,
    tiles: readonly RevealTile[],
    options: WinRevealOptions = {},
  ) {
    this.ctx = ctx;
    this.tiles = tiles;
    this.durationMs = options.durationMs ?? 250;
    this.staggerMs = options.staggerMs ?? 45;
  }

  /** True while the reveal animation is actively running. */
  get isRunning(): boolean {
    return this.running;
  }

  /** The full duration including the final tile's stagger (ms). */
  get totalDurationMs(): number {
    return this.staggerMs * Math.max(0, this.tiles.length - 1) + this.durationMs;
  }

  /** Kick off the animation loop. Idempotent. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.startTime = performance.now();
    this.rafId = requestAnimationFrame((t) => this.tick(t));
  }

  /** Stop the loop and cancel any in-flight frame. */
  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /** Paint a single frame at a given elapsed time (ms). */
  paintAt(elapsed: number): void {
    const states = computeReveal(elapsed, this.durationMs, this.staggerMs, this.tiles.length);
    for (let i = 0; i < states.length; i++) {
      const state = states[i]!;
      const tile = this.tiles[i]!;
      if (state.progress <= 0) continue;
      tile.draw(this.ctx, state.progress);
    }
  }

  /** Render one full frame at `elapsed` and auto-stop when complete. */
  private tick(now: number): void {
    if (!this.running) return;
    const elapsed = now - this.startTime;
    this.paintAt(elapsed);
    if (isRevealComplete(elapsed, this.durationMs, this.staggerMs, this.tiles.length)) {
      this.running = false;
      return;
    }
    this.rafId = requestAnimationFrame((t) => this.tick(t));
  }
}
