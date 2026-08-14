/**
 * GameScene — orchestrates the Mahjong table: game engine, rendering, input,
 * and AI opponents wired together into a single playable frame loop.
 *
 * Responsibilities:
 *   - Own the {@link MahjongGame} state machine and drive it to a playable
 *     state (deal a starting hand).
 *   - Every animation frame: compute the {@link TableLayout} from the game
 *     snapshot + interaction state, sort tiles by z-order, and paint them via
 *     {@link TileRenderer}.
 *   - Bind the {@link InputHandler} so the human player (seat 0, bottom) can
 *     select a tile (highlight) and discard it; route discard actions into the
 *     correct game command depending on phase (opening vs. normal turn).
 *   - Wire AI opponents (seats 1..3) to a {@link TurnController} adapter so
 *     they draw and discard on their own turns.
 *
 * The scene is deliberately the only module that couples @game-logic and
 * @rendering; everything beneath it stays headless and unit-testable.
 */
import { AssetLoader } from './asset-loader';
import { TileRenderer } from './tile-renderer';
import { TableRenderer } from './table-renderer';
import { TableLayout, sortTilesForDraw, type LayoutFrame } from './table-layout';
import { InputHandler } from '../input/input-handler';
import type { TileRect } from '../input/tile-picker';
import { AIPlayer } from '../game-logic/ai/ai-player';
import { EfficiencyDiscardStrategy } from '../game-logic/ai/tile-efficiency';
import type { EfficiencyContext } from '../game-logic/ai/tile-efficiency';
import { MahjongGame, PLAYER_COUNT } from '../game-logic/mahjong-game';
import { GameState } from '../game-logic/game-state';
import type { MeldType, Tile } from '../game-logic/types';
import { MeldDisplay } from '../ui/components/meld-display';
import { MeldDeclarationPrompt } from '../ui/components/meld-declaration';
import type { MeldDeclareOption } from '../ui/components/meld-declaration';

/** Options accepted by the {@link GameScene} constructor. */
export interface GameSceneOptions {
  /** Seed for a deterministic, replayable deal. Defaults to a random seed. */
  readonly seed?: number;
  /** When true, AI opponents are connected and play automatically. */
  readonly enableAI?: boolean;
}

/**
 * Drives a MahjongGame through the narrow slice the AIPlayer needs. This is
 * the adapter between the AI's {@link TurnController} contract and the engine.
 */
class GameTurnController {
  private readonly game: MahjongGame;
  /** The most recent tile drawn per player (fed to AI efficiency context). */
  private readonly lastDrawnTiles = new Map<number, Tile>();

  constructor(game: MahjongGame) {
    this.game = game;
  }

  canAct(playerId: number): boolean {
    const state = this.game.getState();
    return state.phase === GameState.DRAW && state.currentPlayer === playerId;
  }

  draw(playerId: number): Tile | null {
    const state = this.game.getState();
    if (state.phase !== GameState.DRAW || state.currentPlayer !== playerId) {
      return null;
    }
    const before = state.players[playerId]?.hand.tiles.length ?? 0;
    this.game.drawTile();
    const after = this.game.getState().players[playerId]?.hand.tiles.length ?? 0;
    const drawn = this.game.getState().players[playerId]?.hand.tiles[after - 1];
    // drawTile() should add exactly one tile; otherwise treat as failure.
    if (after === before + 1 && drawn) {
      this.lastDrawnTiles.set(playerId, drawn);
      return drawn;
    }
    return null;
  }

  /**
   * MVP: bonus-tile exposure is not wired into the engine, so this returns
   * null to terminate the AI's exposure loop without mutating anything.
   */
  exposeBonus(): Tile | null {
    return null;
  }

  discard(playerId: number, tile: Tile): boolean {
    const state = this.game.getState();
    if (state.phase !== GameState.DISCARD || state.currentPlayer !== playerId) {
      return false;
    }
    try {
      this.game.discardTile(tile.id);
      return true;
    } catch {
      return false;
    }
  }

  onTurnStart(listener: (playerId: number) => void): () => void {
    return this.game.on('TURN_STARTED', (e) => listener(e.playerId));
  }

  handSnapshot(playerId: number): readonly Tile[] {
    return this.game.getState().players[playerId]?.hand.tiles ?? [];
  }

  /**
   * Build the rich {@link EfficiencyContext} for an AI's discard decision.
   * We track the round stage from the number of tiles drawn (the wall starts
   * at 144 and every draw/claim shrinks it), the tiles already visible in the
   * discard pile, and — since the MVP engine does not yet model riichi
   * declarations — opponentRiichi is always false. The context is a pure
   * snapshot, so this is safe to call repeatedly.
   */
  aiContextSnapshot(playerId: number): EfficiencyContext {
    const state = this.game.getState();
    const tilesDrawn = 144 - state.wall.length;
    return {
      seenTiles: state.discardPile,
      opponentRiichi: false,
      tilesDrawn,
      drawnTile: this.lastDrawnFor(playerId),
    };
  }

  /** The tile most recently drawn by `playerId`, if any. */
  private lastDrawnFor(playerId: number): Tile | undefined {
    return this.lastDrawnTiles.get(playerId);
  }
}

/**
 * The composable scene root. Construct, call {@link start} (async — awaits
 * sprite load), and the scene owns the frame loop until {@link dispose}.
 */
export class GameScene {
  private readonly game: MahjongGame;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: TableRenderer;
  private readonly loader: AssetLoader;
  private readonly tileRenderer: TileRenderer;
  private readonly layout: TableLayout;
  private readonly input: InputHandler;
  private readonly controller: GameTurnController;
  private readonly ais: AIPlayer[] = [];
  private readonly seed: number;
  private readonly enableAI: boolean;
  private readonly meldDisplay: MeldDisplay;
  private readonly meldPrompt: MeldDeclarationPrompt;

  /** The most recently computed layout (for hit-test rects + draw). */
  private frame: LayoutFrame | null = null;

  private rafId = 0;
  private running = false;
  private disposers: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement, options: GameSceneOptions = {}) {
    this.canvas = canvas;
    this.seed = options.seed ?? Math.floor(Math.random() * 0xffffffff);
    this.enableAI = options.enableAI ?? true;
    this.game = new MahjongGame();
    this.renderer = new TableRenderer(canvas);
    this.loader = new AssetLoader();
    this.tileRenderer = new TileRenderer(this.loader);
    this.layout = new TableLayout();
    this.controller = new GameTurnController(this.game);
    this.meldDisplay = new MeldDisplay();
    this.meldPrompt = new MeldDeclarationPrompt();

    this.input = new InputHandler(
      canvas,
      {
        onAction: (action, tileId) => {
          if (action === 'discard' && tileId !== null) {
            this.onHumanDiscard(tileId);
          }
        },
        onRequestRects: () => this.handRects(),
      },
      { enabled: true, bindTouch: true },
    );
  }

  /** The underlying game engine (QA / test hook). */
  getGame(): MahjongGame {
    return this.game;
  }

  /**
   * Load sprites, deal a starting hand, bind input, connect AI, and start the
   * frame loop. Safe to call once.
   */
  async start(): Promise<void> {
    if (this.running) return;

    await this.loader.load();
    this.renderer.resize();

    // Deal a starting hand: build the wall + deal 13 to everyone, then give
    // the dealer (human, seat 0) their 14th tile so the opening move is ready.
    this.game.startGame(this.seed);
    this.game.dealComplete();

    this.input.attach();

    if (this.enableAI) {
      this.connectAIs();
    }

    // Auto-draw for the human when their turn starts with a 13-tile hand
    // (i.e. any turn after the opening). The opening turn already has 14.
    this.disposers.push(
      this.game.on('TURN_STARTED', (e) => {
        if (e.playerId === 0) this.onHumanTurnStart();
      }),
    );

    // After any discard, offer meld claims (chow/pung/kong) to other players
    // before advancing the turn. The human gets a prompt; AI opponents claim
    // automatically. If nobody claims, the turn advances normally.
    this.disposers.push(
      this.game.on('TILE_DISCARDED', () => this.onDiscardForClaims()),
    );

    window.addEventListener('resize', this.onResize);
    this.disposers.push(() => window.removeEventListener('resize', this.onResize));

    this.running = true;
    this.rafId = requestAnimationFrame(this.tick);
  }

  /** Tear down all listeners, AI connections, and the frame loop. */
  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.input.dispose();
    this.meldPrompt.dispose();
    for (const d of this.disposers) d();
    this.disposers = [];
  }

  // ---- Frame loop ----------------------------------------------------------

  private readonly tick = (now: number): void => {
    void now;
    this.render();
    if (this.running) {
      this.rafId = requestAnimationFrame(this.tick);
    }
  };

  /** Recompute layout + picker rects and paint one frame. */
  render(): void {
    const ctx = this.renderer.getContext();
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.renderer.clear();

    const layout = this.computeLayout(w, h);
    this.frame = layout;

    for (const tile of sortTilesForDraw(layout.handTiles)) {
      this.tileRenderer.draw(ctx, tile.suit, tile.rank, tile.x, tile.y, {
        faceDown: tile.faceDown,
        selected: tile.selected,
        hovered: tile.hovered,
        valid: tile.valid,
      });
    }

    // Paint exposed melds face-up on top of the concealed-hand/wall layer.
    const state = this.game.getState();
    const meldFrame = this.meldDisplay.compute(w, h, state.players);
    for (const tile of meldFrame.tiles) {
      this.tileRenderer.draw(ctx, tile.suit, tile.rank, tile.x, tile.y, {
        faceDown: false,
      });
    }
  }

  /** Build the layout from the current game snapshot + picker state. */
  private computeLayout(w: number, h: number): LayoutFrame {
    const state = this.game.getState();
    const picker = this.input.getPicker();
    const human = state.players[0];
    const isHumanTurn =
      (state.phase === GameState.DRAW || state.phase === GameState.DISCARD) &&
      state.currentPlayer === 0;

    // During the human's turn every hand tile is a legal discard (MVP).
    const validIds = new Set<string>();
    if (isHumanTurn && human) {
      for (const t of human.hand.tiles) validIds.add(t.id);
    }

    const layout = this.layout.compute(w, h, state.players, state.wall, state.discardPile, {
      selectedId: picker.getSelectedTileId(),
      hoveredId: picker.getHoveredTileId(),
      validMoveIds: validIds,
    });

    // Keep the TilePicker in sync with the current hand geometry.
    this.input.getPicker().setTileRects(layout.handRects);
    return layout;
  }

  /** The current hand hit-test rects (fed to the picker on pointer events). */
  private handRects(): TileRect[] {
    const f = this.frame;
    if (!f) return [];
    return f.handRects.map((r) => ({
      tileId: r.tileId,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      z: r.z,
    }));
  }

  // ---- Game action routing -------------------------------------------------

  private readonly onResize = (): void => {
    this.renderer.resize();
    this.render();
  };

  /**
   * The human's turn began. If it is not the opening turn (hand already has
   * 14 tiles), draw a tile so they have a discardable 14th tile.
   */
  private onHumanTurnStart(): void {
    const state = this.game.getState();
    const hand = state.players[0]?.hand.tiles ?? [];
    if (state.phase === GameState.DRAW && hand.length === 13) {
      this.game.drawTile(); // DRAW -> DISCARD, hand now has 14 tiles
    }
  }

  /**
   * The human committed a discard via the picker. Choose the correct engine
   * command by phase: opening turn (DRAW with 14 tiles) vs. normal turn
   * (DISCARD). Advances the turn afterward via the TILE_DISCARDED listener.
   */
  private onHumanDiscard(tileId: string): void {
    const state = this.game.getState();
    try {
      if (state.phase === GameState.DRAW) {
        this.game.discardOpening(tileId);
      } else if (state.phase === GameState.DISCARD) {
        this.game.discardTile(tileId);
      } else {
        return; // not the human's turn — ignore stray discards
      }
    } catch {
      // Invalid discard (e.g. tile not in hand); ignore and keep selection.
      return;
    }
  }

  /** Advance to the next player's turn after a discard. */
  private advanceTurn(): void {
    const state = this.game.getState();
    if (state.phase === GameState.DISCARD) {
      try {
        this.game.nextTurn(); // DISCARD -> DRAW for the next player
      } catch {
        // Ignore: e.g. a claim path we don't model at MVP.
      }
    }
  }

  /**
   * After a discard, offer meld claims to the other players before advancing
   * the turn. The human (seat 0) gets a prompt when they can claim; AI
   * opponents claim automatically. If nobody claims, the turn advances.
   */
  private onDiscardForClaims(): void {
    const state = this.game.getState();
    if (state.phase !== GameState.DISCARD) return;

    // AI opponents claim first (they act instantly). The human is prompted.
    for (let id = 1; id < PLAYER_COUNT; id++) {
      const opps = this.game.getMeldOpportunities(id);
      if (opps.length > 0) {
        // Prefer the strongest claim (kong > pung > chow).
        const best = opps.find((o) => o.type === 'kong')
          ?? opps.find((o) => o.type === 'pung')
          ?? opps[0]!;
        try {
          this.game.acceptMeldOpportunity(id, best.type);
        } catch {
          // Claim rejected (e.g. state changed); fall through to next player.
        }
        return; // a claim transferred the turn; stop offering
      }
    }

    // No AI claimed; prompt the human if they can claim.
    if (this.game.hasMeldOpportunity(0)) {
      this.showMeldPrompt();
    } else {
      this.advanceTurn();
    }
  }

  /** Show the meld-declaration prompt for the human player. */
  private showMeldPrompt(): void {
    const opps = this.game.getMeldOpportunities(0);
    if (opps.length === 0) return;

    const options: MeldDeclareOption[] = opps.map((o) => ({
      kind: o.type as 'chow' | 'pung' | 'kong',
      label: o.type.charAt(0).toUpperCase() + o.type.slice(1),
      detail: o.tiles[0] ? `${o.tiles[0].suit} ${o.tiles[0].rank}` : undefined,
    }));
    options.push({ kind: 'pass', label: 'Pass' });

    this.meldPrompt.onChoose = (kind) => {
      if (kind === 'pass') {
        this.advanceTurn();
        return;
      }
      try {
        this.game.acceptMeldOpportunity(0, kind as MeldType);
      } catch {
        // Claim rejected; advance the turn.
        this.advanceTurn();
      }
    };
    this.meldPrompt.onTimeout = () => this.advanceTurn();
    this.meldPrompt.show(options);
  }

  // ---- AI wiring -----------------------------------------------------------

  private connectAIs(): void {
    for (let id = 1; id < PLAYER_COUNT; id++) {
      const ai = new AIPlayer(id, id, new EfficiencyDiscardStrategy(), {
        // Slightly snappier thinking for a snappy browser demo.
        thinkTimeMs: () => 600 + Math.random() * 900,
      });
      this.ais.push(ai);
      this.disposers.push(ai.connect(this.controller));
    }
  }
}
