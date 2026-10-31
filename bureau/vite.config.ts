import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    // deux pages : Max (index.html) et le compagnon (compagnon.html)
    rollupOptions: { input: { index: "web/index.html", compagnon: "web/compagnon.html" } },
  },
});
