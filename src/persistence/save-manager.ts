/**
 * Save-manager — orchestrates the persistence lifecycle around the live engine.
 *
 * This is the single place that knows the game → storage contract. It wires a
 * `MahjongGame` snapshot and a {@link SaveStorage} backend together:
 *
 *   - `save(slot)` — serialize the current snapshot into a slot.
 *   - `load(slot)` — read a slot, validate + hydrate it, and hand back a
 *     `GameSnapshot` ready for `MahjongGame.restore()`.
 *   - `clear(slot)` — delete a slot (used on a completed round / new game).
 *   - Auto-save — throttled persistence to a dedicated slot after each game
 *     action, so a page reload resumes exactly where play left off. The
 *     throttle collapses bursts of actions (a draw + a discard arriving within
 *     the window) into a single write.
 *
 * Corrupted saves are never allowed to reach the engine: `load` runs the
 * structural validator (`deserializeGame`) and then the deep invariant checks in
 * {@link savedGameToSnapshot}; any failure surfaces as an error the caller can
 * show to the player alongside a "start a new game" option.
 *
 * The manager is intentionally engine-agnostic on input (it takes a
 * `GameSnapshot`) and returns plain data, so it stays headless and unit-testable.
 */
import type { GameSnapshot } from '@game-logic';
import { GameState } from '@game-logic';
import { deserializeGame, serializeGame } from './save-system';
import { savedGameToSnapshot } from './snapshot-bridge';
import type { SaveSlot, SaveStorage, SaveSlotMeta } from './save-storage';
import { createSaveStorage, SAVE_SLOT_COUNT } from './save-storage';

/** The slot auto-saves are written to (1-based). Kept distinct from manual slots. */
export const AUTO_SAVE_SLOT = 1;

/** Default minimum gap between auto-saves, in milliseconds. */
export const DEFAULT_AUTO_SAVE_THROTTLE_MS = 500;

/** The result of a save/load/clear operation, with any error surfaced. */
export type SaveOutcome =
  | { readonly ok: true; readonly meta: SaveSlotMeta }
  | { readonly ok: false; readonly error: string };

/** A load result: a restored snapshot, or an error. */
export type LoadResult =
  | { readonly ok: true; readonly snapshot: GameSnapshot }
  | { readonly ok: false; readonly error: string };

/** Options accepted by the {@link SaveManager} constructor. */
export interface SaveManagerOptions {
  /** Backend to persist through. Defaults to {@link createSaveStorage}. */
  readonly storage?: SaveStorage;
  /** Auto-save throttle window in ms. Defaults to {@link DEFAULT_AUTO_SAVE_THROTTLE_MS}. */
  readonly throttleMs?: number;
  /** Callback invoked whenever a save/load operation completes (for UI toasts). */
  readonly onStatus?: (message: string) => void;
}

/**
 * The persistence coordinator. Construct with a storage backend; call
 * {@link connect} with the live game snapshot accessor to arm auto-save, and
 * {@link disconnect} when the game is torn down.
 */
export class SaveManager {
  private readonly storage: Promise<SaveStorage> | SaveStorage;
  private readonly throttleMs: number;
  private readonly onStatus: (message: string) => void;

  private snapshotSource: (() => GameSnapshot) | null = null;
  private autoSaveEnabled = false;
  private pendingAutoSave = false;
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAutoSaveAt = 0;
  private disposed = false;

  constructor(options: SaveManagerOptions = {}) {
    // If no backend was supplied, create the app-wide one (which itself prefers
    // IndexedDB and falls back to localStorage) asynchronously.
    this.storage = options.storage ?? createSaveStorage();
    this.throttleMs = options.throttleMs ?? DEFAULT_AUTO_SAVE_THROTTLE_MS;
    this.onStatus = options.onStatus ?? (() => undefined);
  }

  /** Whether auto-save is currently armed. */
  get autoSaveOn(): boolean {
    return this.autoSaveEnabled;
  }

  /** The number of manual save slots (the auto-save slot is excluded). */
  get manualSlotCount(): number {
    return Math.max(0, SAVE_SLOT_COUNT - 1);
  }

  /**
   * Arm auto-save. `snapshotSource` returns the engine's current snapshot; after
   * each game action the manager throttles writes to {@link AUTO_SAVE_SLOT}.
   */
  connect(snapshotSource: () => GameSnapshot): void {
    this.snapshotSource = snapshotSource;
  }

  /** Disarm auto-save, flush any pending write, and cancel timers. */
  disconnect(): void {
    this.autoSaveEnabled = false;
    this.flushAutoSave();
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /** Permanently shut down the manager (frees the timer; idempotent). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disconnect();
  }

  /**
   * Enable or disable auto-save. When enabling, the current state is written
   * immediately (so a reload right after enabling still has something to load).
   */
  setAutoSave(enabled: boolean): void {
    this.autoSaveEnabled = enabled;
    if (enabled && this.snapshotSource) {
      void this.persistToAutoSlot();
    }
  }

  /**
   * Called after every game action. Triggers a throttled auto-save when armed;
   * clears the auto-save when the round has ended (GAME_OVER / IDLE), so a
   * finished game never resurrects on the next reload.
   */
  onAction(): void {
    if (this.disposed || !this.autoSaveEnabled || !this.snapshotSource) return;

    const phase = this.snapshotSource().phase;
    if (phase === GameState.GAME_OVER || phase === GameState.IDLE) {
      this.flushAutoSave();
      void this.clear(AUTO_SAVE_SLOT);
      return;
    }

    const now = Date.now();
    if (this.pendingAutoSave) return; // a write is already scheduled — collapse the burst
    if (now - this.lastAutoSaveAt < this.throttleMs) {
      // Within the throttle window: schedule a trailing write.
      this.pendingAutoSave = true;
      if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = setTimeout(() => {
        this.autoSaveTimer = null;
        this.flushAutoSave();
      }, this.throttleMs - (now - this.lastAutoSaveAt));
      return;
    }
    // Outside the window: write immediately.
    void this.persistToAutoSlot();
  }

  /** Save the current snapshot into a manual slot. Returns the new slot meta. */
  async save(slot: SaveSlot): Promise<SaveOutcome> {
    return this.writeSlot(slot, this.currentSnapshot(), false);
  }

  /**
   * Load a slot. Returns the restored {@link GameSnapshot} ready for
   * `MahjongGame.restore()`, or an error outcome when the slot is empty or the
   * data is corrupted. Corrupted data is never handed to the engine.
   */
  async load(slot: SaveSlot): Promise<LoadResult> {
    try {
      const storage = await this.resolveStorage();
      const json = await storage.load(slot);
      if (json === null) {
        return { ok: false, error: `Slot ${slot} is empty.` };
      }
      const saved = deserializeGame(json); // structural validation
      const snapshot = savedGameToSnapshot(saved); // deep invariant validation
      this.onStatus(`Loaded slot ${slot}.`);
      return { ok: true, snapshot };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Load failed.';
      this.onStatus(message);
      return { ok: false, error: message };
    }
  }

  /** Delete a slot's contents (never throws on an already-empty slot). */
  async clear(slot: SaveSlot): Promise<SaveOutcome> {
    const storage = await this.resolveStorage();
    const result = await storage.remove(slot);
    const meta: SaveSlotMeta = { slot, savedAt: '', round: 0, dealer: 0, isAutoSave: false };
    if (result === 'deleted') {
      this.onStatus(`Cleared slot ${slot}.`);
      return { ok: true, meta };
    }
    return { ok: false, error: `Slot ${slot} could not be cleared.` };
  }

  /** List the non-empty slots (manual + auto) for the menu. */
  async list(): Promise<SaveSlotMeta[]> {
    const storage = await this.resolveStorage();
    return storage.list();
  }

  /**
   * Try to restore the auto-save from the previous session, if any.
   *
   * Returns the restored {@link GameSnapshot} when a valid auto-save exists,
   * or `null` when there is nothing to resume (fresh browser, no prior game, or
   * a round that was completed — the auto-save is cleared on game end).
   *
   * A corrupted auto-save is not silently discarded: it surfaces through
   * {@link onStatus} and is cleared so the next reload does not re-encounter it,
   * and `null` is returned so the caller offers a fresh game.
   */
  async loadAutoSave(): Promise<GameSnapshot | null> {
    const storage = await this.resolveStorage();
    const json = await storage.load(AUTO_SAVE_SLOT);
    if (json === null) return null;

    let snapshot: GameSnapshot;
    try {
      const saved = deserializeGame(json);
      snapshot = savedGameToSnapshot(saved);
    } catch (err) {
      // Corrupted auto-save: report it, clear it, and let the caller start fresh.
      const message = err instanceof Error ? err.message : 'Auto-save is corrupted.';
      this.onStatus(`Auto-save could not be loaded (${message}). Starting a new game.`);
      await this.clear(AUTO_SAVE_SLOT);
      return null;
    }

    this.onStatus('Resumed from auto-save.');
    return snapshot;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private currentSnapshot(): GameSnapshot {
    if (!this.snapshotSource) {
      throw new Error('SaveManager has no game connected — call connect() first.');
    }
    return this.snapshotSource();
  }

  /** Resolve the live backend, awaiting the lazily-created one if needed. */
  private async resolveStorage(): Promise<SaveStorage> {
    if (this.storage instanceof Promise) {
      return this.storage;
    }
    return this.storage;
  }

  private async writeSlot(
    slot: SaveSlot,
    snapshot: GameSnapshot,
    isAutoSave: boolean,
  ): Promise<SaveOutcome> {
    try {
      const savedAt = new Date().toISOString();
      const json = serializeGame(snapshot, { savedAt, isAutoSave });
      const storage = await this.resolveStorage();
      const result = await storage.save(slot, json, savedAt);
      if (result !== 'saved') {
        return { ok: false, error: `Slot ${slot} could not be written.` };
      }
      this.onStatus(`${isAutoSave ? 'Auto-saved' : `Saved slot ${slot}`}.`);
      return {
        ok: true,
        meta: {
          slot,
          savedAt,
          round: snapshot.round,
          dealer: snapshot.dealer,
          isAutoSave,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed.';
      this.onStatus(message);
      return { ok: false, error: message };
    }
  }

  private async persistToAutoSlot(): Promise<void> {
    if (this.disposed || !this.snapshotSource) return;
    this.lastAutoSaveAt = Date.now();
    await this.writeSlot(AUTO_SAVE_SLOT, this.currentSnapshot(), true);
  }

  /** Immediately write any pending throttled auto-save. */
  private flushAutoSave(): void {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    if (this.pendingAutoSave) {
      this.pendingAutoSave = false;
      void this.persistToAutoSlot();
    }
  }
}
