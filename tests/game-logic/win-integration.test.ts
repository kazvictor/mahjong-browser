/**
 * Integration tests for win detection + scoring in the game engine.
 *
 * Verifies that the game transitions to the WIN state when a player holds a
 * complete hand, that the WIN_DECLARED event carries the resolved win and
 * score, and that the snapshot exposes the win result after declaration.
 */
import { describe, expect, it } from 'vitest';
import { GameState, MahjongGame, type WinDeclared } from '../../src/game-logic';
import type { Tile } from '../../src/game-logic';

/** Set player 0's hand to a standard 4-chow + pair winning hand. */
function forceWinningHand(game: MahjongGame): void {
  const round = (game as unknown as { round: { players: Array<{ tiles: Tile[] }> } }).round;
  if (!round) throw new Error('No round — start the game first.');
  const tiles: Tile[] = [
    { id: 'd1a', suit: 'dots', rank: 1 }, { id: 'd2a', suit: 'dots', rank: 2 }, { id: 'd3a', suit: 'dots', rank: 3 },
    { id: 'd2b', suit: 'dots', rank: 2 }, { id: 'd3b', suit: 'dots', rank: 3 }, { id: 'd4b', suit: 'dots', rank: 4 },
    { id: 'd4c', suit: 'dots', rank: 4 }, { id: 'd5c', suit: 'dots', rank: 5 }, { id: 'd6c', suit: 'dots', rank: 6 },
    { id: 'd6d', suit: 'dots', rank: 6 }, { id: 'd7d', suit: 'dots', rank: 7 }, { id: 'd8d', suit: 'dots', rank: 8 },
    { id: 'd9a', suit: 'dots', rank: 9 }, { id: 'd9b', suit: 'dots', rank: 9 },
  ];
  round.players[0]!.tiles = tiles;
}

/** First discardable tile id from player 0's hand. */
function firstTileId(game: MahjongGame): string {
  const tiles = game.getState().players[0]!.hand.tiles;
  return tiles[0]!.id;
}

/** Drive the game to DISCARD phase with player 0 holding a winning hand. */
function toDiscard(game: MahjongGame): void {
  game.startGame(42);
  game.dealComplete();
  // Dealer (player 0) discards their opening tile: DRAW -> DISCARD, hand = 13.
  game.discardOpening(firstTileId(game));
  expect(game.getPhase()).toBe(GameState.DISCARD);
  // Force player 0's hand to a 14-tile winning hand (as if they drew/claimed
  // the winning tile), so declareWin succeeds from DISCARD.
  forceWinningHand(game);
}

describe('game transitions to WIN on a complete hand', () => {
  it('declaring a win moves DISCARD -> WIN and emits WIN_DECLARED with win + score', () => {
    const game = new MahjongGame();
    toDiscard(game);

    let received: WinDeclared | null = null;
    game.on('WIN_DECLARED', (e) => {
      received = e;
    });

    game.declareWin(0, false);

    expect(game.getPhase()).toBe(GameState.WIN);
    expect(received).not.toBeNull();
    expect(received!.win.type).toBe('standard');
    expect(received!.score.total).toBeGreaterThan(0);
    expect(received!.isSelfDraw).toBe(false);

    const state = game.getState();
    expect(state.winResult).not.toBeNull();
    expect(state.winResult!.type).toBe('standard');
    expect(state.scoreResult).not.toBeNull();
    expect(state.scoreResult!.total).toBeGreaterThan(0);
  });

  it('declaring a self-draw win emits isSelfDraw=true', () => {
    const game = new MahjongGame();
    toDiscard(game);

    let isSelfDraw: boolean | null = null;
    game.on('WIN_DECLARED', (e) => {
      isSelfDraw = e.isSelfDraw;
    });
    game.declareWin(0, true);
    expect(isSelfDraw).toBe(true);
    expect(game.getPhase()).toBe(GameState.WIN);
  });

  it('WIN -> GAME_OVER on endRound after a win', () => {
    const game = new MahjongGame();
    toDiscard(game);
    game.declareWin(0, false);
    expect(game.getPhase()).toBe(GameState.WIN);
    game.endRound();
    expect(game.getPhase()).toBe(GameState.GAME_OVER);
  });

  it('refuses to declare a win when the hand is not complete', () => {
    const game = new MahjongGame();
    game.startGame(3);
    game.dealComplete();
    // Player 0's hand after the deal is 14 tiles but not a winning hand.
    game.discardOpening(firstTileId(game));
    expect(() => game.declareWin(0, false)).toThrow(/does not have a winning hand/);
    expect(game.getPhase()).toBe(GameState.DISCARD);
  });

  it('winResult clears on the next round', () => {
    const game = new MahjongGame();
    toDiscard(game);
    game.declareWin(0, false);
    expect(game.getState().winResult).not.toBeNull();
    // Starting a fresh game resets the round and clears the win result.
    const anyGame = game as unknown as { phase: GameState; round: null };
    anyGame.phase = GameState.IDLE;
    anyGame.round = null;
    game.startGame(99);
    expect(game.getState().winResult).toBeNull();
  });
});
