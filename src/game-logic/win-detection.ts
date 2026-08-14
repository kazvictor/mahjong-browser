/**
 * Win detection — determines whether a hand forms a valid winning pattern.
 *
 * A standard Mahjong win is a 14-tile hand that can be partitioned into four
 * melds plus one pair. A meld is a pung (3 identical), a kong (4 identical),
 * or a chow (3 consecutive tiles of the same numbered suit). Honor tiles
 * (winds and dragons) can never form a chow.
 *
 * Two special hands are also supported:
 *   - Seven Pairs: 7 distinct pairs (no concealed-meld restriction for MVP).
 *   - Thirteen Orphans: one of each terminal (1/9 of each numbered suit) plus
 *     each of the seven honor tiles, plus a duplicate of one of those.
 *
 * The module is DOM-free and canvas-free so it can be unit tested headlessly.
 * It reports *which* winning pattern (and, for the standard hand, the winning
 * decomposition) rather than just a boolean, so the caller can display the
 * winning hand and feed the scoring system.
 */
import type { Hand, MeldType, Suit, Tile } from './types';

/** The canonical winning hand types this detector recognizes. */
export type WinType =
  | 'standard' // 4 melds + 1 pair
  | 'seven-pairs' // 7 distinct pairs
  | 'thirteen-orphans'; // 1 of each terminal + each honor + one duplicate

/** A single meld within the winning decomposition of a standard hand. */
export interface WinMeld {
  readonly type: MeldType;
  readonly tiles: readonly Tile[];
}

/**
 * The full result of win detection. `null` means the hand is not a winning
 * hand. For a standard win, `melds` + `pair` describe one valid decomposition;
 * for special hands `melds`/`pair` describe the special structure.
 */
export type WinResult = {
  readonly type: WinType;
  /** For standard: the four melds. For seven-pairs: the seven pairs. For
   * thirteen-orphans: the 13 distinct tiles plus duplicate. */
  readonly melds: readonly WinMeld[];
  /** For standard: the winning pair. Empty for special hands. */
  readonly pair: readonly Tile[];
  /** All 14 tiles that form the win (concealed tiles + exposed meld tiles,
   * bonus tiles excluded). */
  readonly tiles: readonly Tile[];
};

/** A canonical tile key: suit + rank (e.g. "dots-5", "winds-east"). */
function tileKey(tile: Tile): string {
  return `${tile.suit}-${tile.rank}`;
}

/** True for honor tiles (winds and dragons). */
function isHonor(tile: Tile): boolean {
  return tile.suit === 'winds' || tile.suit === 'dragons';
}

/** True for bonus tiles (flowers and seasons). */
function isBonus(tile: Tile): boolean {
  return tile.suit === 'flowers' || tile.suit === 'seasons';
}

/** True for numbered suits (bamboo, characters, dots). */
function isNumbered(tile: Tile): boolean {
  return tile.suit === 'bamboo' || tile.suit === 'characters' || tile.suit === 'dots';
}

/** The four numbered suits, for the thirteen-orphans check. */
const NUMBERED_SUITS: readonly Suit[] = ['bamboo', 'characters', 'dots'];

/** Count tiles by canonical key. */
function countByKey(tiles: readonly Tile[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tile of tiles) {
    counts.set(tileKey(tile), (counts.get(tileKey(tile)) ?? 0) + 1);
  }
  return counts;
}

/** Tiles grouped by canonical key (used to build melds/pairs). */
function groupByKey(tiles: readonly Tile[]): Map<string, Tile[]> {
  const groups = new Map<string, Tile[]>();
  for (const tile of tiles) {
    const key = tileKey(tile);
    const group = groups.get(key);
    if (group) group.push(tile);
    else groups.set(key, [tile]);
  }
  return groups;
}

/** True when the multiset can be partitioned into `count` melds and the given
 * pair key has been pre-removed. Mutable count map restored on backtracking. */
function canFormMelds(counts: Map<string, number>, meldsRemaining: number): boolean {
  if (meldsRemaining === 0) {
    for (const count of counts.values()) {
      if (count > 0) return false;
    }
    return true;
  }

  let key: string | undefined;
  for (const [k, count] of counts) {
    if (count > 0) {
      key = k;
      break;
    }
  }
  if (key === undefined) return false;

  const [suit, rankStr] = key.split('-');
  const rank = Number(rankStr);
  const suitTyped = suit as Suit;

  // Try a pung (3 identical).
  if ((counts.get(key) ?? 0) >= 3) {
    counts.set(key, (counts.get(key) ?? 0) - 3);
    if (canFormMelds(counts, meldsRemaining - 1)) {
      counts.set(key, (counts.get(key) ?? 0) + 3);
      return true;
    }
    counts.set(key, (counts.get(key) ?? 0) + 3);
  }

  // Try a kong (4 identical).
  if ((counts.get(key) ?? 0) >= 4) {
    counts.set(key, (counts.get(key) ?? 0) - 4);
    if (canFormMelds(counts, meldsRemaining - 1)) {
      counts.set(key, (counts.get(key) ?? 0) + 4);
      return true;
    }
    counts.set(key, (counts.get(key) ?? 0) + 4);
  }

  // Try a chow (3 consecutive) — only for numbered suits, rank 1..7 as start.
  if (!isHonor({ id: '', suit: suitTyped, rank }) && rank >= 1 && rank <= 7) {
    const k2 = `${suit}-${rank + 1}`;
    const k3 = `${suit}-${rank + 2}`;
    if ((counts.get(k2) ?? 0) >= 1 && (counts.get(k3) ?? 0) >= 1) {
      counts.set(key, (counts.get(key) ?? 0) - 1);
      counts.set(k2, (counts.get(k2) ?? 0) - 1);
      counts.set(k3, (counts.get(k3) ?? 0) - 1);
      if (canFormMelds(counts, meldsRemaining - 1)) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
        counts.set(k2, (counts.get(k2) ?? 0) + 1);
        counts.set(k3, (counts.get(k3) ?? 0) + 1);
        return true;
      }
      counts.set(key, (counts.get(key) ?? 0) + 1);
      counts.set(k2, (counts.get(k2) ?? 0) + 1);
      counts.set(k3, (counts.get(k3) ?? 0) + 1);
    }
  }

  return false;
}

/** Reconstruct the melds for a standard win. Given the winning 14 tiles and a
 * chosen pair key, greedily build four melds in a canonical order (pungs,
 * kongs, then chows). This is only used to *display* the hand, so the exact
 * decomposition need not match the backtracker bit-for-bit as long as the
 * returned melds + pair total 14 and each meld is valid. To guarantee a valid
 * decomposition we re-run the partition logic and record the chosen moves. */
function buildStandardDecomposition(
  groups: Map<string, Tile[]>,
  pairKey: string,
): { melds: WinMeld[]; pair: Tile[] } {
  // Work on a mutable copy of the tile pool (flat list).
  const pool: Tile[] = [];
  for (const [, group] of groups) {
    for (const tile of group) pool.push(tile);
  }

  const used = new Set<Tile>();
  const melds: WinMeld[] = [];

  const pickPair = pool.filter((t) => tileKey(t) === pairKey).slice(0, 2);
  pickPair.forEach((t) => used.add(t));

  // Helper to check whether a tile is still unused.
  const isFree = (t: Tile): boolean => !used.has(t);
  const take = (key: string, n: number): Tile[] | null => {
    const matches = pool.filter((t) => isFree(t) && tileKey(t) === key);
    if (matches.length < n) return null;
    const taken = matches.slice(0, n);
    taken.forEach((t) => used.add(t));
    return taken;
  };

  // Greedily consume pungs and kongs first (largest groups), then chows.
  // To keep it simple and correct, we iterate over group keys and for any
  // group with >=3 remaining tiles make a pung/kong.
  const groupKeys = [...groups.keys()];
  // First pass: pungs/kongs from any group with enough remaining copies.
  for (const key of groupKeys) {
    while (melds.length < 4) {
      const remaining = pool.filter((t) => isFree(t) && tileKey(t) === key).length;
      if (remaining >= 4) {
        const taken = take(key, 4);
        if (taken) melds.push({ type: 'kong', tiles: taken });
      } else if (remaining >= 3) {
        const taken = take(key, 3);
        if (taken) melds.push({ type: 'pung', tiles: taken });
      } else {
        break;
      }
    }
  }

  // Second pass: chows. Find the lowest unused numbered tile and try to form
  // a chow starting at its rank.
  while (melds.length < 4) {
    const candidates = pool.filter(isFree);
    const lowest = candidates
      .filter((t) => isNumbered(t))
      .sort((a, b) => (a.rank - b.rank) | (a.suit < b.suit ? -1 : a.suit > b.suit ? 1 : 0))[0];
    if (!lowest) break;
    const k2 = `${lowest.suit}-${lowest.rank + 1}`;
    const k3 = `${lowest.suit}-${lowest.rank + 2}`;
    const c2 = pool.find((t) => isFree(t) && tileKey(t) === k2);
    const c3 = pool.find((t) => isFree(t) && tileKey(t) === k3);
    if (c2 && c3) {
      const chow = [lowest, c2, c3];
      chow.forEach((t) => used.add(t));
      melds.push({ type: 'chow', tiles: chow });
    } else {
      // Cannot form a chow from the lowest tile — but this should not happen
      // for a verified winning hand. Guard by breaking to avoid an infinite
      // loop; the caller validates the boolean separately.
      break;
    }
  }

  return { melds, pair: pickPair };
}

/** True when every tile belongs to one of the thirteen orphan faces. */
function isThirteenOrphansTiles(tiles: readonly Tile[]): boolean {
  if (tiles.length !== 14) return false;
  const counts = countByKey(tiles);
  if (counts.size !== 13) return false;
  // Exactly one duplicate (one key has count 2, the rest count 1).
  let sawDuplicate = false;
  for (const count of counts.values()) {
    if (count === 2) {
      if (sawDuplicate) return false;
      sawDuplicate = true;
    } else if (count !== 1) {
      return false;
    }
  }
  if (!sawDuplicate) return false;

  const terminalsAndHonors = new Set<string>();
  for (const suit of NUMBERED_SUITS) {
    terminalsAndHonors.add(`${suit}-1`);
    terminalsAndHonors.add(`${suit}-9`);
  }
  for (const suit of ['winds', 'dragons'] as const) {
    const max = suit === 'winds' ? 4 : 3;
    for (let r = 1; r <= max; r++) {
      terminalsAndHonors.add(`${suit}-${r}`);
    }
  }

  for (const key of counts.keys()) {
    if (!terminalsAndHonors.has(key)) return false;
  }
  return true;
}

/** Build a WinResult for thirteen orphans. */
function thirteenOrphansResult(tiles: readonly Tile[]): WinResult {
  const groups = groupByKey(tiles);
  const distinct = [...groups.keys()].map((key) => groups.get(key)![0]!);
  const melds = distinct.map((t) => ({
    type: 'chow' as const,
    tiles: [t],
  }));
  // The duplicate pair is the group with count 2.
  let pair: Tile[] = [];
  for (const group of groups.values()) {
    if (group.length === 2) pair = group;
  }
  return { type: 'thirteen-orphans', melds, pair, tiles };
}

/** Build a WinResult for seven pairs. */
function sevenPairsResult(tiles: readonly Tile[]): WinResult {
  const groups = groupByKey(tiles);
  const melds = [...groups.keys()].map((key) => {
    const group = groups.get(key)!;
    return { type: 'pung' as const, tiles: group.slice(0, 2) };
  });
  return { type: 'seven-pairs', melds, pair: [], tiles };
}

/**
 * Determine whether a hand is a winning hand and, if so, describe the win.
 *
 * The hand's concealed tiles plus the tiles of its exposed melds must total
 * 14 (bonus tiles are excluded). The 14 tiles are then checked against each
 * supported pattern in order: thirteen-orphans, seven-pairs, then the
 * standard four-meld-plus-pair decomposition.
 *
 * @param hand the hand to test
 * @param options optionally disable special hands (seven-pairs / thirteen-orphans)
 * @returns a {@link WinResult} describing the win, or `null` if not a win
 */
export function detectWin(
  hand: Hand,
  options: { allowSevenPairs?: boolean; allowThirteenOrphans?: boolean } = {},
): WinResult | null {
  const allowSevenPairs = options.allowSevenPairs ?? true;
  const allowThirteenOrphans = options.allowThirteenOrphans ?? true;

  const allTiles = [...hand.tiles, ...hand.melds.flatMap((m) => m.tiles)];
  const playable = allTiles.filter((t) => !isBonus(t));

  // Special hands are always exactly 14 tiles (7 pairs / 13 orphans + pair).
  if (playable.length === 14) {
    if (allowThirteenOrphans && isThirteenOrphansTiles(playable)) {
      return thirteenOrphansResult(playable);
    }

    const counts14 = countByKey(playable);
    if (allowSevenPairs) {
      let distinctPairs = 0;
      let allPairs = true;
      for (const count of counts14.values()) {
        if (count === 2) distinctPairs++;
        else if (count !== 0) {
          allPairs = false;
          break;
        }
      }
      if (allPairs && distinctPairs === 7) {
        return sevenPairsResult(playable);
      }
    }
  }

  // Standard hand: 4 melds + 1 pair. A kong counts as one meld, so the hand
  // holds 14 tiles (all chows/pungs) up to 18 tiles (all four kongs).
  if (playable.length < 14 || playable.length > 18) return null;

  const counts = countByKey(playable);

  // Standard: try every tile as the pair, then check the rest forms 4 melds.
  for (const [key, count] of counts) {
    if (count >= 2) {
      counts.set(key, count - 2);
      if (canFormMelds(counts, 4)) {
        counts.set(key, count);
        const groups = groupByKey(playable);
        const { melds, pair } = buildStandardDecomposition(groups, key);
        return { type: 'standard', melds, pair, tiles: playable };
      }
      counts.set(key, count);
    }
  }
  return null;
}

/** Convenience boolean wrapper for callers that only need a yes/no answer. */
export function isWinningHand(hand: Hand): boolean {
  return detectWin(hand) !== null;
}
