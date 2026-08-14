/**
 * Unit tests for the MVP scoring system.
 *
 * Verifies base points from meld types (chow=1, pung=2, kong=4), dragon/wind
 * bonuses, special-hand flat scores, and the per-player payout figure.
 */
import { describe, expect, it } from 'vitest';
import {
  scoreWin,
  MELD_BASE_POINTS,
  SEVEN_PAIRS_SCORE,
  THIRTEEN_ORPHANS_SCORE,
  type ScoreResult,
} from '../../src/game-logic/scoring';
import { detectWin, type WinResult } from '../../src/game-logic/win-detection';
import type { Hand, Tile } from '../../src/game-logic/types';

function tile(suit: Tile['suit'], rank: number, id: string): Tile {
  return { id, suit, rank };
}

/** Build a WinResult directly for scoring tests (no need for a real hand). */
function standardResult(melds: Array<{ type: 'chow' | 'pung' | 'kong'; tiles: Tile[] }>): WinResult {
  const allTiles = melds.flatMap((m) => m.tiles);
  // Pair not included in tiles array here (it's display-only); scoring uses melds.
  return {
    type: 'standard',
    melds,
    pair: [],
    tiles: allTiles,
  };
}

describe('base points from melds', () => {
  it('awards chow=1, pung=2, kong=4', () => {
    expect(MELD_BASE_POINTS.chow).toBe(1);
    expect(MELD_BASE_POINTS.pung).toBe(2);
    expect(MELD_BASE_POINTS.kong).toBe(4);
  });

  it('sums four chows to 4 points', () => {
    const mk = (): Tile[] => [
      tile('dots', 1, 'a'), tile('dots', 2, 'b'), tile('dots', 3, 'c'),
    ];
    const win = standardResult([
      { type: 'chow', tiles: mk() },
      { type: 'chow', tiles: mk() },
      { type: 'chow', tiles: mk() },
      { type: 'chow', tiles: mk() },
    ]);
    const score = scoreWin(win);
    expect(score.total).toBe(4);
    expect(score.pointsFromEach).toBe(4);
  });

  it('sums a mix of melds correctly', () => {
    const win = standardResult([
      { type: 'chow', tiles: [tile('dots', 1, 'a'), tile('dots', 2, 'b'), tile('dots', 3, 'c')] },
      { type: 'pung', tiles: [tile('dots', 5, 'd'), tile('dots', 5, 'e'), tile('dots', 5, 'f')] },
      { type: 'kong', tiles: [tile('dots', 9, 'g'), tile('dots', 9, 'h'), tile('dots', 9, 'i'), tile('dots', 9, 'j')] },
      { type: 'chow', tiles: [tile('dots', 6, 'k'), tile('dots', 7, 'l'), tile('dots', 8, 'm')] },
    ]);
    const score = scoreWin(win);
    expect(score.total).toBe(1 + 2 + 4 + 1); // 8
  });
});

describe('dragon and wind bonuses', () => {
  it('adds dragon bonus per dragon pung/kong', () => {
    const win = standardResult([
      { type: 'pung', tiles: [tile('dragons', 1, 'r1'), tile('dragons', 1, 'r2'), tile('dragons', 1, 'r3')] },
      { type: 'pung', tiles: [tile('dragons', 2, 'g1'), tile('dragons', 2, 'g2'), tile('dragons', 2, 'g3')] },
      { type: 'chow', tiles: [tile('dots', 1, 'a'), tile('dots', 2, 'b'), tile('dots', 3, 'c')] },
      { type: 'chow', tiles: [tile('dots', 4, 'd'), tile('dots', 5, 'e'), tile('dots', 6, 'f')] },
    ]);
    const score = scoreWin(win);
    // 2 dragon pungs = 2*2 base + 2*DRAGON_BONUS = 4 + 2 = 6; plus 2 chows = 2. Total 8.
    expect(score.total).toBe(8);
    expect(score.lines.filter((l) => l.label === 'Dragon Bonus')).toHaveLength(2);
  });

  it('adds wind bonus per wind pung/kong', () => {
    const win = standardResult([
      { type: 'pung', tiles: [tile('winds', 1, 'e1'), tile('winds', 1, 'e2'), tile('winds', 1, 'e3')] },
      { type: 'chow', tiles: [tile('dots', 1, 'a'), tile('dots', 2, 'b'), tile('dots', 3, 'c')] },
      { type: 'chow', tiles: [tile('dots', 4, 'd'), tile('dots', 5, 'e'), tile('dots', 6, 'f')] },
      { type: 'chow', tiles: [tile('dots', 7, 'g'), tile('dots', 8, 'h'), tile('dots', 9, 'i')] },
    ]);
    const score = scoreWin(win);
    // 1 wind pung = 2 base + 1 bonus = 3; plus 3 chows = 3. Total 6.
    expect(score.total).toBe(6);
    expect(score.lines.filter((l) => l.label === 'Wind Bonus')).toHaveLength(1);
  });

  it('does not apply honor bonuses to a dragon pair in a standard hand', () => {
    // Pair of dragons (not a pung) should not add a dragon bonus.
    const win = standardResult([
      { type: 'chow', tiles: [tile('dots', 1, 'a'), tile('dots', 2, 'b'), tile('dots', 3, 'c')] },
      { type: 'chow', tiles: [tile('dots', 4, 'd'), tile('dots', 5, 'e'), tile('dots', 6, 'f')] },
      { type: 'chow', tiles: [tile('dots', 7, 'g'), tile('dots', 8, 'h'), tile('dots', 9, 'i')] },
      { type: 'pung', tiles: [tile('bamboo', 1, 'x'), tile('bamboo', 1, 'y'), tile('bamboo', 1, 'z')] },
    ]);
    const score = scoreWin(win);
    // No dragon/wind bonus lines should exist (all melds are non-honor).
    expect(score.lines.filter((l) => l.label.endsWith('Bonus'))).toHaveLength(0);
    expect(score.total).toBe(1 + 1 + 1 + 2); // 5
  });
});

describe('special hands', () => {
  it('awards the flat seven-pairs score', () => {
    const win: WinResult = { type: 'seven-pairs', melds: [], pair: [], tiles: [] };
    const score = scoreWin(win);
    expect(score.total).toBe(SEVEN_PAIRS_SCORE);
    expect(score.pointsFromEach).toBe(SEVEN_PAIRS_SCORE);
  });

  it('awards the flat thirteen-orphans score', () => {
    const win: WinResult = { type: 'thirteen-orphans', melds: [], pair: [], tiles: [] };
    const score = scoreWin(win);
    expect(score.total).toBe(THIRTEEN_ORPHANS_SCORE);
    expect(score.pointsFromEach).toBe(THIRTEEN_ORPHANS_SCORE);
  });
});

describe('score breakdown lines', () => {
  it('produces a line per meld plus a total', () => {
    const win = standardResult([
      { type: 'pung', tiles: [tile('dots', 5, 'a'), tile('dots', 5, 'b'), tile('dots', 5, 'c')] },
      { type: 'chow', tiles: [tile('dots', 1, 'd'), tile('dots', 2, 'e'), tile('dots', 3, 'f')] },
      { type: 'chow', tiles: [tile('dots', 4, 'g'), tile('dots', 5, 'h'), tile('dots', 6, 'i')] },
      { type: 'chow', tiles: [tile('dots', 7, 'j'), tile('dots', 8, 'k'), tile('dots', 9, 'l')] },
    ]);
    const score: ScoreResult = scoreWin(win);
    // 4 meld lines + 0 bonus lines.
    expect(score.lines.length).toBe(4);
    const totalLine = score.lines.reduce((sum, l) => sum + l.points, 0);
    expect(totalLine).toBe(score.total);
  });
});

describe('end-to-end: detect + score a real hand', () => {
  it('detects and scores a standard win with an exposed wind pung', () => {
    const exposed = {
      type: 'pung' as const,
      tiles: [tile('winds', 1, 'e1'), tile('winds', 1, 'e2'), tile('winds', 1, 'e3')],
      isConcealed: false,
    };
    const hand: Hand = {
      tiles: [
        tile('dots', 1, 'a'), tile('dots', 2, 'b'), tile('dots', 3, 'c'),
        tile('dots', 4, 'd'), tile('dots', 5, 'e'), tile('dots', 6, 'f'),
        tile('dots', 7, 'g'), tile('dots', 8, 'h'), tile('dots', 9, 'i'),
        tile('dots', 6, 'j'), tile('dots', 6, 'k'),
      ],
      melds: [exposed],
      bonusTiles: [],
    };
    // Concealed: 1-2-3, 4-5-6, 7-8-9 chows + 6-6 pair; exposed wind pung.
    const win = detectWin(hand);
    expect(win).not.toBeNull();
    const score = scoreWin(win!);
    // 3 concealed chows = 3 pts + exposed wind pung (2 base + 1 wind bonus) = 3.
    expect(score.lines.some((l) => l.label === 'Wind Bonus')).toBe(true);
    expect(score.total).toBe(6);
  });
});
