/**
 * Unit tests for the TileWall deck.
 *
 * Covers the quality gate: exactly 144 tiles, correct suit/rank composition,
 * seeded reproducibility, and draw semantics.
 */
import { describe, it, expect } from 'vitest';
import {
  TileWall,
  buildFullDeck,
  mulberry32,
  shuffle,
  TOTAL_TILES,
  DEFAULT_SEED,
} from '@game-logic/wall';
import { Tile } from '@game-logic/tile';

describe('buildFullDeck', () => {
  it('builds exactly 144 tiles', () => {
    expect(buildFullDeck()).toHaveLength(TOTAL_TILES);
  });

  it('contains 108 suited tiles (3 suits × 9 ranks × 4 copies)', () => {
    const deck = buildFullDeck();
    const suited = deck.filter((t) => ['bamboo', 'characters', 'dots'].includes(t.suit));
    expect(suited).toHaveLength(108);
  });

  it('contains 28 honor tiles (4 winds + 3 dragons, × 4 copies)', () => {
    const deck = buildFullDeck();
    const winds = deck.filter((t) => t.suit === 'winds');
    const dragons = deck.filter((t) => t.suit === 'dragons');
    expect(winds).toHaveLength(16);
    expect(dragons).toHaveLength(12);
  });

  it('contains 8 bonus tiles (4 flowers + 4 seasons)', () => {
    const deck = buildFullDeck();
    const flowers = deck.filter((t) => t.suit === 'flowers');
    const seasons = deck.filter((t) => t.suit === 'seasons');
    expect(flowers).toHaveLength(4);
    expect(seasons).toHaveLength(4);
  });

  it('has exactly 4 copies of each suited/honor face', () => {
    const deck = buildFullDeck();
    const count = (suit: string, rank: number) =>
      deck.filter((t) => t.suit === suit && t.rank === rank).length;
    expect(count('bamboo', 1)).toBe(4);
    expect(count('characters', 9)).toBe(4);
    expect(count('dots', 5)).toBe(4);
    expect(count('winds', 1)).toBe(4);
    expect(count('dragons', 3)).toBe(4);
  });

  it('has exactly 1 copy of each bonus face', () => {
    const deck = buildFullDeck();
    const count = (suit: string, rank: number) =>
      deck.filter((t) => t.suit === suit && t.rank === rank).length;
    expect(count('flowers', 1)).toBe(1);
    expect(count('seasons', 4)).toBe(1);
  });
});

describe('TileWall', () => {
  it('starts with 144 tiles', () => {
    expect(new TileWall().size).toBe(TOTAL_TILES);
  });

  it('is not empty initially', () => {
    expect(new TileWall().isEmpty).toBe(false);
  });

  it('draws tiles from the top and shrinks', () => {
    const wall = new TileWall();
    const first = wall.draw();
    expect(first).toBeInstanceOf(Tile);
    expect(wall.size).toBe(TOTAL_TILES - 1);
  });

  it('draws until empty then returns null', () => {
    const wall = new TileWall();
    let drawn = 0;
    while (wall.draw() !== null) {
      drawn++;
    }
    expect(drawn).toBe(TOTAL_TILES);
    expect(wall.isEmpty).toBe(true);
    expect(wall.draw()).toBeNull();
  });

  it('drawMany returns tiles in draw order', () => {
    const wall = new TileWall();
    const drawn = wall.drawMany(5);
    expect(drawn).toHaveLength(5);
    expect(wall.size).toBe(TOTAL_TILES - 5);
  });

  it('drawMany stops at the end of the wall', () => {
    const wall = new TileWall();
    const drawn = wall.drawMany(TOTAL_TILES + 10);
    expect(drawn).toHaveLength(TOTAL_TILES);
  });

  it('is reproducible for the same seed', () => {
    const a = new TileWall(12345);
    const b = new TileWall(12345);
    const seqA = a.drawMany(20).map((t) => t.id);
    const seqB = b.drawMany(20).map((t) => t.id);
    expect(seqA).toEqual(seqB);
  });

  it('produces different orders for different seeds', () => {
    const a = new TileWall(1);
    const b = new TileWall(2);
    const seqA = a.drawMany(20).map((t) => t.id);
    const seqB = b.drawMany(20).map((t) => t.id);
    expect(seqA).not.toEqual(seqB);
  });

  it('reset restores a full shuffled deck with the same seed', () => {
    const wall = new TileWall(7);
    wall.drawMany(50);
    expect(wall.size).toBe(TOTAL_TILES - 50);
    wall.reset();
    expect(wall.size).toBe(TOTAL_TILES);
  });

  it('exposes the seed used', () => {
    expect(new TileWall(99).seed).toBe(99);
    expect(new TileWall().seed).toBe(DEFAULT_SEED >>> 0);
  });
});

describe('mulberry32 and shuffle', () => {
  it('is deterministic for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('produces values in [0, 1)', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('shuffles deterministically with a seeded RNG', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = shuffle([...items], mulberry32(5));
    const b = shuffle([...items], mulberry32(5));
    expect(a).toEqual(b);
    expect(a).toHaveLength(items.length);
    expect([...a].sort()).toEqual(items);
  });
});
