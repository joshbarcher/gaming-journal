# Discover Page

Steam game discovery at `/discover`. Browse Steam's featured sections (new releases, top sellers, coming soon, sales) or search the Steam catalog. Shows ownership/wishlist badges so you can skip games you already have.

## Modes

| Mode | Trigger | Description |
|------|---------|-------------|
| `browse` | Default, or clearing search | Shows the active featured tab |
| `search` | Typing in search box | Shows search results from Steam catalog |

Mode is stored in the persisted state (see below).

## Featured tabs

4 tabs, each backed by a separate Steam section:

| Tab ID | Label | Short |
|--------|-------|-------|
| `new_releases` | New Releases | New |
| `top_sellers` | Top Sellers | Top |
| `coming_soon` | Coming Soon | Soon |
| `specials` | On Sale | Sale |

Data: `GET /relay/api/discover/featured` — returns all 4 sections. Switching to a tab that's already loaded uses cached data; tabs not yet loaded fire `GET /relay/api/discover/featured?tab={id}&page={n}`.

Each section has its own page counter (`tabPages`), so you can browse page 3 of Top Sellers and come back to page 1 of New Releases.

## Search

- 40 results per page (`SEARCH_PAGE_SIZE`)
- 350ms debounce on input
- Results cached in memory (`_searchCache`) per page number within the current query session
- Clearing the search box resets mode to `browse` and clears the cache

## Ownership badges

On `onMount`, loads `GET /relay/api/games/ownership` which returns all games with a `source` field:
- `library` or `both` → added to `owned` Set
- `wishlist` or `both` → added to `wishlist` Set

Items in the browse/search grid show "Owned" or "Wishlisted" badges based on these sets.

## Title blocklist

A per-user text filter (stored in localStorage under key `disc-title-blocklist`). Games whose names contain any blocklisted term (case-insensitive substring) are hidden from browse and search results when `discoverFiltersEnabled` is true.

The blocklist itself is managed from a settings/preferences area outside the discover page.

## State persistence

Full discover state is serialized to `localStorage` key `disc-state` with a **24-hour TTL**:

```json
{
  "savedAt":     1719000000000,
  "mode":        "browse",
  "tab":         "new_releases",
  "tabPages":    { "new_releases": 2, "top_sellers": 1 },
  "searchQuery": "",
  "lastResults": [...],
  "searchTotal": 0,
  "searchPage":  1
}
```

On mount, if the saved state is older than 24h it's cleared and fresh data is loaded.

## Key files

| File | Role |
|------|------|
| `src/lib/svelte/discover/Discover.svelte` | Main discover component |
| `src/routes/discover/+page.svelte` | Route shell (mounts Discover) |
| `relay-server/src/controllers/discover/discover.controller.js` | `GET /api/discover/featured` |

## Common questions

**Q: Featured games aren't loading / stuck on loading.**
The relay fetches from Steam's store API. Check relay logs for `GET /api/discover/featured`. Steam rate-limits or returns errors intermittently — the page will show a `featuredError` message if the request fails.

**Q: Search returns no results for a game I know exists on Steam.**
The search goes through the relay's Steam search integration. If the relay's Steam session is expired or the game name is ambiguous, results may be empty. Try exact title search.

**Q: I see games I already own — why aren't they marked?**
Ownership is loaded from `GET /relay/api/games/ownership`. If the relay's game list isn't synced (Steam library sync hasn't run recently), the `owned` set may be stale.

## Gotchas

- **`_lastResults` is non-reactive** — it's used only for state persistence (serializing the last search result page to localStorage so it can be restored on return). It's not bound to `searchResults` reactively.
- **State TTL is 24h** — if you reopen the app after 24h, the previous tab/page/query state is discarded. This is intentional to avoid stale data.
- **`discoverFiltersEnabled` toggle** — if you disable filters, the blocklist is ignored for the session. The toggle state is not persisted; it resets to `true` on every mount.
