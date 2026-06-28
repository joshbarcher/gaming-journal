# Global Search

An overlay game search available from anywhere in the app. Searches the Steam catalog via the relay and navigates directly to the game page on selection.

## Triggering

**Keyboard shortcut**: `Ctrl + Space` anywhere in the app (except when focus is in a text input).

Handled in `+layout.svelte`'s global `onkeydown` listener:
```js
if (e.ctrlKey && e.code === 'Space') {
    e.preventDefault()
    searchOpen = !searchOpen
}
```

`Escape` closes the overlay if open. Navigating to any route also closes it (`afterNavigate` in layout).

## UI

Modal overlay: a dark scrim (`gs-scrim`) covers the page; clicking the scrim closes the search. The inner box (`gs-box`) contains:
- Search input (auto-focused on mount)
- Spinner while loading
- "×" clear button when query is non-empty
- Results list (up to 8 items)

## Search behavior

- Minimum 2 characters before search fires
- 200ms debounce on input changes
- `GET /relay/api/discover/search?q={query}&limit=8&offset=0`
- Returns `DiscoverItem[]` — each has `appid`, `name`, `headerImage`, etc.
- Results replace immediately on each successful response (no pagination)

## Keyboard navigation

| Key | Action |
|-----|--------|
| `↑` / `↓` | Move active result up/down |
| `Enter` | Navigate to active result's game page |
| `Escape` | Close overlay |

Active result is highlighted with `.gs-result--active` and scrolled into view via `scrollIntoView({ block: 'nearest' })`.

## Selection

Selecting a result (click or Enter) calls `onclose()` then `goto('/game/{appid}')`. The overlay is unmounted before navigation completes.

## Integration point

`GlobalSearch` is rendered conditionally in `+layout.svelte`:
```svelte
{#if searchOpen}
    <GlobalSearch onclose={() => searchOpen = false} />
{/if}
```

It's a singleton at the layout level — always available regardless of which route is active.

## Key files

| File | Role |
|------|------|
| `src/lib/svelte/GlobalSearch.svelte` | Search overlay component |
| `src/routes/+layout.svelte` | Keyboard shortcut binding, `searchOpen` state, conditional render |
| `relay-server/src/controllers/discover/discover.controller.js` | `GET /api/discover/search` |

## Common questions

**Q: Ctrl + Space doesn't open search.**
The shortcut fires on `window.keydown` in the layout. If focus is in an input/select/textarea (`e.target.tagName` check), the shortcut is ignored in some contexts. Also check if another element is swallowing `Ctrl + Space` (e.g., system IME or browser shortcut on some platforms).

**Q: Search returns no results for a game I know exists.**
The relay's discover search indexes the Steam catalog. Coverage depends on the relay's Steam search integration. Very new games, early-access titles, or games with unusual names may return sparse results. Try a shorter or different part of the name.

**Q: The overlay doesn't close after navigating.**
`afterNavigate` in the layout sets `searchOpen = false`. If navigation happens via something other than SvelteKit's `goto()` or `<a>` links (e.g., `window.location = ...`), `afterNavigate` won't fire. All internal navigation should use SvelteKit routing.

## Gotchas

- **8 results max** — the endpoint is called with `limit=8`. There's no pagination or "load more" in global search — it's meant for quick navigation, not exhaustive search. Use the Discover page for full search.
- **`Ctrl + Space` toggles** — pressing the shortcut while the overlay is open closes it (not just opens it). This is intentional.
- **No search history** — results are not persisted between openings. Each open starts with an empty query.
- **`DiscoverItem` type** — the results use the same type as the Discover page search. The relay's search endpoint is shared between global search and Discover page search.
