import fs from "node:fs";
import sax from "sax";

export interface Programme {
  channel: string;
  start_ts: number;
  stop_ts: number;
  title: string;
  description: string | null;
  category: string | null;
  icon: string | null;
}

// YYYYMMDD[HH[mm[ss]]] with an optional offset: " +0100", "+01:00", "+01", or none (= UTC).
const TIME_RE = /^\s*(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?\s*(?:([+-])(\d{2}):?(\d{2})?)?\s*$/;

/** Parse an XMLTV timestamp to unix seconds. Returns null when the value is unparseable. */
export function parseXmltvTime(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const m = TIME_RE.exec(raw);
  if (!m) return null;
  const num = (v: string | undefined, d: number) => (v === undefined ? d : Number(v));
  const year = Number(m[1]);
  const month = num(m[2], 1);
  const day = num(m[3], 1);
  const hour = num(m[4], 0);
  const minute = num(m[5], 0);
  const second = num(m[6], 0);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) return null;
  const localMs = Date.UTC(year, month - 1, day, hour, minute, second);
  let offsetSec = 0;
  if (m[7]) {
    const sign = m[7] === "-" ? -1 : 1;
    offsetSec = sign * (Number(m[8]) * 3600 + Number(m[9] ?? 0) * 60);
  }
  return Math.floor(localMs / 1000) - offsetSec;
}

/**
 * Push-based XMLTV parser built on sax. Feed text with write(), then call end().
 * Emits one Programme per <programme> element that has a valid start, a stop after start, and a channel.
 * Only the first <title>, <desc>, <category> and <icon src> of a programme are kept.
 * The channel attribute "ID@FEED" is reduced to "ID".
 */
export class XmltvParser {
  private readonly parser: sax.SAXParser;
  private cur: {
    channel: string;
    start: number | null;
    stop: number | null;
    title?: string;
    description?: string | null;
    category?: string | null;
    icon?: string | null;
  } | null = null;
  private field: "title" | "description" | "category" | null = null;
  private text = "";
  private sawRoot = false;
  private sawRootClose = false;
  programmes = 0;

  constructor(private readonly onProgramme: (p: Programme) => void) {
    // Non-strict sax: tolerant of stray entities and HTML-ish quirks in grabber output.
    this.parser = sax.parser(false, { trim: false, normalize: false });
    // Non-strict sax reports names upper-cased, so normalise tag and attribute names.
    this.parser.onopentag = (node) => {
      const attrs: Record<string, string> = {};
      for (const [k, v] of Object.entries(node.attributes)) attrs[k.toLowerCase()] = v;
      this.open(node.name.toLowerCase(), attrs);
    };
    this.parser.onclosetag = (name) => this.close(name.toLowerCase());
    this.parser.ontext = (t) => {
      if (this.field) this.text += t;
    };
    this.parser.oncdata = (t) => {
      if (this.field) this.text += t;
    };
    this.parser.onerror = (e) => {
      throw e;
    };
  }

  write(chunk: string): void {
    this.parser.write(chunk);
  }

  /** Finish parsing. Throws when the document never reached </tv> (truncated file). */
  end(): void {
    this.parser.close();
    if (!this.sawRoot) throw new Error("XMLTV: no <tv> root element");
    if (!this.sawRootClose) throw new Error("XMLTV: truncated (no closing </tv>)");
  }

  private open(name: string, attrs: Record<string, string>) {
    if (name === "tv") {
      this.sawRoot = true;
      return;
    }
    if (name === "programme") {
      this.cur = {
        channel: (attrs["channel"] ?? "").split("@")[0].trim(),
        start: parseXmltvTime(attrs["start"]),
        stop: parseXmltvTime(attrs["stop"]),
      };
      return;
    }
    if (!this.cur) return;
    const c = this.cur;
    if (name === "title" && c.title === undefined) this.startField("title");
    else if (name === "desc" && c.description === undefined) this.startField("description");
    else if (name === "category" && c.category === undefined) this.startField("category");
    else if (name === "icon" && c.icon === undefined && attrs["src"]) c.icon = attrs["src"];
  }

  private startField(f: "title" | "description" | "category") {
    this.field = f;
    this.text = "";
  }

  private close(name: string) {
    if (name === "tv") {
      this.sawRootClose = true;
      return;
    }
    if (name === "programme") {
      const c = this.cur;
      this.cur = null;
      if (!c || !c.channel || c.start === null || c.stop === null || c.stop <= c.start) return;
      this.programmes++;
      this.onProgramme({
        channel: c.channel,
        start_ts: c.start,
        stop_ts: c.stop,
        title: c.title ?? "",
        description: c.description ?? null,
        category: c.category ?? null,
        icon: c.icon ?? null,
      });
      return;
    }
    if (!this.cur || !this.field) return;
    const value = this.text.trim() || null;
    if (name === "title" && this.field === "title") this.cur.title = this.text.trim();
    else if (name === "desc" && this.field === "description") this.cur.description = value;
    else if (name === "category" && this.field === "category") this.cur.category = value;
    else return;
    this.field = null;
    this.text = "";
  }
}

/** Parse an in-memory XMLTV document (small inputs and tests). */
export function parseXmltvString(xml: string): Programme[] {
  const out: Programme[] = [];
  const p = new XmltvParser((prog) => out.push(prog));
  p.write(xml);
  p.end();
  return out;
}

/**
 * Stream an XMLTV file from disk. Memory stays flat: 256 KB chunks are fed to sax and the
 * event loop yields between chunks so the API keeps serving while a large guide imports.
 */
export async function parseXmltvFile(
  filePath: string,
  onProgramme: (p: Programme) => void,
): Promise<number> {
  const p = new XmltvParser(onProgramme);
  const stream = fs.createReadStream(filePath, { encoding: "utf8", highWaterMark: 256 * 1024 });
  for await (const chunk of stream) {
    p.write(chunk as string);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  p.end();
  return p.programmes;
}
