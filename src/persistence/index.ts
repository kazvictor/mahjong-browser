/**
 * Public surface of the persistence package.
 *
 * Consumers (the save/load menu, auto-save wiring, and tests) import from here
 * rather than reaching into deep module paths.
 */
export {
  SAVE_VERSION,
  serializeGame,
  deserializeGame,
  isSavedGame,
  savedToSnapshot,
} from './save-system';
export type {
  SavedGame,
  SavedPlayer,
  SavedTile,
  SavedMeld,
} from './save-system';
export {
  SAVE_SLOT_COUNT,
  IndexedDbSaveStorage,
  LocalStorageSaveStorage,
  FallbackSaveStorage,
  createSaveStorage,
  resetSaveStorageCache,
} from './save-storage';
export type {
  SaveStorage,
  SaveSlot,
  SaveSlotMeta,
  SaveEntry,
  SaveResult,
} from './save-storage';
export { savedGameToSnapshot, isRestorablePhase } from './snapshot-bridge';
export { SaveManager, AUTO_SAVE_SLOT, DEFAULT_AUTO_SAVE_THROTTLE_MS } from './save-manager';
export type {
  SaveManagerOptions,
  SaveOutcome,
  LoadResult,
} from './save-manager';
