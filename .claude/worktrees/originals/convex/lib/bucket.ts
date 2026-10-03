import { AwsClient } from "aws4fetch";

type BucketConfig = {
  name: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  region: string;
};

function readConfig(): BucketConfig {
  const name = process.env.BOOP_BUCKET_NAME;
  const accessKeyId = process.env.BOOP_BUCKET_ACCESS_KEY_ID;
  const secretAccessKey = process.env.BOOP_BUCKET_SECRET_ACCESS_KEY;
  const endpoint = process.env.BOOP_BUCKET_ENDPOINT ?? "https://storage.railway.app";
  const region = process.env.BOOP_BUCKET_REGION ?? "auto";
  if (!name) throw new Error("BOOP_BUCKET_NAME is not set");
  if (!accessKeyId) throw new Error("BOOP_BUCKET_ACCESS_KEY_ID is not set");
  if (!secretAccessKey) throw new Error("BOOP_BUCKET_SECRET_ACCESS_KEY is not set");
  return { name, accessKeyId, secretAccessKey, endpoint, region };
}

function client(cfg: BucketConfig = readConfig()) {
  return {
    aws: new AwsClient({
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      service: "s3",
      region: cfg.region,
    }),
    cfg,
  };
}

function objectUrl(cfg: BucketConfig, key: string): string {
  const host = new URL(cfg.endpoint).host;
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `https://${cfg.name}.${host}/${encoded}`;
}

export async function presignPut(
  key: string,
  options: { contentType?: string; expiresSec?: number } = {}
): Promise<string> {
  const { aws, cfg } = client();
  const url = new URL(objectUrl(cfg, key));
  url.searchParams.set("X-Amz-Expires", String(options.expiresSec ?? 3600));
  const headers: Record<string, string> = {};
  if (options.contentType) headers["content-type"] = options.contentType;
  const signed = await aws.sign(url.toString(), {
    method: "PUT",
    headers,
    aws: { signQuery: true },
  });
  return signed.url;
}

export async function presignGet(
  key: string,
  options: { expiresSec?: number } = {}
): Promise<string> {
  const { aws, cfg } = client();
  const url = new URL(objectUrl(cfg, key));
  url.searchParams.set("X-Amz-Expires", String(options.expiresSec ?? 3600));
  const signed = await aws.sign(url.toString(), {
    method: "GET",
    aws: { signQuery: true },
  });
  return signed.url;
}

export type HeadResult = {
  exists: boolean;
  contentLength?: number;
  contentType?: string;
  etag?: string;
};

export async function headObject(key: string): Promise<HeadResult> {
  const { aws, cfg } = client();
  const res = await aws.fetch(objectUrl(cfg, key), { method: "HEAD" });
  if (res.status === 404) return { exists: false };
  if (!res.ok) throw new Error(`HEAD ${key} failed: ${res.status}`);
  return {
    exists: true,
    contentLength: Number(res.headers.get("content-length") ?? 0) || undefined,
    contentType: res.headers.get("content-type") ?? undefined,
    etag: res.headers.get("etag")?.replace(/^"|"$/g, "") ?? undefined,
  };
}

export async function deleteObject(key: string): Promise<void> {
  const { aws, cfg } = client();
  const res = await aws.fetch(objectUrl(cfg, key), { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`DELETE ${key} failed: ${res.status}`);
  }
}

function byteLengthOf(body: BodyInit): number {
  if (typeof body === "string") return new TextEncoder().encode(body).byteLength;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (body instanceof Blob) return body.size;
  throw new Error("Unsupported body type for bucket putObject");
}

export async function putObject(
  key: string,
  body: BodyInit,
  options: { contentType?: string } = {}
): Promise<void> {
  const { aws, cfg } = client();
  const headers: Record<string, string> = {
    "content-length": String(byteLengthOf(body)),
  };
  if (options.contentType) headers["content-type"] = options.contentType;
  const res = await aws.fetch(objectUrl(cfg, key), {
    method: "PUT",
    body,
    headers,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PUT ${key} failed: ${res.status} ${text}`);
  }
}

export async function getObjectBody(key: string): Promise<Blob> {
  const { aws, cfg } = client();
  const res = await aws.fetch(objectUrl(cfg, key), { method: "GET" });
  if (!res.ok) throw new Error(`GET ${key} failed: ${res.status}`);
  return await res.blob();
}

export function bucketKey(...parts: string[]): string {
  return parts
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}
