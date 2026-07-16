// Test stand-in for SvelteKit's $app/navigation (aliased in vite.config.js's
// isTest branch). Tests replace it with vi.mock('$app/navigation', ...) — this
// file only exists so the import specifier resolves outside a kit build.
export function goto(_url: string, _opts?: { replaceState?: boolean }): Promise<void> {
    return Promise.resolve()
}
