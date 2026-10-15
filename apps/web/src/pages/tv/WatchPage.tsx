import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type ChannelDetail, type ChannelSummary } from "@/lib/api";
import { fmtTime, nowTs, progress } from "@/lib/format";
import { focusEl, focusFirst, installSpatialNav, pushBack, tvKeys, type TvKey } from "@/lib/spatial-nav";
import { TvPlayer, type TvPlayerState } from "@/components/tv/TvPlayer";
import { ChannelLogo, ChannelNo, qualityBadge } from "@/components/tv/TvTile";
import { tvList, tvRecent, type TvList } from "@/components/tv/tvSettings";
import { lookup, remember, resolve } from "@/components/tv/numbers";

const OVERLAY_MS = 4000;
const DIGIT_MS = 1500;
const STRIP_WINDOW = 15; // channels either side of the current one in the strip
const NUMBER_STEP_TRIES = 10; // channel up/down by number skips up to this many missing numbers

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
  const [hint, setHint] = useState<{ n: number; state: "found" | "looking" | "missing"; name?: string } | null>(null);

  const hideTimer = useRef<number | undefined>(undefined);
  const digitTimer = useRef<number | undefined>(undefined);
  const msgTimer = useRef<number | undefined>(undefined);
  const digitsRef = useRef("");
  const stripRef = useRef<HTMLDivElement>(null);
  const hintSeq = useRef(0); // latest number preview wins

  // This route sits outside the shell, so it installs the global remote/keyboard handler itself.
  useEffect(() => { installSpatialNav(); }, []);

  // Load the channel; record it as recently watched.
  useEffect(() => {
    const ac = new AbortController();
    setDetail(null);
    setLoadError(false);
    setPState({ playing: false, via: null, attempt: 0, of: 0, failed: false });
    api.channel(id, ac.signal)
      .then((d) => { remember([d]); setDetail(d); tvRecent.push(d.id); })
      .catch(() => { if (!ac.signal.aborted) setLoadError(true); });
    return () => ac.abort();
  }, [id]);

  // Overlay helpers. `hold` keeps it up (used while typing a number or Info is open).
  const showOverlay = (hold = false) => {
    setOverlay(true);
    window.clearTimeout(hideTimer.current);
    if (!hold) hideTimer.current = window.setTimeout(() => setOverlay(false), OVERLAY_MS);
  };

  // Zapping within a list (ChannelUp/Down while the channel is in the list) keeps the list order.
  const inList = list.ids.length > 1 && list.ids.includes(id);

  // Go to a channel by id. Joins the current list when it is there, else starts a one-channel list
  // that keeps the Back target, so channel up/down then moves by number from here.
  const goToId = (target: string) => {
    if (!target || target === id) { showOverlay(); return; }
    const at = list.ids.indexOf(target);
    if (at >= 0) tvList.setIndex(at);
    else tvList.set({ label: "", ids: [target], index: 0, returnTo: list.returnTo || "/tv" });
    nav(`/tv/watch/${encodeURIComponent(target)}`, { replace: true });
  };

  const zapList = (dir: 1 | -1) => {
    const n = list.ids.length;
    goToId(list.ids[(list.index + dir + n) % n]);
    showOverlay();
  };

  // No list (direct arrival): step by channel number, skipping numbers that are not in the catalog.
  const stepNumber = async (dir: 1 | -1) => {
    const cur = detail?.number;
    if (typeof cur !== "number") { flash("This channel has no number"); showOverlay(); return; }
    for (let k = 1; k <= NUMBER_STEP_TRIES; k++) {
      const n = cur + dir * k;
      if (n < 1) break;
      const c = await resolve(n).catch(() => null);
      if (c) { goToId(c.id); showOverlay(); return; }
    }
    flash(`No channel ${cur + dir}`);
    showOverlay();
  };

  const zap = (dir: 1 | -1) => {
    if (inList) zapList(dir);
    else void stepNumber(dir);
  };

  const flash = (text: string) => {
    setMsg(text);
    window.clearTimeout(msgTimer.current);
    msgTimer.current = window.setTimeout(() => setMsg(null), 2500);
  };

  // Digits mean "go to channel number N". Show the name it resolves to while typing.
  const previewNumber = (n: number) => {
    const my = ++hintSeq.current;
    const hit = lookup(n);
    if (hit) { setHint({ n, state: "found", name: hit.name }); return; }
    setHint({ n, state: "looking" });
    resolve(n)
      .then((c) => { if (my === hintSeq.current) setHint(c ? { n, state: "found", name: c.name } : { n, state: "missing" }); })
      .catch(() => { if (my === hintSeq.current) setHint({ n, state: "missing" }); });
  };

  const commitDigits = async () => {
    const n = parseInt(digitsRef.current, 10);
    digitsRef.current = "";
    setDigits("");
    setHint(null);
    hintSeq.current++;
    if (!n) { showOverlay(); return; }
    const c = await resolve(n).catch(() => null);
    if (!c) { flash(`No channel ${n}`); showOverlay(); return; }
    goToId(c.id);
  };
  const commitRef = useRef(commitDigits);
  commitRef.current = commitDigits;

  const onDigit = (d: number) => {
    const next = (digitsRef.current + String(d)).slice(-4);
    digitsRef.current = next;
    setDigits(next);
    previewNumber(parseInt(next, 10));
    showOverlay(true);
    window.clearTimeout(digitTimer.current);
    digitTimer.current = window.setTimeout(() => { void commitRef.current(); }, DIGIT_MS);
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
        remember(r.items);
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
  const viaLabel = pState.playing && pState.via ? `Playing · ${pState.via}`
    : pState.via ? `Connecting · ${pState.via}`
    : "Connecting";
  const hintText = !hint ? "" : hint.state === "found" ? (hint.name ?? "") : hint.state === "looking" ? "Looking up…" : `No channel ${hint.n}`;

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

      {digits && (
        <div className="tv-number" aria-live="polite">
          {digits}
          {hintText && <div className="tv-number-name">{hintText}</div>}
        </div>
      )}
      {msg && <div className="tv-msg" style={{ top: "auto", bottom: "24vh", transform: "translateX(-50%)" }}>{msg}</div>}

      {detail && overlay && !strip && (
        <div className="tv-info" role="status">
          <div className="tv-info-logo"><ChannelLogo src={detail.logo} name={detail.name} /></div>
          <div className="tv-info-body">
            <div className="tv-h2">
              <ChannelNo n={detail.number} className="tv-chno-lg" />
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
                    onClick={() => { if (!current) goToId(c.id); setStrip(false); }}
                    aria-label={c.name}
                  >
                    <div className="tv-tile-logo"><ChannelLogo src={c.logo} name={c.name} /></div>
                    <div className="tv-tile-name"><ChannelNo n={c.number} />{c.name}</div>
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
