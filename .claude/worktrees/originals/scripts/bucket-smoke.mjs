#!/usr/bin/env bun
/**
 * Round-trip smoke test for Railway Bucket credentials.
 * Reads BOOP_BUCKET_* from .env.local (bun auto-loads it).
 *
 * Usage: bun scripts/bucket-smoke.mjs
 */
import {
  bucketKey,
  deleteObject,
  getObjectBody,
  headObject,
  presignGet,
  presignPut,
  putObject,
} from "../convex/lib/bucket.ts";

const key = bucketKey("_smoke", `${Date.now()}-${crypto.randomUUID()}.txt`);
const body = `hello bucket — ${new Date().toISOString()}`;
const bodyBytes = new TextEncoder().encode(body).length;

console.log("→ PUT", key);
await putObject(key, body, { contentType: "text/plain" });

console.log("→ HEAD", key);
const head = await headObject(key);
console.log("   ", head);
if (!head.exists) throw new Error("HEAD reports object does not exist after PUT");
if (head.contentLength !== bodyBytes) {
  throw new Error(`content-length mismatch: ${head.contentLength} vs ${bodyBytes}`);
}

console.log("→ GET", key);
const blob = await getObjectBody(key);
const text = await blob.text();
if (text !== body) throw new Error(`body mismatch: ${JSON.stringify(text)}`);

console.log("→ presignGet", key);
const getUrl = await presignGet(key, { expiresSec: 60 });
const presignedRes = await fetch(getUrl);
if (!presignedRes.ok) {
  throw new Error(`presigned GET failed: ${presignedRes.status}`);
}
const presignedText = await presignedRes.text();
if (presignedText !== body) {
  throw new Error(`presigned GET body mismatch: ${JSON.stringify(presignedText)}`);
}

console.log("→ presignPut (no upload)", key);
const putUrl = await presignPut(`${key}.presigned`, {
  contentType: "text/plain",
  expiresSec: 60,
});
if (!new URL(putUrl).searchParams.get("X-Amz-Signature")) {
  throw new Error("presignPut returned unsigned URL");
}

console.log("→ DELETE", key);
await deleteObject(key);
const headAfter = await headObject(key);
if (headAfter.exists) throw new Error("object still exists after DELETE");

console.log("✓ Bucket smoke test passed");
