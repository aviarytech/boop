#!/usr/bin/env bun
// Independently verifies exported action records without trusting boop's server.
//
// Usage: bun scripts/verify-action-records.mjs records.json [--resolve] [<authorDid>=<source>]...
//   records.json  the body of GET /api/v1/action-records, or a bare array of records
//   <source>      a did.jsonl file (the author's did:webvh log), or a key to pin:
//                 a Multikey (z6Mk…), a did:key, or a base58 Ed25519 public key
//   --resolve     fetch each author's did.jsonl from the domain the DID names
//
// A DID log, fetched or given, is validated here with didwebvh-ts (every entry
// signed by the update keys before it, resolves to its last entry) and must
// have the author-DID shape (shared/authorDid.ts) before its #orig-1 key is
// used. Pinned keys skip all that: you are vouching for the key yourself.
import { readFileSync } from 'node:fs';
import { describeActionRecord, verifyActionRecord } from '../shared/actionRecord.ts';
import { checkDidLog } from '../convex/lib/authorDidLog.ts';
import { authorLogProblems } from '../shared/authorDid.ts';

const argv = process.argv.slice(2);
const resolve = argv.includes('--resolve');
const [file, ...pins] = argv.filter(arg => arg !== '--resolve');
if (!file || pins.some(pin => !pin.includes('='))) {
  console.error('usage: bun scripts/verify-action-records.mjs records.json [--resolve] [<authorDid>=<did.jsonl|publicKey>]...');
  process.exit(2);
}
const trustedKeys = {};
const logFiles = {};
for (const pin of pins) {
  const at = pin.lastIndexOf('=');
  const did = pin.slice(0, at), source = pin.slice(at + 1);
  if (source.endsWith('.jsonl')) logFiles[did] = source;
  else (trustedKeys[did] ??= []).push(source);
}

function didLogUrl(did) {
  const parts = did.split(':');
  if (parts.length < 5 || parts[1] !== 'webvh') throw new Error(`${did} is not a did:webvh`);
  const domain = decodeURIComponent(parts[3]);
  const scheme = /^(localhost|127\.0\.0\.1)(:|$)/.test(domain) ? 'http' : 'https';
  return `${scheme}://${domain}/${parts.slice(4).join(':')}/did.jsonl`;
}

/** Validated author DID logs by DID; a log that fails validation is reported and not used. */
const logs = new Map();
async function authorLog(did) {
  if (logs.has(did)) return logs.get(did);
  const pending = (async () => {
    let jsonl;
    if (logFiles[did]) jsonl = readFileSync(logFiles[did], 'utf8');
    else if (resolve) {
      const response = await fetch(didLogUrl(did));
      if (!response.ok) throw new Error(`${didLogUrl(did)} answered ${response.status}`);
      jsonl = await response.text();
    } else return null;
    const checked = await checkDidLog(jsonl);
    if (checked.did !== did) throw new Error(`the log resolves to ${checked.did}`);
    const entries = jsonl.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
    const problems = authorLogProblems(entries);
    if (problems.length > 0) throw new Error(`not an author DID log: ${problems.join('; ')}`);
    return jsonl;
  })().catch(error => { console.error(`${did}: DID log rejected: ${error.message}`); return null; });
  logs.set(did, pending);
  return pending;
}

const parsed = JSON.parse(readFileSync(file, 'utf8'));
let rejected = 0;
for (const record of Array.isArray(parsed) ? parsed : parsed.records) {
  const described = describeActionRecord(record);
  const result = await verifyActionRecord(record, { trustedKeys, resolveDidLog: authorLog });
  if (!result.verified) rejected++;
  const attested = described?.credential ? `${described.credential.kind}:${described.credential.id}` : '-';
  console.log([record._id ?? record.digest, ...(result.verified
    ? ['verified', result.payload.action, result.author.did, `${result.author.verificationMethod.split('#')[1]}@${result.author.versionId}`, `attested ${attested}`]
    : ['REJECTED', result.reason, described?.action ?? '?', described?.ownerDid ?? '?'])].join('\t'));
}
process.exit(rejected > 0 ? 1 : 0);
