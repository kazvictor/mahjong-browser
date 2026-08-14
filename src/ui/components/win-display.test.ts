/**
 * Unit tests for the WinDisplay DOM component.
 */
// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { WinDisplay, winTypeLabel } from './win-display';
import type { WinResult } from '../../game-logic/win-detection';
import type { ScoreResult } from '../../game-logic/scoring';

function makeWin(type: WinResult['type']): WinResult {
  return {
    type,
    melds: [
      { type: 'chow', tiles: [
        { id: 'd1a', suit: 'dots', rank: 1 },
        { id: 'd2a', suit: 'dots', rank: 2 },
        { id: 'd3a', suit: 'dots', rank: 3 },
      ]},
      { type: 'pung', tiles: [
        { id: 'd5a', suit: 'dots', rank: 5 },
        { id: 'd5b', suit: 'dots', rank: 5 },
        { id: 'd5c', suit: 'dots', rank: 5 },
      ]},
      { type: 'chow', tiles: [
        { id: 'd6a', suit: 'dots', rank: 6 },
        { id: 'd7a', suit: 'dots', rank: 7 },
        { id: 'd8a', suit: 'dots', rank: 8 },
      ]},
      { type: 'kong', tiles: [
        { id: 'd9a', suit: 'dots', rank: 9 },
        { id: 'd9b', suit: 'dots', rank: 9 },
        { id: 'd9c', suit: 'dots', rank: 9 },
        { id: 'd9d', suit: 'dots', rank: 9 },
      ]},
    ],
    pair: [{ id: 'd4a', suit: 'dots', rank: 4 }, { id: 'd4b', suit: 'dots', rank: 4 }],
    tiles: [],
  };
}

function makeScore(): ScoreResult {
  return {
    type: 'standard',
    lines: [
      { label: 'Chow (3 tiles)', points: 1 },
      { label: 'Pung (3 tiles)', points: 2 },
      { label: 'Chow (3 tiles)', points: 1 },
      { label: 'Kong (4 tiles)', points: 4 },
    ],
    total: 8,
    pointsFromEach: 8,
  };
}

describe('winTypeLabel', () => {
  it('formats each win type', () => {
    expect(winTypeLabel('standard')).toBe('Standard Win');
    expect(winTypeLabel('seven-pairs')).toBe('Seven Pairs');
    expect(winTypeLabel('thirteen-orphans')).toBe('Thirteen Orphans');
  });
});

describe('WinDisplay', () => {
  let host: HTMLDivElement;
  let display: WinDisplay;
  const onContinue = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
    onContinue.mockClear();
    onClose.mockClear();
    display = new WinDisplay(
      host,
      { onContinue, onClose },
      ['East', 'South', 'West', 'North'],
    );
    display.mount();
  });

  afterEach(() => {
    display.dispose();
    host.remove();
  });

  it('is hidden after mount', () => {
    expect(display.isOpen()).toBe(false);
  });

  it('shows the winner name and win type on show()', () => {
    display.show({
      winnerSeat: 0,
      win: makeWin('standard'),
      score: makeScore(),
      isSelfDraw: true,
    });
    expect(display.isOpen()).toBe(true);
    const winner = host.querySelector('#win-display-winner');
    expect(winner?.textContent).toContain('East');
    expect(winner?.textContent).toContain('wins');
    const type = host.querySelector('#win-display-type');
    expect(type?.textContent).toBe('Standard Win · Self-Draw');
  });

  it('renders melds and a pair for a standard win', () => {
    display.show({
      winnerSeat: 1,
      win: makeWin('standard'),
      score: makeScore(),
    });
    const hand = host.querySelector('#win-display-hand');
    expect(hand?.children.length).toBe(5); // 4 melds + pair
    const melds = host.querySelectorAll('.win-display__meld');
    expect(melds.length).toBe(5);
    expect(melds[4]?.textContent).toContain('Pair');
  });

  it('renders the score breakdown and total', () => {
    display.show({
      winnerSeat: 0,
      win: makeWin('standard'),
      score: makeScore(),
    });
    const lines = host.querySelectorAll('.win-display__score-line');
    expect(lines.length).toBe(4);
    const total = host.querySelector('#win-display-score-total');
    expect(total?.textContent).toContain('Total: 8');
    expect(total?.textContent).toContain('from each player');
  });

  it('renders a plain tile list for special hands', () => {
    const specialWin: WinResult = {
      type: 'seven-pairs',
      melds: [],
      pair: [],
      tiles: [
        { id: 'a', suit: 'dots', rank: 1 }, { id: 'b', suit: 'dots', rank: 1 },
      ],
    };
    display.show({
      winnerSeat: 0,
      win: specialWin,
      score: { type: 'seven-pairs', lines: [{ label: 'Seven Pairs', points: 12 }], total: 12, pointsFromEach: 12 },
    });
    const hand = host.querySelector('#win-display-hand');
    const note = hand?.querySelector('.win-display__hand-note');
    expect(note?.textContent).toContain('Dots 1');
  });

  it('calls onContinue when Next Round is clicked', () => {
    display.show({
      winnerSeat: 0,
      win: makeWin('standard'),
      score: makeScore(),
    });
    const btn = host.querySelector<HTMLButtonElement>('#win-display-continue');
    btn?.click();
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(display.isOpen()).toBe(false);
  });

  it('calls onClose and closes when the Close button is clicked', () => {
    display.show({
      winnerSeat: 0,
      win: makeWin('standard'),
      score: makeScore(),
    });
    const closeBtn = host.querySelector<HTMLButtonElement>('.win-display__btn--close');
    closeBtn?.click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(display.isOpen()).toBe(false);
  });

  it('closes and calls onClose on Escape', () => {
    display.show({
      winnerSeat: 0,
      win: makeWin('standard'),
      score: makeScore(),
    });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(display.isOpen()).toBe(false);
  });

  it('dispose removes the overlay from the DOM', () => {
    display.show({
      winnerSeat: 0,
      win: makeWin('standard'),
      score: makeScore(),
    });
    expect(host.querySelector('.win-display')).not.toBeNull();
    display.dispose();
    expect(host.querySelector('.win-display')).toBeNull();
  });
});
