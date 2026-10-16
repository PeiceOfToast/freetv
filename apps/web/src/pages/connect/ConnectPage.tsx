import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useFavorites } from "@/lib/favorites";
import type { FeaturedApp } from "@/lib/api";
import { APP_GUIDES, FEATURED_APP_ORDER, REFRESH_NOTE } from "./apps";
import Customise, { DEFAULT_CUSTOMISE, type CustomiseValue } from "./Customise";
import QrCode from "./QrCode";
import { buildGuideUrl, buildPlaylistUrl, normaliseBase } from "./urls";
import { useSettings } from "./useSettings";

// Copy with a fallback for plain-HTTP pages, where navigator.clipboard is not available.
async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the textarea method
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    const ok = await copyText(text);
    setState(ok ? "copied" : "failed");
    window.setTimeout(() => setState("idle"), 2000);
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copy ${label} link`}
        className="inline-flex h-9 items-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {state === "copied" ? "Copied" : "Copy link"}
      </button>
      <span role="status" className="text-xs text-zinc-500 dark:text-zinc-400">
        {state === "failed" && "Could not copy. Select the link above and copy it by hand."}
      </span>
    </div>
  );
}

function LinkCard({ label, helper, url }: { label: string; helper: string; url: string }) {
  return (
    <section aria-label={label} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1 space-y-3">
          <h3 className="text-base font-semibold">{label}</h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{helper}</p>
          <input
            readOnly
            aria-label={`${label} link`}
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="h-10 w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
          />
          <CopyButton text={url} label={label} />
        </div>
        <QrCode value={url} label={label} />
      </div>
    </section>
  );
}

function AppSection({ id, open }: { id: (typeof FEATURED_APP_ORDER)[number]; open: boolean }) {
  const guide = APP_GUIDES[id];
  return (
    <details open={open} className="group rounded-xl border border-zinc-200 dark:border-zinc-800">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold marker:content-none">
        <span>
          {guide.name}
          <span className="block text-xs font-normal text-zinc-500 dark:text-zinc-400">{guide.platform}</span>
        </span>
        <span aria-hidden="true" className="text-zinc-400 transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="space-y-3 border-t border-zinc-200 px-4 py-4 text-sm leading-relaxed text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
        <ol className="list-decimal space-y-2 pl-5">
          {guide.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{REFRESH_NOTE}</p>
      </div>
    </details>
  );
}

export default function ConnectPage() {
  const { settings, error } = useSettings();
  const favorites = useFavorites();
  const [choices, setChoices] = useState<CustomiseValue>(DEFAULT_CUSTOMISE);

  useEffect(() => {
    document.title = "Use FreeTV in your app";
  }, []);

  // Falls back to the origin this page was loaded from when settings are unavailable.
  const base = normaliseBase(settings?.publicUrl || window.location.origin);
  const siteName = settings?.siteName?.trim() || "FreeTV";

  const playlistUrl = useMemo(
    () =>
      buildPlaylistUrl(base, {
        countries: choices.countries,
        categories: choices.categories,
        quality: choices.quality,
        favorites: choices.favoritesOnly && favorites.length > 0 ? favorites : null,
        allStreams: choices.allStreams,
      }),
    [base, choices, favorites],
  );
  const guideUrl = buildGuideUrl(base);

  // The operator's choice of featured apps, shown in the canonical order. An empty choice still shows the generic guide.
  const featured = settings?.featuredApps ?? FEATURED_APP_ORDER;
  const apps = FEATURED_APP_ORDER.filter((id) => featured.includes(id));
  const shownApps: FeaturedApp[] = apps.length ? apps : ["generic"];

  return (
    <div className="mx-auto max-w-3xl space-y-10 py-6">
      <section className="space-y-3">
        <h1 className="text-[clamp(1.875rem,1.5rem+1.5vw,2.5rem)] font-semibold tracking-tight">Use {siteName} in your app</h1>
        <p className="leading-relaxed text-zinc-600 dark:text-zinc-300">
          Point any IPTV app at these two links and you get every channel, with numbers and the guide.
        </p>
        {error && (
          <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            Settings could not be loaded, so these links use this site's address.
          </p>
        )}
      </section>

      <nav aria-label="Three ways to watch" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold">Watch here</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Play any channel in this browser.</p>
          <Link to="/" className="mt-2 inline-flex min-h-9 items-center text-sm font-medium underline">
            Browse channels
          </Link>
        </div>
        <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold">Open in app</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            On a channel page, Open in app downloads a one-channel playlist for VLC, IINA and similar players.
          </p>
        </div>
        <div aria-current="page" className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold">Use in your app</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Add the playlist and guide to a TV or IPTV app. You are on this page.
          </p>
        </div>
      </nav>

      <section aria-labelledby="links-heading" className="space-y-4">
        <h2 id="links-heading" className="text-xl font-semibold">
          Playlist and guide
        </h2>
        <LinkCard
          label="Playlist"
          helper="Every channel with its number, logo and group. Scan the code with a phone or TV app that has a QR scanner."
          url={playlistUrl}
        />
        <LinkCard label="Guide" helper="Programme listings in XMLTV format. Scan the code the same way, or paste the link into the app's guide setting." url={guideUrl} />
      </section>

      <Customise
        value={choices}
        onChange={setChoices}
        favoriteCount={favorites.length}
      />

      <section aria-labelledby="setup-heading" className="space-y-4">
        <div className="space-y-1">
          <h2 id="setup-heading" className="text-xl font-semibold">
            Set up your app
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Pick your app. Use the playlist link above, and the guide link for the programme listings.
          </p>
        </div>
        <div className="space-y-3">
          {shownApps.map((id, i) => (
            <AppSection key={id} id={id} open={i === 0} />
          ))}
        </div>
      </section>
    </div>
  );
}
