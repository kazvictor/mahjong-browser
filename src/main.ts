/**
 * Mahjong game entry point.
 *
 * Bootstraps the canvas renderer, the persistence coordinator, and starts the
 * requestAnimationFrame loop. Game-state wiring (draw/discard) lands in a
 * follow-up task; this module only owns startup and the frame loop.
 */
import { GameScene } from './rendering/game-scene';
import { SaveManager } from './persistence';

function getGameCanvas(): HTMLCanvasElement {
  const canvas = document.getElementById('game-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Game canvas element (#game-canvas) not found.');
  }
  return canvas;
}

async function start(): Promise<void> {
  const canvas = getGameCanvas();
  // The persistence coordinator prefers IndexedDB and falls back to localStorage;
  // the scene uses it to resume the previous session and auto-save each action.
  const saveManager = new SaveManager();
  const scene = new GameScene(canvas, { saveManager });

  // Expose the scene for automated visual QA (Playwright). The test harness
  // drives the game into a meld state and asserts on the rendered table.
  (window as unknown as { __mahjongScene?: GameScene }).__mahjongScene = scene;

  // Keep the scene alive for the lifetime of the page; the frame loop is owned
  // by the scene. A failed asset load must not silently render a blank screen,
  // so surface it loudly in the console.
  await scene.start().catch((err: unknown) => {
    console.error('Failed to start Mahjong game:', err);
  });
}

void start();
