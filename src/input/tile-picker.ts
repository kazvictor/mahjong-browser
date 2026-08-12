/**
 * TilePicker — pure, DOM-free hit detection and selection logic.
 *
 * This module owns nothing about the canvas or DOM. It answers two questions
 * for the InputHandler:
 *   1. "Which tile is under this point?"  (hit detection)
 *   2. "What did this click mean?"          (selection state machine)
 *
 * Keeping the logic DOM-free makes it trivially unit-testable in jsdom/Node
 * and keeps it independent of whichever module (TileRenderer, MahjongGame,
 * etc.) the sibling tasks are concurrently building. The InputHandler binds
 * real pointer events to a picker instance; main.ts supplies the current
 * tile rectangles (computed from whatever layout the renderer owns).
 */

/** Logical (CSS-px) size of a tile face. Backing store scales by devicePixelRatio. */
export const TILE_WIDTH = 40;
export const TILE_HEIGHT = 60;

/**
 * A hit-testable rectangle for one tile, in the same CSS-px coordinate space
 * the canvas renderer draws in. `z` disambiguates overlapping tiles (larger
 * wins); when equal, the first match in the list wins.
 */
export interface TileRect {
  readonly tileId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly z?: number;
}

/** Outcome of a click, reported to the InputHandler / game layer. */
export type PickAction = 'select' | 'discard' | 'none';

/**
 * Compute the on-screen rectangles for a player's hand laid out along the
 * bottom of the viewport (the human player's own hand).
 *
 * @param tileIds  Concealed-hand tile ids, left to right.
 * @param handX    Left edge of the hand area.
 * @param handY    Top edge of the hand area.
 * @param gap      Horizontal spacing between tiles (CSS px).
 * @param lift     How far the *selected* tile rises above the baseline (CSS px).
 * @returns Hand tile rects plus the rect of the tile the picker should treat
 *          as "raised" (the selected tile), or null.
 */
export function computeHandLayout(
  tileIds: readonly string[],
  handX: number,
  handY: number,
  gap = 2,
): TileRect[] {
  return tileIds.map((tileId, i) => ({
    tileId,
    x: handX + i * (TILE_WIDTH + gap),
    y: handY,
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
    z: i, // later tiles overlap earlier ones; a rightmost tile wins on a tie
  }));
}

export interface TilePickerOptions {
  /** When false, picker ignores hover/click (e.g. it is not the human's turn). */
  enabled?: boolean;
}

const hitTest = (rect: TileRect, x: number, y: number): boolean =>
  x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;

export class TilePicker {
  private readonly rects: TileRect[] = [];
  private hoveredTileId: string | null = null;
  private selectedTileId: string | null = null;
  private enabled: boolean;

  constructor(options: TilePickerOptions = {}) {
    this.enabled = options.enabled ?? true;
  }

  /** Replace the full set of hit-testable tile rectangles (per frame / per move). */
  setTileRects(rects: readonly TileRect[]): void {
    this.rects.length = 0;
    this.rects.push(...rects);
    // A tile that is no longer present (e.g. discarded) can't stay selected.
    if (this.selectedTileId !== null && !this.rects.some((r) => r.tileId === this.selectedTileId)) {
      this.selectedTileId = null;
    }
    if (this.hoveredTileId !== null && !this.rects.some((r) => r.tileId === this.hoveredTileId)) {
      this.hoveredTileId = null;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    // Disabling interaction should not leave a stale hover state behind.
    if (!enabled) {
      this.hoveredTileId = null;
    }
  }

  /** Return the rect whose bounds contain (x, y), resolving overlap by z-then-order. */
  pickAt(x: number, y: number): TileRect | null {
    let best: TileRect | null = null;
    let bestZ = -Infinity;
    for (const rect of this.rects) {
      if (!hitTest(rect, x, y)) continue;
      const z = rect.z ?? 0;
      if (z > bestZ || (z === bestZ && best === null)) {
        best = rect;
        bestZ = z;
      }
    }
    return best;
  }

  /** Update the hovered tile from a pointer position. Returns the rect hovered, or null. */
  updateHover(x: number, y: number): TileRect | null {
    if (!this.enabled) {
      this.hoveredTileId = null;
      return null;
    }
    const hit = this.pickAt(x, y);
    this.hoveredTileId = hit?.tileId ?? null;
    return hit;
  }

  getHoveredTileId(): string | null {
    return this.hoveredTileId;
  }

  getSelectedTileId(): string | null {
    return this.selectedTileId;
  }

  /** True when the given tile is currently selected (drives the raised/lift visual). */
  isSelected(tileId: string): boolean {
    return this.selectedTileId === tileId;
  }

  /** True when the given tile is currently hovered. */
  isHovered(tileId: string): boolean {
    return this.enabled && this.hoveredTileId === tileId;
  }

  /** Whether the given tile id exists in the current layout (i.e. is a valid target). */
  hasTile(tileId: string): boolean {
    return this.rects.some((r) => r.tileId === tileId);
  }

  /**
   * Handle a click at (x, y). Implements the selection state machine:
   *   none      → hit own tile        → 'select'
   *   none      → empty space         → 'none'
   *   selected  → same tile clicked   → 'discard' (then clears selection)
   *   selected  → different own tile  → 'select'  (moves selection)
   *   selected  → empty space         → 'none'    (deselects)
   *
   * Returns the action and, for 'discard', the tile id being discarded.
   */
  handleClick(
    x: number,
    y: number,
  ): { action: PickAction; tileId: string | null } {
    if (!this.enabled) {
      return { action: 'none', tileId: null };
    }
    const hit = this.pickAt(x, y);
    const hitId = hit?.tileId ?? null;

    if (hitId === null) {
      // Clicked empty space → deselect (if anything was selected).
      this.selectedTileId = null;
      return { action: 'none', tileId: null };
    }

    if (this.selectedTileId === null) {
      this.selectedTileId = hitId;
      return { action: 'select', tileId: hitId };
    }

    if (this.selectedTileId === hitId) {
      this.selectedTileId = null;
      return { action: 'discard', tileId: hitId };
    }

    // A different tile was clicked while one is selected → move selection.
    this.selectedTileId = hitId;
    return { action: 'select', tileId: hitId };
  }

  /** Programmatically clear the current selection (e.g. after a discard lands). */
  clearSelection(): void {
    this.selectedTileId = null;
  }
}
