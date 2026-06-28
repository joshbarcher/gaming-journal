# Franchises

User-defined game series/franchise groups at `/franchises` and `/franchise/{id}`. Lets you track a series of games (e.g., "Monster Hunter", "Dark Souls") with completion stats and a mosaic of cover art.

## Franchises list (`/franchises` — `Franchises.svelte`)

### Data

Three parallel fetches on mount:
- `api.franchises.list()` → all franchises with their entries
- `GET /api/flags` → completion/progress flags for each game
- `GET /relay/api/steam/games` → ownership and playtime data

### Card layout

Each franchise card shows:
- **Mosaic**: 4 cells, each showing a game's header image. Images are spread evenly across the entry list using `spreadIndices()` (picks 4 evenly-spaced indices). Each cell tries its primary image, falls back through remaining entry images on error (`mosaicCell` Svelte action with progressive fallback)
- **Name**: franchise title
- **Stats**: `X/Y completed · Zh played`
- **Progress bar**: `completed / total * 100%` fill

### Creating a franchise

"New Franchise" button opens an inline dialog with a name input. Submit calls `api.franchises.create({ name })` and navigates to the new franchise detail page.

### Key files

| File | Role |
|------|------|
| `src/lib/svelte/franchises/Franchises.svelte` | Franchise list page |
| `src/routes/franchises/+page.svelte` | Route shell |

---

## Franchise detail (`/franchise/{id}` — `Franchise.svelte`)

### Data

- `api.franchises.get(franchiseId)` → franchise + entries
- `GET /api/flags` → flags for status derivation
- `GET /relay/api/steam/games` (owned) + `GET /api/local-wishlist` (wishlisted) for ownership

### Entry status

Each entry's status is derived from flags + ownership (no explicit stored status field):

| Status | Condition |
|--------|-----------|
| `completed` | `flags.completed` |
| `dropped` | `flags.dropped` |
| `in-progress` | `flags.inProgress` |
| `playing` | `owned && playtime > 0` (no completion flag) |
| `wishlist` | wishlisted but not owned |
| `unplayed` | owned, 0 playtime, no flags |

### Timeline fill

Each entry has a visual fill bar on the franchise timeline:

| Status | Fill % | Color class |
|--------|--------|-------------|
| completed | 100% | `completed` |
| dropped | 100% | `dropped` |
| in-progress | 55% | `in-progress` |
| playing | 30% | `playing` |
| wishlist | 0% | `empty` |
| unplayed | 0% | `empty` |

### Stats

Header shows aggregate stats: completed count, dropped count, in-progress count, total playtime.

### Adding games

A game search/add control lets you add games to the franchise. Entries have an `appid` and an optional `order` for display sequence.

### Drag-to-reorder

Franchise entries support drag reorder (row-level, same delegation pattern as Backlog). Save triggers `api.franchises.updateEntries(franchiseId, entries)`.

### Renaming / deleting

- Inline rename: double-click the title → contenteditable; blur/Enter saves via `api.franchises.update(id, { name })`
- Delete franchise: confirmDialog → `api.franchises.delete(id)` → navigates back to `/franchises`

### Hero slideshow

The detail page shows a crossfading hero slideshow across the franchise's games (same two-div alternating opacity pattern as GameHero and Favorites), cycling through entry header images every 14 seconds.

### Key files

| File | Role |
|------|------|
| `src/lib/svelte/franchise/Franchise.svelte` | Franchise detail page |
| `src/routes/franchise/[id]/+page.svelte` | Route shell |
| `src/lib/js/api.js` | `api.franchises.*` methods |

---

## Common questions

**Q: A game's status shows "unplayed" but I've played it.**
Status is derived from `flag.completed`, `flag.dropped`, `flag.inProgress`, and `playtime_forever`. If flags aren't set and Steam shows 0 hours (e.g., played via family sharing or before tracking began), it shows "unplayed." Set the appropriate flag on the game page to fix it.

**Q: The mosaic cell shows a placeholder instead of the game art.**
`mosaicCell` progressively tries candidate images and falls back to a placeholder if all fail. The relay image proxy (`/relay/images/steam/games/{appid}/header.jpg`) may not have cached the image yet. Visiting the game page triggers caching.

**Q: How do I remove a game from a franchise?**
On the franchise detail page, each entry has a remove button. This calls `api.franchises.removeEntry(franchiseId, appid)`.

## Gotchas

- **`spreadIndices()`** picks evenly-spaced indices, not the first 4. For a 10-game franchise, the mosaic shows games 0, 3, 6, 9 — not 0, 1, 2, 3. This gives a better visual representation of the whole series.
- **Status is derived, not stored** — there's no `entry.status` field. It's always computed from flags + ownership at render time. Adding a flag on the game page is reflected immediately on the next franchise load.
- **`confirmDialog` required for delete** — per app convention, franchise deletion uses `confirmDialog` (not `confirm()`). See the [no native dialogs](../../memory/feedback_no_native_dialogs.md) memory.
