/**
 * Minimal Canvas 2D renderer for the Mahjong table.
 *
 * This scaffold establishes the resize/DPR handling and the draw loop that
 * later rendering work (tile sprites, wall layout, animations) will plug into.
 * It deliberately draws nothing beyond a clear so the skeleton compiles and
 * boots without requiring tile assets yet.
 */
export class TableRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable — rendering cannot start.');
    }
    this.ctx = ctx;
  }

  /** Sizes the backing store to the element's CSS size × device pixel ratio. */
  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { clientWidth, clientHeight } = this.canvas;
    this.canvas.width = Math.floor(clientWidth * dpr);
    this.canvas.height = Math.floor(clientHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Clears the frame. Called once per animation tick. */
  clear(): void {
    const { clientWidth, clientHeight } = this.canvas;
    this.ctx.clearRect(0, 0, clientWidth, clientHeight);
  }

  /** Expose the shared 2D context so scene code can paint on the same surface. */
  getContext(): CanvasRenderingContext2D {
    return this.ctx;
  }
}
