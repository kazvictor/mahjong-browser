/**
 * Unit tests for the dealing algorithm and wall construction.
 *
 * Covers the quality gate: seeded reproducibility, dice-driven break point,
 * exact 13-tile hands, dealer's 14th tile, dead-wall preservation, and
 * flower/season auto-exposure with replacement.
 */
import { describe, it, expect } from 'vitest';
import {
  Wall,
  SeededRng,
  rollDice,
  buildFullDeck,
  TOTAL_TILES,
  DEAD_WALL_SIZE,
  PLAYER_COUNT,
  INITIAL_HAND_SIZE,
  type WallTile,
} from '@game-logic/deal-wall';
import { DealingAlgorithm } from '@game-logic/dealing';

/** A wall with no bonus tiles, so the deal is exactly 52 tiles with no replacements. */
function buildBonusFreeWall(seed: number): Wall {
  const tiles = buildFullDeck().filter((t) => !t.isBonus);
  return new Wall({ seed, tiles });
}

describe('SeededRng', () => {
  it('is deterministic for the same seed', () => {
    const a = new SeededRng(42);
    const b = new SeededRng(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = new SeededRng(1);
    const b = new SeededRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('next() stays within [0, 1)', () => {
    const rng = new SeededRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt() stays within [0, maxExclusive)', () => {
    const rng = new SeededRng(9);
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextInt(6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
  });
});

describe('rollDice', () => {
  it('rolls 2d6 by default with sum in [2, 12]', () => {
    const rng = new SeededRng(123);
    for (let i = 0; i < 200; i++) {
      const sum = rollDice(rng);
      expect(sum).toBeGreaterThanOrEqual(2);
      expect(sum).toBeLessThanOrEqual(12);
    }
  });

  it('is deterministic for a fixed seed', () => {
    const a = rollDice(new SeededRng(5));
    const b = rollDice(new SeededRng(5));
    expect(a).toBe(b);
  });
});

describe('buildFullDeck', () => {
  it('builds exactly 144 tiles', () => {
    expect(buildFullDeck()).toHaveLength(TOTAL_TILES);
  });

  it('contains 8 bonus tiles (4 flowers + 4 seasons)', () => {
    const tiles = buildFullDeck();
    const flowers = tiles.filter((t) => t.isFlower);
    const seasons = tiles.filter((t) => t.isSeason);
    expect(flowers).toHaveLength(4);
    expect(seasons).toHaveLength(4);
  });

  it('contains 4 copies of each suited tile', () => {
    const tiles = buildFullDeck();
    const bambooOnes = tiles.filter((t) => t.suit === 'bamboo' && t.rank === 1);
    expect(bambooOnes).toHaveLength(4);
  });
});

describe('Wall', () => {
  it('shuffles reproducibly for the same seed', () => {
    const a = new Wall({ seed: 99 });
    const b = new Wall({ seed: 99 });
    expect(a.tiles.map((t) => t.id)).toEqual(b.tiles.map((t) => t.id));
  });

  it('lays the wall out in 4 rows of 36', () => {
    const wall = new Wall({ seed: 1 });
    expect(wall.rows).toHaveLength(4);
    for (const row of wall.rows) {
      expect(row).toHaveLength(36);
    }
  });

  it('derives the break point from the dice roll', () => {
    const wall = new Wall({ seed: 1 });
    expect(wall.breakIndex).toBe(wall.diceTotal * 2);
    expect(wall.diceTotal).toBeGreaterThanOrEqual(2);
    expect(wall.diceTotal).toBeLessThanOrEqual(12);
  });

  it('preserves a 14-tile dead wall', () => {
    const wall = new Wall({ seed: 1 });
    expect(wall.deadRemaining).toBe(DEAD_WALL_SIZE);
    expect(wall.liveRemaining).toBe(TOTAL_TILES - DEAD_WALL_SIZE);
  });

  it('live and dead walls partition all 144 tiles with no overlap', () => {
    const wall = new Wall({ seed: 1 });
    const liveIds = wall.liveWallTiles.map((t) => t.id);
    const deadIds = wall.deadWallTiles.map((t) => t.id);
    expect(liveIds.length + deadIds.length).toBe(TOTAL_TILES);
    const overlap = liveIds.filter((id) => deadIds.includes(id));
    expect(overlap).toHaveLength(0);
  });

  it('draw() consumes from the live wall', () => {
    const wall = new Wall({ seed: 1 });
    const before = wall.liveRemaining;
    const tile = wall.draw();
    expect(tile).toBeDefined();
    expect(wall.liveRemaining).toBe(before - 1);
  });

  it('drawReplacement() consumes from the dead wall first', () => {
    const wall = new Wall({ seed: 1 });
    const deadBefore = wall.deadRemaining;
    const liveBefore = wall.liveRemaining;
    wall.drawReplacement();
    expect(wall.deadRemaining).toBe(deadBefore - 1);
    expect(wall.liveRemaining).toBe(liveBefore);
  });

  it('throws when drawing from an empty live wall', () => {
    const wall = new Wall({ seed: 1 });
    // Drain the live wall.
    while (wall.liveRemaining > 0) {
      wall.draw();
    }
    expect(() => wall.draw()).toThrow(/empty/);
  });
});

describe('DealingAlgorithm', () => {
  it('deals exactly 13 tiles to each of 4 players (bonus-free wall)', () => {
    const wall = buildBonusFreeWall(2024);
    const result = new DealingAlgorithm(wall).deal();
    expect(result.hands).toHaveLength(PLAYER_COUNT);
    // Non-dealers hold 13; the dealer holds 14 (13 + opening tile).
    for (let seat = 1; seat < PLAYER_COUNT; seat++) {
      expect(result.hands[seat]).toHaveLength(INITIAL_HAND_SIZE);
    }
    expect(result.hands[0]).toHaveLength(INITIAL_HAND_SIZE + 1);
  });

  it('deals 52 tiles total from the wall (bonus-free)', () => {
    const wall = buildBonusFreeWall(2024);
    const before = wall.liveRemaining;
    new DealingAlgorithm(wall).deal();
    // 52 dealt + 1 dealer opening tile = 53 consumed from the live wall.
    expect(before - wall.liveRemaining).toBe(53);
  });

  it('gives the dealer a 14th opening tile', () => {
    const wall = buildBonusFreeWall(2024);
    const result = new DealingAlgorithm(wall).deal();
    expect(result.dealerOpeningTile).toBeDefined();
    // Dealer's hand now holds 14 tiles.
    expect(result.hands[0]).toHaveLength(INITIAL_HAND_SIZE + 1);
  });

  it('is reproducible for the same seed', () => {
    const a = new DealingAlgorithm(buildBonusFreeWall(7)).deal();
    const b = new DealingAlgorithm(buildBonusFreeWall(7)).deal();
    expect(a.hands.map((h) => h.map((t) => t.id))).toEqual(
      b.hands.map((h) => h.map((t) => t.id)),
    );
  });

  it('auto-exposes flowers and seasons and replaces them', () => {
    // Force a wall whose first drawn tiles include a flower so the deal must
    // expose and replace it. Build a custom wall: 1 flower + 143 plain, no
    // shuffle so the flower is drawn first.
    const plain = buildFullDeck().filter((t) => !t.isBonus);
    const flower = buildFullDeck().find((t) => t.isFlower) as WallTile;
    const tiles: WallTile[] = [flower, ...plain];
    const wall = new Wall({ seed: 3, tiles, shuffle: false, breakIndex: 0 });
    const result = new DealingAlgorithm(wall).deal();

    // The flower must have been exposed by some seat.
    const totalExposed = result.exposed.reduce((n, e) => n + e.length, 0);
    expect(totalExposed).toBeGreaterThanOrEqual(1);

    // Every hand still ends with the correct concealed count: 13 for
    // non-dealers, 14 for the dealer (13 + opening tile).
    for (let seat = 1; seat < PLAYER_COUNT; seat++) {
      expect(result.hands[seat]).toHaveLength(INITIAL_HAND_SIZE);
    }
    expect(result.hands[0]).toHaveLength(INITIAL_HAND_SIZE + 1);
    // No concealed hand contains a bonus tile.
    for (const hand of result.hands) {
      for (const tile of hand) {
        expect(tile.isBonus).toBe(false);
      }
    }
  });

  it('records replacement steps distinctly', () => {
    const plain = buildFullDeck().filter((t) => !t.isBonus);
    const flower = buildFullDeck().find((t) => t.isFlower) as WallTile;
    const tiles: WallTile[] = [flower, ...plain];
    const wall = new Wall({ seed: 3, tiles, shuffle: false, breakIndex: 0 });
    const result = new DealingAlgorithm(wall).deal();

    const replacements = result.steps.filter((s) => s.isReplacement);
    expect(replacements.length).toBeGreaterThanOrEqual(1);
    // A replacement tile is never itself a bonus.
    for (const step of replacements) {
      expect(step.tile.isBonus).toBe(false);
    }
  });

  it('deals in the traditional 4-tile rounds then a final tile', () => {
    const wall = buildBonusFreeWall(11);
    const result = new DealingAlgorithm(wall).deal();
    // steps includes the dealer opening tile: 52 deal steps + 1 opening = 53.
    const dealSteps = result.steps.filter((s) => !s.isReplacement);
    expect(dealSteps).toHaveLength(PLAYER_COUNT * INITIAL_HAND_SIZE + 1);

    // First 16 steps = 4 rounds × 4 players (4 tiles each).
    const firstRound = dealSteps.slice(0, 16);
    for (let seat = 0; seat < PLAYER_COUNT; seat++) {
      const seatTiles = firstRound.filter((s) => s.seat === seat);
      expect(seatTiles).toHaveLength(4);
    }
    // Final 4 steps = 1 tile per player.
    const finalRound = dealSteps.slice(48, 52);
    for (let seat = 0; seat < PLAYER_COUNT; seat++) {
      const seatTiles = finalRound.filter((s) => s.seat === seat);
      expect(seatTiles).toHaveLength(1);
    }
    // The last step is the dealer's opening tile (seat 0).
    const lastStep = dealSteps[dealSteps.length - 1];
    expect(lastStep?.seat).toBe(0);
  });
});
