/**
 * Snapshot-bridge — the seam between the persistence layer and the live engine.
 *
 * The sibling persistence modules serialize a `GameSnapshot` into a `SavedGame`
 * document (dropping the transient tile `id`s — only suit+rank is stored, which
 * is all the renderer and rules engine need to display/match tiles). This module
 * performs the reverse direction: it turns a validated `SavedGame` back into a
 * full `GameSnapshot` ready to hand to `MahjongGame.restore()`.
 *
 * Because `SavedGame` deliberately omits tile ids, this bridge must re-synthesize
 * them. Every tile instance in the snapshot gets a unique, deterministic id so the
 * engine's id-keyed operations (`discardTile(id)`, `claimDiscard(id)`, …) never
 * mistake two identical-face tiles for one another. Ids are stable for a given
 * save document (the traversal order is fixed), so a save→load→save round-trip
 * preserves them.
 *
 * This module also owns the deeper integrity validation that `isSavedGame`'s
 * structural check cannot express (seat uniqueness, seated turn owner, collection
 * bounds). A save that passes the structural validator but fails these invariant
 * checks is treated as corrupted and surfaced as an error by the caller.
 */
import { GameState, type GameSnapshot, type Meld, type Suit, type Tile } from '@game-logic';
import type { SavedGame, SavedMeld, SavedTile } from './save-system';

/** Number of players the engine expects in a live round. */
const PLAYER_COUNT = 4;

/**
 * Re-hydrate a validated {@link SavedGame} into a {@link GameSnapshot}.
 *
 * @throws {Error} with a human-readable reason when the document violates a
 *   structural invariant (wrong seat count, duplicate/unknown seats, turn owner
 *   or dealer not seated, or a phase the engine cannot be restored into). The
 *   caller surfaces this as a corrupted-save error.
 */
export function savedGameToSnapshot(saved: SavedGame): GameSnapshot {
  // A single counter shared by every tile materialized from this save, so no
  // two tiles in the restored snapshot ever collide — the engine's id-keyed
  // operations (discardTile, claimDiscard) depend on globally unique ids.
  const counter = new TileIdCounter();

  const playerStates = saved.players.map((p) => ({
    id: p.id,
    seat: p.seat,
    isAI: p.isAI,
    hand: {
      tiles: savedTilesToTiles(p.tiles, counter),
      melds: savedMeldsToMelds(p.melds, counter),
      bonusTiles: savedTilesToTiles(p.bonusTiles, counter),
    },
    score: p.score,
  }));

  validateSeats(playerStates.map((p) => p.id), playerStates.map((p) => p.seat));
  validateOwner(saved.currentPlayer, playerStates, 'currentPlayer');
  validateOwner(saved.dealer, playerStates, 'dealer');
  validatePhase(saved.phase);

  return {
    phase: saved.phase,
    players: playerStates,
    wall: savedTilesToTiles(saved.wall, counter),
    deadWall: savedTilesToTiles(saved.deadWall, counter),
    discardPile: savedTilesToTiles(saved.discardPile, counter),
    currentPlayer: saved.currentPlayer,
    dealer: saved.dealer,
    round: saved.round,
    seed: saved.seed,
    lastEvent: null, // transient — never persisted; a restored game has no last event
    winResult: null, // transient — a restored game has no in-flight win resolution
    scoreResult: null,
  };
}

/** True when a phase is a live-round phase the engine can be restored into. */
export function isRestorablePhase(phase: GameState): boolean {
  return (
    phase === GameState.DEALING ||
    phase === GameState.DRAW ||
    phase === GameState.DISCARD ||
    phase === GameState.DECLARE ||
    phase === GameState.MELD ||
    phase === GameState.WIN
  );
}

// ---------------------------------------------------------------------------
// Id synthesis
// ---------------------------------------------------------------------------

/**
 * A counter that assigns a unique id to every tile instance it is asked to
 * materialize. Each call to {@link next} returns the next `t<counter>` id, so
 * no two tiles in a restored snapshot ever collide even when they share a face.
 */
class TileIdCounter {
  private count = 0;

  /** Assign the next unique tile id. */
  next(): string {
    return `t${this.count++}`;
  }
}

/** Materialize saved tiles (suit+rank) into live tiles with unique ids. */
function savedTilesToTiles(saved: readonly SavedTile[], counter: TileIdCounter): Tile[] {
  return saved.map((t) => ({ id: counter.next(), suit: t.suit, rank: t.rank }));
}

/** Materialize saved melds, giving each of their tiles a unique id. */
function savedMeldsToMelds(saved: readonly SavedMeld[], counter: TileIdCounter): Meld[] {
  return saved.map((m) => ({
    type: m.type,
    isConcealed: m.isConcealed,
    sourcePlayer: m.sourcePlayer,
    tiles: m.tiles.map((t) => ({ id: counter.next(), suit: t.suit, rank: t.rank })),
  }));
}

// ---------------------------------------------------------------------------
// Integrity validation
// ---------------------------------------------------------------------------

/** Throw unless `owner` is one of the seated player ids. */
function validateOwner(
  owner: number,
  players: readonly { readonly id: number }[],
  label: string,
): void {
  if (!players.some((p) => p.id === owner)) {
    throw new Error(`Cannot restore: ${label} ${owner} is not seated.`);
  }
}

/** Throw unless there are exactly PLAYER_COUNT unique seats and unique ids. */
function validateSeats(ids: readonly number[], seats: readonly number[]): void {
  if (ids.length !== PLAYER_COUNT || seats.length !== PLAYER_COUNT) {
    throw new Error(
      `Cannot restore: expected ${PLAYER_COUNT} players, got ${ids.length}.`,
    );
  }
  const uniqueIds = new Set(ids);
  const uniqueSeats = new Set(seats);
  if (uniqueIds.size !== PLAYER_COUNT) {
    throw new Error(`Cannot restore: player ids must be unique.`);
  }
  if (uniqueSeats.size !== PLAYER_COUNT) {
    throw new Error(`Cannot restore: seats must be unique.`);
  }
}

/** Throw unless the phase is one the engine can be restored into. */
function validatePhase(phase: GameState): void {
  if (!isRestorablePhase(phase)) {
    throw new Error(
      `Cannot restore: phase ${phase} is not a mid-game phase. ` +
        `A terminal or pre-game save must be discarded.`,
    );
  }
}

// Keep Suit referenced for documentation completeness of the bridge contract.
export type { Suit };
