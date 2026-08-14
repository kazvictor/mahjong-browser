/**
 * Unit tests for the persistence → engine snapshot bridge.
 *
 * Covers the round-trip from a `GameSnapshot` through the sibling serialize/
 * deserialize layer and back into a fresh `GameSnapshot` via
 * `savedGameToSnapshot`, plus the deeper integrity checks the structural
 * validator cannot express.
 */
import { describe, expect, it } from 'vitest';
import { GameState, MahjongGame } from '../../src/game-logic';
import { serializeGame, deserializeGame } from '../../src/persistence';
import { savedGameToSnapshot, isRestorablePhase } from '../../src/persistence';

/** Drive a game into a mid-game state with discards on the pile. */
function makeMidGame(seed = 5): MahjongGame {
  const game = new MahjongGame();
  game.startGame(seed);
  game.dealComplete();
  const opener = game.getState().players[0]!.hand.tiles[0]!.id;
  game.discardOpening(opener);
  return game;
}

describe('savedGameToSnapshot round-trip', () => {
  it('serialize → deserialize → bridge reproduces the exact state', () => {
    const source = makeMidGame(42);
    const before = source.getState();

    const json = serializeGame(before, { savedAt: '2026-08-14T00:00:00.000Z' });
    const saved = deserializeGame(json);
    const snapshot = savedGameToSnapshot(saved);

    expect(snapshot.phase).toBe(before.phase);
    expect(snapshot.round).toBe(before.round);
    expect(snapshot.seed).toBe(before.seed);
    expect(snapshot.dealer).toBe(before.dealer);
    expect(snapshot.currentPlayer).toBe(before.currentPlayer);

    // Tile faces (suit+rank) must match exactly; ids are re-synthesized.
    expect(snapshot.wall).toEqual(before.wall.map((t) => ({ id: expect.any(String), suit: t.suit, rank: t.rank })));
    expect(snapshot.discardPile).toEqual(
      before.discardPile.map((t) => ({ id: expect.any(String), suit: t.suit, rank: t.rank })),
    );

    for (let i = 0; i < snapshot.players.length; i++) {
      expect(snapshot.players[i]!.hand.tiles).toEqual(
        before.players[i]!.hand.tiles.map((t) => ({ id: expect.any(String), suit: t.suit, rank: t.rank })),
      );
    }
  });

  it('produces globally unique tile ids across hands, wall, and discards', () => {
    const source = makeMidGame(9);
    const json = serializeGame(source.getState());
    const saved = deserializeGame(json);
    const snapshot = savedGameToSnapshot(saved);

    const ids = new Set<string>();
    const collect = (tiles: readonly { id: string }[]): void => {
      for (const t of tiles) ids.add(t.id);
    };

    collect(snapshot.wall);
    collect(snapshot.deadWall);
    collect(snapshot.discardPile);
    for (const p of snapshot.players) {
      collect(p.hand.tiles);
      collect(p.hand.bonusTiles);
      for (const m of p.hand.melds) collect(m.tiles);
    }

    // Sum of all tiles across every collection must equal the set size (no dupes).
    let total = snapshot.wall.length + snapshot.deadWall.length + snapshot.discardPile.length;
    for (const p of snapshot.players) {
      total += p.hand.tiles.length + p.hand.bonusTiles.length;
      for (const m of p.hand.melds) total += m.tiles.length;
    }
    expect(ids.size).toBe(total);
  });

  it('rejects a save whose seats are not unique', () => {
    const source = makeMidGame(13);
    const json = serializeGame(source.getState());
    const saved = deserializeGame(json);
    // Duplicate a seat on two players.
    const corrupt = {
      ...saved,
      players: saved.players.map((p, i) => (i === 0 ? { ...p, seat: 1 } : p)),
    };
    expect(() => savedGameToSnapshot(corrupt)).toThrow(/seats must be unique/);
  });

  it('rejects a save whose turn owner is not seated', () => {
    const source = makeMidGame(14);
    const json = serializeGame(source.getState());
    const saved = deserializeGame(json);
    const corrupt = { ...saved, currentPlayer: 88 };
    expect(() => savedGameToSnapshot(corrupt)).toThrow(/currentPlayer 88 is not seated/);
  });

  it('rejects a save in a non-restorable phase', () => {
    const source = makeMidGame(15);
    const json = serializeGame(source.getState());
    const saved = deserializeGame(json);
    const corrupt = { ...saved, phase: 'IDLE' };
    expect(() => savedGameToSnapshot(corrupt as never)).toThrow(/not a mid-game phase/);
  });
});

describe('isRestorablePhase', () => {
  it('accepts live-round phases and rejects terminal/pre-game phases', () => {
    expect(isRestorablePhase(GameState.DRAW)).toBe(true);
    expect(isRestorablePhase(GameState.DISCARD)).toBe(true);
    expect(isRestorablePhase(GameState.MELD)).toBe(true);
    expect(isRestorablePhase(GameState.IDLE)).toBe(false);
    expect(isRestorablePhase(GameState.GAME_OVER)).toBe(false);
  });
});
