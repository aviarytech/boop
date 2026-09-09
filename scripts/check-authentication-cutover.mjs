import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const evidenceUrl = new URL('../release/authentication-cutover.json', import.meta.url);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

export function checkApproval(record) {
  if (!nonempty(record?.owner) || record.approvedBy !== record.owner
    || !nonempty(record.approvedAt) || !Number.isFinite(Date.parse(record.approvedAt))
    || !nonempty(record.stagingEvidence)) throw new Error('Release owner approval and staging evidence are required');
  for (const client of ['browser', 'ios', 'android', 'integrations']) {
    const inventory = record.clients?.[client];
    if (!nonempty(inventory?.supportedVersions) || !nonempty(inventory?.evidence)) {
      throw new Error(`Deployed ${client} versions and compatibility evidence are required`);
    }
  }
}

export function needsApproval(railway, environment) {
  // Railway gives preview environments the repository PR name. Unknown names fail closed.
  return !railway || !/^(boop-pr-\d+|staging|development)$/i.test(environment ?? '');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (needsApproval(process.argv.includes('--railway'), process.env.RAILWAY_ENVIRONMENT_NAME)) {
      checkApproval(JSON.parse(readFileSync(evidenceUrl, 'utf8')));
    }
  } catch (error) {
    console.error(`Authentication cutover blocked: ${error.message}. See docs/authentication-rollout.md.`);
    process.exitCode = 1;
  }
}
