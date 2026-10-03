#!/usr/bin/env bun
/**
 * Configure CORS on the Railway Bucket so the browser can PUT/GET directly
 * via presigned URLs. Required once per bucket, per environment.
 *
 * Allows: any origin (since presigned URLs already gate access), PUT/GET/HEAD,
 * common headers, and a 3000s preflight cache.
 *
 * Usage: bun scripts/bucket-set-cors.mjs
 */
import { AwsClient } from "aws4fetch";

const name = process.env.BOOP_BUCKET_NAME;
const accessKeyId = process.env.BOOP_BUCKET_ACCESS_KEY_ID;
const secretAccessKey = process.env.BOOP_BUCKET_SECRET_ACCESS_KEY;
const endpoint = process.env.BOOP_BUCKET_ENDPOINT ?? "https://storage.railway.app";
const region = process.env.BOOP_BUCKET_REGION ?? "auto";

if (!name || !accessKeyId || !secretAccessKey) {
  throw new Error("BOOP_BUCKET_* env vars must be set");
}

const aws = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region });

const host = new URL(endpoint).host;
const corsXml = `<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>*</AllowedOrigin>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <MaxAgeSeconds>3000</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>`;

const url = `https://${name}.${host}/?cors`;
const md5 = await md5Base64(corsXml);

console.log("→ PUT", url);
const res = await aws.fetch(url, {
  method: "PUT",
  headers: {
    "content-type": "application/xml",
    "content-md5": md5,
  },
  body: corsXml,
});
const text = await res.text();
console.log(`status: ${res.status}`);
if (text) console.log(text);
if (!res.ok) process.exit(1);

console.log("→ GET", url);
const getRes = await aws.fetch(url, { method: "GET" });
console.log(`status: ${getRes.status}`);
console.log(await getRes.text());

async function md5Base64(s) {
  const hash = await crypto.subtle.digest("MD5", new TextEncoder().encode(s)).catch(() => null);
  if (hash) {
    return Buffer.from(new Uint8Array(hash)).toString("base64");
  }
  // Fallback if SubtleCrypto doesn't expose MD5 in this runtime.
  const { createHash } = await import("node:crypto");
  return createHash("md5").update(s).digest("base64");
}
