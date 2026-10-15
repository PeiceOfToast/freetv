import { useState, type ReactNode } from "react";
import type { ChannelSummary } from "@/lib/api";
import { fmtTime, nowTs, progress } from "@/lib/format";

export function qualityBadge(q: string | null): { label: string; cls: string } | null {
  if (!q) return null;
  if (q === "2160p") return { label: "4K", cls: "tv-badge tv-badge-uhd" };
  if (q === "1080p" || q === "720p") return { label: "HD", cls: "tv-badge tv-badge-hd" };
  return { label: "SD", cls: "tv-badge" };
}

/** Logo tile. Falls back to the channel's initials when the logo is missing or fails. */
export function ChannelLogo({ src, name }: { src: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    const initials = name.split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 3).toUpperCase();
    return <span aria-hidden="true">{initials || "TV"}</span>;
  }
  return <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />;
}

export function ChannelTile({ ch, onOpen, nowLine = true }: { ch: ChannelSummary; onOpen: () => void; nowLine?: boolean }) {
  const badge = qualityBadge(ch.bestQuality);
  const now = ch.now?.title ?? "";
  const pct = ch.now ? Math.round(progress(ch.now.start, ch.now.stop, nowTs()) * 100) : null;
  return (
    <button
      type="button"
      data-nav
      tabIndex={0}
      className="tv-tile"
      aria-label={`${ch.name}${now ? `, now ${now}` : ""}`}
      onClick={onOpen}
    >
      <div className="tv-tile-logo"><ChannelLogo src={ch.logo} name={ch.name} /></div>
      <div className="tv-tile-name">{ch.name}</div>
      <div className="tv-tile-meta">
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{ch.flag ? `${ch.flag} ` : ""}{ch.countryName ?? ""}</span>
        {badge && <span className={badge.cls}>{badge.label}</span>}
      </div>
      {nowLine && (
        <>
          <div className="tv-tile-now">{now ? now : <span style={{ color: "#71717a" }}>{ch.hasGuide ? "No programme info" : "Live"}</span>}</div>
          <div className="tv-tile-bar" aria-hidden="true" style={pct === null ? { visibility: "hidden" } : undefined}><div style={{ width: `${pct ?? 0}%` }} /></div>
        </>
      )}
    </button>
  );
}

/** A dashed call-to-action tile (e.g. "Browse channels") that sits inside a row. */
export function CtaTile({ label, onOpen, icon }: { label: string; onOpen: () => void; icon?: ReactNode }) {
  return (
    <button type="button" data-nav tabIndex={0} className="tv-tile tv-tile-cta" onClick={onOpen}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function TvRow({ title, children, id, count }: { title: string; children: ReactNode; id?: string; count?: number | null }) {
  return (
    <section className="tv-row" aria-labelledby={id}>
      <div className="tv-row-head">
        <h2 className="tv-h2" id={id}>{title}</h2>
        {typeof count === "number" && count > 0 && <span className="tv-row-count">{count.toLocaleString()} channels</span>}
      </div>
      <div className="tv-row-track">{children}</div>
    </section>
  );
}

export const fmtTimeTv = fmtTime;
