import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { pwaOptions } from "./pwa.options";
import { cacheHeadersPlugin } from "./cacheHeaders";

export default defineConfig({
  plugins: [react(), VitePWA(pwaOptions), cacheHeadersPlugin()],
  server: {
    port: 5173,
    proxy: {
      "/api": process.env.API_PROXY_TARGET ?? "http://localhost:3000",
    },
  },
});
