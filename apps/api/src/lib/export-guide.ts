import type fs from "node:fs";

type Headers = Record<string, string | string[] | undefined>;

/** Weak ETag from mtime and size. Weak because the gzip variant is a different representation. */
export function guideEtag(st: Pick<fs.Stats, "mtimeMs" | "size">): string {
  return `W/"${Math.trunc(st.mtimeMs)}-${st.size}"`;
}

const stripWeak = (tag: string) => tag.trim().replace(/^W\//, "");

/** True when Accept-Encoding offers gzip with a non-zero q value. */
export function acceptsGzip(acceptEncoding: string | string[] | undefined): boolean {
  const raw = Array.isArray(acceptEncoding) ? acceptEncoding.join(",") : (acceptEncoding ?? "");
  return raw.split(",").some((part) => {
    const [coding, ...params] = part.split(";").map((s) => s.trim().toLowerCase());
    if (coding !== "gzip") return false;
    const q = params.find((p) => p.startsWith("q="));
    return !q || Number(q.slice(2)) > 0;
  });
}

/**
 * Conditional GET. If-None-Match wins when present; If-Modified-Since is only consulted without it.
 * Last-Modified has whole-second precision, so the mtime is truncated before comparing.
 */
export function isNotModified(headers: Headers, etag: string, mtime: Date): boolean {
  const inm = headers["if-none-match"];
  if (typeof inm === "string" && inm.trim() !== "") {
    return inm.split(",").some((t) => t.trim() === "*" || stripWeak(t) === stripWeak(etag));
  }
  const ims = headers["if-modified-since"];
  if (typeof ims === "string") {
    const since = Date.parse(ims);
    if (!Number.isNaN(since)) return Math.floor(mtime.getTime() / 1000) * 1000 <= since;
  }
  return false;
}
