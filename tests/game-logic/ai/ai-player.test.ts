/**
 * Unit tests for AIPlayer turn behaviour.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Tile } from '../../../src/game-logic/types';
import { AIPlayer, type TurnController } from '../../../src/game-logic/ai/ai-player';
import { RandomDiscardStrategy } from '../../../src/game-logic/ai/random-discard-strategy';

/** Build a tile with the current shared shape (id, suit, rank). */
function tile(suit: Tile['suit'], rank: number, id?: string): Tile {
  return { id: id ?? `${suit}-${rank}`, suit, rank };
}

/**
 * Build a bonus tile. The shared `Suit` type only lists `'flowers'` today
 * (a sibling task owns it and will add `'seasons'`), so we cast the suit
 * string to keep the test compiling against the in-flight type.
 */
function bonusTile(suit: string, rank: number, id: string): Tile {
  return { id, suit: suit as Tile['suit'], rank };
}

/** A controllable fake of the game engine's turn interface. */
class FakeController implements TurnController {
  canAct = vi.fn<() => boolean>(() => true);
  draw = vi.fn<(playerId: number) => Tile | null>(() => tile('dots', 1, 'drawn'));
  exposeBonus = vi.fn<(playerId: number, bonusTile: Tile) => Tile | null>(() => null);
  discard = vi.fn<(playerId: number, tile: Tile) => boolean>(() => true);
  handSnapshot = vi.fn<(playerId: number) => readonly Tile[]>(() => [
    tile('dots', 1, 'drawn'),
    tile('bamboo', 2, 'b'),
  ]);
  private listeners: Array<(playerId: number) => void> = [];

  onTurnStart(listener: (playerId: number) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /** Fire a turn-start for `playerId` synchronously. */
  fireTurnStart(playerId: number): void {
    for (const listener of this.listeners) {
      listener(playerId);
    }
  }
}

/** Build an AIPlayer that acts instantly (no real delay). */
function instantAI(id = 0, seat = 0): AIPlayer {
  return new AIPlayer(id, seat, new RandomDiscardStrategy(() => 0), {
    thinkTimeMs: () => 0,
    sleep: async () => undefined,
  });
}

describe('AIPlayer', () => {
  it('exposes isAI, id and seat', () => {
    const ai = instantAI(3, 2);
    expect(ai.isAI).toBe(true);
    expect(ai.id).toBe(3);
    expect(ai.seat).toBe(2);
  });

  it('draws and discards on its turn', async () => {
    const controller = new FakeController();
    const ai = instantAI(0, 0);
    ai.connect(controller);

    await ai.playTurn(controller);

    expect(controller.draw).toHaveBeenCalledWith(0);
    expect(controller.discard).toHaveBeenCalledTimes(1);
    expect(controller.discard.mock.calls[0]?.[0]).toBe(0);
  });

  it('does nothing when it is not the AI\'s turn', async () => {
    const controller = new FakeController();
    controller.canAct.mockReturnValue(false);
    const ai = instantAI(0, 0);

    await ai.playTurn(controller);

    expect(controller.draw).not.toHaveBeenCalled();
    expect(controller.discard).not.toHaveBeenCalled();
  });

  it('exposes a flower and draws a replacement', async () => {
    const controller = new FakeController();
    controller.draw.mockReturnValueOnce(bonusTile('flowers', 1, 'flower'));
    controller.exposeBonus.mockReturnValueOnce(tile('dots', 5, 'replacement'));
    const ai = instantAI(0, 0);

    await ai.playTurn(controller);

    expect(controller.exposeBonus).toHaveBeenCalledWith(0, bonusTile('flowers', 1, 'flower'));
    // The replacement (non-bonus) is not exposed again.
    expect(controller.exposeBonus).toHaveBeenCalledTimes(1);
    expect(controller.discard).toHaveBeenCalledTimes(1);
  });

  it('exposes a chain of bonus tiles until a non-bonus is drawn', async () => {
    const controller = new FakeController();
    controller.draw.mockReturnValueOnce(bonusTile('flowers', 1, 'f1'));
    controller.exposeBonus
      .mockReturnValueOnce(bonusTile('seasons', 2, 's1'))
      .mockReturnValueOnce(bonusTile('flowers', 3, 'f2'))
      .mockReturnValueOnce(tile('dots', 7, 'normal'));
    const ai = instantAI(0, 0);

    await ai.playTurn(controller);

    expect(controller.exposeBonus).toHaveBeenCalledTimes(3);
    expect(controller.discard).toHaveBeenCalledTimes(1);
  });

  it('stops cleanly when the wall is exhausted (draw returns null)', async () => {
    const controller = new FakeController();
    controller.draw.mockReturnValue(null);
    const ai = instantAI(0, 0);

    await ai.playTurn(controller);

    expect(controller.discard).not.toHaveBeenCalled();
  });

  it('ignores a turn-start for a different player', async () => {
    const controller = new FakeController();
    const ai = instantAI(1, 1);
    ai.connect(controller);

    controller.fireTurnStart(0); // not this AI's id

    expect(controller.draw).not.toHaveBeenCalled();
  });

  it('responds to a turn-start for its own id', async () => {
    const controller = new FakeController();
    const ai = instantAI(1, 1);
    ai.connect(controller);

    controller.fireTurnStart(1);

    // playTurn is async; flush microtasks.
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.draw).toHaveBeenCalledWith(1);
    expect(controller.discard).toHaveBeenCalledTimes(1);
  });

  it('is re-entrancy safe: concurrent playTurn calls act once', async () => {
    const controller = new FakeController();
    const ai = instantAI(0, 0);

    await Promise.all([ai.playTurn(controller), ai.playTurn(controller)]);

    expect(controller.draw).toHaveBeenCalledTimes(1);
    expect(controller.discard).toHaveBeenCalledTimes(1);
  });

  it('toggles the thinking flag during a turn', async () => {
    const controller = new FakeController();
    const ai = instantAI(0, 0);

    expect(ai.isThinking).toBe(false);
    const promise = ai.playTurn(controller);
    expect(ai.isThinking).toBe(true);
    await promise;
    expect(ai.isThinking).toBe(false);
  });

  it('unsubscribes when connect() is unsubscribed', async () => {
    const controller = new FakeController();
    const ai = instantAI(0, 0);
    const unsubscribe = ai.connect(controller);
    unsubscribe();

    controller.fireTurnStart(0);
    await Promise.resolve();

    expect(controller.draw).not.toHaveBeenCalled();
  });
});
