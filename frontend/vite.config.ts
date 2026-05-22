import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Build output lands directly inside the AA app's static dir so
 * `python manage.py collectstatic` picks it up.
 *
 * In dev, /sovtool/api is proxied to the AA Django dev server.
 */
export default defineConfig({
  plugins: [react()],
  base: "/static/aasovtool/",
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/sovtool/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/account": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "../aasovtool/static/aasovtool",
    emptyOutDir: true,
    assetsDir: "assets",
    manifest: true,
  },
});
