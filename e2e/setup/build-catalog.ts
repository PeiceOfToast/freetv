// Child process: builds the catalog tables from E2E_CATALOG_SOURCE into DATA_DIR/catalog.db using the
// API's own ingest code. Runs in its own process so DATA_DIR is read by the API config before import.
const source = process.env.E2E_CATALOG_SOURCE;
if (!source) throw new Error("E2E_CATALOG_SOURCE is required");
if (!process.env.DATA_DIR) throw new Error("DATA_DIR is required");

const { openDb, closeDb } = await import("../../apps/api/src/db/index.ts");
const { buildCatalogFromDir } = await import("../../apps/api/src/ingest/index.ts");

const db = openDb();
try {
  const stats = buildCatalogFromDir(db, source);
  console.log(`e2e catalog: ${JSON.stringify(stats)}`);
} finally {
  closeDb();
}
