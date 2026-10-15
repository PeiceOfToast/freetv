import { useState } from "react";

export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0];
  return letters.toUpperCase();
}

/** Logo image with lazy loading; falls back to initials if the image is missing or fails. */
export function ChannelLogo({ src, name, className = "" }: { src: string | null; name: string; className?: string }) {
  // Remember the failing URL rather than a boolean, so a changed src gets a fresh attempt.
  const [failed, setFailed] = useState<string | null>(null);
  if (src && failed !== src) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(src)}
        className={`h-full w-full object-contain ${className}`}
      />
    );
  }
  return (
    <span aria-hidden="true" className={`grid h-full w-full place-items-center text-base font-semibold tracking-tight text-zinc-400 dark:text-zinc-500 ${className}`}>
      {initials(name)}
    </span>
  );
}
