// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InputHandler, getMouseScreenPoint } from './input-handler';
import { TILE_WIDTH, TILE_HEIGHT } from './tile-picker';

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 300;
  // jsdom's getBoundingClientRect returns all zeros; stub it so the offset
  // math in getMouseScreenPoint is deterministic.
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return canvas;
}

function firePointer(canvas: HTMLCanvasElement, type: string, x: number, y: number): void {
  canvas.dispatchEvent(
    new PointerEvent(type, { clientX: x, clientY: y, bubbles: true }),
  );
}

describe('getMouseScreenPoint', () => {
  it('converts client coords to canvas-relative CSS px', () => {
    const canvas = makeCanvas();
    const pt = getMouseScreenPoint(canvas, 30, 40);
    expect(pt).toEqual({ x: 30, y: 40 });
  });

  it('subtracts the canvas offset when the canvas is not at the origin', () => {
    const canvas = makeCanvas();
    canvas.getBoundingClientRect = () =>
      ({ left: 50, top: 20, width: 400, height: 300, right: 450, bottom: 320, x: 50, y: 20, toJSON: () => ({}) }) as DOMRect;
    const pt = getMouseScreenPoint(canvas, 80, 60);
    expect(pt).toEqual({ x: 30, y: 40 });
  });
});

describe('InputHandler', () => {
  let canvas: HTMLCanvasElement;
  let handler: InputHandler;
  let actions: { action: string; tileId: string | null }[];
  let hoverChanges: number;

  beforeEach(() => {
    canvas = makeCanvas();
    actions = [];
    hoverChanges = 0;
    handler = new InputHandler(
      canvas,
      {
        onAction: (action, tileId) => actions.push({ action, tileId }),
        onHoverChange: () => hoverChanges++,
        onRequestRects: () => [
          { tileId: 'a', x: 0, y: 0, width: TILE_WIDTH, height: TILE_HEIGHT },
          { tileId: 'b', x: TILE_WIDTH + 2, y: 0, width: TILE_WIDTH, height: TILE_HEIGHT },
        ],
      },
      { bindTouch: false },
    );
    handler.attach();
  });

  afterEach(() => {
    handler.dispose();
  });

  it('selects a tile on pointerdown', () => {
    firePointer(canvas, 'pointerdown', 5, 5);
    expect(actions).toEqual([{ action: 'select', tileId: 'a' }]);
  });

  it('discards when the selected tile is clicked again', () => {
    firePointer(canvas, 'pointerdown', 5, 5); // select a
    firePointer(canvas, 'pointerdown', 5, 5); // discard a
    expect(actions).toEqual([
      { action: 'select', tileId: 'a' },
      { action: 'discard', tileId: 'a' },
    ]);
  });

  it('reports hover changes on pointermove', () => {
    firePointer(canvas, 'pointermove', 5, 5);
    expect(hoverChanges).toBeGreaterThan(0);
    expect(handler.getPicker().getHoveredTileId()).toBe('a');
  });

  it('does not fire actions when disabled', () => {
    handler.setEnabled(false);
    firePointer(canvas, 'pointerdown', 5, 5);
    expect(actions).toEqual([]);
  });

  it('stops reporting after dispose', () => {
    handler.dispose();
    firePointer(canvas, 'pointerdown', 5, 5);
    expect(actions).toEqual([]);
  });
});
