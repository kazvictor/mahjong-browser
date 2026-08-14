/**
 * AIPlayer — autonomous CPU opponent.
 *
 * The AI is deliberately decoupled from the concrete `MahjongGame` engine
 * (which a sibling task owns). It depends only on the narrow `TurnController`
 * interface below, which the game engine implements. This keeps the AI fully
 * headlessly unit-testable with a fake controller and lets the engine evolve
 * without touching the AI.
 *
 * Behaviour (MVP): on its turn the AI waits a "thinking" delay, draws a tile,
 * automatically exposes any flower/season (drawing a replacement each time),
 * then discards a random tile via its strategy.
 */
import type { Hand, Player, Tile } from '../types';
import type { DiscardStrategy } from './random-discard-strategy';
import type { EfficiencyContext } from './tile-efficiency';
import { isContextAwareStrategy } from './tile-efficiency';
import { AI_THINK_TIME_MIN, AI_THINK_TIME_MAX } from '../../config/ai-config';

/**
 * The slice of the game engine an AI needs to take a turn.
 *
 * The game engine implements this so the AI never reaches into mutable game
 * state directly and can only act within its own turn.
 */
export interface TurnController {
  /**
   * True when it is the AI's turn and the game is in a phase where the AI
   * may act. Guards against the AI acting out of turn (stale callbacks,
   * races, re-entrancy).
   */
  canAct(playerId: number): boolean;

  /** Draw a tile from the wall for `playerId`. Returns the drawn tile. */
  draw(playerId: number): Tile | null;

  /**
   * Expose a flower/season bonus tile for `playerId` and draw its
   * replacement from the wall. Returns the replacement tile (which may itself
   * be a bonus tile, requiring another expose).
   */
  exposeBonus(playerId: number, bonusTile: Tile): Tile | null;

  /**
   * Discard `tile` from `playerId`'s hand. Returns false if the discard is
   * rejected (not the player's turn, tile not in hand, game over, etc.).
   */
  discard(playerId: number, tile: Tile): boolean;

  /**
   * Invoke `listener` whenever it becomes this controller's turn to act.
   * Returns an unsubscribe function.
   */
  onTurnStart(listener: (playerId: number) => void): () => void;

  /** A read-only snapshot of `playerId`'s concealed hand at this moment. */
  handSnapshot(playerId: number): readonly Tile[];

  /**
   * Optional richer context for efficiency-aware strategies. When implemented,
   * the AI feeds it to {@link EfficiencyDiscardStrategy.chooseWithContext} so
   * discard decisions can use seen tiles, riichi threat, stage, etc. A
   * controller that does not track this returns `null` (the AI falls back to
   * the hand-only path).
   */
  aiContextSnapshot?(playerId: number): EfficiencyContext | null;
}

/** Options used to construct an AIPlayer (mostly for tests/tuning). */
export interface AIPlayerOptions {
  /**
   * Delay function in milliseconds. Defaults to a random delay within
   * [AI_THINK_TIME_MIN, AI_THINK_TIME_MAX]. Injectable so tests run instantly.
   */
  thinkTimeMs?: () => number;
  /** Wait function; defaults to `setTimeout`. Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * A CPU-controlled player at the table.
 *
 * `isAI` is always `true`; `id` and `seat` identify the seat (0 is East).
 */
export class AIPlayer implements Player {
  readonly isAI = true;
  readonly id: number;
  readonly seat: number;
  /** The AI's concealed hand plus melds and bonus tiles. */
  hand: Hand;
  score = 0;

  private readonly strategy: DiscardStrategy;
  private readonly thinkTimeMs: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** True while the AI is actively processing its turn (for "Thinking…" UI). */
  thinking = false;
  /** Guard against concurrent/overlapping turn processing. */
  private acting = false;
  private lastDrawnTileId: string | undefined;

  constructor(
    id: number,
    seat: number,
    strategy: DiscardStrategy,
    options: AIPlayerOptions = {},
  ) {
    this.id = id;
    this.seat = seat;
    this.strategy = strategy;
    this.hand = { tiles: [], melds: [], bonusTiles: [] };
    this.thinkTimeMs =
      options.thinkTimeMs ?? (() => AI_THINK_TIME_MIN + Math.random() * (AI_THINK_TIME_MAX - AI_THINK_TIME_MIN));
    this.sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  }

  /**
   * Attach the AI to a controller and start listening for its turns.
   *
   * Returns an unsubscribe function that should be called when the game ends.
   */
  connect(controller: TurnController): () => void {
    return controller.onTurnStart((playerId) => {
      if (playerId === this.id) {
        void this.playTurn(controller);
      }
    });
  }

  /**
   * Play one full turn: think → draw → expose bonuses → discard.
   *
   * Re-entrancy-safe: concurrent calls while a turn is in progress are
   * ignored, and every action is re-guarded by `controller.canAct`.
   */
  async playTurn(controller: TurnController): Promise<void> {
    if (this.acting || !controller.canAct(this.id)) {
      return;
    }
    this.acting = true;
    this.thinking = true;

    try {
      // Simulate deliberation before drawing.
      await this.sleep(this.thinkTimeMs());

      // No longer our turn (another player claimed/ended meanwhile)? Abort.
      if (!controller.canAct(this.id)) {
        return;
      }

      // Draw the 14th tile.
      let drawn = controller.draw(this.id);
      if (drawn === null) {
        // Wall exhausted; nothing to do.
        return;
      }
      this.lastDrawnTileId = drawn.id;

      // Expose flowers/seasons immediately, drawing a replacement each time.
      while (drawn !== null && isBonusTile(drawn)) {
        if (!controller.canAct(this.id)) {
          return;
        }
        drawn = controller.exposeBonus(this.id, drawn);
        if (drawn !== null) {
          this.lastDrawnTileId = drawn.id;
        }
      }

      // Choose a discard, protecting the just-drawn tile if it completes a
      // meld. The concrete hand is owned by the engine; the strategy decides
      // from the controller's perspective, so we pass the drawn tile as the
      // tile to favour keeping. When the controller and strategy both support
      // the richer context path, feed it the seen tiles / riichi threat so the
      // efficiency AI can play defensively and value tiles by stage.
      const hand = controller.handSnapshot(this.id);
      const context = controller.aiContextSnapshot?.(this.id) ?? null;
      let tileToDiscard: Tile | null;
      if (context && isContextAwareStrategy(this.strategy)) {
        tileToDiscard = this.strategy.chooseWithContext(hand, context, this.lastDrawnTileId);
      } else {
        tileToDiscard = this.strategy.chooseTile(hand, this.lastDrawnTileId);
      }

      if (tileToDiscard !== null) {
        if (!controller.canAct(this.id)) {
          return;
        }
        controller.discard(this.id, tileToDiscard);
      }
    } finally {
      this.thinking = false;
      this.acting = false;
    }
  }

  /** True while the AI is mid-turn (for rendering a "Thinking…" badge). */
  get isThinking(): boolean {
    return this.thinking;
  }
}

/** True when a tile is a flower/season bonus tile. */
function isBonusTile(tile: Tile): boolean {
  return tile.suit === 'flowers' || tile.suit === 'seasons';
}
