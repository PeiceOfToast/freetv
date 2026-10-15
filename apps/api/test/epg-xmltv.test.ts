import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseXmltvString, parseXmltvTime, parseXmltvFile, XmltvParser } from "../src/epg/xmltv.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = fs.readFileSync(path.join(here, "fixtures", "sample-guide.xml"), "utf8");
const TEN_UTC = 1792058400; // 2026-10-15T10:00:00Z

describe("parseXmltvTime", () => {
  test("offset form matches known unix time", () => {
    assert.equal(parseXmltvTime("20261015100000 +0000"), 1792058400);
  });
  test("offsets are applied (local time minus offset)", () => {
    assert.equal(parseXmltvTime("20261015110000 +0100"), TEN_UTC);
    assert.equal(parseXmltvTime("20261015090000 -0100"), TEN_UTC);
    assert.equal(parseXmltvTime("20261015103000+05:30"), TEN_UTC - 5 * 3600);
  });
  test("missing offset means UTC", () => {
    assert.equal(parseXmltvTime("20261015100000"), TEN_UTC);
  });
  test("shorter forms are tolerated", () => {
    assert.equal(parseXmltvTime("202610151000"), TEN_UTC);
    assert.equal(parseXmltvTime("2026101510"), TEN_UTC);
    assert.equal(parseXmltvTime("20261015"), TEN_UTC - 10 * 3600);
  });
  test("garbage gives null", () => {
    assert.equal(parseXmltvTime("not a time"), null);
    assert.equal(parseXmltvTime(""), null);
    assert.equal(parseXmltvTime(undefined), null);
    assert.equal(parseXmltvTime("20261315100000"), null);
  });
});

describe("parseXmltvString", () => {
  const progs = parseXmltvString(sample);

  test("sample guide yields 3 programmes", () => {
    assert.equal(progs.length, 3);
  });

  test("first programme has title, description, category", () => {
    assert.deepEqual(progs[0], {
      channel: "BBCNews.uk",
      start_ts: 1792058400,
      stop_ts: 1792062000,
      title: "BBC News at Ten",
      description: "The latest national and international news.",
      category: "News",
      icon: null,
    });
  });

  test("missing desc/category become null", () => {
    assert.equal(progs[1].title, "Newsday");
    assert.equal(progs[1].description, null);
    assert.equal(progs[1].category, null);
    assert.equal(progs[1].start_ts, 1792062000);
  });

  test("ID@FEED maps to ID and icon src is captured", () => {
    assert.equal(progs[2].channel, "CNN.us");
    assert.equal(progs[2].title, "CNN Newsroom");
    assert.equal(progs[2].icon, "https://example.com/icon.png");
    assert.equal(progs[2].stop_ts, 1792063800); // 11:30Z
  });

  test("stop <= start is skipped", () => {
    const xml = `<tv><programme start="20261015100000 +0000" stop="20261015100000 +0000" channel="A"><title>x</title></programme>
      <programme start="20261015110000 +0000" stop="20261015100000 +0000" channel="A"><title>y</title></programme></tv>`;
    assert.equal(parseXmltvString(xml).length, 0);
  });

  test("only the first title/desc/category/icon are kept", () => {
    const xml = `<tv><programme start="20261015100000 +0000" stop="20261015110000 +0000" channel="A">
      <title lang="en">First</title><title lang="fr">Second</title><desc>d1</desc><desc>d2</desc>
      <category>News</category><category>Other</category><icon src="i1"/><icon src="i2"/></programme></tv>`;
    const [p] = parseXmltvString(xml);
    assert.equal(p.title, "First");
    assert.equal(p.description, "d1");
    assert.equal(p.category, "News");
    assert.equal(p.icon, "i1");
  });

  test("entities decode and text split across writes is joined", () => {
    const xml = `<tv><programme start="20261015100000 +0000" stop="20261015110000 +0000" channel="A"><title>Tom &amp; Jerry</title></programme></tv>`;
    const out: string[] = [];
    const p = new XmltvParser((prog) => out.push(prog.title));
    for (let i = 0; i < xml.length; i += 7) p.write(xml.slice(i, i + 7));
    p.end();
    assert.deepEqual(out, ["Tom & Jerry"]);
  });

  test("truncated document throws", () => {
    assert.throws(() => parseXmltvString(sample.slice(0, sample.length - 20)), /truncated|no <tv>/);
  });
});

describe("parseXmltvFile", () => {
  test("streams a file from disk and returns the count", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "freetv-xmltv-"));
    try {
      const file = path.join(dir, "guide.xml");
      fs.writeFileSync(file, sample);
      const got: string[] = [];
      const n = await parseXmltvFile(file, (p) => got.push(p.channel));
      assert.equal(n, 3);
      assert.deepEqual(got, ["BBCNews.uk", "BBCNews.uk", "CNN.us"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
