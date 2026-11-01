import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts', '**/*.spec.ts'],
  },
  resolve: {
    alias: {
      '@voltex-viewer/plugin-api': path.resolve(__dirname, 'packages/plugin-api/src/index.ts'),
      '@voltex-viewer/mdf-reader': path.resolve(__dirname, 'packages/mdf-reader/src/index.ts'),
      '@voltex-viewer/signal-utils': path.resolve(__dirname, 'packages/signal-utils/src/index.ts'),
    }
  },
});
