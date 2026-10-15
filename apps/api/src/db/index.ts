import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

export type Db = Database.Database;

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
  db.exec(fs.readFileSync(schemaPath(), "utf8"));
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
