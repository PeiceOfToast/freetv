import type { FastifyInstance } from "fastify";
import { getDb } from "../db/index.js";
import { HttpError, installHttpBehaviour, intParam } from "../lib/http.js";
import { prep } from "../lib/sql.js";
import { proxyUrlFor } from "../lib/views.js";

export async function streamRoutes(app: FastifyInstance) {
  installHttpBehaviour(app);

  app.get("/api/stream/:id/:index/play", async (req) => {
    const { id, index } = req.params as { id: string; index: string };
    const idx = intParam(index, "index", 0, 0);
    const row = prep(getDb(), "SELECT s.url, s.user_agent, s.referrer FROM streams s JOIN channels c ON c.id = s.channel WHERE s.channel = ? AND s.idx = ? AND c.blocked = 0").get(id, idx) as
      | { url: string; user_agent: string | null; referrer: string | null }
      | undefined;
    if (!row) throw new HttpError(404, "stream not found");
    const proxyUrl = proxyUrlFor(row.url, row.user_agent, row.referrer);
    return {
      url: row.url,
      ...(proxyUrl !== undefined ? { proxyUrl } : {}),
      userAgent: row.user_agent,
      referrer: row.referrer,
    };
  });
}
