/**
 * Unit tests for the Tile class and sprite-name mapping.
 *
 * Covers the quality gate: suit/rank validation, bonus/flower/season
 * detection, sprite file naming, and the hidden (face-down) flag.
 */
import { describe, it, expect } from 'vitest';
import {
  Tile,
  spriteToken,
  spriteFileName,
  TILE_BACK_FILE,
  WIND_NAMES,
  DRAGON_NAMES,
  SUIT_RANK_RANGE,
} from '@game-logic/tile';

describe('Tile construction', () => {
  it('builds a numbered-suit tile with the expected identity', () => {
    const t = new Tile('bamboo', 5);
    expect(t.suit).toBe('bamboo');
    expect(t.rank).toBe(5);
    expect(t.id).toBe('bamboo-5');
    expect(t.isBonus).toBe(false);
    expect(t.isFlower).toBe(false);
    expect(t.isSeason).toBe(false);
    expect(t.isHidden).toBe(false);
  });

  it('accepts an explicit id', () => {
    const t = new Tile('dots', 3, { id: 'dots-3-copy2' });
    expect(t.id).toBe('dots-3-copy2');
  });

  it('defaults to face-up', () => {
    expect(new Tile('characters', 1).isHidden).toBe(false);
  });

  it('honors the hidden flag', () => {
    const t = new Tile('winds', 1, { isHidden: true });
    expect(t.isHidden).toBe(true);
  });

  it('rejects out-of-range ranks for numbered suits', () => {
    expect(() => new Tile('bamboo', 0)).toThrow();
    expect(() => new Tile('bamboo', 10)).toThrow();
    expect(() => new Tile('dots', 9)).not.toThrow();
  });

  it('rejects out-of-range ranks for honor suits', () => {
    expect(() => new Tile('winds', 5)).toThrow();
    expect(() => new Tile('dragons', 4)).toThrow();
    expect(() => new Tile('winds', 4)).not.toThrow();
    expect(() => new Tile('dragons', 3)).not.toThrow();
  });

  it('rejects non-integer ranks', () => {
    expect(() => new Tile('bamboo', 2.5)).toThrow();
  });
});

describe('bonus detection', () => {
  it('flags flowers as bonus and flower', () => {
    const t = new Tile('flowers', 2);
    expect(t.isBonus).toBe(true);
    expect(t.isFlower).toBe(true);
    expect(t.isSeason).toBe(false);
  });

  it('flags seasons as bonus and season', () => {
    const t = new Tile('seasons', 3);
    expect(t.isBonus).toBe(true);
    expect(t.isFlower).toBe(false);
    expect(t.isSeason).toBe(true);
  });

  it('does not flag suited or honor tiles as bonus', () => {
    for (const suit of ['bamboo', 'characters', 'dots', 'winds', 'dragons'] as const) {
      expect(new Tile(suit, 1).isBonus).toBe(false);
    }
  });
});

describe('sprite naming', () => {
  it('maps numbered suits to tile_{suit}_{rank}.png', () => {
    expect(spriteFileName('bamboo', 1)).toBe('tile_bamboo_1.png');
    expect(spriteFileName('characters', 9)).toBe('tile_characters_9.png');
    expect(spriteFileName('dots', 5)).toBe('tile_dots_5.png');
  });

  it('maps winds to tile_wind_{name}.png', () => {
    expect(spriteFileName('winds', 1)).toBe('tile_wind_east.png');
    expect(spriteFileName('winds', 2)).toBe('tile_wind_south.png');
    expect(spriteFileName('winds', 3)).toBe('tile_wind_west.png');
    expect(spriteFileName('winds', 4)).toBe('tile_wind_north.png');
  });

  it('maps dragons to tile_dragon_{name}.png', () => {
    expect(spriteFileName('dragons', 1)).toBe('tile_dragon_red.png');
    expect(spriteFileName('dragons', 2)).toBe('tile_dragon_green.png');
    expect(spriteFileName('dragons', 3)).toBe('tile_dragon_white.png');
  });

  it('maps flowers and seasons to tile_{suit}_{rank}.png', () => {
    expect(spriteFileName('flowers', 1)).toBe('tile_flowers_1.png');
    expect(spriteFileName('seasons', 4)).toBe('tile_seasons_4.png');
  });

  it('exposes the wind and dragon name tables', () => {
    expect(WIND_NAMES).toEqual(['east', 'south', 'west', 'north']);
    expect(DRAGON_NAMES).toEqual(['red', 'green', 'white']);
  });

  it('exposes rank ranges per suit', () => {
    expect(SUIT_RANK_RANGE.bamboo).toEqual([1, 9]);
    expect(SUIT_RANK_RANGE.winds).toEqual([1, 4]);
    expect(SUIT_RANK_RANGE.dragons).toEqual([1, 3]);
    expect(SUIT_RANK_RANGE.flowers).toEqual([1, 4]);
  });

  it('throws on invalid wind/dragon ranks in spriteToken', () => {
    expect(() => spriteToken('winds', 0)).toThrow();
    expect(() => spriteToken('dragons', 9)).toThrow();
  });
});

describe('Tile render sprite selection', () => {
  it('uses the face sprite when face-up', () => {
    const t = new Tile('bamboo', 2);
    expect(t.renderSpriteFile).toBe('tile_bamboo_2.png');
  });

  it('uses the back sprite when face-down', () => {
    const t = new Tile('bamboo', 2, { isHidden: true });
    expect(t.renderSpriteFile).toBe(TILE_BACK_FILE);
  });

  it('withHidden returns a copy with the new hidden flag', () => {
    const t = new Tile('dots', 7);
    const hidden = t.withHidden(true);
    expect(hidden.isHidden).toBe(true);
    expect(hidden.id).toBe(t.id);
    expect(t.isHidden).toBe(false); // original unchanged
  });
});

describe('Tile equality and label', () => {
  it('equals compares suit and rank', () => {
    const a = new Tile('bamboo', 3);
    const b = new Tile('bamboo', 3);
    const c = new Tile('bamboo', 4);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it('produces a human-readable label', () => {
    expect(new Tile('bamboo', 5).label).toBe('Bamboo 5');
    expect(new Tile('winds', 1).label).toBe('Winds 1');
    expect(new Tile('flowers', 2).label).toBe('Flowers 2');
  });
});
