/**
 * Unit tests for the tile-efficiency AI strategy.
 */
import { describe, expect, it } from 'vitest';
import type { Suit, Tile } from '../../../src/game-logic/types';
import {
  EfficiencyDiscardStrategy,
  evaluateDiscards,
  isSujiSafe,
  shouldCallMeld,
  shouldRiichi,
  stageFromTilesDrawn,
  type EfficiencyContext,
} from '../../../src/game-logic/ai/tile-efficiency';

/** Build a tile with the shared shape (id, suit, rank). */
function tile(suit: Suit, rank: number, id?: string): Tile {
  return { id: id ?? `${suit}-${rank}`, suit, rank };
}

/** Build a hand from compact tokens, e.g. `['d5','b3','w2']`. */
function handOf(tokens: readonly string[]): Tile[] {
  return tokens.map((token, i) => {
    const suitChar = token[0]!;
    const rank = Number(token.slice(1));
    let suit: Suit;
    switch (suitChar) {
      case 'b':
        suit = 'bamboo';
        break;
      case 'c':
        suit = 'characters';
        break;
      case 'd':
        suit = 'dots';
        break;
      case 'w':
        suit = 'winds';
        break;
      case 'r':
        suit = 'dragons';
        break;
      default:
        throw new Error(`Unknown suit token ${suitChar}`);
    }
    return tile(suit, rank, `t${i}`);
  });
}

/** A neutral context with a fixed stage. */
function ctx(tilesDrawn = 20, opponentRiichi = false, seenTiles: readonly Tile[] = []): EfficiencyContext {
  return { seenTiles, opponentRiichi, tilesDrawn };
}

describe('stageFromTilesDrawn', () => {
  it('classifies early/mid/late by draw count', () => {
    expect(stageFromTilesDrawn(0)).toBe('early');
    expect(stageFromTilesDrawn(17)).toBe('early');
    expect(stageFromTilesDrawn(20)).toBe('mid');
    expect(stageFromTilesDrawn(37)).toBe('mid');
    expect(stageFromTilesDrawn(38)).toBe('late');
    expect(stageFromTilesDrawn(60)).toBe('late');
  });
});

describe('evaluateDiscards', () => {
  it('returns null for an empty hand', () => {
    expect(evaluateDiscards([], ctx()).best).toBeNull();
  });

  it('prefers discarding an isolated single over breaking a pair', () => {
    // d5,d5 pair + isolated b9. Should discard b9 (keep the pair).
    const hand = handOf(['d5', 'd5', 'b9']);
    const { best } = evaluateDiscards(hand, ctx());
    expect(best?.tile.suit).toBe('bamboo');
    expect(best?.tile.rank).toBe(9);
  });

  it('prefers discarding a tile that does not reduce the hand (stable hand)', () => {
    // Three melds + pair + a stray single: discard the single, keep structure.
    const hand = handOf([
      'b1', 'b2', 'b3',
      'b4', 'b5', 'b6',
      'b7', 'b8', 'b9',
      'c1', 'c1', 'r1',
    ]);
    const { best } = evaluateDiscards(hand, ctx());
    expect(best?.tile.suit).toBe('dragons');
  });

  it('keeps an honor pair over an isolated suited tile early', () => {
    // Winds pair + isolated dots single. Early game honors are worth keeping.
    const hand = handOf(['w1', 'w1', 'd7']);
    const { best } = evaluateDiscards(hand, ctx(5));
    expect(best?.tile.suit).toBe('dots');
  });
});

describe('EfficiencyDiscardStrategy', () => {
  it('implements the shared DiscardStrategy contract (chooseTile)', () => {
    const strategy = new EfficiencyDiscardStrategy();
    const hand = handOf(['d5', 'd5', 'b9']);
    const chosen = strategy.chooseTile(hand);
    expect(chosen).not.toBeNull();
    expect(chosen?.suit).toBe('bamboo');
  });

  it('returns null for an empty hand', () => {
    const strategy = new EfficiencyDiscardStrategy();
    expect(strategy.chooseTile([])).toBeNull();
  });

  it('falls back to the protected tile when it is the only safe option', () => {
    const strategy = new EfficiencyDiscardStrategy();
    const hand = handOf(['d5']);
    // avoidTileId is the only tile; must return it to avoid deadlock.
    const chosen = strategy.chooseWithContext(hand, ctx(), 't0');
    expect(chosen?.id).toBe('t0');
  });

  it('chooses the next-best discard when the best is protected', () => {
    const strategy = new EfficiencyDiscardStrategy();
    const hand = handOf(['d5', 'd5', 'b9']);
    // The best discard is b9 (id t2); protect it and drop a d5 (t0/t1).
    const chosen = strategy.chooseWithContext(hand, ctx(), 't2');
    expect(chosen?.suit).toBe('dots');
  });
});

describe('isSujiSafe', () => {
  it('recognises suji-safe tiles (r±3 from a discard)', () => {
    // Opponent discarded a 4 of dots → cannot wait on 1 or 7 of dots.
    const discards = [tile('dots', 4)];
    expect(isSujiSafe(tile('dots', 1), discards)).toBe(true);
    expect(isSujiSafe(tile('dots', 7), discards)).toBe(true);
    expect(isSujiSafe(tile('dots', 5), discards)).toBe(false);
  });

  it('returns false for honors (no suji relation)', () => {
    const discards = [tile('winds', 1)];
    expect(isSujiSafe(tile('dragons', 1), discards)).toBe(false);
  });

  it('returns false when discards are from a different suit', () => {
    const discards = [tile('bamboo', 4)];
    expect(isSujiSafe(tile('dots', 7), discards)).toBe(false);
  });
});

describe('defensive play', () => {
  it('prefers a genbutsu (already-discarded) tile in defensive mode', () => {
    // Riichi opponent has discarded a bamboo-9. We hold b9 + dots-5.
    // In defensive mode, b9 is safe (genbutsu) and must be chosen over d5.
    const hand = handOf(['b9', 'd5']);
    const riichiDiscards = [tile('bamboo', 9)];
    const { best } = evaluateDiscards(hand, ctx(20, true, riichiDiscards));
    expect(best?.tile.suit).toBe('bamboo');
  });

  it('prefers a suji-safe tile over a dangerous fresh middle tile', () => {
    // Opponent discarded dots-4 (suji: 1/7 safe). We hold dots-7 (safe) + dots-5.
    const hand = handOf(['d7', 'd5']);
    const riichiDiscards = [tile('dots', 4)];
    const { best } = evaluateDiscards(hand, ctx(20, true, riichiDiscards));
    expect(best?.tile.rank).toBe(7);
  });

  it('behaves normally (efficiency first) when no opponent is in riichi', () => {
    // Without a riichi threat, discard the isolated single (b9), not d5/d5 pair.
    const hand = handOf(['d5', 'd5', 'b9']);
    const { best } = evaluateDiscards(hand, ctx(20, false, []));
    expect(best?.tile.suit).toBe('bamboo');
  });
});

describe('shouldRiichi', () => {
  it('declares riichi on a tenpai hand with a live wait', () => {
    // 3 melds + pair + taatsu (waiting on c1/c4). Seen nothing dangerous.
    const hand = handOf([
      'b1', 'b2', 'b3',
      'b4', 'b5', 'b6',
      'b7', 'b8', 'b9',
      'c1', 'c1', 'c2', 'c3',
    ]);
    const decision = shouldRiichi(hand, ctx(25, false, []));
    expect(decision.shanten).toBe(0);
    expect(decision.shouldRiichi).toBe(true);
    expect(decision.waitCount).toBeGreaterThan(0);
  });

  it('refuses riichi when not tenpai', () => {
    const hand = handOf(['b1', 'b5', 'd2', 'd2', 'w1', 'w2', 'r1', 'c8', 'c9', 'b3', 'b4', 'd7', 'r3']);
    const decision = shouldRiichi(hand, ctx(25));
    expect(decision.shanten).toBeGreaterThan(0);
    expect(decision.shouldRiichi).toBe(false);
  });

  it('refuses riichi when the wait is fully dead (all copies seen)', () => {
    // Tenpai tanki on winds-1 (4 melds + a lone w1). If all 3 remaining w1
    // copies are already visible in discards, the wait is dead.
    const hand = handOf([
      'b1', 'b2', 'b3',
      'b4', 'b5', 'b6',
      'b7', 'b8', 'b9',
      'c1', 'c2', 'c3', 'w1',
    ]);
    expect(hand.length).toBe(13);
    const alive = shouldRiichi(hand, ctx(25, false, []));
    expect(alive.shanten).toBe(0);
    expect(alive.shouldRiichi).toBe(true);

    const deadCtx = ctx(25, false, [tile('winds', 1), tile('winds', 1), tile('winds', 1)]);
    const dead = shouldRiichi(hand, deadCtx);
    expect(dead.shanten).toBe(0);
    expect(dead.waitCount).toBe(0);
    expect(dead.shouldRiichi).toBe(false);
  });
});

describe('shouldCallMeld', () => {
  it('calls a pung that keeps an eye and improves the hand', () => {
    // Hand has a pair (d1,d1) and two dots-5s. Opponent discards dots-5 → pung.
    const hand = handOf(['d1', 'd1', 'd5', 'd5', 'b9']);
    const decision = shouldCallMeld(hand, tile('dots', 5), 'pung', ctx(20));
    expect(decision.shouldCall).toBe(true);
    expect(decision.improves).toBe(true);
  });

  it('refuses a meld that leaves the hand eye-less', () => {
    // No pair in the remaining tiles after calling the pung.
    const hand = handOf(['d5', 'd5', 'b1', 'b2', 'b3']);
    const decision = shouldCallMeld(hand, tile('dots', 5), 'pung', ctx(20));
    // After removing the two d5s, no pair remains → should not call.
    expect(decision.shouldCall).toBe(false);
  });

  it('refuses a chow call that does not improve the hand meaningfully', () => {
    // Hand is already nearly complete; opening a low-value chow is not worth it.
    const hand = handOf(['b1', 'b2', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9', 'c1', 'c1', 'd9']);
    // Opponent discards bamboo-3 → chow 123. This consumes b1,b2 breaking shape.
    const decision = shouldCallMeld(hand, tile('bamboo', 3), 'chow', ctx(20));
    // The hand already has strong melds; opening a chow does not lower shanten.
    expect(decision.improves).toBe(false);
  });

  it('recognises a valuable honor pung late in the round', () => {
    const hand = handOf(['w1', 'w1', 'd1', 'd1', 'd2']);
    const decision = shouldCallMeld(hand, tile('winds', 1), 'pung', ctx(45));
    expect(decision.shouldCall).toBe(true);
  });
});
