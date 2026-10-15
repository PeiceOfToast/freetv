import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type ChannelSummary, type Programme } from "@/lib/api";
import { favorites } from "@/lib/favorites";
import { fmtTime, nowTs } from "@/lib/format";
import { focusFirst, pushBack, tvKeys, useSpatialNav } from "@/lib/spatial-nav";
import { ChannelLogo, ChannelNo } from "@/components/tv/TvTile";
import { tvList } from "@/components/tv/tvSettings";
import { remember } from "@/components/tv/numbers";

const DIGIT_MS = 1500;

const WINDOW = 2 * 3600; // 2 h visible
const STEP = 30 * 60;    // pan and header granularity
const MAX_ROWS = 100;    // API batch limit

const pct = (x: number) => `${(x * 100).toFixed(3)}%`;

/** Channels for the guide: the list being zapped, else favorites, else a few busy channels. */
function sourceIds(): Promise<string[]> {
  const cur = tvList.get();
  if (cur && cur.ids.length) return Promise.resolve(cur.ids.slice(0, MAX_ROWS));
  const favs = favorites.get();
  if (favs.length) return Promise.resolve(favs.slice(0, MAX_ROWS));
  return api.channels({ sort: "streams", order: "desc", limit: 40 }).then((r) => r.items.map((c) => c.id));
}

export default function GuidePage() {
  const nav = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const base = useRef(Math.floor(nowTs() / STEP) * STEP);
  const [offset, setOffset] = useState(0); // in STEP units; negative = earlier
  const from = base.current + offset * STEP;

  const [ids, setIds] = useState<string[] | null>(null);
  const [chans, setChans] = useState<Record<string, ChannelSummary>>({});
  const [grid, setGrid] = useState<Record<string, Programme[]>>({});
  const [error, setError] = useState(false);
  const [digits, setDigits] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const digitsRef = useRef("");
  const digitTimer = useRef<number | undefined>(undefined);
  const msgTimer = useRef<number | undefined>(undefined);

  // Resolve the channel list once.
  useEffect(() => {
    let alive = true;
    sourceIds().then((x) => { if (alive) setIds(x); }).catch(() => { if (alive) { setIds([]); setError(true); } });
    return () => { alive = false; };
  }, []);

  // Channel metadata (logos, names) for the rows.
  useEffect(() => {
    if (!ids || ids.length === 0) return;
    const ac = new AbortController();
    api.channels({ favorites: ids, limit: MAX_ROWS }, ac.signal)
      .then((r) => { remember(r.items); setChans(Object.fromEntries(r.items.map((c) => [c.id, c]))); })
      .catch(() => undefined);
    return () => ac.abort();
  }, [ids]);

  // Programmes for the visible window. Refetches when panning.
  useEffect(() => {
    if (!ids || ids.length === 0) return;
    const ac = new AbortController();
    setError(false);
    api.epgGrid(ids, from, from + WINDOW, ac.signal)
      .then((r) => setGrid(r.channels))
      .catch(() => { if (!ac.signal.aborted) setError(true); });
    return () => ac.abort();
  }, [ids, from]);

  // Pan: Left/Right at the edge of a row moves the time window. The spatial handler runs
  // first in the bubble phase; we snapshot focus in the capture phase to see whether it moved.
  useEffect(() => {
    let before: Element | null = null;
    const pre = () => { before = document.activeElement; };
    const post = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (document.activeElement !== before) return; // focus moved normally
      const el = before as HTMLElement | null;
      if (!el || !el.hasAttribute("data-start")) return;
      const s = Number(el.getAttribute("data-start"));
      const t = Number(el.getAttribute("data-stop"));
      if (e.key === "ArrowLeft" && s <= from) setOffset((o) => o - 1);
      if (e.key === "ArrowRight" && t >= from + WINDOW) setOffset((o) => o + 1);
    };
    window.addEventListener("keydown", pre, true);
    window.addEventListener("keydown", post);
    return () => {
      window.removeEventListener("keydown", pre, true);
      window.removeEventListener("keydown", post);
    };
  }, [from]);

  useSpatialNav(rootRef, { autofocus: true });
  useEffect(() => pushBack(() => { nav("/tv"); return true; }), [nav]);

  // The autofocus above runs before data arrives; once the first programmes exist, focus them.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || Object.keys(grid).length === 0) return;
    const a = document.activeElement;
    if (!a || a === document.body || !root.contains(a)) focusFirst(root);
  }, [grid]);

  // Digits jump to the row of that channel number, when it is in the grid.
  const channelByNumber = (n: number) => (ids ?? []).find((x) => chans[x]?.number === n) ?? null;

  const flash = (text: string) => {
    setMsg(text);
    window.clearTimeout(msgTimer.current);
    msgTimer.current = window.setTimeout(() => setMsg(null), 2500);
  };

  const jumpToNumber = () => {
    const n = parseInt(digitsRef.current, 10);
    digitsRef.current = "";
    setDigits("");
    if (!n) return;
    const cid = channelByNumber(n);
    if (!cid) { flash(`Channel ${n} isn't in this guide`); return; }
    const row = Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [])
      .find((el) => el.getAttribute("data-row") === cid);
    if (row) focusFirst(row);
  };
  const jumpRef = useRef(jumpToNumber);
  jumpRef.current = jumpToNumber;

  useEffect(() => tvKeys.subscribe((k) => {
    if (k.type !== "digit") return;
    const next = (digitsRef.current + String(k.digit)).slice(-4);
    digitsRef.current = next;
    setDigits(next);
    window.clearTimeout(digitTimer.current);
    digitTimer.current = window.setTimeout(() => jumpRef.current(), DIGIT_MS);
  }), []);

  useEffect(() => () => {
    window.clearTimeout(digitTimer.current);
    window.clearTimeout(msgTimer.current);
  }, []);

  const watch = (cid: string) => {
    const all = ids ?? [];
    tvList.set({ label: "Guide", ids: all, index: Math.max(0, all.indexOf(cid)), returnTo: "/tv/guide" });
    nav(`/tv/watch/${encodeURIComponent(cid)}`);
  };

  const headerTimes = useMemo(() => [0, 1, 2, 3].map((k) => ({ k, t: from + k * STEP })), [from]);
  const typed = digits ? parseInt(digits, 10) : 0;
  const typedCid = typed ? channelByNumber(typed) : null;
  const typedName = typedCid ? chans[typedCid]?.name ?? "" : typed ? "Not in this guide" : "";
  const nowX = nowTs() - from;
  const showNow = nowX >= 0 && nowX <= WINDOW;

  return (
    <div className="tv-root dark" ref={rootRef}>
      <h1 className="tv-h1">Guide</h1>
      <div className="tv-small" style={{ marginBottom: 14 }}>
        {fmtTime(from)} – {fmtTime(from + WINDOW)} · Left/Right at the edge moves the time · Enter to watch · Back to return
      </div>

      {ids && ids.length === 0 && <div className="tv-small">No channels to show. Add favorites or open a list first.</div>}
      {error && <div className="tv-small">Couldn't load the guide. Press Back and try again.</div>}
      {digits && (
        <div className="tv-number" aria-live="polite">
          {digits}
          {typedName && <div className="tv-number-name">{typedName}</div>}
        </div>
      )}
      {msg && <div className="tv-msg" style={{ top: "auto", bottom: "10vh", transform: "translateX(-50%)" }}>{msg}</div>}

      <div className="tv-guide" style={{ maxHeight: "66vh", overflowY: "auto", overflowX: "hidden", paddingRight: 8 }}>
        <div className="tv-guide-row" style={{ gridTemplateColumns: "260px 1fr" }}>
          <div />
          <div style={{ position: "relative", height: 30 }}>
            {headerTimes.map(({ k, t }) => (
              <span key={k} className="tv-prog-time" style={{ position: "absolute", left: pct(k * STEP / WINDOW), top: 0 }}>
                {fmtTime(t)}
              </span>
            ))}
            {showNow && <div aria-hidden="true" style={{ position: "absolute", left: pct(nowX / WINDOW), top: 0, bottom: -600, width: 3, background: "#ef4444" }} />}
          </div>
        </div>

        {(ids ?? []).map((cid) => {
          const progs = grid[cid] ?? [];
          const ch = chans[cid];
          return (
            <div key={cid} data-row={cid} className="tv-guide-row" style={{ gridTemplateColumns: "260px 1fr", height: 84 }}>
              <div className="tv-guide-ch" style={{ height: 84 }}>
                {ch ? <ChannelLogo src={ch.logo} name={ch.name} /> : null}
                <ChannelNo n={ch?.number} />
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ch?.name ?? cid}</span>
              </div>
              <div style={{ position: "relative", height: 84 }}>
                {progs.length === 0 && (
                  <button type="button" data-nav tabIndex={0} className="tv-prog tv-prog-empty"
                    style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
                    onClick={() => watch(cid)}>
                    No programme information · Enter to watch
                  </button>
                )}
                {progs.map((p) => {
                  const s = Math.max(p.start, from);
                  const e = Math.min(p.stop, from + WINDOW);
                  if (e <= s) return null;
                  return (
                    <button
                      key={`${cid}:${p.start}`}
                      type="button"
                      data-nav
                      tabIndex={0}
                      data-start={p.start}
                      data-stop={p.stop}
                      className="tv-prog"
                      style={{ position: "absolute", top: 0, bottom: 0, left: pct((s - from) / WINDOW), width: `calc(${pct((e - s) / WINDOW)} - 6px)` }}
                      onClick={() => watch(cid)}
                      aria-label={`${p.title}, ${fmtTime(p.start)} to ${fmtTime(p.stop)}`}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</span>
                      <span className="tv-prog-time">{fmtTime(p.start)} – {fmtTime(p.stop)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
