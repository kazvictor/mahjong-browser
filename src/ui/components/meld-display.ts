/**
 * MeldDisplay — pure geometry for placing a player's exposed melds face-up at
 * the table's edge.
 *
 * This module is deliberately DOM-free and canvas-free so it can be unit
 * tested headlessly (Vitest + jsdom), mirroring {@link TableLayout} in the
 * rendering package. It translates each player's exposed melds into a flat,
 * z-ordered list of positioned {@link MeldTilePosition} records the GameScene
 * can paint on top of the concealed hand / wall layer.
 *
 * Seating convention matches the rest of the codebase: the human sits at
 * seat 0 (bottom); opponents occupy seat 1 (right/West), seat 2 (top/North),
 * and seat 3 (left/East). Exposed melds are grouped by meld, tiles within a
 * meld kept contiguous, and melds laid out in compact rows just inside the
 * relevant edge so they never overlap the concealed hand.
 */

import type { Meld, Player, Suit } from '../../game-logic/types';

/** Logical (CSS-px) size of a tile face, matching the sprite renderer. */
export const TILE_WIDTH = 40;
export const TILE_HEIGHT = 60;

/** Gap between neighbouring tiles inside one meld (CSS px). */
export const TILE_GAP = 2;

/** Extra gap between one meld and the next in a row (CSS px). */
export const MELD_GAP = 10;

/** Vertical gap between rows of melds (CSS px). */
export const ROW_GAP = 6;

/** Inset from the canvas edge to the nearest meld tile (CSS px). */
export const EDGE_MARGIN = 10;

/** Max tiles per row before wrapping to the next row of melds. */
export const MAX_TILES_PER_ROW = 12;

/** A single tile within an exposed meld, positioned for drawing. */
export interface MeldTilePosition {
  /** Stable tile id (the meld's own tile). */
  readonly tileId: string;
  readonly suit: Suit;
  readonly rank: number;
  readonly x: number;
  readonly y: number;
  /** Index of the meld within the player's meld list. */
  readonly meldIndex: number;
  /** Index of this tile within its meld. */
  readonly tileIndex: number;
  readonly meldType: Meld['type'];
  /** True when the meld was formed entirely from the player's own draws. */
  readonly isConcealed: boolean;
  /**
   * True when this tile is the discard claimed from another player. In real
   * Mahjong the claimed tile in an exposed meld is shown rotated; the renderer
   * can use this to draw a small marker. (Siblings may not populate it yet.)
   */
  readonly isClaimedDiscard: boolean;
}

/** A positioned meld group plus its bounding rect (for hit-testing / QA). */
export interface MeldGroup {
  readonly meldIndex: number;
  readonly playerId: number;
  readonly seat: number;
  readonly meldType: Meld['type'];
  readonly isConcealed: boolean;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The complete meld layout for one frame. */
export interface MeldLayoutFrame {
  /** Every meld tile to paint, in seat/meld order (lower paints first). */
  readonly tiles: readonly MeldTilePosition[];
  /** Bounding groups, one per meld, for QA and hit-testing. */
  readonly groups: readonly MeldGroup[];
}

/** The wall band's edges — not directly referenced by the layout math, which
 * derives edge positions from the hand area anchors instead. Kept as
 * documentation of the vertical regions the melds occupy between. */

/**
 * Pure layout engine for exposed melds. Stateless between calls; instantiate
 * once and call {@link compute} each frame with fresh inputs.
 */
export class MeldDisplay {
  /**
   * Compute the positioned meld tiles for every player.
   *
   * @param width  Canvas logical width (CSS px).
   * @param height Canvas logical height (CSS px).
   * @param players The four players; seat 0 is the human at the bottom.
   */
  compute(width: number, height: number, players: readonly Player[]): MeldLayoutFrame {
    const tiles: MeldTilePosition[] = [];
    const groups: MeldGroup[] = [];

    for (const player of players) {
      if (!player || player.hand.melds.length === 0) continue;
      this.layoutPlayer(player, width, height, tiles, groups);
    }

    return { tiles, groups };
  }

  private layoutPlayer(
    player: Player,
    width: number,
    height: number,
    tiles: MeldTilePosition[],
    groups: MeldGroup[],
  ): void {
    const seat = player.seat;
    const melds = player.hand.melds;

    // First pass: compute a row of positioned meld groups at the player's edge.
    const positioned = this.computeMeldRows(seat, width, height, melds);

    for (let mi = 0; mi < positioned.length; mi++) {
      const group = positioned[mi]!;
      const meld = melds[mi]!;
      groups.push({
        meldIndex: mi,
        playerId: player.id,
        seat,
        meldType: meld.type,
        isConcealed: meld.isConcealed,
        x: group.x,
        y: group.y,
        width: group.width,
        height: TILE_HEIGHT,
      });

      meld.tiles.forEach((tile, ti) => {
        tiles.push({
          tileId: tile.id,
          suit: tile.suit,
          rank: tile.rank,
          x: group.x + ti * (TILE_WIDTH + TILE_GAP),
          y: group.y,
          meldIndex: mi,
          tileIndex: ti,
          meldType: meld.type,
          isConcealed: meld.isConcealed,
          isClaimedDiscard:
            meld.sourcePlayer !== undefined && !meld.isConcealed && ti === 0,
        });
      });
    }
  }

  /**
   * Lay a player's melds out in rows along their edge. Returns each meld's
   * top-left corner, width, and row index (wrapping after MAX_TILES_PER_ROW).
   */
  private computeMeldRows(
    seat: number,
    width: number,
    height: number,
    melds: readonly Meld[],
  ): Array<{ x: number; y: number; width: number; row: number }> {
    const widths = melds.map((m) => m.tiles.length * TILE_WIDTH + (m.tiles.length - 1) * TILE_GAP);

    // Assign each meld to a row so the row's total tiles stay under the cap.
    const rows: Array<{ start: number; end: number; count: number }> = [];
    let rowStart = 0;
    let rowTiles = 0;
    for (let i = 0; i < widths.length; i++) {
      const w = widths[i]!;
      const tilesInMeld = Math.round((w + TILE_GAP) / (TILE_WIDTH + TILE_GAP));
      // Wrap to a new row when adding this meld would exceed the cap AND the
      // current row already holds at least one meld (a single over-large meld
      // must fit on its own row).
      if (rowTiles > 0 && rowTiles + tilesInMeld > MAX_TILES_PER_ROW) {
        rows.push({ start: rowStart, end: i, count: rowTiles });
        rowStart = i;
        rowTiles = tilesInMeld;
      } else {
        rowTiles += tilesInMeld;
      }
      if (i === widths.length - 1) {
        rows.push({ start: rowStart, end: i + 1, count: rowTiles });
      }
    }

    const out: Array<{ x: number; y: number; width: number; row: number }> = [];

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!;
      const rowWidth = widths.slice(row.start, row.end).reduce((a, b) => a + b, 0) +
        (row.end - row.start - 1) * MELD_GAP;

      // Horizontal origin depends on the seat's edge.
      let x0 = 0;
      if (seat === 0 || seat === 2) {
        // Bottom / top: centered horizontally.
        x0 = (width - rowWidth) / 2;
      } else if (seat === 1) {
        // Right player: melds sit to the LEFT of the hand column.
        x0 = EDGE_MARGIN;
      } else {
        // Left player: melds sit to the RIGHT of the hand column.
        x0 = width - EDGE_MARGIN - rowWidth;
      }

      // Vertical origin depends on the seat.
      let y0 = 0;
      if (seat === 0) {
        // Bottom player: just above the hand area (hand ~ height - TILE_HEIGHT - 16),
        // stacked upward so row 0 is nearest the hand.
        const handTop = height - TILE_HEIGHT - EDGE_MARGIN;
        y0 = handTop - TILE_HEIGHT - ROW_GAP - r * (TILE_HEIGHT + ROW_GAP);
      } else if (seat === 2) {
        // Top player: just below the top hand (hand ~ EDGE_MARGIN), stacked downward.
        y0 = EDGE_MARGIN + TILE_HEIGHT + ROW_GAP + r * (TILE_HEIGHT + ROW_GAP);
      } else if (seat === 1) {
        // Right player: vertically centered down the right edge.
        const totalHeight = row.count * TILE_HEIGHT + (rows.length - 1) * ROW_GAP;
        y0 = (height - totalHeight) / 2 + r * (TILE_HEIGHT + ROW_GAP);
      } else {
        // Left player: vertically centered down the left edge.
        const totalHeight = row.count * TILE_HEIGHT + (rows.length - 1) * ROW_GAP;
        y0 = (height - totalHeight) / 2 + r * (TILE_HEIGHT + ROW_GAP);
      }

      let cursor = x0;
      for (let i = row.start; i < row.end; i++) {
        out.push({ x: cursor, y: y0, width: widths[i]!, row: r });
        cursor += widths[i]! + MELD_GAP;
      }
    }

    return out;
  }
}
