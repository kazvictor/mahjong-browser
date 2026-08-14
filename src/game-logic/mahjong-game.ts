/**
 * MahjongGame — the authoritative game state machine.
 *
 * Owns the phase state machine, the wall, the players' hands, and the event
 * bus. Every public method validates the current phase and the move before
 * mutating state, then emits the corresponding GameEvent. This single command
 * surface keeps the rules engine a pure function of (state, action), which is
 * what makes the whole rules layer deterministic and unit-testable.
 */
import { EventBus, type GameEvent } from './game-events';
import { GameState, transition } from './game-state';
import { detectMeldOpportunities, type MeldOpportunity } from './meld-system';
import { detectWin, type WinResult } from './win-detection';
import { scoreWin, type ScoreResult } from './scoring';
import type { Hand, Meld, MeldType, Player, Suit, Tile } from './types';

/** Number of players in a Mahjong game. */
export const PLAYER_COUNT = 4;

/** Number of concealed tiles each player holds after the deal. */
export const HAND_SIZE = 13;

/** A full 144-tile wall: 4 copies of each of 34 faces plus 8 bonus tiles. */
const SUITS: readonly Suit[] = ['bamboo', 'characters', 'dots'];
const WIND_RANKS = [1, 2, 3, 4] as const;
const DRAGON_RANKS = [1, 2, 3] as const;
const BONUS_RANKS = [1, 2, 3, 4] as const;

/** Build the 144-tile wall in canonical order (shuffled later). */
function buildWall(): Tile[] {
  const wall: Tile[] = [];
  let id = 0;
  const push = (suit: Suit, rank: number): void => {
    wall.push({ id: `t${id++}`, suit, rank });
  };
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 9; rank++) {
      for (let copy = 0; copy < 4; copy++) push(suit, rank);
    }
  }
  for (const rank of WIND_RANKS) {
    for (let copy = 0; copy < 4; copy++) push('winds', rank);
  }
  for (const rank of DRAGON_RANKS) {
    for (let copy = 0; copy < 4; copy++) push('dragons', rank);
  }
  for (const rank of BONUS_RANKS) {
    push('flowers', rank);
    push('seasons', rank);
  }
  return wall;
}

/** Deterministic PRNG (mulberry32) so games are replayable from a seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle driven by a seeded RNG. */
function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** A player's live hand state (mutable; exposed read-only via snapshots). */
interface PlayerState {
  readonly id: number;
  readonly seat: number;
  readonly isAI: boolean;
  tiles: Tile[];
  melds: Meld[];
  bonusTiles: Tile[];
  score: number;
}

/** The mutable internal state of a round. */
interface RoundState {
  wall: Tile[];
  deadWall: Tile[];
  discardPile: Tile[];
  players: PlayerState[];
  currentPlayer: number;
  dealer: number;
  round: number;
  seed: number;
  /** Resolved when a win is declared; cleared on the next round. */
  winResult?: WinResult | null;
  scoreResult?: ScoreResult | null;
  /**
   * The most recent discard, held until the turn resolves (next draw, a
   * claim, or a pass). Other players may claim this tile as a chow/pung/kong.
   * Cleared once the discard is either claimed or the turn advances.
   */
  pendingDiscard?: Tile | null;
}

/** A read-only snapshot of the game, handed to the renderer each frame. */
export interface GameSnapshot {
  readonly phase: GameState;
  readonly players: readonly Player[];
  readonly wall: readonly Tile[];
  readonly deadWall: readonly Tile[];
  readonly discardPile: readonly Tile[];
  readonly currentPlayer: number;
  readonly dealer: number;
  readonly round: number;
  readonly seed: number;
  readonly lastEvent: GameEvent | null;
  /** The resolved winning hand, set once a win is declared. */
  readonly winResult?: WinResult | null;
  /** The resolved score for the winning hand, set once a win is declared. */
  readonly scoreResult?: ScoreResult | null;
  /** The tile most recently discarded and currently claimable, if any. */
  readonly pendingDiscard?: Tile | null;
}

/** The public command surface for the game. */
export class MahjongGame {
  private readonly bus = new EventBus();
  private phase: GameState = GameState.IDLE;
  private round: RoundState | null = null;

  /** Subscribe to a game event; returns an unsubscribe function. */
  on<E extends GameEvent['type']>(
    type: E,
    listener: (event: Extract<GameEvent, { type: E }>) => void,
  ): () => void {
    return this.bus.on(type, listener);
  }

  /** The current phase of the state machine. */
  getPhase(): GameState {
    return this.phase;
  }

  /** The most recent event emitted (QA hook). */
  getLastEvent(): GameEvent | null {
    return this.bus.getLastEvent();
  }

  /** A read-only snapshot of the current game state. */
  getState(): GameSnapshot {
    const round = this.round;
    if (!round) {
      return {
        phase: this.phase,
        players: [],
        wall: [],
        deadWall: [],
        discardPile: [],
        currentPlayer: 0,
        dealer: 0,
        round: 0,
        seed: 0,
        lastEvent: this.bus.getLastEvent(),
        winResult: null,
        scoreResult: null,
        pendingDiscard: null,
      };
    }
    return {
      phase: this.phase,
      players: round.players.map((p) => ({
        id: p.id,
        seat: p.seat,
        isAI: p.isAI,
        score: p.score,
        hand: { tiles: p.tiles, melds: p.melds, bonusTiles: p.bonusTiles },
      })),
      wall: round.wall,
      deadWall: round.deadWall,
      discardPile: round.discardPile,
      currentPlayer: round.currentPlayer,
      dealer: round.dealer,
      round: round.round,
      seed: round.seed,
      lastEvent: this.bus.getLastEvent(),
      winResult: round.winResult,
      scoreResult: round.scoreResult,
      pendingDiscard: round.pendingDiscard ?? null,
    };
  }

  /**
   * Start a new round: IDLE -> DEALING. Builds and shuffles the wall, then
   * deals 13 tiles to each player (the dealer gets a 14th on their first
   * draw). Emits GAME_STARTED.
   */
  startGame(seed?: number): void {
    this.assertPhase(GameState.IDLE, 'startGame');
    const rngSeed = seed ?? Math.floor(Math.random() * 0xffffffff);
    const rng = mulberry32(rngSeed);
    const wall = shuffle(buildWall(), rng);

    const players: PlayerState[] = [];
    for (let i = 0; i < PLAYER_COUNT; i++) {
      players.push({ id: i, seat: i, isAI: i !== 0, tiles: [], melds: [], bonusTiles: [], score: 0 });
    }

    // Deal 13 tiles to each player from the top of the wall.
    for (let round = 0; round < HAND_SIZE; round++) {
      for (const player of players) {
        const tile = wall.pop();
        if (!tile) throw new Error('Wall exhausted during deal.');
        player.tiles.push(tile);
      }
    }

    this.round = {
      wall,
      deadWall: [],
      discardPile: [],
      players,
      currentPlayer: 0,
      dealer: 0,
      round: 1,
      seed: rngSeed,
      winResult: null,
      scoreResult: null,
    };

    this.phase = transition(this.phase, 'START_GAME');
    this.bus.emit({ type: 'GAME_STARTED', seed: rngSeed, dealer: 0 });
  }

  /**
   * Complete the deal: DEALING -> DRAW. The dealer draws their 14th tile and
   * the round enters the DRAW phase. Emits TILE_DRAWN and TURN_STARTED.
   */
  dealComplete(): void {
    this.assertPhase(GameState.DEALING, 'dealComplete');
    const round = this.requireRound();
    const dealer = round.players[round.dealer]!;
    const tile = round.wall.pop();
    if (!tile) throw new Error('Wall exhausted during dealer draw.');
    dealer.tiles.push(tile);

    this.phase = transition(this.phase, 'DEAL_COMPLETE');
    this.bus.emit({ type: 'TILE_DRAWN', playerId: dealer.id, tile, from: 'WALL' });
    this.bus.emit({ type: 'TURN_STARTED', playerId: dealer.id });
  }

  /**
   * The dealer opens by discarding one of their 14 tiles: DRAW -> DISCARD.
   *
   * After `dealComplete()` the dealer already holds a 14th tile but has not
   * drawn one, so the normal `drawTile()` path (DRAW -> DISCARD with a fresh
   * wall draw) is wrong for the opening move. This mirrors {@link discardTile}
   * but is legal from the DRAW phase, emitting TILE_DISCARDED + TURN_ENDED so
   * the turn advances to the next player.
   */
  discardOpening(tileId: string): void {
    this.assertPhase(GameState.DRAW, 'discardOpening');
    const round = this.requireRound();
    const player = round.players[round.currentPlayer]!;
    const index = player.tiles.findIndex((t) => t.id === tileId);
    if (index === -1) {
      throw new Error(`Tile ${tileId} is not in player ${player.id}'s hand.`);
    }
    const [tile] = player.tiles.splice(index, 1);
    round.discardPile.push(tile!);
    round.pendingDiscard = tile!;

    this.phase = transition(this.phase, 'OPENING_DISCARD');
    this.bus.emit({ type: 'TILE_DISCARDED', playerId: player.id, tile: tile! });
    this.bus.emit({ type: 'TURN_ENDED', playerId: player.id });
  }

  /**
   * The current player draws a tile from the wall: DRAW -> DISCARD.
   * Emits TILE_DRAWN.
   */
  drawTile(): void {
    this.assertPhase(GameState.DRAW, 'drawTile');
    const round = this.requireRound();
    const player = round.players[round.currentPlayer]!;
    const tile = round.wall.pop();
    if (!tile) throw new Error('Wall exhausted — no tile to draw.');

    player.tiles.push(tile);
    this.phase = transition(this.phase, 'DRAW_TILE');
    this.bus.emit({ type: 'TILE_DRAWN', playerId: player.id, tile, from: 'WALL' });
  }

  /**
   * The current player discards a tile: stays in DISCARD so other players may
   * claim the tile. Emits TILE_DISCARDED and TURN_ENDED. The round advances to
   * the next player's DRAW only via `nextTurn()` (or a claim via
   * `claimDiscard`).
   */
  discardTile(tileId: string): void {
    this.assertPhase(GameState.DISCARD, 'discardTile');
    const round = this.requireRound();
    const player = round.players[round.currentPlayer]!;
    const index = player.tiles.findIndex((t) => t.id === tileId);
    if (index === -1) {
      throw new Error(`Tile ${tileId} is not in player ${player.id}'s hand.`);
    }
    const [tile] = player.tiles.splice(index, 1);
    round.discardPile.push(tile!);
    round.pendingDiscard = tile!;

    this.bus.emit({ type: 'TILE_DISCARDED', playerId: player.id, tile: tile! });
    this.bus.emit({ type: 'TURN_ENDED', playerId: player.id });
  }

  /**
   * Advance to the next player's turn: DISCARD -> DRAW (normal flow, no claim).
   * Emits TURN_STARTED for the next player.
   */
  nextTurn(): void {
    this.assertPhase(GameState.DISCARD, 'nextTurn');
    const round = this.requireRound();
    round.currentPlayer = (round.currentPlayer + 1) % PLAYER_COUNT;
    // The discard window closes; no further claims are allowed this turn.
    round.pendingDiscard = null;
    this.phase = transition(this.phase, 'DISCARD_TILE');
    this.bus.emit({ type: 'TURN_STARTED', playerId: round.currentPlayer });
  }

  /**
   * Another player claims a just-discarded tile as a pung/kong/chow:
   * DISCARD -> DECLARE. Emits TILE_CLAIMED.
   */
  claimDiscard(playerId: number, tileId: string, meldType: MeldType): void {
    this.assertPhase(GameState.DISCARD, 'claimDiscard');
    const round = this.requireRound();
    const discardIndex = round.discardPile.findIndex((t) => t.id === tileId);
    if (discardIndex === -1) {
      throw new Error(`Tile ${tileId} is not in the discard pile.`);
    }
    const [tile] = round.discardPile.splice(discardIndex, 1);
    const claimant = round.players[playerId];
    if (!claimant) throw new Error(`Unknown player ${playerId}.`);

    // The claimant must already hold the tiles needed to complete the meld.
    const needed = meldType === 'pung' ? 2 : meldType === 'kong' ? 3 : 2;
    const matching = claimant.tiles.filter((t) => t.suit === tile!.suit && t.rank === tile!.rank);
    if (matching.length < needed) {
      throw new Error(`Player ${playerId} cannot form a ${meldType} with ${tileId}.`);
    }

    const meldTiles = [...matching.slice(0, needed), tile!];
    const meld: Meld = {
      type: meldType,
      tiles: meldTiles,
      isConcealed: false,
      sourcePlayer: round.currentPlayer,
    };
    claimant.melds.push(meld);
    for (const t of matching.slice(0, needed)) {
      const i = claimant.tiles.findIndex((x) => x.id === t.id);
      if (i !== -1) claimant.tiles.splice(i, 1);
    }
    // The claimed tile is consumed; no further claims on it.
    round.pendingDiscard = null;

    this.phase = transition(this.phase, 'CLAIM_DISCARD');
    this.bus.emit({ type: 'TILE_CLAIMED', playerId, tile: tile!, fromPlayer: round.currentPlayer });
    this.bus.emit({ type: 'MELD_CALLED', playerId, meld });
  }

  /**
   * A player declares a win: DECLARE -> WIN or DISCARD -> WIN.
   * Validates the hand, resolves the winning pattern and score, and emits
   * WIN_DECLARED carrying the {@link WinResult} and {@link ScoreResult}.
   */
  declareWin(playerId: number, isSelfDraw: boolean): void {
    if (this.phase !== GameState.DECLARE && this.phase !== GameState.DISCARD) {
      throw new Error(`declareWin is not legal in phase ${this.phase}.`);
    }
    const round = this.requireRound();
    const player = round.players[playerId];
    if (!player) throw new Error(`Unknown player ${playerId}.`);

    const hand: Hand = { tiles: player.tiles, melds: player.melds, bonusTiles: player.bonusTiles };
    const win = detectWin(hand);
    if (!win) {
      throw new Error(`Player ${playerId} does not have a winning hand.`);
    }

    const score = scoreWin(win);
    const scoreTotal = score.total;

    // Persist the resolved win on the round so a snapshot (and the renderer)
    // can read it back after the WIN transition.
    round.winResult = win;
    round.scoreResult = score;

    this.phase = transition(this.phase, 'DECLARE_WIN');
    this.bus.emit({
      type: 'WIN_DECLARED',
      playerId,
      hand,
      win,
      score,
      isSelfDraw,
      scoreTotal,
    });
  }

  /**
   * A player declares a meld on the just-drawn tile: DECLARE -> MELD.
   * Emits MELD_CALLED.
   */
  declareMeld(playerId: number, meld: Meld): void {
    if (this.phase !== GameState.DECLARE && this.phase !== GameState.MELD_DECLARATION) {
      throw new Error(`declareMeld is not legal in phase ${this.phase}.`);
    }
    const round = this.requireRound();
    const player = round.players[playerId];
    if (!player) throw new Error(`Unknown player ${playerId}.`);

    player.melds.push(meld);
    // MELD_DECLARATION is a named alias of DECLARE; the transition table keys
    // on DECLARE, so normalize before looking up the edge.
    this.phase = transition(
      this.phase === GameState.MELD_DECLARATION ? GameState.DECLARE : this.phase,
      'DECLARE_MELD',
    );
    this.bus.emit({ type: 'MELD_CALLED', playerId, meld });
  }

  /**
   * A player passes all declarations: DECLARE -> DISCARD.
   */
  pass(): void {
    if (this.phase !== GameState.DECLARE && this.phase !== GameState.MELD_DECLARATION) {
      throw new Error(`pass is not legal in phase ${this.phase}.`);
    }
    this.phase = transition(
      this.phase === GameState.MELD_DECLARATION ? GameState.DECLARE : this.phase,
      'PASS',
    );
  }

  // ---- Meld opportunities (chow / pung / kong on an opponent's discard) ----

  /** The tile most recently discarded and still claimable, if any. */
  getPendingDiscard(): Tile | null {
    return this.round?.pendingDiscard ?? null;
  }

  /**
   * The meld opportunities (chow/pung/kong) available to `playerId` on the
   * currently pending discard. Returns an empty array when there is no
   * pending discard or the player cannot claim anything.
   */
  getMeldOpportunities(playerId: number): MeldOpportunity[] {
    const round = this.requireRound();
    const discard = round.pendingDiscard;
    if (!discard) return [];
    const player = round.players[playerId];
    if (!player) return [];
    return detectMeldOpportunities(player.tiles, discard);
  }

  /**
   * True when `playerId` currently has at least one claimable meld on the
   * pending discard. This is the trigger for the UI meld prompt and for the
   * AI's automatic claims.
   */
  hasMeldOpportunity(playerId: number): boolean {
    return this.getMeldOpportunities(playerId).length > 0;
  }

  /**
   * Accept a meld opportunity on the currently pending discard in one call:
   * removes the player's matching hand tiles + the discarded tile, exposes
   * the meld, draws a kong replacement when applicable, and transfers the
   * turn to the claimant.
   *
   * This is the authoritative high-level command the UI prompt and AI use to
   * complete a claim. It is legal from the DISCARD phase (the discard window)
   * or the MELD_DECLARATION phase (the prompt is showing).
   *
   * @returns the exposed meld.
   */
  acceptMeldOpportunity(playerId: number, type: MeldType): Meld {
    if (this.phase !== GameState.DISCARD && this.phase !== GameState.MELD_DECLARATION) {
      throw new Error(`acceptMeldOpportunity is not legal in phase ${this.phase}.`);
    }
    const round = this.requireRound();
    const player = round.players[playerId];
    if (!player) throw new Error(`Unknown player ${playerId}.`);
    const discard = round.pendingDiscard;
    if (!discard) throw new Error('No pending discard to claim.');

    // Find the matching opportunity and validate it is genuinely available.
    const opp = detectMeldOpportunities(player.tiles, discard).find((o) => o.type === type);
    if (!opp) {
      throw new Error(`Player ${playerId} cannot form a ${type} with the pending discard.`);
    }

    // Remove the claimed tile from the discard pile (it moves into the meld).
    const discardIndex = round.discardPile.findIndex((t) => t.id === discard.id);
    if (discardIndex !== -1) round.discardPile.splice(discardIndex, 1);
    // Remove the claimant's matching hand tiles.
    for (const id of opp.handTileIds) {
      const i = player.tiles.findIndex((t) => t.id === id);
      if (i !== -1) player.tiles.splice(i, 1);
    }

    const meld: Meld = {
      type,
      tiles: opp.tiles,
      isConcealed: false,
      sourcePlayer: round.currentPlayer,
    };
    player.melds.push(meld);
    round.pendingDiscard = null;

    // Complete the declaration: DECLARE/MELD_DECLARATION -> MELD, then MELD -> DRAW.
    if (this.phase === GameState.DISCARD) {
      this.phase = transition(GameState.DISCARD, 'CLAIM_DISCARD');
    }
    this.phase = transition(GameState.DECLARE, 'DECLARE_MELD');
    this.bus.emit({ type: 'MELD_CALLED', playerId, meld });

    // Kong claims draw a replacement tile.
    if (type === 'kong') {
      const replacement = round.wall.pop();
      if (replacement) {
        player.tiles.push(replacement);
        this.bus.emit({ type: 'TILE_DRAWN', playerId, tile: replacement, from: 'KONG_REPLACEMENT' });
      }
    }

    round.currentPlayer = playerId;
    this.phase = transition(GameState.MELD, 'MELD_COMPLETE');
    this.bus.emit({ type: 'TURN_STARTED', playerId });
    return meld;
  }

  /**
   * Complete a meld: MELD -> DRAW. Draws a kong-replacement tile if the meld
   * was a kong. Emits TILE_DRAWN (from KONG_REPLACEMENT) when applicable.
   */
  meldComplete(playerId: number): void {
    this.assertPhase(GameState.MELD, 'meldComplete');
    const round = this.requireRound();
    const player = round.players[playerId];
    if (!player) throw new Error(`Unknown player ${playerId}.`);

    const lastMeld = player.melds[player.melds.length - 1];
    if (lastMeld && lastMeld.type === 'kong') {
      const tile = round.wall.pop();
      if (tile) {
        player.tiles.push(tile);
        this.bus.emit({ type: 'TILE_DRAWN', playerId, tile, from: 'KONG_REPLACEMENT' });
      }
    }

    round.currentPlayer = playerId;
    this.phase = transition(this.phase, 'MELD_COMPLETE');
    this.bus.emit({ type: 'TURN_STARTED', playerId });
  }

  /**
   * End the round and tally scores: WIN -> GAME_OVER. Emits ROUND_ENDED.
   */
  endRound(): void {
    this.assertPhase(GameState.WIN, 'endRound');
    const round = this.requireRound();
    const scores = round.players.map((p) => p.score);
    this.phase = transition(this.phase, 'ROUND_END');
    this.bus.emit({ type: 'ROUND_ENDED', winner: null, scores });
  }

  private assertPhase(expected: GameState, method: string): void {
    if (this.phase !== expected) {
      throw new Error(`${method} is not legal in phase ${this.phase} (expected ${expected}).`);
    }
  }

  private requireRound(): RoundState {
    if (!this.round) {
      throw new Error('No round in progress — call startGame() first.');
    }
    return this.round;
  }
}
