/**
 * MeldDeclarationPrompt — inline UI prompt offering Chow/Pung/Kong/Pass.
 *
 * When a player may declare a meld on an opponent's discard, this component
 * shows a compact bar of buttons (Chow / Pung / Kong / Pass) near the table's
 * edge. It owns only the DOM presentation and the countdown timeout; it does
 * not decide legality or mutate game state — the caller feeds the available
 * options and receives the chosen action (or the timeout expiry) via callbacks.
 *
 * The prompt auto-hides (fires {@link onTimeout}) after `timeoutMs` unless the
 * player acts first. It appends to `document.body` and cleans itself up, so it
 * needs no host element.
 */

/** The meld kinds a player may declare. */
export type MeldDeclareKind = 'chow' | 'pung' | 'kong' | 'win' | 'pass';

/** A single selectable declaration option. */
export interface MeldDeclareOption {
  readonly kind: MeldDeclareKind;
  readonly label: string;
  /** Optional tile description shown beside the label (e.g. "Dots 5"). */
  readonly detail?: string;
}

/** Options accepted by the {@link MeldDeclarationPrompt} constructor. */
export interface MeldDeclarationPromptOptions {
  /** How long the prompt stays visible before auto-passing (ms). */
  readonly timeoutMs?: number;
  /** Optional ARIA role override. */
  readonly role?: string;
}

/** Default timeout before the prompt auto-passes. */
export const DEFAULT_MELD_TIMEOUT_MS = 6000;

/**
 * A declaration prompt. Instantiate once and call {@link show} each time a
 * meld becomes available.
 */
export class MeldDeclarationPrompt {
  private readonly timeoutMs: number;
  private readonly role: string;
  private root: HTMLDivElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Called with the chosen option's kind when the player acts. */
  onChoose: ((kind: MeldDeclareKind) => void) | null = null;
  /** Called when the countdown expires without the player acting. */
  onTimeout: (() => void) | null = null;

  constructor(options: MeldDeclarationPromptOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_MELD_TIMEOUT_MS;
    this.role = options.role ?? 'group';
  }

  /** True while the prompt is attached to the document. */
  get isOpen(): boolean {
    return this.root !== null && this.root.isConnected;
  }

  /** Show the prompt with the given options and (re)start the countdown. */
  show(options: readonly MeldDeclareOption[]): void {
    this.hide();

    const root = document.createElement('div');
    root.className = 'meld-declare-prompt';
    root.setAttribute('role', this.role);
    root.setAttribute('aria-label', 'Declare a meld');

    const bar = document.createElement('div');
    bar.className = 'meld-declare-bar';
    for (const opt of options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `meld-declare-btn meld-declare-${opt.kind}`;
      btn.textContent = opt.detail ? `${opt.label} (${opt.detail})` : opt.label;
      btn.addEventListener('click', () => {
        this.hide();
        this.onChoose?.(opt.kind);
      });
      bar.appendChild(btn);
    }

    root.appendChild(bar);
    document.body.appendChild(root);
    this.root = root;

    // Start the countdown; auto-pass on expiry.
    this.timer = setTimeout(() => {
      if (this.isOpen) {
        this.hide();
        this.onTimeout?.();
      }
    }, this.timeoutMs);
  }

  /** Detach the prompt and clear the countdown timer. */
  hide(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.root && this.root.isConnected) {
      this.root.remove();
    }
    this.root = null;
  }

  /** Alias of {@link hide}; clears both callbacks. */
  dispose(): void {
    this.onChoose = null;
    this.onTimeout = null;
    this.hide();
  }
}
