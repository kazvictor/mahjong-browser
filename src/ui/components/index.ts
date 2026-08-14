/**
 * Public surface of the UI components package.
 *
 * DOM-based overlays (score table modal, meld declaration prompt) and canvas
 * layout/render helpers (meld display, riichi display). Consumers import from
 * '@ui/components'.
 */

export {
  MeldDisplay,
  TILE_WIDTH,
  TILE_HEIGHT,
  TILE_GAP,
  MELD_GAP,
  ROW_GAP,
  EDGE_MARGIN,
  MAX_TILES_PER_ROW,
  type MeldTilePosition,
  type MeldGroup,
  type MeldLayoutFrame,
} from './meld-display';

export {
  ScoreTable,
  type ScoreRow,
  type PointsTransfer,
  type ScoreTableData,
  type ScoreTableOptions,
} from './score-table';

export {
  RiichiLayout,
  RiichiDisplay,
  STICK_W,
  STICK_H,
  STICK_GAP,
  type RiichiState,
  type RiichiStick,
  type RiichiLayoutFrame,
  type RiichiDisplayOptions,
} from './riichi-display';

export {
  MeldDeclarationPrompt,
  DEFAULT_MELD_TIMEOUT_MS,
  type MeldDeclareKind,
  type MeldDeclareOption,
  type MeldDeclarationPromptOptions,
} from './meld-declaration';
