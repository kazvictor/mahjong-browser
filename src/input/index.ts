/**
 * Public surface of the input package.
 *
 * Owns pointer/mouse/touch handling and the pure hit-test/selection logic that
 * turns raw canvas events into game actions. Consumers import from '@input'.
 */

export {
  InputHandler,
  getMouseScreenPoint,
  type InteractionHandlers,
  type InputHandlerOptions,
  type ScreenPoint,
} from './input-handler';
export {
  TilePicker,
  computeHandLayout,
  TILE_WIDTH,
  TILE_HEIGHT,
  type PickAction,
  type TilePickerOptions,
  type TileRect,
} from './tile-picker';
