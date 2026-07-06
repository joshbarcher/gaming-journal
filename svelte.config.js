import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
    preprocess: vitePreprocess(),
    onwarn: (warning, handler) => {
        if (warning.code.startsWith('a11y')) return
        handler(warning)
    },
    kit: {
        // BUILD_OUT_DIR lets scripts/build.mjs build into a staging directory
        // and swap it into place atomically once complete - see that file.
        adapter: adapter({ out: process.env.BUILD_OUT_DIR || 'build' }),
        files: {
            assets: 'public',
        },
        alias: {
            '$contracts':   'contracts',
            '$contracts/*': 'contracts/*',
        },
    },
};
