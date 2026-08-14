/**
 * Save-system — pure serialization/deserialization for the Mahjong game state.
 *
 * This module is DOM-free and IndexedDB-free so the round-trip logic can be
 * unit tested headlessly (Vitest + jsdom). Storage (IndexedDB with a
 * localStorage fallback) lives in `save-storage.ts`; this module owns:
 *
 *   - The persisted document shape (`SavedGame`) that goes into a slot.
 *   - `serializeGame(snapshot, meta)` → the JSON string stored on disk.
 *   - `deserializeGame(json)` → a validated `SavedGame`, throwing on any
 *     corruption so callers surface an error instead of crashing.
 *   - A lightweight schema validator so corrupted saves are caught before
 *     they reach the live engine.
 *
 * Versioning: every saved document carries `version`. A future format change
 * bumps it and a migration step can be added here; today only version 1 is
 * accepted and anything else is rejected as corrupt.
 */
import type { GameSnapshot } from '@game-logic';
import { GameState, type Meld, type Suit, type Tile } from '@game-logic';

/** Current persisted-document format version. */
export const SAVE_VERSION = 1;

/** The valid Mahjong suits (used for corruption validation). */
const SUITS: readonly Suit[] = [
  'bamboo',
  'characters',
  'dots',
  'winds',
  'dragons',
  'flowers',
  'seasons',
];

/** Per-suit maximum rank (matches {@link SUIT_RANK_RANGE}). */
const MAX_RANK: Readonly<Record<Suit, number>> = {
  bamboo: 9,
  characters: 9,
  dots: 9,
  winds: 4,
  dragons: 3,
  flowers: 4,
  seasons: 4,
};

/** Player count expected in a mid-round save. */
const EXPECTED_PLAYERS = 4;

/**
 * The serialized tile. Kept intentionally flat (suit + rank) because the tile
 * `id` is redundant with its face for reconstruction purposes — a reloaded
 * tile needs only suit/rank to be rendered and matched by the rules engine.
 */
export interface SavedTile {
  readonly suit: Suit;
  readonly rank: number;
}

/** The serialized meld (a pung/kong/chow). */
export interface SavedMeld {
  readonly type: 'pung' | 'kong' | 'chow';
  readonly tiles: readonly SavedTile[];
  readonly isConcealed: boolean;
  readonly sourcePlayer?: number;
}

/** The serialized player at the table. */
export interface SavedPlayer {
  readonly id: number;
  readonly seat: number;
  readonly isAI: boolean;
  readonly tiles: readonly SavedTile[];
  readonly melds: readonly SavedMeld[];
  readonly bonusTiles: readonly SavedTile[];
  readonly score: number;
}

/**
 * The persisted document. This is the JSON shape stored in a save slot. It is
 * a strict subset of `GameSnapshot` (drop `lastEvent`, which is transient) plus
 * the metadata the save/load menu needs to describe a slot.
 */
export interface SavedGame {
  readonly version: number;
  readonly phase: GameState;
  readonly players: readonly SavedPlayer[];
  readonly wall: readonly SavedTile[];
  readonly deadWall: readonly SavedTile[];
  readonly discardPile: readonly SavedTile[];
  readonly currentPlayer: number;
  readonly dealer: number;
  readonly round: number;
  readonly seed: number;
  /** ISO timestamp of when the save was written. */
  readonly savedAt: string;
  /** True when this save came from the automatic per-turn save. */
  readonly isAutoSave: boolean;
}

/** Compact a live tile (as read from a snapshot) into its saved form. */
function toSavedTile(tile: Tile): SavedTile {
  return { suit: tile.suit, rank: tile.rank };
}

/** Compact a live meld into its saved form. */
function toSavedMeld(meld: Meld): SavedMeld {
  return {
    type: meld.type,
    tiles: meld.tiles.map(toSavedTile),
    isConcealed: meld.isConcealed,
    sourcePlayer: meld.sourcePlayer,
  };
}

/**
 * Serialize a `GameSnapshot` plus slot metadata into the JSON string that gets
 * persisted. `savedAt` and `isAutoSave` are provided by the caller so tests
 * can make them deterministic.
 *
 * @throws {Error} if the snapshot cannot be represented (should not happen for
 *   a snapshot produced by the engine, but the guard keeps bad data out).
 */
export function serializeGame(
  snapshot: GameSnapshot,
  meta: { savedAt?: string; isAutoSave?: boolean } = {},
): string {
  const saved: SavedGame = {
    version: SAVE_VERSION,
    phase: snapshot.phase,
    players: snapshot.players.map((p) => ({
      id: p.id,
      seat: p.seat,
      isAI: p.isAI,
      tiles: p.hand.tiles.map(toSavedTile),
      melds: p.hand.melds.map(toSavedMeld),
      bonusTiles: p.hand.bonusTiles.map(toSavedTile),
      score: p.score,
    })),
    wall: snapshot.wall.map(toSavedTile),
    deadWall: snapshot.deadWall.map(toSavedTile),
    discardPile: snapshot.discardPile.map(toSavedTile),
    currentPlayer: snapshot.currentPlayer,
    dealer: snapshot.dealer,
    round: snapshot.round,
    seed: snapshot.seed,
    savedAt: meta.savedAt ?? new Date().toISOString(),
    isAutoSave: meta.isAutoSave ?? false,
  };
  return JSON.stringify(saved);
}

/**
 * Parse a persisted JSON string into a validated `SavedGame`.
 *
 * @throws {Error} with a human-readable reason when the payload is not a
 *   valid save (not JSON, wrong version, unknown phase, malformed tiles, etc.)
 *   so the caller can show an error instead of crashing the game.
 */
export function deserializeGame(json: string): SavedGame {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('Save data is not valid JSON.');
  }
  if (!isSavedGame(raw)) {
    throw new Error('Save data is corrupted or from an incompatible version.');
  }
  return raw;
}

/**
 * Deep-validate an unknown value against the {@link SavedGame} shape. Returns
 * false (never throws) so callers can rely on it for guard checks.
 */
export function isSavedGame(value: unknown): value is SavedGame {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;

  if (v.version !== SAVE_VERSION) return false;
  if (typeof v.phase !== 'string' || !Object.values(GameState).includes(v.phase as GameState)) {
    return false;
  }
  if (!isFiniteNumber(v.currentPlayer) || !isFiniteNumber(v.dealer)) return false;
  if (!isFiniteNumber(v.round) || !isFiniteNumber(v.seed)) return false;
  if (typeof v.savedAt !== 'string' || typeof v.isAutoSave !== 'boolean') return false;

  // Players: must be a non-empty array for a mid-round game. The engine treats
  // an empty players list as "no round in progress" (IDLE), which we allow but
  // only when every other collection is also empty (a fresh/terminal state).
  if (!Array.isArray(v.players)) return false;
  if (v.players.length > 0 && v.players.length !== EXPECTED_PLAYERS) return false;
  if (!v.players.every(isSavedPlayer)) return false;

  if (!Array.isArray(v.wall) || !v.wall.every(isSavedTile)) return false;
  if (!Array.isArray(v.deadWall) || !v.deadWall.every(isSavedTile)) return false;
  if (!Array.isArray(v.discardPile) || !v.discardPile.every(isSavedTile)) return false;

  return true;
}

/**
 * Convert a validated {@link SavedGame} back into a {@link GameSnapshot} that
 * the engine's `restoreState()` accepts. The only field a save intentionally
 * drops is the transient `lastEvent`, which is set to `null` on load.
 *
 * Saved tiles store only suit+rank, so tiles are reconstructed with fresh,
 * globally-unique ids (the engine looks tiles up by id when discarding).
 */
export function savedToSnapshot(saved: SavedGame): GameSnapshot {
  // Sequential id generator so every reconstructed tile id is unique.
  let nextId = 0;
  const materialize = (tiles: readonly SavedTile[]): Tile[] =>
    tiles.map((t) => ({ id: `restored-${nextId++}`, suit: t.suit, rank: t.rank }));

  const players = saved.players.map((p) => ({
    id: p.id,
    seat: p.seat,
    isAI: p.isAI,
    score: p.score,
    hand: {
      tiles: materialize(p.tiles),
      melds: p.melds.map((m) => ({
        type: m.type,
        tiles: materialize(m.tiles),
        isConcealed: m.isConcealed,
        sourcePlayer: m.sourcePlayer,
      })),
      bonusTiles: materialize(p.bonusTiles),
    },
  }));
  return {
    phase: saved.phase,
    players,
    wall: materialize(saved.wall),
    deadWall: materialize(saved.deadWall),
    discardPile: materialize(saved.discardPile),
    currentPlayer: saved.currentPlayer,
    dealer: saved.dealer,
    round: saved.round,
    seed: saved.seed,
    lastEvent: null,
  };
}

function isSavedTile(value: unknown): value is SavedTile {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Record<string, unknown>;
  if (typeof t.suit !== 'string' || !(SUITS as readonly string[]).includes(t.suit)) return false;
  if (typeof t.rank !== 'number' || !Number.isInteger(t.rank)) return false;
  const max = MAX_RANK[t.suit as Suit];
  return t.rank >= 1 && t.rank <= max;
}

function isSavedMeld(value: unknown): value is SavedMeld {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  if (m.type !== 'pung' && m.type !== 'kong' && m.type !== 'chow') return false;
  if (typeof m.isConcealed !== 'boolean') return false;
  if (!Array.isArray(m.tiles) || !m.tiles.every(isSavedTile)) return false;
  if (m.sourcePlayer !== undefined && !isFiniteNumber(m.sourcePlayer)) return false;
  return true;
}

function isSavedPlayer(value: unknown): value is SavedPlayer {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  if (!isFiniteNumber(p.id) || !isFiniteNumber(p.seat)) return false;
  if (typeof p.isAI !== 'boolean') return false;
  if (typeof p.score !== 'number' || !Number.isFinite(p.score)) return false;
  if (!Array.isArray(p.tiles) || !p.tiles.every(isSavedTile)) return false;
  if (!Array.isArray(p.bonusTiles) || !p.bonusTiles.every(isSavedTile)) return false;
  if (!Array.isArray(p.melds) || !p.melds.every(isSavedMeld)) return false;
  return true;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
