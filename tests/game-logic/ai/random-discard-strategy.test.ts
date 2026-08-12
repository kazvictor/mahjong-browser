/**
 * Unit tests for the AI discard strategies.
 */
import { describe, expect, it } from 'vitest';
import type { Tile } from '../../../src/game-logic/types';
import {
  isBonusSuit,
  RandomDiscardStrategy,
  tileCompletesMeld,
} from '../../../src/game-logic/ai/random-discard-strategy';

/** Build a tile with the current shared shape (id, suit, rank). */
function tile(suit: Tile['suit'], rank: number, id?: string): Tile {
  return { id: id ?? `${suit}-${rank}`, suit, rank };
}

describe('RandomDiscardStrategy', () => {
  it('returns null for an empty hand', () => {
    const strategy = new RandomDiscardStrategy(() => 0);
    expect(strategy.chooseTile([])).toBeNull();
  });

  it('returns a tile from the hand', () => {
    const hand = [tile('dots', 1, 'a'), tile('dots', 2, 'b'), tile('dots', 3, 'c')];
    const strategy = new RandomDiscardStrategy(() => 0);
    const chosen = strategy.chooseTile(hand);
    expect(chosen).not.toBeNull();
    expect(hand).toContainEqual(chosen);
  });

  it('respects a fixed random value (deterministic selection)', () => {
    const hand = [tile('bamboo', 1, 'a'), tile('bamboo', 2, 'b'), tile('bamboo', 3, 'c')];
    // random() === 0 picks the first candidate; random() near 1 picks the last.
    const first = new RandomDiscardStrategy(() => 0).chooseTile(hand);
    expect(first?.id).toBe('a');

    const last = new RandomDiscardStrategy(() => 0.99).chooseTile(hand);
    expect(last?.id).toBe('c');
  });

  it('avoids the protected tile when others exist', () => {
    const hand = [tile('dots', 1, 'a'), tile('dots', 2, 'b'), tile('dots', 3, 'c')];
    const strategy = new RandomDiscardStrategy(() => 0);
    // Even though random() would pick 'a', it must be skipped.
    const chosen = strategy.chooseTile(hand, 'a');
    expect(chosen?.id).not.toBe('a');
  });

  it('falls back to the protected tile when it is the only option', () => {
    const hand = [tile('dots', 1, 'a')];
    const strategy = new RandomDiscardStrategy(() => 0);
    const chosen = strategy.chooseTile(hand, 'a');
    expect(chosen?.id).toBe('a');
  });

  it('returns a different tile over many iterations (not stuck on one)', () => {
    const hand = [tile('dots', 1, 'a'), tile('dots', 2, 'b'), tile('dots', 3, 'c')];
    const strategy = new RandomDiscardStrategy(() => Math.random());
    const seen = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      const chosen = strategy.chooseTile(hand);
      if (chosen !== null) {
        seen.add(chosen.id);
      }
    }
    // With uniform randomness over 3 tiles, we should see at least 2 distinct.
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});

describe('isBonusSuit', () => {
  it('recognises flowers and seasons', () => {
    expect(isBonusSuit('flowers')).toBe(true);
    expect(isBonusSuit('seasons')).toBe(true);
  });

  it('rejects numbered suits and honors', () => {
    expect(isBonusSuit('dots')).toBe(false);
    expect(isBonusSuit('winds')).toBe(false);
    expect(isBonusSuit('dragons')).toBe(false);
  });
});

describe('tileCompletesMeld', () => {
  it('detects a pung-completing tile (two already in hand)', () => {
    const hand = [tile('dots', 5, 'a'), tile('dots', 5, 'b'), tile('dots', 1, 'x')];
    const candidate = tile('dots', 5, 'c');
    expect(tileCompletesMeld(hand, candidate)).toBe(true);
  });

  it('does not flag a tile that only pairs (one already in hand)', () => {
    const hand = [tile('dots', 5, 'a'), tile('dots', 1, 'x')];
    const candidate = tile('dots', 5, 'c');
    expect(tileCompletesMeld(hand, candidate)).toBe(false);
  });

  it('detects a chow-completing tile (both neighbours present)', () => {
    const hand = [tile('bamboo', 2, 'a'), tile('bamboo', 4, 'b')];
    const candidate = tile('bamboo', 3, 'c');
    expect(tileCompletesMeld(hand, candidate)).toBe(true);
  });

  it('does not flag a chow-completing tile across suit boundaries', () => {
    const hand = [tile('bamboo', 2, 'a'), tile('dots', 4, 'b')];
    const candidate = tile('bamboo', 3, 'c');
    expect(tileCompletesMeld(hand, candidate)).toBe(false);
  });

  it('handles chow runs at the edge of the rank range', () => {
    // rank 1 candidate with 2 and 3 present completes chow 1-2-3.
    const hand = [tile('characters', 2, 'a'), tile('characters', 3, 'b')];
    expect(tileCompletesMeld(hand, tile('characters', 1, 'c'))).toBe(true);

    // rank 1 candidate with only 2 present (no 3) does not complete a chow.
    const handPartial = [tile('characters', 2, 'a')];
    expect(tileCompletesMeld(handPartial, tile('characters', 1, 'c'))).toBe(false);

    // rank 9 candidate with 7 and 8 present completes chow 7-8-9.
    const handHigh = [tile('characters', 7, 'a'), tile('characters', 8, 'b')];
    expect(tileCompletesMeld(handHigh, tile('characters', 9, 'c'))).toBe(true);
  });
});
