/**
 * WinDisplay — the DOM overlay shown when a player wins the round.
 *
 * Renders a modal that announces the winner, shows the winning hand (the
 * melds + pair that formed it), and presents the score breakdown line-by-line
 * with the total. It knows nothing about the engine: it renders whatever the
 * caller feeds via {@link show} and reports the player's choice (continue to
 * next round, or close) through callbacks.
 *
 * The component is a plain DOM layer (mirroring {@link SaveLoadMenu}) so it is
 * trivially testable in jsdom and decoupled from game mechanics. It is pure
 * DOM — tile faces are rendered as text labels (the Canvas renderer owns the
 * sprite art), which keeps this overlay independent of sprite loading.
 */
import type { WinResult } from '../../game-logic/win-detection';
import type { ScoreResult, ScoreLine } from '../../game-logic/scoring';
import type { Tile } from '../../game-logic/types';

/** Callbacks the win screen invokes when the player interacts. */
export interface WinDisplayCallbacks {
  /** Called when the player clicks "Next Round" (or equivalent). */
  onContinue(): void;
  /** Called when the player dismisses the win screen without continuing. */
  onClose(): void;
}

/** The data the win screen needs to render. */
export interface WinDisplayData {
  /** The seat index of the winning player (0..3). */
  readonly winnerSeat: number;
  /** The resolved win (melds + pair) to show as the winning hand. */
  readonly win: WinResult;
  /** The score breakdown and total. */
  readonly score: ScoreResult;
  /** Human-readable name for each seat (index = seat). */
  readonly seatNames?: readonly string[];
  /** Whether the win was declared on self-draw (tsumo) vs. on a discard. */
  readonly isSelfDraw?: boolean;
}

/** Human-readable label for a tile face (e.g. "Bamboo 5", "Wind East"). */
function tileLabel(tile: Tile): string {
  const suit = tile.suit.charAt(0).toUpperCase() + tile.suit.slice(1);
  return `${suit} ${tile.rank}`;
}

/** Format a win-type key as a human sentence. */
export function winTypeLabel(type: WinResult['type']): string {
  switch (type) {
    case 'standard':
      return 'Standard Win';
    case 'seven-pairs':
      return 'Seven Pairs';
    case 'thirteen-orphans':
      return 'Thirteen Orphans';
  }
}

/**
 * The win overlay. Construct with a parent element to mount into; call
 * {@link mount} once, then {@link show} with fresh data each time a win occurs,
 * and {@link dispose} to tear down.
 */
export class WinDisplay {
  private readonly root: HTMLElement;
  private readonly callbacks: WinDisplayCallbacks;
  private readonly seatNames: readonly string[];

  private overlay: HTMLDivElement | null = null;
  private contentEl: HTMLDivElement | null = null;

  constructor(parent: HTMLElement, callbacks: WinDisplayCallbacks, seatNames: readonly string[] = []) {
    this.root = parent;
    this.callbacks = callbacks;
    this.seatNames = seatNames;
  }

  /** Whether the overlay is currently visible. */
  isOpen(): boolean {
    return this.overlay !== null && this.overlay.style.display !== 'none';
  }

  /** Build the overlay DOM and append it to the parent. Call once. */
  mount(): void {
    if (this.overlay) return;

    this.overlay = document.createElement('div');
    this.overlay.className = 'win-display';
    this.overlay.style.display = 'none';

    const panel = document.createElement('div');
    panel.className = 'win-display__panel';

    const title = document.createElement('h2');
    title.className = 'win-display__title';
    title.id = 'win-display-title';
    title.textContent = 'Round Complete';
    panel.appendChild(title);

    const winner = document.createElement('div');
    winner.className = 'win-display__winner';
    winner.id = 'win-display-winner';
    panel.appendChild(winner);

    const type = document.createElement('div');
    type.className = 'win-display__type';
    type.id = 'win-display-type';
    panel.appendChild(type);

    const handHeading = document.createElement('h3');
    handHeading.className = 'win-display__heading';
    handHeading.textContent = 'Winning Hand';
    panel.appendChild(handHeading);

    const hand = document.createElement('div');
    hand.className = 'win-display__hand';
    hand.id = 'win-display-hand';
    panel.appendChild(hand);

    const scoreHeading = document.createElement('h3');
    scoreHeading.className = 'win-display__heading';
    scoreHeading.textContent = 'Score';
    panel.appendChild(scoreHeading);

    const score = document.createElement('div');
    score.className = 'win-display__score';
    score.id = 'win-display-score';
    panel.appendChild(score);

    const footer = document.createElement('div');
    footer.className = 'win-display__footer';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'win-display__btn win-display__btn--close';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => {
      this.close();
      this.callbacks.onClose();
    });
    footer.appendChild(closeBtn);

    const continueBtn = document.createElement('button');
    continueBtn.type = 'button';
    continueBtn.className = 'win-display__btn win-display__btn--continue';
    continueBtn.id = 'win-display-continue';
    continueBtn.textContent = 'Next Round';
    continueBtn.addEventListener('click', () => {
      this.close();
      this.callbacks.onContinue();
    });
    footer.appendChild(continueBtn);

    panel.appendChild(footer);
    this.overlay.appendChild(panel);
    this.root.appendChild(this.overlay);
    this.contentEl = panel;

    // Close on Escape for keyboard parity with the rest of the UI.
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.isOpen()) {
        this.close();
        this.callbacks.onClose();
      }
    };
    document.addEventListener('keydown', this.keyHandler);
  }

  /** Show the win overlay with the given data. */
  show(data: WinDisplayData): void {
    if (!this.overlay || !this.contentEl) this.mount();

    const winnerEl = this.overlay!.querySelector<HTMLElement>('#win-display-winner');
    if (winnerEl) {
      const name = this.seatNames[data.winnerSeat] ?? `Player ${data.winnerSeat + 1}`;
      winnerEl.textContent = `${name} wins!`;
    }

    const typeEl = this.overlay!.querySelector<HTMLElement>('#win-display-type');
    if (typeEl) {
      typeEl.textContent = data.isSelfDraw
        ? `${winTypeLabel(data.win.type)} · Self-Draw`
        : winTypeLabel(data.win.type);
    }

    const handEl = this.overlay!.querySelector<HTMLElement>('#win-display-hand');
    if (handEl) {
      handEl.replaceChildren();
      if (data.win.type === 'standard') {
        data.win.melds.forEach((meld) => handEl.appendChild(this.meldGroup(meld.tiles, meld.type)));
        handEl.appendChild(this.meldGroup(data.win.pair, 'pair'));
      } else {
        // Special hands: show all 14 tiles as one row plus a label.
        const label = document.createElement('div');
        label.className = 'win-display__hand-note';
        label.textContent = data.win.tiles.map((t) => tileLabel(t)).join(' · ');
        handEl.appendChild(label);
      }
    }

    const scoreEl = this.overlay!.querySelector<HTMLElement>('#win-display-score');
    if (scoreEl) {
      scoreEl.replaceChildren();
      data.score.lines.forEach((line) => scoreEl.appendChild(this.scoreLine(line)));
      const totalRow = document.createElement('div');
      totalRow.className = 'win-display__score-total';
      totalRow.id = 'win-display-score-total';
      totalRow.textContent = `Total: ${data.score.total} pts from each player`;
      scoreEl.appendChild(totalRow);
    }

    this.overlay!.style.display = 'flex';
  }

  /** Close the overlay without disposing it. */
  close(): void {
    if (this.overlay) this.overlay.style.display = 'none';
  }

  /** Remove the overlay and all listeners from the DOM. */
  dispose(): void {
    if (this.keyHandler) document.removeEventListener('keydown', this.keyHandler);
    this.overlay?.remove();
    this.overlay = null;
    this.contentEl = null;
  }

  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  /** Build a compact inline group of tiles (a meld or the pair). */
  private meldGroup(tiles: readonly Tile[], type: string): HTMLDivElement {
    const group = document.createElement('div');
    group.className = `win-display__meld win-display__meld--${type}`;

    const tag = document.createElement('span');
    tag.className = 'win-display__meld-tag';
    tag.textContent = type === 'pair' ? 'Pair' : `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
    group.appendChild(tag);

    const tilesRow = document.createElement('span');
    tilesRow.className = 'win-display__tiles';
    tiles.forEach((t) => {
      const tileEl = document.createElement('span');
      tileEl.className = 'win-display__tile';
      tileEl.title = tileLabel(t);
      tileEl.textContent = `${t.suit.slice(0, 3)}${t.rank}`;
      tilesRow.appendChild(tileEl);
    });
    group.appendChild(tilesRow);

    return group;
  }

  /** Build a single score breakdown line. */
  private scoreLine(line: ScoreLine): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'win-display__score-line';

    const label = document.createElement('span');
    label.className = 'win-display__score-label';
    label.textContent = line.label;

    const points = document.createElement('span');
    points.className = 'win-display__score-points';
    points.textContent = `+${line.points}`;

    row.appendChild(label);
    row.appendChild(points);
    return row;
  }
}
