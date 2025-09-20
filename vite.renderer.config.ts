import { defineConfig } from 'vite';
import path from 'path';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    sourcemap: true,
    minify: false, // Disable minification for better debugging
  },
  resolve: {
    alias: {
      '@voltex-viewer/plugin-api': path.resolve(__dirname, 'packages/plugin-api/src/index.ts')
    }
  },
  define: {
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
  },
});
