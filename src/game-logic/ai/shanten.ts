/**
 * Shanten calculator for standard Mahjong hands.
 *
 * Shanten is the minimum number of useful tile changes required to reach a
 * tenpai (one tile away from winning) hand. 0-shanten means tenpai; -1 means
 * the hand is already a winning hand (possible for a 14-tile hand). This is
 * the core of the tile-efficiency AI: it tells us how close any hand is to
 * completion so the discard decision can prioritise keeping the hand on the
 * fastest path to win.
 *
 * A winning hand is four melds (pung/chow/kong) plus one pair. For each way to
 * decompose the hand into blocks we count complete melds (m), two-tile partial
 * blocks — taatsu (consecutive or one-gap chow shapes) and pairs (t and p) —
 * then compute:
 *
 *   shanten = 8 - 2·m - min(partials, 4 - m) - eye
 *
 * where `partials = (p - eye) + t`, `eye` is 1 when a pair is reserved as the
 * hand's pair (otherwise 0), and the partial count is capped so we never credit
 * more blocks than can become the four melds. The search enumerates every way
 * to partition the suited ranks (into chows, pungs, pairs, taatsu and singles)
 * and the honor ranks (pairs/pungs only), keeps only Pareto-optimal block
 * combinations, and returns the minimum shanten across them.
 *
 * This module is DOM-free and deterministically testable headlessly.
 */
import type { Suit, Tile } from '../types';

/** Number of tile *types* in the standard 144-tile set (34 unique faces). */
export const TOTAL_TILE_TYPES = 34;

/** Winds occupy indices 27..30, dragons 31..33. */
export const HONOR_START_INDEX = 27;

/** The three numbered suits, in canonical index order. */
const SUITED_SUITS: readonly Suit[] = ['bamboo', 'characters', 'dots'];

/**
 * Map a (suit, rank) pair to its index in the 34-tile-type space.
 *
 * 0..8 bamboo, 9..17 characters, 18..26 dots, 27..30 winds, 31..33 dragons.
 *
 * @throws {Error} for bonus (flower/season) tiles, which have no index.
 */
export function tileTypeIndex(suit: Suit, rank: number): number {
  const suitOffset = SUITED_SUITS.indexOf(suit);
  if (suitOffset !== -1) {
    return suitOffset * 9 + (rank - 1);
  }
  if (suit === 'winds') {
    return HONOR_START_INDEX + (rank - 1);
  }
  if (suit === 'dragons') {
    return HONOR_START_INDEX + 4 + (rank - 1);
  }
  throw new Error(`Bonus tile ${suit}-${rank} has no shanten index.`);
}

/**
 * Build a 34-length count vector (copies of each tile type) from a hand.
 * Bonus tiles (flowers/seasons) are ignored — they are set aside and never
 * part of the 4-meld + pair construction.
 */
export function handToCounts(tiles: readonly Tile[]): number[] {
  const counts = new Array<number>(TOTAL_TILE_TYPES).fill(0);
  for (const tile of tiles) {
    if (tile.suit === 'flowers' || tile.suit === 'seasons') continue;
    counts[tileTypeIndex(tile.suit, tile.rank)]! += 1;
  }
  return counts;
}

/** A block state: complete melds (m), taatsu (t), pairs (p). */
export interface BlockState {
  readonly m: number;
  readonly t: number;
  readonly p: number;
}

/** Keep only Pareto-optimal states (no other state is ≥ on all three axes). */
function prune(states: readonly BlockState[]): BlockState[] {
  const kept: BlockState[] = [];
  outer: for (const a of states) {
    for (const b of states) {
      if (a === b) continue;
      // b dominates a if b is >= a everywhere and strictly > somewhere.
      const dominates =
        b.m >= a.m && b.t >= a.t && b.p >= a.p && (b.m > a.m || b.t > a.t || b.p > a.p);
      if (dominates) continue outer;
    }
    kept.push(a);
  }
  return kept;
}

/**
 * Enumerate every way to partition one numbered suit (9 ranks, counts 0..4
 * each) into melds (pung/chow), taatsu (consecutive or one-gap two-tile
 * shapes), pairs and singles. Returns the Pareto-optimal (m, t, p) states.
 */
function enumerateSuit(counts: readonly number[]): BlockState[] {
  const results = new Set<string>();
  const memo = new Set<string>();

  const dfs = (pos: number, c: number[], m: number, t: number, p: number): void => {
    if (pos >= 9) {
      results.add(`${m},${t},${p}`);
      return;
    }
    const memoKey = `${pos}|${c.join(',')}|${m}|${t}|${p}`;
    if (memo.has(memoKey)) return;
    memo.add(memoKey);

    if (c[pos] === 0) {
      dfs(pos + 1, c, m, t, p);
      return;
    }
    // Pung: three identical.
    if (c[pos]! >= 3) {
      c[pos]! -= 3;
      dfs(pos, c, m + 1, t, p);
      c[pos]! += 3;
    }
    // Chow: three consecutive.
    if (pos <= 6 && c[pos]! >= 1 && c[pos + 1]! >= 1 && c[pos + 2]! >= 1) {
      c[pos]! -= 1;
      c[pos + 1]! -= 1;
      c[pos + 2]! -= 1;
      dfs(pos, c, m + 1, t, p);
      c[pos]! += 1;
      c[pos + 1]! += 1;
      c[pos + 2]! += 1;
    }
    // Pair.
    if (c[pos]! >= 2) {
      c[pos]! -= 2;
      dfs(pos, c, m, t, p + 1);
      c[pos]! += 2;
    }
    // Consecutive taatsu (e.g. 45).
    if (pos <= 7 && c[pos]! >= 1 && c[pos + 1]! >= 1) {
      c[pos]! -= 1;
      c[pos + 1]! -= 1;
      dfs(pos + 1, c, m, t + 1, p);
      c[pos]! += 1;
      c[pos + 1]! += 1;
    }
    // One-gap taatsu / kanchan (e.g. 46).
    if (pos <= 6 && c[pos]! >= 1 && c[pos + 2]! >= 1) {
      c[pos]! -= 1;
      c[pos + 2]! -= 1;
      dfs(pos + 1, c, m, t + 1, p);
      c[pos]! += 1;
      c[pos + 2]! += 1;
    }
    // Single floating tile.
    c[pos]! -= 1;
    dfs(pos + 1, c, m, t, p);
    c[pos]! += 1;
  };

  dfs(0, [...counts], 0, 0, 0);

  const states: BlockState[] = [];
  for (const key of results) {
    const [m, t, p] = key.split(',').map(Number);
    states.push({ m: m ?? 0, t: t ?? 0, p: p ?? 0 });
  }
  return prune(states);
}

/**
 * Every way a single honor rank (count 0..4) can be partitioned. Honors only
 * form pairs and pungs (never chows). Returns Pareto-optimal (m, t, p).
 */
function honorOptions(count: number): BlockState[] {
  switch (count) {
    case 0:
    case 1:
      return [{ m: 0, t: 0, p: 0 }];
    case 2:
      return [{ m: 0, t: 0, p: 1 }];
    case 3:
      // Either a pung, or a pair plus a floating tile.
      return [
        { m: 1, t: 0, p: 0 },
        { m: 0, t: 0, p: 1 },
      ];
    case 4:
      // A pung plus a float, or two pairs.
      return [
        { m: 1, t: 0, p: 0 },
        { m: 0, t: 0, p: 2 },
      ];
    default:
      return [{ m: 0, t: 0, p: 0 }];
  }
}

/** Shanten implied by a combined (m, t, p) block decomposition. */
function shantenFromState(m: number, t: number, p: number, extraMelds = 0): number {
  const totalM = m + extraMelds;
  let best = 8;
  for (let eye = 0; eye <= 1; eye += 1) {
    if (eye === 1 && p < 1) continue;
    const partials = p - eye + t;
    const effectiveBlocks = Math.min(partials, 4 - totalM);
    const shanten = 8 - 2 * totalM - effectiveBlocks - eye;
    if (shanten < best) best = shanten;
  }
  return best;
}

/**
 * Calculate the shanten of a hand given as a 34-length count vector.
 *
 * Returns -1 for a winning 14-tile hand, 0 for tenpai, and positive values
 * for hands further from completion. The result is exact: the full block-
 * decomposition space is searched and the minimum shanten returned.
 *
 * `extraMelds` counts melds already exposed (pungs/kongs/chows called from a
 * discard). Each complete meld reduces shanten by 2, so a hand with 3 exposed
 * melds plus a concealed pair + taatsu is tenpai (0 shanten) rather than 2.
 */
export function calculateShanten(counts: readonly number[], extraMelds = 0): number {
  if (counts.length !== TOTAL_TILE_TYPES) {
    throw new Error(
      `calculateShanten expects a ${TOTAL_TILE_TYPES}-length count vector, got ${counts.length}.`,
    );
  }

  // Per-suit decompositions.
  const suitStates: BlockState[][] = [];
  for (let s = 0; s < 3; s += 1) {
    const rankCounts = Array.from({ length: 9 }, (_, r) => counts[s * 9 + r] ?? 0);
    suitStates.push(enumerateSuit(rankCounts));
  }

  // Honor decompositions (7 honor ranks).
  const honorStates: BlockState[][] = [];
  for (let h = 0; h < 7; h += 1) {
    const count = counts[HONOR_START_INDEX + h] ?? 0;
    honorStates.push(honorOptions(count));
  }

  // Combine every suit with every honor state, keeping Pareto-optimal states.
  let combined: BlockState[] = [{ m: 0, t: 0, p: 0 }];
  for (const states of [...suitStates, ...honorStates]) {
    const next: BlockState[] = [];
    for (const a of combined) {
      for (const b of states) {
        next.push({ m: a.m + b.m, t: a.t + b.t, p: a.p + b.p });
      }
    }
    combined = prune(next);
  }

  let best = 8;
  for (const s of combined) {
    const shanten = shantenFromState(s.m, s.t, s.p, extraMelds);
    if (shanten < best) best = shanten;
  }
  return best;
}

/**
 * Convenience wrapper: compute shanten directly from a hand of concealed
 * tiles (bonus tiles ignored). `extraMelds` accounts for exposed melds.
 * Equivalent to `calculateShanten(handToCounts(hand), extraMelds)`.
 */
export function shantenOfHand(hand: readonly Tile[], extraMelds = 0): number {
  return calculateShanten(handToCounts(hand), extraMelds);
}
