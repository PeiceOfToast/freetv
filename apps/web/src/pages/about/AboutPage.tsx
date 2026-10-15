import { useEffect, useState } from "react";
import { api, type Meta } from "@/lib/api";

const REPO = "https://github.com/iptv-org/iptv";

export default function AboutPage() {
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    document.title = "About — FreeTV";
    api.meta().then(setMeta).catch(() => setMeta(null));
  }, []);
  const when = (ts: number | null | undefined) => (ts ? new Date(ts * 1000).toLocaleString() : "never");
  return (
    <div className="mx-auto max-w-3xl space-y-8 py-6">
      <section className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">About FreeTV</h1>
        <p className="text-zinc-600 dark:text-zinc-300 leading-relaxed">
          FreeTV is a small, self-hostable website for watching the free, publicly listed TV channels that the{" "}
          <a className="underline" href={REPO}>iptv-org</a> community collects from around the world. It indexes their
          data, gives you a clean place to browse and search it, and plays streams straight in your browser.
        </p>
        <p className="text-zinc-600 dark:text-zinc-300 leading-relaxed">
          FreeTV does not host, record or re-encode any video. Stream links come from iptv-org and are refreshed on a
          schedule, so a channel that stops working there will stop working here too. Some streams are geo-blocked or
          only online part of the day.
        </p>
      </section>

      {meta && (
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            ["Channels", meta.channels.toLocaleString()],
            ["With streams", meta.channelsWithStreams.toLocaleString()],
            ["Guide entries", meta.programmes.toLocaleString()],
            ["Relay", meta.proxyEnabled ? "on" : "off"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
              <div className="text-xs uppercase tracking-wide opacity-60">{k}</div>
              <div className="text-xl font-semibold mt-1">{v}</div>
            </div>
          ))}
          <div className="col-span-2 sm:col-span-4 text-xs opacity-60">
            Catalog updated {when(meta.lastIngest)} · Guide updated {when(meta.lastEpgImport)} · v{meta.version}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Run your own</h2>
        <p className="text-zinc-600 dark:text-zinc-300 leading-relaxed">
          Everything here is open source under the MIT license. Clone the repository, run <code>docker compose up -d</code>,
          point a domain at it and you have your own copy, guide and all. The README covers hosting it for free on an
          Oracle Cloud VM.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Takedowns</h2>
        <p className="text-zinc-600 dark:text-zinc-300 leading-relaxed">
          If you own a channel listed here and want it removed, please open an issue at{" "}
          <a className="underline" href={`${REPO}/issues`}>iptv-org/iptv</a>. Removing it there removes it from every
          FreeTV instance on the next refresh.
        </p>
      </section>
    </div>
  );
}
