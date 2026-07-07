import { defineConfig } from 'vite';

export default defineConfig({
  base: '/ChessClub/', 
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
  }
});