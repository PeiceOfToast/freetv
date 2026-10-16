import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { HttpError } from "../lib/http.js";
import { envDefaults, getSettings, publicBase, relayEnabled, storedSettings, updateSettings } from "../lib/settings.js";
import { bearerTokenOk } from "./admin.js";

// GET /api/settings (public), GET/PUT /api/admin/settings (bearer ADMIN_TOKEN). See docs/API.md "Settings".
export async function settingsRoutes(app: FastifyInstance) {
  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    // Fastify's own request errors (e.g. malformed JSON) carry a 4xx statusCode.
    const status = err.statusCode;
    if (status !== undefined && status >= 400 && status < 500) return reply.code(status).send({ error: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: "internal error" });
  });

  const authorized = (headers: Record<string, unknown>) => bearerTokenOk(headers["authorization"], config.adminToken);

  app.get("/api/settings", async (req, reply) => {
    const s = getSettings();
    reply.header("cache-control", "public, max-age=60");
    return {
      siteName: s.siteName,
      publicUrl: publicBase(req),
      contact: s.contact,
      notes: s.notes,
      featuredApps: s.featuredApps,
      relayEnabled: relayEnabled(),
    };
  });

  // Stored values (null = not stored, so the env default applies) plus the env defaults for reference.
  const adminView = () => ({ ...storedSettings(), defaults: envDefaults() });

  app.get("/api/admin/settings", async (req, reply) => {
    if (!authorized(req.headers)) return reply.code(401).send({ error: "unauthorized" });
    reply.header("cache-control", "no-store");
    return adminView();
  });

  app.put("/api/admin/settings", async (req, reply) => {
    if (!authorized(req.headers)) return reply.code(401).send({ error: "unauthorized" });
    reply.header("cache-control", "no-store");
    updateSettings(req.body);
    return adminView();
  });
}
