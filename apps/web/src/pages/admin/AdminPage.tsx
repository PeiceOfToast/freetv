import { useCallback, useEffect, useState } from "react";
import { adminApi, AdminApiError, clearToken, loadToken, saveToken, type AdminStatus } from "@/lib/admin-api";
import { ActionButton, Big, Panel, Row, StackedBar } from "./Panels";
import TokenGate from "./TokenGate";
import { ago, fmtBytes, fmtSeconds, fmtUptime, num } from "./format";

const REFRESH_MS = 15_000;
// Where the "Docs" link goes. The repo has no public FreeTV docs URL, so it points at the in-app About page.
const DOCS_HREF = "/about";

interface Toast {
  id: number;
  text: string;
}

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(() => loadToken());
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    document.title = "Admin — FreeTV";
  }, []);

  const signOut = useCallback((reason: string | null) => {
    clearToken();
    setToken(null);
    setStatus(null);
    setError(null);
    setNotice(reason);
  }, []);

  const refresh = useCallback(
    async (t: string) => {
      try {
        setStatus(await adminApi.status(t));
        setError(null);
      } catch (e) {
        if (e instanceof AdminApiError && e.status === 401) signOut("That token was rejected. Check ADMIN_TOKEN and try again.");
        else setError(e instanceof Error ? e.message : "Could not load status.");
      }
    },
    [signOut],
  );

  useEffect(() => {
    if (!token) return;
    void refresh(token);
    const id = window.setInterval(() => {
      if (!document.hidden) void refresh(token);
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [token, refresh]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast((t) => (t?.id === toast.id ? null : t)), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const signIn = (t: string) => {
    saveToken(t);
    setNotice(null);
    setStatus(null);
    setToken(t);
  };

  const act = async (key: string, label: string, fn: (t: string) => Promise<unknown>) => {
    if (!token || busy) return;
    setBusy(key);
    try {
      await fn(token);
      setToast({ id: Date.now(), text: `${label} started.` });
      window.setTimeout(() => void refresh(token), 1500);
    } catch (e) {
      if (e instanceof AdminApiError && e.status === 401) signOut("That token was rejected. Check ADMIN_TOKEN and try again.");
      else setToast({ id: Date.now(), text: `${label} failed: ${e instanceof Error ? e.message : "unknown error"}` });
    } finally {
      setBusy(null);
    }
  };

  if (!token) return <TokenGate onSubmit={signIn} notice={notice} />;

  const s = status;
  const nowMs = s ? s.now * 1000 : Date.now();
  const streams = s?.catalog.streams ?? 0;
  const online = s?.health.online ?? 0;
  const offline = s?.health.offline ?? 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-[clamp(1.5rem,1.25rem+1vw,2rem)] font-semibold tracking-tight">Admin</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {s ? `v${s.version} · up ${fmtUptime(s.uptime)} · refreshed ${new Date().toLocaleTimeString()}` : "Loading…"}
          </p>
        </div>
        <ActionButton onClick={() => signOut(null)}>Sign out</ActionButton>
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Could not refresh: {error}
        </p>
      )}

      {!s && !error && (
        <p role="status" className="text-sm text-zinc-500">
          Loading status…
        </p>
      )}

      {s && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Panel
            title="Catalog"
            action={
              <ActionButton busy={busy === "ingest"} disabled={!!busy} onClick={() => act("ingest", "Re-ingest", adminApi.ingest)}>
                Re-ingest
              </ActionButton>
            }
          >
            <Big value={num(s.catalog.channels)} label="channels" />
            <dl className="space-y-2 pt-2">
              <Row label="With streams" value={num(s.catalog.withStreams)} />
              <Row label="Streams" value={num(s.catalog.streams)} />
              <Row label="Last ingest" value={ago(s.catalog.lastIngest, nowMs)} />
              <Row label="Source" value={s.catalog.source ?? "unknown"} />
            </dl>
          </Panel>

          <Panel
            title="Guide"
            action={
              <ActionButton busy={busy === "epg"} disabled={!!busy} onClick={() => act("epg", "Re-import", adminApi.epgImport)}>
                Re-import
              </ActionButton>
            }
          >
            <Big value={num(s.epg.programmes)} label="programmes" />
            <dl className="space-y-2 pt-2">
              <Row label="Last import" value={ago(s.epg.lastImport, nowMs)} />
              <Row label="File" value={s.epg.file.exists ? fmtBytes(s.epg.file.size) : "no file yet"} />
              <Row label="File updated" value={s.epg.file.exists ? ago(s.epg.file.mtime, nowMs) : "n/a"} />
            </dl>
          </Panel>

          <Panel
            title="Stream health"
            action={
              <ActionButton
                busy={busy === "probe" || s.health.running}
                disabled={!!busy || s.health.running}
                onClick={() => act("probe", "Probe", adminApi.probe)}
              >
                {s.health.running ? "Probing…" : "Probe now"}
              </ActionButton>
            }
          >
            <div className="flex items-baseline justify-between gap-3">
              <Big value={num(s.health.probed)} label={`of ${num(streams)} streams probed`} />
              {s.health.running && (
                <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400" role="status">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
                  Running
                </span>
              )}
            </div>
            <StackedBar
              total={streams}
              label={`${num(online)} online, ${num(offline)} offline, ${num(Math.max(0, streams - s.health.probed))} not yet probed`}
              segments={[
                { name: `Online ${num(online)}`, value: online, className: "bg-emerald-500" },
                { name: `Offline ${num(offline)}`, value: offline, className: "bg-zinc-500 dark:bg-zinc-400" },
              ]}
            />
            <dl className="space-y-2 pt-2">
              <Row label="Last probe" value={ago(s.health.lastProbe, nowMs)} />
              <Row label="Last probe took" value={s.health.lastProbeMs === null ? "n/a" : fmtSeconds(s.health.lastProbeMs)} />
            </dl>
          </Panel>

          <Panel title="Logos">
            <Big value={num(s.logos.cached)} label="cached logos" />
            <dl className="space-y-2 pt-2">
              <Row label="Size on disk" value={fmtBytes(s.logos.bytes)} />
            </dl>
          </Panel>

          <Panel title="Relay">
            <Big value={s.proxy.enabled ? "On" : "Off"} label="stream relay" />
            <p className="pt-2 text-xs text-zinc-500 dark:text-zinc-400">
              {s.proxy.enabled ? "Relay-only streams are routed through the proxy." : "PROXY_ENABLED is off or PROXY_SECRET is unset."}
            </p>
          </Panel>

          <Panel title="Storage">
            <Big value={fmtBytes(s.db.bytes)} label="catalog database" />
            <dl className="space-y-2 pt-2">
              <Row label="WAL" value={fmtBytes(s.db.walBytes)} />
            </dl>
          </Panel>
        </div>
      )}

      <nav aria-label="Useful links" className="flex flex-wrap gap-2 text-sm">
        {[
          ["/metrics", "Metrics"],
          ["/api/meta", "Meta JSON"],
          ["/api/playlist.m3u", "Playlist"],
          [DOCS_HREF, "Docs"],
        ].map(([href, label]) => (
          <a
            key={href}
            href={href}
            className="inline-flex min-h-11 items-center rounded-lg border border-zinc-200 px-3 font-medium hover:bg-zinc-200/60 sm:min-h-0 sm:py-1.5 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
          >
            {label}
          </a>
        ))}
      </nav>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-sm rounded-lg bg-zinc-900 px-4 py-3 text-sm text-white shadow-lg sm:inset-x-auto sm:right-4 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
