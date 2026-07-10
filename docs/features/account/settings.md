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

**Unified polarity: every toggle in this page means ON = hide, OFF = show.** Some settings are stored the opposite way (`showChildLocked`/`showFiltered`/`showSoftware` are true when the games are *visible*), so those rows render the negation of the stored value and pass `invert=true` to `onToggle(key, checked, invert)`, which stores `invert ? !checked : checked`. Settings already stored as "hide X" (e.g. `hideUnavailable`) pass no invert flag.

| Toggle | Key | Stored polarity | Effect (ON) |
|--------|-----|-----------------|-------------|
| Hide Child Locked Games | `showChildLocked` | inverted | Hides games with `flag.childLock` in library, wishlist, all collection pages |
| Hide Filtered Games | `showFiltered` | inverted | Hides games with `flag.filtered` (personal preference exclusions) |
| Hide Software & Tools | `showSoftware` | inverted | Hides apps flagged Software / Tool (e.g. Wallpaper Engine) |
| Enable Discovery Filters | `discoverFiltersEnabled` | direct | Applies title blocklist to Discover page and home mosaic |
| Hide Adult-Only Content | `hideAdultContent` | direct | Hides Steam Adult-Only Sexual Content from Discover and home mosaic |

Each flag-backed toggle shows a count badge (e.g., "3 games") when games would be affected. Counts come from iterating the flags object loaded on mount.

### Discovery Title Blocklist

A list of text terms. Games whose names contain any term (case-insensitive substring) are hidden from the Discover page and home mosaic when `discoverFiltersEnabled` is on.

- Add: type in the input + Enter or "Add" button. Terms are stored lowercase.
- Remove: × button on each tag.
- Saved immediately to `PATCH /api/settings` (full `titleBlocklist` array each time).
- Also mirrored to `localStorage` key `disc-title-blocklist` — the Discover page reads from localStorage for client-side filtering without re-fetching settings.

### Wishlist

| Toggle | Key | Stored polarity | Effect (ON) |
|--------|-----|-----------------|-------------|
| Hide Unavailable Games | `hideUnavailable` | direct | Hides delisted games on the wishlist page |

**Note**: this toggle follows the same ON = hide rule as the Content Filters. Because `hideUnavailable` is already stored as a "hide" flag (true = hidden), the checkbox is `checked={settings.hideUnavailable}` with no inversion — checking the box (hide unavailable = on) stores `hideUnavailable = true`.

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

**Q: I turned off "Hide Filtered Games" but filtered games still don't appear in the library.**
`loadGameFilter()` is called on mount in each collection page. If you changed the setting after the page loaded, navigate away and back to reload the filter predicate.

**Q: I added a term to the title blocklist but games still appear in Discover.**
The Discover page reads from `localStorage` key `disc-title-blocklist`. Settings saves to both the relay and localStorage. If the save partially failed, the localStorage value may be stale. Check the browser console for errors on the settings PATCH.

## Gotchas

- **Unified toggle polarity: ON = hide everywhere.** `onToggle(key, checked, invert)` stores `invert ? !checked : checked`. Rows whose stored key means "show X" (`showChildLocked`, `showFiltered`, `showSoftware`) pass `invert=true` and render `checked={!settings.key}`; rows already stored as "hide X" (`hideUnavailable`, `hideAdultContent`, `discoverFiltersEnabled`) pass no invert. Keep any new content-filter toggle on this same ON = hide convention.
- **Optimistic update** — settings state changes immediately in the UI before the PATCH completes. If the PATCH fails (relay down, network error), the value reverts. Users may not notice the revert if they navigate away quickly.
- **`titleBlocklist` terms stored lowercase** — `addTerm()` calls `.trim().toLowerCase()` before appending. Matching is also lowercase (`item.name.toLowerCase().includes(t)`). All comparisons are case-insensitive by design.
