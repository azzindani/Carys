import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'packages/app',
  base: '/packages/app/dist/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // React and Radix change when package.json does, the app on every
        // commit. In their own chunk they keep one content hash across
        // deploys, and the image serves hashed files as immutable, so a
        // returning browser re-downloads only the app code. Boot fetches the
        // same bytes either way; what remains in the entry after the route
        // split is the viewer and the parsers it boots with.
        // Entry specifiers, not package names: the app imports react-dom
        // through `react-dom/client`, and naming bare `react-dom` catches an
        // empty shim while the renderer stays in the entry.
        manualChunks: {
          react: ['react', 'react/jsx-runtime', 'react-dom/client'],
          radix: ['radix-ui'],
        },
      },
    },
  },
});
