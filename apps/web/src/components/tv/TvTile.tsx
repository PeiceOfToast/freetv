import { useState, type ReactNode } from "react";
import type { ChannelSummary } from "@/lib/api";
import { fmtTime } from "@/lib/format";

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
  const now = ch.now?.title ? `Now: ${ch.now.title}${ch.now.start ? ` · ${fmtTime(ch.now.start)}` : ""}` : "";
  return (
    <button
      type="button"
      data-nav
      tabIndex={0}
      className="tv-tile"
      aria-label={`${ch.name}${now ? `, ${now}` : ""}`}
      onClick={onOpen}
    >
      <div className="tv-tile-logo"><ChannelLogo src={ch.logo} name={ch.name} /></div>
      <div className="tv-tile-name">{ch.name}</div>
      <div className="tv-tile-meta">
        {ch.flag ? `${ch.flag} ` : ""}{ch.countryName ?? ""}
        {badge && <span className={badge.cls}>{badge.label}</span>}
      </div>
      {nowLine && <div className="tv-tile-now">{now}</div>}
    </button>
  );
}

export function TvRow({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section className="tv-row" aria-labelledby={id}>
      <h2 className="tv-h2" id={id}>{title}</h2>
      <div className="tv-row-track">{children}</div>
    </section>
  );
}
