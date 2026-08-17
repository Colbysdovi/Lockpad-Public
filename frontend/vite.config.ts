import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Static SPA build. Dev proxies /api to the backend so there are no cross-origin
// calls; in production the backend (or tailscale serve) fronts both.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    // Honor a harness-assigned PORT (preview autoPort); default 5173 for manual runs.
    port: Number(process.env.PORT) || 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_TARGET ?? "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    // Self-host everything; never emit references to external CDNs.
    assetsInlineLimit: 0,
  },
});
