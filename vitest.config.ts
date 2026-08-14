import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

/**
 * Vitest configuration for the Mahjong browser game.
 *
 * The unit/integration test suite lives under src and tests/game-logic. The
 * tests/visual directory holds Playwright end-to-end specs (.spec.ts) that
 * must NOT be collected by Vitest — they import @playwright/test and run
 * against a live dev server. Excluding them here keeps `npm test` (vitest)
 * and `npm run test:visual` (playwright) cleanly separated.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@game-logic': resolve(__dirname, 'src/game-logic'),
      '@rendering': resolve(__dirname, 'src/rendering'),
      '@ui': resolve(__dirname, 'src/ui'),
      '@styles': resolve(__dirname, 'src/styles'),
    },
  },
  test: {
    include: [
      'src/**/*.test.ts',
      'tests/game-logic/**/*.test.ts',
      'tests/persistence/**/*.test.ts',
    ],
    environment: 'node',
  },
});
