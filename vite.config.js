import { sveltekit }             from '@sveltejs/kit/vite';
import { svelte }                from '@sveltejs/vite-plugin-svelte';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '')

    // Mirror what `node --env-file .env` does in production:
    // inject all .env variables into process.env so server code can use them.
    for (const [k, v] of Object.entries(env)) {
        process.env[k] ??= v
    }

    const isTest = !!process.env.VITEST

    return {
        plugins: [isTest ? svelte() : sveltekit()],
        resolve:  isTest ? { conditions: ['browser'] } : undefined,
        server:   { port: parseInt(env.PORT) || 5173 },
        test: {
            environment: 'jsdom',
            setupFiles:  ['src/tests/setup.ts'],
            include:     ['src/**/*.test.{js,ts}'],
            exclude:     ['src/tests/e2e/**', 'node_modules/**'],
            coverage: {
                provider: 'v8',
                include:  ['src/lib/**'],
                exclude:  ['src/lib/**/*.svelte', 'src/tests/**'],
            },
        },
    }
})
