import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    sourcemap: true,
    minify: false, // Disable minification for better debugging
  },
  define: {
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
  },
});
