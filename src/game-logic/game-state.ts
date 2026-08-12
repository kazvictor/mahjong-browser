/**
 * Discrete phase state machine for a Mahjong round.
 *
 * The machine is an explicit transition table rather than a framework: it is
 * dependency-free, trivially unit-testable, and every illegal transition
 * throws. `MahjongGame` owns an instance of this machine and drives it via
 * `transition()`.
 */

/** The discrete phases a Mahjong round can occupy. */
export enum GameState {
  /** No round in progress; menu / between rounds. */
  IDLE = 'IDLE',
  /** Wall is being built and tiles dealt to each player. */
  DEALING = 'DEALING',
  /** Current player draws a tile from the wall. */
  DRAW = 'DRAW',
  /** Current player discards one tile. */
  DISCARD = 'DISCARD',
  /** A player may declare win, meld, or pass. */
  DECLARE = 'DECLARE',
  /** A player exposes a pung/kong/chow and draws a replacement if applicable. */
  MELD = 'MELD',
  /** A player has a winning hand; scoring resolves. */
  WIN = 'WIN',
  /** Round ended; scores tallied, next round or game over. */
  GAME_OVER = 'GAME_OVER',
}

/** The actions that can drive a phase transition. */
export type PhaseAction =
  | 'START_GAME'
  | 'DEAL_COMPLETE'
  | 'DRAW_TILE'
  | 'DISCARD_TILE'
  | 'DECLARE_WIN'
  | 'DECLARE_MELD'
  | 'MELD_COMPLETE'
  | 'PASS'
  | 'CLAIM_DISCARD'
  | 'ROUND_END'
  | 'OPENING_DISCARD';

/** A single legal transition edge: from a phase, an action leads to a phase. */
export interface PhaseTransition {
  readonly from: GameState;
  readonly action: PhaseAction;
  readonly to: GameState;
}

/**
 * The full transition table. Every legal edge in the task spec is listed
 * explicitly; anything not present here is illegal and throws.
 */
export const PHASE_TRANSITIONS: readonly PhaseTransition[] = [
  // IDLE -> DEALING: game starts, wall is built.
  { from: GameState.IDLE, action: 'START_GAME', to: GameState.DEALING },
  // DEALING -> DRAW: all 13 tiles dealt to each player (dealer 14).
  { from: GameState.DEALING, action: 'DEAL_COMPLETE', to: GameState.DRAW },
  // DRAW -> DISCARD: player draws 14th tile, then discards.
  { from: GameState.DRAW, action: 'DRAW_TILE', to: GameState.DISCARD },
  // DRAW -> DISCARD: the dealer opens by discarding their 14th tile (no draw).
  { from: GameState.DRAW, action: 'OPENING_DISCARD', to: GameState.DISCARD },
  // DISCARD -> DRAW: next player turn (normal flow).
  { from: GameState.DISCARD, action: 'DISCARD_TILE', to: GameState.DRAW },
  // DISCARD -> DECLARE: another player calls pung/kong/pong on the discard.
  { from: GameState.DISCARD, action: 'CLAIM_DISCARD', to: GameState.DECLARE },
  // DISCARD -> WIN: a player wins on the discard (kong pao / chow pao).
  { from: GameState.DISCARD, action: 'DECLARE_WIN', to: GameState.WIN },
  // DECLARE -> MELD: meld is exposed.
  { from: GameState.DECLARE, action: 'DECLARE_MELD', to: GameState.MELD },
  // DECLARE -> WIN: player declares win (self-draw).
  { from: GameState.DECLARE, action: 'DECLARE_WIN', to: GameState.WIN },
  // DECLARE -> DISCARD: player passes all declarations.
  { from: GameState.DECLARE, action: 'PASS', to: GameState.DISCARD },
  // MELD -> DRAW: after meld completion (bonus tile drawn if applicable).
  { from: GameState.MELD, action: 'MELD_COMPLETE', to: GameState.DRAW },
  // WIN -> GAME_OVER: round ends, scores tallied.
  { from: GameState.WIN, action: 'ROUND_END', to: GameState.GAME_OVER },
];

/** Index of legal transitions keyed by `from` phase for O(1) lookup. */
const TRANSITION_INDEX: ReadonlyMap<GameState, ReadonlyMap<PhaseAction, GameState>> =
  (() => {
    const index = new Map<GameState, Map<PhaseAction, GameState>>();
    for (const t of PHASE_TRANSITIONS) {
      let byAction = index.get(t.from);
      if (!byAction) {
        byAction = new Map<PhaseAction, GameState>();
        index.set(t.from, byAction);
      }
      byAction.set(t.action, t.to);
    }
    return index;
  })();

/**
 * Apply an action to the current phase, returning the next phase.
 *
 * @throws {Error} if the action is not a legal transition from `from`.
 */
export function transition(from: GameState, action: PhaseAction): GameState {
  const next = TRANSITION_INDEX.get(from)?.get(action);
  if (next === undefined) {
    throw new Error(
      `Illegal transition ${from} --${action}--> ? (no such edge in the state machine)`,
    );
  }
  return next;
}

/** True when `action` is a legal transition from `from`. */
export function canTransition(from: GameState, action: PhaseAction): boolean {
  return TRANSITION_INDEX.get(from)?.has(action) ?? false;
}
