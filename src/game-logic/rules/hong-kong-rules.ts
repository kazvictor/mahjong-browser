/**
 * Hong Kong Mahjong rules: win detection and faan (score) calculation.
 *
 * A winning hand is 14 tiles that can be partitioned into four melds plus one
 * pair. A meld is a pung (3 identical), a kong (4 identical), or a chow
 * (3 consecutive tiles of the same numbered suit). Honor tiles (winds and
 * dragons) can never form a chow.
 *
 * Faan is the Hong Kong scoring unit. This module implements a practical
 * subset of the standard patterns (the most common ones players encounter);
 * the values follow the widely used "Hong Kong Mahjong" faan table.
 */
import type { Hand, Suit, Tile } from '../types';

/** A canonical tile key: suit + rank (e.g. "dots-5", "winds-east"). */
function tileKey(tile: Tile): string {
  return `${tile.suit}-${tile.rank}`;
}

/** True for honor tiles (winds and dragons), which cannot form chows. */
function isHonor(tile: Tile): boolean {
  return tile.suit === 'winds' || tile.suit === 'dragons';
}

/** True for bonus tiles (flowers and seasons), which are set aside. */
function isBonus(tile: Tile): boolean {
  return tile.suit === 'flowers' || tile.suit === 'seasons';
}

/** Count tiles by canonical key. */
function countByKey(tiles: readonly Tile[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tile of tiles) {
    counts.set(tileKey(tile), (counts.get(tileKey(tile)) ?? 0) + 1);
  }
  return counts;
}

/**
 * Recursively test whether a multiset of tiles (given as a mutable count map)
 * can be partitioned into melds. `meldsRemaining` is how many melds are left
 * to form. A meld is a pung (3 same), a kong (4 same), or a chow (3
 * consecutive of the same numbered suit).
 *
 * The count map is mutated during the search and restored on backtracking.
 */
function canFormMelds(counts: Map<string, number>, meldsRemaining: number): boolean {
  if (meldsRemaining === 0) {
    // Every tile must be consumed.
    for (const count of counts.values()) {
      if (count > 0) return false;
    }
    return true;
  }

  // Pick the first tile that still has a count; it must belong to some meld.
  let key: string | undefined;
  for (const [k, count] of counts) {
    if (count > 0) {
      key = k;
      break;
    }
  }
  if (key === undefined) return false; // tiles remain but none counted — impossible

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

/**
 * Determine whether a 14-tile hand is a valid winning hand.
 *
 * The hand's concealed tiles plus the tiles of its exposed melds must total
 * 14 (bonus tiles are excluded — they are set aside and do not count toward
 * the 14). The 14 tiles must partition into four melds plus one pair.
 *
 * @param hand the hand to test
 * @returns true if the hand is a valid winning hand
 */
export function isWinningHand(hand: Hand): boolean {
  const allTiles = [...hand.tiles, ...hand.melds.flatMap((m) => m.tiles)];
  const playable = allTiles.filter((t) => !isBonus(t));
  if (playable.length !== 14) return false;

  const counts = countByKey(playable);

  // Try every tile as the pair, then check the rest forms four melds.
  for (const [key, count] of counts) {
    if (count >= 2) {
      counts.set(key, count - 2);
      if (canFormMelds(counts, 4)) {
        counts.set(key, count);
        return true;
      }
      counts.set(key, count);
    }
  }
  return false;
}

/** A single faan pattern that contributes to a hand's score. */
export interface FaanPattern {
  readonly name: string;
  readonly faan: number;
}

/** The suits present in a hand's playable tiles. */
function suitsPresent(playable: readonly Tile[]): Set<Suit> {
  return new Set(playable.map((t) => t.suit));
}

/** True when every playable tile belongs to the same suit (pure one suit). */
function isPureOneSuit(playable: readonly Tile[]): boolean {
  const suits = suitsPresent(playable);
  return suits.size === 1 && !suits.has('winds') && !suits.has('dragons');
}

/** True when every playable tile is an honor tile (all honors). */
function isAllHonors(playable: readonly Tile[]): boolean {
  return playable.every((t) => isHonor(t));
}

/** True when every playable tile is a wind or dragon (mixed honors). */
function isMixedOneSuit(playable: readonly Tile[]): boolean {
  const suits = suitsPresent(playable);
  const numbered = [...suits].filter((s) => s !== 'winds' && s !== 'dragons');
  return numbered.length === 1 && suits.size > 1;
}

/** True when every meld is a pung or kong (all pungs). Requires at least one meld. */
function isAllPungs(hand: Hand): boolean {
  return hand.melds.length > 0 && hand.melds.every((m) => m.type === 'pung' || m.type === 'kong');
}

/** True when every meld is a chow (all chows). Requires at least one meld. */
function isAllChows(hand: Hand): boolean {
  return hand.melds.length > 0 && hand.melds.every((m) => m.type === 'chow');
}

/** Count of dragon pungs/kongs in the hand. */
function dragonMelds(hand: Hand): number {
  return hand.melds.filter(
    (m) => m.tiles.length > 0 && m.tiles[0]?.suit === 'dragons',
  ).length;
}

/** True when the hand contains a pung/kong of each of the three dragons. */
function isBigThreeDragons(hand: Hand): boolean {
  const dragonRanks = new Set<number>();
  for (const m of hand.melds) {
    const first = m.tiles[0];
    if (first && first.suit === 'dragons') dragonRanks.add(first.rank);
  }
  return dragonRanks.size === 3;
}

/** True when the hand contains pungs/kongs of two dragons plus a pair of the third. */
function isLittleThreeDragons(hand: Hand): boolean {
  const dragonRanks = new Set<number>();
  const counts = countByKey(hand.tiles);
  for (const m of hand.melds) {
    const first = m.tiles[0];
    if (first && first.suit === 'dragons') dragonRanks.add(first.rank);
  }
  // A pair of the third dragon in the concealed tiles.
  for (const [key, count] of counts) {
    if (key.startsWith('dragons-') && count >= 2) {
      const rank = Number(key.split('-')[1]);
      if (!dragonRanks.has(rank)) {
        return dragonRanks.size === 2;
      }
    }
  }
  return false;
}

/** True when the hand contains a pung/kong of the round wind or seat wind. */
function hasValueWind(hand: Hand, roundWind: Suit, seatWind: Suit): boolean {
  return hand.melds.some((m) => {
    const first = m.tiles[0];
    return (
      first !== undefined &&
      first.suit === 'winds' &&
      (first.suit === roundWind || first.suit === seatWind)
    );
  });
}

/**
 * Calculate the faan (score) for a winning hand under Hong Kong rules.
 *
 * Returns the list of matched patterns and the total faan. A hand with no
 * patterns scores 0 faan (in strict HK rules such a hand cannot win; callers
 * may treat 0 as "not a valid scoring hand").
 *
 * @param hand the winning hand
 * @param options contextual flags (self-draw, round/seat wind)
 */
export function calculateFaan(
  hand: Hand,
  options: {
    isSelfDraw?: boolean;
    roundWind?: Suit;
    seatWind?: Suit;
  } = {},
): { patterns: readonly FaanPattern[]; total: number } {
  const patterns: FaanPattern[] = [];
  const playable = [...hand.tiles, ...hand.melds.flatMap((m) => m.tiles)].filter(
    (t) => !isBonus(t),
  );

  if (isPureOneSuit(playable)) patterns.push({ name: 'Pure One Suit', faan: 3 });
  else if (isMixedOneSuit(playable)) patterns.push({ name: 'Mixed One Suit', faan: 1 });

  if (isAllHonors(playable)) patterns.push({ name: 'All Honors', faan: 10 });
  else if (isAllPungs(hand)) patterns.push({ name: 'All Pungs', faan: 3 });
  else if (isAllChows(hand)) patterns.push({ name: 'All Chows', faan: 1 });

  if (isBigThreeDragons(hand)) patterns.push({ name: 'Big Three Dragons', faan: 5 });
  else if (isLittleThreeDragons(hand)) patterns.push({ name: 'Little Three Dragons', faan: 2 });

  if (dragonMelds(hand) > 0) patterns.push({ name: 'Dragon Pung', faan: 1 });

  if (options.roundWind && options.seatWind && hasValueWind(hand, options.roundWind, options.seatWind)) {
    patterns.push({ name: 'Value Wind', faan: 1 });
  }

  if (options.isSelfDraw) patterns.push({ name: 'Self-Draw', faan: 1 });

  const total = patterns.reduce((sum, p) => sum + p.faan, 0);
  return { patterns, total };
}

/** The Hong Kong rules engine, exposed as a class for the task's file layout. */
export class HongKongRules {
  /** True when the hand is a valid 14-tile winning hand. */
  isWinningHand(hand: Hand): boolean {
    return isWinningHand(hand);
  }

  /** Calculate faan for a winning hand. */
  calculateFaan(
    hand: Hand,
    options: { isSelfDraw?: boolean; roundWind?: Suit; seatWind?: Suit } = {},
  ): { patterns: readonly FaanPattern[]; total: number } {
    return calculateFaan(hand, options);
  }
}
