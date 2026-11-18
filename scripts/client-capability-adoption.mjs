#!/usr/bin/env node
/**
 * Prints how many recently seen builds can read an author DID that lists
 * #orig-1 under capabilityDelegation/capabilityInvocation (plans/002 D13,
 * #286 P2b). Read-only: it runs the internal query clientCapabilities:adoption.
 *
 * Usage: node scripts/client-capability-adoption.mjs [--days 7,30] [convex run flags]
 *   node scripts/client-capability-adoption.mjs            the deployment in .env.local
 *   node scripts/client-capability-adoption.mjs --prod     production
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const percent = ({ total, withCapability, share }) =>
  share === null ? 'none seen' : `${(share * 100).toFixed(1)}% (${withCapability} of ${total})`;

export function formatAdoption(result) {
  const lines = [`Builds declaring "${result.capability}", as of ${new Date(result.generatedAt).toISOString()}`];
  for (const window of result.windows) {
    lines.push('', `Last ${window.days} days`);
    lines.push(`  accounts with every platform ready: ${percent(window.accounts)}`);
    lines.push(`  installs (account and platform):    ${percent(window.installs)}`);
    for (const [platform, tally] of Object.entries(window.byPlatform).sort()) {
      lines.push(`    ${`${platform}:`.padEnd(9)} ${percent(tally)}`);
    }
  }
  const { accounts, withoutCapability } = result.persistentSessions;
  lines.push('', `Native sessions that never expire: ${accounts} accounts, ${withoutCapability} with no native build reporting the capability`);
  lines.push('  (a build from before reporting stays silent until it signs in again, so the windows above miss it)');
  if (result.truncated) lines.push('', 'WARNING: more rows than one query reads; these numbers are a partial count.');
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flags = process.argv.slice(2);
  const at = flags.indexOf('--days');
  const days = at < 0 ? [7, 30] : flags.splice(at, 2)[1]?.split(',').map(Number) ?? [];
  if (!days.length || days.some(n => !(n > 0))) {
    console.error('--days takes a comma-separated list of positive numbers, e.g. --days 7,30');
    process.exit(1);
  }
  const output = execFileSync('npx', ['convex', 'run', ...flags, 'clientCapabilities:adoption', JSON.stringify({ days })], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
  });
  console.log(formatAdoption(JSON.parse(output)));
}
