import type Database from "better-sqlite3";
import type { Db } from "../db/index.js";

type Stmt = Database.Statement<unknown[], unknown>;

// Prepared statements are cached per DB handle (tests reopen DBs) and per SQL text.
// The cap keeps dynamic IN (...) lists from growing the cache without bound.
const cache = new WeakMap<Db, Map<string, Stmt>>();
const MAX_STATEMENTS = 256;

export function prep(db: Db, sql: string): Stmt {
  let m = cache.get(db);
  if (!m) {
    m = new Map();
    cache.set(db, m);
  }
  let s = m.get(sql);
  if (!s) {
    if (m.size >= MAX_STATEMENTS) m.clear();
    s = db.prepare(sql) as Stmt;
    m.set(sql, s);
  }
  return s;
}

/** "?,?,?" for an IN (...) list of n values. */
export const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(",");

export const nowSec = () => Math.floor(Date.now() / 1000);

/** Parses a JSON array column; anything malformed becomes []. */
export function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
