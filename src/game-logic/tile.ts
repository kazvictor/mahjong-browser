/**
 * Tile — immutable Mahjong tile identity.
 *
 * This module is DOM-free and canvas-free so it can be unit tested headlessly
 * (Vitest + jsdom). It owns the *identity* of a tile (suit, rank, bonus
 * classification) and the mapping from that identity to the sprite asset that
 * renders it. Rendering itself lives in @rendering/tile-renderer.
 *
 * A full Mahjong set is 144 tiles: 108 suited (Dots/Bamboo/Characters × 1-9 ×
 * 4 copies), 28 honors (Winds × 4 × 4, Dragons × 3 × 4), and 8 bonus tiles
 * (Flowers × 4, Seasons × 4). The 4 copies of each face share one sprite, so
 * the asset set is 42 unique faces + a generic back.
 */

/** The suits a Mahjong tile can belong to. */
export type Suit =
  | 'bamboo'
  | 'characters'
  | 'dots'
  | 'winds'
  | 'dragons'
  | 'flowers'
  | 'seasons';

/** Rank semantics per suit (see {@link Tile.rank}). */
export const SUIT_RANK_RANGE: Readonly<Record<Suit, readonly [number, number]>> = {
  bamboo: [1, 9],
  characters: [1, 9],
  dots: [1, 9],
  winds: [1, 4],
  dragons: [1, 3],
  flowers: [1, 4],
  seasons: [1, 4],
};

/** The four wind directions, indexed by rank (1 = East). */
export const WIND_NAMES: readonly ['east', 'south', 'west', 'north'] = [
  'east',
  'south',
  'west',
  'north',
];

/** The three dragon colors, indexed by rank (1 = Red). */
export const DRAGON_NAMES: readonly ['red', 'green', 'white'] = ['red', 'green', 'white'];

/** Suits that are bonus tiles (flowers/seasons). */
const BONUS_SUITS: ReadonlySet<Suit> = new Set<Suit>(['flowers', 'seasons']);

/**
 * Map a suit + rank to the sprite filename token (without the `tile_` prefix
 * or `.png` extension). Winds and dragons use their names; everything else
 * uses the numeric rank.
 *
 * @example
 *   spriteToken('bamboo', 1)  // 'bamboo_1'
 *   spriteToken('winds', 1)   // 'wind_east'
 *   spriteToken('dragons', 2) // 'dragon_green'
 */
export function spriteToken(suit: Suit, rank: number): string {
  switch (suit) {
    case 'winds': {
      const name = WIND_NAMES[rank - 1];
      if (!name) throw new Error(`Invalid wind rank ${rank}.`);
      return `wind_${name}`;
    }
    case 'dragons': {
      const name = DRAGON_NAMES[rank - 1];
      if (!name) throw new Error(`Invalid dragon rank ${rank}.`);
      return `dragon_${name}`;
    }
    default:
      return `${suit}_${rank}`;
  }
}

/** The canonical sprite file name for a tile face, e.g. `tile_bamboo_1.png`. */
export function spriteFileName(suit: Suit, rank: number): string {
  return `tile_${spriteToken(suit, rank)}.png`;
}

/**
 * The id token for a tile: the suit plus a name/rank discriminator, e.g.
 * `dots-5`, `winds-east`, `flowers-1`. Used to build the default tile id.
 */
function idToken(suit: Suit, rank: number): string {
  switch (suit) {
    case 'winds': {
      const name = WIND_NAMES[rank - 1];
      if (!name) throw new Error(`Invalid wind rank ${rank}.`);
      return name;
    }
    case 'dragons': {
      const name = DRAGON_NAMES[rank - 1];
      if (!name) throw new Error(`Invalid dragon rank ${rank}.`);
      return name;
    }
    default:
      return String(rank);
  }
}

/** The sprite file name for the generic face-down back. */
export const TILE_BACK_FILE = 'tile-back.png';

/** Options accepted by the {@link Tile} constructor. */
export interface TileOptions {
  /** Optional explicit id; defaults to `${suit}-${rank}`. */
  readonly id?: string;
  /** True when the tile is face-down (in the wall or an opponent's hand). */
  readonly isHidden?: boolean;
}

/**
 * An immutable Mahjong tile.
 *
 * Instances are cheap and intended to be shared; the 144-tile wall holds 144
 * distinct instances (one per physical tile) so each can carry its own
 * `isHidden` flag, but the 4 copies of a face share the same sprite.
 */
export class Tile {
  /** Stable unique id, e.g. `dots-5`, `winds-east`, `flowers-1`. */
  readonly id: string;
  readonly suit: Suit;
  /** 1..9 for bamboo/characters/dots; 1..4 winds; 1..3 dragons; 1..4 flowers/seasons. */
  readonly rank: number;
  /** True for flower/season bonus tiles. */
  readonly isBonus: boolean;
  /** True specifically for flower tiles. */
  readonly isFlower: boolean;
  /** True specifically for season tiles. */
  readonly isSeason: boolean;
  /** True when the tile is face-down (in the wall or an opponent's hand). */
  readonly isHidden: boolean;

  constructor(suit: Suit, rank: number, options: TileOptions = {}) {
    const [min, max] = SUIT_RANK_RANGE[suit];
    if (!Number.isInteger(rank) || rank < min || rank > max) {
      throw new Error(
        `Invalid rank ${rank} for suit "${suit}" (expected ${min}..${max}).`,
      );
    }
    this.suit = suit;
    this.rank = rank;
    this.isBonus = BONUS_SUITS.has(suit);
    this.isFlower = suit === 'flowers';
    this.isSeason = suit === 'seasons';
    this.isHidden = options.isHidden ?? false;
    this.id = options.id ?? `${suit}-${idToken(suit, rank)}`;
  }

  /** The sprite file name for this tile's face (ignores `isHidden`). */
  get spriteFile(): string {
    return spriteFileName(this.suit, this.rank);
  }

  /** The sprite file name to render: the back when hidden, else the face. */
  get renderSpriteFile(): string {
    return this.isHidden ? TILE_BACK_FILE : this.spriteFile;
  }

  /** A human-readable label, e.g. `Bamboo 5`, `Wind East`, `Flower 1`. */
  get label(): string {
    const suitLabel = this.suit.charAt(0).toUpperCase() + this.suit.slice(1);
    return `${suitLabel} ${this.rank}`;
  }

  /** A copy of this tile with a different hidden flag (identity otherwise unchanged). */
  withHidden(isHidden: boolean): Tile {
    return new Tile(this.suit, this.rank, { id: this.id, isHidden });
  }

  /** Structural equality against another tile (same suit + rank). */
  equals(other: Tile): boolean {
    return this.suit === other.suit && this.rank === other.rank;
  }
}
