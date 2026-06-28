# Settings

App configuration at `/settings`. Controls content visibility filters and the discovery title blocklist.

## Data

Two fetches on mount:
- `GET /api/settings` → current `Settings` object
- `GET /api/flags` → all game flags (used to show counts of affected games)

Changes are saved immediately via `PATCH /api/settings` with the changed key. On failure, the setting reverts to its previous value (optimistic update with rollback).

## Settings fields

```ts
{
  showChildLocked:       boolean   // reveal child-locked games in all lists
  showFiltered:          boolean   // reveal filtered games in all lists
  discoverFiltersEnabled: boolean  // apply title blocklist to Discover + home mosaic
  titleBlocklist:        string[]  // case-insensitive substring terms
  hideUnavailable:       boolean   // hide delisted games from wishlist
}
```

## Sections

### Content Filters

| Toggle | Key | Effect |
|--------|-----|--------|
| Show Child Locked Games | `showChildLocked` | Reveals games with `flag.childLock` in library, wishlist, all collection pages |
| Show Filtered Games | `showFiltered` | Reveals games with `flag.filtered` (personal preference exclusions) |
| Enable Discovery Filters | `discoverFiltersEnabled` | Applies title blocklist to Discover page and home mosaic |

Each toggle shows a count badge (e.g., "3 games") when games would be affected. Counts come from iterating the flags object loaded on mount.

### Discovery Title Blocklist

A list of text terms. Games whose names contain any term (case-insensitive substring) are hidden from the Discover page and home mosaic when `discoverFiltersEnabled` is on.

- Add: type in the input + Enter or "Add" button. Terms are stored lowercase.
- Remove: × button on each tag.
- Saved immediately to `PATCH /api/settings` (full `titleBlocklist` array each time).
- Also mirrored to `localStorage` key `disc-title-blocklist` — the Discover page reads from localStorage for client-side filtering without re-fetching settings.

### Wishlist

| Toggle | Key | Effect |
|--------|-----|--------|
| Show Unavailable Games | `hideUnavailable` (inverted) | Shows/hides delisted games on the wishlist page |

**Note**: the toggle is inverted — the UI says "Show Unavailable Games" and the checkbox is `checked={!settings.hideUnavailable}`. When the user checks the box (show unavailable = on), `hideUnavailable = false`. When unchecked, `hideUnavailable = true`. The `onToggle` handler accounts for this: `settings[key] = key === 'hideUnavailable' ? !checked : checked`.

## Effect on other pages

| Setting | Pages affected |
|---------|---------------|
| `showChildLocked` | Library, Wishlist, all collection pages, home mosaic |
| `showFiltered` | Same as above |
| `discoverFiltersEnabled` | Discover page, home mosaic |
| `titleBlocklist` | Discover page, home mosaic |
| `hideUnavailable` | Wishlist page (session toggle there is separate) |

Settings are read server-side by `+page.server.ts` for the home page, and client-side via `loadGameFilter()` for collection pages. Changes take effect on next page load/navigation for server-side usage.

## Key files

| File | Role |
|------|------|
| `src/lib/svelte/settings/Settings.svelte` | Settings page component |
| `src/routes/settings/+page.svelte` | Route shell |
| `src/routes/api/settings/+server.ts` | GET/PATCH settings |
| `src/lib/js/views/game-filter.js` | `loadGameFilter()` — reads settings to build filter predicate |

## Common questions

**Q: I toggled "Show Filtered Games" but filtered games still don't appear in the library.**
`loadGameFilter()` is called on mount in each collection page. If you changed the setting after the page loaded, navigate away and back to reload the filter predicate.

**Q: I added a term to the title blocklist but games still appear in Discover.**
The Discover page reads from `localStorage` key `disc-title-blocklist`. Settings saves to both the relay and localStorage. If the save partially failed, the localStorage value may be stale. Check the browser console for errors on the settings PATCH.

## Gotchas

- **`hideUnavailable` is inverted** in the toggle logic — the stored value `true` means "hide them" but the UI checkbox means "show them." `onToggle` uses `!checked` specifically for this key. Don't apply this inversion to other settings.
- **Optimistic update** — settings state changes immediately in the UI before the PATCH completes. If the PATCH fails (relay down, network error), the value reverts. Users may not notice the revert if they navigate away quickly.
- **`titleBlocklist` terms stored lowercase** — `addTerm()` calls `.trim().toLowerCase()` before appending. Matching is also lowercase (`item.name.toLowerCase().includes(t)`). All comparisons are case-insensitive by design.
