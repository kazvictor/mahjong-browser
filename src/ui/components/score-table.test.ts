/**
 * Unit tests for the ScoreTable modal DOM component.
 */
// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { ScoreTable, type ScoreTableData } from './score-table';

const data: ScoreTableData = {
  winnerLabel: 'You',
  winType: 'SELF_DRAW',
  rows: [
    { name: 'Pure One Suit', faan: 3 },
    { name: 'Self-Draw', faan: 1 },
  ],
  totalFaan: 4,
  winnerPoints: 4000,
  transfers: [
    { playerId: 0, label: 'You', delta: 12000 },
    { playerId: 1, label: 'West', delta: -4000 },
    { playerId: 2, label: 'North', delta: -4000 },
    { playerId: 3, label: 'East', delta: -4000 },
  ],
};

describe('ScoreTable', () => {
  let table: ScoreTable;

  beforeEach(() => {
    document.body.innerHTML = '';
    table = new ScoreTable();
  });

  afterEach(() => {
    table.hide();
  });

  it('is closed initially', () => {
    expect(table.isOpen).toBe(false);
  });

  it('renders and opens with the given data', () => {
    table.show(data);
    expect(table.isOpen).toBe(true);
    const root = document.querySelector('.score-table-overlay');
    expect(root).not.toBeNull();
    // Winner line present.
    expect(root!.textContent).toContain('You wins');
    expect(root!.textContent).toContain('self-draw');
    // Yaku rows rendered.
    expect(root!.textContent).toContain('Pure One Suit');
    expect(root!.textContent).toContain('Self-Draw');
    expect(root!.textContent).toContain('Total');
    expect(root!.textContent).toContain('4');
    // Points.
    expect(root!.textContent).toContain('Winner receives');
    expect(root!.textContent).toContain('4000');
    // Transfers.
    expect(root!.textContent).toContain('West');
    expect(root!.textContent).toContain('-4000');
  });

  it('labels discard wins correctly', () => {
    table.show({ ...data, winType: 'DISCARD' });
    const root = document.querySelector('.score-table-overlay');
    expect(root!.textContent).toContain('discard');
  });

  it('close button hides the modal and fires onClose', () => {
    let closed = 0;
    table.onClose = () => closed++;
    table.show(data);
    const btn = document.querySelector<HTMLButtonElement>('.score-table-close');
    btn!.click();
    expect(table.isOpen).toBe(false);
    expect(closed).toBe(1);
    expect(document.querySelector('.score-table-overlay')).toBeNull();
  });

  it('hide() detaches the modal without firing onClose', () => {
    let closed = 0;
    table.onClose = () => closed++;
    table.show(data);
    table.hide();
    expect(table.isOpen).toBe(false);
    expect(closed).toBe(0);
  });

  it('show() replaces any previously-open modal', () => {
    table.show(data);
    table.show({ ...data, winnerLabel: 'North' });
    expect(table.isOpen).toBe(true);
    const roots = document.querySelectorAll('.score-table-overlay');
    expect(roots).toHaveLength(1);
    expect(roots[0]!.textContent).toContain('North wins');
  });

  it('escapes HTML in winner labels and yaku names (no injection)', () => {
    table.show({
      ...data,
      winnerLabel: '<img src=x onerror=alert(1)>',
      rows: [{ name: '<script>bad()</script>', faan: 1 }],
    });
    const root = document.querySelector('.score-table-overlay');
    expect(root!.querySelector('img')).toBeNull();
    expect(root!.querySelector('script')).toBeNull();
    // The raw text is escaped and displayed literally.
    expect(root!.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
