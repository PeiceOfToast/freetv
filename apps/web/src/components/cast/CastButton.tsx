import { useEffect, useState, type ReactNode } from "react";
import type { ChannelDetail } from "@/lib/api";
import { castCandidates, castChannel, castSupported, stopCasting, useCastState, type CastMedia } from "@/lib/cast";
import { CastIcon, Spinner, actionClass } from "./parts";

type ChannelLike = Pick<ChannelDetail, "id" | "name" | "logo" | "streams">;

function toMedia(channel: ChannelLike, urls: string[]): CastMedia | null {
  if (urls.length === 0) return null;
  return {
    id: channel.id,
    title: channel.name,
    logo: channel.logo,
    url: urls[0],
    fallbackUrls: urls.slice(1),
  };
}

export function CastButton({ channel }: { channel: ChannelLike }) {
  const { ready, state, deviceName, loaded } = useCastState();
  const [menuOpen, setMenuOpen] = useState(false);

  const urls = castCandidates(channel.streams);
  const media = toMedia(channel, urls);

  // Navigating to another channel while casting moves the session to that channel.
  // Keyed on the channel id only, so a fresh page load never starts playback by itself.
  useEffect(() => {
    if (state !== "CONNECTED" || !loaded || loaded.id === channel.id) return;
    const next = toMedia(channel, castCandidates(channel.streams));
    if (next) void castChannel(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  if (!ready || !castSupported()) return null;

  const onClick = () => {
    if (state === "CONNECTED") {
      setMenuOpen((open) => !open);
      return;
    }
    if (media) void castChannel(media);
  };

  const connected = state === "CONNECTED";
  const connecting = state === "CONNECTING";
  const showMenu = connected && menuOpen;
  const alreadyPlaying = loaded?.id === channel.id;

  let label: ReactNode;
  if (connecting) label = <><Spinner /> Connecting…</>;
  else if (connected) label = <><CastIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> {deviceName ?? "Cast device"}</>;
  else label = <><CastIcon /> Cast</>;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        disabled={connecting || (!connected && !media)}
        aria-expanded={connected ? showMenu : undefined}
        aria-haspopup={connected ? "menu" : undefined}
        title={!media && !connected ? "No stream on this channel can be cast from an https page" : undefined}
        className={actionClass}
      >
        {label}
      </button>

      {showMenu && (
        <div
          role="menu"
          className="absolute left-0 z-20 mt-1 w-56 rounded-md border border-zinc-200 bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {!alreadyPlaying && media && (
            <button
              type="button"
              role="menuitem"
              className="block w-full rounded px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
              onClick={() => {
                setMenuOpen(false);
                void castChannel(media);
              }}
            >
              Cast {channel.name}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="block w-full rounded px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
            onClick={() => {
              setMenuOpen(false);
              stopCasting();
            }}
          >
            Stop casting
          </button>
        </div>
      )}
    </div>
  );
}
