import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: '/ChessClub/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    // Multi-page: the 3D landing page stays free of the Supabase/app code.
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        login: resolve(import.meta.dirname, 'login.html'),
        player: resolve(import.meta.dirname, 'player.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
      },
    },
  },
});
