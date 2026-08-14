/**
 * Unit tests for the shanten calculator.
 */
import { describe, expect, it } from 'vitest';
import type { Suit, Tile } from '../../../src/game-logic/types';
import {
  calculateShanten,
  handToCounts,
  shantenOfHand,
  tileTypeIndex,
  TOTAL_TILE_TYPES,
} from '../../../src/game-logic/ai/shanten';

/** Build a tile with the shared shape (id, suit, rank). */
function tile(suit: Suit, rank: number, id?: string): Tile {
  return { id: id ?? `${suit}-${rank}`, suit, rank };
}

/** Build a hand from compact "suit-rank" tokens, e.g. `['d5','b3','w2']`. */
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

describe('tileTypeIndex', () => {
  it('maps the three numbered suits into 0..26', () => {
    expect(tileTypeIndex('bamboo', 1)).toBe(0);
    expect(tileTypeIndex('bamboo', 9)).toBe(8);
    expect(tileTypeIndex('characters', 1)).toBe(9);
    expect(tileTypeIndex('dots', 1)).toBe(18);
    expect(tileTypeIndex('dots', 9)).toBe(26);
  });

  it('maps winds and dragons after the suited tiles', () => {
    expect(tileTypeIndex('winds', 1)).toBe(27);
    expect(tileTypeIndex('winds', 4)).toBe(30);
    expect(tileTypeIndex('dragons', 1)).toBe(31);
    expect(tileTypeIndex('dragons', 3)).toBe(33);
  });

  it('rejects bonus tiles', () => {
    expect(() => tileTypeIndex('flowers', 1)).toThrow();
    expect(() => tileTypeIndex('seasons', 2)).toThrow();
  });
});

describe('handToCounts', () => {
  it('produces a 34-length vector', () => {
    const counts = handToCounts([tile('dots', 5), tile('bamboo', 2), tile('winds', 3)]);
    expect(counts).toHaveLength(TOTAL_TILE_TYPES);
    expect(counts[22]).toBe(1); // dots-5
    expect(counts[1]).toBe(1); // bamboo-2
    expect(counts[29]).toBe(1); // winds-3
  });

  it('counts duplicate tiles and ignores bonus tiles', () => {
    const counts = handToCounts([
      tile('dots', 5),
      tile('dots', 5),
      tile('flowers', 1),
      tile('seasons', 2),
    ]);
    expect(counts[22]).toBe(2);
  });
});

describe('shanten of known hands', () => {
  it('is -1 for a complete winning hand (4 melds + pair)', () => {
    // b123 b456 b789 c123 + d55 pair = 4 melds + pair.
    const hand = handOf([
      'b1', 'b2', 'b3',
      'b4', 'b5', 'b6',
      'b7', 'b8', 'b9',
      'c1', 'c2', 'c3',
      'd5', 'd5',
    ]);
    expect(shantenOfHand(hand)).toBe(-1);
  });

  it('is -1 for a winning hand with honors', () => {
    // Two melds, two honor pungs, plus a pair.
    const hand = handOf([
      'b1', 'b2', 'b3',
      'b4', 'b5', 'b6',
      'w1', 'w1', 'w1',
      'r2', 'r2', 'r2',
      'd9', 'd9',
    ]);
    expect(shantenOfHand(hand)).toBe(-1);
  });

  it('is 0 for a classic tenpai shape', () => {
    // Three melds (b123 b456 b789), a pair (c11), and a taatsu (c23).
    // Waiting on c1 or c4 to complete 123/234 chow. 13 tiles = tenpai.
    const hand = handOf([
      'b1', 'b2', 'b3',
      'b4', 'b5', 'b6',
      'b7', 'b8', 'b9',
      'c1', 'c1', 'c2', 'c3',
    ]);
    expect(hand.length).toBe(13);
    expect(shantenOfHand(hand)).toBe(0);
  });

  it('is 1 for a hand one step from tenpai', () => {
    // Three melds + pair + two isolated singles = 1 shanten.
    const hand = handOf([
      'b1', 'b2', 'b3',
      'b4', 'b5', 'b6',
      'b7', 'b8', 'b9',
      'c1', 'c1', 'c9', 'c5',
    ]);
    expect(shantenOfHand(hand)).toBe(1);
  });

  it('is 2 for a hand two steps from tenpai', () => {
    // Two melds + pair + one taatsu + three isolated singles = 2 shanten.
    // b123 b456 (2 melds), c11 pair, c56 taatsu, b9 / r3 / d7 singles.
    // b9, r3 and d7 are all different suits, so none pair up into a taatsu.
    const hand = handOf([
      'b1', 'b2', 'b3',
      'b4', 'b5', 'b6',
      'c1', 'c1', 'c5', 'c6',
      'b9', 'r3', 'd7',
    ]);
    expect(hand.length).toBe(13);
    expect(shantenOfHand(hand)).toBe(2);
  });

  it('computes a plausible high-shanten mixed hand', () => {
    const hand = handOf(['b1', 'b5', 'd2', 'd2', 'w1', 'w2', 'r1', 'c8', 'c9', 'b3', 'b4', 'd7', 'r3']);
    const shanten = shantenOfHand(hand);
    expect(shanten).toBeGreaterThanOrEqual(1);
    expect(shanten).toBeLessThanOrEqual(8);
  });

  it('handles a 14-tile tenpai hand (after the draw)', () => {
    // 3 melds + pair + taatsu + one single = 14 tiles, shanten 0.
    // b123 b456 b789 (3 melds), c11 pair, c23 taatsu, c9 single.
    const hand = handOf([
      'b1', 'b2', 'b3',
      'b4', 'b5', 'b6',
      'b7', 'b8', 'b9',
      'c1', 'c1', 'c2', 'c3', 'c9',
    ]);
    expect(hand.length).toBe(14);
    expect(shantenOfHand(hand)).toBe(0);
  });
});

describe('calculateShanten invariants', () => {
  it('never gets worse (shanten non-increasing) as useful tiles are added', () => {
    const base = handOf(['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9', 'c1', 'c2', 'c3', 'd5']);
    const withPair = [...base, tile('dots', 5)];
    expect(shantenOfHand(withPair)).toBeLessThanOrEqual(shantenOfHand(base));
  });

  it('throws on a malformed count vector', () => {
    expect(() => calculateShanten([0, 1, 2])).toThrow();
  });

  it('handles an empty hand (no tiles)', () => {
    expect(shantenOfHand([])).toBeGreaterThanOrEqual(6);
  });

  it('accounts for exposed melds (extraMelds lowers shanten)', () => {
    // 3 exposed melds + a concealed pair + taatsu = tenpai (0 shanten).
    // Concealed c11 pair + c23 taatsu; 3 exposed melds elsewhere.
    const concealed = handOf(['c1', 'c1', 'c2', 'c3']);
    expect(shantenOfHand(concealed, 3)).toBe(0);
    // Without counting the exposed melds, the same tiles are 4-shanten.
    expect(shantenOfHand(concealed)).toBeGreaterThanOrEqual(2);
    // 4 exposed melds + a concealed pair = already winning (-1).
    const pair = handOf(['c1', 'c1']);
    expect(shantenOfHand(pair, 4)).toBe(-1);
  });
});
