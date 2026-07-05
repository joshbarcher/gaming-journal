import { createSlocHandler, DEFAULT_IGNORE_DIRS } from '../../../sloc.js'

// Reports SLOC for the whole repo, including the react-native/ mobile client nested inside it —
// that's the "all subprojects" scope: one tree walk from process.cwd() naturally covers both
// gaming-journal's own SvelteKit source and react-native's Expo source, since the latter is a
// real subdirectory here (no separate .git — confirmed not a submodule), not a sibling repo.
// relay-server is a separate sibling app (its own entry in process-mgr's fleet config) and is
// NOT covered by this endpoint — it would need its own /sloc if that's wanted later.
//
// Extra ignores beyond sloc.js's own defaults, checked against this repo's real directory
// listing rather than assumed: `.svelte-kit` (SvelteKit's own generated dev/build cache, 4.4MB),
// `react-native/.expo` (Expo's cache dir, 897K), `test-results` (Playwright artifacts),
// `.claude` (editor/tooling config, not app source). `build` and react-native's `dist` are
// already covered by DEFAULT_IGNORE_DIRS.
export const GET = createSlocHandler(process.cwd(), {
    name: 'gaming-journal',
    ignoreDirs: [...DEFAULT_IGNORE_DIRS, '.svelte-kit', '.expo', 'test-results', '.claude'],
})
