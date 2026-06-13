import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
    preprocess: vitePreprocess(),
    onwarn: (warning, handler) => {
        if (warning.code.startsWith('a11y')) return
        handler(warning)
    },
    kit: {
        adapter: adapter(),
        files: {
            assets: 'public',
        },
    },
};
