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
