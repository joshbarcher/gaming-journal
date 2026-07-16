import { sveltekit }             from '@sveltejs/kit/vite';
import { svelte }                from '@sveltejs/vite-plugin-svelte';
import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath }         from 'node:url';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '')

    // Mirror what `node --env-file .env` does in production:
    // inject all .env variables into process.env so server code can use them.
    for (const [k, v] of Object.entries(env)) {
        process.env[k] ??= v
    }

    const isTest = !!process.env.VITEST

    // Vite's dev server uses Node's http.Server with a 5s keepAliveTimeout
    // default — same stale-connection problem as production. Fix it via plugin.
    const keepAlivePlugin = {
        name: 'configure-server-keep-alive',
        configureServer(server) {
            server.httpServer?.once('listening', () => {
                if (server.httpServer) {
                    server.httpServer.keepAliveTimeout = 10 * 60 * 1_000
                    server.httpServer.headersTimeout   = 10 * 60 * 1_000 + 1_000
                }
            })
        },
    }

    return {
        plugins: [isTest ? svelte() : sveltekit(), keepAlivePlugin],
        resolve:  isTest
            ? {
                conditions: ['browser'],
                // The bare svelte() plugin doesn't know SvelteKit's aliases —
                // wire $lib up manually so component tests can import code that uses it.
                // $contracts mirrors the kit.alias in svelte.config.js; $app/navigation
                // points at a test stub (tests vi.mock it, but the import must resolve).
                alias: {
                    $lib:              fileURLToPath(new URL('./src/lib', import.meta.url)),
                    $contracts:        fileURLToPath(new URL('./contracts', import.meta.url)),
                    '$app/navigation': fileURLToPath(new URL('./src/tests/mocks/app-navigation.ts', import.meta.url)),
                },
            }
            : undefined,
        server:   { port: parseInt(env.PORT) || 5173 },
        test: {
            environment: 'jsdom',
            setupFiles:  ['src/tests/setup.ts'],
            include:     ['src/**/*.test.{js,ts}'],
            exclude:     ['src/tests/e2e/**', 'node_modules/**'],
            coverage: {
                provider: 'v8',
                reporter: ['text', 'html', 'json-summary'],
                include:  ['src/lib/**'],
                // vendor/ is versioned drop-in code we don't own — not ours to cover.
                exclude:  ['src/lib/**/*.svelte', 'src/lib/js/vendor/**', 'src/tests/**'],
            },
        },
    }
})
