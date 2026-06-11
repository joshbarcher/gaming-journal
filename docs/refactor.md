# Refactor Log & Next Steps

## Completed: Svelte 5 + Vite Migration (`svelte-migration` branch)

All views migrated from vanilla JS DOM manipulation to Svelte 5 components, with Vite replacing the old unbundled script setup.

### What changed

- **Build**: Vite added (`vite.config.js`, `svelte.config.js`). Dev server on port 5173 proxies `/api` and `/relay` to Express on 8061. Production build outputs to `dist/`.
- **Views**: All 30 adapter `.js` files in `public/js/views/` deleted. Each view is now a Svelte component under `public/svelte/`.
- **Router**: `router.js` rewired to import Svelte components directly. Single `_mount(Component, props)` / `_cleanup()` helper replaces per-view mounted-instance tracking. `PAGE_COMPONENTS` map replaces the old `registerRenderer` API.
- **Sidebar**: `sidebar.js` rewritten (~110 lines, was ~750). Svelte component `Sidebar.svelte` driven by a shared reactive store (`sidebarStore.svelte.js`) using Svelte 5 class-based `$state`. Plain JS can mutate the store and Svelte re-renders reactively.
- **app.js**: Simplified — all `registerRenderer` calls removed.
- **Utility JS kept**: `calendar-render.js`, `community-render.js`, `game-render.js`, `journal-render.js` — still imported by Svelte components.
- **Code splitting**: Dynamic imports preserved for GamePage (~62 kB), GameJournal (~31 kB), CommunityPage/Thread (~11 kB each), TopGames (~6 kB).

### Build output (post-migration)

```
dist/assets/index.js        182 kB (gzip 48 kB)   ← main bundle
dist/assets/GamePage.js      62 kB
dist/assets/GameJournal.js   31 kB
dist/assets/CommunityPage.js 11 kB
dist/assets/CommunityThread.js 11 kB
dist/assets/TopGames.js       6 kB
```

---

## Next: TypeScript Migration

Goal: add type safety incrementally without blocking feature work. The Svelte + Vite setup is already ready for TS — no structural changes needed.

### Approach

Use `allowJs: true` + `checkJs` incrementally. Rename files to `.ts` / `.svelte` (Svelte files stay `.svelte` but get `<script lang="ts">`). Do it module by module, not all at once.

### Suggested order (lowest risk → highest)

1. **`tsconfig.json`** — scaffold with `"strict": false` initially, `allowJs: true`, `checkJs: false`. Enables IDE inference without forcing immediate fixes.
2. **Utility modules** — `utils.js`, `storage.js`, `api.js`. Small, pure, no DOM. Type the API response shapes here (this pays dividends everywhere else).
3. **Store** — `sidebarStore.svelte.js` → `.svelte.ts`. Simple class, easy to type.
4. **Router** — `router.js`. Type `parseRoute` return as a discriminated union (`RouteHome | RouteGame | RoutePage | ...`). This is the highest-leverage type in the codebase.
5. **Svelte components** — add `<script lang="ts">` and type props. Start with leaf components (Counter, Notes, Toc), work up to complex ones (GamePage, Sidebar).
6. **Server-side** (`src/`) — separate tsconfig, can be done in parallel with or after the client.

### Things to decide before starting

- **Strict mode**: start loose (`strict: false`) and tighten later, or start strict and fix everything upfront?
- **API types**: hand-write them in a `types/api.d.ts` file, or generate from the Express routes? Hand-written is faster to start; generation is more maintainable long-term.
- **`noEmit`**: Vite handles transpilation, so TS is type-check only. Set `"noEmit": true` and run `tsc --noEmit` in CI.

---

## Other Pending Work

### Known bugs (from `todo.md`)

- Release calendar does not scroll to current month on load
- Favorites animation is slightly jerky (subpixel movement?)
- Favorites title text wraps awkwardly at two lines
- Scroll position memory should expire after a period of inactivity
- Wishlist → library migration not implemented (does buying a game move it automatically?)

### Build / infra

- `INEFFECTIVE_DYNAMIC_IMPORT` warning: `router.js` does `import('./app.js')` for `closeMobileSidebar`, but `app.js` is already statically in the bundle. Fix by passing the callback into the router at init time instead of importing `app.js` dynamically.
