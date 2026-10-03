// Pure REST client for Cloudflare's Custom Hostnames API.
// No Convex types — only plain values. Easy to unit-test by stubbing globalThis.fetch.

const API_BASE = "https://api.cloudflare.com/client/v4";

export interface CustomHostnameRecord {
  id: string;
  hostname: string;
  status: "pending" | "active" | "blocked" | "moved" | "deleted";
  ssl: {
    status:
      | "initializing"
      | "pending_validation"
      | "pending_issuance"
      | "pending_deployment"
      | "active"
      | "expired"
      | "deleted";
  };
  verification_errors?: string[];
}

interface CfResponse<T> {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result?: T;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function cfFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T | undefined> {
  const token = requireEnv("CLOUDFLARE_API_TOKEN");
  const zone = requireEnv("CLOUDFLARE_ZONE_ID");
  const url = `${API_BASE}/zones/${zone}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const payload = (await response.json()) as CfResponse<T>;
  if (!response.ok || !payload.success) {
    const messages = (payload.errors ?? [])
      .map((e) => e.message)
      .filter(Boolean)
      .join("; ");
    throw new Error(
      messages || `Cloudflare API ${response.status} ${response.statusText}`
    );
  }
  return payload.result;
}

export async function createCustomHostname(
  hostname: string
): Promise<CustomHostnameRecord> {
  const result = await cfFetch<CustomHostnameRecord>("/custom_hostnames", {
    method: "POST",
    body: JSON.stringify({
      hostname,
      ssl: { method: "http", type: "dv" },
    }),
  });
  if (!result) throw new Error("Cloudflare returned no result for createCustomHostname");
  return result;
}

export async function getCustomHostname(
  id: string
): Promise<CustomHostnameRecord> {
  const result = await cfFetch<CustomHostnameRecord>(
    `/custom_hostnames/${id}`,
    { method: "GET" }
  );
  if (!result) throw new Error("Cloudflare returned no result for getCustomHostname");
  return result;
}

export async function deleteCustomHostname(id: string): Promise<void> {
  await cfFetch<unknown>(`/custom_hostnames/${id}`, { method: "DELETE" });
}
