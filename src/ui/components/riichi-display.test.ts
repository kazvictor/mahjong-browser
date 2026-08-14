/**
 * Unit tests for the RiichiLayout pure geometry and RiichiDisplay canvas
 * renderer.
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { RiichiLayout, RiichiDisplay, STICK_W, STICK_GAP } from './riichi-display';

describe('RiichiLayout.compute', () => {
  it('centers an empty set with no sticks', () => {
    const layout = new RiichiLayout();
    const frame = layout.compute(800, 600, { riichiPlayers: [], honba: 0 });
    expect(frame.sticks).toHaveLength(0);
  });

  it('places each riichi player as one stick in a centered row', () => {
    const layout = new RiichiLayout();
    const frame = layout.compute(800, 600, { riichiPlayers: [1, 2], honba: 0 });
    expect(frame.sticks).toHaveLength(2);
    expect(frame.sticks[0]!.seat).toBe(1);
    expect(frame.sticks[1]!.seat).toBe(2);
    // Row is horizontally centered.
    const x0 = frame.sticks[0]!.x;
    const gridWidth = 2 * STICK_W + STICK_GAP;
    expect(x0 + gridWidth / 2).toBeCloseTo(400, 0);
    // Sticks are spaced by width + gap.
    expect(frame.sticks[1]!.x).toBe(x0 + STICK_W + STICK_GAP);
  });

  it('positions the honba badge near center regardless of sticks', () => {
    const layout = new RiichiLayout();
    const frame = layout.compute(1000, 800, { riichiPlayers: [0], honba: 3 });
    expect(frame.honbaX).toBeCloseTo(500, 0);
    expect(frame.honbaY).toBeGreaterThan(400); // just below center
  });
});

describe('RiichiDisplay.draw', () => {
  it('draws a default stick for each riichi player', () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillRect: vi.fn(),
      measureText: () => ({ width: 10 }),
      fillText: vi.fn(),
      font: '',
      textAlign: '',
      textBaseline: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;

    const display = new RiichiDisplay();
    display.draw(ctx, 800, 600, { riichiPlayers: [1, 2], honba: 0 });
    // Two sticks -> two roundRect calls.
    expect(ctx.roundRect).toHaveBeenCalledTimes(2);
  });

  it('draws a honba badge when honba > 0', () => {
    const fillText = vi.fn();
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillRect: vi.fn(),
      measureText: () => ({ width: 30 }),
      fillText,
      font: '',
      textAlign: '',
      textBaseline: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;

    const display = new RiichiDisplay();
    display.draw(ctx, 800, 600, { riichiPlayers: [], honba: 2 });
    // Badge fillText renders "Honba 2".
    expect(fillText).toHaveBeenCalled();
    expect(String(fillText.mock.calls[0]![0])).toContain('Honba');
  });

  it('does not draw a honba badge when honba is 0', () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillRect: vi.fn(),
      measureText: () => ({ width: 10 }),
      fillText: vi.fn(),
      font: '',
      textAlign: '',
      textBaseline: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;

    const display = new RiichiDisplay();
    display.draw(ctx, 800, 600, { riichiPlayers: [], honba: 0 });
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it('honours a custom drawStick callback', () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillRect: vi.fn(),
      measureText: () => ({ width: 10 }),
      fillText: vi.fn(),
      font: '',
      textAlign: '',
      textBaseline: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;

    const custom = vi.fn();
    const display = new RiichiDisplay();
    display.draw(ctx, 800, 600, { riichiPlayers: [3], honba: 0 }, custom);
    expect(custom).toHaveBeenCalledTimes(1);
    // Default stick drawing is bypassed.
    expect(ctx.roundRect).not.toHaveBeenCalled();
  });
});
