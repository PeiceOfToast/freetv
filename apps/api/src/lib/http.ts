import type { FastifyInstance } from "fastify";

/** Thrown by handlers; rendered as `{ "error": message }` with `status`. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const bad = (msg: string) => new HttpError(400, msg);

/** Query/path values: repeated params are joined with commas so they behave like a comma list. */
export function qs(v: unknown): string | undefined {
  if (Array.isArray(v)) return v.map(String).join(",");
  return typeof v === "string" ? v : undefined;
}

export function intParam(raw: string | undefined, name: string, def: number, min: number): number {
  if (raw === undefined || raw.trim() === "") return def;
  const t = raw.trim();
  if (!/^-?\d+$/.test(t)) throw bad(`${name} must be a whole number`);
  const n = Number(t);
  if (!Number.isSafeInteger(n)) throw bad(`${name} is too large`);
  if (n < min) throw bad(`${name} must be at least ${min}`);
  return n;
}

export function boolParam(raw: string | undefined, name: string, def: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return def;
  const t = raw.trim().toLowerCase();
  if (t === "true" || t === "1") return true;
  if (t === "false" || t === "0") return false;
  throw bad(`${name} must be true, false, 1 or 0`);
}

/** Comma list -> unique trimmed non-empty items. Undefined stays undefined (no filter). */
export function listParam(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

export const badRequest = bad;

/**
 * Per-plugin error rendering and cache policy. Scoped to the plugin that calls it.
 * Only successful GETs are cacheable.
 */
export function installHttpBehaviour(app: FastifyInstance) {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: "internal error" });
  });
  app.addHook("onSend", async (req, reply, payload) => {
    if (req.method === "GET" && reply.statusCode < 400) {
      reply.header("cache-control", "public, max-age=60");
    }
    return payload;
  });
}
