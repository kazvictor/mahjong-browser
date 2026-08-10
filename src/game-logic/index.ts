/**
 * Public surface of the game-logic package.
 *
 * Barrel that re-exports the headless rules engine so consumers can import
 * from '@game-logic' without reaching into deep module paths.
 */

export type { Suit, Tile, Meld, Hand, GameState, GamePhase } from './types';
