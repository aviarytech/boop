import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { resolve } from 'path'
import { sentryVitePlugin } from '@sentry/vite-plugin'

function buildServiceWorker() {
  return {
    name: 'build-service-worker',
    async writeBundle() {
      // Build the service worker using esbuild (available via Vite)
      // Inject a build timestamp so the SW file changes on every deploy,
      // ensuring the browser detects it as a new version
      const { build } = await import('esbuild')
      await build({
        entryPoints: [resolve(__dirname, 'src/workers/service-worker.ts')],
        bundle: true,
        outfile: resolve(__dirname, 'dist/sw.js'),
        format: 'iife',
        target: 'es2020',
        minify: true,
        define: {
          '__BUILD_TIMESTAMP__': JSON.stringify(new Date().toISOString()),
        },
      })
    },
    configureServer(server: { middlewares: { use: (path: string, handler: (req: unknown, res: { setHeader: (name: string, value: string) => void; end: (content: string) => void }, next: () => void) => void) => void } }) {
      // Serve the service worker during development
      server.middlewares.use('/sw.js', async (_req, res, next) => {
        try {
          const { build } = await import('esbuild')
          const result = await build({
            entryPoints: [resolve(__dirname, 'src/workers/service-worker.ts')],
            bundle: true,
            write: false,
            format: 'iife',
            target: 'es2020',
            define: {
              '__BUILD_TIMESTAMP__': JSON.stringify(new Date().toISOString()),
            },
          })
          res.setHeader('Content-Type', 'application/javascript')
          res.end(result.outputFiles[0].text)
        } catch {
          next()
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    nodePolyfills({
      // Enable polyfills for Node.js modules used by @originals/sdk
      include: ['crypto', 'buffer', 'path', 'stream', 'util'],
      globals: {
        Buffer: true,
        process: true,
      },
    }),
    buildServiceWorker(),
    // Upload source maps to Sentry on production builds (no-op if env vars not set)
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      // Only upload source maps when SENTRY_AUTH_TOKEN is present
      disable: !process.env.SENTRY_AUTH_TOKEN,
      sourcemaps: {
        filesToDeleteAfterUpload: ['dist/**/*.map'],
      },
    }),
  ],
  optimizeDeps: {
    // Force pre-bundling of problematic dependencies
    include: ['@originals/sdk'],
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // Split vendor chunks for better caching
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'convex-vendor': ['convex'],
          // @originals/sdk is still used client-side for DID generation
          'originals-sdk': ['@originals/sdk'],
          // Note: @originals/auth is only used server-side (Convex), not bundled client-side
        },
      },
    },
  },
})
