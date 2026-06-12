import { defineConfig } from '@playwright/test'

export default defineConfig({
    testDir: 'src/tests/e2e',
    timeout: 15_000,
    use: {
        baseURL: 'http://localhost:8061',
    },
    webServer: {
        command: 'node --env-file .env build/index.js',
        url: 'http://localhost:8061/health',
        reuseExistingServer: true,
        timeout: 10_000,
    },
})
