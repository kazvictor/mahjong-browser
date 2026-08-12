/**
 * InputHandler — binds pointer/mouse/touch events on the game canvas and
 * translates them into hit tests + selection actions via a TilePicker.
 *
 * Coordinate handling:
 *   - Pointer/mouse events report CSS pixels relative to the *canvas* element
 *     (clientX/Y are viewport-relative; we subtract the canvas's bounding-box
 *     offset). Because TableRenderer scales its backing store by devicePixelRatio
 *     but draws in CSS px (ctx.setTransform(dpr,0,0,dpr,0,0)), hit testing and
 *     rendering share the same CSS-pixel space. getMouseScreenPoint() returns
 *     canvas-relative CSS px, which is exactly what TilePicker expects.
 *   - Touch events are translated into the same CSS-pixel space so mobile and
 *     desktop share one code path.
 *
 * The handler is deliberately decoupled from the game engine: it reports
 * select/discard actions to a callback the caller wires to MahjongGame (or a
 * stand-in during early integration). This keeps it buildable independently of
 * whichever sibling task owns MahjongGame.
 */

import { TilePicker, type PickAction, type TileRect } from './tile-picker';

/** A screen point in CSS px, relative to the canvas's top-left corner. */
export interface ScreenPoint {
  x: number;
  y: number;
}

export interface InteractionHandlers {
  /** Called after a click resolves to a select or discard action. */
  onAction?: (action: PickAction, tileId: string | null) => void;
  /** Called on every pointer move (hover) — lets the renderer repaint. */
  onHoverChange?: () => void;
  /** Called when the picker should be re-fed the current tile rectangles. */
  onRequestRects?: () => TileRect[];
}

export interface InputHandlerOptions {
  /** When false, all pointer input is ignored (e.g. it is an opponent's turn). */
  enabled?: boolean;
  /** If false, touch events are not bound (e.g. for pure unit tests). */
  bindTouch?: boolean;
}

/**
 * Convert a mouse/pointer/touch event's client coordinates into canvas-relative
 * CSS pixels. Handles devicePixelRatio implicitly: because the canvas backing
 * store is scaled but drawing + hit testing run in CSS px, we only need the
 * element offset — not the DPR.
 */
export function getMouseScreenPoint(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): ScreenPoint {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

/** Extract the clientX/clientY from either a MouseEvent or a single touch. */
function clientPoint(
  event: MouseEvent | TouchEvent | PointerEvent,
): { x: number; y: number } | null {
  if ('clientX' in event) {
    return { x: event.clientX, y: event.clientY };
  }
  // TouchEvent: use the first changed touch.
  const touch = event.changedTouches?.item(0);
  if (!touch) return null;
  return { x: touch.clientX, y: touch.clientY };
}

export class InputHandler {
  private readonly canvas: HTMLCanvasElement;
  private readonly picker: TilePicker;
  private readonly handlers: InteractionHandlers;
  private enabled: boolean;
  private readonly bound: {
    move: (event: MouseEvent) => void;
    leave: () => void;
    down: (event: MouseEvent | PointerEvent) => void;
    touchStart: (event: TouchEvent) => void;
  };
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, handlers: InteractionHandlers = {}, options: InputHandlerOptions = {}) {
    this.canvas = canvas;
    this.picker = new TilePicker({ enabled: options.enabled ?? true });
    this.handlers = handlers;
    this.enabled = options.enabled ?? true;

    // Stable bound references so removeEventListener can tear them down later.
    this.bound = {
      move: (event: MouseEvent) => this.onPointerMove(event.clientX, event.clientY),
      leave: () => this.onPointerLeave(),
      down: (event: MouseEvent | PointerEvent) => {
        const pt = clientPoint(event);
        if (!pt) return;
        this.onPointerDown(pt.x, pt.y);
      },
      touchStart: (event: TouchEvent) => {
        // Prevent the browser from synthesizing a mouse click after a tap.
        event.preventDefault();
        const pt = clientPoint(event);
        if (!pt) return;
        this.onPointerDown(pt.x, pt.y);
      },
    };
  }

  /** Bind all listeners. Safe to call once; ignores repeat calls. */
  attach(): void {
    if (this.disposed) return;
    const c = this.canvas;
    // Pointer Events unify mouse + touch + pen on modern browsers, so we bind
    // those exclusively when supported. Binding BOTH pointerdown and mousedown
    // would double-fire (pointerdown is followed by a synthesized mousedown on
    // desktop) and discard a tile after a single click. When PointerEvent is
    // absent we fall back to mouse + touch handlers.
    const supportsPointer = typeof window !== 'undefined' && 'PointerEvent' in window;
    if (supportsPointer) {
      c.addEventListener('pointermove', this.bound.move);
      c.addEventListener('pointerleave', this.bound.leave);
      c.addEventListener('pointerdown', this.bound.down);
      // Let the browser know we handle touches ourselves so it won't try to
      // scroll/zoom the page while dragging across the canvas.
      c.style.touchAction = 'none';
    } else {
      c.addEventListener('mousemove', this.bound.move);
      c.addEventListener('mouseleave', this.bound.leave);
      c.addEventListener('mousedown', this.bound.down);
      c.addEventListener('touchstart', this.bound.touchStart, { passive: false });
      c.addEventListener('touchend', (e) => e.preventDefault(), { passive: false });
    }
  }

  /** Remove all listeners. No-op after disposal. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const c = this.canvas;
    c.removeEventListener('pointermove', this.bound.move);
    c.removeEventListener('pointerleave', this.bound.leave);
    c.removeEventListener('pointerdown', this.bound.down);
    c.removeEventListener('mousemove', this.bound.move);
    c.removeEventListener('mouseleave', this.bound.leave);
    c.removeEventListener('mousedown', this.bound.down);
    c.removeEventListener('touchstart', this.bound.touchStart);
    c.removeEventListener('touchend', this.bound.touchStart);
  }

  getPicker(): TilePicker {
    return this.picker;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.picker.setEnabled(enabled);
  }

  /** Recompute the hit-test rectangles from the caller (e.g. after a move). */
  refreshRects(): void {
    const rects = this.handlers.onRequestRects?.() ?? [];
    this.picker.setTileRects(rects);
  }

  // ---- Internal handlers ----------------------------------------------------

  private onPointerMove(clientX: number, clientY: number): void {
    if (!this.enabled) return;
    const { x, y } = getMouseScreenPoint(this.canvas, clientX, clientY);
    this.refreshRects();
    const before = this.picker.getHoveredTileId();
    this.picker.updateHover(x, y);
    const after = this.picker.getHoveredTileId();
    if (before !== after) {
      this.handlers.onHoverChange?.();
    }
  }

  private onPointerLeave(): void {
    if (this.picker.getHoveredTileId() !== null) {
      this.picker.updateHover(-1, -1); // clears hover
      this.handlers.onHoverChange?.();
    }
  }

  private onPointerDown(clientX: number, clientY: number): void {
    if (!this.enabled) return;
    const { x, y } = getMouseScreenPoint(this.canvas, clientX, clientY);
    this.refreshRects();
    const result = this.picker.handleClick(x, y);
    if (result.action !== 'none') {
      this.handlers.onAction?.(result.action, result.tileId);
    }
    // A click also updates hover so a freshly selected tile shows hover glow.
    this.picker.updateHover(x, y);
    this.handlers.onHoverChange?.();
  }
}
