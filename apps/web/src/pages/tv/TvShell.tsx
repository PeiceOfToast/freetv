import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { focusFirst, pushBack, tvKeys, useSpatialNav } from "@/lib/spatial-nav";
import { IconGrid, IconGuide, IconHome, IconSearch, IconSettings, IconStar } from "@/components/tv/icons";

const RAIL: { label: string; to: string; icon: () => JSX.Element; match: (p: string, s: string) => boolean }[] = [
  { label: "Home", to: "/tv", icon: IconHome, match: (p) => p === "/tv" || p === "/tv/" },
  { label: "Favorites", to: "/tv/browse?fav=1", icon: IconStar, match: (p, s) => p === "/tv/browse" && s.includes("fav=1") },
  { label: "Browse", to: "/tv/browse", icon: IconGrid, match: (p, s) => p === "/tv/browse" && !s.includes("fav=1") && !s.includes("search=1") },
  { label: "Guide", to: "/tv/guide", icon: IconGuide, match: (p) => p === "/tv/guide" },
  { label: "Search", to: "/tv/browse?search=1", icon: IconSearch, match: (p, s) => p === "/tv/browse" && s.includes("search=1") },
  { label: "Settings", to: "/tv/settings", icon: IconSettings, match: (p) => p === "/tv/settings" },
];

function Clock() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setT(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  return <div className="tv-clock">{t.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</div>;
}

export function TvShell() {
  const nav = useNavigate();
  const loc = useLocation();
  const rootRef = useRef<HTMLDivElement>(null);

  // Back one level: history if we have it, otherwise home. On home, let the browser decide.
  useEffect(() => pushBack(() => {
    if (loc.pathname === "/tv") return false;
    if (loc.key !== "default") nav(-1);
    else nav("/tv");
    return true;
  }), [loc.pathname, loc.key, nav]);

  // Remote Guide key jumps to the guide from anywhere in the shell.
  useEffect(() => tvKeys.subscribe((k) => {
    if (k.type === "guide" && loc.pathname !== "/tv/guide") nav("/tv/guide");
  }), [loc.pathname, nav]);

  useSpatialNav(rootRef, { autofocus: true });

  // Moving to another section (rail click) hands focus to that section's content.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const main = rootRef.current?.querySelector<HTMLElement>("main");
      if (main && !main.contains(document.activeElement)) focusFirst(main);
    }, 0);
    return () => window.clearTimeout(t);
  }, [loc.pathname]);

  const search = loc.search;
  const current = RAIL.find((r) => r.match(loc.pathname, search));
  return (
    <div className="tv-root dark" ref={rootRef}>
      <div className="tv-shell">
        <header className="tv-topbar">
          <div className="tv-brand"><img src="/icons/icon-192.png" alt="" /> FreeTV</div>
          {current && current.label !== "Home" && <div className="tv-topbar-title">{current.label}</div>}
          <Clock />
        </header>
        <div className="tv-body">
          <nav className="tv-rail" aria-label="TV sections">
            {RAIL.map((r) => {
              const active = r.match(loc.pathname, search);
              const Icon = r.icon;
              return (
                <button
                  key={r.label}
                  type="button"
                  data-nav
                  tabIndex={0}
                  className="tv-rail-item"
                  aria-current={active ? "page" : undefined}
                  onClick={() => nav(r.to)}
                >
                  <Icon />
                  <span>{r.label}</span>
                </button>
              );
            })}
          </nav>
          <main className="tv-main">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}

export default TvShell;
