// TRACK ADMIN: Prometheus text-format registry for GET /metrics and per-request HTTP metrics.
// Same shape as apps/proxy/src/metrics.ts (copied, not shared). Counters, gauges, one unlabeled histogram.

function escapeLabel(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function labelString(names: readonly string[], labels: Record<string, string>): string {
  return names.map((n) => `${n}="${escapeLabel(labels[n] ?? "")}"`).join(",");
}

export interface Metric {
  render(): string[];
}

export class Counter implements Metric {
  private readonly values = new Map<string, number>();

  constructor(
    readonly name: string,
    readonly help: string,
    private readonly labelNames: readonly string[] = [],
  ) {
    if (labelNames.length === 0) this.values.set("", 0);
  }

  inc(labels: Record<string, string> = {}, by = 1): void {
    const key = labelString(this.labelNames, labels);
    this.values.set(key, (this.values.get(key) ?? 0) + by);
  }

  get size(): number {
    return this.values.size;
  }

  render(): string[] {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [key, value] of this.values) lines.push(key ? `${this.name}{${key}} ${value}` : `${this.name} ${value}`);
    return lines;
  }
}

export class Gauge implements Metric {
  private value = 0;

  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

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

  constructor(
    readonly name: string,
    readonly help: string,
    private readonly bounds: readonly number[],
  ) {
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

/** Route labels are Fastify route templates, so they are bounded already; this caps them anyway. */
export const MAX_ROUTE_LABELS = 100;

/** HTTP request metrics. One instance per app; `observe` is called from an onResponse hook. */
export class HttpMetrics {
  readonly requests = new Counter("freetv_http_requests_total", "HTTP requests by route template and status.", ["route", "status"]);
  readonly duration = new Histogram(
    "freetv_http_request_duration_seconds",
    "HTTP request duration from receipt to response end.",
    [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  );
  private readonly routes = new Set<string>();

  observe(routeTemplate: string | undefined, status: number, seconds: number): void {
    let route = routeTemplate ?? "unmatched";
    if (!this.routes.has(route)) {
      if (this.routes.size >= MAX_ROUTE_LABELS) route = "other";
      else this.routes.add(route);
    }
    this.requests.inc({ route, status: String(status) });
    this.duration.observe(seconds);
  }
}

/** Render the given metrics as Prometheus text (trailing newline included). */
export function renderMetrics(metrics: readonly Metric[]): string {
  return metrics.flatMap((m) => m.render()).join("\n") + "\n";
}
