/**
 * Public surface of the rendering package.
 *
 * Reserved for the Canvas 2D tile renderer, requestAnimationFrame animation
 * sequences, and wall-layout algorithms (see the Tech Stack Decision doc).
 * Consumers import from '@rendering'.
 */

export { TableRenderer } from './table-renderer';
export { DealingAnimation, TILE_W, TILE_H } from './dealing-animation';
export {
  WinRevealAnimation,
  computeReveal,
  easeOutCubic,
  isRevealComplete,
  type TileRevealState,
  type RevealTile,
  type WinRevealOptions,
} from './animations';
export {
  AssetLoader,
  TILE_WIDTH,
  TILE_HEIGHT,
  SPRITE_WIDTH,
  SPRITE_HEIGHT,
  type AssetLoaderOptions,
} from './asset-loader';
export {
  TileRenderer,
  tileZOrder,
  type TileDrawState,
  type TileRendererOptions,
} from './tile-renderer';
export {
  GameScene,
  type GameSceneOptions,
} from './game-scene';
