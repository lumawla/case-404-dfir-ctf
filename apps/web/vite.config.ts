import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: false } },
  },
  build: {
    outDir: "dist",
    // No source maps in the shipped bundle (brief §37: nothing extra in downloadable debug artifacts).
    sourcemap: false,
    chunkSizeWarningLimit: 700,
  },
});
