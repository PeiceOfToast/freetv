import path from "node:path";
import { fileURLToPath } from "node:url";

/** e2e/ */
export const E2E_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** The monorepo root (the directory holding apps/ and docs/). */
export const REPO_ROOT = path.resolve(E2E_ROOT, "..");
export const API_DIR = path.join(REPO_ROOT, "apps/api");
export const PROXY_DIR = path.join(REPO_ROOT, "apps/proxy");
export const WEB_DIR = path.join(REPO_ROOT, "apps/web");
export const WEB_PORT = 4173;
export const API_PORT = 3000;
export const PROXY_PORT = 3001;
export const PROXY_SECRET = "e2e-secret";
export const STATE_ENV = "FREETV_E2E_STATE";
export const LOG_DIR = path.join(E2E_ROOT, "test-results", "server-logs");
