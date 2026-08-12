import { describe, it, expect, beforeEach } from 'vitest';
import {
  TilePicker,
  computeHandLayout,
  TILE_WIDTH,
  TILE_HEIGHT,
  type TileRect,
} from './tile-picker';

describe('computeHandLayout', () => {
  it('lays tiles left-to-right with the configured gap', () => {
    const rects = computeHandLayout(['a', 'b', 'c'], 10, 20, 2);
    expect(rects).toHaveLength(3);
    expect(rects[0]).toMatchObject({ tileId: 'a', x: 10, y: 20, width: TILE_WIDTH, height: TILE_HEIGHT });
    expect(rects[1]).toMatchObject({ tileId: 'b', x: 10 + TILE_WIDTH + 2 });
    expect(rects[2]).toMatchObject({ tileId: 'c', x: 10 + 2 * (TILE_WIDTH + 2) });
  });

  it('returns an empty array for an empty hand', () => {
    expect(computeHandLayout([], 0, 0)).toEqual([]);
  });
});

describe('TilePicker hit detection', () => {
  let picker: TilePicker;
  const rects: TileRect[] = [
    { tileId: 'a', x: 0, y: 0, width: 40, height: 60, z: 0 },
    { tileId: 'b', x: 42, y: 0, width: 40, height: 60, z: 1 },
  ];

  beforeEach(() => {
    picker = new TilePicker();
    picker.setTileRects(rects);
  });

  it('picks the tile under a point', () => {
    expect(picker.pickAt(5, 5)?.tileId).toBe('a');
    expect(picker.pickAt(50, 30)?.tileId).toBe('b');
  });

  it('returns null for empty space', () => {
    expect(picker.pickAt(41, 5)).toBeNull();
    expect(picker.pickAt(-1, 0)).toBeNull();
  });

  it('resolves overlaps by z, then first match', () => {
    const overlap: TileRect[] = [
      { tileId: 'low', x: 0, y: 0, width: 40, height: 60, z: 0 },
      { tileId: 'high', x: 10, y: 0, width: 40, height: 60, z: 5 },
    ];
    const p = new TilePicker();
    p.setTileRects(overlap);
    expect(p.pickAt(15, 30)?.tileId).toBe('high');
  });
});

describe('TilePicker selection state machine', () => {
  let picker: TilePicker;

  beforeEach(() => {
    picker = new TilePicker();
    picker.setTileRects([
      { tileId: 'a', x: 0, y: 0, width: 40, height: 60 },
      { tileId: 'b', x: 42, y: 0, width: 40, height: 60 },
    ]);
  });

  it('selects a tile on first click', () => {
    const res = picker.handleClick(5, 5);
    expect(res.action).toBe('select');
    expect(res.tileId).toBe('a');
    expect(picker.getSelectedTileId()).toBe('a');
    expect(picker.isSelected('a')).toBe(true);
  });

  it('discards when the selected tile is clicked again', () => {
    picker.handleClick(5, 5);
    const res = picker.handleClick(5, 5);
    expect(res.action).toBe('discard');
    expect(res.tileId).toBe('a');
    expect(picker.getSelectedTileId()).toBeNull();
  });

  it('moves selection to a different tile when one is already selected', () => {
    picker.handleClick(5, 5); // select a
    const res = picker.handleClick(50, 30); // click b
    expect(res.action).toBe('select');
    expect(res.tileId).toBe('b');
    expect(picker.getSelectedTileId()).toBe('b');
    expect(picker.isSelected('a')).toBe(false);
  });

  it('deselects when clicking empty space', () => {
    picker.handleClick(5, 5); // select a
    const res = picker.handleClick(41, 5); // empty gap
    expect(res.action).toBe('none');
    expect(picker.getSelectedTileId()).toBeNull();
  });

  it('does nothing on empty space when nothing is selected', () => {
    const res = picker.handleClick(41, 5);
    expect(res.action).toBe('none');
    expect(res.tileId).toBeNull();
  });
});

describe('TilePicker hover + enable', () => {
  let picker: TilePicker;

  beforeEach(() => {
    picker = new TilePicker();
    picker.setTileRects([{ tileId: 'a', x: 0, y: 0, width: 40, height: 60 }]);
  });

  it('tracks hovered tile and clears it when the pointer leaves the row', () => {
    picker.updateHover(5, 5);
    expect(picker.getHoveredTileId()).toBe('a');
    expect(picker.isHovered('a')).toBe(true);
    picker.updateHover(100, 100);
    expect(picker.getHoveredTileId()).toBeNull();
    expect(picker.isHovered('a')).toBe(false);
  });

  it('ignores hover when disabled', () => {
    picker.setEnabled(false);
    picker.updateHover(5, 5);
    expect(picker.getHoveredTileId()).toBeNull();
    expect(picker.isHovered('a')).toBe(false);
  });

  it('refuses clicks when disabled', () => {
    picker.setEnabled(false);
    const res = picker.handleClick(5, 5);
    expect(res.action).toBe('none');
    expect(picker.getSelectedTileId()).toBeNull();
  });

  it('clears a selection that no longer exists in the layout', () => {
    picker.handleClick(5, 5);
    expect(picker.getSelectedTileId()).toBe('a');
    picker.setTileRects([]);
    expect(picker.getSelectedTileId()).toBeNull();
  });

  it('isEnabled reflects the enabled flag', () => {
    expect(picker.isEnabled()).toBe(true);
    picker.setEnabled(false);
    expect(picker.isEnabled()).toBe(false);
  });
});
