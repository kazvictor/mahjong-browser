/**
 * MeldSystem — pure, headless detection of meld opportunities.
 *
 * Given a player's concealed hand and a tile just discarded by an opponent,
 * this module answers "what can this player claim?" It detects the three claim
 * types from the Mahjong rules:
 *
 *   - Chow (sequence): the player holds the two tiles that, together with the
 *     discarded tile, form three consecutive ranks of the same numbered suit.
 *   - Pung (triplet): the player holds two tiles identical to the discard.
 *   - Kong (quad):  the player holds three tiles identical to the discard.
 *
 * This module is DOM-free and canvas-free so it can be unit-tested headlessly
 * (Vitest + jsdom), mirroring the rest of @game-logic. It performs NO
 * mutation: it returns a list of {@link MeldOpportunity} records describing
 * which hand tiles would be consumed for each legal claim. The engine
 * (MahjongGame) is responsible for acting on those records.
 */

import type { MeldType, Tile } from './types';

/** The suits that can form a chow (numbered suits only — honors cannot). */
const NUMBERED_SUITS: ReadonlySet<Tile['suit']> = new Set<Tile['suit']>([
  'bamboo',
  'characters',
  'dots',
]);

/** A claimable meld offered to a player on an opponent's discard. */
export interface MeldOpportunity {
  /** The kind of meld that can be formed. */
  readonly type: MeldType;
  /**
   * The full set of meld tiles, with the claimed (discarded) tile listed
   * last. For a chow the tiles are ordered by ascending rank.
   */
  readonly tiles: readonly Tile[];
  /** The ids of the tiles the player must remove from their own hand. */
  readonly handTileIds: readonly string[];
  /** The discarded tile being claimed. */
  readonly claimedTile: Tile;
}

/** True when two tiles share the same suit and rank (same "face"). */
function sameFace(a: Tile, b: Tile): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

/** True when a tile belongs to a numbered suit that can form a chow. */
function isNumbered(tile: Tile): boolean {
  return NUMBERED_SUITS.has(tile.suit);
}

/** All hand tiles matching `discard` by face (same suit + rank). */
function matchingFaces(hand: readonly Tile[], discard: Tile): Tile[] {
  return hand.filter((t) => sameFace(t, discard));
}

/** The tiles from `hand` that form a chow with `discard` (exclude the discard itself). */
function chowPartnerTiles(
  hand: readonly Tile[],
  discard: Tile,
): readonly Tile[] {
  const r = discard.rank;
  // The discarded tile may occupy the low, middle, or high position of the
  // run. For each position, both partner ranks must be present in the hand.
  const positions: ReadonlyArray<readonly [number, number]> = [
    [r - 2, r - 1], // discard is the high tile:  (r-2, r-1, r)
    [r - 1, r + 1], // discard is the middle tile (r-1, r, r+1)
    [r + 1, r + 2], // discard is the low tile:   (r, r+1, r+2)
  ];

  for (const [a, b] of positions) {
    // Ranks must stay within 1..9 for the suit.
    if (a < 1 || b > 9) continue;
    const ta = hand.find((t) => t.suit === discard.suit && t.rank === a);
    const tb = hand.find((t) => t.suit === discard.suit && t.rank === b);
    if (ta && tb) {
      // Order by ascending rank so the exposed meld reads left→right.
      const low = ta.rank < tb.rank ? ta : tb;
      const high = ta.rank < tb.rank ? tb : ta;
      return [low, high];
    }
  }
  return [];
}

/**
 * Detect every meld opportunity a player has on an opponent's discard.
 *
 * @param hand    The player's current concealed tiles.
 * @param discard The tile just discarded by an opponent.
 * @returns All legal claims (chow / pung / kong), in the order chow → pung →
 *          kong, each describing which hand tiles are consumed. Empty when no
 *          claim is possible.
 */
export function detectMeldOpportunities(
  hand: readonly Tile[],
  discard: Tile,
): MeldOpportunity[] {
  const opportunities: MeldOpportunity[] = [];

  // Chow — only for numbered suits.
  if (isNumbered(discard)) {
    const partners = chowPartnerTiles(hand, discard);
    if (partners.length === 2) {
      const low = partners[0]!;
      const high = partners[1]!;
      const tiles = low.rank < discard.rank && discard.rank < high.rank
        ? [low, discard, high]
        : discard.rank < low.rank
          ? [discard, low, high]
          : [low, high, discard];
      opportunities.push({
        type: 'chow',
        tiles,
        handTileIds: [low.id, high.id],
        claimedTile: discard,
      });
    }
  }

  // Pung — two identical tiles in hand.
  const matches = matchingFaces(hand, discard);
  if (matches.length >= 2) {
    opportunities.push({
      type: 'pung',
      tiles: [matches[0]!, matches[1]!, discard],
      handTileIds: [matches[0]!.id, matches[1]!.id],
      claimedTile: discard,
    });
  }

  // Kong — three identical tiles in hand.
  if (matches.length >= 3) {
    opportunities.push({
      type: 'kong',
      tiles: [matches[0]!, matches[1]!, matches[2]!, discard],
      handTileIds: [matches[0]!.id, matches[1]!.id, matches[2]!.id],
      claimedTile: discard,
    });
  }

  return opportunities;
}

/** True when a player has at least one claimable meld on `discard`. */
export function hasMeldOpportunity(
  hand: readonly Tile[],
  discard: Tile,
): boolean {
  return detectMeldOpportunities(hand, discard).length > 0;
}

/**
 * The number of matching hand tiles a specific claim type requires beyond the
 * discarded tile itself. Used by callers that only need the count.
 */
export function meldHandCount(type: MeldType): number {
  switch (type) {
    case 'chow':
    case 'pung':
      return 2;
    case 'kong':
      return 3;
  }
}
