/**
 * Unit tests for the pure meld-display layout engine.
 *
 * Verifies that exposed melds are positioned at the correct player edge,
 * grouped per meld with contiguous tiles, and never exceed the row cap.
 */
import { describe, expect, it } from 'vitest';
import { MeldDisplay, MAX_TILES_PER_ROW, MELD_GAP, TILE_WIDTH } from './meld-display';
import type { Meld, Player } from '../../game-logic/types';

/** Build a meld quickly. */
function meld(type: Meld['type'], suits: string[], isConcealed = false, sourcePlayer?: number): Meld {
  return {
    type,
    tiles: suits.map((s, i) => {
      const [suit, rank] = s.split('-');
      return { id: `${type}-${i}`, suit: suit as Meld['tiles'][number]['suit'], rank: Number(rank) };
    }),
    isConcealed,
    sourcePlayer,
  };
}

/** Build a player with the given seat and melds. */
function player(seat: number, melds: Meld[]): Player {
  return {
    id: seat,
    seat,
    isAI: seat !== 0,
    score: 0,
    hand: { tiles: [], melds, bonusTiles: [] },
  };
}

describe('MeldDisplay.compute', () => {
  it('returns empty frames when no player has melds', () => {
    const display = new MeldDisplay();
    const frame = display.compute(800, 600, [player(0, []), player(1, []), player(2, []), player(3, [])]);
    expect(frame.tiles).toHaveLength(0);
    expect(frame.groups).toHaveLength(0);
  });

  it('lays out a single pung for the bottom player (seat 0)', () => {
    const display = new MeldDisplay();
    const m = meld('pung', ['dots-5', 'dots-5', 'dots-5']);
    const frame = display.compute(800, 600, [player(0, [m]), player(1, []), player(2, []), player(3, [])]);

    expect(frame.groups).toHaveLength(1);
    expect(frame.tiles).toHaveLength(3);
    const group = frame.groups[0]!;
    // Bottom player: melds sit just above the hand area, centered horizontally.
    expect(group.seat).toBe(0);
    expect(group.y).toBeLessThan(600);
    // Group centered horizontally.
    const cx = group.x + group.width / 2;
    expect(cx).toBeCloseTo(400, 0);

    // Tiles are contiguous within the group (each advances by TILE_WIDTH + TILE_GAP).
    expect(frame.tiles[0]!.x).toBe(group.x);
    expect(frame.tiles[1]!.x).toBe(group.x + TILE_WIDTH + 2);
    expect(frame.tiles[2]!.x).toBe(group.x + 2 * (TILE_WIDTH + 2));
  });

  it('marks the claimed discard tile of an exposed meld', () => {
    const display = new MeldDisplay();
    const m = meld('pung', ['dots-5', 'dots-5', 'dots-5'], false, 2);
    const frame = display.compute(800, 600, [player(0, [m]), player(1, []), player(2, []), player(3, [])]);
    expect(frame.tiles[0]!.isClaimedDiscard).toBe(true);
    expect(frame.tiles[1]!.isClaimedDiscard).toBe(false);
  });

  it('places top player (seat 2) melds below the top hand', () => {
    const display = new MeldDisplay();
    const m = meld('chow', ['bamboo-2', 'bamboo-3', 'bamboo-4']);
    const frame = display.compute(800, 600, [player(0, []), player(1, []), player(2, [m]), player(3, [])]);
    expect(frame.groups[0]!.seat).toBe(2);
    expect(frame.groups[0]!.y).toBeGreaterThan(60); // below the top hand row
    expect(frame.tiles).toHaveLength(3);
  });

  it('places right player (seat 1) melds toward the left of the right edge', () => {
    const display = new MeldDisplay();
    const m = meld('pung', ['dots-7', 'dots-7', 'dots-7']);
    const frame = display.compute(1000, 700, [player(0, []), player(1, [m]), player(2, []), player(3, [])]);
    const group = frame.groups[0]!;
    expect(group.seat).toBe(1);
    // Right player melds start at the left inset of the right column.
    expect(group.x).toBe(10);
  });

  it('places left player (seat 3) melds toward the right of the left edge', () => {
    const display = new MeldDisplay();
    const m = meld('pung', ['dots-7', 'dots-7', 'dots-7']);
    const frame = display.compute(1000, 700, [player(0, []), player(1, []), player(2, []), player(3, [m])]);
    const group = frame.groups[0]!;
    expect(group.seat).toBe(3);
    // Left player melds sit at the right end of the left inset band.
    expect(group.x + group.width).toBeCloseTo(1000 - 10, 0);
  });

  it('wraps to a second row when a row exceeds the tile cap', () => {
    const display = new MeldDisplay();
    // 5 melds of 3 tiles = 15 tiles > cap of 12.
    const melds = Array.from({ length: 5 }, (_, i) =>
      meld('pung', ['dots-1', 'dots-1', 'dots-1'], false, i),
    );
    const frame = display.compute(800, 600, [player(0, melds), player(1, []), player(2, []), player(3, [])]);
    // 5 melds -> 15 tiles across 2 rows.
    expect(frame.tiles).toHaveLength(15);
    expect(frame.groups).toHaveLength(5);
    const rows = new Set(frame.groups.map((g) => g.y));
    expect(rows.size).toBe(2);
  });

  it('keeps each meld row under or equal to the tile cap', () => {
    const display = new MeldDisplay();
    const melds = Array.from({ length: 6 }, (_, i) =>
      meld('pung', ['dots-1', 'dots-1', 'dots-1'], false, i),
    );
    const frame = display.compute(800, 600, [player(0, melds), player(1, []), player(2, []), player(3, [])]);
    // Group by row (same y) and assert each row's tile count <= cap.
    const byRow = new Map<number, number>();
    for (const t of frame.tiles) {
      byRow.set(t.y, (byRow.get(t.y) ?? 0) + 1);
    }
    for (const count of byRow.values()) {
      expect(count).toBeLessThanOrEqual(MAX_TILES_PER_ROW);
    }
  });

  it('adds MELD_GAP between adjacent melds in the same row', () => {
    const display = new MeldDisplay();
    const m1 = meld('pung', ['dots-1', 'dots-1', 'dots-1']);
    const m2 = meld('pung', ['dots-2', 'dots-2', 'dots-2']);
    const frame = display.compute(800, 600, [player(0, [m1, m2]), player(1, []), player(2, []), player(3, [])]);
    const g1 = frame.groups[0]!;
    const g2 = frame.groups[1]!;
    expect(g2.x - (g1.x + g1.width)).toBeCloseTo(MELD_GAP, 0);
  });
});
