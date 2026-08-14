/**
 * Riichi Mahjong scoring — han (doubles) / fu (minipoints) calculation.
 *
 * This is the Japanese (Riichi) scoring engine, distinct from the Hong Kong
 * faan rules in `hong-kong-rules.ts`. Where HK uses a single faan count,
 * Riichi scores a hand by:
 *
 *   1. Counting fu (minipoints) from hand structure (melds, pair, wait).
 *   2. Counting han (doubles) from matched yaku (winning patterns).
 *   3. Deriving base points = fu * 2^(2 + han), capped at a limit (mangan
 *      and above) and rounded up to the nearest 100 for payment.
 *   4. Distributing the payment across players (dealer vs non-dealer, ron vs
 *      tsumo), then adding honba / tsumibou stick points.
 *
 * This module is DOM-free and canvas-free so it can be unit-tested headlessly
 * (Vitest + jsdom), matching the rest of the game-logic package.
 *
 * The task specifies a simplified Phase-3 approach: a focused set of common
 * yaku (tanyao, pinfu, riichi, ippatsu, yakuhai, and friends), basic fu
 * calculation rounded to the nearest 10, the standard han/fu payment table,
 * and honba/tsumi stick points. Yakuman detection is included (the hand
 * shapes are cheap to check) but is opt-in via the `allowYakuman` flag.
 */

import type { Hand, MeldType, Suit, Tile } from '../types';

/* ---------------------------------------------------------------------------
 * Public types
 * ------------------------------------------------------------------------ */

/** The type of wait (the incomplete set the winning tile completed). */
export type WaitType = 'ryanmen' | 'penchan' | 'kanchan' | 'tanki' | 'none';

/** A meld as scored by the analyzer, with fu-relevant classification. */
export interface AnalyzedMeld {
  readonly type: MeldType;
  readonly tiles: readonly Tile[];
  /** True when every tile came from the player's own hand (no calls). */
  readonly isConcealed: boolean;
  /** True when this meld is a pung/kong (matters for fu and toitoi). */
  readonly isPung: boolean;
  /** True when the meld's tiles are all terminals (1/9) or honors. */
  readonly isTerminalOrHonor: boolean;
}

/** The decomposition of a winning hand, ready for fu/limit analysis. */
export interface AnalyzedHand {
  readonly melds: readonly AnalyzedMeld[];
  readonly pair: readonly Tile[];
  /** True for the 7-pairs special hand (no 4 melds + pair shape). */
  readonly isChiitoitsu: boolean;
  /** True for the 13-orphans special hand. */
  readonly isKokushi: boolean;
  readonly waitType: WaitType;
  readonly isFullyConcealed: boolean;
}

/** A single matched yaku pattern. */
export interface YakuResult {
  readonly name: string;
  readonly han: number;
  /** True when this yaku is a yakuman (limit hand). */
  readonly yakuman: boolean;
}

/** Context flags that scoring depends on. */
export interface ScoreOptions {
  /** The tile that completed the winning hand (for wait-type fu). */
  winningTile: Tile;
  /** True when won by self-draw (tsumo); false when won off a discard (ron). */
  isTsumo: boolean;
  /** Seat wind rank (1=East,2=South,3=West,4=North) of the winner. */
  seatWind: number;
  /** Round wind rank (1=East,2=South,3=West,4=North). */
  roundWind: number;
  /** True when the winner is the dealer (East). */
  isDealer: boolean;
  /** Riichi declared this hand (implies fully concealed). */
  isRiichi?: boolean;
  /** Double riichi (2 han, implies riichi). */
  isDoubleRiichi?: boolean;
  /** Win on the very next draw after riichi (1 han). */
  isIppatsu?: boolean;
  /** Win by drawing the replacement tile after a kong (rinshan kaihou). */
  isRinshan?: boolean;
  /** Win on the last tile of the wall (haitei raoyue). */
  isHaitei?: boolean;
  /** Win off the last discard of the round (houtei raoyui). */
  isHoutei?: boolean;
  /** Win off a tile robbed from an exposed kong (chankan). */
  isChankan?: boolean;
  /** Number of honba (repeat counter) sticks; each adds 300 points. */
  honba?: number;
  /** Number of tsumibou (penalty) sticks; each adds 300 points. */
  tsumibou?: number;
  /** When true, yakuman patterns are recognized (default true). */
  allowYakuman?: boolean;
  /** Seat index that discarded the winning tile (ron). Defaults to the first
   * other player when omitted. */
  ronPayer?: number;
}

/** A scoring limit bucket (higher than 4 han). */
export type ScoreLimit =
  | 'none'
  | 'mangan'
  | 'haneman'
  | 'baiman'
  | 'sanbaiman'
  | 'yakuman';

/** The final resolved score for a winning hand. */
export interface ScoreResult {
  readonly han: number;
  readonly fu: number;
  /** fu * 2^(2+han) before rounding/limit. */
  readonly rawBasePoints: number;
  /** The limit bucket the hand falls into (for display). */
  readonly limit: ScoreLimit;
  /** Payment basis: the rounded base figure used for distribution. */
  readonly basePayment: number;
  /** Net points the winner gains from the other players (excl. sticks). */
  readonly tablePayment: number;
  /** Total stick points (honba + tsumibou) added to the winner. */
  readonly stickPayment: number;
  /** Per-player net change: [winningPlayerId] = +win, others = -lose. */
  readonly payments: readonly number[];
  /** The winning player's net change (payments[winningPlayerId]). */
  readonly winnerNet: number;
  /** The matched yaku patterns. */
  readonly patterns: readonly YakuResult[];
  /** Whether the hand was a yakuman (any yakuman pattern matched). */
  readonly isYakuman: boolean;
}

/* ---------------------------------------------------------------------------
 * Small tile helpers
 * ------------------------------------------------------------------------ */

function isHonor(tile: Tile): boolean {
  return tile.suit === 'winds' || tile.suit === 'dragons';
}

function isTerminal(tile: Tile): boolean {
  return !isHonor(tile) && (tile.rank === 1 || tile.rank === 9);
}

function isTerminalOrHonor(tile: Tile): boolean {
  return isHonor(tile) || isTerminal(tile);
}

function isBonus(tile: Tile): boolean {
  return tile.suit === 'flowers' || tile.suit === 'seasons';
}

function countByKey(tiles: readonly Tile[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tile of tiles) {
    counts.set(`${tile.suit}-${tile.rank}`, (counts.get(`${tile.suit}-${tile.rank}`) ?? 0) + 1);
  }
  return counts;
}

function tileTotal(counts: Map<string, number>): number {
  let total = 0;
  for (const c of counts.values()) total += c;
  return total;
}

/** Build a lightweight tile for synthetic meld groups (id need not be unique). */
function makeTile(suit: Suit, rank: number): Tile {
  return { id: `${suit}-${rank}`, suit, rank };
}

/* ---------------------------------------------------------------------------
 * Hand decomposition
 * ------------------------------------------------------------------------ */

/**
 * Find a decomposition of 14 playable tiles into four melds plus a pair.
 *
 * Returns an array of 5 groups, the last being the pair, or null when no such
 * partition exists. Each group is an array of Tile objects reconstructed from
 * the (suit, rank) signature.
 *
 * Approach: try each tile value as the pair (2 copies), then greedily check
 * the remaining 12 tiles partition into 4 melds. Trying the pair first is
 * essential — a greedy meld-first walk can strand the pair as an unmatched
 * leftover (e.g. 2,3,3,4,4,4,5,5,5,5,6,6,7,8 → 234,345,456,678 + 55).
 */
function decomposeFourMeldsPlusPair(
  counts: Map<string, number>,
): readonly (readonly Tile[])[] | null {
  if (tileTotal(counts) !== 14) return null;

  // Try each candidate pair (a tile with count >= 2).
  for (const [pairKey, pairCount] of counts) {
    if (pairCount < 2) continue;
    const [pSuit, pRankStr] = pairKey.split('-');
    const pRank = Number(pRankStr);
    counts.set(pairKey, pairCount - 2);
    const meldGroups = decomposeIntoMelds(counts, 4);
    counts.set(pairKey, pairCount); // restore

    if (meldGroups) {
      return [
        ...meldGroups,
        [makeTile(pSuit as Suit, pRank), makeTile(pSuit as Suit, pRank)],
      ];
    }
  }
  return null;
}

/**
 * Greedily partition a count map into exactly `meldsRemaining` melds (pung,
 * kong, or chow). Returns the meld groups or null when impossible. The count
 * map is mutated during the search and restored on backtracking.
 */
function decomposeIntoMelds(
  counts: Map<string, number>,
  meldsRemaining: number,
): readonly (readonly Tile[])[] | null {
  if (meldsRemaining === 0) {
    // Every tile must be consumed.
    for (const c of counts.values()) if (c > 0) return null;
    return [];
  }

  // Pick the first tile that still has a count; it must belong to a meld.
  const first = [...counts.entries()].find(([, c]) => c > 0);
  if (!first) return null;
  const [key, count] = first;
  const [suit, rankStr] = key.split('-');
  const rank = Number(rankStr);
  const suitTyped = suit as Suit;

  // Pung (3 identical).
  if (count >= 3) {
    counts.set(key, count - 3);
    const rest = decomposeIntoMelds(counts, meldsRemaining - 1);
    counts.set(key, count);
    if (rest) {
      return [
        [makeTile(suitTyped, rank), makeTile(suitTyped, rank), makeTile(suitTyped, rank)],
        ...rest,
      ];
    }
  }

  // Kong (4 identical) — counts as a single meld.
  if (count >= 4) {
    counts.set(key, count - 4);
    const rest = decomposeIntoMelds(counts, meldsRemaining - 1);
    counts.set(key, count);
    if (rest) {
      return [
        [
          makeTile(suitTyped, rank),
          makeTile(suitTyped, rank),
          makeTile(suitTyped, rank),
          makeTile(suitTyped, rank),
        ],
        ...rest,
      ];
    }
  }

  // Chow (3 consecutive) — only for numbered suits, rank 1..7 as start.
  if (!isHonor(makeTile(suitTyped, rank)) && rank >= 1 && rank <= 7) {
    const k2 = `${suit}-${rank + 1}`;
    const k3 = `${suit}-${rank + 2}`;
    if ((counts.get(k2) ?? 0) >= 1 && (counts.get(k3) ?? 0) >= 1) {
      counts.set(key, count - 1);
      counts.set(k2, (counts.get(k2) ?? 0) - 1);
      counts.set(k3, (counts.get(k3) ?? 0) - 1);
      const rest = decomposeIntoMelds(counts, meldsRemaining - 1);
      counts.set(key, count);
      counts.set(k2, (counts.get(k2) ?? 0) + 1);
      counts.set(k3, (counts.get(k3) ?? 0) + 1);
      if (rest) {
        return [
          [makeTile(suitTyped, rank), makeTile(suitTyped, rank + 1), makeTile(suitTyped, rank + 2)],
          ...rest,
        ];
      }
    }
  }

  return null;
}

/** True when the 14 tiles form exactly seven distinct pairs. */
function isSevenPairs(counts: Map<string, number>): boolean {
  if (tileTotal(counts) !== 14) return false;
  return [...counts.values()].every((c) => c === 2);
}

/** True when the hand is the 13-orphans (kokushi musou) shape. */
function isThirteenOrphans(counts: Map<string, number>): boolean {
  if (tileTotal(counts) !== 14) return false;
  const orphanKeys = new Set<string>([
    'bamboo-1', 'bamboo-9',
    'characters-1', 'characters-9',
    'dots-1', 'dots-9',
    'winds-1', 'winds-2', 'winds-3', 'winds-4',
    'dragons-1', 'dragons-2', 'dragons-3',
  ]);
  for (const key of counts.keys()) {
    if (!orphanKeys.has(key)) return false;
  }
  const values = [...counts.values()];
  return values.filter((c) => c === 2).length === 1 && values.every((c) => c === 1 || c === 2);
}

/**
 * Analyze a 14-tile winning hand into fu-relevant structure.
 *
 * @param hand the winning hand (bonus tiles are filtered out internally)
 * @param winningTile the tile that completed the hand
 */
export function analyzeWinningHand(hand: Hand, winningTile: Tile): AnalyzedHand {
  const playable = [...hand.tiles, ...hand.melds.flatMap((m) => m.tiles)].filter(
    (t) => !isBonus(t),
  );
  if (playable.length !== 14) {
    throw new Error(`analyzeWinningHand expects 14 playable tiles, got ${playable.length}.`);
  }

  const counts = countByKey(playable);
  const isFullyConcealed = hand.melds.length === 0 || hand.melds.every((m) => m.isConcealed);

  // Special hands first.
  if (isSevenPairs(counts)) {
    return {
      melds: [],
      pair: playable.slice(0, 2),
      isChiitoitsu: true,
      isKokushi: false,
      waitType: 'tanki',
      isFullyConcealed,
    };
  }
  if (isThirteenOrphans(counts)) {
    return {
      melds: [],
      pair: playable.slice(0, 2),
      isChiitoitsu: false,
      isKokushi: true,
      waitType: 'tanki',
      isFullyConcealed,
    };
  }

  const groups = decomposeFourMeldsPlusPair(new Map(counts));
  if (!groups) {
    throw new Error('Hand cannot be decomposed into four melds plus a pair.');
  }

  const rawMelds = groups.slice(0, 4);
  const pair = groups[4]!;

  // Determine the wait. The winning tile completes exactly one set: a meld or
  // the pair. If it completes a meld, classify that meld's wait; otherwise it
  // must have completed the pair (tanki).
  let waitType: WaitType = 'none';
  let foundWait = false;
  for (const group of rawMelds) {
    if (!group.some((t) => t.suit === winningTile.suit && t.rank === winningTile.rank)) {
      continue;
    }
    if (group.length === 4 || group[0]!.rank === group[1]!.rank) {
      // Pung/kong completed by the winning tile (shanpon): no wait fu.
      waitType = 'none';
    } else {
      // A chow. Classify by where the winning tile sits.
      const ranks = group.map((t) => t.rank).sort((a, b) => a - b);
      const w = winningTile.rank;
      if (w === ranks[0] && w === 7) waitType = 'penchan'; // 7-8-9, win on 7
      else if (w === ranks[2] && w === 3) waitType = 'penchan'; // 1-2-3, win on 3
      else if (w === ranks[1]) waitType = 'kanchan'; // middle of run
      else waitType = 'ryanmen';
    }
    foundWait = true;
    break;
  }
  if (!foundWait) {
    // No meld contains the winning tile → it completed the pair (tanki).
    if (pair.some((t) => t.suit === winningTile.suit && t.rank === winningTile.rank)) {
      waitType = 'tanki';
    }
  }

  // Map raw groups to AnalyzedMeld, borrowing the concealed flag from the
  // player's exposed melds in order (index-aligned with the decomposition).
  const analyzedMelds: AnalyzedMeld[] = rawMelds.map((group, idx) => {
    const exposed = hand.melds[idx];
    const isConcealed = exposed === undefined ? true : exposed.isConcealed;
    const first = group[0]!;
    const isPung = group.length === 4 || (group.length === 3 && first.rank === group[1]!.rank);
    return {
      type: (isPung ? 'pung' : 'chow') as MeldType,
      tiles: group,
      isConcealed,
      isPung,
      isTerminalOrHonor: isTerminalOrHonor(first),
    };
  });

  return {
    melds: analyzedMelds,
    pair,
    isChiitoitsu: false,
    isKokushi: false,
    waitType,
    isFullyConcealed,
  };
}

/* ---------------------------------------------------------------------------
 * Fu (minipoints) calculation
 * ------------------------------------------------------------------------ */

const PUNG_FU = { concealedTerminal: 8, concealedSimple: 4, openTerminal: 4, openSimple: 2 };
const KONG_FU = { concealedTerminal: 32, concealedSimple: 16, openTerminal: 16, openSimple: 8 };

/**
 * Compute the fu (minipoints) for a winning hand.
 *
 * Base 20. Adds fu for:
 *  - each pung/kong (concealed/open × terminal/simple)
 *  - a closed-hand ron (+10) or tsumo (+2)
 *  - the winning tile's wait (penchan/kanchan/tanki +2)
 *  - a value-wind or dragon pair (+2)
 *
 * Rounds up to the nearest 10, never below 30. Pinfu forces 20 fu and
 * chiitoitsu is a fixed 25 fu — both handled here.
 *
 * @param analyzed the decomposed hand
 * @param options scoring context
 * @param pinfu true when the pinfu yaku applies (waives all other fu)
 */
export function calculateFu(
  analyzed: AnalyzedHand,
  options: ScoreOptions,
  pinfu: boolean,
): number {
  if (analyzed.isChiitoitsu) return 25;
  if (pinfu) {
    // Pinfu waives all structural fu. Tsumo pinfu is 20 fu; a closed-hand ron
    // pinfu still earns the +10 closed-hand bonus → 30 fu.
    return options.isTsumo ? 20 : 30;
  }

  let fu = 20; // base

  // Closed-hand bonuses.
  if (analyzed.isFullyConcealed) {
    fu += options.isTsumo ? 2 : 10; // menzen tsumo +2, closed ron +10
  }

  // Melds.
  for (const meld of analyzed.melds) {
    if (!meld.isPung) continue;
    const isKong = meld.tiles.length === 4;
    const table = isKong ? KONG_FU : PUNG_FU;
    if (meld.isTerminalOrHonor) {
      fu += meld.isConcealed ? table.concealedTerminal : table.openTerminal;
    } else {
      fu += meld.isConcealed ? table.concealedSimple : table.openSimple;
    }
  }

  // Wait fu.
  if (analyzed.waitType === 'penchan' || analyzed.waitType === 'kanchan' || analyzed.waitType === 'tanki') {
    fu += 2;
  }

  // Pair fu: dragon pair or value-wind (seat or round) pair = +2.
  const pairTile = analyzed.pair[0];
  if (pairTile) {
    if (pairTile.suit === 'dragons') {
      fu += 2;
    } else if (pairTile.suit === 'winds') {
      if (pairTile.rank === options.seatWind || pairTile.rank === options.roundWind) fu += 2;
    }
  }

  return Math.max(30, Math.ceil(fu / 10) * 10);
}

/* ---------------------------------------------------------------------------
 * Yaku (han) detection
 * ------------------------------------------------------------------------ */

function dragonMeldRanks(analyzed: AnalyzedHand): Set<number> {
  const ranks = new Set<number>();
  for (const m of analyzed.melds) {
    const first = m.tiles[0];
    if (first && first.suit === 'dragons') ranks.add(first.rank);
  }
  return ranks;
}

function windMeldPungs(analyzed: AnalyzedHand, rank: number): number {
  return analyzed.melds.filter(
    (m) => m.isPung && m.tiles[0]?.suit === 'winds' && m.tiles[0]?.rank === rank,
  ).length;
}

function isAllGreen(playable: readonly Tile[]): boolean {
  const greenRanks = new Set([2, 3, 4, 6, 8]);
  return (
    playable.length > 0 &&
    playable.every(
      (t) =>
        (t.suit === 'bamboo' && greenRanks.has(t.rank)) ||
        (t.suit === 'dragons' && t.rank === 3),
    )
  );
}

/** Chuuren Poutou: 1112345678999 + any one tile of the same suit. */
function isChuurenPoutou(analyzed: AnalyzedHand): boolean {
  if (analyzed.isKokushi || analyzed.isChiitoitsu) return false;
  const all = [...analyzed.melds.flatMap((m) => m.tiles), ...analyzed.pair];
  const suit = all[0]?.suit;
  if (!suit || suit === 'winds' || suit === 'dragons') return false;
  if (!all.every((t) => t.suit === suit)) return false;
  const counts = new Array(10).fill(0);
  for (const t of all) counts[t.rank] = (counts[t.rank] ?? 0) + 1;
  const need: Record<number, number> = { 1: 3, 9: 3 };
  for (let r = 2; r <= 8; r++) need[r] = 1;
  let extra = 0;
  for (let r = 1; r <= 9; r++) {
    if (counts[r]! < need[r]!) return false;
    extra += counts[r]! - need[r]!;
  }
  return extra === 1;
}

function isRyanpeikou(analyzed: AnalyzedHand): boolean {
  if (analyzed.isChiitoitsu || analyzed.isKokushi) return false;
  if (analyzed.melds.some((m) => m.isPung)) return false;
  const signatures: string[] = [];
  for (const m of analyzed.melds) {
    const ranks = m.tiles.map((t) => t.rank).sort((a, b) => a - b);
    signatures.push(`${m.tiles[0]?.suit}:${ranks.join('-')}`);
  }
  const seen = new Map<string, number>();
  for (const s of signatures) seen.set(s, (seen.get(s) ?? 0) + 1);
  let pairs = 0;
  for (const c of seen.values()) if (c === 2) pairs++;
  return pairs === 2;
}

function isShousangen(analyzed: AnalyzedHand): boolean {
  const dragonPungs = analyzed.melds.filter(
    (m) => m.isPung && m.tiles[0]?.suit === 'dragons',
  ).length;
  return dragonPungs === 2 && analyzed.pair[0]?.suit === 'dragons';
}

/** All playable tiles are terminals only (chinroutou). */
function isAllTerminals(hand: Hand): boolean {
  const all = [...hand.tiles, ...hand.melds.flatMap((m) => m.tiles)].filter((t) => !isBonus(t));
  return all.length > 0 && all.every((t) => isTerminal(t));
}

/** All playable tiles are honors (tsuuiisou). */
function isAllHonors(hand: Hand): boolean {
  const all = [...hand.tiles, ...hand.melds.flatMap((m) => m.tiles)].filter((t) => !isBonus(t));
  return all.length > 0 && all.every((t) => isHonor(t));
}

/** Ittsu: chows 1-2-3, 4-5-6, 7-8-9 in one suit. Returns 0, 1 (open), 2 (concealed). */
function ittsuHan(analyzed: AnalyzedHand): number {
  const chowStartsBySuit = new Map<Suit, Set<number>>();
  for (const m of analyzed.melds) {
    if (m.isPung) continue;
    const suit = m.tiles[0]?.suit;
    if (!suit || isHonor(makeTile(suit, 1))) continue;
    const ranks = m.tiles.map((t) => t.rank).sort((a, b) => a - b);
    if (ranks.length !== 3) continue;
    if (ranks[1] === ranks[0]! + 1 && ranks[2] === ranks[1]! + 1) {
      if (!chowStartsBySuit.has(suit)) chowStartsBySuit.set(suit, new Set());
      chowStartsBySuit.get(suit)!.add(ranks[0]!);
    }
  }
  for (const starts of chowStartsBySuit.values()) {
    if (starts.has(1) && starts.has(4) && starts.has(7)) {
      return analyzed.isFullyConcealed ? 2 : 1;
    }
  }
  return 0;
}

/**
 * Sanshoku doujun: the same chow (1-2-3, etc.) in all three numbered suits.
 * Returns 0, 1 (open), or 2 (concealed).
 */
function sanshokuDoujunHan(analyzed: AnalyzedHand): number {
  const chowsBySuit = new Map<Suit, Set<string>>();
  for (const m of analyzed.melds) {
    if (m.isPung) continue;
    const suit = m.tiles[0]?.suit;
    if (!suit || suit === 'winds' || suit === 'dragons') continue;
    const ranks = m.tiles.map((t) => t.rank).sort((a, b) => a - b);
    const sig = `${ranks[0]}-${ranks[1]}-${ranks[2]}`;
    if (!chowsBySuit.has(suit)) chowsBySuit.set(suit, new Set());
    chowsBySuit.get(suit)!.add(sig);
  }
  for (const triple of chowsBySuit.get('bamboo') ?? new Set()) {
    if (
      chowsBySuit.get('characters')?.has(triple) &&
      chowsBySuit.get('dots')?.has(triple)
    ) {
      return analyzed.isFullyConcealed ? 2 : 1;
    }
  }
  return 0;
}

/** Sanshoku doukou: the same triplet in all three numbered suits (2 han). */
function sanshokuDoukou(analyzed: AnalyzedHand): boolean {
  const pungsBySuit = new Map<Suit, Set<number>>();
  for (const m of analyzed.melds) {
    if (!m.isPung) continue;
    const suit = m.tiles[0]?.suit;
    const rank = m.tiles[0]?.rank;
    if (!suit || suit === 'winds' || suit === 'dragons' || !rank) continue;
    if (!pungsBySuit.has(suit)) pungsBySuit.set(suit, new Set());
    pungsBySuit.get(suit)!.add(rank);
  }
  for (const r of pungsBySuit.get('bamboo') ?? new Set()) {
    if (pungsBySuit.get('characters')?.has(r) && pungsBySuit.get('dots')?.has(r)) return true;
  }
  return false;
}

function isJunchan(analyzed: AnalyzedHand, hand: Hand): boolean {
  if (analyzed.isKokushi || analyzed.isChiitoitsu) return false;
  const all = [...hand.tiles, ...hand.melds.flatMap((m) => m.tiles)].filter((t) => !isBonus(t));
  if (all.some((t) => isHonor(t))) return false;
  for (const m of analyzed.melds) if (!m.tiles.some((t) => isTerminal(t))) return false;
  return analyzed.pair.length > 0 && isTerminal(analyzed.pair[0]!);
}

function isChanta(analyzed: AnalyzedHand): boolean {
  if (analyzed.isKokushi || analyzed.isChiitoitsu) return false;
  for (const m of analyzed.melds) if (!m.tiles.some((t) => isTerminalOrHonor(t))) return false;
  return analyzed.pair.length > 0 && isTerminalOrHonor(analyzed.pair[0]!);
}

function suitContent(
  hand: Hand,
): { honitsu: boolean; chinitsu: boolean; concealed: boolean } {
  const all = [...hand.tiles, ...hand.melds.flatMap((m) => m.tiles)].filter((t) => !isBonus(t));
  const suits = new Set<Suit>(all.map((t) => t.suit));
  const numbered = [...suits].filter((s) => s !== 'winds' && s !== 'dragons');
  const concealed = hand.melds.length === 0 || hand.melds.every((m) => m.isConcealed);
  return {
    honitsu: numbered.length === 1 && suits.size > 1,
    chinitsu: numbered.length === 1 && suits.size === 1,
    concealed,
  };
}

/** Playable tiles of the hand (bonus filtered), convenience helper. */
function playableTiles(hand: Hand): readonly Tile[] {
  return [...hand.tiles, ...hand.melds.flatMap((m) => m.tiles)].filter((t) => !isBonus(t));
}

/**
 * Evaluate the yaku (winning patterns) for a hand and return the matched list.
 * A hand with no yaku scores 0 han — such a hand cannot legally win in Riichi.
 */
export function evaluateYaku(
  analyzed: AnalyzedHand,
  hand: Hand,
  options: ScoreOptions,
): YakuResult[] {
  const patterns: YakuResult[] = [];
  const push = (name: string, han: number, yakuman = false): void => {
    patterns.push({ name, han, yakuman });
  };

  const yakumanEnabled = options.allowYakuman ?? true;
  const playable = playableTiles(hand);

  /* ---- Yakuman (limit hands) ---- */
  if (yakumanEnabled) {
    if (analyzed.isKokushi) push('Kokushi Musou', 1, true);
    if (
      !analyzed.isKokushi &&
      !analyzed.isChiitoitsu &&
      analyzed.melds.length === 4 &&
      analyzed.melds.every((m) => m.isPung && m.isConcealed)
    ) {
      push('Suuankou', 1, true);
    }
    if (dragonMeldRanks(analyzed).size === 3) push('Daisangen', 1, true);
    const windPungs = analyzed.melds.filter(
      (m) => m.isPung && m.tiles[0]?.suit === 'winds',
    ).length;
    const windPair = analyzed.pair[0]?.suit === 'winds';
    if (windPungs === 4) push('Daisuushi', 1, true);
    else if (windPungs === 3 && windPair) push('Shousuushi', 1, true);
    if (isAllHonors(hand)) push('Tsuuiisou', 1, true);
    if (isAllTerminals(hand)) push('Chinroutou', 1, true);
    if (isAllGreen(playable)) push('Ryuuiisou', 1, true);
    if (isChuurenPoutou(analyzed)) push('Chuuren Poutou', 1, true);
    if (analyzed.melds.length === 4 && analyzed.melds.every((m) => m.tiles.length === 4)) {
      push('Suukantsu', 1, true);
    }

    if (patterns.some((p) => p.yakuman)) return patterns; // yakuman dominates
  }

  /* ---- Non-yakuman yaku ---- */

  // Riichi / win-method family.
  if (analyzed.isFullyConcealed) {
    if (options.isDoubleRiichi) push('Double Riichi', 2);
    else if (options.isRiichi) push('Riichi', 1);
    if (options.isIppatsu && (options.isRiichi || options.isDoubleRiichi)) push('Ippatsu', 1);
    if (options.isTsumo) push('Menzen Tsumo', 1);
    if (options.isHaitei) push('Haitei Raoyue', 1);
    if (options.isRinshan) push('Rinshan Kaihou', 1);
  } else if (options.isHoutei) {
    push('Houtei Raoyui', 1);
  }
  if (options.isChankan) push('Chankan', 1);

  // Special-hand shape.
  if (analyzed.isChiitoitsu) push('Chiitoitsu', 2);

  if (!analyzed.isChiitoitsu && !analyzed.isKokushi) {
    // Pinfu: all chows, ryanmen wait, non-value pair, fully concealed.
    const pairTile = analyzed.pair[0];
    const pinfuPairOk =
      pairTile !== undefined &&
      pairTile.suit !== 'dragons' &&
      !(pairTile.suit === 'winds' && (pairTile.rank === options.seatWind || pairTile.rank === options.roundWind));
    if (
      analyzed.isFullyConcealed &&
      analyzed.melds.length === 4 &&
      analyzed.melds.every((m) => !m.isPung) &&
      (analyzed.waitType === 'ryanmen' || analyzed.waitType === 'none') &&
      pinfuPairOk
    ) {
      push('Pinfu', 1);
    }

    // Tanyao (all simples).
    if (playable.every((t) => !isTerminalOrHonor(t))) push('Tanyao', 1);

    // Yakuhai: dragon pung +1 each; seat/round wind +1 each (double if equal).
    for (const rank of dragonMeldRanks(analyzed)) {
      if (rank !== undefined) push('Yakuhai (Dragon)', 1);
    }
    const seatWindPungs = windMeldPungs(analyzed, options.seatWind);
    const roundWindPungs = windMeldPungs(analyzed, options.roundWind);
    if (seatWindPungs > 0) push('Yakuhai (Seat Wind)', 1);
    if (roundWindPungs > 0) push('Yakuhai (Round Wind)', 1);

    // Ittsu / sanshoku.
    const ittsu = ittsuHan(analyzed);
    if (ittsu > 0) push('Ittsu', ittsu);
    const sanshoku = sanshokuDoujunHan(analyzed);
    if (sanshoku > 0) push('Sanshoku Doujun', sanshoku);
    if (sanshokuDoukou(analyzed)) push('Sanshoku Doukou', 2);

    // Pungs/kongs.
    if (analyzed.melds.length === 4 && analyzed.melds.every((m) => m.isPung)) push('Toitoi', 2);
    if (analyzed.melds.filter((m) => m.isPung && m.isConcealed).length >= 3) push('Sanankou', 2);
    if (analyzed.melds.filter((m) => m.tiles.length === 4).length === 3) push('Sankantsu', 2);

    // Outside hands.
    if (isJunchan(analyzed, hand)) push('Junchan', analyzed.isFullyConcealed ? 3 : 2);
    else if (isChanta(analyzed)) push('Chanta', analyzed.isFullyConcealed ? 2 : 1);

    // Flush hands.
    const content = suitContent(hand);
    if (content.chinitsu) push('Chinitsu', content.concealed ? 6 : 5);
    else if (content.honitsu) push('Honitsu', content.concealed ? 3 : 2);

    // Ryanpeikou / shousangen.
    if (isRyanpeikou(analyzed) && analyzed.isFullyConcealed) push('Ryanpeikou', 3);
    if (isShousangen(analyzed)) push('Shousangen', 2);
  }

  return patterns;
}

/* ---------------------------------------------------------------------------
 * Base points, limits, and payment distribution
 * ------------------------------------------------------------------------ */

const LIMIT_POINTS: Record<Exclude<ScoreLimit, 'none'>, number> = {
  mangan: 2000,
  haneman: 3000,
  baiman: 4000,
  sanbaiman: 6000,
  yakuman: 8000,
};

/**
 * Determine the scoring limit bucket from (han, fu, isYakuman).
 *
 * Riichi caps hands: 5 han = mangan; 6-7 haneman; 8-10 baiman; 11-12
 * sanbaiman; 13+ yakuman. Below 5 han base points = fu * 2^(2+han), with
 * 4-han/40-fu and 3-han/70-fu capped at mangan.
 */
export function resolveLimit(
  han: number,
  fu: number,
  isYakuman: boolean,
): { limit: ScoreLimit; rawBasePoints: number } {
  if (isYakuman) return { limit: 'yakuman', rawBasePoints: LIMIT_POINTS.yakuman };
  if (han >= 13) return { limit: 'yakuman', rawBasePoints: LIMIT_POINTS.yakuman };
  if (han >= 11) return { limit: 'sanbaiman', rawBasePoints: LIMIT_POINTS.sanbaiman };
  if (han >= 8) return { limit: 'baiman', rawBasePoints: LIMIT_POINTS.baiman };
  if (han >= 6) return { limit: 'haneman', rawBasePoints: LIMIT_POINTS.haneman };
  if (han >= 5) return { limit: 'mangan', rawBasePoints: LIMIT_POINTS.mangan };

  const raw = fu * 2 ** (2 + han);
  if (han === 4 && fu >= 40) return { limit: 'mangan', rawBasePoints: LIMIT_POINTS.mangan };
  if (han === 3 && fu >= 70) return { limit: 'mangan', rawBasePoints: LIMIT_POINTS.mangan };
  return { limit: 'none', rawBasePoints: raw };
}

/** Round a payment up to the nearest 100 (standard Riichi rounding). */
function roundUpToHundred(value: number): number {
  return Math.ceil(value / 100) * 100;
}

/**
 * Calculate the full Riichi score for a winning hand.
 *
 * @param hand the winning hand
 * @param options scoring context (winning tile, tsumo/ron, winds, sticks, ...)
 * @param winningPlayerId the seat index of the winner (for the payments array)
 * @param playerCount number of players (default 4)
 */
export function calculateScore(
  hand: Hand,
  options: ScoreOptions,
  winningPlayerId: number,
  playerCount: number = 4,
): ScoreResult {
  const analyzed = analyzeWinningHand(hand, options.winningTile);

  // Evaluate yaku; a hand with no yaku cannot legally win in Riichi.
  const patterns = evaluateYaku(analyzed, hand, options);
  if (patterns.length === 0) {
    throw new Error('No yaku — this hand cannot legally win under Riichi rules.');
  }

  const han = patterns.reduce((sum, p) => sum + p.han, 0);
  const isYakuman = patterns.some((p) => p.yakuman);

  // Pinfu forces fu = 20; chiitoitsu is fixed at 25 (both inside calculateFu).
  const pinfuApplies = patterns.some((p) => p.name === 'Pinfu');
  const fu = calculateFu(analyzed, options, pinfuApplies);

  const { limit, rawBasePoints } = resolveLimit(han, fu, isYakuman);
  const basePayment = roundUpToHundred(rawBasePoints);

  // Payment distribution.
  const payments = new Array<number>(playerCount).fill(0);
  const others = Array.from({ length: playerCount }, (_, i) => i).filter(
    (i) => i !== winningPlayerId,
  );
  const numLosers = others.length;

  let tablePayment: number;
  if (options.isTsumo) {
    if (options.isDealer) {
      // Dealer tsumo: each non-dealer pays 2x base (rounded).
      const share = roundUpToHundred(rawBasePoints * 2);
      tablePayment = share * numLosers;
      for (const loser of others) payments[loser] = -share;
    } else {
      // Non-dealer tsumo: dealer pays 2x, others pay 1x.
      const dealerShare = roundUpToHundred(rawBasePoints * 2);
      const regularShare = roundUpToHundred(rawBasePoints);
      tablePayment = dealerShare + regularShare * Math.max(0, numLosers - 1);
      for (const loser of others) {
        payments[loser] = loser === 0 ? -dealerShare : -regularShare;
      }
    }
  } else {
    // Ron: the discarder pays 6x (dealer ron) or 4x (non-dealer ron).
    const ronPayer =
      options.ronPayer !== undefined
        ? options.ronPayer
        : others[0]!;
    const multiple = options.isDealer ? 6 : 4;
    const ronShare = roundUpToHundred(rawBasePoints * multiple);
    tablePayment = ronShare;
    payments[ronPayer] = -ronShare;
  }

  // Honba / tsumibou sticks: each adds 300 points to the winner. On tsumo the
  // sticks are split evenly among losers; on ron the discarder pays all.
  const stickCount = (options.honba ?? 0) + (options.tsumibou ?? 0);
  const stickTotal = stickCount * 300;
  let stickPayment = stickTotal;

  if (stickTotal > 0) {
    if (options.isTsumo) {
      const perLoser = Math.floor(stickTotal / numLosers);
      let remainder = stickTotal - perLoser * numLosers;
      for (const loser of others) {
        const add = perLoser + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder--;
        payments[loser] = (payments[loser] ?? 0) - add;
      }
    } else {
      const ronPayer =
        options.ronPayer !== undefined ? options.ronPayer : others[0]!;
      payments[ronPayer] = (payments[ronPayer] ?? 0) - stickTotal;
    }
  }

  const winnerNet = tablePayment + stickPayment;
  payments[winningPlayerId] = winnerNet;

  return {
    han,
    fu,
    rawBasePoints,
    limit,
    basePayment,
    tablePayment,
    stickPayment,
    payments,
    winnerNet,
    patterns,
    isYakuman,
  };
}
