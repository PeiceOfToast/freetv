// Separate client for the admin endpoints (docs/API.md "Admin"). Does not touch lib/api.ts.
// The token lives in sessionStorage only: it goes away with the tab and never reaches localStorage.

const BASE = import.meta.env.VITE_API_BASE ?? "";
const TOKEN_KEY = "freetv:admin-token";

export interface AdminStatus {
  version: string;
  uptime: number;
  now: number;
  catalog: {
    channels: number;
    withStreams: number;
    streams: number;
    lastIngest: number | null;
    lastIngestMs: number | null;
    source: "primary" | "mirror" | null;
  };
  epg: {
    programmes: number;
    lastImport: number | null;
    file: { exists: boolean; size: number; mtime: number | null };
  };
  health: {
    probed: number;
    online: number;
    offline: number;
    lastProbe: number | null;
    lastProbeMs: number | null;
    running: boolean;
  };
  logos: { cached: number; bytes: number };
  proxy: { enabled: boolean };
  db: { bytes: number; walBytes: number };
}

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function loadToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Private window or blocked storage: the token is kept in memory for this page only.
  }
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to clear.
  }
}

async function request<T>(method: "GET" | "POST", path: string, token: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      cache: "no-store",
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
    });
  } catch {
    throw new AdminApiError(0, "Cannot reach the server.");
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
    throw new AdminApiError(res.status, msg);
  }
  return body as T;
}

export const adminApi = {
  status: (token: string) => request<AdminStatus>("GET", "/api/admin/status", token),
  ingest: (token: string) => request<{ started: boolean }>("POST", "/api/admin/ingest", token),
  probe: (token: string) => request<{ started: boolean }>("POST", "/api/admin/probe", token),
  epgImport: (token: string) => request<{ started: boolean }>("POST", "/api/admin/epg/import", token),
};
