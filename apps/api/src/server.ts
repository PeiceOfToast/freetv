import Fastify from "fastify";
import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";
import { config } from "./config.js";
import { openDb, getDb, closeDb } from "./db/index.js";
import { closeLogoCache } from "./lib/logo-cache.js";
import { catalogRoutes } from "./routes/catalog.js";
import { streamRoutes } from "./routes/stream.js";
import { epgRoutes } from "./routes/epg.js";
import { exportRoutes } from "./routes/export.js";
import { logoRoutes } from "./routes/logo.js";
import { adminRoutes, bearerTokenOk } from "./routes/admin.js";
import { settingsRoutes } from "./routes/settings.js";
import { startProber, runProbe } from "./prober/index.js";
import { scheduleIngest, runIngest } from "./ingest/index.js";
import { startEpgWatcher, importEpg } from "./epg/importer.js";

export async function buildServer() {
  const app = Fastify({ logger: { level: config.logLevel } });
  await app.register(cors, { origin: true });

  app.get("/api/health", async () => {
    getDb().prepare("SELECT 1").get();
    return { ok: true };
  });

  const requireAdmin = (req: { headers: Record<string, unknown> }) => bearerTokenOk(req.headers["authorization"], config.adminToken);
  app.post("/api/admin/ingest", async (req, reply) => {
    if (!requireAdmin(req)) return reply.code(401).send({ error: "unauthorized" });
    // force: the operator asked for it, so rebuild even if upstream and the local blocklist look unchanged.
    void runIngest(app.log, { force: true }).catch((e) => app.log.error(e));
    return reply.code(202).send({ started: true });
  });
  app.post("/api/admin/probe", async (req, reply) => {
    if (!requireAdmin(req)) return reply.code(401).send({ error: "unauthorized" });
    void runProbe(app.log).catch((e) => app.log.error(e));
    return reply.code(202).send({ started: true });
  });
  app.post("/api/admin/epg/import", async (req, reply) => {
    if (!requireAdmin(req)) return reply.code(401).send({ error: "unauthorized" });
    void importEpg({ force: true }).catch((e) => app.log.error(e));
    return reply.code(202).send({ started: true });
  });

  await app.register(catalogRoutes);
  await app.register(streamRoutes);
  await app.register(epgRoutes);
  await app.register(exportRoutes);
  await app.register(logoRoutes);
  await app.register(adminRoutes);
  await app.register(settingsRoutes);
  return app;
}

/**
 * SIGTERM/SIGINT: stop accepting requests and drain in-flight ones, flush the logo index, close the
 * database, exit 0. Repeated signals while shutting down are ignored.
 */
export function installShutdown(app: FastifyInstance): void {
  let stopping = false;
  const stop = (signal: NodeJS.Signals) => {
    if (stopping) {
      app.log.info(`${signal} ignored: already shutting down`);
      return;
    }
    stopping = true;
    app.log.info(`${signal}: shutting down`);
    app
      .close()
      .then(() => {
        closeLogoCache();
        closeDb();
        process.exit(0);
      })
      .catch((e) => {
        app.log.error(e);
        process.exit(1);
      });
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

async function main() {
  openDb();
  const app = await buildServer();
  await app.listen({ port: config.port, host: config.host });
  installShutdown(app);
  scheduleIngest(app.log);
  startEpgWatcher(app.log);
  startProber(app.log);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
