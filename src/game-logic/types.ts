/**
 * Core game-logic type definitions.
 *
 * These live in a DOM-free, canvas-free module so the rules engine can be unit
 * tested headlessly (Vitest + jsdom). Rendering concerns belong in @rendering;
 * DOM overlays belong in @ui.
 *
 * The discrete phase state machine (GameState enum, PhaseTransition) lives in
 * `game-state.ts`; this module holds only the structural tile/player types.
 */

/** The suits a Mahjong tile can belong to. */
export type Suit =
  | 'bamboo'
  | 'characters'
  | 'dots'
  | 'winds'
  | 'dragons'
  | 'flowers'
  | 'seasons';

/** A single Mahjong tile. */
export interface Tile {
  readonly id: string;
  readonly suit: Suit;
  /**
   * Rank within the suit: 1..9 for bamboo/characters/dots, 1..4 winds,
   * 1..3 dragons, 1..4 flowers/seasons.
   */
  readonly rank: number;
}

/** The kind of a meld. */
export type MeldType = 'pung' | 'kong' | 'chow';

/** A set of tiles a player has melded (a pung, kong, or chow). */
export interface Meld {
  readonly type: MeldType;
  readonly tiles: readonly Tile[];
  /** True if the meld was formed entirely from the player's own draws. */
  readonly isConcealed: boolean;
  /** Set when the meld claimed a discarded tile; the discarding player. */
  readonly sourcePlayer?: number;
}

/** A player's concealed hand plus exposed melds and bonus tiles. */
export interface Hand {
  readonly tiles: readonly Tile[];
  readonly melds: readonly Meld[];
  /** Flowers/seasons set aside as bonus tiles. */
  readonly bonusTiles: readonly Tile[];
}

/** A player seated at the table. */
export interface Player {
  readonly id: number;
  /** Seat index 0..3; 0 is East/dealer. */
  readonly seat: number;
  readonly isAI: boolean;
  readonly hand: Hand;
  score: number;
}
