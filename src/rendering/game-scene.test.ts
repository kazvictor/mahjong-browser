// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// AssetLoader is DOM + Vite-glob dependent; stub it so the scene can be
// constructed headlessly. TileRenderer receives a real stub loader whose
// images are no-op HTMLImageElements.
const loaderStub = {
  load: vi.fn().mockResolvedValue(undefined),
  getBack: () => new Image(),
  getFace: () => new Image(),
  get: () => new Image(),
  isLoaded: false,
  loadedCount: 0,
  hasFace: () => true,
  hasBack: () => true,
};
vi.mock('./asset-loader', () => ({
  AssetLoader: class {
    load = loaderStub.load;
    getBack = loaderStub.getBack;
    getFace = loaderStub.getFace;
    get = loaderStub.get;
    get isLoaded() {
      return loaderStub.isLoaded;
    }
    get loadedCount() {
      return loaderStub.loadedCount;
    }
    hasFace = loaderStub.hasFace;
    hasBack = loaderStub.hasBack;
  },
  TILE_WIDTH: 40,
  TILE_HEIGHT: 60,
  SPRITE_WIDTH: 80,
  SPRITE_HEIGHT: 120,
}));

import { GameScene } from './game-scene';
import { GameState } from '../game-logic/game-state';

/** A minimal canvas whose getContext returns a full 2D-context stub. */
function makeCanvas(): HTMLCanvasElement {
  const ctxStub = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    clip: vi.fn(),
    roundRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    measureText: () => ({ width: 0 }),
    setTransform: vi.fn(),
    translate: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    shadowColor: '',
    shadowBlur: 0,
    font: '',
    textAlign: 'left' as CanvasTextAlign,
  } as unknown as CanvasRenderingContext2D;

  const canvas = {
    width: 1200,
    height: 800,
    clientWidth: 1200,
    clientHeight: 800,
    style: {},
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getContext: vi.fn(() => ctxStub),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
  } as unknown as HTMLCanvasElement;
  return canvas;
}

describe('GameScene', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    vi.clearAllMocks();
    canvas = makeCanvas();
    // jsdom lacks requestAnimationFrame; stub with a no-op that does NOT invoke
    // the callback (invoking it synchronously would recurse forever since the
    // scene re-arms RAF each frame). Tests drive rendering via scene.render().
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
  });

  it('starts the game and deals a starting hand (human holds 14 tiles)', async () => {
    const scene = new GameScene(canvas, { seed: 1, enableAI: false });
    await scene.start();
    const game = scene.getGame();
    expect(game.getPhase()).toBe(GameState.DRAW);
    const state = game.getState();
    // Dealer (human, seat 0) holds 13 + 1 opening tile.
    expect(state.players[0]!.hand.tiles).toHaveLength(14);
    expect(state.players[1]!.hand.tiles).toHaveLength(13);
    scene.dispose();
  });

  it('can render a frame without throwing', async () => {
    const scene = new GameScene(canvas, { seed: 2, enableAI: false });
    await scene.start();
    expect(() => scene.render()).not.toThrow();
    scene.dispose();
  });

  it('lets the human discard an opening tile from the DRAW phase', async () => {
    const scene = new GameScene(canvas, { seed: 3, enableAI: false });
    await scene.start();
    const game = scene.getGame();
    const stateBefore = game.getState();
    const tileId = stateBefore.players[0]!.hand.tiles[0]!.id;

    // Opening: phase is DRAW, hand has 14. A discard should be legal.
    expect(game.getPhase()).toBe(GameState.DRAW);
    expect(() => game.discardOpening(tileId)).not.toThrow();
    // After the discard the scene auto-advances to the next player's DRAW turn,
    // and the tile lands on the discard pile.
    const after = game.getState();
    expect(after.discardPile.some((t) => t.id === tileId)).toBe(true);
    expect(after.players[0]!.hand.tiles.some((t) => t.id === tileId)).toBe(false);
    scene.dispose();
  });
});
