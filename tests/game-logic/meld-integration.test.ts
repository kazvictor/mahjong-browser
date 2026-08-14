/**
 * Integration tests for the meld system wired into MahjongGame.
 *
 * Covers the full claim lifecycle: a player declares a pung/kong/chow on an
 * opponent's discard, the meld is exposed, the turn transfers, and kong
 * claims draw a replacement tile. Scenarios are driven through the public
 * command surface (startGame / dealComplete / discardOpening /
 * acceptMeldOpportunity) using deterministic seeds so the tests are
 * self-contained and do not depend on snapshot restore.
 */
import { describe, expect, it } from 'vitest';
import { GameState, MahjongGame } from '../../src/game-logic';

/**
 * Start a game with the given seed, deal, and have the dealer (player 0)
 * discard the tile with `discardId` from their opening hand. Returns the
 * game in the DISCARD phase with a pending discard.
 */
function gameAfterDiscard(seed: number, discardId: string): MahjongGame {
  const game = new MahjongGame();
  game.startGame(seed);
  game.dealComplete();
  game.discardOpening(discardId);
  return game;
}

describe('MahjongGame meld integration', () => {
  it('exposes MELD_DECLARATION as a phase value', () => {
    expect(GameState.MELD_DECLARATION).toBe('MELD_DECLARATION');
  });

  it('reports a pung opportunity for a player holding two matching tiles', () => {
    // Seed 1: player 0 discards bamboo9 (t35); player 2 holds two bamboo9s.
    const game = gameAfterDiscard(1, 't35');
    expect(game.hasMeldOpportunity(2)).toBe(true);
    const opps = game.getMeldOpportunities(2);
    expect(opps.some((o) => o.type === 'pung')).toBe(true);
  });

  it('acceptMeldOpportunity exposes a pung and transfers the turn', () => {
    const game = gameAfterDiscard(1, 't35');

    const meld = game.acceptMeldOpportunity(2, 'pung');

    expect(meld.type).toBe('pung');
    expect(meld.tiles).toHaveLength(3);
    expect(meld.isConcealed).toBe(false);
    expect(meld.sourcePlayer).toBe(0);

    const state = game.getState();
    // Player 2's hand lost the two matching bamboo9 tiles (13 -> 11).
    expect(state.players[2]!.hand.tiles).toHaveLength(11);
    // The meld is exposed.
    expect(state.players[2]!.hand.melds).toHaveLength(1);
    expect(state.players[2]!.hand.melds[0]!.type).toBe('pung');
    // The discarded tile left the discard pile.
    expect(state.discardPile.some((t) => t.id === 't35')).toBe(false);
    // Turn transferred to the claimant.
    expect(state.currentPlayer).toBe(2);
    expect(state.phase).toBe(GameState.DRAW);
  });

  it('acceptMeldOpportunity exposes a kong and draws a replacement tile', () => {
    // Find a seed where player 0 discards a tile player 2 can kong.
    // Seed 1 gives a pung; scan for a kong opportunity.
    let kongSeed = -1;
    let kongDiscard = '';
    for (let seed = 1; seed < 500 && kongSeed === -1; seed++) {
      const game = new MahjongGame();
      game.startGame(seed);
      game.dealComplete();
      const p0 = game.getState().players[0]!.hand.tiles;
      const p2 = game.getState().players[2]!.hand.tiles;
      for (const t of p0) {
        const matches = p2.filter((x) => x.suit === t.suit && x.rank === t.rank);
        if (matches.length >= 3) {
          kongSeed = seed;
          kongDiscard = t.id;
          break;
        }
      }
    }
    expect(kongSeed).toBeGreaterThan(0);

    const game = gameAfterDiscard(kongSeed, kongDiscard);
    const meld = game.acceptMeldOpportunity(2, 'kong');

    expect(meld.type).toBe('kong');
    expect(meld.tiles).toHaveLength(4);
    const state = game.getState();
    // Kong draws a replacement tile from the wall (3 removed, 1 added -> 11).
    expect(state.players[2]!.hand.tiles).toHaveLength(11);
    expect(state.players[2]!.hand.melds[0]!.type).toBe('kong');
    expect(state.currentPlayer).toBe(2);
  });

  it('acceptMeldOpportunity exposes a chow and transfers the turn', () => {
    // Find a seed where player 0 discards a tile player 2 can chow.
    let chowSeed = -1;
    let chowDiscard = '';
    for (let seed = 1; seed < 500 && chowSeed === -1; seed++) {
      const game = new MahjongGame();
      game.startGame(seed);
      game.dealComplete();
      const p0 = game.getState().players[0]!.hand.tiles;
      const p2 = game.getState().players[2]!.hand.tiles;
      for (const t of p0) {
        // Check for a chow: two p2 tiles forming a sequence with t.
        const r = t.rank;
        if (t.suit === 'bamboo' || t.suit === 'characters' || t.suit === 'dots') {
          const has = (rank: number) =>
            p2.some((x) => x.suit === t.suit && x.rank === rank);
          if ((r >= 3 && has(r - 2) && has(r - 1)) ||
              (r >= 2 && r <= 8 && has(r - 1) && has(r + 1)) ||
              (r <= 7 && has(r + 1) && has(r + 2))) {
            chowSeed = seed;
            chowDiscard = t.id;
            break;
          }
        }
      }
    }
    expect(chowSeed).toBeGreaterThan(0);

    const game = gameAfterDiscard(chowSeed, chowDiscard);
    const meld = game.acceptMeldOpportunity(2, 'chow');

    expect(meld.type).toBe('chow');
    expect(meld.tiles).toHaveLength(3);
    const state = game.getState();
    expect(state.players[2]!.hand.melds[0]!.type).toBe('chow');
    expect(state.currentPlayer).toBe(2);
  });

  it('rejects a claim the player cannot form', () => {
    // Seed 1: player 2 can pung bamboo9 but cannot pung dots5.
    const game = gameAfterDiscard(1, 't35');
    expect(() => game.acceptMeldOpportunity(2, 'chow')).toThrow(/cannot form a chow/);
  });

  it('throws when there is no pending discard', () => {
    const game = new MahjongGame();
    game.startGame(1);
    game.dealComplete();
    game.drawTile();
    const tileId = game.getState().players[0]!.hand.tiles[0]!.id;
    game.discardTile(tileId);
    game.nextTurn(); // clears the pending discard, phase -> DRAW
    // Now in DRAW with no pending discard; the phase guard fires first.
    expect(() => game.acceptMeldOpportunity(1, 'pung')).toThrow(/not legal in phase/);
  });

  it('throws for an illegal phase', () => {
    const game = new MahjongGame();
    game.startGame(1);
    expect(() => game.acceptMeldOpportunity(1, 'pung')).toThrow(/not legal in phase/);
  });

  it('clears the pending discard after a claim', () => {
    const game = gameAfterDiscard(1, 't35');
    game.acceptMeldOpportunity(2, 'pung');
    expect(game.getPendingDiscard()).toBeNull();
  });
});
