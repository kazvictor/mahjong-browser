/**
 * Scoring — calculates points for a winning hand and the payout transfer.
 *
 * This is a simplified MVP scoring model (not full han/fu):
 *   - Base points come from each meld in the winning hand:
 *       chow = 1, pung = 2, kong = 4
 *   - Each dragon meld (pung/kong of dragons) adds a bonus.
 *   - Each wind meld (pung/kong of winds) adds a bonus.
 *   - Seven Pairs and Thirteen Orphans have their own flat scores.
 *   - The winner receives the total from every other player (payout).
 *
 * The module is DOM-free and canvas-free so it can be unit tested headlessly.
 * It consumes a {@link WinResult} (from win-detection) plus contextual options.
 */
import type { Hand } from './types';
import { detectWin, type WinResult, type WinType } from './win-detection';

/** Base points awarded for a meld by its type. */
export const MELD_BASE_POINTS: Readonly<Record<'chow' | 'pung' | 'kong', number>> = {
  chow: 1,
  pung: 2,
  kong: 4,
};

/** Bonus points for a dragon pung/kong (per meld). */
export const DRAGON_BONUS = 1;

/** Bonus points for a wind pung/kong (per meld). */
export const WIND_BONUS = 1;

/** Flat score for a Seven Pairs win. */
export const SEVEN_PAIRS_SCORE = 12;

/** Flat score for a Thirteen Orphans win. */
export const THIRTEEN_ORPHANS_SCORE = 25;

/** A single line in the score breakdown, shown to the player. */
export interface ScoreLine {
  readonly label: string;
  readonly points: number;
}

/** The fully resolved score for a winning hand. */
export interface ScoreResult {
  readonly type: WinType;
  readonly lines: readonly ScoreLine[];
  /** The winner's total score for this hand. */
  readonly total: number;
  /** The number of points each losing player pays the winner. */
  readonly pointsFromEach: number;
}

/** The meld-shape subset needed for scoring (avoids depending on `Meld`'s
 * `isConcealed`/`sourcePlayer` fields, which WinResult melds do not carry). */
interface MeldShape {
  readonly type: 'chow' | 'pung' | 'kong';
  readonly tiles: readonly Tile[];
}

import type { Tile } from './types';

/** Whether a meld's constituent tiles are all dragons. */
function isDragonMeld(meld: MeldShape): boolean {
  const first = meld.tiles[0];
  return first !== undefined && first.suit === 'dragons';
}

/** Whether a meld's constituent tiles are all winds. */
function isWindMeld(meld: MeldShape): boolean {
  const first = meld.tiles[0];
  return first !== undefined && first.suit === 'winds';
}

/**
 * Compute the score for a winning hand described by `win`.
 *
 * The `win.melds` array carries the melds of a standard win; for special wins
 * the whole flat score is awarded. Dragon/wind bonuses apply only to melds
 * that are pungs or kongs (a lone honor tile cannot be a chow, so this is a
 * safe guard).
 *
 * @param win the win result from win detection
 * @returns a {@link ScoreResult} with the breakdown and total
 */
export function scoreWin(win: WinResult): ScoreResult {
  if (win.type === 'seven-pairs') {
    const lines: readonly ScoreLine[] = [{ label: 'Seven Pairs', points: SEVEN_PAIRS_SCORE }];
    return {
      type: win.type,
      lines,
      total: SEVEN_PAIRS_SCORE,
      pointsFromEach: SEVEN_PAIRS_SCORE,
    };
  }

  if (win.type === 'thirteen-orphans') {
    const lines: readonly ScoreLine[] = [
      { label: 'Thirteen Orphans', points: THIRTEEN_ORPHANS_SCORE },
    ];
    return {
      type: win.type,
      lines,
      total: THIRTEEN_ORPHANS_SCORE,
      pointsFromEach: THIRTEEN_ORPHANS_SCORE,
    };
  }

  // Standard hand: sum base points from melds, then add bonuses.
  const lines: ScoreLine[] = [];
  let total = 0;

  for (const winMeld of win.melds) {
    const base = MELD_BASE_POINTS[winMeld.type];
    total += base;
    lines.push({
      label: `${winMeld.type.charAt(0).toUpperCase()}${winMeld.type.slice(1)} (${winMeld.tiles.length} tiles)`,
      points: base,
    });
  }

  // Dragon bonuses.
  const dragonMelds = win.melds.filter((m) => isDragonMeld(m));
  for (const _ of dragonMelds) {
    total += DRAGON_BONUS;
    lines.push({ label: 'Dragon Bonus', points: DRAGON_BONUS });
  }

  // Wind bonuses.
  const windMelds = win.melds.filter((m) => isWindMeld(m));
  for (const _ of windMelds) {
    total += WIND_BONUS;
    lines.push({ label: 'Wind Bonus', points: WIND_BONUS });
  }

  return {
    type: win.type,
    lines,
    total,
    pointsFromEach: total,
  };
}

/** Convenience: detect a win from a hand, then score it. Returns null when the
 * hand is not a winning hand. */
export function scoreHand(hand: Hand): { win: WinResult; score: ScoreResult } | null {
  const detected = detectWin(hand);
  if (!detected) return null;
  return { win: detected, score: scoreWin(detected) };
}
