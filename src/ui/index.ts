/**
 * Public surface of the UI package.
 *
 * Reserved for DOM-based overlays: score display, game menu, and tutorial
 * overlay. Consumers import from '@ui'.
 */

export { WinDisplay, winTypeLabel } from './components/win-display';
export type { WinDisplayData, WinDisplayCallbacks } from './components/win-display';

export { MeldDisplay, TILE_WIDTH, TILE_HEIGHT, TILE_GAP, MELD_GAP, ROW_GAP, EDGE_MARGIN, MAX_TILES_PER_ROW } from './components/meld-display';
export type { MeldTilePosition, MeldGroup, MeldLayoutFrame } from './components/meld-display';
export { ScoreTable } from './components/score-table';
export type { ScoreRow, PointsTransfer, ScoreTableData, ScoreTableOptions } from './components/score-table';
export { RiichiLayout, RiichiDisplay, STICK_W, STICK_H, STICK_GAP } from './components/riichi-display';
export type { RiichiState, RiichiStick, RiichiLayoutFrame, RiichiDisplayOptions } from './components/riichi-display';
export { MeldDeclarationPrompt, DEFAULT_MELD_TIMEOUT_MS } from './components/meld-declaration';
export type { MeldDeclareKind, MeldDeclareOption, MeldDeclarationPromptOptions } from './components/meld-declaration';

export {};
