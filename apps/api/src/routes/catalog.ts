import type { FastifyInstance } from "fastify";
// TRACK B: implement /api/meta, /api/categories, /api/countries, /api/languages, /api/channels, /api/channels/:id per docs/API.md
export async function catalogRoutes(app: FastifyInstance) {
  app.get("/api/meta", async () => ({ error: "not implemented" }));
}
