/**
 * Discard strategies for AI players.
 *
 * A strategy is a pure decision function: given the current concealed hand
 * (and optionally a tile to favour keeping, e.g. the just-drawn tile when it
 * completes a meld), return which tile to discard. Keeping this free of game
 * state means it is trivially unit-testable headlessly.
 */
import type { Tile } from '../types';

/**
 * Contract for any discard-selection policy.
 *
 * `avoidTileId` is the id of a tile the caller would prefer to keep — the AI
 * will discard another tile if one is available rather than break up a
 * tile that just completed (or helped complete) a meld. Strategies that do
 * not model that preference can ignore it.
 */
export interface DiscardStrategy {
  /**
   * Pick a tile to discard from `hand`.
   *
   * @returns the tile to discard, or `null` if the hand is empty.
   */
  chooseTile(hand: readonly Tile[], avoidTileId?: string): Tile | null;
}

/**
 * True when `suit` denotes a flower or season bonus tile.
 */
export function isBonusSuit(suit: Tile['suit']): boolean {
  return suit === 'flowers' || suit === 'seasons';
}

/**
 * True if the given tile could complete a meld already present in `hand`
 * (a pung needs two more of the same tile; a chow needs two consecutive
 * neighbours in the same suit). Used to avoid mindlessly discarding a tile
 * that just finished a meld.
 */
export function tileCompletesMeld(hand: readonly Tile[], tile: Tile): boolean {
  // Pung: at least two other identical tiles already in hand.
  let matches = 0;
  for (const other of hand) {
    if (other.id !== tile.id && other.suit === tile.suit && other.rank === tile.rank) {
      matches += 1;
    }
  }
  if (matches >= 2) {
    return true;
  }

  // Chow: the tile is a numbered suit (ranks 1..9) and, together with two
  // other tiles already in hand, forms three consecutive ranks. The candidate
  // may sit at the start, middle, or end of the run, so check all three
  // positions: (r-2,r-1,r), (r-1,r,r+1), (r,r+1,r+2).
  if (tile.suit === 'bamboo' || tile.suit === 'characters' || tile.suit === 'dots') {
    const r = tile.rank;
    const has = (rank: number): boolean =>
      rank >= 1 && rank <= 9 && hand.some((t) => t.id !== tile.id && t.suit === tile.suit && t.rank === rank);

    if ((has(r - 2) && has(r - 1)) || (has(r - 1) && has(r + 1)) || (has(r + 1) && has(r + 2))) {
      return true;
    }
  }

  return false;
}

/**
 * Naive, strategy-free discard policy (MVP): pick a uniformly random tile.
 *
 * If `avoidTileId` is supplied and the hand contains any tile other than it,
 * the avoided tile is never chosen — protecting a tile that just completed a
 * meld. When the avoided tile is the only tile left it is returned anyway so
 * the game can never deadlock on an empty decision.
 */
export class RandomDiscardStrategy implements DiscardStrategy {
  private readonly random: () => number;

  /**
   * @param random Uniform RNG in [0, 1). Defaults to Math.random. Injectable
   *               for deterministic tests.
   */
  constructor(random: () => number = () => Math.random()) {
    this.random = random;
  }

  chooseTile(hand: readonly Tile[], avoidTileId?: string): Tile | null {
    if (hand.length === 0) {
      return null;
    }

    const candidates =
      avoidTileId !== undefined ? hand.filter((tile) => tile.id !== avoidTileId) : hand;

    const pool = candidates.length > 0 ? candidates : hand;
    const index = Math.min(pool.length - 1, Math.floor(this.random() * pool.length));
    return pool[index] ?? null;
  }
}
