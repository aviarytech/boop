import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { gateway } from 'ai';

export default {
  // Keep Bun and node:test files out of e2e collection.
  tests: 'tests/**/*.e2e.ts',
  timeout: 45_000,
  actionTimeout: 10_000,
  // The Vercel AI Gateway serves the model id and reads AI_GATEWAY_API_KEY, or the OIDC token of a linked Vercel project.
  agents: {
    default: {
      model: gateway('openai/gpt-6-luna-fast'),
      system: 'You are a thorough QA agent. Verify every outcome.',
    },
  },
  targets: [{
    engine: web(),
    app: {
      url: 'http://127.0.0.1:0',
      // Each run owns an isolated dev server on a free port.
      command: {
        executable: 'bun',
        args: ['tests/fixtures/server.mjs', '--port', '{port}'],
        log: '.e2e/logs/app.log',
        // The test-only server supplies a loopback Convex fixture, never a live backend.
      },
    },
  }],
} satisfies E2EConfig;
