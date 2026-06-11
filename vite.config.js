import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'path'

export default defineConfig({
    root: 'public',
    plugins: [svelte({ configFile: resolve('svelte.config.js') })],
    server: {
        port: 5173,
        proxy: {
            '/api': 'http://localhost:8061',
            '/relay': 'http://localhost:8061',
            '/health': 'http://localhost:8061',
        }
    },
    build: {
        outDir: '../dist',
        emptyOutDir: true,
    }
})
