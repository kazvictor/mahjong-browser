/**
 * The initial-deal algorithm (Hong Kong Mahjong).
 *
 * Orchestrates the traditional deal from a {@link Wall}:
 *   1. Roll dice (done by the Wall when it breaks) — already applied.
 *   2. Deal 13 tiles to each of 4 players in 4-tile rounds (3 rounds of 4 = 12),
 *      then one final tile each (→ 13).
 *   3. The dealer draws a 14th tile to open their turn.
 *   4. Flowers and seasons drawn into a hand are immediately exposed and
 *      replaced (from the dead wall, then live wall), so every hand ends the
 *      deal with exactly the expected concealed count.
 *
 * Headless and canvas-free — the animation that moves tiles on screen is a
 * separate concern in @rendering.
 */
import {
  Wall,
  INITIAL_HAND_SIZE,
  PLAYER_COUNT,
  type WallTile,
} from './deal-wall';

/** A player seat in the dealing order. 0 is East (the dealer). */
export type Seat = 0 | 1 | 2 | 3;

/** The result of dealing one tile to one player. */
export interface DealStep {
  readonly seat: Seat;
  readonly tile: WallTile;
  /** True when this tile was drawn to replace a previously exposed bonus. */
  readonly isReplacement: boolean;
}

export interface DealResult {
  /** One entry per dealt-and-replaced tile, in draw order (replacement included). */
  readonly steps: readonly DealStep[];
  /** Final concealed hand per seat (excludes exposed bonus tiles). */
  readonly hands: ReadonlyArray<readonly WallTile[]>;
  /** Exposed bonus tiles per seat (flowers and seasons), in exposure order. */
  readonly exposed: ReadonlyArray<readonly WallTile[]>;
  /** The dealer's 14th opening tile, drawn after the 13-tile deal. */
  readonly dealerOpeningTile: WallTile;
  /** The wall after the deal (live wall minus 56 dealt tiles). */
  readonly wall: Wall;
}

/**
 * Deals the opening hands. `deal` is the standard 13-tile opening deal; `dealWithOpeningDraw`
 * additionally draws the dealer's 14th tile so the first turn can begin.
 */
export class DealingAlgorithm {
  private readonly wall: Wall;

  constructor(wall: Wall) {
    this.wall = wall;
  }

  /** Number of seats the algorithm deals to. */
  get seatCount(): number {
    return PLAYER_COUNT;
  }

  /**
   * Run the deal. Every seat receives exactly {@link INITIAL_HAND_SIZE} concealed
   * tiles after flowers/seasons have been exposed and replaced.
   */
  deal(): DealResult {
    const hands: WallTile[][] = Array.from({ length: PLAYER_COUNT }, () => []);
    const exposed: WallTile[][] = Array.from({ length: PLAYER_COUNT }, () => []);
    const steps: DealStep[] = [];

    // Round 1: 4 tiles per player.
    for (let round = 0; round < 3; round++) {
      for (let seat = 0 as Seat; seat < PLAYER_COUNT; seat++) {
        this.dealFour(steps, hands[seat] as WallTile[], exposed[seat] as WallTile[], seat);
      }
    }
    // Final single tile per player.
    for (let seat = 0 as Seat; seat < PLAYER_COUNT; seat++) {
      this.dealOne(steps, hands[seat] as WallTile[], exposed[seat] as WallTile[], seat);
    }

    // Dealer draws the 14th opening tile.
    const dealerOpeningTile = this.drawAndExpose(
      steps,
      hands[0] as WallTile[],
      exposed[0] as WallTile[],
      0 as Seat,
    );

    return {
      steps,
      hands,
      exposed,
      dealerOpeningTile,
      wall: this.wall,
    };
  }

  private dealFour(
    steps: DealStep[],
    hand: WallTile[],
    exposed: WallTile[],
    seat: Seat,
  ): void {
    for (let i = 0; i < 4; i++) {
      this.drawAndExpose(steps, hand, exposed, seat);
    }
  }

  private dealOne(
    steps: DealStep[],
    hand: WallTile[],
    exposed: WallTile[],
    seat: Seat,
  ): void {
    this.drawAndExpose(steps, hand, exposed, seat);
  }

  /**
   * Draw a tile, push it to the hand, and if it is a flower/season expose it
   * immediately and draw a replacement. Returns the final tile that stays in
   * the hand.
   */
  private drawAndExpose(
    steps: DealStep[],
    hand: WallTile[],
    exposed: WallTile[],
    seat: Seat,
  ): WallTile {
    let tile = this.wall.draw();
    steps.push({ seat, tile, isReplacement: false });
    while (tile.isBonus) {
      exposed.push(tile);
      tile = this.wall.drawReplacement();
      steps.push({ seat, tile, isReplacement: true });
    }
    hand.push(tile);
    return tile;
  }
}
