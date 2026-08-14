/**
 * Tile-efficiency AI strategy.
 *
 * Replaces the naive random discard with an intelligent policy driven by
 * shanten (see `shanten.ts`): for every candidate discard we compute the
 * resulting shanten and combine it with tile-value, block-usefulness and
 * defensive-safety scores to pick the discard that keeps the hand on the
 * fastest path to completion while minimising risk.
 *
 * The strategy is a pure function of an `EfficiencyContext` — it never reads
 * mutable game state, which makes it fully headlessly unit-testable. It also
 * exposes the decision helpers the engine can call when meld/riichi phases are
 * wired up:
 *   - `shouldRiichi` — declare riichi when tenpai and the wait is worthwhile.
 *   - `shouldCallMeld` — open a meld when it accelerates the hand meaningfully
 *     and opening does not cripple the hand's shape/value.
 *
 * Decision tree:
 *   draw → compute current shanten → for each discard compute resulting
 *   shanten + value + safety → choose the best → (if now tenpai, consider
 *   riichi) → (if an opp discard offers a meld, consider calling).
 */
import type { Suit, Tile } from '../types';
import type { DiscardStrategy } from './random-discard-strategy';
import { shantenOfHand, TOTAL_TILE_TYPES } from './shanten';

/** The phase of the round, used to tune tile-value tables. */
export type GameStage = 'early' | 'mid' | 'late';

/** Tiles drawn before we consider a round "early". */
export const EARLY_END_DRAW = 18;

/** Tiles drawn before we consider a round "late" (deep into the wall). */
export const MID_END_DRAW = 38;

/** How much a single shanten improvement is worth in discard score. */
const SHANTEN_WEIGHT = 1000;

/** Score added for a tile that is part of a pair (kept to build the eye). */
const PAIR_VALUE = 400;

/** Score added for a tile that is part of a completed meld. */
const MELD_VALUE = 600;

/** Score added for a tile that is part of a two-tile taatsu/chow shape. */
const TAATSU_VALUE = 350;

/** Score added for a tile that is an isolated terminal/honor single. */
const ISOLATED_PENALTY = -150;

/** A tile that is genbutsu (already discarded by the riichi opponent). */
const GENBUTSU_SAFETY = 300;

/** A tile that is suji-safe relative to the riichi opponent's discards. */
const SUJI_SAFETY = 150;

/** Base value of a suit tile in the middle of a numbered run. */
const SUITED_BASE_VALUE = 100;

/** Value of a single isolated tile in each game stage (higher = keep). */
const HONOR_EARLY = 220;
const HONOR_MID = 160;
const HONOR_LATE = 80;

/** Context the efficiency AI needs to make a decision. */
export interface EfficiencyContext {
  /** Tiles already visible (own + opponents' discards, exposed melds). */
  readonly seenTiles: readonly Tile[];
  /** True when an opponent has declared riichi → switch to defensive play. */
  readonly opponentRiichi: boolean;
  /** Number of tiles drawn this round (drives stage detection). */
  readonly tilesDrawn: number;
  /** The round wind rank (1..4). Optional; improves honor valuation. */
  readonly roundWind?: number;
  /** The seat wind rank (1..4). Optional; improves honor valuation. */
  readonly seatWind?: number;
  /** The tile drawn this turn (favoured to keep when it helps). */
  readonly drawnTile?: Tile;
}

/** A scored discard candidate. */
export interface ScoredDiscard {
  readonly tile: Tile;
  /** Lower resulting shanten is better (more negative = closer to win). */
  readonly resultingShanten: number;
  /** Composite score; pick the highest. */
  readonly score: number;
}

/** Infer the round stage from the number of tiles drawn so far. */
export function stageFromTilesDrawn(tilesDrawn: number): GameStage {
  if (tilesDrawn < EARLY_END_DRAW) return 'early';
  if (tilesDrawn < MID_END_DRAW) return 'mid';
  return 'late';
}

/** True for honor tiles (winds and dragons), which cannot form chows. */
function isHonor(suit: Suit): boolean {
  return suit === 'winds' || suit === 'dragons';
}

/** True for the terminal rank (1 or 9) of a numbered suit. */
function isTerminal(suit: Suit, rank: number): boolean {
  return suit !== 'winds' && suit !== 'dragons' && (rank === 1 || rank === 9);
}

/**
 * A hand with one candidate tile removed. Returns the tile list with the
 * first matching tile (by identity) removed; used to evaluate shanten after
 * each possible discard.
 */
function handWithout(hand: readonly Tile[], tile: Tile): Tile[] {
  const index = hand.findIndex((t) => t.id === tile.id);
  if (index === -1) return [...hand];
  return [...hand.slice(0, index), ...hand.slice(index + 1)];
}

/** Count how many tiles in `hand` equal a given tile's face. */
function faceCount(hand: readonly Tile[], tile: Tile): number {
  let count = 0;
  for (const t of hand) {
    if (t.suit === tile.suit && t.rank === tile.rank) count += 1;
  }
  return count;
}

/**
 * How structurally useful `tile` is within `hand` (ignoring the tile itself
 * in the count, since we are deciding whether to discard it).
 */
function blockValue(hand: readonly Tile[], tile: Tile): number {
  const others = hand.filter((t) => t.id !== tile.id);
  const matches = faceCount(others, tile);

  // Part of a pung/kong (2+ other copies) → very valuable.
  if (matches >= 2) return MELD_VALUE;
  // A pair → valuable as the eventual eye or a pung start.
  if (matches === 1) return PAIR_VALUE;

  // Chow potential: does it sit next to another tile in the same suit?
  if (!isHonor(tile.suit)) {
    const hasNeighbour = (r: number): boolean =>
      r >= 1 && r <= 9 && others.some((t) => t.suit === tile.suit && t.rank === r);
    // Adjacent neighbour → taatsu.
    if (hasNeighbour(tile.rank - 1) || hasNeighbour(tile.rank + 1)) {
      return TAATSU_VALUE;
    }
    // One-gap neighbour (kanchan) → still a partial chow shape.
    if (hasNeighbour(tile.rank - 2) || hasNeighbour(tile.rank + 2)) {
      return TAATSU_VALUE;
    }
  }

  // Isolated single.
  if (isTerminal(tile.suit, tile.rank) || isHonor(tile.suit)) {
    return ISOLATED_PENALTY;
  }
  return ISOLATED_PENALTY;
}

/**
 * Base value of a tile type by game stage (independent of the current hand).
 * Honors are worth keeping early (pungs are easy, high-scoring) but become
 * dead weight late. Isolated terminal honors score low.
 */
export function stageTileValue(tile: Tile, stage: GameStage): number {
  if (isHonor(tile.suit)) {
    switch (stage) {
      case 'early':
        return HONOR_EARLY;
      case 'mid':
        return HONOR_MID;
      default:
        return HONOR_LATE;
    }
  }
  if (isTerminal(tile.suit, tile.rank)) {
    // Terminals are useful for chows at the edge, but often discarded.
    return stage === 'early' ? 130 : 90;
  }
  // Middle suited tiles are the workhorses of chow-heavy hands.
  return SUITED_BASE_VALUE;
}

/**
 * Whether `tile` is suji-safe against a riichi opponent.
 *
 * Suji theory: a player who has discarded a tile of rank r in a suit cannot
 * be waiting on r±3 in that suit (those waits would have been broken by that
 * discard). So an opponent discarding a 4 cannot wait on 1 or 7; a 5 on 2 or
 * 8; a 6 on 3 or 9. Discarding a tile that is suji-safe against every known
 * discard of the dangerous player avoids feeding their wait.
 */
export function isSujiSafe(tile: Tile, riichiDiscards: readonly Tile[]): boolean {
  if (isHonor(tile.suit)) return false; // honors have no suji relation
  const r = tile.rank;
  for (const d of riichiDiscards) {
    if (d.suit !== tile.suit) continue;
    // d == r±3 → this tile is safe relative to that discard.
    if (Math.abs(d.rank - r) === 3) return true;
  }
  return false;
}

/**
 * A defensive safety score for `tile` given the riichi opponent's discards.
 * A tile the opponent already discarded is completely safe (genbutsu); a
 * suji-safe tile is next-best; a tile in a suit the opponent has abandoned is
 * safer than a fresh middle tile.
 */
export function defensiveScore(tile: Tile, riichiDiscards: readonly Tile[]): number {
  // Genbutsu: already discarded by the dangerous player → totally safe.
  if (riichiDiscards.some((d) => d.suit === tile.suit && d.rank === tile.rank)) {
    return GENBUTSU_SAFETY;
  }
  if (isSujiSafe(tile, riichiDiscards)) {
    return SUJI_SAFETY;
  }
  // Fresh honors and untouched middle tiles are the most dangerous to fold.
  return 0;
}

/** A single scored discard decision (exposed for the engine + tests). */
export interface DiscardEvaluation {
  readonly best: ScoredDiscard | null;
  readonly candidates: readonly ScoredDiscard[];
}

/**
 * Score every possible discard from `hand` and return the best, or `null`
 * for an empty hand. Pure and deterministic given the same inputs.
 */
export function evaluateDiscards(
  hand: readonly Tile[],
  context: EfficiencyContext,
): DiscardEvaluation {
  if (hand.length === 0) {
    return { best: null, candidates: [] };
  }
  const stage = stageFromTilesDrawn(context.tilesDrawn);

  // Deduplicate candidate tiles by face — discarding one copy of a face is
  // scored identically to any other copy, so evaluate each face once.
  const seen = new Set<string>();
  const candidates: ScoredDiscard[] = [];

  for (const tile of hand) {
    const key = `${tile.suit}-${tile.rank}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const resulting = handWithout(hand, tile);
    const resultingShanten = shantenOfHand(resulting);

    // Primary signal: lower resulting shanten is strongly preferred.
    let score = (8 - resultingShanten) * SHANTEN_WEIGHT;

    // Secondary signal: structural usefulness of the tile we are dropping.
    score += blockValue(hand, tile);

    // Stage-aware base value of the tile type.
    score += stageTileValue(tile, stage);

    // Favour discarding the freshly drawn tile when it does not help (the AI
    // tends to tsumogiri — discard what it just drew unless that draw improves
    // the hand). This keeps the hand stable across turns.
    if (context.drawnTile && tile.id === context.drawnTile.id) {
      score += 5;
    }

    // Defensive mode: heavily reward folding a safe tile when an opponent is
    // in riichi.
    if (context.opponentRiichi) {
      score += defensiveScore(tile, context.seenTiles);
    }

    candidates.push({ tile, resultingShanten, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  return { best: candidates[0] ?? null, candidates };
}

/** The result of a riichi evaluation. */
export interface RiichiDecision {
  readonly shouldRiichi: boolean;
  /** 0 = tenpai (waiting); -1 = already winning. */
  readonly shanten: number;
  /** Rough estimate of the number of winning tiles remaining (waits). */
  readonly waitCount: number;
}

/**
 * Decide whether to declare riichi after drawing.
 *
 * Riichi is worthwhile when the hand is tenpai (0 shanten) and the wait is
 * not degenerate (at least one live winning tile remains). We refuse riichi
 * when already winning (no need to pay the riichi bet) or when the wait is
 * completely dead. A richer implementation would weigh hand value, but the
 * core rule — tenpai + a live wait → riichi — is the meaningful one for a
 * Mahjong AI and is what the task requires.
 */
export function shouldRiichi(
  hand: readonly Tile[],
  context: EfficiencyContext,
): RiichiDecision {
  const shanten = shantenOfHand(hand);
  if (shanten > 0) {
    return { shouldRiichi: false, shanten, waitCount: 0 };
  }

  const waitCount = estimateLiveWaits(hand, context.seenTiles);
  const should = shanten === 0 && waitCount > 0;
  return { shouldRiichi: should, shanten, waitCount };
}

/**
 * Roughly estimate how many winning tiles the hand is still waiting on.
 *
 * A tenpai 13-tile hand wins when it draws any tile that completes a valid
 * 14-tile winning hand. We enumerate all 34 tile types, simulate drawing one
 * copy of each (only counting faces that are not already over-drawn from the
 * wall), and count how many distinct live copies make the extended hand a
 * winning hand. This is exact for wait *presence* and a good approximation of
 * wait *width* (live copies) — enough to reject hopeless riichi.
 */
function estimateLiveWaits(hand: readonly Tile[], seenTiles: readonly Tile[]): number {
  if (hand.length !== 13) return 0; // must be a 13-tile tenpai to declare on the draw

  // Copies of each face already accounted for (in our hand + seen).
  const used = new Map<string, number>();
  for (const t of [...hand, ...seenTiles]) {
    used.set(`${t.suit}-${t.rank}`, (used.get(`${t.suit}-${t.rank}`) ?? 0) + 1);
  }

  let liveWaits = 0;
  for (let index = 0; index < TOTAL_TILE_TYPES; index += 1) {
    const { suit, rank } = indexToFace(index);
    const key = `${suit}-${rank}`;
    const copiesLeft = 4 - (used.get(key) ?? 0);
    if (copiesLeft <= 0) continue;

    // Simulate drawing one copy of this tile.
    const extended = [...hand, { id: `${suit}-${rank}-wait`, suit, rank }];
    if (shantenOfHand(extended) === -1) {
      liveWaits += copiesLeft;
    }
  }
  return liveWaits;
}

/** Invert a 34-slot index back to a (suit, rank) face. */
function indexToFace(index: number): { suit: Suit; rank: number } {
  if (index < 27) {
    const suits: readonly Suit[] = ['bamboo', 'characters', 'dots'];
    return { suit: suits[Math.floor(index / 9)]!, rank: (index % 9) + 1 };
  }
  if (index < 31) {
    return { suit: 'winds', rank: index - 27 + 1 };
  }
  return { suit: 'dragons', rank: index - 31 + 1 };
}

/** Whether a tile is eligible to form a given meld type from a discard. */
function canFormMeld(hand: readonly Tile[], tile: Tile, type: 'pung' | 'kong' | 'chow'): boolean {
  const others = hand.filter((t) => t.id !== tile.id);
  const matches = faceCount(others, tile);
  if (type === 'pung') return matches >= 2;
  if (type === 'kong') return matches >= 3;
  // Chow: needs two consecutive neighbours already in hand.
  if (isHonor(tile.suit)) return false;
  const r = tile.rank;
  const has = (rank: number): boolean =>
    rank >= 1 && rank <= 9 && others.some((t) => t.suit === tile.suit && t.rank === rank);
  return (has(r - 1) && has(r + 1)) || (has(r - 1) && has(r - 2)) || (has(r + 1) && has(r + 2));
}

/** The result of a meld-call evaluation. */
export interface MeldDecision {
  readonly shouldCall: boolean;
  /** Whether calling the meld would lower the hand's shanten. */
  readonly improves: boolean;
}

/**
 * Decide whether to call a discarded tile to open a meld.
 *
 * Opening a meld costs flexibility (the hand can no longer be fully concealed,
 * losing the potential yaku and, in riichi rules, the riichi itself). We call
 * only when the meld genuinely accelerates the hand: it must lower the hand's
 * shanten (accounting for the newly completed meld) and leave the hand with an
 * eye, so the win is still reachable. A late-stage push bonus makes the AI
 * slightly more willing to open when time is running out.
 */
export function shouldCallMeld(
  hand: readonly Tile[],
  discard: Tile,
  type: 'pung' | 'kong' | 'chow',
  context: EfficiencyContext,
): MeldDecision {
  if (!canFormMeld(hand, discard, type)) {
    return { shouldCall: false, improves: false };
  }

  // The meld consumes `used` tiles from our hand and adds one complete block.
  const used = type === 'chow' ? 2 : type === 'pung' ? 2 : 3;
  const withoutBlock = removeUsedTiles(hand, discard, type, used);

  const shantenBefore = shantenOfHand(hand);
  // After calling, we have 1 extra complete meld, so pass extraMelds=1.
  const shantenAfter = shantenOfHand(withoutBlock, 1);

  // Must genuinely bring us closer to winning.
  const improves = shantenAfter < shantenBefore;
  // The concealed remainder still needs an eye; calling should not leave the
  // hand eye-less.
  const eyePresent = countPairs(withoutBlock) >= 1;

  // Honors form cheap, high-value pungs; numbered chows are low-value opens.
  const honorMeld = isHonor(discard.suit);

  // Late in the round we are more willing to open to force a win.
  const stage = stageFromTilesDrawn(context.tilesDrawn);
  const lateBonus = stage === 'late' ? 30 : stage === 'mid' ? 10 : 0;
  const valueBonus = honorMeld ? 50 : type === 'chow' ? 0 : 20;

  // Hard gate: a meld that does not improve the hand, or that strands it
  // without an eye, is never worth opening.
  const shouldCall = improves && eyePresent && lateBonus + valueBonus >= 0;

  return { shouldCall, improves };
}

/** Remove the tiles used to complete `meldType` with `discard` from `hand`. */
function removeUsedTiles(
  hand: readonly Tile[],
  discard: Tile,
  type: 'pung' | 'kong' | 'chow',
  used: number,
): Tile[] {
  const remaining: Tile[] = [...hand];
  // Remove the non-discard tiles of the same face (pung/kong) or the
  // neighbours forming the chow.
  if (type === 'pung' || type === 'kong') {
    let removed = 0;
    for (let i = remaining.length - 1; i >= 0 && removed < used; i -= 1) {
      const t = remaining[i]!;
      if (t.suit === discard.suit && t.rank === discard.rank) {
        remaining.splice(i, 1);
        removed += 1;
      }
    }
  } else {
    // Chow: remove the two neighbours (discard itself is in the opponent's
    // pile, not our hand).
    const wanted = new Set<number>();
    if (remaining.some((t) => t.suit === discard.suit && t.rank === discard.rank - 1) &&
        remaining.some((t) => t.suit === discard.suit && t.rank === discard.rank + 1)) {
      wanted.add(discard.rank - 1);
      wanted.add(discard.rank + 1);
    } else if (remaining.some((t) => t.suit === discard.suit && t.rank === discard.rank - 1) &&
               remaining.some((t) => t.suit === discard.suit && t.rank === discard.rank - 2)) {
      wanted.add(discard.rank - 1);
      wanted.add(discard.rank - 2);
    } else {
      wanted.add(discard.rank + 1);
      wanted.add(discard.rank + 2);
    }
    for (let i = remaining.length - 1; i >= 0; i -= 1) {
      const t = remaining[i]!;
      if (t.suit === discard.suit && wanted.has(t.rank)) {
        remaining.splice(i, 1);
      }
    }
  }
  return remaining;
}

/** Count how many distinct pairs (faces with ≥2 copies) are in `hand`. */
function countPairs(hand: readonly Tile[]): number {
  const counts = new Map<string, number>();
  for (const t of hand) {
    const key = `${t.suit}-${t.rank}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let pairs = 0;
  for (const count of counts.values()) {
    if (count >= 2) pairs += 1;
  }
  return pairs;
}

/**
 * A discard strategy that also understands the richer {@link EfficiencyContext}
 * (seen tiles, riichi threat, round stage). Implemented by
 * {@link EfficiencyDiscardStrategy} and detected at runtime by {@link AIPlayer}
 * so a plain {@link DiscardStrategy} keeps working unchanged.
 */
export interface ContextAwareDiscardStrategy extends DiscardStrategy {
  chooseWithContext(
    hand: readonly Tile[],
    context: EfficiencyContext,
    avoidTileId?: string,
  ): Tile | null;
}

/** Narrowing type guard for {@link ContextAwareDiscardStrategy}. */
export function isContextAwareStrategy(
  strategy: DiscardStrategy,
): strategy is ContextAwareDiscardStrategy {
  return 'chooseWithContext' in strategy;
}

/**
 * The drop-in discard strategy class used by {@link AIPlayer}. Implements the
 * shared {@link DiscardStrategy} contract but reads its richer context from an
 * optional second argument, defaulting to a neutral context when only the hand
 * is provided (so existing AIPlayer wiring keeps working unchanged).
 */
export class EfficiencyDiscardStrategy implements ContextAwareDiscardStrategy {
  constructor(private readonly defaultContext: () => EfficiencyContext = () => neutralContext()) {}

  /** @inheritdoc */
  chooseTile(hand: readonly Tile[], avoidTileId?: string): Tile | null {
    return this.chooseWithContext(hand, this.defaultContext(), avoidTileId);
  }

  /** Choose a discard given full game context (the engine's path). */
  chooseWithContext(hand: readonly Tile[], context: EfficiencyContext, avoidTileId?: string): Tile | null {
    const { best } = evaluateDiscards(hand, context);
    if (best === null) return null;
    if (avoidTileId === undefined || best.tile.id !== avoidTileId) return best.tile;

    // The best discard is the protected tile; pick the next-best candidate.
    const second = evaluateDiscards(hand, context).candidates.find((c) => c.tile.id !== avoidTileId);
    return second?.tile ?? best.tile;
  }
}

/** A neutral context: no known discards, not under attack, mid game. */
export function neutralContext(): EfficiencyContext {
  return { seenTiles: [], opponentRiichi: false, tilesDrawn: 20 };
}
