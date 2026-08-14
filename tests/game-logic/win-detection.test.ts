/**
 * Unit tests for win detection.
 *
 * Covers the standard 4-melds-plus-pair shape, the two special hands (seven
 * pairs, thirteen orphans), rejection of non-winning hands, and the returned
 * WinResult structure.
 */
import { describe, expect, it } from 'vitest';
import { detectWin, isWinningHand, type WinResult } from '../../src/game-logic/win-detection';
import type { Hand, Tile } from '../../src/game-logic/types';

/** Build a tile quickly. */
function tile(suit: Tile['suit'], rank: number, id: string): Tile {
  return { id, suit, rank };
}

/** A standard winning hand: four chows + a pair (all dots). */
function standardWin(): Hand {
  const tiles = [
    tile('dots', 1, 'd1a'), tile('dots', 2, 'd2a'), tile('dots', 3, 'd3a'),
    tile('dots', 2, 'd2b'), tile('dots', 3, 'd3b'), tile('dots', 4, 'd4b'),
    tile('dots', 4, 'd4c'), tile('dots', 5, 'd5c'), tile('dots', 6, 'd6c'),
    tile('dots', 6, 'd6d'), tile('dots', 7, 'd7d'), tile('dots', 8, 'd8d'),
    tile('dots', 9, 'd9a'), tile('dots', 9, 'd9b'),
  ];
  return { tiles, melds: [], bonusTiles: [] };
}

/** A non-winning hand (13 tiles, no pair). */
function nonWinning(): Hand {
  const tiles = [
    tile('dots', 1, 'a'), tile('dots', 2, 'b'), tile('dots', 3, 'c'),
    tile('dots', 2, 'd'), tile('dots', 3, 'e'), tile('dots', 4, 'f'),
    tile('dots', 4, 'g'), tile('dots', 5, 'h'), tile('dots', 6, 'i'),
    tile('dots', 6, 'j'), tile('dots', 7, 'k'), tile('dots', 8, 'l'),
    tile('dots', 9, 'm'),
  ];
  return { tiles, melds: [], bonusTiles: [] };
}

describe('standard win detection', () => {
  it('recognizes a valid 4-chow + pair hand', () => {
    const win = detectWin(standardWin());
    expect(win).not.toBeNull();
    expect(win!.type).toBe('standard');
    expect(win!.melds).toHaveLength(4);
    expect(win!.pair).toHaveLength(2);
    expect(win!.tiles).toHaveLength(14);
  });

  it('recognizes a hand with a pung, a kong, chows and a pair', () => {
    const hand: Hand = {
      tiles: [
        // 1-1-1 pung
        tile('dots', 1, 'a'), tile('dots', 1, 'b'), tile('dots', 1, 'c'),
        // 9-9-9-9 kong
        tile('dots', 9, 'd'), tile('dots', 9, 'e'), tile('dots', 9, 'f'), tile('dots', 9, 'g'),
        // 2-3-4 chow
        tile('dots', 2, 'h'), tile('dots', 3, 'i'), tile('dots', 4, 'j'),
        // 5-6-7 chow
        tile('dots', 5, 'k'), tile('dots', 6, 'l'), tile('dots', 7, 'm'),
        // 8-8 pair
        tile('dots', 8, 'n'), tile('dots', 8, 'o'),
      ],
      melds: [],
      bonusTiles: [],
    };
    const win = detectWin(hand);
    expect(win).not.toBeNull();
    expect(win!.type).toBe('standard');
    expect(win!.melds).toHaveLength(4);
  });

  it('counts exposed meld tiles toward the 14-tile total', () => {
    // 11 concealed tiles (3 chows + a pair) + a 3-tile exposed wind pung = 14.
    const exposedMeld = {
      type: 'pung' as const,
      tiles: [tile('winds', 1, 'w1'), tile('winds', 1, 'w2'), tile('winds', 1, 'w3')],
      isConcealed: false,
    };
    const hand: Hand = {
      tiles: [
        tile('dots', 1, 'a'), tile('dots', 2, 'b'), tile('dots', 3, 'c'),
        tile('dots', 4, 'd'), tile('dots', 5, 'e'), tile('dots', 6, 'f'),
        tile('dots', 7, 'g'), tile('dots', 8, 'h'), tile('dots', 9, 'i'),
        tile('dots', 6, 'j'), tile('dots', 6, 'k'),
      ],
      melds: [exposedMeld],
      bonusTiles: [],
    };
    // Concealed: 1-2-3, 4-5-6, 7-8-9 chows + 6-6 pair + exposed wind pung = 14.
    const win = detectWin(hand);
    expect(win).not.toBeNull();
    expect(win!.type).toBe('standard');
    expect(win!.melds).toHaveLength(4);
  });

  it('rejects a non-winning hand', () => {
    expect(detectWin(nonWinning())).toBeNull();
    expect(isWinningHand(nonWinning())).toBe(false);
  });

  it('rejects a hand with the wrong tile count', () => {
    const hand = standardWin();
    const short = { ...hand, tiles: hand.tiles.slice(0, 13) };
    expect(detectWin(short)).toBeNull();
  });

  it('rejects a hand that cannot partition into melds', () => {
    const hand: Hand = {
      tiles: [
        tile('dots', 1, 'a'), tile('dots', 1, 'b'), tile('dots', 2, 'c'),
        tile('dots', 2, 'd'), tile('dots', 3, 'e'), tile('dots', 3, 'f'),
        tile('dots', 4, 'g'), tile('dots', 4, 'h'), tile('dots', 5, 'i'),
        tile('dots', 5, 'j'), tile('dots', 6, 'k'), tile('dots', 6, 'l'),
        tile('dots', 7, 'm'), tile('dots', 8, 'n'),
      ],
      melds: [],
      bonusTiles: [],
    };
    expect(detectWin(hand)).toBeNull();
  });
});

describe('seven pairs', () => {
  it('recognizes a seven-pairs hand', () => {
    const hand: Hand = {
      tiles: [
        tile('dots', 1, 'a'), tile('dots', 1, 'b'),
        tile('dots', 3, 'c'), tile('dots', 3, 'd'),
        tile('bamboo', 5, 'e'), tile('bamboo', 5, 'f'),
        tile('characters', 2, 'g'), tile('characters', 2, 'h'),
        tile('winds', 1, 'i'), tile('winds', 1, 'j'),
        tile('dragons', 2, 'k'), tile('dragons', 2, 'l'),
        tile('dots', 9, 'm'), tile('dots', 9, 'n'),
      ],
      melds: [],
      bonusTiles: [],
    };
    const win = detectWin(hand);
    expect(win).not.toBeNull();
    expect(win!.type).toBe('seven-pairs');
    expect(win!.melds).toHaveLength(7);
  });

  it('does not treat a four-of-a-kind as two pairs', () => {
    // 6 pairs + one quad is 14 tiles but not 7 distinct pairs.
    const hand: Hand = {
      tiles: [
        tile('dots', 1, 'a'), tile('dots', 1, 'b'), tile('dots', 1, 'c'), tile('dots', 1, 'd'),
        tile('dots', 3, 'e'), tile('dots', 3, 'f'),
        tile('bamboo', 5, 'g'), tile('bamboo', 5, 'h'),
        tile('characters', 2, 'i'), tile('characters', 2, 'j'),
        tile('winds', 1, 'k'), tile('winds', 1, 'l'),
        tile('dragons', 2, 'm'), tile('dragons', 2, 'n'),
      ],
      melds: [],
      bonusTiles: [],
    };
    // 1-1-1-1 is a pung + pair shape, but combined with the other 5 pairs that
    // leaves an unpaired pung? Actually 1-1-1-1 can be pung(3)+pair(1), but then
    // 5 pairs + 1 single... Let's verify it's not detected as seven-pairs.
    const win = detectWin(hand);
    expect(win === null || win.type !== 'seven-pairs').toBe(true);
  });

  it('can be disabled via options', () => {
    const hand: Hand = {
      tiles: [
        tile('dots', 1, 'a'), tile('dots', 1, 'b'),
        tile('dots', 3, 'c'), tile('dots', 3, 'd'),
        tile('bamboo', 5, 'e'), tile('bamboo', 5, 'f'),
        tile('characters', 2, 'g'), tile('characters', 2, 'h'),
        tile('winds', 1, 'i'), tile('winds', 1, 'j'),
        tile('dragons', 2, 'k'), tile('dragons', 2, 'l'),
        tile('dots', 9, 'm'), tile('dots', 9, 'n'),
      ],
      melds: [],
      bonusTiles: [],
    };
    expect(detectWin(hand, { allowSevenPairs: false })).toBeNull();
  });
});

describe('thirteen orphans', () => {
  it('recognizes a thirteen-orphans hand', () => {
    const hand: Hand = {
      tiles: [
        tile('bamboo', 1, 'a'), tile('bamboo', 9, 'b'),
        tile('characters', 1, 'c'), tile('characters', 9, 'd'),
        tile('dots', 1, 'e'), tile('dots', 9, 'f'),
        tile('winds', 1, 'g'), tile('winds', 2, 'h'), tile('winds', 3, 'i'), tile('winds', 4, 'j'),
        tile('dragons', 1, 'k'), tile('dragons', 2, 'l'), tile('dragons', 3, 'm'),
        tile('dragons', 1, 'n'), // duplicate of red dragon
      ],
      melds: [],
      bonusTiles: [],
    };
    const win = detectWin(hand);
    expect(win).not.toBeNull();
    expect(win!.type).toBe('thirteen-orphans');
    expect(win!.pair).toHaveLength(2);
  });

  it('rejects a 13-orphans shape missing a duplicate', () => {
    const hand: Hand = {
      tiles: [
        tile('bamboo', 1, 'a'), tile('bamboo', 9, 'b'),
        tile('characters', 1, 'c'), tile('characters', 9, 'd'),
        tile('dots', 1, 'e'), tile('dots', 9, 'f'),
        tile('winds', 1, 'g'), tile('winds', 2, 'h'), tile('winds', 3, 'i'), tile('winds', 4, 'j'),
        tile('dragons', 1, 'k'), tile('dragons', 2, 'l'), tile('dragons', 3, 'm'),
        tile('bamboo', 5, 'n'), // not an orphan
      ],
      melds: [],
      bonusTiles: [],
    };
    expect(detectWin(hand)).toBeNull();
  });
});

describe('WinResult structure', () => {
  it('returns a valid decomposition for a standard hand', () => {
    const win = detectWin(standardWin()) as WinResult;
    expect(win.type).toBe('standard');
    const meldSizes = win.melds.map((m) => m.tiles.length).sort((a, b) => a - b);
    expect(meldSizes).toEqual([3, 3, 3, 3]);
    // Every meld must be valid (3 of a kind or 3 consecutive).
    for (const meld of win.melds) {
      const first = meld.tiles[0]!;
      const sameKind = meld.tiles.every((t) => t.suit === first.suit && t.rank === first.rank);
      const consecutive =
        meld.tiles.length === 3 &&
        meld.tiles[0]!.suit === meld.tiles[1]!.suit &&
        meld.tiles[1]!.suit === meld.tiles[2]!.suit &&
        meld.tiles[1]!.rank === meld.tiles[0]!.rank + 1 &&
        meld.tiles[2]!.rank === meld.tiles[1]!.rank + 1;
      expect(sameKind || consecutive).toBe(true);
    }
  });

  it('excludes bonus tiles from the win total', () => {
    const hand: Hand = {
      tiles: [
        tile('dots', 1, 'a'), tile('dots', 2, 'b'), tile('dots', 3, 'c'),
        tile('dots', 2, 'd'), tile('dots', 3, 'e'), tile('dots', 4, 'f'),
        tile('dots', 4, 'g'), tile('dots', 5, 'h'), tile('dots', 6, 'i'),
        tile('dots', 6, 'j'), tile('dots', 7, 'k'), tile('dots', 8, 'l'),
        tile('dots', 9, 'm'), tile('dots', 9, 'n'),
      ],
      melds: [],
      bonusTiles: [tile('flowers', 1, 'f1'), tile('seasons', 2, 's2')],
    };
    const win = detectWin(hand);
    expect(win).not.toBeNull();
    expect(win!.tiles).toHaveLength(14);
  });
});
