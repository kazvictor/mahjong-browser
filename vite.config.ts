import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@game-logic': resolve(__dirname, 'src/game-logic'),
      '@rendering': resolve(__dirname, 'src/rendering'),
      '@ui': resolve(__dirname, 'src/ui'),
      '@styles': resolve(__dirname, 'src/styles'),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Function-form manualChunks only creates a chunk for groups that
        // actually contain runtime code — avoids "empty chunk" warnings for
        // barrels that re-export only erased types.
        manualChunks(id: string): string | undefined {
          if (id.includes('/src/rendering/')) return 'rendering';
          if (id.includes('/src/game-logic/')) return 'game-logic';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    // Headless/server environments have no GUI browser to auto-open; leaving
    // `open` off keeps the dev-server log clean. Run `npm run dev -- --open`
    // on a workstation to auto-launch.
    open: false,
  },
});
