/**
 * Unit tests for the win-reveal animation: the pure progress functions and
 * the canvas animation owner.
 */
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  computeReveal,
  easeOutCubic,
  isRevealComplete,
  WinRevealAnimation,
} from './animations';

describe('easeOutCubic', () => {
  it('clamps inputs outside [0,1]', () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });

  it('starts at 0 and ends at 1', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it('is monotonic and eases out', () => {
    const mid = easeOutCubic(0.5);
    expect(mid).toBeGreaterThan(0.5); // ease-out => decelerating, above linear at mid
    expect(mid).toBeLessThan(1);
  });
});

describe('computeReveal', () => {
  it('returns one state per tile', () => {
    const states = computeReveal(0, 250, 45, 5);
    expect(states).toHaveLength(5);
  });

  it('hides all tiles at elapsed 0', () => {
    const states = computeReveal(0, 250, 45, 3);
    for (const s of states) expect(s.progress).toBe(0);
  });

  it('fully reveals every tile after the final stagger + duration', () => {
    const states = computeReveal(45 * 2 + 250, 250, 45, 3);
    for (const s of states) expect(s.progress).toBe(1);
  });

  it('staggers later tiles behind earlier ones', () => {
    const states = computeReveal(100, 250, 45, 3);
    // Tile 0 started first => ahead of tiles 1 and 2.
    expect(states[0]!.progress).toBeGreaterThan(states[1]!.progress);
    expect(states[1]!.progress).toBeGreaterThan(states[2]!.progress);
  });

  it('uses ease-out cubic on the local progress', () => {
    // At exactly durationMs, tile 0 has local = 1 => progress 1.
    const states = computeReveal(250, 250, 45, 1);
    expect(states[0]!.progress).toBe(1);
  });

  it('handles a zero/negative duration defensively', () => {
    const states = computeReveal(0, 0, 0, 2);
    expect(states).toHaveLength(2);
    expect(states[0]!.progress).toBe(0);
  });
});

describe('isRevealComplete', () => {
  it('is false before the last tile finishes', () => {
    expect(isRevealComplete(100, 250, 45, 3)).toBe(false);
  });

  it('is true once the last tile finishes', () => {
    expect(isRevealComplete(45 * 2 + 250, 250, 45, 3)).toBe(true);
  });

  it('is immediately true for zero tiles', () => {
    expect(isRevealComplete(0, 250, 45, 0)).toBe(true);
  });
});

describe('WinRevealAnimation', () => {
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
  });

  it('is not running initially and reports total duration', () => {
    const anim = new WinRevealAnimation(ctx, []);
    expect(anim.isRunning).toBe(false);
    const withThree = new WinRevealAnimation(
      ctx,
      [0, 1, 2].map((i) => ({ index: i, draw: vi.fn() })),
      { durationMs: 250, staggerMs: 45 },
    );
    expect(withThree.totalDurationMs).toBe(45 * 2 + 250);
  });

  it('paintAt draws tiles whose progress is > 0 and skips the rest', () => {
    const draw = vi.fn();
    const anim = new WinRevealAnimation(
      ctx,
      [0, 1, 2].map((i) => ({ index: i, draw })),
      { durationMs: 250, staggerMs: 45 },
    );
    // At elapsed 60: tile 0 and 1 started (stagger 45), tile 2 (starts at 90) not yet.
    anim.paintAt(60);
    expect(draw).toHaveBeenCalledTimes(2);
  });

  it('start/stop toggle running state', () => {
    const anim = new WinRevealAnimation(ctx, [], { durationMs: 250, staggerMs: 45 });
    anim.start();
    expect(anim.isRunning).toBe(true);
    anim.start(); // idempotent
    expect(anim.isRunning).toBe(true);
    anim.stop();
    expect(anim.isRunning).toBe(false);
  });
});
