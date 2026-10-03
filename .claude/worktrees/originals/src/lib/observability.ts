type MetricValue = number;

type MetricTags = Record<string, string | number | boolean | undefined>;

export interface ObservabilityMetricEvent {
  name: string;
  type: "counter" | "gauge" | "histogram";
  value: MetricValue;
  tags?: MetricTags;
  ts: number;
}

declare global {
  interface Window {
    __pooObservabilitySink?: (event: ObservabilityMetricEvent) => void;
  }
}

function sanitizeTags(tags?: MetricTags): Record<string, string> | undefined {
  if (!tags) return undefined;

  const normalized = Object.entries(tags).reduce<Record<string, string>>((acc, [k, v]) => {
    if (v === undefined || v === null) return acc;
    acc[k] = String(v);
    return acc;
  }, {});

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function emitMetric(event: ObservabilityMetricEvent): void {
  try {
    window.__pooObservabilitySink?.(event);
  } catch (err) {
    console.warn("[obs] failed to emit metric event", err);
  }

  // Runnable baseline: metrics are always visible in browser logs for collection.
  console.info("[obs]", JSON.stringify(event));
}

export function incrementMetric(name: string, tags?: MetricTags, value = 1): void {
  emitMetric({
    name,
    type: "counter",
    value,
    tags: sanitizeTags(tags),
    ts: Date.now(),
  });
}

export function recordLatencyMs(name: string, value: number, tags?: MetricTags): void {
  emitMetric({
    name,
    type: "histogram",
    value,
    tags: sanitizeTags(tags),
    ts: Date.now(),
  });
}

export function setGaugeMetric(name: string, value: number, tags?: MetricTags): void {
  emitMetric({
    name,
    type: "gauge",
    value,
    tags: sanitizeTags(tags),
    ts: Date.now(),
  });
}
