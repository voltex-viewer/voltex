import { defineConfig } from 'vite';
import path from 'path';
import { execSync } from 'child_process';

function getGitCommitHash(): string {
  try {
    return execSync('git rev-parse HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
}

// https://vitejs.dev/config
export default defineConfig({
  root: '.', // Use project root instead of src/app
  base: './', // Use relative paths for GitHub Pages compatibility
  publicDir: 'assets',
  build: {
    outDir: 'dist-web',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html')
      }
    }
  },
  define: {
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
    // Define environment as browser for web builds
    __IS_WEB_BUILD__: true,
    __GIT_COMMIT_HASH__: JSON.stringify(getGitCommitHash()),
  },
  server: {
    port: 3000,
    open: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },
  resolve: {
    alias: {
      '@voltex-viewer/plugin-api': path.resolve(__dirname, 'packages/plugin-api/src/index.ts')
    }
  }
});
