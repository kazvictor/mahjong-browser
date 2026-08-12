/**
 * TileWall & Wall — the 144-tile Mahjong deck.
 *
 * DOM-free and canvas-free so it can be unit tested headlessly. This module
 * owns deck construction (exactly 144 tiles), seeded shuffling, drawing, and
 * the wall/row layout the renderer consumes.
 *
 * Two classes are exported to serve two consumers:
 *   - {@link TileWall} — the primitive 144-tile deck (shuffle + draw). This is
 *     the tile-asset-system surface.
 *   - {@link Wall} — the full game wall: a live wall + a dead wall (kong /
 *     bonus replacements), laid out as 4 rows of 36 for rendering. This is
 *     what the dealing algorithm and dealing animation consume.
 *
 * The dealing *pattern* (dice break, 4-tile rounds) belongs to the dealing
 * algorithm task; this module provides the deck/wall primitives it builds on.
 */

import { Tile, type Suit } from './tile';

/** The four numbered suits, each contributing 9 ranks × 4 copies = 36 tiles. */
const NUMBERED_SUITS: readonly Suit[] = ['bamboo', 'characters', 'dots'];

/** Honor suits: winds (4 ranks) and dragons (3 ranks), each × 4 copies. */
const HONOR_SUITS: readonly Suit[] = ['winds', 'dragons'];

/** Bonus suits: flowers and seasons, each 4 ranks × 1 copy = 4 tiles. */
const BONUS_SUITS: readonly Suit[] = ['flowers', 'seasons'];

/** Number of copies of each suited/honor tile face in a full set. */
const SUITED_COPIES = 4;

/** Total tile count in a full Mahjong set. */
export const TOTAL_TILES = 144;

/** Number of wall rows the live wall is laid out in. */
export const WALL_ROWS = 4;

/** Number of tiles per wall row (144 live tiles ÷ 4 rows). */
export const TILES_PER_ROW = 36;

/** Number of tiles reserved as the dead wall (kong / bonus replacements). */
export const DEAD_WALL_SIZE = 14;

/** Number of players at the table. */
export const PLAYER_COUNT = 4;

/** Number of concealed tiles each player holds after the opening deal. */
export const INITIAL_HAND_SIZE = 13;

/** The tile type the wall deals out. */
export type WallTile = Tile;

/** A deterministic PRNG (mulberry32) so a seed reproduces the same shuffle. */
export type Rng = () => number;

/** Default seed used when the caller does not supply one. */
export const DEFAULT_SEED = 0x9e3779b9;

/**
 * Create a mulberry32 PRNG from a 32-bit seed. Deterministic: the same seed
 * always yields the same sequence, so a deal is reproducible for replay.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle in place using the given RNG. */
export function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = items[i];
    items[i] = items[j]!;
    items[j] = tmp!;
  }
  return items;
}

/** Build the canonical 144-tile deck in a fixed (unshuffled) order. */
export function buildFullDeck(): Tile[] {
  const deck: Tile[] = [];

  for (const suit of NUMBERED_SUITS) {
    for (let rank = 1; rank <= 9; rank++) {
      for (let copy = 0; copy < SUITED_COPIES; copy++) {
        deck.push(new Tile(suit, rank, { id: `${suit}-${rank}-${copy}` }));
      }
    }
  }

  for (const suit of HONOR_SUITS) {
    const maxRank = suit === 'winds' ? 4 : 3;
    for (let rank = 1; rank <= maxRank; rank++) {
      for (let copy = 0; copy < SUITED_COPIES; copy++) {
        deck.push(new Tile(suit, rank, { id: `${suit}-${rank}-${copy}` }));
      }
    }
  }

  for (const suit of BONUS_SUITS) {
    for (let rank = 1; rank <= 4; rank++) {
      deck.push(new Tile(suit, rank, { id: `${suit}-${rank}` }));
    }
  }

  return deck;
}

/** Split an array into chunks of at most `size` elements. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * The 144-tile wall.
 *
 * Tiles are drawn from the *top* of the wall (the last element of the array),
 * matching the architecture's "top = last index" convention. The wall is
 * immutable after construction except for drawing, which pops from the top.
 */
export class TileWall {
  /** Remaining tiles; the top (next to draw) is the last element. */
  private readonly tiles: Tile[];
  /** The seed used to shuffle this wall (for replay). */
  readonly seed: number;

  constructor(seed: number = DEFAULT_SEED) {
    this.seed = seed >>> 0;
    const deck = buildFullDeck();
    if (deck.length !== TOTAL_TILES) {
      throw new Error(`Deck built with ${deck.length} tiles; expected ${TOTAL_TILES}.`);
    }
    this.tiles = shuffle(deck, mulberry32(this.seed));
  }

  /** Number of tiles remaining in the wall. */
  get size(): number {
    return this.tiles.length;
  }

  /** True when the wall is empty. */
  get isEmpty(): boolean {
    return this.tiles.length === 0;
  }

  /** A read-only view of the remaining tiles (top = last element). */
  get remaining(): readonly Tile[] {
    return this.tiles;
  }

  /**
   * Draw the top tile from the wall.
   * @returns The drawn tile, or null when the wall is empty.
   */
  draw(): Tile | null {
    return this.tiles.pop() ?? null;
  }

  /**
   * Draw `count` tiles from the top of the wall.
   * @returns The drawn tiles in draw order (first drawn first).
   */
  drawMany(count: number): Tile[] {
    const drawn: Tile[] = [];
    for (let i = 0; i < count; i++) {
      const tile = this.draw();
      if (tile === null) break;
      drawn.push(tile);
    }
    return drawn;
  }

  /** Reset the wall to a freshly shuffled 144-tile deck with the same seed. */
  reset(): void {
    const deck = buildFullDeck();
    this.tiles.length = 0;
    this.tiles.push(...shuffle(deck, mulberry32(this.seed)));
  }
}

/** Options accepted by the {@link Wall} constructor. */
export interface WallOptions {
  /** Seed for the shuffle. Defaults to {@link DEFAULT_SEED}. */
  readonly seed?: number;
  /** Number of tiles reserved as the dead wall. Defaults to {@link DEAD_WALL_SIZE}. */
  readonly deadWallSize?: number;
}

/**
 * A seeded PRNG wrapper exposing float and integer draws.
 */
export class SeededRng {
  private readonly next: Rng;

  constructor(seed: number = DEFAULT_SEED) {
    this.next = mulberry32(seed);
  }

  /** A float in [0, 1). */
  nextFloat(): number {
    return this.next();
  }

  /** An integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
}

/**
 * Roll two six-sided dice and return their sum (2..12).
 * @param rng Optional RNG; defaults to Math.random.
 */
export function rollDice(rng: Rng = Math.random): number {
  const d1 = Math.floor(rng() * 6) + 1;
  const d2 = Math.floor(rng() * 6) + 1;
  return d1 + d2;
}

/**
 * The full game wall: a live wall plus a dead wall, laid out as 4 rows of 36
 * for rendering. The dead wall holds kong / bonus replacement tiles and is
 * drawn from only when a replacement is needed.
 */
export class Wall {
  readonly seed: number;
  readonly deadWallSize: number;
  /** The live wall, top (next to draw) = last element. */
  private readonly live: Tile[];
  /** The dead wall, top (next to draw) = last element. */
  private readonly dead: Tile[];
  /** The live wall laid out as 4 rows of 36, for rendering. */
  readonly rows: readonly Tile[][];

  constructor(options: WallOptions = {}) {
    this.seed = (options.seed ?? DEFAULT_SEED) >>> 0;
    this.deadWallSize = options.deadWallSize ?? DEAD_WALL_SIZE;
    const deck = buildFullDeck();
    if (deck.length !== TOTAL_TILES) {
      throw new Error(`Deck built with ${deck.length} tiles; expected ${TOTAL_TILES}.`);
    }
    const shuffled = shuffle(deck, mulberry32(this.seed));
    this.dead = shuffled.slice(shuffled.length - this.deadWallSize);
    this.live = shuffled.slice(0, shuffled.length - this.deadWallSize);
    this.rows = chunk(this.live, TILES_PER_ROW);
  }

  /** Number of tiles remaining in the live wall. */
  get size(): number {
    return this.live.length;
  }

  /** True when the live wall is empty. */
  get isEmpty(): boolean {
    return this.live.length === 0;
  }

  /** A read-only view of the live wall (top = last element). */
  get remaining(): readonly Tile[] {
    return this.live;
  }

  /**
   * Draw the top tile from the live wall.
   * @throws when the live wall is empty.
   */
  draw(): Tile {
    const tile = this.live.pop();
    if (tile === undefined) {
      throw new Error('Cannot draw from an empty live wall.');
    }
    return tile;
  }

  /**
   * Draw a replacement tile: from the dead wall first, then the live wall.
   * @throws when both walls are empty.
   */
  drawReplacement(): Tile {
    const tile = this.dead.pop() ?? this.live.pop();
    if (tile === undefined) {
      throw new Error('Cannot draw a replacement from an empty wall.');
    }
    return tile;
  }
}

/** Build a standard {@link Wall} (144 tiles, 4 rows of 36, 14-tile dead wall). */
export function buildStandardWall(seed?: number): Wall {
  return new Wall({ seed });
}
