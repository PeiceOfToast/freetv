import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { tvSettings, type TvSettings } from "@/components/tv/tvSettings";
import { useSpatialNav } from "@/lib/spatial-nav";
import { api } from "@/lib/api";

const QUALITIES: TvSettings["preferredQuality"][] = ["any", "sd", "720p", "1080p", "2160p"];
const QUALITY_LABEL: Record<TvSettings["preferredQuality"], string> = {
  any: "Any", sd: "SD", "720p": "720p", "1080p": "1080p", "2160p": "4K",
};

function useTvSettings(): TvSettings {
  return useSyncExternalStore(tvSettings.subscribe, tvSettings.get, tvSettings.get);
}

export default function SettingsPage() {
  const s = useTvSettings();
  const rootRef = useRef<HTMLDivElement>(null);
  const [hideNsfwDefault, setHideNsfwDefault] = useState(true);
  useSpatialNav(rootRef, { autofocus: true });
  useEffect(() => {
    const ac = new AbortController();
    api.meta(ac.signal).then((m) => setHideNsfwDefault(m.hideNsfwDefault)).catch(() => undefined);
    return () => ac.abort();
  }, []);

  const nsfwLabel = s.hideNsfw === null ? `Default (${hideNsfwDefault ? "hidden" : "shown"})` : s.hideNsfw ? "Hidden" : "Shown";
  const cycleNsfw = () => {
    const next = s.hideNsfw === null ? true : s.hideNsfw === true ? false : null;
    tvSettings.set({ hideNsfw: next });
  };
  const cycleQuality = () => {
    const i = QUALITIES.indexOf(s.preferredQuality);
    tvSettings.set({ preferredQuality: QUALITIES[(i + 1) % QUALITIES.length] });
  };

  return (
    <div className="tv-scroll" ref={rootRef}>
      <h1 className="tv-h1">Settings</h1>

      <div className="tv-setting">
        <span>Hide NSFW channels</span>
        <button type="button" data-nav tabIndex={0} className="tv-toggle" onClick={cycleNsfw}>{nsfwLabel}</button>
      </div>

      <div className="tv-setting">
        <span>Preferred quality</span>
        <button type="button" data-nav tabIndex={0} className="tv-toggle" onClick={cycleQuality}>
          {QUALITY_LABEL[s.preferredQuality]}
        </button>
      </div>

      <div className="tv-setting">
        <span>Prefer relay (for TVs with strict CORS)</span>
        <button type="button" data-nav tabIndex={0} className="tv-toggle" aria-pressed={s.preferRelay}
          onClick={() => tvSettings.set({ preferRelay: !s.preferRelay })}>
          {s.preferRelay ? "On" : "Off"}
        </button>
      </div>

      <div className="tv-setting">
        <span>Exit to the website</span>
        <a data-nav tabIndex={0} href="/" className="tv-toggle" style={{ color: "inherit", textDecoration: "none" }}>Open website</a>
      </div>

      <p className="tv-small" style={{ maxWidth: 900 }}>
        Settings are saved on this device. Press Back to return.
      </p>
    </div>
  );
}
