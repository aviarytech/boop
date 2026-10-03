type Tags = Record<string, string | number | boolean | undefined>;

function normalize(tags?: Tags): Record<string, string> | undefined {
  if (!tags) return undefined;

  const clean = Object.entries(tags).reduce<Record<string, string>>((acc, [k, v]) => {
    if (v === undefined || v === null) return acc;
    acc[k] = String(v);
    return acc;
  }, {});

  return Object.keys(clean).length ? clean : undefined;
}

export function emitServerMetric(
  name: string,
  type: "counter" | "gauge" | "histogram",
  value: number,
  tags?: Tags,
): void {
  console.info("[obs]", JSON.stringify({
    source: "convex",
    name,
    type,
    value,
    tags: normalize(tags),
    ts: Date.now(),
  }));
}

export async function withMutationObservability<T>(
  mutationName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  emitServerMetric("mutation_total", "counter", 1, { mutationName });

  try {
    const result = await fn();
    emitServerMetric("mutation_latency_ms", "histogram", Date.now() - startedAt, { mutationName });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    emitServerMetric("mutation_error_total", "counter", 1, {
      mutationName,
      errorCode: message.slice(0, 80),
    });
    throw err;
  }
}
