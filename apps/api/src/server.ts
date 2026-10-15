import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { openDb, getDb } from "./db/index.js";
import { catalogRoutes } from "./routes/catalog.js";
import { streamRoutes } from "./routes/stream.js";
import { epgRoutes } from "./routes/epg.js";
import { exportRoutes } from "./routes/export.js";
import { logoRoutes } from "./routes/logo.js";
import { adminRoutes } from "./routes/admin.js";
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

  const requireAdmin = (req: { headers: Record<string, unknown> }) => {
    const auth = String(req.headers["authorization"] ?? "");
    return config.adminToken !== "" && auth === `Bearer ${config.adminToken}`;
  };
  app.post("/api/admin/ingest", async (req, reply) => {
    if (!requireAdmin(req)) return reply.code(401).send({ error: "unauthorized" });
    void runIngest().catch((e) => app.log.error(e));
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
  return app;
}

async function main() {
  openDb();
  const app = await buildServer();
  await app.listen({ port: config.port, host: config.host });
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
