/**
 * Core game-logic type definitions.
 *
 * These live in a DOM-free, canvas-free module so the rules engine can be unit
 * tested headlessly (Vitest + jsdom). Rendering concerns belong in @rendering;
 * DOM overlays belong in @ui.
 */

/** The suits a Mahjong tile can belong to. */
export type Suit = 'bamboo' | 'characters' | 'dots' | 'winds' | 'dragons' | 'flowers';

/** A single Mahjong tile. */
export interface Tile {
  readonly id: string;
  readonly suit: Suit;
  /** Rank within the suit (1..9 for bamboo/characters/dots, 1..4 winds, 1..3 dragons). */
  readonly rank: number;
}

/** A set of tiles a player has melded (a pung, kong, or chow). */
export interface Meld {
  readonly tiles: readonly Tile[];
}

/** A player's concealed hand. */
export interface Hand {
  readonly tiles: readonly Tile[];
  readonly melds: readonly Meld[];
}

/** Discrete phases of a Mahjong round. */
export type GamePhase = 'setup' | 'playing' | 'round-end';

/** The mutable state machine carried by a MahjongGame instance. */
export interface GameState {
  /** Remaining tiles in the wall, drawn from the top. */
  wall: readonly Tile[];
  playerHand: readonly Tile[];
  discardPile: readonly Tile[];
  phase: GamePhase;
}
