/**
 * AssetLoader — preloads and serves the Mahjong tile sprites.
 *
 * Tile sprites live in `src/assets/tiles/` as 80×120px (2x) PNGs. Vite bundles
 * them via `import.meta.glob`, which returns a map of file path → lazy import
 * of the resolved asset URL. The loader:
 *   - eagerly loads every sprite on construction (or on `load()`),
 *   - resolves a tile face / back to its `HTMLImageElement`,
 *   - degrades gracefully when a sprite is missing (returns a placeholder
 *     image rather than throwing), so a single bad asset never crashes the
 *     renderer.
 *
 * The loader is DOM-dependent (it creates `HTMLImageElement`s), so it is not
 * unit-tested headlessly; the pure filename mapping lives in @game-logic/tile
 * and is covered there.
 */

import { TILE_BACK_FILE, spriteFileName, type Suit } from '../game-logic/tile';

/** Logical (CSS-px) size of a tile face. Backing store scales by devicePixelRatio. */
export const TILE_WIDTH = 40;
export const TILE_HEIGHT = 60;

/** Native (2x) sprite resolution. */
export const SPRITE_WIDTH = 80;
export const SPRITE_HEIGHT = 120;

/** Vite glob of every PNG under assets/tiles. */
const spriteModules = import.meta.glob('../assets/tiles/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

/** A placeholder image used when a requested sprite is missing. */
const MISSING_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** Options accepted by the {@link AssetLoader} constructor. */
export interface AssetLoaderOptions {
  /** When true, sprites are loaded lazily on first request instead of eagerly. */
  readonly lazy?: boolean;
}

/**
 * Loads and serves tile sprites.
 *
 * Usage:
 *   const loader = new AssetLoader();
 *   await loader.load();
 *   const img = loader.getFace('bamboo', 1);   // HTMLImageElement
 *   const back = loader.getBack();             // face-down back
 */
export class AssetLoader {
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly lazy: boolean;
  private loaded = false;

  constructor(options: AssetLoaderOptions = {}) {
    this.lazy = options.lazy ?? false;
  }

  /** True once all sprites have been loaded (or `load()` has been called). */
  get isLoaded(): boolean {
    return this.loaded;
  }

  /** The number of sprites successfully loaded. */
  get loadedCount(): number {
    return this.images.size;
  }

  /**
   * Load every sprite. Resolves once all images have either loaded or failed
   * (failures are recorded as missing, not thrown). Safe to call repeatedly.
   */
  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    const entries = Object.entries(spriteModules);
    await Promise.all(
      entries.map(([path, url]) => this.loadOne(path, url)),
    );
    this.loaded = true;
  }

  /**
   * Resolve a tile face to its sprite image.
   * @returns The loaded image, or a transparent placeholder when missing.
   */
  getFace(suit: Suit, rank: number): HTMLImageElement {
    return this.get(spriteFileName(suit, rank));
  }

  /** Resolve the face-down back sprite. */
  getBack(): HTMLImageElement {
    return this.get(TILE_BACK_FILE);
  }

  /**
   * Resolve a sprite by its file name (e.g. `tile_bamboo_1.png` or
   * `tile-back.png`). Returns a transparent placeholder when missing.
   */
  get(fileName: string): HTMLImageElement {
    if (this.lazy && !this.loaded) {
      const url = spriteModules[`../assets/tiles/${fileName}`];
      if (url !== undefined) {
        const img = new Image();
        img.src = url;
        this.images.set(fileName, img);
      }
    }
    return this.images.get(fileName) ?? this.placeholder();
  }

  /** True when the sprite for a tile face is present and loaded. */
  hasFace(suit: Suit, rank: number): boolean {
    return this.images.has(spriteFileName(suit, rank));
  }

  /** True when the face-down back sprite is present and loaded. */
  hasBack(): boolean {
    return this.images.has(TILE_BACK_FILE);
  }

  private loadOne(path: string, url: string): Promise<void> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.images.set(this.fileNameFromPath(path), img);
        resolve();
      };
      img.onerror = () => {
        // Missing/corrupt sprite: record nothing so `get` falls back to the
        // placeholder. Never reject — a single bad asset must not block the
        // rest of the load.
        resolve();
      };
      img.src = url;
    });
  }

  private fileNameFromPath(path: string): string {
    const parts = path.split('/');
    return parts[parts.length - 1] ?? '';
  }

  private placeholder(): HTMLImageElement {
    const img = new Image();
    img.src = MISSING_IMAGE;
    return img;
  }
}
