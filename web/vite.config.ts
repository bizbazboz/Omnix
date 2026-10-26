import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: { assetsInlineLimit: 0 },
  server: {
    allowedHosts: ["web", "localhost"],
    proxy: { "/api": "http://api:8000" }
  }
});
