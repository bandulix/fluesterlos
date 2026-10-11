import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { pwaOptions } from "./pwa.options";
import { cacheHeadersPlugin } from "./cacheHeaders";
import { BUILD_ID, versionFilePlugin } from "./buildId";

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [react(), VitePWA(pwaOptions), cacheHeadersPlugin(), versionFilePlugin(BUILD_ID)],
  server: {
    port: 5173,
    proxy: {
      "/api": process.env.API_PROXY_TARGET ?? "http://localhost:3000",
    },
  },
});
