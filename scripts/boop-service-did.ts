#!/usr/bin/env bun
/**
 * Owner-run: create, rotate and publish the Boop service did:webvh, the
 * identity that countersigns action-record receipts (#286 P3, plans/002 D11).
 * See docs/service-did.md before running any of it.
 *
 *   bun scripts/boop-service-did.ts create --domain boop.ad [--wallet-id <id>] [--log service-did.jsonl] --yes
 *   bun scripts/boop-service-did.ts rotate --wallet-id <id> [--log service-did.jsonl] --yes
 *   bun scripts/boop-service-did.ts show [--log service-did.jsonl]
 *   bun scripts/boop-service-did.ts publish [--log service-did.jsonl] [-- <npx convex run flags, e.g. --prod>]
 *
 * `create` and `rotate` create keys in, and sign with, the Turnkey PARENT org,
 * using TURNKEY_OWNER_API_PUBLIC_KEY, TURNKEY_OWNER_API_PRIVATE_KEY and
 * TURNKEY_ORGANIZATION_ID from the environment: the owner's credentials, not
 * the ones Convex holds. Without --yes they only say what they would do.
 * `publish` hands the log to the Convex deployment `npx convex` is pointed at.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { SERVICE_DID_PATH, SERVICE_UPDATE_KEY_PATH, currentReceiptKey, receiptKeyPath, type ServiceReceiptKey } from "../shared/serviceDid";
import { mintServiceDid, rotateServiceDid, turnkeyAddress, turnkeyServiceKeyBackend } from "./lib/service-did";

const [command, ...rest] = process.argv.slice(2);
const split = rest.indexOf("--");
const own = split === -1 ? rest : rest.slice(0, split);
const passthrough = split === -1 ? [] : rest.slice(split + 1);
const flag = (name: string) => own.includes(`--${name}`);
const option = (name: string) => {
  const at = own.indexOf(`--${name}`);
  return at !== -1 && own[at + 1] && !own[at + 1].startsWith("--") ? own[at + 1] : undefined;
};
const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const logPath = option("log") ?? "service-did.jsonl";

function ownerCredentials() {
  const apiPublicKey = process.env.TURNKEY_OWNER_API_PUBLIC_KEY;
  const apiPrivateKey = process.env.TURNKEY_OWNER_API_PRIVATE_KEY;
  const organizationId = process.env.TURNKEY_ORGANIZATION_ID;
  if (!apiPublicKey || !apiPrivateKey || !organizationId) {
    return fail("Set TURNKEY_OWNER_API_PUBLIC_KEY, TURNKEY_OWNER_API_PRIVATE_KEY and TURNKEY_ORGANIZATION_ID (the parent org).");
  }
  return { apiPublicKey, apiPrivateKey, organizationId };
}

function describe(log: ServiceReceiptKey) {
  console.log(`Service DID:   ${log.did}`);
  console.log(`Version:       ${log.versionId}`);
  console.log(`Receipt key:   ${log.verificationMethod}`);
  console.log(`  multikey:    ${log.publicKeyMultibase}`);
  console.log(`  Turnkey address (for the signer policy): ${turnkeyAddress(log.publicKeyMultibase)}`);
  console.log(`  wallet path: ${receiptKeyPath(log.number)}`);
}

function readLog(): string {
  if (!existsSync(logPath)) fail(`${logPath} does not exist.`);
  return readFileSync(logPath, "utf8");
}

switch (command) {
  case "create": {
    const domain = option("domain") ?? fail("--domain is required (the deployment's WEBVH_DOMAIN, e.g. boop.ad).");
    if (existsSync(logPath)) fail(`${logPath} already exists. A second genesis is a different DID; use rotate, or move the file away.`);
    const credentials = ownerCredentials();
    const walletId = option("wallet-id");
    console.log(`Parent org ${credentials.organizationId}: ${walletId ? `use wallet ${walletId}` : 'create wallet "boop-service-did"'},`);
    console.log(`  with Ed25519 accounts ${SERVICE_UPDATE_KEY_PATH} (update key) and ${receiptKeyPath(1)} (receipt key 1),`);
    console.log(`  and sign the genesis of did:webvh:<scid>:${encodeURIComponent(domain)}:${SERVICE_DID_PATH} with the update key.`);
    if (!flag("yes")) fail("Nothing was done. Re-run with --yes to create the keys and sign.");
    const backend = turnkeyServiceKeyBackend(credentials, { walletId });
    const minted = await mintServiceDid(backend, { domain });
    writeFileSync(logPath, `${minted.jsonl}\n`, { flag: "wx" });
    console.log(`\nWrote ${logPath}. Turnkey wallet: ${backend.walletId()} (keep it for rotate).`);
    describe(minted);
    console.log(`\nNext: bun scripts/boop-service-did.ts publish --log ${logPath}`);
    break;
  }
  case "rotate": {
    const walletId = option("wallet-id") ?? fail("--wallet-id is required (the service wallet create reported).");
    const jsonl = readLog();
    const current = currentReceiptKey(jsonl);
    if ("problems" in current) fail(`${logPath} is not a Boop service DID: ${current.problems.join("; ")}`);
    else {
      const credentials = ownerCredentials();
      console.log(`Parent org ${credentials.organizationId}, wallet ${walletId}: create the Ed25519 account ${receiptKeyPath(current.number + 1)}`);
      console.log(`  and sign a new version of ${current.did} replacing #receipt-${current.number} with #receipt-${current.number + 1}.`);
      if (!flag("yes")) fail("Nothing was done. Re-run with --yes to create the key and sign.");
      const rotated = await rotateServiceDid(turnkeyServiceKeyBackend(credentials, { walletId }), jsonl);
      writeFileSync(logPath, `${rotated.jsonl}\n`);
      console.log(`\nUpdated ${logPath}.`);
      describe(rotated);
      console.log("\nNext: allow the receipt signer to use the new key (docs/service-did.md), then publish.");
    }
    break;
  }
  case "show": {
    const current = currentReceiptKey(readLog());
    if ("problems" in current) fail(`${logPath} is not a Boop service DID: ${current.problems.join("; ")}`);
    else describe(current);
    break;
  }
  case "publish": {
    const jsonl = readLog().replace(/\n+$/, "");
    const current = currentReceiptKey(jsonl);
    if ("problems" in current) fail(`${logPath} is not a Boop service DID: ${current.problems.join("; ")}`);
    else {
      describe(current);
      console.log(`\nnpx convex run serviceDid:publish <log> ${passthrough.join(" ")}`);
      const result = spawnSync("npx", ["convex", "run", "serviceDid:publish", JSON.stringify({ log: jsonl }), ...passthrough], { stdio: "inherit" });
      process.exit(result.status ?? 1);
    }
    break;
  }
  default:
    fail("Usage: bun scripts/boop-service-did.ts <create|rotate|show|publish> [options]. See the header of this file and docs/service-did.md.");
}
