# Mahjong — Browser Game

A browser-based Mahjong game built with TypeScript and Vite. Tiles are rendered
on a Canvas 2D surface; animations use a hybrid of CSS transitions (simple
moves) and `requestAnimationFrame` (complex sequences); game state is plain
vanilla TypeScript with no external state library.

## Tech Stack

| Concern        | Choice                                             |
| -------------- | -------------------------------------------------- |
| Language       | TypeScript 5.5+                                     |
| Build tool     | Vite 5.4+                                           |
| Rendering      | Canvas 2D (not WebGL — overkill for 144 tiles)      |
| Animation      | CSS transitions + `requestAnimationFrame`           |
| State          | Vanilla TypeScript (no library)                     |
| Testing        | Vitest (unit) + Playwright (visual regression)      |
| Linting        | ESLint + Prettier                                   |

See the Tech Stack Decision document for the rationale behind each choice.

## Project Structure

```
mahjong-browser/
├── assets/
│   └── tiles/          # 2x tile PNGs (144 tiles + back), not yet committed
├── public/             # Static public assets served at / by Vite
├── src/
│   ├── game-logic/     # Pure TypeScript — no DOM, no canvas (headless, unit-testable)
│   │   ├── types.ts    # Tile, Hand, Meld, GameState
│   │   ├── index.ts    # Barrel for '@game-logic' imports
│   ├── rendering/      # Canvas 2D tile rendering
│   │   ├── table-renderer.ts
│   │   └── index.ts    # Barrel for '@rendering' imports
│   ├── ui/             # DOM-based overlays (score, menu, tutorial)
│   │   └── index.ts    # Barrel for '@ui' imports
│   ├── styles/         # CSS transitions for simple animations
│   │   └── main.css
│   └── main.ts         # Game loop (requestAnimationFrame)
├── tests/
│   └── visual/         # Playwright visual regression tests (populated later)
├── index.html
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## Getting Started

### Prerequisites

- Node.js 20+ (tested with 22)
- npm 10+

### Install

```bash
npm install
```

### Run the dev server

```bash
npm run dev
```

Serves the app at <http://localhost:5173>.

### Build for production

```bash
npm run build
```

Type-checks with `tsc --noEmit`, then emits the production bundle into `dist/`.

### Lint and format

```bash
npm run lint        # ESLint over src/
npm run lint:fix    # auto-fix lint issues
npm run format      # Prettier write
npm run format:check
```

### Tests

```bash
npm test                    # Vitest unit tests (headless game logic)
npm run test:visual         # Playwright visual regression tests
```

## Path Aliases

The project defines import aliases so deep folder paths stay readable:

- `@game-logic` → `src/game-logic`
- `@rendering` → `src/rendering`
- `@ui` → `src/ui`
- `@styles` → `src/styles`

These are configured in both `vite.config.ts` (for the bundler) and
`tsconfig.json` (for the language server and type-checking).

## License

MIT
