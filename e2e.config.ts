import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { gateway } from 'ai';

export default {
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
      url: process.env.APP_URL ?? 'http://127.0.0.1:5173',
      // Reuses a running `bun run dev` instead of starting a second one.
      command: { executable: 'bun', args: ['run', 'dev', '--host', '127.0.0.1', '--port', '{port}', '--strictPort'], log: '.e2e/logs/app.log', reuseExisting: true },
    },
  }],
} satisfies E2EConfig;
