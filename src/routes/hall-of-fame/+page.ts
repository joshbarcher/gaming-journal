import { redirect } from '@sveltejs/kit'

// Consolidated into the tabbed /collections page ("Completed" tab). Kept as a permanent redirect so
// existing in-app links, deep links, and bookmarks still resolve to the right tab.
export function load() {
    redirect(308, '/collections?tab=completed')
}
