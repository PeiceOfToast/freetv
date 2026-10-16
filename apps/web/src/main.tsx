/// <reference types="vite-plugin-pwa/client" />
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./index.css";
import { applyTheme, getTheme } from "./lib/theme";
import { notifyUpdateAvailable } from "./lib/pwa";

applyTheme(getTheme());

// After a redeploy, an open tab can request a lazy chunk whose hash no longer exists. Reload once to
// pick up the new build. The sessionStorage stamp stops a genuinely broken deploy from reloading forever.
const PRELOAD_RELOAD_KEY = "freetv:preload-reload";
const PRELOAD_RELOAD_WINDOW_MS = 60_000;
window.addEventListener("vite:preloadError", () => {
  try {
    const last = Number(sessionStorage.getItem(PRELOAD_RELOAD_KEY) ?? "0");
    if (Date.now() - last < PRELOAD_RELOAD_WINDOW_MS) return;
    sessionStorage.setItem(PRELOAD_RELOAD_KEY, String(Date.now()));
  } catch {
    // No sessionStorage means no loop guard, so do not reload at all.
    return;
  }
  window.location.reload();
});

// autoUpdate: the new worker activates by itself. We only ask before reloading the page, since
// the open page still runs the previous build's chunks.
registerSW({ immediate: true, onNeedReload: notifyUpdateAvailable });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
