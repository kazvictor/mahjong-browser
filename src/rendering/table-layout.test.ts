// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { TableLayout, SELECT_LIFT, TILE_GAP } from './table-layout';
import { TILE_WIDTH, TILE_HEIGHT } from './asset-loader';
import type { Player } from '../game-logic/types';

/** Build a minimal tile identity. */
function tile(id: string, suit: Player['hand']['tiles'][number]['suit'], rank: number) {
  return { id, suit, rank };
}

/** A player with the given concealed tiles. */
function player(seat: number, ids: string[]): Player {
  return {
    id: seat,
    seat,
    isAI: seat !== 0,
    hand: { tiles: ids.map((id, i) => tile(id, 'dots', (i % 9) + 1)), melds: [], bonusTiles: [] },
    score: 0,
  };
}

const W = 1200;
const H = 800;

function layout(
  players: Player[],
  wall = [tile('w1', 'bamboo', 1)],
  discards: Player['hand']['tiles'][number][] = [],
) {
  const engine = new TableLayout();
  return engine.compute(W, H, players, wall, discards, {
    selectedId: null,
    hoveredId: null,
    validMoveIds: new Set<string>(),
  });
}

describe('TableLayout', () => {
  it('lays the human hand face-up along the bottom', () => {
    const frame = layout([player(0, ['a', 'b', 'c']), player(1, []), player(2, []), player(3, [])]);
    // The 3 hand tiles are face-up; expect 3 of them.
    const handTiles = frame.handTiles.filter((t) => ['a', 'b', 'c'].includes(t.tileId));
    expect(handTiles).toHaveLength(3);
    for (const t of handTiles) {
      expect(t.faceDown).toBe(false);
      // Bottom row: y = height - tileHeight - margin.
      expect(t.y).toBe(H - TILE_HEIGHT - 16);
    }
  });

  it('spaces hand tiles horizontally with the configured gap', () => {
    const frame = layout([player(0, ['a', 'b']), player(1, []), player(2, []), player(3, [])]);
    const [a, b] = frame.handTiles.filter((t) => ['a', 'b'].includes(t.tileId));
    expect(b!.x - (a!.x + TILE_WIDTH)).toBe(TILE_GAP);
  });

  it('lifts a selected tile above its baseline', () => {
    const engine = new TableLayout();
    const frame = engine.compute(W, H, [player(0, ['a']), player(1, []), player(2, []), player(3, [])], [tile('w1', 'bamboo', 1)], [], {
      selectedId: 'a',
      hoveredId: null,
      validMoveIds: new Set<string>(),
    });
    const selected = frame.handTiles.find((t) => t.tileId === 'a');
    expect(selected!.selected).toBe(true);
    expect(selected!.y).toBe(H - TILE_HEIGHT - 16 - SELECT_LIFT);
  });

  it('renders opponent hands face-down on the correct edges', () => {
    const frame = layout([player(0, ['a']), player(1, ['b']), player(2, ['c']), player(3, ['d'])]);
    const b = frame.handTiles.find((t) => t.tileId === 'b');
    const c = frame.handTiles.find((t) => t.tileId === 'c');
    const d = frame.handTiles.find((t) => t.tileId === 'd');
    // West (seat 1) on the right edge.
    expect(b!.faceDown).toBe(true);
    expect(b!.x).toBe(W - TILE_WIDTH - 16);
    // North (seat 2) on the top edge.
    expect(c!.faceDown).toBe(true);
    expect(c!.y).toBe(16);
    // East (seat 3) on the left edge.
    expect(d!.faceDown).toBe(true);
    expect(d!.x).toBe(16);
  });

  it('renders the wall face-down in rows', () => {
    const wall = Array.from({ length: 8 }, (_, i) => tile(`w${i}`, 'bamboo', 1));
    const frame = layout([player(0, ['a']), player(1, []), player(2, []), player(3, [])], wall);
    const wallTiles = frame.handTiles.filter((t) => t.tileId.startsWith('w'));
    expect(wallTiles).toHaveLength(8);
    for (const t of wallTiles) expect(t.faceDown).toBe(true);
  });

  it('renders the discard pile face-up', () => {
    const discards = [tile('d1', 'characters', 1)];
    const frame = layout([player(0, ['a']), player(1, []), player(2, []), player(3, [])], [tile('w1', 'bamboo', 1)], discards);
    const discardTile = frame.handTiles.find((t) => t.tileId === 'd1');
    expect(discardTile!.faceDown).toBe(false);
  });

  it('returns hand hit-test rects aligned with the drawn hand', () => {
    const frame = layout([player(0, ['a', 'b']), player(1, []), player(2, []), player(3, [])]);
    expect(frame.handRects).toHaveLength(2);
    expect(frame.handRects[0]!.tileId).toBe('a');
    expect(frame.handRects[0]!.width).toBe(TILE_WIDTH);
    expect(frame.handRects[0]!.height).toBe(TILE_HEIGHT);
  });

  it('marks valid-move tiles', () => {
    const engine = new TableLayout();
    const frame = engine.compute(W, H, [player(0, ['a', 'b']), player(1, []), player(2, []), player(3, [])], [tile('w1', 'bamboo', 1)], [], {
      selectedId: null,
      hoveredId: null,
      validMoveIds: new Set(['a']),
    });
    const a = frame.handTiles.find((t) => t.tileId === 'a');
    const b = frame.handTiles.find((t) => t.tileId === 'b');
    expect(a!.valid).toBe(true);
    expect(b!.valid).toBe(false);
  });
});
