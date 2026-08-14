/**
 * Public surface of the game-logic package.
 *
 * Barrel that re-exports the headless rules engine so consumers can import
 * from '@game-logic' without reaching into deep module paths.
 */

export type { Suit, Tile, Meld, MeldType, Hand, Player } from './types';
export { GameState, PHASE_TRANSITIONS, transition, canTransition } from './game-state';
export type { PhaseAction, PhaseTransition } from './game-state';
export type {
  GameEvent,
  TileDrawn,
  TileDiscarded,
  TileClaimed,
  MeldCalled,
  WinDeclared,
  GameStarted,
  RoundEnded,
  TurnStarted,
  TurnEnded,
} from './game-events';
export { EventBus } from './game-events';
export { MahjongGame, PLAYER_COUNT, HAND_SIZE } from './mahjong-game';
export type { GameSnapshot } from './mahjong-game';
export {
  detectMeldOpportunities,
  hasMeldOpportunity,
  meldHandCount,
  type MeldOpportunity,
} from './meld-system';
export { HongKongRules, isWinningHand, calculateFaan } from './rules/hong-kong-rules';
export type { FaanPattern } from './rules/hong-kong-rules';
export {
  Tile as TileClass,
  spriteToken,
  spriteFileName,
  TILE_BACK_FILE,
  WIND_NAMES,
  DRAGON_NAMES,
  SUIT_RANK_RANGE,
  type TileOptions,
} from './tile';
export {
  TileWall,
  Wall,
  SeededRng,
  rollDice,
  buildFullDeck,
  buildStandardWall,
  mulberry32,
  shuffle,
  TOTAL_TILES,
  WALL_ROWS,
  TILES_PER_ROW,
  DEAD_WALL_SIZE,
  INITIAL_HAND_SIZE,
  DEFAULT_SEED,
  type WallTile,
  type WallOptions,
  type Rng,
} from './wall';
