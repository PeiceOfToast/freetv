import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

// Workbox routing predicates. Serialised into dist/sw.js, so they must not close over anything
// from this file; `self` and `location` refer to the service worker's own globals.
type RouteCtx = { url: URL; request: Request };
const isProxy = ({ url }: RouteCtx) => url.pathname.startsWith("/proxy/");
const isMedia = ({ url }: RouteCtx) => /\.(m3u8|ts|m4s|mp4)$/i.test(url.pathname);
const isApiNoCache = ({ url }: RouteCtx) =>
  url.pathname === "/api/playlist.m3u" || url.pathname === "/api/guide.xml" || url.pathname.startsWith("/api/admin");
const isApi = ({ url }: RouteCtx) => url.pathname.startsWith("/api/");
const isCrossOriginImage = ({ url, request }: RouteCtx) =>
  request.destination === "image" && url.origin !== self.location.origin;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: {
        name: "FreeTV",
        short_name: "FreeTV",
        description: "Watch thousands of free, publicly available TV channels from around the world.",
        lang: "en",
        display: "standalone",
        orientation: "any",
        theme_color: "#09090b",
        background_color: "#09090b",
        start_url: "/",
        scope: "/",
        categories: ["entertainment"],
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        // hls.js is a lazy chunk used only on pages with a player; keep it out of the install-time cache.
        globIgnores: ["**/hls-*.js"],
        cleanupOutdatedCaches: true,
        // Deep links get the app shell; API and relay paths must never be answered with index.html.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/proxy\//],
        // First match wins. Relay and media are never cached; live playlists and the EPG/M3U
        // exports and admin must always be fresh; other API reads fall back to cache when offline.
        runtimeCaching: [
          { urlPattern: isProxy, handler: "NetworkOnly" },
          { urlPattern: isMedia, handler: "NetworkOnly" },
          { urlPattern: isApiNoCache, handler: "NetworkOnly" },
          {
            urlPattern: isApi,
            handler: "NetworkFirst",
            options: {
              cacheName: "api",
              networkTimeoutSeconds: 10,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: isCrossOriginImage,
            handler: "CacheFirst",
            options: {
              cacheName: "channel-logos",
              expiration: { maxEntries: 500, maxAgeSeconds: 7 * 24 * 60 * 60, purgeOnQuotaError: true },
              // Logos are <img> loads without CORS, so cross-origin responses are opaque (status 0).
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/proxy": "http://localhost:3001",
    },
  },
  build: { sourcemap: false, chunkSizeWarningLimit: 1200 },
});
