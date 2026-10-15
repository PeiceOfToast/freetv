import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type ChannelDetail, type ChannelSummary } from "@/lib/api";
import { fmtTime, nowTs, progress } from "@/lib/format";
import { focusEl, focusFirst, installSpatialNav, pushBack, tvKeys, type TvKey } from "@/lib/spatial-nav";
import { TvPlayer, type TvPlayerState } from "@/components/tv/TvPlayer";
import { ChannelLogo, qualityBadge } from "@/components/tv/TvTile";
import { tvList, tvRecent, type TvList } from "@/components/tv/tvSettings";

const OVERLAY_MS = 4000;
const DIGIT_MS = 1500;
const STRIP_WINDOW = 15; // channels either side of the current one in the strip

function resolveList(id: string): TvList {
  const cur = tvList.get();
  if (cur && cur.ids.includes(id)) return { ...cur, index: cur.ids.indexOf(id) };
  return { label: "", ids: [id], index: 0, returnTo: "/tv" };
}

export default function WatchPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();

  const list = useMemo(() => resolveList(id), [id]);
  const [detail, setDetail] = useState<ChannelDetail | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pState, setPState] = useState<TvPlayerState>({ playing: false, via: null, attempt: 0, of: 0, failed: false });
  const [retry, setRetry] = useState(0);

  const [overlay, setOverlay] = useState(false);
  const [info, setInfo] = useState(false);
  const [digits, setDigits] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [strip, setStrip] = useState(false);
  const [stripItems, setStripItems] = useState<ChannelSummary[] | null>(null);

  const hideTimer = useRef<number | undefined>(undefined);
  const digitTimer = useRef<number | undefined>(undefined);
  const msgTimer = useRef<number | undefined>(undefined);
  const digitsRef = useRef("");
  const stripRef = useRef<HTMLDivElement>(null);

  // This route sits outside the shell, so it installs the global remote/keyboard handler itself.
  useEffect(() => { installSpatialNav(); }, []);

  // Load the channel; record it as recently watched.
  useEffect(() => {
    const ac = new AbortController();
    setDetail(null);
    setLoadError(false);
    setPState({ playing: false, via: null, attempt: 0, of: 0, failed: false });
    api.channel(id, ac.signal)
      .then((d) => { setDetail(d); tvRecent.push(d.id); })
      .catch(() => { if (!ac.signal.aborted) setLoadError(true); });
    return () => ac.abort();
  }, [id]);

  // Overlay helpers. `hold` keeps it up (used while typing a number or Info is open).
  const showOverlay = (hold = false) => {
    setOverlay(true);
    window.clearTimeout(hideTimer.current);
    if (!hold) hideTimer.current = window.setTimeout(() => setOverlay(false), OVERLAY_MS);
  };

  const goTo = (index: number) => {
    const target = list.ids[index];
    if (!target || target === id) return;
    tvList.setIndex(index);
    nav(`/tv/watch/${encodeURIComponent(target)}`, { replace: true });
  };

  const zap = (dir: 1 | -1) => {
    if (list.ids.length < 2) { showOverlay(); return; }
    const n = list.ids.length;
    goTo((list.index + dir + n) % n);
    showOverlay();
  };

  const flash = (text: string) => {
    setMsg(text);
    window.clearTimeout(msgTimer.current);
    msgTimer.current = window.setTimeout(() => setMsg(null), 2500);
  };

  const commitDigits = () => {
    const n = parseInt(digitsRef.current, 10);
    digitsRef.current = "";
    setDigits("");
    if (!n) { showOverlay(); return; }
    const idx = n - 1;
    if (idx >= 0 && idx < list.ids.length) {
      goTo(idx);
      showOverlay();
    } else {
      flash(`No channel ${n} in this list`);
      showOverlay();
    }
  };
  const commitRef = useRef(commitDigits);
  commitRef.current = commitDigits;

  const onDigit = (d: number) => {
    const next = (digitsRef.current + String(d)).slice(-4);
    digitsRef.current = next;
    setDigits(next);
    showOverlay(true);
    window.clearTimeout(digitTimer.current);
    digitTimer.current = window.setTimeout(() => commitRef.current(), DIGIT_MS);
  };

  const togglePlay = () => {
    const v = document.querySelector<HTMLVideoElement>(".tv-watch video");
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  };

  const closeStrip = () => setStrip(false);

  // Remote-only keys arrive through tvKeys. Latest handler lives in a ref so the subscription is stable.
  const handleKey = (k: TvKey) => {
    switch (k.type) {
      case "channel": zap(k.dir); return;
      case "digit": onDigit(k.digit); return;
      case "info": {
        const next = !info;
        setInfo(next);
        showOverlay(next);
        return;
      }
      case "guide": nav("/tv/guide"); return;
      case "playpause": togglePlay(); showOverlay(); return;
    }
  };
  const handleKeyRef = useRef(handleKey);
  handleKeyRef.current = handleKey;
  useEffect(() => tvKeys.subscribe((k) => handleKeyRef.current(k)), []);

  // Show the overlay for a few seconds whenever a channel loads (like a TV does on zap).
  useEffect(() => { if (detail) showOverlay(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [detail]);

  // Any key shows the overlay; Enter toggles the strip (or retries after a failure).
  const stripRefState = useRef(strip);
  stripRefState.current = strip;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        if (e.defaultPrevented) return; // a focused strip tile already handled it
        if (pState.failed) { setRetry((r) => r + 1); return; }
        setStrip((s) => !s);
        showOverlay();
        return;
      }
      showOverlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pState.failed]);

  // Back: close the strip first, otherwise go to the screen we came from.
  useEffect(() => pushBack(() => {
    if (stripRefState.current) { closeStrip(); return true; }
    nav(list.returnTo || "/tv", { replace: false });
    return true;
  }), [list.returnTo, nav]);

  // Strip: a window of the current list, in list order.
  useEffect(() => {
    if (!strip) return;
    const from = Math.max(0, list.index - STRIP_WINDOW);
    const ids = list.ids.slice(from, list.index + STRIP_WINDOW + 1);
    const ac = new AbortController();
    setStripItems(null);
    api.channels({ favorites: ids, limit: 200, withNow: true }, ac.signal)
      .then((r) => {
        const byId = new Map(r.items.map((c) => [c.id, c] as const));
        setStripItems(ids.map((x) => byId.get(x)).filter((c): c is ChannelSummary => !!c));
      })
      .catch(() => { if (!ac.signal.aborted) setStripItems([]); });
    return () => ac.abort();
  }, [strip, list.index, list.ids]);

  // When the strip opens or its items arrive, put focus on the channel now playing.
  useEffect(() => {
    if (!strip || !stripItems) return;
    const t = window.setTimeout(() => {
      const root = stripRef.current;
      if (!root) return;
      const cur = root.querySelector<HTMLElement>('[data-current="1"]');
      if (cur) focusEl(cur);
      else focusFirst(root);
    }, 0);
    return () => window.clearTimeout(t);
  }, [strip, stripItems]);

  useEffect(() => () => {
    window.clearTimeout(hideTimer.current);
    window.clearTimeout(digitTimer.current);
    window.clearTimeout(msgTimer.current);
  }, []);

  // Summary values for the overlay.
  const now = detail?.now ?? null;
  const next = detail?.next ?? null;
  const badge = qualityBadge(detail?.streams[0]?.quality ?? null);
  const viaLabel = pState.via === "relay" ? "Relay" : pState.via === "direct" ? "Direct" : "Connecting";
  const number = list.ids.length > 1 ? list.index + 1 : null;

  return (
    <div className="tv-watch" data-testid="tv-watch">
      {detail && (
        <TvPlayer
          key={`${id}:${retry}`}
          streams={detail.streams}
          onState={setPState}
        />
      )}

      {!detail && !loadError && <div className="tv-msg">Loading channel…</div>}
      {loadError && <div className="tv-msg">Couldn't load this channel.<br /><span className="tv-small">Press Back to return.</span></div>}
      {detail && pState.failed && !strip && (
        <div className="tv-msg">Couldn't play {detail.name}.<br /><span className="tv-small">Press Enter to retry, or Back.</span></div>
      )}

      {digits && <div className="tv-number" aria-live="polite">{digits}</div>}
      {msg && <div className="tv-msg" style={{ top: "auto", bottom: "24vh", transform: "translateX(-50%)" }}>{msg}</div>}

      {detail && overlay && !strip && (
        <div className="tv-info" role="status">
          <div className="tv-info-logo"><ChannelLogo src={detail.logo} name={detail.name} /></div>
          <div className="tv-info-body">
            <div className="tv-h2">
              {number !== null && <span style={{ marginRight: 14 }}>{number}</span>}
              {detail.name}
              {detail.flag ? <span style={{ marginLeft: 12 }}>{detail.flag}</span> : null}
              {badge && <span className={badge.cls}>{badge.label}</span>}
            </div>
            <div>
              <strong>Now:</strong> {now ? now.title : "No programme information"}
              {now && <span className="tv-small"> · {fmtTime(now.start)}–{fmtTime(now.stop)}</span>}
            </div>
            {now && (
              <div className="tv-bar" aria-hidden="true">
                <div style={{ width: `${Math.round(progress(now.start, now.stop) * 100)}%` }} />
              </div>
            )}
            <div className="tv-small" style={{ marginTop: 8 }}>
              <strong>Next:</strong> {next ? `${next.title} · ${fmtTime(next.start)}` : "—"}
            </div>
            <div className="tv-small" style={{ marginTop: 6 }}>
              {viaLabel}{detail.streams[0]?.quality ? ` · ${detail.streams[0].quality}` : ""} · {fmtTime(nowTs())}
            </div>
            {info && now?.description && <div className="tv-desc">{now.description}</div>}
          </div>
        </div>
      )}

      {detail && strip && (
        <div className="tv-strip" data-nav-scope ref={stripRef} aria-label="Channels in this list">
          {stripItems === null && <div className="tv-small">Loading channels…</div>}
          {stripItems && (
            <div className="tv-row-track">
              {stripItems.map((c) => {
                const idx = list.ids.indexOf(c.id);
                const current = c.id === id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    data-nav
                    tabIndex={0}
                    data-current={current ? "1" : undefined}
                    className="tv-tile"
                    style={{ width: 240 }}
                    onClick={() => { if (!current) goTo(idx); setStrip(false); }}
                    aria-label={c.name}
                  >
                    <div className="tv-tile-logo"><ChannelLogo src={c.logo} name={c.name} /></div>
                    <div className="tv-tile-name">{idx >= 0 ? `${idx + 1}  ` : ""}{c.name}</div>
                    <div className="tv-tile-now">{c.now?.title ? `Now: ${c.now.title}` : ""}</div>
                  </button>
                );
              })}
            </div>
          )}
          <div className="tv-small" style={{ marginTop: 6 }}>Enter to watch · Back to close</div>
        </div>
      )}
    </div>
  );
}
