// `npm run ingest` — one-shot ingest for local dev / cron.
import { openDb } from "../db/index.js";
import { runIngest } from "./index.js";
openDb();
runIngest(console).then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
