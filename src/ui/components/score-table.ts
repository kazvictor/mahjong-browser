/**
 * ScoreTable — a modal dialog showing a winning hand's scoring breakdown.
 *
 * This is a DOM overlay component (not canvas). Given the resolved faan
 * patterns, the total, and the points transferred per player, it renders a
 * clean modal with three sections: the yaku/faan table, the totals row, and
 * the points-transferred breakdown. It owns no game logic — it is a pure
 * view fed by the caller (typically after a WIN event resolves).
 *
 * The component appends itself to the document body on {@link show} and
 * removes itself on {@link hide} / {@link dispose}, so it needs no host
 * element. It exposes a {@link onClose} hook for the caller to wire a "New
 * Round" action.
 */

/** A single scored yaku pattern. */
export interface ScoreRow {
  readonly name: string;
  readonly faan: number;
}

/** Points transferred between players after a win. */
export interface PointsTransfer {
  readonly playerId: number;
  /** Display name for the player (e.g. "You", "West"). */
  readonly label: string;
  /** Net points gained (positive) or lost (negative). */
  readonly delta: number;
}

/** The data the modal needs to render. */
export interface ScoreTableData {
  readonly winnerLabel: string;
  /** Winning mechanism — "Self-draw" or "Discard". */
  readonly winType: 'SELF_DRAW' | 'DISCARD';
  readonly rows: readonly ScoreRow[];
  readonly totalFaan: number;
  /** Points the winner receives. */
  readonly winnerPoints: number;
  /** Per-player points delta (including the winner). */
  readonly transfers: readonly PointsTransfer[];
}

/** Options accepted by {@link ScoreTable} (mostly styling / i18n hooks). */
export interface ScoreTableOptions {
  /** Title shown in the modal header. */
  readonly title?: string;
  /** ARIA role for accessibility (default 'dialog'). */
  readonly role?: string;
}

const DEFAULT_TITLE = 'Round Complete';

/** Escape a string for safe interpolation into a text node (defense in depth). */
function text(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * A modal score table. Instantiate once and call {@link show} with the data
 * for each winning round.
 */
export class ScoreTable {
  private readonly title: string;
  private readonly role: string;
  private root: HTMLDivElement | null = null;

  /** Called when the user dismisses the modal (Close / New Round button). */
  onClose: (() => void) | null = null;

  constructor(options: ScoreTableOptions = {}) {
    this.title = options.title ?? DEFAULT_TITLE;
    this.role = options.role ?? 'dialog';
  }

  /** True while the modal is attached to the document. */
  get isOpen(): boolean {
    return this.root !== null && this.root.isConnected;
  }

  /** Render and attach the modal with the given data. */
  show(data: ScoreTableData): void {
    this.hide();
    const root = document.createElement('div');
    root.className = 'score-table-overlay';
    root.setAttribute('role', this.role);
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'score-table-title');

    root.innerHTML = `
      <div class="score-table-modal">
        <h2 id="score-table-title">${text(this.title)}</h2>
        <p class="score-table-winner">${text(data.winnerLabel)} wins (${text(data.winType === 'SELF_DRAW' ? 'self-draw' : 'discard')})</p>
        <table class="score-table-yaku">
          <thead>
            <tr><th>Yaku</th><th>Faan</th></tr>
          </thead>
          <tbody>
            ${data.rows
              .map(
                (r) =>
                  `<tr><td>${text(r.name)}</td><td class="num">${text(String(r.faan))}</td></tr>`,
              )
              .join('')}
            <tr class="score-table-total"><td>Total</td><td class="num">${text(String(data.totalFaan))}</td></tr>
          </tbody>
        </table>
        <div class="score-table-points">
          <span class="score-table-points-label">Winner receives</span>
          <span class="num score-table-points-value">${text(String(data.winnerPoints))} pts</span>
        </div>
        <table class="score-table-transfers">
          <thead>
            <tr><th>Player</th><th>Delta</th></tr>
          </thead>
          <tbody>
            ${data.transfers
              .map(
                (t) =>
                  `<tr><td>${text(t.label)}</td><td class="num ${
                    t.delta >= 0 ? 'pos' : 'neg'
                  }">${t.delta >= 0 ? '+' : ''}${text(String(t.delta))}</td></tr>`,
              )
              .join('')}
          </tbody>
        </table>
        <button type="button" class="score-table-close">New Round</button>
      </div>
    `;

    const closeBtn = root.querySelector<HTMLButtonElement>('.score-table-close');
    closeBtn?.addEventListener('click', () => {
      this.hide();
      this.onClose?.();
    });

    document.body.appendChild(root);
    this.root = root;
  }

  /** Detach the modal from the DOM. */
  hide(): void {
    if (this.root && this.root.isConnected) {
      this.root.remove();
    }
    this.root = null;
  }

  /** Alias of {@link hide}; also clears the onClose hook. */
  dispose(): void {
    this.onClose = null;
    this.hide();
  }
}
