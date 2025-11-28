import { defineConfig } from 'vite';
import eslint from 'vite-plugin-eslint2';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [eslint({ emitErrorAsWarning: false })],
  build: {
    sourcemap: true,
    minify: false, // Disable minification for better debugging
  },
  define: {
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
  },
});
