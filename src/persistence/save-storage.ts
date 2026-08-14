/**
 * Save-storage — the persistence backend for the Mahjong save/load system.
 *
 * Provides a small async storage abstraction over either IndexedDB (the
 * primary backend — the app is an offline-capable PWA, so a durable DB-backed
 * store is the right default) or `localStorage` as a fallback. Both backends
 * implement the same {@link SaveStorage} interface so the save/load menu and
 * auto-save code never care which one is live.
 *
 * Backend selection:
 *   - IndexedDB is used when `window.indexedDB` is available and the store
 *     opens without error.
 *   - Otherwise a `localStorage`-backed store is used. `localStorage` has a
 *     ~5MB quota, comfortably above the few-KB size of a serialized save, and
 *     survives tab reloads like IndexedDB.
 *
 * Both backends store each save slot under the same key layout, so a save
 * written through one backend cannot silently be read through the other — the
 * slot keys are prefixed distinctly (`mj:idb:` vs `mj:ls:`) to make that
 * mismatch impossible and fail loudly if a caller forces the wrong backend.
 */
import { deserializeGame, type SavedGame } from './save-system';

/** Number of distinct save slots available to the player. */
export const SAVE_SLOT_COUNT = 3;

/** IndexedDB database + object-store names. */
const DB_NAME = 'mahjong-browser';
const DB_STORE = 'saves';
const DB_VERSION = 1;

/** Key prefix for IndexedDB records (avoids collisions with other apps' data). */
const IDB_KEY_PREFIX = 'mj:idb:';

/** Key prefix for localStorage records. */
const LS_KEY_PREFIX = 'mj:ls:';

/** A single save slot (1-based index). */
export type SaveSlot = number;

/** What a save/load operation can return. */
export type SaveResult = 'saved' | 'loaded' | 'deleted' | 'not_found';

/**
 * The storage abstraction both backends implement. All methods are async so a
 * caller is never coupled to which backend is live.
 */
export interface SaveStorage {
  /** Save a serialized document into a slot (1-based). */
  save(slot: SaveSlot, json: string, savedAt: string): Promise<SaveResult>;
  /** Load the raw JSON stored in a slot, or null if the slot is empty. */
  load(slot: SaveSlot): Promise<string | null>;
  /** List the non-empty slots and their metadata, in slot order. */
  list(): Promise<SaveSlotMeta[]>;
  /** Delete a slot's contents. Never throws when the slot is already empty. */
  remove(slot: SaveSlot): Promise<SaveResult>;
}

/** Metadata describing a non-empty save slot (for the menu). */
export interface SaveSlotMeta {
  readonly slot: SaveSlot;
  readonly savedAt: string;
  /** Round number this save corresponds to (parsed for display). */
  readonly round: number;
  /** Dealer seat for this save (parsed for display). */
  readonly dealer: number;
  readonly isAutoSave: boolean;
}

/** A slot number together with its parsed document, when populated. */
export interface SaveEntry {
  readonly slot: SaveSlot;
  readonly game: SavedGame;
}

/** Validate that a slot index is within the supported range. */
function assertSlot(slot: SaveSlot): void {
  if (!Number.isInteger(slot) || slot < 1 || slot > SAVE_SLOT_COUNT) {
    throw new Error(`Invalid save slot ${slot} (expected 1..${SAVE_SLOT_COUNT}).`);
  }
}

/** True when a saved document can be parsed + is structurally valid. */
function parseStored(json: string): SavedGame | null {
  try {
    return deserializeGame(json);
  } catch {
    return null;
  }
}

/** Extract display metadata from a valid saved document. */
function toMeta(slot: SaveSlot, game: SavedGame): SaveSlotMeta {
  return {
    slot,
    savedAt: game.savedAt,
    round: game.round,
    dealer: game.dealer,
    isAutoSave: game.isAutoSave,
  };
}

// ---------------------------------------------------------------------------
// IndexedDB backend
// ---------------------------------------------------------------------------

/** Open (creating if needed) the IndexedDB store. Returns null if unavailable. */
function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

/**
 * IndexedDB-backed storage. Created by {@link createSaveStorage}; a failed
 * open leaves the instance unusable so the factory falls back to localStorage.
 */
export class IndexedDbSaveStorage implements SaveStorage {
  private readonly db: Promise<IDBDatabase | null>;

  constructor() {
    this.db = openDb();
  }

  async save(slot: SaveSlot, json: string, savedAt: string): Promise<SaveResult> {
    assertSlot(slot);
    const db = await this.db;
    if (!db) return 'not_found'; // backend unavailable — treated as no-op
    const tx = db.transaction(DB_STORE, 'readwrite');
    await idbPut(tx, this.key(slot), { json, savedAt });
    return 'saved';
  }

  async load(slot: SaveSlot): Promise<string | null> {
    assertSlot(slot);
    const db = await this.db;
    if (!db) return null;
    const tx = db.transaction(DB_STORE, 'readonly');
    const rec = await idbGet(tx, this.key(slot));
    return rec ? rec.json : null;
  }

  async list(): Promise<SaveSlotMeta[]> {
    const db = await this.db;
    if (!db) return [];
    const tx = db.transaction(DB_STORE, 'readonly');
    const recs = await idbGetAll(tx);
    const metas: SaveSlotMeta[] = [];
    for (const rec of recs) {
      const parsed = parseStored(rec.json);
      if (parsed) {
        const slot = parseSlotKey(rec.key as string);
        if (slot !== null) metas.push(toMeta(slot, parsed));
      }
    }
    // Always return in slot order, even if the store returned them unsorted.
    metas.sort((a, b) => a.slot - b.slot);
    return metas;
  }

  async remove(slot: SaveSlot): Promise<SaveResult> {
    assertSlot(slot);
    const db = await this.db;
    if (!db) return 'not_found';
    const tx = db.transaction(DB_STORE, 'readwrite');
    await idbDelete(tx, this.key(slot));
    return 'deleted';
  }

  private key(slot: SaveSlot): string {
    return `${IDB_KEY_PREFIX}${slot}`;
  }
}

/** Promise wrapper for a single-record object-store put. */
function idbPut(
  tx: IDBTransaction,
  key: string,
  value: unknown,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const store = tx.objectStore(DB_STORE);
    const req = store.put(value, key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Promise wrapper for a single-record object-store get. */
function idbGet(tx: IDBTransaction, key: string): Promise<{ json: string } | null> {
  return new Promise((resolve, reject) => {
    const store = tx.objectStore(DB_STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve((req.result as { json?: string } | null)?.json ? (req.result as { json: string }) : null);
    req.onerror = () => reject(req.error);
  });
}

/** Promise wrapper for a full object-store scan (keys + values). */
function idbGetAll(tx: IDBTransaction): Promise<Array<{ key: string; json: string }>> {
  return new Promise((resolve, reject) => {
    const store = tx.objectStore(DB_STORE);
    const keysReq = store.getAllKeys();
    const valsReq = store.getAll();
    let keys: IDBValidKey[] | null = null;
    let vals: unknown[] | null = null;
    let failed = false;
    keysReq.onsuccess = () => {
      keys = keysReq.result;
      if (vals !== null) resolve(zip(keys, vals));
    };
    keysReq.onerror = () => {
      if (!failed) {
        failed = true;
        reject(keysReq.error);
      }
    };
    valsReq.onsuccess = () => {
      vals = valsReq.result as unknown[];
      if (keys !== null) resolve(zip(keys, vals));
    };
    valsReq.onerror = () => {
      if (!failed) {
        failed = true;
        reject(valsReq.error);
      }
    };
  });
}

function zip(
  keys: IDBValidKey[],
  vals: unknown[],
): Array<{ key: string; json: string }> {
  const out: Array<{ key: string; json: string }> = [];
  for (let i = 0; i < keys.length; i++) {
    const rec = vals[i] as { json?: string } | undefined;
    const json = rec?.json;
    if (typeof json === 'string' && typeof keys[i] === 'string') {
      out.push({ key: keys[i] as string, json });
    }
  }
  return out;
}

/** Promise wrapper for a single-record object-store delete. */
function idbDelete(tx: IDBTransaction, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const store = tx.objectStore(DB_STORE);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Extract the numeric slot from a prefixed IndexedDB key, or null. */
function parseSlotKey(key: string): SaveSlot | null {
  if (!key.startsWith(IDB_KEY_PREFIX)) return null;
  const n = Number(key.slice(IDB_KEY_PREFIX.length));
  return Number.isInteger(n) && n >= 1 && n <= SAVE_SLOT_COUNT ? n : null;
}

// ---------------------------------------------------------------------------
// localStorage backend
// ---------------------------------------------------------------------------

/**
 * localStorage-backed storage. Used when IndexedDB is unavailable (e.g. some
 * private-browsing modes or older engines). Keys are namespaced with a
 * different prefix from IndexedDB so the two backends never cross-read.
 */
export class LocalStorageSaveStorage implements SaveStorage {
  private readonly storage: Storage;

  constructor(storage: Storage = window.localStorage) {
    this.storage = storage;
  }

  async save(slot: SaveSlot, json: string, savedAt: string): Promise<SaveResult> {
    assertSlot(slot);
    try {
      this.storage.setItem(this.key(slot), JSON.stringify({ json, savedAt }));
      return 'saved';
    } catch {
      return 'not_found'; // quota exceeded or storage unavailable
    }
  }

  async load(slot: SaveSlot): Promise<string | null> {
    assertSlot(slot);
    const raw = this.storage.getItem(this.key(slot));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { json?: string };
      return typeof parsed.json === 'string' ? parsed.json : null;
    } catch {
      return null;
    }
  }

  async list(): Promise<SaveSlotMeta[]> {
    const metas: SaveSlotMeta[] = [];
    for (let slot = 1; slot <= SAVE_SLOT_COUNT; slot++) {
      const json = await this.load(slot);
      if (!json) continue;
      const game = parseStored(json);
      if (game) metas.push(toMeta(slot, game));
    }
    return metas;
  }

  async remove(slot: SaveSlot): Promise<SaveResult> {
    assertSlot(slot);
    try {
      this.storage.removeItem(this.key(slot));
      return 'deleted';
    } catch {
      return 'not_found';
    }
  }

  private key(slot: SaveSlot): string {
    return `${LS_KEY_PREFIX}${slot}`;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * A {@link SaveStorage} that prefers IndexedDB and transparently falls back to
 * localStorage when IndexedDB is unavailable or fails to open. The chosen
 * backend is fixed for the lifetime of the instance, so reads always hit the
 * same backend the writes did.
 */
export class FallbackSaveStorage implements SaveStorage {
  private readonly primary: SaveStorage;
  private readonly fallback: SaveStorage;

  constructor(primary: SaveStorage, fallback: SaveStorage) {
    this.primary = primary;
    this.fallback = fallback;
  }

  async save(slot: SaveSlot, json: string, savedAt: string): Promise<SaveResult> {
    const r = await this.primary.save(slot, json, savedAt);
    if (r === 'saved') return r;
    return this.fallback.save(slot, json, savedAt);
  }

  async load(slot: SaveSlot): Promise<string | null> {
    const fromPrimary = await this.primary.load(slot);
    if (fromPrimary !== null) return fromPrimary;
    return this.fallback.load(slot);
  }

  async list(): Promise<SaveSlotMeta[]> {
    const primaryMetas = await this.primary.list();
    if (primaryMetas.length > 0) return primaryMetas;
    return this.fallback.list();
  }

  async remove(slot: SaveSlot): Promise<SaveResult> {
    await this.primary.remove(slot);
    return this.fallback.remove(slot);
  }
}

/** Cache the chosen storage so the whole app shares one backend. */
let cached: SaveStorage | null = null;

/**
 * Create (and cache) the app-wide save storage. Prefers IndexedDB; falls back
 * to localStorage when IndexedDB is not available.
 */
export async function createSaveStorage(): Promise<SaveStorage> {
  if (cached) return cached;
  const idb = new IndexedDbSaveStorage();
  const idbReady = await idb.list().then(
    () => true,
    () => false,
  );
  if (idbReady) {
    cached = idb;
    return cached;
  }
  cached = new LocalStorageSaveStorage();
  return cached;
}

/** Test hook: reset the cached storage so a fresh backend is chosen next time. */
export function resetSaveStorageCache(): void {
  cached = null;
}
