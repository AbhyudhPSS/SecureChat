/**
 * Minimal Prometheus-style metrics. Intentionally dependency-free: a few process
 * gauges + HTTP counters exposed at GET /metrics for scraping. Swap for
 * prom-client + OpenTelemetry tracing when wiring real observability infra.
 */

const counters = new Map<string, number>();

export function incr(name: string, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by);
}

export function renderMetrics(): string {
  const mem = process.memoryUsage();
  const lines: string[] = [
    '# HELP securechat_uptime_seconds Process uptime in seconds.',
    '# TYPE securechat_uptime_seconds gauge',
    `securechat_uptime_seconds ${process.uptime().toFixed(0)}`,
    '# HELP securechat_resident_memory_bytes Resident set size.',
    '# TYPE securechat_resident_memory_bytes gauge',
    `securechat_resident_memory_bytes ${mem.rss}`,
  ];
  for (const [name, value] of counters) {
    lines.push(`# TYPE ${name} counter`, `${name} ${value}`);
  }
  return lines.join('\n') + '\n';
}
