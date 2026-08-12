/**
 * TableLayout — pure geometry for placing every tile on the Mahjong table.
 *
 * This module owns NO rendering and NO game state: it translates a game
 * snapshot (hands, wall, discard pile) plus interaction state (which tile is
 * selected / hovered / a valid discard) into a flat list of positioned
 * {@link LayoutTile} records the GameScene can sort and paint. Keeping the
 * math DOM-free and canvas-free makes it trivially unit-testable headlessly
 * (Vitest + jsdom).
 *
 * Coordinate space is logical CSS px, the same space TableRenderer draws in
 * (the backing store is scaled by devicePixelRatio separately). The human
 * always sits at seat 0 on the *bottom* of the screen; opponents occupy the
 * right, top, and left edges respectively, their concealed hands shown
 * face-down.
 */

import type { Player, Suit, Tile } from '../game-logic/types';
import { TILE_WIDTH, TILE_HEIGHT } from './asset-loader';

/** Gap between neighbouring tiles in a row / column (CSS px). */
export const TILE_GAP = 2;

/** How far a selected tile is lifted above its baseline (CSS px). */
export const SELECT_LIFT = 10;

/** Vertical gap between the four wall rows (CSS px). */
export const WALL_ROW_GAP = 6;

/** Margin from the canvas edge to the nearest tile (CSS px). */
export const EDGE_MARGIN = 16;

/** A single tile positioned for drawing, with its interaction flags. */
export interface LayoutTile {
  readonly tileId: string;
  readonly suit: Suit;
  readonly rank: number;
  readonly x: number;
  readonly y: number;
  readonly faceDown: boolean;
  readonly selected: boolean;
  readonly hovered: boolean;
  readonly valid: boolean;
}

/** Interaction state the scene supplies so layout can tag each tile. */
export interface InteractionState {
  /** The single selected tile id, if any. */
  readonly selectedId: string | null;
  /** The tile id currently under the cursor, if any. */
  readonly hoveredId: string | null;
  /** Tile ids the current player may legally discard this turn. */
  readonly validMoveIds: ReadonlySet<string>;
}

/** A single hit-testable hand-tile rect (for the TilePicker). */
export interface HandRect {
  readonly tileId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly z: number;
}

/** The complete, flat set of tiles to paint for one frame. */
export interface LayoutFrame {
  readonly handTiles: readonly LayoutTile[];
  /** Position of the human player's hand area (for the picker hit-test rects). */
  readonly handRects: readonly HandRect[];
}

/** The wall laid out as a fixed number of face-down rows. */
const WALL_ROWS = 4;

/** Build a base LayoutTile from a tile identity + position + flags. */
function tileToLayout(tile: Tile, x: number, y: number, flags: Partial<LayoutTile>): LayoutTile {
  return {
    tileId: tile.id,
    suit: tile.suit,
    rank: tile.rank,
    x,
    y,
    faceDown: false,
    selected: false,
    hovered: false,
    valid: false,
    ...flags,
  };
}

/**
 * Compute a centered horizontal row of `count` tiles whose left edge sits at
 * `x0` (already computed from the canvas width). Returns the running x cursor.
 */
function layoutRowCentered(
  count: number,
  width: number,
  y: number,
): Array<{ x: number; y: number }> {
  const totalWidth = count * TILE_WIDTH + (count - 1) * TILE_GAP;
  const x0 = (width - totalWidth) / 2;
  const cells: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    cells.push({ x: x0 + i * (TILE_WIDTH + TILE_GAP), y });
  }
  return cells;
}

/** The number of remaining live-wall tiles, used to decide how full the wall looks. */
function wallRowWidths(wallSize: number): number[] {
  if (wallSize <= 0) return [0, 0, 0, 0];
  const perRow = Math.ceil(wallSize / WALL_ROWS);
  const widths: number[] = [];
  let remaining = wallSize;
  for (let r = 0; r < WALL_ROWS; r++) {
    const w = Math.min(perRow, remaining);
    widths.push(w);
    remaining -= w;
  }
  return widths;
}

/**
 * Pure layout engine. Instantiate per frame (or keep one instance and call
 * {@link compute} with fresh inputs each frame — the object is stateless).
 */
export class TableLayout {
  /**
   * Translate a game snapshot into a positioned layout for the given canvas
   * size.
   *
   * @param width  Canvas logical width (CSS px).
   * @param height Canvas logical height (CSS px).
   * @param players The four players; seat 0 is the human at the bottom.
   * @param wall   The remaining face-down wall tiles (drawn face-down).
   * @param discards The face-up discard pile tiles.
   * @param interaction Current selection / hover / valid-move state.
   */
  compute(
    width: number,
    height: number,
    players: readonly Player[],
    wall: readonly Tile[],
    discards: readonly Tile[],
    interaction: InteractionState,
  ): LayoutFrame {
    const handTiles: LayoutTile[] = [];
    const handRects: HandRect[] = [];

    // Opponents first (behind), then the human hand on top so it reads above
    // the discard/wall band when overlapping.
    for (let seat = 1; seat < players.length; seat++) {
      const player = players[seat];
      if (!player) continue;
      this.layoutOpponentHand(player, width, height, handTiles);
    }

    // Wall rows in the center band, face-down.
    this.layoutWall(width, height, wall, handTiles);

    // Discard pile, face-up, centered just above the bottom hand.
    this.layoutDiscards(width, height, discards, handTiles);

    // Human hand at the bottom, face-up, with interaction highlights and
    // hit-test rects for the TilePicker.
    const human = players[0];
    if (human) {
      this.layoutHumanHand(
        width,
        height,
        human,
        interaction,
        handTiles,
        handRects,
      );
    }

    return { handTiles, handRects };
  }

  private layoutOpponentHand(
    player: Player,
    width: number,
    height: number,
    out: LayoutTile[],
  ): void {
    const n = player.hand.tiles.length;
    if (n === 0) return;
    const seat = player.seat;

    if (seat === 2) {
      // North — top edge, face-down row.
      const y = EDGE_MARGIN;
      const cells = layoutRowCentered(n, width, y);
      player.hand.tiles.forEach((tile, i) => {
        const cell = cells[i]!;
        out.push(tileToLayout(tile, cell.x, cell.y, { faceDown: true }));
      });
    } else if (seat === 1) {
      // West — right edge, face-down column.
      const x = width - TILE_WIDTH - EDGE_MARGIN;
      const y0 = (height - (n * TILE_HEIGHT + (n - 1) * TILE_GAP)) / 2;
      player.hand.tiles.forEach((tile, i) => {
        out.push(tileToLayout(tile, x, y0 + i * (TILE_HEIGHT + TILE_GAP), { faceDown: true }));
      });
    } else {
      // East — left edge, face-down column.
      const x = EDGE_MARGIN;
      const y0 = (height - (n * TILE_HEIGHT + (n - 1) * TILE_GAP)) / 2;
      player.hand.tiles.forEach((tile, i) => {
        out.push(tileToLayout(tile, x, y0 + i * (TILE_HEIGHT + TILE_GAP), { faceDown: true }));
      });
    }
  }

  private layoutWall(
    width: number,
    height: number,
    wall: readonly Tile[],
    out: LayoutTile[],
  ): void {
    const widths = wallRowWidths(wall.length);
    // Wall band occupies the vertical middle of the canvas.
    const bandTop = height * 0.18;
    let index = 0;
    for (let r = 0; r < WALL_ROWS; r++) {
      const rowCount = widths[r]!;
      if (rowCount === 0) break;
      const y = bandTop + r * (TILE_HEIGHT + WALL_ROW_GAP);
      for (const { x, y: yy } of layoutRowCentered(rowCount, width, y)) {
        const tile = wall[index]!;
        out.push(tileToLayout(tile, x, yy, { faceDown: true }));
        index++;
      }
    }
  }

  private layoutDiscards(
    width: number,
    height: number,
    discards: readonly Tile[],
    out: LayoutTile[],
  ): void {
    if (discards.length === 0) return;
    // Show the most recent ~24 discards to avoid overflowing the band.
    const recent = discards.slice(-24);
    const y = height - TILE_HEIGHT - TILE_HEIGHT - 24;
    const cells = layoutRowCentered(recent.length, width, y);
    recent.forEach((tile, i) => {
      const cell = cells[i]!;
      out.push(tileToLayout(tile, cell.x, cell.y, { faceDown: false }));
    });
  }

  private layoutHumanHand(
    width: number,
    height: number,
    player: Player,
    interaction: InteractionState,
    out: LayoutTile[],
    rects: HandRect[],
  ): void {
    const hand = player.hand.tiles;
    if (hand.length === 0) return;
    const y = height - TILE_HEIGHT - EDGE_MARGIN;
    const cells = layoutRowCentered(hand.length, width, y);

    hand.forEach((tile, i) => {
      const cell = cells[i]!;
      const selected = interaction.selectedId === tile.id;
      const hovered = interaction.hoveredId === tile.id;
      const valid = interaction.validMoveIds.has(tile.id);
      const drawY = selected ? cell.y - SELECT_LIFT : cell.y;
      out.push(tileToLayout(tile, cell.x, drawY, { faceDown: false, selected, hovered, valid }));
      // Hit-test rect uses the *baseline* (unlifted) position so a selected
      // tile stays clickable where the player first clicked it.
      rects.push({ tileId: tile.id, x: cell.x, y: cell.y, width: TILE_WIDTH, height: TILE_HEIGHT, z: i });
    });
  }
}

/** Sort a frame's tiles by z-order so lifted/selected tiles paint on top. */
export function sortTilesForDraw(tiles: readonly LayoutTile[]): LayoutTile[] {
  return [...tiles].sort((a, b) => zOf(a) - zOf(b));
}

/** Z-order used when painting (lower paints first / behind). */
function zOf(t: LayoutTile): number {
  if (t.selected) return 3;
  if (t.hovered) return 2;
  if (t.valid) return 1;
  return 0;
}
