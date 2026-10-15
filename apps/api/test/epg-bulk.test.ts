import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../src/config.js";
import { openDb, closeDb, getDb, getMeta } from "../src/db/index.js";
import { importEpg } from "../src/epg/importer.js";

const CHANNELS = 3000;
const PER_CHANNEL = 100; // 300,000 programmes total
const BASE = 1792058400; // 2026-10-15T10:00:00Z
const MB = 1024 * 1024;

// XMLTV "YYYYMMDDHHmmss +0000" from unix seconds.
const xmltvTime = (s: number) => new Date(s * 1000).toISOString().replace(/[-:T]/g, "").slice(0, 14) + " +0000";

function writeSyntheticGuide(file: string): { programmes: number; bytes: number } {
  const fd = fs.openSync(file, "w");
  let bytes = 0;
  const write = (s: string) => {
    fs.writeSync(fd, s);
    bytes += Buffer.byteLength(s);
  };
  write(`<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="synthetic">\n`);
  let buf = "";
  let n = 0;
  for (let c = 0; c < CHANNELS; c++) {
    const channel = `Chan${String(c).padStart(4, "0")}.zz@SD`;
    for (let k = 0; k < PER_CHANNEL; k++) {
      const start = BASE + k * 1800;
      buf +=
        `<programme start="${xmltvTime(start)}" stop="${xmltvTime(start + 1800)}" channel="${channel}">` +
        `<title lang="en">Show ${k} on ${c}</title><desc lang="en">Synthetic description ${k}.</desc>` +
        `<category lang="en">Entertainment</category><icon src="https://example.com/i/${c}.png"/></programme>\n`;
      n++;
      if (buf.length > 1 << 20) {
        write(buf);
        buf = "";
      }
    }
  }
  write(buf);
  write("</tv>\n");
  fs.closeSync(fd);
  return { programmes: n, bytes };
}

describe("epg bulk import", () => {
  let dir: string;
  const savedFile = config.epgFile;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "freetv-epg-bulk-"));
    openDb(path.join(dir, "catalog.db"));
  });

  after(() => {
    config.epgFile = savedFile;
    closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("50 MB / 300k programmes imports with flat memory", async () => {
    const file = path.join(dir, "big-guide.xml");
    const tGen = Date.now();
    const { programmes, bytes } = writeSyntheticGuide(file);
    const genMs = Date.now() - tGen;
    console.log(`  synthetic guide: ${programmes} programmes, ${(bytes / MB).toFixed(1)} MB, generated in ${genMs} ms`);
    config.epgFile = file;

    const baseline = process.memoryUsage().rss;
    let peak = baseline;
    const sampler = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().rss);
    }, 25);
    sampler.unref();

    const t0 = performance.now();
    await importEpg({ force: true });
    const importMs = performance.now() - t0;
    clearInterval(sampler);
    peak = Math.max(peak, process.memoryUsage().rss);

    const { n } = getDb().prepare("SELECT COUNT(*) AS n FROM programmes").get() as { n: number };
    const rowsPerSec = Math.round(programmes / (importMs / 1000));
    console.log(
      `  import: ${importMs.toFixed(0)} ms (${rowsPerSec} rows/s), ` +
        `RSS baseline ${(baseline / MB).toFixed(0)} MB, peak ${(peak / MB).toFixed(0)} MB`,
    );

    assert.equal(n, programmes);
    assert.equal(getMeta("programmes_count"), String(programmes));
    assert.ok(peak < 300 * MB, `peak RSS ${(peak / MB).toFixed(0)} MB exceeds 300 MB`);
  });
});
