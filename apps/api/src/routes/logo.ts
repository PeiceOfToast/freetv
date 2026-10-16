import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { HttpError, intParam, qs } from "../lib/http.js";
import { getLogo, normalizeLogoSize, LogoBusyError } from "../lib/logo-cache.js";

// TRACK L: GET /logo/:id — cached, resized channel logos. See docs/API.md "Logos".
// Headers are set here, not via installHttpBehaviour (its onSend hook would overwrite Cache-Control).

const CACHE_CONTROL = "public, max-age=604800, stale-while-revalidate=86400";

function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((token) => {
    const t = token.trim().replace(/^W\//, "");
    return t === "*" || t === etag;
  });
}

export async function logoRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string }; Querystring: { s?: string | string[] } }>("/logo/:id", async (req, reply) => {
    reply.header("Vary", "Accept");
    if (!config.logoCacheEnabled) return reply.code(404).send({ error: "logo cache disabled" });

    let requested: number;
    try {
      requested = intParam(qs(req.query.s), "s", 256, 1);
    } catch (err) {
      if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
    const size = normalizeLogoSize(requested);
    const accept = String(req.headers.accept ?? "");
    let hit: Awaited<ReturnType<typeof getLogo>>;
    try {
      hit = await getLogo(req.params.id, size, { webp: /image\/webp/i.test(accept) });
    } catch (err) {
      if (err instanceof LogoBusyError) return reply.code(503).header("Retry-After", "5").header("Cache-Control", "no-store").send({ error: "logo cache busy" });
      throw err;
    }
    if (!hit) {
      return reply.code(404).header("Cache-Control", "public, max-age=300").send({ error: "no logo" });
    }

    reply.header("ETag", hit.etag);
    reply.header("Cache-Control", CACHE_CONTROL);
    if (etagMatches(req.headers["if-none-match"], hit.etag)) {
      return reply.code(304).send();
    }
    reply.header("Content-Type", hit.contentType);
    reply.header("Content-Length", hit.size);
    if (hit.contentType === "image/svg+xml") {
      // SVG is passed through; never let it run script or load anything when opened directly.
      reply.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      reply.header("X-Content-Type-Options", "nosniff");
    }
    return reply.send(fs.createReadStream(hit.path));
  });
}
