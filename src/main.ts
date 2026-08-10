/**
 * Mahjong game entry point.
 *
 * Bootstraps the canvas renderer and starts the requestAnimationFrame loop.
 * Game-state wiring (draw/discard) lands in a follow-up task; this module only
 * owns startup and the frame loop.
 */
import { TableRenderer } from './rendering/table-renderer';

function getGameCanvas(): HTMLCanvasElement {
  const canvas = document.getElementById('game-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Game canvas element (#game-canvas) not found.');
  }
  return canvas;
}

function start(): void {
  const canvas = getGameCanvas();
  const renderer = new TableRenderer(canvas);

  renderer.resize();
  window.addEventListener('resize', () => renderer.resize());

  const frame = (): void => {
    renderer.clear();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

start();
