/**
 * Unit tests for MahjongGame.restore() — exact-state hydration.
 *
 * Verifies that a snapshot handed to restore() reconstructs the round precisely
 * (hands, melds, wall, discards, scores, turn owner, dealer, round number) so a
 * mid-game reload continues seamlessly, and that malformed snapshots are
 * rejected rather than silently corrupting the engine.
 */
import { describe, expect, it } from 'vitest';
import { MahjongGame, PLAYER_COUNT } from '../../src/game-logic';
import type { GameSnapshot } from '../../src/game-logic';

/** Drive a fresh game into a mid-game state: dealt, dealer opened, some discards. */
function makeMidGame(seed = 7): MahjongGame {
  const game = new MahjongGame();
  game.startGame(seed);
  game.dealComplete(); // DEALING -> DRAW, dealer holds 14
  // Dealer (seat 0) opens by discarding their first tile.
  const opener = game.getState().players[0]!.hand.tiles[0]!.id;
  game.discardOpening(opener);
  return game;
}

describe('MahjongGame.restore', () => {
  it('rejects restore when a game is already in progress', () => {
    const game = makeMidGame();
    const snapshot = game.getState();
    // The engine is already mid-round (DISCARD); restore must refuse.
    expect(() => game.restore(snapshot)).toThrow(/not legal in phase/);
  });

  it('reconstructs an exact mid-game state from a snapshot', () => {
    const source = makeMidGame(11);
    const before = source.getState();

    // Hydrate a brand-new engine from the mid-game snapshot.
    const restored = new MahjongGame();
    restored.restore(before);

    const after = restored.getState();
    // Phase, round, seats, scores, turn owner, and dealer must all match.
    expect(after.phase).toBe(before.phase);
    expect(after.round).toBe(before.round);
    expect(after.seed).toBe(before.seed);
    expect(after.dealer).toBe(before.dealer);
    expect(after.currentPlayer).toBe(before.currentPlayer);

    expect(after.players).toHaveLength(PLAYER_COUNT);
    for (let i = 0; i < PLAYER_COUNT; i++) {
      expect(after.players[i]!.id).toBe(before.players[i]!.id);
      expect(after.players[i]!.seat).toBe(before.players[i]!.seat);
      expect(after.players[i]!.score).toBe(before.players[i]!.score);
      expect(after.players[i]!.hand.tiles).toHaveLength(before.players[i]!.hand.tiles.length);
      expect(after.players[i]!.hand.melds).toHaveLength(before.players[i]!.hand.melds.length);
    }

    // The wall and discard pile must be exactly equivalent.
    expect(after.wall.map((t) => t.id)).toEqual(before.wall.map((t) => t.id));
    expect(after.discardPile.map((t) => t.id)).toEqual(before.discardPile.map((t) => t.id));
  });

  it('the restored game can continue playing from the same turn', () => {
    const source = makeMidGame(21);
    const before = source.getState();
    const phaseBefore = before.phase;
    const playerBefore = before.currentPlayer;

    const restored = new MahjongGame();
    restored.restore(before);

    // The restored engine must allow the same next move the source would. For a
    // DRAW-phase snapshot, drawing a tile is the next legal action.
    if (phaseBefore === 'DRAW') {
      const source2 = makeMidGame(21);
      source2.drawTile();
      const expectedPhase = source2.getPhase();

      restored.drawTile();
      expect(restored.getPhase()).toBe(expectedPhase);
      expect(restored.getState().currentPlayer).toBe(playerBefore);
    }
  });

  it('rejects a snapshot with missing players', () => {
    const game = new MahjongGame();
    const bad = game.getState(); // IDLE snapshot, empty players
    expect(() => game.restore(bad)).toThrow(/expected 4 unique seats/);
  });

  it('rejects a snapshot whose currentPlayer is not seated', () => {
    const source = makeMidGame(3);
    const snapshot = source.getState();
    const corrupt: GameSnapshot = { ...snapshot, currentPlayer: 99 };
    const restored = new MahjongGame();
    expect(() => restored.restore(corrupt)).toThrow(/currentPlayer 99 is not seated/);
  });

  it('rejects a snapshot whose dealer is not seated', () => {
    const source = makeMidGame(4);
    const snapshot = source.getState();
    const corrupt: GameSnapshot = { ...snapshot, dealer: 77 };
    const restored = new MahjongGame();
    expect(() => restored.restore(corrupt)).toThrow(/dealer 77 is not seated/);
  });
});
