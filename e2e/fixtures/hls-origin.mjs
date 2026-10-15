// Fake HLS origin for the e2e suite. No internet needed.
//
//   /live/master.m3u8        CORS on: the browser can play it directly
//   /cors-blocked/...        same files, NO CORS headers: direct playback fails in the browser,
//                            the proxy relay (which adds CORS) succeeds
//   /dead/...                always 404
//   /healthz                 readiness probe
//
// Segments live in ./hls: master.m3u8 -> media.m3u8 -> init.mp4 + seg0..seg2.m4s (2 s each, colour bars
// and silence). fMP4 with VP9 and Opus, not MPEG-TS with H.264: the Chromium that Playwright ships has
// no H.264 or AAC decoder and cannot play TS, while VP9 and Opus in fMP4 play through hls.js.
//
// How the committed files were made (ffmpeg with libvpx-vp9 and libopus):
//   ffmpeg -y -f lavfi -i smptebars=size=320x240:rate=25 -f lavfi -i anullsrc=r=48000:cl=stereo -t 6 \
//     -c:v libvpx-vp9 -b:v 150k -maxrate 180k -g 50 -keyint_min 50 -deadline realtime -cpu-used 8 -pix_fmt yuv420p \
//     -c:a libopus -b:a 32k -ac 2 -f hls -hls_segment_type fmp4 -hls_fmp4_init_filename init.mp4 -hls_time 2 \
//     -hls_list_size 0 -hls_playlist_type vod -hls_flags independent_segments -hls_segment_filename seg%d.m4s media.m3u8
// master.m3u8 is hand-written: one variant pointing at media.m3u8, CODECS="vp09.00.10.08,opus".
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const media = path.join(here, "hls");
const PORT = Number(process.env.HLS_PORT ?? 4600);

const TYPES = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".mp4": "video/mp4",
  ".m4s": "video/iso.segment",
};
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-expose-headers": "Content-Length, Content-Range" };

/** Returns { cors: boolean } for a known prefix, or null. */
function routeFor(pathname) {
  if (pathname.startsWith("/live/")) return { cors: true, file: pathname.slice("/live/".length) };
  if (pathname.startsWith("/cors-blocked/")) return { cors: false, file: pathname.slice("/cors-blocked/".length) };
  return null;
}

export function createHlsOrigin() {
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    const route = routeFor(url.pathname);
    if (!route) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    if (req.method === "OPTIONS") {
      res.writeHead(route.cors ? 204 : 404, route.cors ? CORS : {}).end();
      return;
    }
    const name = path.basename(route.file);
    const ext = path.extname(name);
    const file = path.join(media, name);
    // Only the flat set of fixture files; anything else is a 404.
    if (!TYPES[ext] || !fs.existsSync(file) || route.file !== name) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    const headers = { "content-type": TYPES[ext], "cache-control": "no-store", ...(route.cors ? CORS : {}) };
    res.writeHead(200, headers);
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// `/dead/*` is not in routeFor, so it falls through to the 404 above.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createHlsOrigin();
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`hls-origin listening on 127.0.0.1:${PORT}`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
