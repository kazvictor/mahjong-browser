/**
 * Unit tests for the MeldDeclarationPrompt DOM component.
 */
// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { MeldDeclarationPrompt, DEFAULT_MELD_TIMEOUT_MS } from './meld-declaration';

describe('MeldDeclarationPrompt', () => {
  let prompt: MeldDeclarationPrompt;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    prompt = new MeldDeclarationPrompt();
  });

  afterEach(() => {
    prompt.hide();
    vi.useRealTimers();
  });

  it('is closed initially', () => {
    expect(prompt.isOpen).toBe(false);
  });

  it('shows one button per option', () => {
    prompt.show([
      { kind: 'chow', label: 'Chow', detail: 'Dots 5' },
      { kind: 'pung', label: 'Pung' },
      { kind: 'pass', label: 'Pass' },
    ]);
    expect(prompt.isOpen).toBe(true);
    const buttons = document.querySelectorAll('.meld-declare-btn');
    expect(buttons).toHaveLength(3);
    // Detail appended in parens.
    expect(buttons[0]!.textContent).toBe('Chow (Dots 5)');
    expect(buttons[1]!.textContent).toBe('Pung');
  });

  it('fires onChoose with the selected kind and hides', () => {
    const chosen: string[] = [];
    prompt.onChoose = (kind) => chosen.push(kind);
    prompt.show([
      { kind: 'pung', label: 'Pung' },
      { kind: 'pass', label: 'Pass' },
    ]);
    const pungBtn = document.querySelector<HTMLButtonElement>('.meld-declare-pung');
    pungBtn!.click();
    expect(chosen).toEqual(['pung']);
    expect(prompt.isOpen).toBe(false);
  });

  it('auto-passes via onTimeout after the countdown', () => {
    const timeouts: string[] = [];
    prompt.onTimeout = () => timeouts.push('expired');
    prompt.show([{ kind: 'pass', label: 'Pass' }]);
    expect(prompt.isOpen).toBe(true);
    vi.advanceTimersByTime(DEFAULT_MELD_TIMEOUT_MS);
    expect(timeouts).toEqual(['expired']);
    expect(prompt.isOpen).toBe(false);
  });

  it('clears the timeout when the player acts before it expires', () => {
    let timeouts = 0;
    prompt.onTimeout = () => timeouts++;
    prompt.show([{ kind: 'pass', label: 'Pass' }]);
    document.querySelector<HTMLButtonElement>('.meld-declare-pass')!.click();
    vi.advanceTimersByTime(DEFAULT_MELD_TIMEOUT_MS * 2);
    expect(timeouts).toBe(0);
  });

  it('hide() clears the timer and detaches without firing callbacks', () => {
    let timeouts = 0;
    prompt.onTimeout = () => timeouts++;
    prompt.show([{ kind: 'pass', label: 'Pass' }]);
    prompt.hide();
    vi.advanceTimersByTime(DEFAULT_MELD_TIMEOUT_MS * 2);
    expect(timeouts).toBe(0);
    expect(document.querySelector('.meld-declare-prompt')).toBeNull();
  });

  it('show() replaces an existing prompt', () => {
    prompt.show([{ kind: 'chow', label: 'Chow' }]);
    prompt.show([{ kind: 'pung', label: 'Pung' }]);
    expect(document.querySelectorAll('.meld-declare-prompt')).toHaveLength(1);
    expect(document.querySelectorAll('.meld-declare-btn')).toHaveLength(1);
    expect(document.querySelector('.meld-declare-pung')).not.toBeNull();
  });
});
