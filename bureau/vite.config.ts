import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    // trois pages : Max (index.html), le compagnon (compagnon.html) et l'atelier de Max (atelier.html)
    rollupOptions: { input: { index: "web/index.html", compagnon: "web/compagnon.html", atelier: "web/atelier.html" } },
  },
});
