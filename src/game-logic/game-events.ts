/**
 * Typed event system for the Mahjong game.
 *
 * Every state change is communicated through an `EventBus`. The renderer and
 * UI subscribe to events to animate and update; the QA hook records the last
 * event for deterministic assertions. Events are the single source of truth
 * for "what happened" — the `GameState` snapshot is the source of truth for
 * "what is now".
 */
import type { Hand, Meld, Tile } from './types';

/** A tile drawn from the wall or a kong-replacement tile. */
export interface TileDrawn {
  readonly type: 'TILE_DRAWN';
  readonly playerId: number;
  readonly tile: Tile;
  readonly from: 'WALL' | 'KONG_REPLACEMENT';
}

/** A tile discarded by a player. */
export interface TileDiscarded {
  readonly type: 'TILE_DISCARDED';
  readonly playerId: number;
  readonly tile: Tile;
}

/** A tile claimed from another player's discard. */
export interface TileClaimed {
  readonly type: 'TILE_CLAIMED';
  readonly playerId: number;
  readonly tile: Tile;
  readonly fromPlayer: number;
}

/** A meld (pung/kong/chow) declared and exposed. */
export interface MeldCalled {
  readonly type: 'MELD_CALLED';
  readonly playerId: number;
  readonly meld: Meld;
}

/** A win declared by a player, with the resolved faan and score. */
export interface WinDeclared {
  readonly type: 'WIN_DECLARED';
  readonly playerId: number;
  readonly hand: Hand;
  readonly faan: number;
  readonly score: number;
}

/** The game started; a new round is being dealt. */
export interface GameStarted {
  readonly type: 'GAME_STARTED';
  readonly seed: number;
  readonly dealer: number;
}

/** The round ended; scores are tallied. */
export interface RoundEnded {
  readonly type: 'ROUND_ENDED';
  readonly winner: number | null;
  readonly scores: readonly number[];
}

/** A player's turn began. */
export interface TurnStarted {
  readonly type: 'TURN_STARTED';
  readonly playerId: number;
}

/** A player's turn ended. */
export interface TurnEnded {
  readonly type: 'TURN_ENDED';
  readonly playerId: number;
}

/** The union of every event the game can emit. */
export type GameEvent =
  | GameStarted
  | RoundEnded
  | TileDrawn
  | TileDiscarded
  | TileClaimed
  | MeldCalled
  | WinDeclared
  | TurnStarted
  | TurnEnded;

type Listener<E extends GameEvent> = (event: E) => void;

/**
 * A minimal typed event bus. Subscribers register per event type and receive
 * an unsubscribe function. The most recent event is retained for the QA hook.
 */
export class EventBus {
  private readonly listeners = new Map<GameEvent['type'], Set<Listener<GameEvent>>>();
  private lastEvent: GameEvent | null = null;

  /** Subscribe to an event type; returns an unsubscribe function. */
  on<E extends GameEvent['type']>(
    type: E,
    listener: Listener<Extract<GameEvent, { type: E }>>,
  ): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set<Listener<GameEvent>>();
      this.listeners.set(type, set);
    }
    set.add(listener as Listener<GameEvent>);
    return () => {
      set.delete(listener as Listener<GameEvent>);
    };
  }

  /** Emit an event to all subscribers of its type. */
  emit(event: GameEvent): void {
    this.lastEvent = event;
    this.listeners.get(event.type)?.forEach((listener) => listener(event));
  }

  /** QA hook: the most recent event, for deterministic assertions. */
  getLastEvent(): GameEvent | null {
    return this.lastEvent;
  }
}
