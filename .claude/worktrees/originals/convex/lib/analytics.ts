/**
 * Server-side PostHog capture. Reads POSTHOG_KEY / POSTHOG_HOST (with VITE_*
 * fallback). No-ops silently when unconfigured. Fire-and-forget — never blocks
 * or throws into the caller.
 */

export type CaptureInput = {
  event: string;
  distinctId: string;
  properties?: Record<string, unknown>;
  timestamp?: Date;
};

function readConfig(): { apiKey: string; host: string } | null {
  const apiKey =
    process.env.POSTHOG_KEY ||
    process.env.VITE_POSTHOG_KEY ||
    "";
  const host = (
    process.env.POSTHOG_HOST ||
    process.env.VITE_POSTHOG_HOST ||
    "https://us.i.posthog.com"
  ).replace(/\/+$/, "");
  if (!apiKey) return null;
  return { apiKey, host };
}

export async function captureEvent(input: CaptureInput): Promise<void> {
  const cfg = readConfig();
  if (!cfg) return;
  try {
    const body = JSON.stringify({
      api_key: cfg.apiKey,
      event: input.event,
      distinct_id: input.distinctId,
      properties: {
        $lib: "boop-server",
        $process_person_profile: false,
        ...(input.properties ?? {}),
      },
      timestamp: (input.timestamp ?? new Date()).toISOString(),
    });
    const res = await fetch(`${cfg.host}/capture/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    // PostHog returns 200 with { status: 1 } on success.
    if (!res.ok && process.env.POSTHOG_DEBUG) {
      console.warn(`[posthog] capture ${input.event} -> ${res.status}`);
    }
  } catch (err) {
    if (process.env.POSTHOG_DEBUG) {
      console.warn("[posthog] capture failed", err);
    }
  }
}

/**
 * Stable, daily-rotating anonymous id for a visitor. Same IP+UA on the same
 * UTC day -> same distinct_id. No cross-day linkage, so no long-term tracking.
 */
export async function anonDistinctId(ip: string, ua: string, now: Date = new Date()): Promise<string> {
  const day = now.toISOString().slice(0, 10);
  const input = `${ip}|${ua}|${day}`;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `anon_${hex.slice(0, 24)}`;
}
