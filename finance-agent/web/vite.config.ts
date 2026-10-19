import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:3000' },
  },
  // `vite build --mode artifact` : un seul fichier JS et CSS, sans backend (voir scripts/build-artifact.mjs)
  ...(mode === 'artifact' && {
    define: { 'import.meta.env.VITE_STANDALONE': JSON.stringify('1') },
    build: {
      outDir: 'dist-artifact',
      assetsInlineLimit: 100_000_000,
      cssCodeSplit: false,
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  }),
}));
