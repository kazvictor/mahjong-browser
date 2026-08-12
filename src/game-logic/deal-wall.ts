/**
 * Dealing-level Wall — dice break, live/dead wall split, and dealing draws.
 *
 * This is the layer the dealing algorithm operates on. It is self-contained
 * (depends only on the stable {@link Tile} identity class) so it does not couple
 * to the deck-primitive module (`wall.ts`), which is owned by the tile-asset
 * system. It adds the Hong Kong Mahjong dealing concerns:
 *   - a 2d6 dice roll that selects the wall break point,
 *   - the split of the shuffled wall into a drawable "live wall" and a reserved
 *     "dead wall" (kong/flower replacements),
 *   - draws that consume the live wall and replacements that consume the dead
 *     wall first.
 *
 * DOM-free and canvas-free so it can be unit tested headlessly.
 */
import { Tile } from './tile';

/** Number of tiles in a full Mahjong wall. */
export const TOTAL_TILES = 144;

/** The wall is laid out as this many parallel rows. */
export const WALL_ROWS = 4;

/** Tiles per row when the wall is built (144 / 4). */
export const TILES_PER_ROW = 36;

/**
 * Number of tiles reserved for the dead wall. These are the last tiles before
 * the break point and are not drawn normally — they back kong replacements and
 * flower/season bonuses.
 */
export const DEAD_WALL_SIZE = 14;

/** Number of players at the table. */
export const PLAYER_COUNT = 4;

/** Starting concealed hand size per player after the initial deal. */
export const INITIAL_HAND_SIZE = 13;

/** A deterministic PRNG (mulberry32) so a seed reproduces the same shuffle. */
export type Rng = () => number;

/** The tile type the wall deals out. */
export type WallTile = Tile;

/** Create a mulberry32 PRNG from a 32-bit seed. */
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

/** The four numbered suits, each contributing 9 ranks × 4 copies = 36 tiles. */
const NUMBERED_SUITS: readonly Tile['suit'][] = ['bamboo', 'characters', 'dots'];
/** Honor suits: winds (4 ranks) and dragons (3 ranks), each × 4 copies. */
const HONOR_SUITS: readonly Tile['suit'][] = ['winds', 'dragons'];
/** Bonus suits: flowers and seasons, each 4 ranks × 1 copy = 4 tiles. */
const BONUS_SUITS: readonly Tile['suit'][] = ['flowers', 'seasons'];
/** Number of copies of each suited/honor tile face in a full set. */
const SUITED_COPIES = 4;

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

/** Roll `count` dice of `sides` faces using the given RNG and return their sum. */
export function rollDice(rng: Rng | SeededRng, count = 2, sides = 6): number {
  const next = typeof rng === 'function' ? rng : () => rng.next();
  let sum = 0;
  for (let i = 0; i < count; i++) {
    sum += Math.floor(next() * sides) + 1;
  }
  return sum;
}

/**
 * A seeded PRNG wrapper exposing float and integer draws. Deterministic: the
 * same seed always yields the same sequence, so a deal is reproducible.
 */
export class SeededRng {
  private readonly rng: Rng;

  constructor(seed: number) {
    this.rng = mulberry32(seed);
  }

  /** A float in [0, 1). */
  next(): number {
    return this.rng();
  }

  /** An integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number {
    return Math.floor(this.rng() * maxExclusive);
  }
}

/** Chunk a flat tile list into `rows` of `perRow` tiles (last row may be short). */
function buildRows(tiles: readonly Tile[], perRow: number): Tile[][] {
  const rows: Tile[][] = [];
  for (let i = 0; i < tiles.length; i += perRow) {
    rows.push(tiles.slice(i, i + perRow));
  }
  return rows;
}

/**
 * Split the shuffled wall into a live wall and a dead wall around `breakIndex`.
 *
 * Convention (Hong Kong Mahjong): the live wall is drawn starting at the break
 * point and runs forward (with wraparound); the 14 tiles immediately preceding
 * the break point form the dead wall. Together they cover all 144 tiles with no
 * overlap.
 */
function computeBreak(
  tiles: readonly Tile[],
  breakIndex: number,
): { liveWall: Tile[]; deadWall: Tile[] } {
  const n = tiles.length;
  const liveCount = n - DEAD_WALL_SIZE;
  const liveWall: Tile[] = new Array(liveCount);
  for (let i = 0; i < liveCount; i++) {
    liveWall[i] = tiles[(breakIndex + i) % n] as Tile;
  }
  const deadWall: Tile[] = new Array(DEAD_WALL_SIZE);
  for (let i = 1; i <= DEAD_WALL_SIZE; i++) {
    deadWall[DEAD_WALL_SIZE - i] = tiles[(breakIndex - i + n) % n] as Tile;
  }
  return { liveWall, deadWall };
}

export interface WallOptions {
  /** PRNG seed. Omit for a non-deterministic game; provide for reproducible deals. */
  seed?: number;
  /** Inject a pre-built RNG (overrides `seed`). */
  rng?: Rng;
  /** Inject a pre-built tile set (mostly for tests). */
  tiles?: readonly Tile[];
  /** Force a wall break index (overrides the dice roll; mostly for tests). */
  breakIndex?: number;
  /** When false, the injected `tiles` are used in order (no shuffle). Default true. */
  shuffle?: boolean;
}

/**
 * A shuffled Mahjong wall broken into a live wall and a dead wall. Drawing only
 * ever consumes the live wall; kong/flower replacements consume the dead wall.
 */
export class Wall {
  /** The RNG that produced this wall (so callers can replay the same deal). */
  readonly rng: Rng;

  /** The full 144 tiles in shuffled order (immutable view). */
  readonly tiles: readonly Tile[];

  /** The wall laid out as `WALL_ROWS` rows of `TILES_PER_ROW` for rendering. */
  readonly rows: readonly (readonly Tile[])[];

  /** Sum of the 2d6 dice roll that selected the break point. */
  readonly diceTotal: number;

  /** Linear index (0..143) in `tiles` where the wall breaks. */
  readonly breakIndex: number;

  private liveWall: Tile[];
  private deadWall: Tile[];

  constructor(options: WallOptions = {}) {
    const rng = options.rng ?? mulberry32(options.seed ?? Date.now());
    this.rng = rng;

    const source = options.tiles ? options.tiles.slice() : buildFullDeck();
    if (!options.tiles && source.length !== TOTAL_TILES) {
      throw new Error(`Wall requires ${TOTAL_TILES} tiles; got ${source.length}.`);
    }
    this.tiles = options.shuffle === false ? source : shuffle(source, rng);
    this.rows = buildRows(this.tiles, TILES_PER_ROW);

    if (options.breakIndex !== undefined) {
      this.breakIndex = options.breakIndex;
      this.diceTotal = Math.max(1, Math.round(options.breakIndex / 2));
    } else {
      this.diceTotal = rollDice(rng);
      // Break point = dice sum × 2 tiles (each stack is 2 tiles). Sum is 2..12,
      // so the break lands at index 4..24 — inside the 144-tile wall.
      this.breakIndex = this.diceTotal * 2;
    }

    const segments = computeBreak(this.tiles, this.breakIndex);
    this.liveWall = segments.liveWall;
    this.deadWall = segments.deadWall;
  }

  /** Tiles remaining in the drawable live wall. */
  get liveRemaining(): number {
    return this.liveWall.length;
  }

  /** Tiles remaining in the reserved dead wall. */
  get deadRemaining(): number {
    return this.deadWall.length;
  }

  /** Immutable view of the remaining live wall. */
  get liveWallTiles(): readonly Tile[] {
    return this.liveWall;
  }

  /** Immutable view of the remaining dead wall. */
  get deadWallTiles(): readonly Tile[] {
    return this.deadWall;
  }

  /** Draw a single tile from the front of the live wall. */
  draw(): Tile {
    const tile = this.liveWall.shift();
    if (!tile) {
      throw new Error('Cannot draw: live wall is empty.');
    }
    return tile;
  }

  /**
   * Draw a replacement tile for a kong or flower/season bonus. These come from
   * the dead wall first, falling back to the live wall if it is exhausted.
   */
  drawReplacement(): Tile {
    const tile = this.deadWall.shift() ?? this.liveWall.shift();
    if (!tile) {
      throw new Error('Cannot draw replacement: both walls are empty.');
    }
    return tile;
  }

  /** Draw `count` tiles in order from the live wall. */
  drawN(count: number): Tile[] {
    const out: Tile[] = new Array(count);
    for (let i = 0; i < count; i++) {
      out[i] = this.draw();
    }
    return out;
  }
}

/** Build a standard {@link Wall} (144 tiles, 4 rows of 36, 14-tile dead wall). */
export function buildStandardWall(seed?: number): Wall {
  return new Wall({ seed });
}
