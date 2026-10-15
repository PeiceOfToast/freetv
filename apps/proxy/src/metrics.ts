// Minimal Prometheus text-format registry: counters, gauges and one histogram. No labels on histograms.

function escapeLabel(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function labelString(names: readonly string[], labels: Record<string, string>): string {
  return names.map((n) => `${n}="${escapeLabel(labels[n] ?? "")}"`).join(",");
}

export interface Metric { render(): string[] }

export class Counter implements Metric {
  private readonly values = new Map<string, number>();

  constructor(readonly name: string, readonly help: string, private readonly labelNames: readonly string[] = []) {
    if (labelNames.length === 0) this.values.set("", 0);
  }

  inc(labels: Record<string, string> = {}, by = 1): void {
    const key = labelString(this.labelNames, labels);
    this.values.set(key, (this.values.get(key) ?? 0) + by);
  }

  render(): string[] {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [key, value] of this.values) lines.push(key ? `${this.name}{${key}} ${value}` : `${this.name} ${value}`);
    return lines;
  }
}

export class Gauge implements Metric {
  private value = 0;

  constructor(readonly name: string, readonly help: string) {}

  set(v: number): void {
    this.value = v;
  }

  render(): string[] {
    return [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`, `${this.name} ${this.value}`];
  }
}

export class Histogram implements Metric {
  private readonly counts: number[];
  private sum = 0;
  private count = 0;

  constructor(readonly name: string, readonly help: string, private readonly bounds: readonly number[]) {
    this.counts = new Array<number>(bounds.length).fill(0);
  }

  observe(v: number): void {
    this.sum += v;
    this.count++;
    for (let i = 0; i < this.bounds.length; i++) {
      if (v <= this.bounds[i]) {
        this.counts[i]++;
        break;
      }
    }
  }

  render(): string[] {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    let cumulative = 0;
    this.bounds.forEach((le, i) => {
      cumulative += this.counts[i];
      lines.push(`${this.name}_bucket{le="${le}"} ${cumulative}`);
    });
    lines.push(`${this.name}_bucket{le="+Inf"} ${this.count}`);
    lines.push(`${this.name}_sum ${this.sum}`, `${this.name}_count ${this.count}`);
    return lines;
  }
}

export function createMetrics() {
  const requests = new Counter("freetv_proxy_requests_total", "Requests by kind and final status.", ["kind", "status"]);
  const bytes = new Counter("freetv_proxy_bytes_total", "Bytes relayed, by direction.", ["direction"]);
  const active = new Gauge("freetv_proxy_active_requests", "Requests holding an upstream concurrency slot.");
  const rateLimited = new Counter("freetv_proxy_rate_limited_total", "Requests refused with 429 by the per-IP rate limiter.");
  const upstreamErrors = new Counter("freetv_proxy_upstream_errors_total", "Upstream failures by reason.", ["reason"]);
  const duration = new Histogram(
    "freetv_proxy_request_duration_seconds",
    "Request duration from receipt to response end, including streaming.",
    [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  );
  const all: Metric[] = [requests, bytes, active, rateLimited, upstreamErrors, duration];
  return {
    requests, bytes, active, rateLimited, upstreamErrors, duration,
    render: () => all.flatMap((m) => m.render()).join("\n") + "\n",
  };
}

export type Metrics = ReturnType<typeof createMetrics>;
