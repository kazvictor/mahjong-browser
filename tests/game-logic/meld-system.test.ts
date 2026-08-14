/**
 * Unit tests for the meld detection system (chow / pung / kong).
 */
import { describe, expect, it } from 'vitest';
import {
  detectMeldOpportunities,
  hasMeldOpportunity,
  meldHandCount,
} from '../../src/game-logic/meld-system';
import type { Tile } from '../../src/game-logic/types';

/** Build a tile quickly. */
function tile(suit: Tile['suit'], rank: number, id: string): Tile {
  return { id, suit, rank };
}

describe('detectMeldOpportunities', () => {
  it('detects a pung when the player holds two matching tiles', () => {
    const hand = [tile('dots', 5, 'a'), tile('dots', 5, 'b'), tile('bamboo', 1, 'c')];
    const discard = tile('dots', 5, 'd');
    const opps = detectMeldOpportunities(hand, discard);
    const pung = opps.find((o) => o.type === 'pung');
    expect(pung).toBeDefined();
    expect(pung!.tiles).toHaveLength(3);
    expect(pung!.handTileIds).toEqual(['a', 'b']);
    expect(pung!.claimedTile.id).toBe('d');
  });

  it('detects a kong when the player holds three matching tiles', () => {
    const hand = [tile('dots', 5, 'a'), tile('dots', 5, 'b'), tile('dots', 5, 'c')];
    const discard = tile('dots', 5, 'd');
    const opps = detectMeldOpportunities(hand, discard);
    const kong = opps.find((o) => o.type === 'kong');
    expect(kong).toBeDefined();
    expect(kong!.tiles).toHaveLength(4);
    expect(kong!.handTileIds).toEqual(['a', 'b', 'c']);
  });

  it('detects a chow when the player holds the two sequence partners', () => {
    // Discard 5; player holds 3 and 4 -> chow 3-4-5.
    const hand = [tile('dots', 3, 'a'), tile('dots', 4, 'b'), tile('bamboo', 9, 'c')];
    const discard = tile('dots', 5, 'd');
    const opps = detectMeldOpportunities(hand, discard);
    const chow = opps.find((o) => o.type === 'chow');
    expect(chow).toBeDefined();
    expect(chow!.tiles).toHaveLength(3);
    // Tiles ordered by ascending rank: 3, 4, 5.
    expect(chow!.tiles.map((t) => t.rank)).toEqual([3, 4, 5]);
    expect(chow!.handTileIds).toEqual(['a', 'b']);
  });

  it('detects a chow when the discard is the low tile of the run', () => {
    // Discard 3; player holds 4 and 5 -> chow 3-4-5.
    const hand = [tile('dots', 4, 'a'), tile('dots', 5, 'b')];
    const discard = tile('dots', 3, 'd');
    const opps = detectMeldOpportunities(hand, discard);
    const chow = opps.find((o) => o.type === 'chow');
    expect(chow).toBeDefined();
    expect(chow!.tiles.map((t) => t.rank)).toEqual([3, 4, 5]);
  });

  it('detects a chow when the discard is the middle tile of the run', () => {
    // Discard 4; player holds 3 and 5 -> chow 3-4-5.
    const hand = [tile('dots', 3, 'a'), tile('dots', 5, 'b')];
    const discard = tile('dots', 4, 'd');
    const opps = detectMeldOpportunities(hand, discard);
    const chow = opps.find((o) => o.type === 'chow');
    expect(chow).toBeDefined();
    expect(chow!.tiles.map((t) => t.rank)).toEqual([3, 4, 5]);
  });

  it('does not form a chow from honor tiles', () => {
    const hand = [tile('winds', 1, 'a'), tile('winds', 2, 'b')];
    const discard = tile('winds', 3, 'd');
    const opps = detectMeldOpportunities(hand, discard);
    expect(opps.find((o) => o.type === 'chow')).toBeUndefined();
  });

  it('does not form a chow across suit boundaries', () => {
    const hand = [tile('dots', 3, 'a'), tile('bamboo', 4, 'b')];
    const discard = tile('dots', 5, 'd');
    const opps = detectMeldOpportunities(hand, discard);
    expect(opps.find((o) => o.type === 'chow')).toBeUndefined();
  });

  it('returns an empty array when no claim is possible', () => {
    const hand = [tile('dots', 1, 'a'), tile('bamboo', 2, 'b')];
    const discard = tile('characters', 9, 'd');
    expect(detectMeldOpportunities(hand, discard)).toEqual([]);
  });

  it('reports both pung and kong when the player holds three matching tiles', () => {
    const hand = [tile('dots', 5, 'a'), tile('dots', 5, 'b'), tile('dots', 5, 'c')];
    const discard = tile('dots', 5, 'd');
    const opps = detectMeldOpportunities(hand, discard);
    expect(opps.some((o) => o.type === 'pung')).toBe(true);
    expect(opps.some((o) => o.type === 'kong')).toBe(true);
  });

  it('does not mutate the input hand', () => {
    const hand = [tile('dots', 5, 'a'), tile('dots', 5, 'b')];
    const discard = tile('dots', 5, 'd');
    const before = hand.map((t) => t.id);
    detectMeldOpportunities(hand, discard);
    expect(hand.map((t) => t.id)).toEqual(before);
  });
});

describe('hasMeldOpportunity', () => {
  it('is true when a claim exists', () => {
    const hand = [tile('dots', 5, 'a'), tile('dots', 5, 'b')];
    expect(hasMeldOpportunity(hand, tile('dots', 5, 'd'))).toBe(true);
  });

  it('is false when no claim exists', () => {
    const hand = [tile('dots', 1, 'a'), tile('bamboo', 2, 'b')];
    expect(hasMeldOpportunity(hand, tile('characters', 9, 'd'))).toBe(false);
  });
});

describe('meldHandCount', () => {
  it('returns the number of hand tiles needed for each meld type', () => {
    expect(meldHandCount('chow')).toBe(2);
    expect(meldHandCount('pung')).toBe(2);
    expect(meldHandCount('kong')).toBe(3);
  });
});
