import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

export type Db = Database.Database;

export const SCHEMA_VERSION = 4;
let db: Db | null = null;

function schemaPath() {
  // works both from src (tsx) and dist (compiled); Dockerfile copies schema.sql next to dist/db/index.js
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "schema.sql");
}

/** Open (and migrate) the catalog DB. Idempotent. */
export function openDb(dbPath = config.dbPath): Db {
  if (db) return db;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = OFF");
  const schema = fs.readFileSync(schemaPath(), "utf8");
  // Tiny migration scheme: bump SCHEMA_VERSION when a catalog table definition changes. The catalog
  // tables are rebuilt by the next ingest anyway, so on a mismatch we drop them BEFORE applying the
  // schema (an index on a new column would otherwise fail against the old table). `meta`,
  // `programmes`, `channel_numbers` and `stream_health` are preserved.
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const have = (db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as { value: string } | undefined)?.value;
  if (have !== String(SCHEMA_VERSION)) {
    db.exec("DROP TABLE IF EXISTS channels_fts; DROP TABLE IF EXISTS channels; DROP TABLE IF EXISTS streams; DROP TABLE IF EXISTS feeds; DROP TABLE IF EXISTS guides; DROP TABLE IF EXISTS channel_categories; DROP TABLE IF EXISTS channel_languages; DROP TABLE IF EXISTS categories; DROP TABLE IF EXISTS countries; DROP TABLE IF EXISTS languages;");
  }
  db.exec(schema);
  if (have !== String(SCHEMA_VERSION)) {
    db.prepare("INSERT INTO meta(key,value) VALUES('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(SCHEMA_VERSION));
  }
  return db;
}

export function getDb(): Db {
  if (!db) throw new Error("DB not opened; call openDb() first");
  return db;
}

export function closeDb() {
  db?.close();
  db = null;
}

export function getMeta(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string | number) {
  getDb().prepare("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
}
