#!/usr/bin/env bun
// Independently verifies exported action records against keys YOU pin. No network.
// Usage: bun scripts/verify-action-records.mjs records.json '<ownerDid>=<publicKey>' [...]
// records.json is the body of GET /api/v1/action-records, or a bare array of records.
// A key may be a Multikey (z6Mk…), a did:key, or a base58 Ed25519 public key.
import { readFileSync } from 'node:fs';
import { verifyActionRecord } from '../shared/actionRecord.ts';

const [file, ...pins] = process.argv.slice(2);
if (!file || pins.length === 0 || pins.some(pin => !pin.includes('='))) {
  console.error("usage: bun scripts/verify-action-records.mjs records.json '<ownerDid>=<publicKey>' [...]");
  process.exit(2);
}
const trustedKeys = {};
for (const pin of pins) {
  const at = pin.lastIndexOf('=');
  (trustedKeys[pin.slice(0, at)] ??= []).push(pin.slice(at + 1));
}

const parsed = JSON.parse(readFileSync(file, 'utf8'));
let rejected = 0;
for (const record of Array.isArray(parsed) ? parsed : parsed.records) {
  const result = await verifyActionRecord(record, { trustedKeys });
  if (!result.verified) rejected++;
  const { payload } = result;
  console.log([record._id ?? record.digest, ...(result.verified
    ? ['verified', payload.action, payload.owner.did, `${payload.credential.kind}:${payload.credential.id}`]
    : ['REJECTED', result.reason])].join('\t'));
}
process.exit(rejected > 0 ? 1 : 0);
