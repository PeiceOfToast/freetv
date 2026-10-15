// Local HTTP server for prober tests (127.0.0.1 only). Not a test file: imported by prober*.test.ts.
import http from "node:http";
import type { AddressInfo } from "node:net";

export const VALID_PLAYLIST = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXTINF:10.0,\nseg0.ts\n#EXT-X-ENDLIST\n";
export const MASTER_WITH_VARIANTS = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1280000\nvariant/index.m3u8\n";
export const EMPTY_MASTER = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1280000\n";
export const UA_REQUIRED = "FreeTV-Test-UA/1.0";

export interface FixtureServer {
  base: string;
  /** Makes /flaky.m3u8 answer 500 (true) or the valid playlist (false). */
  setFlaky(fail: boolean): void;
  /** Requests seen per path, for asserting redirects and UA behaviour. */
  hits: Map<string, number>;
  close(): Promise<void>;
}

export async function startFixtureServer(): Promise<FixtureServer> {
  let flaky = false;
  const hits = new Map<string, number>();
  const server = http.createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    hits.set(path, (hits.get(path) ?? 0) + 1);
    const playlist = (body: string) => {
      res.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" });
      res.end(body);
    };
    switch (path) {
      case "/valid.m3u8":
        return playlist(VALID_PLAYLIST);
      case "/master.m3u8":
        return playlist(MASTER_WITH_VARIANTS);
      case "/empty-master.m3u8":
        return playlist(EMPTY_MASTER);
      case "/not-found.m3u8":
        res.writeHead(404, { "content-type": "text/plain" });
        return res.end("nope");
      case "/server-error.m3u8":
        res.writeHead(503, { "content-type": "text/plain" });
        return res.end("busy");
      case "/slow.m3u8":
        // Sends headers, then never finishes the body: only the probe timeout ends it.
        res.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" });
        res.write("#EXTM3U\n");
        return;
      case "/redirect.m3u8":
        res.writeHead(302, { location: "/valid.m3u8" });
        return res.end();
      case "/redirect-loop.m3u8":
        res.writeHead(302, { location: "/redirect-loop.m3u8" });
        return res.end();
      case "/ua-check.m3u8":
        if ((req.headers["user-agent"] ?? "") !== UA_REQUIRED) {
          res.writeHead(403, { "content-type": "text/plain" });
          return res.end("forbidden");
        }
        return playlist(VALID_PLAYLIST);
      case "/flaky.m3u8":
        if (flaky) {
          res.writeHead(500, { "content-type": "text/plain" });
          return res.end("boom");
        }
        return playlist(VALID_PLAYLIST);
      case "/html-page.m3u8":
        res.writeHead(200, { "content-type": "text/html" });
        return res.end("<html>login</html>");
      case "/stream.ts":
        res.writeHead(200, { "content-type": "video/mp2t" });
        return res.end(Buffer.alloc(188 * 20, 0x47));
      case "/empty-ts":
        res.writeHead(200, { "content-type": "video/mp2t" });
        return res.end();
      default:
        res.writeHead(404);
        return res.end();
    }
  });
  server.on("connection", (s) => s.setNoDelay(true));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    setFlaky: (fail) => {
      flaky = fail;
    },
    hits,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
