/**
 * SaveLoadMenu — the DOM overlay for the Mahjong save/load system.
 *
 * Renders a non-intrusive panel (opened from a toolbar button) that lists the
 * available save slots with their metadata (timestamp, round, dealer) and lets
 * the player save to a slot, load from a slot, or delete a slot. It also hosts
 * the auto-save toggle.
 *
 * The component is a plain DOM layer: it knows nothing about the engine or the
 * storage backend. It renders whatever the caller feeds it via `setSlots()` and
 * reports user intent through the callbacks passed to the constructor. This
 * keeps it trivially testable in jsdom and decoupled from game mechanics.
 */
import { SAVE_SLOT_COUNT, type SaveSlotMeta } from '../../persistence';
import type { SaveSlot } from '../../persistence';

/** Callbacks the menu invokes when the player interacts with a slot. */
export interface SaveLoadCallbacks {
  /** Save the current game into `slot`. Should resolve the resulting meta. */
  onSave(slot: SaveSlot): Promise<void> | void;
  /** Load the game from `slot`. */
  onLoad(slot: SaveSlot): Promise<void> | void;
  /** Delete the contents of `slot`. */
  onDelete(slot: SaveSlot): Promise<void> | void;
  /** Toggle the auto-save setting. */
  onToggleAutoSave(enabled: boolean): void;
}

/** Human-readable dealer name for a seat. */
const DEALER_NAMES = ['East', 'South', 'West', 'North'] as const;

/** Format an ISO timestamp as a short local string for the menu. */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The save/load overlay. Construct with a parent element to mount into; call
 * {@link render} to (re)build the slot list, and {@link dispose} to tear down.
 */
export class SaveLoadMenu {
  private readonly root: HTMLElement;
  private readonly callbacks: SaveLoadCallbacks;
  private readonly slots: Map<SaveSlot, SaveSlotMeta> = new Map();
  private autoSave = false;

  private overlay: HTMLDivElement | null = null;
  private statusEl: HTMLSpanElement | null = null;

  constructor(parent: HTMLElement, callbacks: SaveLoadCallbacks) {
    this.root = parent;
    this.callbacks = callbacks;
  }

  /** Replace the known slot metadata (e.g. after a save/load/delete). */
  setSlots(metas: readonly SaveSlotMeta[]): void {
    this.slots.clear();
    for (const meta of metas) this.slots.set(meta.slot, meta);
    this.renderSlots();
  }

  /** Set the current auto-save setting (refreshes the toggle). */
  setAutoSave(enabled: boolean): void {
    this.autoSave = enabled;
    this.renderToggle();
  }

  /** Whether the overlay is currently visible. */
  isOpen(): boolean {
    return this.overlay !== null && this.overlay.style.display !== 'none';
  }

  /** Open (or close) the overlay. */
  toggle(): void {
    if (!this.overlay) return;
    const open = this.overlay.style.display !== 'flex';
    this.overlay.style.display = open ? 'flex' : 'none';
  }

  /** Open the overlay if closed; a no-op if already open. */
  open(): void {
    if (!this.overlay) return;
    this.overlay.style.display = 'flex';
  }

  /** Show a transient status message in the menu footer. */
  setStatus(message: string): void {
    if (this.statusEl) this.statusEl.textContent = message;
  }

  /** Build the overlay DOM and append it to the parent. Call once. */
  mount(): void {
    if (this.overlay) return;

    this.overlay = document.createElement('div');
    this.overlay.className = 'save-load-menu';
    this.overlay.style.display = 'none';

    const header = document.createElement('div');
    header.className = 'save-load-menu__header';
    header.textContent = 'Save / Load Game';

    const body = document.createElement('div');
    body.className = 'save-load-menu__body';
    body.appendChild(header);

    const slotList = document.createElement('div');
    slotList.className = 'save-load-menu__slots';
    slotList.id = 'save-load-slots';
    body.appendChild(slotList);
    this.slotListEl = slotList;

    const autoRow = document.createElement('label');
    autoRow.className = 'save-load-menu__auto';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.id = 'save-load-auto';
    toggle.checked = this.autoSave;
    toggle.addEventListener('change', () => {
      this.autoSave = toggle.checked;
      this.callbacks.onToggleAutoSave(this.autoSave);
    });
    const toggleLabel = document.createElement('span');
    toggleLabel.textContent = 'Auto-save on each turn';
    autoRow.appendChild(toggle);
    autoRow.appendChild(toggleLabel);
    body.appendChild(autoRow);
    this.autoToggle = toggle;

    const footer = document.createElement('div');
    footer.className = 'save-load-menu__footer';
    this.statusEl = document.createElement('span');
    this.statusEl.className = 'save-load-menu__status';
    footer.appendChild(this.statusEl);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'save-load-menu__close';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => this.close());
    footer.appendChild(closeBtn);
    body.appendChild(footer);

    this.overlay.appendChild(body);
    this.root.appendChild(this.overlay);

    // Close on Escape for keyboard parity with the rest of the UI.
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.isOpen()) this.close();
    };
    document.addEventListener('keydown', this.keyHandler);

    this.renderSlots();
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
    this.slotListEl = null;
    this.statusEl = null;
    this.autoToggle = null;
  }

  private slotListEl: HTMLDivElement | null = null;
  private autoToggle: HTMLInputElement | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  /** (Re)build the slot rows from the current metadata. */
  private renderSlots(): void {
    const list = this.slotListEl;
    if (!list) return;
    list.replaceChildren();

    for (let slot = 1; slot <= SAVE_SLOT_COUNT; slot++) {
      const meta = this.slots.get(slot);
      const row = document.createElement('div');
      row.className = meta ? 'save-load-slot' : 'save-load-slot save-load-slot--empty';

      const label = document.createElement('div');
      label.className = 'save-load-slot__label';
      label.textContent = `Slot ${slot}`;

      const info = document.createElement('div');
      info.className = 'save-load-slot__info';
      if (meta) {
        const dealer = DEALER_NAMES[meta.dealer] ?? `Seat ${meta.dealer}`;
        info.textContent =
          `${formatTimestamp(meta.savedAt)} · Round ${meta.round} · ${dealer}` +
          (meta.isAutoSave ? ' · auto' : '');
      } else {
        info.textContent = 'Empty';
      }

      const actions = document.createElement('div');
      actions.className = 'save-load-slot__actions';

      const saveBtn = this.actionButton('Save', 'save-load-btn--save', () => {
        void this.invoke(() => this.callbacks.onSave(slot));
      });
      actions.appendChild(saveBtn);

      if (meta) {
        const loadBtn = this.actionButton('Load', 'save-load-btn--load', () => {
          void this.invoke(() => this.callbacks.onLoad(slot));
        });
        actions.appendChild(loadBtn);
        const delBtn = this.actionButton('Delete', 'save-load-btn--delete', () => {
          void this.invoke(() => this.callbacks.onDelete(slot));
        });
        actions.appendChild(delBtn);
      }

      row.appendChild(label);
      row.appendChild(info);
      row.appendChild(actions);
      list.appendChild(row);
    }
  }

  /** (Re)render just the auto-save toggle to match the current setting. */
  private renderToggle(): void {
    if (this.autoToggle) this.autoToggle.checked = this.autoSave;
  }

  /** Build a small button with a click handler. */
  private actionButton(
    text: string,
    className: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `save-load-btn ${className}`;
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  /** Wrap a slot action so errors surface in the menu instead of crashing. */
  private async invoke(action: () => Promise<void> | void): Promise<void> {
    try {
      await action();
    } catch (err) {
      this.setStatus(err instanceof Error ? err.message : 'Save/load failed.');
    }
  }
}
