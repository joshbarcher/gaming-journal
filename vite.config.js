import { sveltekit }             from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '')

    // Mirror what `node --env-file .env` does in production:
    // inject all .env variables into process.env so server code can use them.
    for (const [k, v] of Object.entries(env)) {
        process.env[k] ??= v
    }

    return {
        plugins: [sveltekit()],
        server:  { port: parseInt(env.PORT) || 5173 },
    }
})
