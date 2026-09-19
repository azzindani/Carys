import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'packages/app',
  base: '/packages/app/dist/',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
});
